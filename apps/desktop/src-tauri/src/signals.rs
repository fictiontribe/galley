//! SIGTERM, SIGINT and SIGHUP quit the app the normal way (stopping the
//! server first) instead of ending the process on the spot. Logging out,
//! `kill <pid>` and Ctrl+C in a terminal all send one of them.
//!
//! The signals are blocked in the main thread before any other thread
//! exists, so every thread inherits the block and none of them can be
//! killed by one; a single thread then waits for them with `sigwait`.
//! Child processes start with a clean signal mask (std resets it).

#[cfg(unix)]
fn set() -> libc::sigset_t {
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
            libc::sigaddset(&mut set, signal);
        }
        set
    }
}

/// Call first thing in `main`, before anything starts a thread.
#[cfg(unix)]
pub fn block() {
    let set = set();
    unsafe {
        libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
    }
}

#[cfg(unix)]
pub fn quit_on_signal(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let set = set();
        let mut signal: libc::c_int = 0;

        if unsafe { libc::sigwait(&set, &mut signal) } == 0 {
            crate::debug_log!("[desktop] signal {signal}: quitting");
            app.exit(0);
        }
    });
}

#[cfg(not(unix))]
pub fn block() {}

#[cfg(not(unix))]
pub fn quit_on_signal(_app: tauri::AppHandle) {}
