//! Process groups and the process tree, for stopping the server and
//! everything it started.
//!
//! The server leads its own process group (we start it with `setpgid`), so
//! one signal reaches it and any helper in that group. Site dev servers are a
//! different matter: the engine starts each in a session of its own so it can
//! stop them cleanly, which also puts them out of reach of a signal to the
//! server's group. The server stops them itself when it shuts down; for the
//! case where it can't (it had to be killed), we note its descendants before
//! signalling and finish off any that were left behind.
//!
//! Windows has no process groups; there the server is stopped with
//! `taskkill /T`, and only the pure helpers below are compiled (for tests).
#![cfg_attr(not(unix), allow(dead_code))]

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcInfo {
    pub pid: i32,
    pub ppid: i32,
    pub pgid: i32,
}

/// Parses `ps -A -o pid= -o ppid= -o pgid=`.
pub fn parse_ps(text: &str) -> Vec<ProcInfo> {
    text.lines()
        .filter_map(|line| {
            let mut fields = line
                .split_whitespace()
                .map(|field| field.parse::<i32>().ok());
            Some(ProcInfo {
                pid: fields.next()??,
                ppid: fields.next()??,
                pgid: fields.next()??,
            })
        })
        .collect()
}

/// Every process below `root` (children, their children, …), parents before children.
pub fn descendants(root: i32, table: &[ProcInfo]) -> Vec<ProcInfo> {
    let mut found: Vec<ProcInfo> = Vec::new();
    let mut frontier = vec![root];

    while let Some(parent) = frontier.pop() {
        for info in table
            .iter()
            .filter(|info| info.ppid == parent && info.pid != root)
        {
            if !found.iter().any(|f| f.pid == info.pid) {
                found.push(*info);
                frontier.push(info.pid);
            }
        }
    }
    found
}

/// Which of `before` are still running as orphans: their parent has died and
/// they were adopted (by launchd/init, or a Linux subreaper — so not simply
/// "ppid 1"), still in the same process group as before. The group check
/// keeps a recycled pid that now belongs to something else from being touched.
pub fn orphans_left(before: &[ProcInfo], now: &[ProcInfo]) -> Vec<ProcInfo> {
    before
        .iter()
        .filter(|old| {
            now.iter()
                .any(|cur| cur.pid == old.pid && cur.ppid != old.ppid && cur.pgid == old.pgid)
        })
        .copied()
        .collect()
}

#[cfg(unix)]
pub fn snapshot() -> Vec<ProcInfo> {
    std::process::Command::new("/bin/ps")
        .args(["-A", "-o", "pid=", "-o", "ppid=", "-o", "pgid="])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .map(|out| parse_ps(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or_default()
}

#[cfg(unix)]
pub fn signal_group(pgid: i32, signal: i32) -> bool {
    // Never signal group 0/1 or our own: a bug here must not reach the whole session.
    if pgid <= 1 || pgid == unsafe { libc::getpgrp() } {
        return false;
    }
    unsafe { libc::kill(-pgid, signal) == 0 }
}

#[cfg(unix)]
pub fn signal(pid: i32, signal: i32) -> bool {
    if pid <= 1 || pid == std::process::id() as i32 {
        return false;
    }
    unsafe { libc::kill(pid, signal) == 0 }
}

/// Kills what `orphans_left` reports: whole groups for group leaders (a dev
/// server and the processes it spawned), the single process otherwise.
#[cfg(unix)]
pub fn kill_orphans(orphans: &[ProcInfo]) {
    for orphan in orphans {
        if orphan.pgid == orphan.pid {
            signal_group(orphan.pid, libc::SIGKILL);
        } else {
            signal(orphan.pid, libc::SIGKILL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: i32, ppid: i32, pgid: i32) -> ProcInfo {
        ProcInfo { pid, ppid, pgid }
    }

    #[test]
    fn parses_ps_output_and_skips_junk() {
        let table =
            parse_ps("    1     0     1\n  500     1   500\nnot a row\n  501   500   501\n");
        assert_eq!(table, vec![p(1, 0, 1), p(500, 1, 500), p(501, 500, 501)]);
    }

    #[test]
    fn walks_the_whole_tree_below_the_server() {
        // 100 = shell, 200 = server (own group), 300 = npm (own session), 301 = astro, 400 = git
        let table = [
            p(100, 1, 100),
            p(200, 100, 200),
            p(300, 200, 300),
            p(301, 300, 300),
            p(400, 200, 400),
            p(999, 1, 999),
        ];
        let tree = descendants(200, &table);
        let pids: Vec<i32> = tree.iter().map(|i| i.pid).collect();
        assert_eq!(pids.len(), 3);
        assert!(pids.contains(&300) && pids.contains(&301) && pids.contains(&400));
        assert!(!pids.contains(&999) && !pids.contains(&100));
    }

    #[test]
    fn only_adopted_processes_in_their_old_group_count_as_left_behind() {
        let before = [p(300, 200, 300), p(301, 300, 300), p(400, 200, 400)];
        let now = [
            p(300, 1, 300),   // npm, adopted: left behind
            p(301, 300, 300), // still under npm: goes with npm's group
            p(400, 1, 777),   // pid recycled by something unrelated: leave it alone
        ];
        assert_eq!(orphans_left(&before, &now), vec![p(300, 200, 300)]);
        assert!(orphans_left(&before, &[]).is_empty());
        // A Linux subreaper adopts instead of init.
        assert_eq!(
            orphans_left(&[p(300, 200, 300)], &[p(300, 42, 300)]),
            vec![p(300, 200, 300)]
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_signal_dangerous_targets() {
        assert!(!signal_group(0, 0));
        assert!(!signal_group(1, 0));
        assert!(!signal_group(unsafe { libc::getpgrp() }, 0));
        assert!(!signal(1, 0));
        assert!(!signal(std::process::id() as i32, 0));
    }

    #[cfg(unix)]
    #[test]
    fn a_real_snapshot_contains_this_process() {
        let me = std::process::id() as i32;
        assert!(snapshot().iter().any(|info| info.pid == me));
    }
}
