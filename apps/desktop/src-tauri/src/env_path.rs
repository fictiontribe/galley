//! The PATH the server (and every site command it runs) gets.
//!
//! An app started from the Finder inherits launchd's PATH
//! (`/usr/bin:/bin:/usr/sbin:/sbin`), not the one the person's shell builds,
//! so `git`, `node`, `npm` and `pnpm` from Homebrew, nvm, Volta, fnm… would
//! not be found. We ask the login shell for its PATH (with a timeout, because
//! shell start-up files can do anything), then add the usual install
//! locations that exist on this machine, so a broken or slow shell config
//! still leaves the common tools reachable.

use std::{
    env,
    ffi::OsString,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

/// Brackets the PATH in the shell's output, which may also contain whatever
/// its start-up files print (banners, version-manager notices).
const MARK: &str = "__DESKTOP_SHELL_PATH__";
pub const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct ResolvedPath {
    pub value: OsString,
    /// Whether the login shell answered (false: inherited PATH + fallbacks only).
    pub from_shell: bool,
}

/// The text between the first pair of markers.
pub fn extract_marked(output: &str) -> Option<String> {
    let start = output.find(MARK)? + MARK.len();
    let end = start + output[start..].find(MARK)?;
    let value = output[start..end].trim();

    (!value.is_empty()).then(|| value.to_string())
}

/// The arguments that make `shell` print its PATH between markers. fish
/// keeps PATH as a list, so it is joined explicitly.
pub fn shell_args(shell: &Path) -> Vec<String> {
    let is_fish = shell.file_name().and_then(|n| n.to_str()) == Some("fish");
    let script = if is_fish {
        format!("printf '%s%s%s' '{MARK}' (string join : $PATH) '{MARK}'")
    } else {
        format!("printf '%s%s%s' '{MARK}' \"$PATH\" '{MARK}'")
    };

    vec!["-ilc".into(), script]
}

#[cfg(unix)]
fn login_shell_path(timeout: Duration) -> Option<String> {
    use std::os::unix::process::CommandExt;

    let shell = env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|s| s.is_absolute())?;
    let mut child = Command::new(&shell)
        .args(shell_args(&shell))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // Its own process group, so a timeout can stop whatever the start-up files launched.
        .process_group(0)
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            _ => {
                crate::procs::signal_group(child.id() as i32, libc::SIGKILL);
                let _ = child.wait();
                return None;
            }
        }
    }
    extract_marked(&reader.join().ok()?)
}

#[cfg(not(unix))]
fn login_shell_path(_timeout: Duration) -> Option<String> {
    None
}

/// Where tools commonly live when the shell didn't say. Only folders that exist are returned.
pub fn fallback_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    #[cfg(unix)]
    {
        dirs.extend(
            [
                "/opt/homebrew/bin",
                "/opt/homebrew/sbin",
                "/usr/local/bin",
                "/home/linuxbrew/.linuxbrew/bin",
            ]
            .map(PathBuf::from),
        );
        dirs.push(home.join(".volta/bin"));
        dirs.extend(
            newest_first(&home.join(".nvm/versions/node"))
                .into_iter()
                .map(|v| v.join("bin")),
        );
        for fnm in [
            ".fnm",
            "Library/Application Support/fnm",
            ".local/share/fnm",
        ] {
            dirs.push(home.join(fnm).join("aliases/default/bin"));
        }
        dirs.push(home.join(".asdf/shims"));
        dirs.push(home.join(".local/share/mise/shims"));
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".bun/bin"));
        dirs.push(home.join("Library/pnpm"));
        dirs.push(home.join(".local/share/pnpm"));
        dirs.extend(["/usr/bin", "/bin", "/usr/sbin", "/sbin"].map(PathBuf::from));
    }
    #[cfg(windows)]
    {
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(base) = env::var_os(var).map(PathBuf::from) {
                dirs.push(base.join("nodejs"));
                dirs.push(base.join("Git").join("cmd"));
            }
        }
        if let Some(appdata) = env::var_os("APPDATA").map(PathBuf::from) {
            dirs.push(appdata.join("npm"));
        }
        dirs.push(home.join(".volta").join("bin"));
    }
    dirs.retain(|dir| dir.is_dir());
    dirs
}

/// Version folders (`v20.11.0`, `v22.3.1`…) under `dir`, highest version first.
pub fn newest_first(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut versions: Vec<(Vec<u64>, PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .map(|path| {
            (
                version_key(path.file_name().and_then(|n| n.to_str()).unwrap_or("")),
                path,
            )
        })
        .collect();

    versions.sort_by(|a, b| b.0.cmp(&a.0));
    versions.into_iter().map(|(_, path)| path).collect()
}

pub fn version_key(name: &str) -> Vec<u64> {
    name.trim_start_matches('v')
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

/// Joins PATH lists in order, dropping empty entries and duplicates (first one wins).
pub fn merge_path<I>(lists: I) -> OsString
where
    I: IntoIterator<Item = Vec<PathBuf>>,
{
    let mut seen = std::collections::HashSet::new();
    let merged: Vec<PathBuf> = lists
        .into_iter()
        .flatten()
        .filter(|dir| !dir.as_os_str().is_empty())
        .filter(|dir| seen.insert(dir.clone()))
        .collect();

    env::join_paths(merged).unwrap_or_default()
}

pub fn split(path: &str) -> Vec<PathBuf> {
    env::split_paths(path).collect()
}

pub fn resolve() -> ResolvedPath {
    let home = home_dir().unwrap_or_default();
    let shell = login_shell_path(SHELL_TIMEOUT);
    let inherited = env::var("PATH").unwrap_or_default();
    let from_shell = shell.is_some();
    let value = merge_path([
        split(&shell.unwrap_or_default()),
        split(&inherited),
        fallback_dirs(&home),
    ]);

    ResolvedPath { value, from_shell }
}

pub fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let var = "USERPROFILE";
    #[cfg(not(windows))]
    let var = "HOME";

    env::var_os(var)
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

/// The first executable called `name` on `path`.
pub fn which(name: &str, path: &OsString) -> Option<PathBuf> {
    #[cfg(windows)]
    let candidates = [
        format!("{name}.exe"),
        format!("{name}.cmd"),
        name.to_string(),
    ];
    #[cfg(not(windows))]
    let candidates = [name.to_string()];

    env::split_paths(path).find_map(|dir| {
        candidates
            .iter()
            .map(|c| dir.join(c))
            .find(|file| is_executable(file))
    })
}

fn is_executable(file: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(file)
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        file.is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_path_from_noisy_shell_output() {
        let output = format!(
            "Welcome back!\nnvm: using v22\n{MARK}/opt/homebrew/bin:/usr/bin{MARK}trailing"
        );
        assert_eq!(
            extract_marked(&output).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin")
        );
    }

    #[test]
    fn no_markers_or_an_empty_path_is_none() {
        assert_eq!(extract_marked("just a banner"), None);
        assert_eq!(extract_marked(&format!("{MARK}{MARK}")), None);
        assert_eq!(extract_marked(&format!("{MARK}/usr/bin")), None);
    }

    #[test]
    fn fish_joins_its_path_list() {
        assert!(shell_args(Path::new("/opt/homebrew/bin/fish"))[1].contains("string join : $PATH"));
        assert!(shell_args(Path::new("/bin/zsh"))[1].contains("\"$PATH\""));
        assert_eq!(shell_args(Path::new("/bin/bash"))[0], "-ilc");
    }

    #[cfg(unix)]
    #[test]
    fn merges_in_order_without_duplicates_or_blanks() {
        let merged = merge_path([
            split("/a:/b::/c"),
            split("/b:/d"),
            vec![PathBuf::from("/a"), PathBuf::from("/e")],
        ]);
        assert_eq!(merged, OsString::from("/a:/b:/c:/d:/e"));
    }

    #[test]
    fn versions_sort_numerically_not_alphabetically() {
        let mut keys = vec![
            version_key("v9.11.2"),
            version_key("v20.11.0"),
            version_key("v20.9.0"),
        ];
        keys.sort();
        assert_eq!(keys, vec![vec![9, 11, 2], vec![20, 9, 0], vec![20, 11, 0]]);
    }

    #[cfg(unix)]
    #[test]
    fn finds_nvm_versions_newest_first_and_only_existing_fallbacks() {
        let home = std::env::temp_dir().join(format!("desktop-path-test-{}", std::process::id()));
        for v in ["v18.20.0", "v22.3.0", "v20.11.1"] {
            std::fs::create_dir_all(home.join(".nvm/versions/node").join(v).join("bin")).unwrap();
        }
        let dirs = fallback_dirs(&home);
        let nvm: Vec<_> = dirs.iter().filter(|d| d.starts_with(&home)).collect();
        assert_eq!(
            nvm,
            vec![
                &home.join(".nvm/versions/node/v22.3.0/bin"),
                &home.join(".nvm/versions/node/v20.11.1/bin"),
                &home.join(".nvm/versions/node/v18.20.0/bin"),
            ]
        );
        assert!(!dirs.contains(&home.join(".volta/bin")));
        std::fs::remove_dir_all(home).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn which_needs_an_executable_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("desktop-which-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let tool = dir.join("tool");
        std::fs::write(&tool, "#!/bin/sh\n").unwrap();
        let path = OsString::from(dir.as_os_str());
        assert_eq!(which("tool", &path), None);
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(which("tool", &path), Some(tool));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn asks_the_real_login_shell() {
        // This machine's own shell: it must answer with something PATH-shaped, in time.
        if std::env::var_os("SHELL").is_none() {
            return;
        }
        let started = Instant::now();
        let path = login_shell_path(SHELL_TIMEOUT);
        assert!(started.elapsed() <= SHELL_TIMEOUT + Duration::from_secs(1));
        if let Some(path) = path {
            assert!(path.contains("/usr/bin"), "{path}");
        }
    }
}
