//! What the shell adds to the page: `window.__GALLEY_DESKTOP__`, and the
//! commands behind it. Plus the commands of the start-up window.
//!
//! The UI is served from `http://127.0.0.1:<port>`, a remote origin to
//! Tauri. Once the server is up, `grant_app_origin` adds a capability for
//! exactly that origin and one window label, allowing exactly
//! `pick_folder`, `open_external` and `reveal_in_finder`. Every app window
//! (the main one and each site's own) gets its own capability, made the same
//! way just before the window is built — so a window has those three commands
//! and nothing more, and a label that was never granted has none at all. No plugin command
//! is granted to it: the dialog and the opener are used from Rust only. Every
//! argument is checked again here, because the page is the less trusted side.

use crate::{http, nav, shell};
use std::time::Duration;
use tauri::{ipc::CapabilityBuilder, AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// The commands the main window's page may call.
pub const APP_ORIGIN_COMMANDS: [&str; 3] = [
    "allow-pick-folder",
    "allow-open-external",
    "allow-reveal-in-finder",
];

/// The capability identifier for one window: unique per port and label.
pub fn capability_id(port: u16, label: &str) -> String {
    format!("app-origin-{port}-{label}")
}

pub fn grant_app_origin(app: &AppHandle, port: u16, label: &str) -> tauri::Result<()> {
    let mut capability = CapabilityBuilder::new(capability_id(port, label))
        .remote(format!("{}/*", nav::app_origin(port)))
        .local(false)
        .window(label);

    for permission in APP_ORIGIN_COMMANDS {
        capability = capability.permission(permission);
    }
    app.add_capability(capability)
}

/// Runs in the main window's top frame before the page's own scripts. It
/// stays inert anywhere but the app's origin.
pub fn script(port: u16, version: &str) -> String {
    include_str!("bridge.js")
        .replace(
            "__APP_ORIGIN__",
            &serde_json::to_string(&nav::app_origin(port)).unwrap(),
        )
        .replace("__APP_VERSION__", &serde_json::to_string(version).unwrap())
}

// ─────────────────────────────────────────────── the main window's commands

/// Native folder picker. `null` when the person cancels.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().set_title("Open a site");

    if let Some(window) = shell::focused_app_window(&app) {
        dialog = dialog.set_parent(&window);
    }
    if let Some(home) = crate::env_path::home_dir() {
        dialog = dialog.set_directory(home);
    }
    match dialog.blocking_pick_folder() {
        None => Ok(None),
        Some(picked) => picked
            .into_path()
            .map(|path| Some(path.to_string_lossy().into_owned()))
            .map_err(|e| e.to_string()),
    }
}

/// Opens a web address in the default browser. http and https only.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let url = nav::validate_external_url(&url)?;

    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Shows a site's folder in Finder (Explorer, the file manager). Only a
/// folder the server lists as a site's root.
#[tauri::command]
pub async fn reveal_in_finder(app: AppHandle, path: String) -> Result<(), String> {
    let wanted = nav::validate_reveal_path(&path)?;
    let (port, token) = shell::shell(&app)
        .connection()
        .ok_or("The app isn't connected to its server.")?;
    let response = http::request(
        port,
        "GET",
        "/api/sites",
        &token,
        None,
        Duration::from_secs(5),
    )
    .map_err(|e| format!("Couldn't ask the server for its sites: {e}"))?;

    if !response.ok() {
        return Err(format!(
            "Couldn't ask the server for its sites (HTTP {}).",
            response.status
        ));
    }
    let roots = nav::site_roots(&response.json()?);
    let root =
        nav::is_site_root(&wanted, &roots).ok_or("Only a site's own folder can be shown.")?;

    app.opener()
        .reveal_item_in_dir(root)
        .map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────── the start-up window's commands

#[tauri::command]
pub fn startup_state(app: AppHandle) -> shell::StartupView {
    shell::shell(&app).view()
}

/// Try again: re-reads PATH (the person may just have installed something) and starts over.
#[tauri::command]
pub fn startup_retry(app: AppHandle) {
    shell::begin(app, true);
}

#[tauri::command]
pub fn startup_continue(app: AppHandle) {
    shell::continue_without_tools(app);
}

#[tauri::command]
pub fn startup_quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_script_carries_the_origin_and_version_as_json_literals() {
        let js = script(4410, "0.1.0");
        assert!(js.contains(r#"var APP_ORIGIN = "http://127.0.0.1:4410";"#));
        assert!(js.contains(r#"var VERSION = "0.1.0";"#));
        assert!(!js.contains("__APP_ORIGIN__") && !js.contains("__APP_VERSION__"));
    }

    #[test]
    fn a_hostile_version_string_cant_break_out_of_the_literal() {
        let js = script(4410, "1\";alert(1);//");
        assert!(js.contains(r#"var VERSION = "1\";alert(1);//";"#));
    }

    #[test]
    fn each_window_gets_a_capability_of_its_own() {
        assert_eq!(capability_id(4410, "main"), "app-origin-4410-main");
        assert_eq!(capability_id(4410, "site-a1b2"), "app-origin-4410-site-a1b2");
    }

    #[test]
    fn the_page_is_granted_exactly_three_commands() {
        assert_eq!(
            APP_ORIGIN_COMMANDS,
            [
                "allow-pick-folder",
                "allow-open-external",
                "allow-reveal-in-finder"
            ]
        );
    }
}
