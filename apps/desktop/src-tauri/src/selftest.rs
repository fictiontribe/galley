//! Debug builds only: checks the bridge and the permission boundary from
//! inside the real webview, for `scripts/shutdown-e2e.mjs`.
//!
//! With `GALLEY_DESKTOP_SELFTEST=<url of a page on another loopback port>`
//! and `GALLEY_DESKTOP_SELFTEST_OUT=<file>`, once the app's page has loaded
//! the shell runs a script in it that calls the bridge with bad arguments,
//! calls commands the page must not reach, and loads the given page in an
//! iframe (as the preview is loaded) which tries the bridge's commands
//! itself. The results come back through the document title and are written
//! to the file. Release builds don't contain this module.
//!
//! Every app window runs it once, on its first page: the main window writes
//! `<file>`, any other window `<file>.<label>` — so a site's own window is
//! checked to have exactly the bridge the main window has.

use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};
use tauri::{Url, WebviewWindow};

static STARTED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static PIECES: Mutex<Option<HashMap<String, Vec<Option<String>>>>> = Mutex::new(None);

/// Where one window's results go.
pub fn out_file(base: &str, label: &str) -> String {
    if label == crate::shell::MAIN {
        base.to_string()
    } else {
        format!("{base}.{label}")
    }
}

fn parse_piece(title: &str) -> Option<(usize, usize, &str)> {
    let rest = title.strip_prefix("SELFTEST:")?;
    let (counts, piece) = rest.split_once(':')?;
    let (index, total) = counts.split_once('/')?;
    let (index, total) = (index.parse::<usize>().ok()?, total.parse::<usize>().ok()?);

    (index >= 1 && index <= total && total <= 64).then_some((index, total, piece))
}

pub fn on_page_loaded(window: &WebviewWindow, url: &Url, port: u16) {
    let Ok(frame) = std::env::var("GALLEY_DESKTOP_SELFTEST") else {
        return;
    };

    if !crate::nav::is_app_url(url, port) {
        return;
    }
    let first = STARTED
        .lock()
        .unwrap()
        .get_or_insert_with(HashSet::new)
        .insert(window.label().to_string());

    if !first {
        return;
    }
    let frame = serde_json::to_string(&frame).unwrap();
    let _ = window.eval(include_str!("selftest.js").replace("__FRAME_URL__", &frame));
}

/// Collects "SELFTEST:<n>/<total>:<piece>" titles per window; writes the whole once every piece is in.
pub fn on_title(label: &str, title: &str) {
    let Some((index, total, piece)) = parse_piece(title) else {
        return;
    };
    let result = {
        let mut all = PIECES.lock().unwrap();
        let pieces = all.get_or_insert_with(HashMap::new).entry(label.to_string()).or_default();

        if pieces.len() != total {
            *pieces = vec![None; total];
        }
        pieces[index - 1] = Some(piece.to_string());
        if pieces.iter().any(Option::is_none) {
            return;
        }
        pieces.drain(..).map(Option::unwrap).collect::<String>()
    };

    crate::debug_log!("[selftest] {label}: {result}");
    if let Ok(base) = std::env::var("GALLEY_DESKTOP_SELFTEST_OUT") {
        let out = out_file(&base, label);
        // Written whole, then renamed into place, so the test never reads half of it.
        let partial = format!("{out}.partial");
        if std::fs::write(&partial, result).is_ok() {
            let _ = std::fs::rename(partial, out);
        }
    }
}
