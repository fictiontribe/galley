//! The app's lifecycle: start-up window → tool check → server → main window,
//! the error and retry paths, and shutdown.

use crate::{
    brand, bridge, env_path, menu, nav, net, preflight,
    server::{self, ServerProcess, StartError},
    windows,
};
use serde::Serialize;
use std::{
    collections::HashSet,
    ffi::OsString,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const STARTUP: &str = "startup";
pub const MAIN: &str = "main";
const LOG_LINES_SHOWN: usize = 40;

/// What the start-up window shows. Serialized for its page.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum Phase {
    Starting,
    /// git and/or Node.js weren't found. The person can check again or continue.
    MissingTools {
        tools: Vec<preflight::Tool>,
        path: Vec<String>,
    },
    /// The server didn't start, or stopped. `reason` is one of "exited", "timeout", "spawn", "stopped", "missing".
    Failed {
        reason: &'static str,
        detail: String,
        log: Vec<String>,
    },
    Running,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupView {
    pub product: &'static str,
    #[serde(flatten)]
    pub phase: Phase,
}

#[derive(Default)]
struct Inner {
    phase: Option<Phase>,
    /// Bumped by every start attempt; background threads of an older attempt stand down.
    generation: u64,
    path: Option<OsString>,
    skip_tool_check: bool,
    /// The running server's address, once ready.
    port: Option<u16>,
    token: Option<String>,
    quitting: bool,
    zoom: f64,
    /// Window labels that have been granted the bridge for the current port.
    granted: HashSet<String>,
    /// Folders asked to be opened before the server was up.
    pending_opens: Vec<String>,
}

pub struct Shell {
    inner: Mutex<Inner>,
    server: Arc<Mutex<Option<ServerProcess>>>,
}

impl Shell {
    pub fn new() -> Self {
        Shell {
            inner: Mutex::new(Inner {
                zoom: 1.0,
                ..Default::default()
            }),
            server: Arc::new(Mutex::new(None)),
        }
    }

    pub fn view(&self) -> StartupView {
        StartupView {
            product: brand::PRODUCT_NAME,
            phase: self
                .inner
                .lock()
                .unwrap()
                .phase
                .clone()
                .unwrap_or(Phase::Starting),
        }
    }

    /// The running server's port and token, when it is up.
    pub fn connection(&self) -> Option<(u16, String)> {
        let inner = self.inner.lock().unwrap();

        Some((inner.port?, inner.token.clone()?))
    }

    pub fn zoom_by(&self, factor: Option<f64>) -> f64 {
        let mut inner = self.inner.lock().unwrap();

        inner.zoom = match factor {
            Some(factor) => (inner.zoom * factor).clamp(0.5, 3.0),
            None => 1.0,
        };
        inner.zoom
    }

    /// Records that `label` gets the bridge's capability; false when it already has it.
    pub fn mark_granted(&self, label: &str) -> bool {
        self.inner.lock().unwrap().granted.insert(label.to_string())
    }

    pub fn is_quitting(&self) -> bool {
        self.inner.lock().unwrap().quitting
    }

    pub fn queue_open_requests(&self, requests: Vec<String>) {
        self.inner.lock().unwrap().pending_opens.extend(requests);
    }

    fn take_open_requests(&self) -> Vec<String> {
        std::mem::take(&mut self.inner.lock().unwrap().pending_opens)
    }

    fn set_phase(&self, phase: Phase) {
        self.inner.lock().unwrap().phase = Some(phase);
    }

    fn current(&self, generation: u64) -> bool {
        let inner = self.inner.lock().unwrap();

        inner.generation == generation && !inner.quitting
    }
}

pub fn shell(app: &AppHandle) -> tauri::State<'_, Shell> {
    app.state::<Shell>()
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        // Must be the first plugin: a second launch hands over to this one before anything else starts.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_existing(app);
            // A second launch with a folder or a galley:// link: open it here instead.
            windows::handle_open_requests(app, args.into_iter().skip(1).collect());
        }));
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[STARTUP])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        );
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Shell::new())
        .invoke_handler(tauri::generate_handler![
            bridge::pick_folder,
            bridge::open_external,
            bridge::reveal_in_finder,
            bridge::startup_state,
            bridge::startup_retry,
            bridge::startup_continue,
            bridge::startup_quit,
        ])
        .menu(|app| menu::build(app, &menu::MenuState::default()))
        .on_menu_event(|app, event| menu::handle(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                windows::forget(window.app_handle(), window.label());
                menu::refresh_soon(window.app_handle());
            }
        })
        .setup(|app| {
            crate::signals::quit_on_signal(app.handle().clone());
            open_startup_window(app.handle())?;
            begin(app.handle().clone(), false);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("couldn't start the app");

    app.run(|app, event| match event {
        // Closing the last window quits, on macOS too: the window is the app, and a
        // windowless app would keep the server and any preview running for nothing.
        RunEvent::ExitRequested { .. } => shell(app).inner.lock().unwrap().quitting = true,
        RunEvent::Exit => stop_server(app),
        // A folder dropped on the Dock icon, or a galley:// link.
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => windows::handle_open_requests(app, urls.iter().map(|url| url.to_string()).collect()),
        _ => {}
    });
}

fn focus_existing(app: &AppHandle) {
    let window = focused_app_window(app).or_else(|| app.get_webview_window(STARTUP));

    if let Some(window) = window {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_startup_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(STARTUP) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window);
    }
    WebviewWindowBuilder::new(app, STARTUP, WebviewUrl::App("index.html".into()))
        .title(brand::PRODUCT_NAME)
        .inner_size(520.0, 400.0)
        .resizable(false)
        .maximizable(false)
        .center()
        .build()
}

/// Starts (or restarts) everything after the start-up window: resolve PATH,
/// check tools, start the server, open the main window.
pub fn begin(app: AppHandle, recheck_path: bool) {
    let generation = {
        let shell = shell(&app);
        let mut inner = shell.inner.lock().unwrap();

        inner.generation += 1;
        inner.phase = Some(Phase::Starting);
        inner.port.take();
        inner.token = None;
        // A new server is a new port: every window's capability is granted afresh.
        inner.granted.clear();
        if recheck_path {
            inner.path = None;
        }
        inner.generation
    };

    thread::spawn(move || boot(app, generation));
}

/// The person chose to carry on without git or Node.js.
pub fn continue_without_tools(app: AppHandle) {
    shell(&app).inner.lock().unwrap().skip_tool_check = true;
    begin(app, false);
}

fn boot(app: AppHandle, generation: u64) {
    let state = shell(&app);
    // A previous attempt's server (after a failure or a crash) goes first, so its port is free again.
    if let Some(old) = state.server.lock().unwrap().take() {
        old.stop(server::STOP_GRACE);
    }
    let cached = state.inner.lock().unwrap().path.clone();
    let path = cached.unwrap_or_else(|| {
        let resolved = env_path::resolve();

        crate::debug_log!(
            "[desktop] PATH from {}: {}",
            if resolved.from_shell {
                "login shell"
            } else {
                "fallbacks"
            },
            resolved.value.to_string_lossy()
        );
        state.inner.lock().unwrap().path = Some(resolved.value.clone());
        resolved.value
    });

    if !state.current(generation) {
        return;
    }
    if !state.inner.lock().unwrap().skip_tool_check {
        let tools = preflight::check(&path);

        if preflight::missing(&tools) {
            let path_list = env_path::split(&path.to_string_lossy())
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();

            state.set_phase(Phase::MissingTools {
                tools,
                path: path_list,
            });
            return;
        }
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()));
    let resource_dir = app.path().resource_dir().ok();
    let launch = match server::locate(exe_dir.as_deref(), resource_dir.as_deref(), &path) {
        Ok(launch) => launch,
        Err(detail) => return fail(&app, generation, "missing", detail, Vec::new()),
    };
    let port = match net::pick_port(saved_port(&app)) {
        Ok(port) => port,
        Err(e) => {
            return fail(
                &app,
                generation,
                "spawn",
                format!("No free port on 127.0.0.1: {e}"),
                Vec::new(),
            )
        }
    };
    let token = net::mint_token();
    let process = match ServerProcess::spawn(&launch, &path, port, &token) {
        Ok(process) => process,
        Err(StartError::Spawn(detail)) => {
            return fail(&app, generation, "spawn", detail, Vec::new())
        }
        Err(other) => return fail(&app, generation, "spawn", format!("{other:?}"), Vec::new()),
    };

    crate::debug_log!(
        "[desktop] server pid {} on port {port}: {}",
        process.pid(),
        launch.describe()
    );
    let log = process.log.clone();

    *state.server.lock().unwrap() = Some(process);
    match server::wait_ready(&state.server, port, &token, server::READY_TIMEOUT) {
        Ok(_) => {}
        Err(StartError::Exited { status }) => {
            return fail(
                &app,
                generation,
                "exited",
                status,
                log.last(LOG_LINES_SHOWN),
            );
        }
        Err(StartError::Timeout) => {
            let seconds = server::READY_TIMEOUT.as_secs();
            return fail(
                &app,
                generation,
                "timeout",
                format!("No answer after {seconds} seconds."),
                log.last(LOG_LINES_SHOWN),
            );
        }
        Err(StartError::Spawn(detail)) => {
            return fail(&app, generation, "spawn", detail, log.last(LOG_LINES_SHOWN))
        }
    }
    if !state.current(generation) {
        return;
    }
    {
        let mut inner = state.inner.lock().unwrap();

        inner.port = Some(port);
        inner.token = Some(token.clone());
        inner.phase = Some(Phase::Running);
    }
    save_port(&app, port);
    // The capability is granted inside open_app_window, before the window exists.
    match windows::open_app_window(&app, MAIN, &format!("/?token={token}"), brand::PRODUCT_NAME) {
        Ok(_) => {
            if let Some(startup) = app.get_webview_window(STARTUP) {
                let _ = startup.close();
            }
        }
        Err(e) => {
            return fail(
                &app,
                generation,
                "spawn",
                format!("Couldn't open the window: {e}"),
                Vec::new(),
            )
        }
    }
    windows::restore(&app);
    let pending = state.take_open_requests();
    windows::handle_open_requests(&app, pending);
    menu::refresh_soon(&app);
    watch(app, generation);
}

/// After start-up: if the server stops on its own, say so instead of leaving a dead window.
fn watch(app: AppHandle, generation: u64) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(300));
        let state = shell(&app);

        if !state.current(generation) {
            return;
        }
        let exited = {
            let mut server = state.server.lock().unwrap();

            match server.as_mut() {
                Some(process) => process
                    .exit_status()
                    .map(|status| (status, process.log.last(LOG_LINES_SHOWN))),
                None => return,
            }
        };
        if let Some((status, log)) = exited {
            fail(&app, generation, "stopped", status, log);
            for window in windows::app_windows(&app) {
                let _ = window.close();
            }
            return;
        }
    });
}

fn fail(app: &AppHandle, generation: u64, reason: &'static str, detail: String, log: Vec<String>) {
    let state = shell(app);

    if !state.current(generation) {
        return;
    }
    crate::debug_log!("[desktop] start-up failed ({reason}): {detail}");
    state.set_phase(Phase::Failed {
        reason,
        detail,
        log,
    });
    // Show the start-up window before anything else closes, so the app never runs out of windows here.
    let _ = open_startup_window(app);
}

fn stop_server(app: &AppHandle) {
    let state = shell(app);

    state.inner.lock().unwrap().quitting = true;
    let process = state.server.lock().unwrap().take();

    if let Some(process) = process {
        process.stop(server::STOP_GRACE);
    }
}

fn port_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("server-port"))
}

fn saved_port(app: &AppHandle) -> Option<u16> {
    std::fs::read_to_string(port_file(app)?)
        .ok()
        .as_deref()
        .and_then(net::parse_port)
}

fn save_port(app: &AppHandle, port: u16) {
    if let Some(file) = port_file(app) {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(file, port.to_string());
    }
}

/// The app window the person is in: the focused one, else the main one, else any.
pub fn focused_app_window(app: &AppHandle) -> Option<WebviewWindow> {
    let all = windows::app_windows(app);

    all.iter()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| all.iter().find(|window| window.label() == MAIN))
        .or_else(|| all.first())
        .cloned()
}

/// Loads `path` of the app in the window the person is in.
pub fn navigate(app: &AppHandle, path: &str) {
    let (Some((port, _)), Some(window)) = (shell(app).connection(), focused_app_window(app)) else {
        return;
    };

    if let Ok(url) = Url::parse(&format!("{}{path}", nav::app_origin(port))) {
        let _ = window.navigate(url);
        let _ = window.set_focus();
    }
}
