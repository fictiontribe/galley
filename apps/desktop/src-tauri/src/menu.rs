//! The native menu. Labels follow the platform's conventions in sentence
//! case; the product's name comes from `brand.rs`, never a literal.
//!
//! File › Open recent lists the sites most recently opened (from the server's
//! list, newest first, up to ten); "Clear" hides the ones opened so far. The
//! Window menu lists the open windows (macOS adds them itself). The menu is
//! rebuilt a moment after windows open or close and pages load, so both lists
//! stay current; on macOS the same recent sites make the Dock menu.

use crate::{brand, http, nav, shell, windows};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Manager, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

const SETTINGS: &str = "settings";
const OPEN_SITE: &str = "open-site";
const NEW_SITE: &str = "new-site";
const NEW_WINDOW: &str = "new-window";
const OPEN_SITE_WINDOW: &str = "open-site-window";
const ADD_SITES: &str = "add-sites";
const RECENT_PREFIX: &str = "recent:";
const RECENT_CLEAR: &str = "recent-clear";
const WINDOW_PREFIX: &str = "window:";
const MAX_RECENT: usize = 10;

/// What the menu lists that changes while the app runs.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct MenuState {
    /// (site id, name), most recently opened first.
    pub recent: Vec<(String, String)>,
    /// (window label, title).
    pub windows: Vec<(String, String)>,
}

/// The recent sites from `GET /api/sites`: opened after `cleared_at` (ms), not missing, newest first.
pub fn recent_sites(sites: &serde_json::Value, cleared_at: u64) -> Vec<(String, String)> {
    let mut list: Vec<(u64, String, String)> = sites
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|site| site["missing"].as_bool() != Some(true))
                .filter_map(|site| {
                    let id = site["id"].as_str()?;
                    let name = site["name"].as_str()?;
                    let opened = site["lastOpenedAt"].as_f64().unwrap_or(0.0) as u64;

                    (opened > cleared_at && nav::site_id_of_path(&format!("/sites/{id}")).is_some())
                        .then(|| (opened, id.to_string(), name.chars().take(80).collect()))
                })
                .collect()
        })
        .unwrap_or_default();

    list.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    list.into_iter().take(MAX_RECENT).map(|(_, id, name)| (id, name)).collect()
}
const RELOAD: &str = "reload";
const ACTUAL_SIZE: &str = "actual-size";
const ZOOM_IN: &str = "zoom-in";
const ZOOM_OUT: &str = "zoom-out";
const DOCS: &str = "docs";
const REPORT: &str = "report-issue";
const QUIT: &str = "quit";

pub fn build(app: &AppHandle, state: &MenuState) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, label: &str, accelerator: Option<&str>| {
        let builder = MenuItemBuilder::with_id(id, label);
        match accelerator {
            Some(accelerator) => builder.accelerator(accelerator).build(app),
            None => builder.build(app),
        }
    };
    let about = AboutMetadataBuilder::new()
        .name(Some(brand::PRODUCT_NAME))
        .version(Some(app.package_info().version.to_string()))
        .comments(Some(format!("{}. {}", brand::DESCRIPTOR, brand::TAGLINE)))
        .copyright(Some(format!("© {}", brand::MAKER)))
        .website(Some(brand::DOCS_URL))
        .license(Some("Apache-2.0"))
        .build();

    let mut recent = SubmenuBuilder::new(app, "Open recent");

    for (id, name) in &state.recent {
        recent = recent.item(&item(&format!("{RECENT_PREFIX}{id}"), name, None)?);
    }
    if state.recent.is_empty() {
        recent = recent.item(&MenuItemBuilder::with_id("recent-none", "No recent sites").enabled(false).build(app)?);
    }
    let recent = recent
        .separator()
        .item(&MenuItemBuilder::with_id(RECENT_CLEAR, "Clear").enabled(!state.recent.is_empty()).build(app)?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&item(NEW_WINDOW, "New window", Some("CmdOrCtrl+Shift+N"))?)
        .item(&item(OPEN_SITE, "Open site…", Some("CmdOrCtrl+O"))?)
        .item(&item(OPEN_SITE_WINDOW, "Open site in new window…", Some("CmdOrCtrl+Shift+O"))?)
        .item(&recent)
        .item(&item(ADD_SITES, "Add sites from a folder…", None)?)
        .item(&item(NEW_SITE, "New site…", Some("CmdOrCtrl+N"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(
            app,
            Some("Close window"),
        )?);
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item(RELOAD, "Reload", Some("CmdOrCtrl+R"))?)
        .separator()
        .item(&item(ACTUAL_SIZE, "Actual size", Some("CmdOrCtrl+0"))?)
        .item(&item(ZOOM_IN, "Zoom in", Some("CmdOrCtrl+="))?)
        .item(&item(ZOOM_OUT, "Zoom out", Some("CmdOrCtrl+-"))?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(
            app,
            Some("Toggle full screen"),
        )?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().maximize();
    // macOS lists the open windows in its Window menu by itself.
    #[cfg(not(target_os = "macos"))]
    let window = {
        let mut window = window.separator();
        for (label, title) in &state.windows {
            window = window.item(&item(&format!("{WINDOW_PREFIX}{label}"), title, None)?);
        }
        window
    };
    let window = window.build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item(DOCS, "Documentation", None)?)
        .item(&item(REPORT, "Report an issue", None)?)
        .build()?;

    #[cfg(target_os = "macos")]
    let menu = {
        let app_menu = SubmenuBuilder::new(app, brand::PRODUCT_NAME)
            .about(Some(about))
            .separator()
            .item(&item(SETTINGS, "Settings…", Some("CmdOrCtrl+,"))?)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .item(&item(
                QUIT,
                &format!("Quit {}", brand::PRODUCT_NAME),
                Some("CmdOrCtrl+Q"),
            )?)
            .build()?;
        let menu = Menu::with_items(
            app,
            &[&app_menu, &file.build()?, &edit, &view, &window, &help],
        )?;

        window.set_as_windows_menu_for_nsapp()?;
        help.set_as_help_menu_for_nsapp()?;
        menu
    };
    // Elsewhere there is no app menu: About goes under Help, Settings and Quit under File.
    #[cfg(not(target_os = "macos"))]
    let menu = {
        let file = file
            .separator()
            .item(&item(SETTINGS, "Settings…", Some("CmdOrCtrl+,"))?)
            .separator()
            .item(&item(QUIT, "Quit", Some("CmdOrCtrl+Q"))?)
            .build()?;
        help.append(&PredefinedMenuItem::separator(app)?)?;
        help.append(&PredefinedMenuItem::about(
            app,
            Some(&format!("About {}", brand::PRODUCT_NAME)),
            Some(about),
        )?)?;
        Menu::with_items(app, &[&file, &edit, &view, &window, &help])?
    };
    Ok(menu)
}

pub fn handle(app: &AppHandle, id: &str) {
    if let Some(site_id) = id.strip_prefix(RECENT_PREFIX) {
        if nav::site_id_of_path(&format!("/sites/{site_id}")).is_some() {
            shell::navigate(app, &format!("/sites/{}", encode_segment(site_id)));
        }
        return;
    }
    if let Some(label) = id.strip_prefix(WINDOW_PREFIX) {
        if let Some(window) = app.get_webview_window(label).filter(|w| windows::is_app_label(w.label())) {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        return;
    }
    match id {
        SETTINGS => shell::navigate(app, "/settings"),
        NEW_SITE => shell::navigate(app, "/new"),
        ADD_SITES => shell::navigate(app, "/?open=sites"),
        OPEN_SITE => open_site(app.clone(), false),
        OPEN_SITE_WINDOW => open_site(app.clone(), true),
        NEW_WINDOW => windows::open_plain_window(app),
        RECENT_CLEAR => {
            save_cleared_at(app, now_ms());
            refresh_soon(app);
        }
        RELOAD => {
            if let Some(window) = shell::focused_app_window(app) {
                let _ = window.reload();
            }
        }
        ACTUAL_SIZE => zoom(app, None),
        ZOOM_IN => zoom(app, Some(1.1)),
        ZOOM_OUT => zoom(app, Some(1.0 / 1.1)),
        DOCS => open_brand_link(app.clone(), "docsUrl", brand::DOCS_URL),
        REPORT => open_brand_link(app.clone(), "supportUrl", brand::ISSUES_URL),
        QUIT => app.exit(0),
        _ => {}
    }
}

fn zoom(app: &AppHandle, factor: Option<f64>) {
    if let Some(window) = shell::focused_app_window(app) {
        let _ = window.set_zoom(shell::shell(app).zoom_by(factor));
    }
}

/// File › Open site…: folder dialog → `POST /api/sites/open` → that site,
/// here or (`new_window`) in a window of its own.
fn open_site(app: AppHandle, new_window: bool) {
    let Some((port, token)) = shell::shell(&app).connection() else {
        return;
    };

    thread::spawn(move || {
        let mut dialog = app.dialog().file().set_title("Open a site");

        if let Some(window) = shell::focused_app_window(&app) {
            dialog = dialog.set_parent(&window);
        }
        let Some(path) = dialog
            .blocking_pick_folder()
            .and_then(|picked| picked.into_path().ok())
        else {
            return;
        };
        if new_window {
            windows::open_folder(&app, &path);
            return;
        }
        let body = serde_json::json!({ "path": path.to_string_lossy() }).to_string();
        let outcome = http::request(
            port,
            "POST",
            "/api/sites/open",
            &token,
            Some(&body),
            Duration::from_secs(120),
        )
        .and_then(|response| Ok((response.ok(), response.json()?)));

        match outcome {
            Ok((true, site)) => match site["id"].as_str() {
                Some(id) => shell::navigate(&app, &format!("/sites/{}", encode_segment(id))),
                None => tell(&app, "The server didn't say which site it opened.".into()),
            },
            Ok((false, error)) => tell(
                &app,
                error["error"]["message"]
                    .as_str()
                    .unwrap_or("The server refused it.")
                    .to_string(),
            ),
            Err(detail) => tell(&app, format!("The app couldn't reach its server: {detail}")),
        }
    });
}

fn tell(app: &AppHandle, message: String) {
    app.dialog()
        .message(message)
        .title("Couldn't open that folder")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

/// Help links: the deployment's brand (from `/api/meta`) first, then the built-in default.
fn open_brand_link(app: AppHandle, key: &'static str, fallback: &'static str) {
    thread::spawn(move || {
        let from_brand = shell::shell(&app).connection().and_then(|(port, token)| {
            let meta = http::request(
                port,
                "GET",
                "/api/meta",
                &token,
                None,
                Duration::from_secs(3),
            )
            .ok()?
            .json()
            .ok()?;
            meta["brand"][key].as_str().map(str::to_string)
        });
        let url = from_brand
            .and_then(|url| nav::validate_external_url(&url).ok())
            .or_else(|| nav::validate_external_url(fallback).ok());

        if let Some(url) = url {
            let _ = app.opener().open_url(url.as_str(), None::<&str>);
        }
    });
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn cleared_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("recent-cleared"))
}

fn cleared_at(app: &AppHandle) -> u64 {
    cleared_file(app)
        .and_then(|file| std::fs::read_to_string(file).ok())
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(0)
}

fn save_cleared_at(app: &AppHandle, at: u64) {
    if let Some(file) = cleared_file(app) {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(file, at.to_string());
    }
}

static REFRESH_SCHEDULED: AtomicBool = AtomicBool::new(false);

/// Rebuilds the menu (and the Dock menu) a moment from now, with the current
/// recent sites and windows. Calls while one is pending are folded into it.
pub fn refresh_soon(app: &AppHandle) {
    if REFRESH_SCHEDULED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(400));
        REFRESH_SCHEDULED.store(false, Ordering::SeqCst);
        if shell::shell(&app).is_quitting() {
            return;
        }
        let recent = shell::shell(&app)
            .connection()
            .and_then(|(port, token)| http::request(port, "GET", "/api/sites", &token, None, Duration::from_secs(5)).ok())
            .and_then(|response| response.json().ok())
            .map(|sites| recent_sites(&sites, cleared_at(&app)))
            .unwrap_or_default();
        let windows = windows::app_windows(&app)
            .iter()
            .map(|window| (window.label().to_string(), window.title().unwrap_or_default()))
            .collect();
        let state = MenuState { recent, windows };
        let handle = app.clone();

        let _ = app.run_on_main_thread(move || {
            if let Ok(menu) = build(&handle, &state) {
                let _ = handle.set_menu(menu);
            }
            #[cfg(target_os = "macos")]
            crate::dock::set_recent(&handle, &state.recent);
        });
    });
}

/// Percent-encodes one path segment (site ids are short slugs, but don't assume).
pub fn encode_segment(segment: &str) -> String {
    segment
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_sites_are_the_newest_opened_since_clear_and_never_a_missing_one() {
        let sites = serde_json::json!([
            { "id": "aaa", "name": "Old", "lastOpenedAt": 100 },
            { "id": "bbb", "name": "New", "lastOpenedAt": 300 },
            { "id": "ccc", "name": "Never", "lastOpenedAt": 0 },
            { "id": "ddd", "name": "Gone", "lastOpenedAt": 400, "missing": true },
            { "id": "../x", "name": "Bad", "lastOpenedAt": 500 },
            { "id": "eee", "name": "Middle", "lastOpenedAt": 200 }
        ]);
        assert_eq!(
            recent_sites(&sites, 0),
            vec![
                ("bbb".to_string(), "New".to_string()),
                ("eee".to_string(), "Middle".to_string()),
                ("aaa".to_string(), "Old".to_string())
            ]
        );
        assert_eq!(recent_sites(&sites, 150), vec![("bbb".to_string(), "New".to_string()), ("eee".to_string(), "Middle".to_string())]);
        assert!(recent_sites(&serde_json::json!({}), 0).is_empty());
    }

    #[test]
    fn encodes_site_ids_for_the_path() {
        assert_eq!(encode_segment("my-site_1"), "my-site_1");
        assert_eq!(encode_segment("a/b c?"), "a%2Fb%20c%3F");
    }
}
