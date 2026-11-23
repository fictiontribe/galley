//! The server process: where it comes from, starting it, knowing when it is
//! ready, and stopping it — with everything it started — on every way out.

use crate::{brand, http};
use std::{
    collections::VecDeque,
    ffi::OsString,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

pub const READY_TIMEOUT: Duration = Duration::from_secs(30);
pub const STOP_GRACE: Duration = Duration::from_secs(5);
const LOG_LINES: usize = 200;

/// How to run the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Launch {
    /// The installed app: the bundled Node runtime (a sidecar next to the
    /// app's executable) running the bundled CLI from the app's resources.
    Packaged { runtime: PathBuf, script: PathBuf },
    /// A debug build inside the monorepo: the person's own `node` running
    /// `packages/cli/bin/galley.js`, so no bundling step is needed.
    Dev { node: PathBuf, cli: PathBuf },
}

impl Launch {
    fn command(&self) -> (PathBuf, Vec<OsString>) {
        match self {
            Launch::Packaged { runtime, script } => (runtime.clone(), vec![script.into()]),
            Launch::Dev { node, cli } => (node.clone(), vec![cli.into()]),
        }
    }

    pub fn describe(&self) -> String {
        match self {
            Launch::Packaged { runtime, script } => {
                format!("{} {}", runtime.display(), script.display())
            }
            Launch::Dev { node, cli } => format!("{} {}", node.display(), cli.display()),
        }
    }
}

pub fn sidecar_name() -> String {
    format!("{}-node{}", brand::SLUG, std::env::consts::EXE_SUFFIX)
}

pub fn bundle_script_name() -> String {
    format!("{}.mjs", brand::SLUG)
}

/// Finds the server: the bundled one when this is a packaged app, the
/// monorepo's CLI when it is a debug build run from the repository.
pub fn locate(
    exe_dir: Option<&Path>,
    resource_dir: Option<&Path>,
    path: &OsString,
) -> Result<Launch, String> {
    if let (Some(exe_dir), Some(resource_dir)) = (exe_dir, resource_dir) {
        let runtime = exe_dir.join(sidecar_name());
        let script = resource_dir.join("server").join(bundle_script_name());

        if runtime.is_file() && script.is_file() {
            return Ok(Launch::Packaged { runtime, script });
        }
    }
    if cfg!(debug_assertions) {
        let cli = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/cli/bin")
            .join(format!("{}.js", brand::SLUG));
        let cli = cli
            .canonicalize()
            .map_err(|_| format!("The development server entry {} is missing.", cli.display()))?;
        let node = crate::env_path::which("node", path)
            .ok_or("Node.js isn't installed, and a development build runs the server with it.")?;

        return Ok(Launch::Dev { node, cli });
    }
    Err("This copy of the app is missing its server. Reinstall it.".into())
}

/// The environment the server gets: ours, with PATH resolved and the
/// GALLEY_* settings that would change what kind of server it is replaced.
pub fn child_env(
    base: impl Iterator<Item = (OsString, OsString)>,
    path: &OsString,
    port: u16,
    token: &str,
) -> Vec<(OsString, OsString)> {
    const DROP: [&str; 9] = [
        "GALLEY_HOST",
        "GALLEY_PORT",
        "GALLEY_TOKEN",
        "GALLEY_DESKTOP",
        "GALLEY_PASSWORD",
        "GALLEY_PUBLIC_URL",
        "GALLEY_TRUST_PROXY",
        // Only meaningful to Node when it's an Electron binary; never for our runtime.
        "ELECTRON_RUN_AS_NODE",
        "PATH",
    ];
    let mut env: Vec<(OsString, OsString)> = base
        .filter(|(key, _)| !DROP.iter().any(|drop| key == drop))
        .collect();

    env.push(("PATH".into(), path.clone()));
    env.push(("GALLEY_DESKTOP".into(), "1".into()));
    env.push(("GALLEY_HOST".into(), "127.0.0.1".into()));
    env.push(("GALLEY_PORT".into(), port.to_string().into()));
    env.push(("GALLEY_TOKEN".into(), token.into()));
    env
}

#[derive(Debug, Clone, Default)]
pub struct LogTail(Arc<Mutex<VecDeque<String>>>);

impl LogTail {
    pub fn push(&self, line: String) {
        let mut lines = self.0.lock().unwrap();

        lines.push_back(line);
        while lines.len() > LOG_LINES {
            lines.pop_front();
        }
    }

    pub fn last(&self, count: usize) -> Vec<String> {
        let lines = self.0.lock().unwrap();

        lines
            .iter()
            .skip(lines.len().saturating_sub(count))
            .cloned()
            .collect()
    }
}

fn pump(stream: impl Read + Send + 'static, log: LogTail) {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            crate::debug_log!("[server] {line}");
            log.push(line);
        }
    });
}

#[derive(Debug)]
pub enum StartError {
    Spawn(String),
    Exited { status: String },
    Timeout,
}

pub struct ServerProcess {
    child: Child,
    /// Never written. Holding it open is how the server knows we're alive:
    /// when this process ends for any reason the OS closes it, the server
    /// reads EOF and stops (`--exit-with-parent`).
    stdin: Option<ChildStdin>,
    pub log: LogTail,
}

impl ServerProcess {
    pub fn spawn(
        launch: &Launch,
        path: &OsString,
        port: u16,
        token: &str,
    ) -> Result<Self, StartError> {
        let (program, mut args) = launch.command();

        args.extend(["desktop", "--exit-with-parent", "--port"].map(OsString::from));
        args.push(port.to_string().into());
        let mut command = Command::new(&program);

        command
            .args(&args)
            .env_clear()
            .envs(child_env(std::env::vars_os(), path, port, token))
            .current_dir(crate::env_path::home_dir().unwrap_or_else(std::env::temp_dir))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Its own process group: one signal reaches the server and its helpers, never us.
            command.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|e| StartError::Spawn(format!("{}: {e}", program.display())))?;
        let log = LogTail::default();

        if let Some(out) = child.stdout.take() {
            pump(out, log.clone());
        }
        if let Some(err) = child.stderr.take() {
            pump(err, log.clone());
        }
        let stdin = child.stdin.take();

        Ok(ServerProcess { child, stdin, log })
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    /// Some(description) once the process has exited.
    pub fn exit_status(&mut self) -> Option<String> {
        match self.child.try_wait() {
            Ok(Some(status)) => Some(describe_status(status)),
            Ok(None) => None,
            Err(e) => Some(e.to_string()),
        }
    }

    /// SIGTERM to the server's process group, up to `grace` to finish, then
    /// SIGKILL — and any dev server it left behind goes too.
    #[cfg(unix)]
    pub fn stop(mut self, grace: Duration) {
        use crate::procs;

        let pid = self.child.id() as i32;
        let tree = procs::descendants(pid, &procs::snapshot());

        if self.exit_status().is_none() {
            procs::signal_group(pid, libc::SIGTERM);
            let deadline = Instant::now() + grace;

            while self.exit_status().is_none() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(50));
            }
            if self.exit_status().is_none() {
                procs::signal_group(pid, libc::SIGKILL);
                let _ = self.child.wait();
            }
        }
        drop(self.stdin.take());
        if !tree.is_empty() {
            procs::kill_orphans(&procs::orphans_left(&tree, &procs::snapshot()));
        }
    }

    /// Windows has no process groups to signal: closing stdin asks the
    /// server to stop (it exits on EOF), then the whole tree is ended.
    #[cfg(windows)]
    pub fn stop(mut self, grace: Duration) {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        drop(self.stdin.take());
        let deadline = Instant::now() + grace;

        while self.exit_status().is_none() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        let _ = Command::new("taskkill")
            .args(["/PID", &self.child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = self.child.wait();
    }
}

/// Polls `GET /api/meta` until the server in `slot` answers as a desktop
/// server, exits, or time runs out. The slot is only locked for a moment at a
/// time, so quitting meanwhile can take the process and stop it.
pub fn wait_ready(
    slot: &Mutex<Option<ServerProcess>>,
    port: u16,
    token: &str,
    timeout: Duration,
) -> Result<(), StartError> {
    let deadline = Instant::now() + timeout;

    loop {
        let exited = match slot.lock().unwrap().as_mut() {
            Some(process) => process.exit_status(),
            None => Some("stopped".into()),
        };
        if let Some(status) = exited {
            return Err(StartError::Exited { status });
        }
        if let Ok(response) = http::request(
            port,
            "GET",
            "/api/meta",
            token,
            None,
            Duration::from_secs(2),
        ) {
            if response.ok() && response.json().is_ok_and(|meta| meta["desktop"] == true) {
                return Ok(());
            }
        }
        if Instant::now() >= deadline {
            return Err(StartError::Timeout);
        }
        thread::sleep(Duration::from_millis(150));
    }
}

fn describe_status(status: std::process::ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return format!("stopped by signal {signal}");
        }
    }
    match status.code() {
        Some(code) => format!("exit code {code}"),
        None => "exited".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_child_env_is_ours_with_the_server_settings_replaced() {
        let base = [
            ("HOME", "/Users/me"),
            ("PATH", "/usr/bin"),
            ("GALLEY_HOME", "/Users/me/.galley-alt"),
            ("GALLEY_PASSWORD", "hosted-secret"),
            ("GALLEY_HOST", "0.0.0.0"),
            ("GALLEY_PORT", "80"),
        ]
        .map(|(k, v)| (OsString::from(k), OsString::from(v)));
        let env = child_env(
            base.into_iter(),
            &OsString::from("/opt/homebrew/bin:/usr/bin"),
            4410,
            "t0k3n",
        );
        let get = |key: &str| {
            env.iter()
                .filter(|(k, _)| k == key)
                .map(|(_, v)| v.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(get("PATH"), vec!["/opt/homebrew/bin:/usr/bin"]);
        assert_eq!(get("GALLEY_HOST"), vec!["127.0.0.1"]);
        assert_eq!(get("GALLEY_PORT"), vec!["4410"]);
        assert_eq!(get("GALLEY_TOKEN"), vec!["t0k3n"]);
        assert_eq!(get("GALLEY_DESKTOP"), vec!["1"]);
        assert!(get("GALLEY_PASSWORD").is_empty());
        // Same home as the CLI: an explicit GALLEY_HOME is respected, otherwise the server's default (~/.galley).
        assert_eq!(get("GALLEY_HOME"), vec!["/Users/me/.galley-alt"]);
        assert_eq!(get("HOME"), vec!["/Users/me"]);
    }

    #[test]
    fn keeps_only_the_last_log_lines() {
        let log = LogTail::default();
        for i in 0..(LOG_LINES + 5) {
            log.push(format!("line {i}"));
        }
        assert_eq!(
            log.last(2),
            vec![
                format!("line {}", LOG_LINES + 3),
                format!("line {}", LOG_LINES + 4)
            ]
        );
        assert_eq!(log.last(10_000).len(), LOG_LINES);
    }

    #[test]
    fn a_debug_build_finds_the_monorepo_cli() {
        let path = crate::env_path::resolve().value;
        match locate(None, None, &path).unwrap() {
            Launch::Dev { cli, .. } => {
                assert!(cli.ends_with(format!("packages/cli/bin/{}.js", brand::SLUG)))
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_packaged_layout_wins_when_complete() {
        let base = std::env::temp_dir().join(format!("desktop-locate-test-{}", std::process::id()));
        let (exe, res) = (base.join("MacOS"), base.join("Resources"));
        std::fs::create_dir_all(exe.clone()).unwrap();
        std::fs::create_dir_all(res.join("server")).unwrap();
        std::fs::write(exe.join(sidecar_name()), "").unwrap();
        let path = crate::env_path::resolve().value;
        // Script missing: not packaged.
        assert!(matches!(
            locate(Some(&exe), Some(&res), &path),
            Ok(Launch::Dev { .. })
        ));
        std::fs::write(res.join("server").join(bundle_script_name()), "").unwrap();
        assert_eq!(
            locate(Some(&exe), Some(&res), &path).unwrap(),
            Launch::Packaged {
                runtime: exe.join(sidecar_name()),
                script: res.join("server").join(bundle_script_name())
            }
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn stop_ends_a_process_that_ignores_sigterm_and_its_detached_child() {
        // A stand-in server that ignores SIGTERM, with a child in a session of its own (setsid),
        // like the engine's dev servers: out of reach of a signal to the server's group.
        if Command::new("python3").arg("--version").output().is_err() {
            return;
        }
        let script =
            "trap '' TERM; python3 -c 'import os, time; os.setsid(); time.sleep(300)' & sleep 300";
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        let child = command.spawn().unwrap();
        let pid = child.id() as i32;
        thread::sleep(Duration::from_millis(300));
        let tree = crate::procs::descendants(pid, &crate::procs::snapshot());
        assert!(!tree.is_empty());
        let process = ServerProcess {
            child,
            stdin: None,
            log: LogTail::default(),
        };
        let started = Instant::now();
        process.stop(Duration::from_millis(500));
        assert!(started.elapsed() < Duration::from_secs(3));
        thread::sleep(Duration::from_millis(100));
        let now = crate::procs::snapshot();
        for info in tree.iter().chain([&crate::procs::ProcInfo {
            pid,
            ppid: 0,
            pgid: pid,
        }]) {
            assert!(!now.iter().any(|p| p.pid == info.pid), "{info:?} survived");
        }
    }
}
