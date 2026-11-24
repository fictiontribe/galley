//! Before the server starts: are the tools the person's sites need on PATH?
//! git publishes and keeps version history; Node.js runs each site's own
//! preview. Neither is part of this app, so when one is missing the start-up
//! window says which and where to get it — instead of a preview error later.

use serde::Serialize;
use std::{
    ffi::OsString,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    /// "git" or "node": the start-up page words each one.
    pub id: &'static str,
    pub found: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

const TOOLS: [&str; 2] = ["git", "node"];
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

/// "git version 2.39.5 (Apple Git-154)" → "2.39.5"; "v22.3.0" → "22.3.0".
/// Git for Windows adds a suffix of its own ("git version 2.47.1.windows.1"
/// → "2.47.1"): only the leading numbers count, or every Windows computer
/// would be told git is missing.
pub fn parse_version(output: &str) -> Option<String> {
    output.split_whitespace().find_map(|word| {
        let numbers: Vec<&str> = word
            .trim_start_matches('v')
            .split('.')
            .take_while(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
            .collect();

        (numbers.len() >= 2).then(|| numbers.join("."))
    })
}

/// Runs `<file> --version` with PATH set, killing it if it hangs. On a Mac
/// without the command-line tools, /usr/bin/git is a stub that fails here
/// (and offers to install them), so "found" means "answers", not "exists".
fn version_of(file: &Path, path: &OsString) -> Option<String> {
    let mut child = Command::new(file)
        .arg("--version")
        .env("PATH", path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + VERSION_TIMEOUT;

    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let output = child.wait_with_output().ok()?;

    parse_version(&String::from_utf8_lossy(&output.stdout))
}

pub fn check(path: &OsString) -> Vec<Tool> {
    TOOLS
        .iter()
        .map(|id| {
            let file = crate::env_path::which(id, path);
            let version = file.as_deref().and_then(|file| version_of(file, path));

            Tool {
                id,
                found: version.is_some(),
                version,
                path: file.map(|f| f.to_string_lossy().into_owned()),
            }
        })
        .collect()
}

pub fn missing(tools: &[Tool]) -> bool {
    tools.iter().any(|tool| !tool.found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_versions_from_tool_output() {
        assert_eq!(
            parse_version("git version 2.39.5 (Apple Git-154)\n").as_deref(),
            Some("2.39.5")
        );
        assert_eq!(parse_version("v22.3.0\n").as_deref(), Some("22.3.0"));
        assert_eq!(
            parse_version("git version 2.47.1.windows.1\n").as_deref(),
            Some("2.47.1")
        );
        assert_eq!(parse_version("release 3 of 2.x"), None);
        assert_eq!(parse_version("nothing useful"), None);
        assert_eq!(parse_version("version 2."), None);
    }

    #[test]
    fn an_empty_path_finds_nothing() {
        let tools = check(&OsString::from(""));
        assert_eq!(
            tools.iter().map(|t| t.id).collect::<Vec<_>>(),
            vec!["git", "node"]
        );
        assert!(tools.iter().all(|t| !t.found));
        assert!(missing(&tools));
    }

    #[test]
    fn this_machine_has_git() {
        let tools = check(&crate::env_path::resolve().value);
        assert!(tools[0].found, "{tools:?}");
    }
}
