//! App windows: the main one, a window per site, and plain extra windows.
//!
//! Every app window is the same kind of window on the same local server: the
//! same navigation lock, the same initialization script, and a capability of
//! its own granting exactly the bridge's three commands (bridge.rs). A site's
//! window has the label `site-<id>` — one per site, so asking again focuses
//! it — and its size and position are kept by the window-state plugin under
//! that label. Which site windows were open is remembered across launches in
//! `windows.json` beside the app's other state.
//!
//! Requests to open a folder that arrive from outside the app — a
//! `galley://open?path=…` link, a folder dropped on the Dock icon, a folder
//! given to a second launch — are checked here for shape (nav::open_request)
//! and then go through `POST /api/sites/open`, exactly like the folder
//! picker's choice; only a site the server accepted gets a window.

use crate::{brand, bridge, http, menu, nav, shell};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU32, Ordering},
    thread,
    time::Duration,
};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

pub const SITE_PREFIX: &str = "site-";
pub const PLAIN_PREFIX: &str = "window-";
/// At most this many site windows are reopened at launch.
const MAX_RESTORED: usize = 12;
static NEXT_PLAIN: AtomicU32 = AtomicU32::new(1);

/// Whether a window label is one of the app's own page windows (not the start-up window).
pub fn is_app_label(label: &str) -> bool {
    label == shell::MAIN || label.starts_with(SITE_PREFIX) || label.starts_with(PLAIN_PREFIX)
}

pub fn site_label(site_id: &str) -> String {
    format!("{SITE_PREFIX}{site_id}")
}

/// Every open app window, main first.
pub fn app_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    let mut windows: Vec<WebviewWindow> = app
        .webview_windows()
        .into_values()
        .filter(|window| is_app_label(window.label()))
        .collect();

    windows.sort_by_key(|window| (window.label() != shell::MAIN, window.label().to_string()));
    windows
}

/// Builds an app window at `path` (which may carry `?token=` for the sign-in
/// hand-off). The capability is granted before the window exists, so its
/// first page already has the bridge.
pub fn open_app_window(
    app: &AppHandle,
    label: &str,
    path: &str,
    title: &str,
) -> Result<WebviewWindow, String> {
    let (port, _) = shell::shell(app)
        .connection()
        .ok_or("The app isn't connected to its server.")?;
    if shell::shell(app).mark_granted(label) {
        bridge::grant_app_origin(app, port, label).map_err(|e| e.to_string())?;
    }
    let start = Url::parse(&format!("{}{path}", nav::app_origin(port))).map_err(|e| e.to_string())?;
    let on_window = app.clone();
    let on_load = app.clone();
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(start))
        .title(title)
        .inner_size(1280.0, 820.0)
        .min_inner_size(1024.0, 680.0)
        // HTML5 drag and drop (images into media, sites between groups) needs the webview to get the drop, not the shell.
        .disable_drag_drop_handler()
        .initialization_script(bridge::script(
            port,
            &app.package_info().version.to_string(),
        ))
        .on_navigation(nav::allow_navigation)
        .on_new_window(move |url, _features| {
            // The app's own site page with `galley-window=new`: a window of its own.
            if let Some(site_path) = nav::site_window_request(&url, port) {
                open_site_window(on_window.clone(), site_path);
            } else if let Some(external) = nav::new_window_target(&url, port) {
                let _ = on_window.opener().open_url(external.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Started {
                #[cfg(debug_assertions)]
                crate::selftest::on_page_loaded(&window, payload.url(), port);
                menu::refresh_soon(&on_load);
                return;
            }
            if let Some(external) = nav::main_frame_left_app(payload.url(), port) {
                if let Some(url) = external {
                    let _ = on_load.opener().open_url(url.as_str(), None::<&str>);
                }
                if let Ok(home) = Url::parse(&format!("{}/", nav::app_origin(port))) {
                    let _ = window.navigate(home);
                }
            }
        });
    let builder = if label == shell::MAIN {
        builder.center()
    } else {
        builder
    };
    #[cfg(debug_assertions)]
    let builder = {
        let label = label.to_string();
        builder.on_document_title_changed(move |_window, title| crate::selftest::on_title(&label, &title))
    };

    builder.build().map_err(|e| e.to_string())
}

/// The site's name from the server's list, for the window title.
fn site_name(app: &AppHandle, site_id: &str) -> Option<String> {
    let (port, token) = shell::shell(app).connection()?;
    let sites = http::request(port, "GET", "/api/sites", &token, None, Duration::from_secs(5))
        .ok()?
        .json()
        .ok()?;

    sites
        .as_array()?
        .iter()
        .find(|site| site["id"].as_str() == Some(site_id))
        .and_then(|site| site["name"].as_str())
        .map(str::to_string)
}

/// Opens `path` (a `/sites/<id>…` page) in that site's own window, or focuses
/// the window it already has. Runs its lookups off the main thread.
pub fn open_site_window(app: AppHandle, path: String) {
    thread::spawn(move || {
        let Some(site_id) = nav::site_id_of_path(path.split('?').next().unwrap_or("")).map(str::to_string) else {
            return;
        };
        let label = site_label(&site_id);

        if let Some(existing) = app.get_webview_window(&label) {
            let _ = existing.unminimize();
            let _ = existing.show();
            let _ = existing.set_focus();
            return;
        }
        let Some((_, token)) = shell::shell(&app).connection() else {
            return;
        };
        let title = site_name(&app, &site_id).unwrap_or_else(|| brand::PRODUCT_NAME.to_string());
        // The token signs the window in if it doesn't share the main window's
        // cookie; the server drops it from the address either way.
        let separator = if path.contains('?') { '&' } else { '?' };
        let with_token = format!("{path}{separator}token={token}");
        let opener = app.clone();
        let _ = app.run_on_main_thread(move || match open_app_window(&opener, &label, &with_token, &title) {
            Ok(window) => {
                let _ = window.set_focus();
                remember(&opener, &label, &path);
                menu::refresh_soon(&opener);
            }
            Err(e) => crate::debug_log!("[desktop] couldn't open a window for {label}: {e}"),
        });
    });
}

/// File › New window: another window on the sites list.
pub fn open_plain_window(app: &AppHandle) {
    let Some((_, token)) = shell::shell(app).connection() else {
        return;
    };
    let label = format!("{PLAIN_PREFIX}{}", NEXT_PLAIN.fetch_add(1, Ordering::SeqCst));

    if let Err(e) = open_app_window(app, &label, &format!("/?token={token}"), brand::PRODUCT_NAME) {
        crate::debug_log!("[desktop] couldn't open a new window: {e}");
    }
}

// ─────────────────────────────────────────────── remembered site windows

fn state_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("windows.json"))
}

/// `[{"label": "site-…", "path": "/sites/…"}]`, oldest first.
pub fn parse_remembered(text: &str) -> Vec<(String, String)> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let label = item["label"].as_str()?;
            let path = item["path"].as_str()?;
            // Only what this file writes: a site window and one of the app's site pages.
            let id = nav::site_id_of_path(path.split('?').next().unwrap_or(""))?;

            (label == site_label(id) && path.len() <= nav::MAX_URL_LENGTH).then(|| (label.to_string(), path.to_string()))
        })
        .take(MAX_RESTORED)
        .collect()
}

fn load(app: &AppHandle) -> Vec<(String, String)> {
    state_file(app)
        .and_then(|file| std::fs::read_to_string(file).ok())
        .map(|text| parse_remembered(&text))
        .unwrap_or_default()
}

fn save(app: &AppHandle, entries: &[(String, String)]) {
    let Some(file) = state_file(app) else { return };
    let body = serde_json::Value::Array(
        entries
            .iter()
            .map(|(label, path)| serde_json::json!({ "label": label, "path": path }))
            .collect(),
    );

    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let partial = file.with_extension("json.partial");
    if std::fs::write(&partial, body.to_string()).is_ok() {
        let _ = std::fs::rename(partial, file);
    }
}

fn remember(app: &AppHandle, label: &str, path: &str) {
    let mut entries = load(app);

    entries.retain(|(known, _)| known != label);
    entries.push((label.to_string(), path.to_string()));
    save(app, &entries);
}

/// A site window was closed by the person (not by quitting): it isn't reopened next time.
pub fn forget(app: &AppHandle, label: &str) {
    if !label.starts_with(SITE_PREFIX) || shell::shell(app).is_quitting() {
        return;
    }
    let mut entries = load(app);
    let before = entries.len();

    entries.retain(|(known, _)| known != label);
    if entries.len() != before {
        save(app, &entries);
    }
}

/// Reopens the site windows that were open when the app last quit.
pub fn restore(app: &AppHandle) {
    for (_, path) in load(app) {
        open_site_window(app.clone(), path);
    }
}

// ─────────────────────────────────────────────── opening folders from outside

/// Handles `galley://open?path=…`, a folder dropped on the Dock icon, or
/// folders given to a second launch. Before the server is up they wait.
pub fn handle_open_requests(app: &AppHandle, requests: Vec<String>) {
    let requests: Vec<String> = requests.into_iter().filter(|r| !r.is_empty()).collect();

    if requests.is_empty() {
        return;
    }
    if shell::shell(app).connection().is_none() {
        shell::shell(app).queue_open_requests(requests);
        return;
    }
    for request in requests {
        let app = app.clone();

        thread::spawn(move || match nav::open_request(&request) {
            Ok(folder) => open_folder(&app, &folder),
            Err(message) => tell(&app, "Couldn't open that", message),
        });
    }
}

/// `POST /api/sites/open` with the folder — the same check the picker's choice gets — then the site's window.
pub fn open_folder(app: &AppHandle, folder: &std::path::Path) {
    let Some((port, token)) = shell::shell(app).connection() else {
        return;
    };
    let body = serde_json::json!({ "path": folder.to_string_lossy() }).to_string();
    let outcome = http::request(port, "POST", "/api/sites/open", &token, Some(&body), Duration::from_secs(120))
        .and_then(|response| Ok((response.ok(), response.json()?)));

    match outcome {
        Ok((true, site)) => match site["id"].as_str() {
            Some(id) if nav::site_id_of_path(&format!("/sites/{id}")).is_some() => {
                open_site_window(app.clone(), format!("/sites/{}", menu::encode_segment(id)));
            }
            _ => tell(app, "Couldn't open that folder", "The server didn't say which site it opened.".into()),
        },
        Ok((false, error)) => tell(
            app,
            "Couldn't open that folder",
            error["error"]["message"].as_str().unwrap_or("The server refused it.").to_string(),
        ),
        Err(detail) => tell(app, "Couldn't open that folder", format!("The app couldn't reach its server: {detail}")),
    }
}

pub fn tell(app: &AppHandle, title: &str, message: String) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_say_which_windows_are_the_apps() {
        assert!(is_app_label("main"));
        assert!(is_app_label("site-a1b2c3d4e5f6"));
        assert!(is_app_label("window-3"));
        assert!(!is_app_label("startup"));
        assert_eq!(site_label("a1b2"), "site-a1b2");
    }

    #[test]
    fn only_well_formed_site_windows_are_remembered() {
        let text = r#"[
            {"label": "site-a1b2", "path": "/sites/a1b2/edit?path=x"},
            {"label": "site-zzzz", "path": "/sites/a1b2"},
            {"label": "main", "path": "/"},
            {"label": "site-c3d4", "path": "/settings"},
            {"label": "site-e5f6", "path": "/sites/e5f6"},
            {"nonsense": true}
        ]"#;
        assert_eq!(
            parse_remembered(text),
            vec![
                ("site-a1b2".to_string(), "/sites/a1b2/edit?path=x".to_string()),
                ("site-e5f6".to_string(), "/sites/e5f6".to_string())
            ]
        );
        assert!(parse_remembered("not json").is_empty());
        assert!(parse_remembered("{}").is_empty());
    }
}
