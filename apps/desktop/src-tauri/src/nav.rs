//! What the main window may load, and validation for every argument the web
//! UI can send to the shell.
//!
//! The main window shows a page served over http:// from our own loopback
//! port, which Tauri treats as a remote origin. Three layers keep it there:
//!
//! 1. `allow_navigation` (every frame): only web pages, `about:blank`/`srcdoc`,
//!    and `blob:`/`data:` frames load at all; `file:`, custom schemes and the
//!    rest are refused. On macOS this hook fires for iframes too and can't tell
//!    them apart from the main frame, so it can't be stricter without breaking
//!    the preview (another loopback port) and whatever the previewed site
//!    embeds (a video, a map).
//! 2. The bridge script (main frame only) sends clicks on links that leave
//!    the app to the default browser, and `window.open` goes through
//!    `on_new_window`, which always opens outside.
//! 3. `main_frame_left_app` (page-load events, which are main-frame only): if
//!    the top-level page still ends up somewhere else, the shell takes it
//!    back to the app and opens that address in the browser.
//!
//! None of this is what keeps the shell's commands safe: the capability that
//! grants them names exactly `http://127.0.0.1:<port>`, and Tauri checks the
//! calling frame's origin on every call, so a page anywhere else — a preview
//! frame included — gets no native access at all.

use std::path::{Path, PathBuf};
use url::Url;

pub const MAX_URL_LENGTH: usize = 8192;
pub const MAX_PATH_LENGTH: usize = 4096;

pub fn app_origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// Whether `url` is a page of the app itself.
pub fn is_app_url(url: &Url, port: u16) -> bool {
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(port)
}

fn is_about_blank(url: &Url) -> bool {
    url.scheme() == "about" && matches!(url.path(), "blank" | "srcdoc")
}

/// Layer 1: may any frame of the main window load `url`?
pub fn allow_navigation(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "blob" | "data") || is_about_blank(url)
}

/// Layer 3: the top-level page committed to `url`. Some(address to open in
/// the browser, if any) when that is outside the app.
pub fn main_frame_left_app(url: &Url, port: u16) -> Option<Option<Url>> {
    if is_app_url(url, port) || is_about_blank(url) {
        return None;
    }
    Some(validate_external_url(url.as_str()).ok())
}

/// `window.open` / `target="_blank"`: the address to hand to the browser, if any.
/// The app's own pages are not reopened in a browser (it would have no session there).
pub fn new_window_target(url: &Url, port: u16) -> Option<Url> {
    if is_app_url(url, port) {
        return None;
    }
    validate_external_url(url.as_str()).ok()
}

/// `openExternal(url)`: http and https only, with a host, without credentials.
pub fn validate_external_url(input: &str) -> Result<Url, String> {
    if input.len() > MAX_URL_LENGTH {
        return Err("That address is too long to open.".into());
    }
    let url = Url::parse(input.trim()).map_err(|_| "That isn't a web address.".to_string())?;

    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!(
            "Only web addresses (http or https) can be opened, not {}:.",
            url.scheme()
        ));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("That web address has no host.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Web addresses with a user name or password in them aren't opened.".into());
    }
    Ok(url)
}

/// The shape checks for `revealInFinder(path)`, before asking the server
/// which folders are sites: absolute, plain, not absurdly long.
pub fn validate_reveal_path(input: &str) -> Result<PathBuf, String> {
    if input.is_empty() || input.len() > MAX_PATH_LENGTH || input.contains('\0') {
        return Err("That isn't a folder path.".into());
    }
    let path = Path::new(input);

    if !path.is_absolute() {
        return Err("Only a full folder path can be shown.".into());
    }
    // Checked on the text: Path::components() quietly drops "." segments.
    if input
        .split(['/', '\\'])
        .any(|segment| segment == "." || segment == "..")
    {
        return Err("Only a plain folder path can be shown.".into());
    }
    Ok(path.to_path_buf())
}

/// `path` is one of the server's site roots (compared after resolving links,
/// so neither side can be dressed up as the other).
pub fn is_site_root(path: &Path, roots: &[String]) -> Option<PathBuf> {
    let wanted = std::fs::canonicalize(path).ok()?;

    roots
        .iter()
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .find(|root| *root == wanted)
}

/// The query flag the web UI adds to one of its own site pages to ask for a
/// window of its own (`window.open("/sites/<id>?galley-window=new")`).
pub const NEW_WINDOW_FLAG: &str = "galley-window";
/// URL scheme of links that open a folder as a site: `<slug>://open?path=…`
/// (the product's slug, from brand.ts; Info.plist registers the same one).
pub const OPEN_SCHEME: &str = crate::brand::SLUG;

/// The site id at the start of an app path: "/sites/<id>" or "/sites/<id>/…".
/// Site ids are short hex digests; anything else is refused.
pub fn site_id_of_path(path: &str) -> Option<&str> {
    let rest = path.strip_prefix("/sites/")?;
    let id = rest.split('/').next()?;
    let valid = !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    valid.then_some(id)
}

/// `window.open` of one of the app's own site pages carrying
/// `galley-window=new`: the path and query to show in a window of its own
/// (the flag and any token dropped). Anything else — another origin, another
/// page of the app, an id that isn't one — is None, and nothing is opened.
pub fn site_window_request(url: &Url, port: u16) -> Option<String> {
    if !is_app_url(url, port) || !url.username().is_empty() || url.fragment().is_some_and(|f| f.len() > 2048) {
        return None;
    }
    if !url
        .query_pairs()
        .any(|(key, value)| key == NEW_WINDOW_FLAG && value == "new")
    {
        return None;
    }
    site_id_of_path(url.path())?;
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| key != NEW_WINDOW_FLAG && key != "token")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    let mut path = url.path().to_string();

    if !kept.is_empty() {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(kept)
            .finish();
        path.push('?');
        path.push_str(&query);
    }
    (path.len() <= MAX_URL_LENGTH).then_some(path)
}

/// A request to open a folder as a site that arrived from outside the app: a
/// `galley://open?path=/abs/folder` link, a folder dropped on the Dock icon
/// (`file:///abs/folder/`), or a folder path given on the command line. Only
/// its shape is checked here — absolute, plain, an existing folder; the
/// server then checks it exactly as it checks the folder picker's choice
/// (`POST /api/sites/open`), so nothing arriving this way gets further than a
/// folder chosen by hand would.
pub fn open_request(input: &str) -> Result<PathBuf, String> {
    if input.len() > MAX_URL_LENGTH {
        return Err("That request is too long.".into());
    }
    let candidate = if input.starts_with(&format!("{OPEN_SCHEME}:")) {
        let url = Url::parse(input).map_err(|_| "That link isn't one this app understands.".to_string())?;
        let action = url.host_str().unwrap_or_else(|| url.path().trim_start_matches('/'));

        if action != "open" {
            return Err("That link isn't one this app understands.".into());
        }
        url.query_pairs()
            .find(|(key, _)| key == "path")
            .map(|(_, value)| value.into_owned())
            .ok_or("That link doesn't name a folder.")?
    } else if input.starts_with("file:") {
        let url = Url::parse(input).map_err(|_| "That isn't a folder.".to_string())?;

        if url.host_str().is_some_and(|host| !host.is_empty() && host != "localhost") {
            return Err("Only folders on this computer can be opened.".into());
        }
        url.to_file_path()
            .map_err(|_| "That isn't a folder.".to_string())?
            .to_string_lossy()
            .trim_end_matches(['/', '\\'])
            .to_string()
    } else {
        input.to_string()
    };
    let path = validate_reveal_path(&candidate)?;

    if !std::fs::metadata(&path).is_ok_and(|info| info.is_dir()) {
        return Err("That folder doesn't exist.".into());
    }
    Ok(path)
}

/// Pulls `root` out of each item of `GET /api/sites`.
pub fn site_roots(sites: &serde_json::Value) -> Vec<String> {
    sites
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item["root"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_app_origin_is_exactly_our_port_on_127_0_0_1() {
        assert!(is_app_url(&u("http://127.0.0.1:4410/sites/abc?x=1"), 4410));
        assert!(!is_app_url(&u("http://127.0.0.1:4411/"), 4410));
        assert!(!is_app_url(&u("http://localhost:4410/"), 4410));
        assert!(!is_app_url(&u("https://127.0.0.1:4410/"), 4410));
        assert!(!is_app_url(&u("http://127.0.0.1/"), 80));
        assert_eq!(app_origin(4410), "http://127.0.0.1:4410");
    }

    #[test]
    fn frames_may_load_web_pages_and_blank_but_not_local_files_or_custom_schemes() {
        for ok in [
            "http://127.0.0.1:5123/",
            "https://www.youtube.com/embed/x",
            "about:blank",
            "about:srcdoc",
            "blob:http://127.0.0.1:4410/uuid",
            "data:text/html,hi",
        ] {
            assert!(allow_navigation(&u(ok)), "{ok}");
        }
        for no in [
            "file:///etc/passwd",
            "ftp://example.com/",
            "tauri://localhost/",
            "javascript:alert(1)",
            "about:config",
            "vscode://file/x",
            "mailto:a@b.c",
        ] {
            assert!(!allow_navigation(&u(no)), "{no}");
        }
    }

    #[test]
    fn the_top_level_page_is_pulled_back_when_it_leaves_the_app() {
        assert_eq!(
            main_frame_left_app(&u("http://127.0.0.1:4410/settings"), 4410),
            None
        );
        assert_eq!(main_frame_left_app(&u("about:blank"), 4410), None);
        assert_eq!(
            main_frame_left_app(&u("https://example.com/docs"), 4410),
            Some(Some(u("https://example.com/docs")))
        );
        assert_eq!(
            main_frame_left_app(&u("http://127.0.0.1:5123/"), 4410),
            Some(Some(u("http://127.0.0.1:5123/")))
        );
        assert_eq!(
            main_frame_left_app(&u("data:text/html,hi"), 4410),
            Some(None)
        );
    }

    #[test]
    fn new_windows_open_outside_except_the_apps_own_pages() {
        assert_eq!(
            new_window_target(&u("https://example.com/"), 4410),
            Some(u("https://example.com/"))
        );
        assert_eq!(
            new_window_target(&u("http://127.0.0.1:4410/new"), 4410),
            None
        );
        assert_eq!(new_window_target(&u("file:///Users/x"), 4410), None);
    }

    #[test]
    fn external_urls_are_web_addresses_only() {
        assert!(validate_external_url("https://docs.example.com/a?b#c").is_ok());
        assert!(validate_external_url("  http://example.com  ").is_ok());
        for bad in [
            "",
            "example.com",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "mailto:x@y.z",
            "https://user:pw@example.com/",
            "http://",
            "vbscript:x",
            "ftp://example.com",
        ] {
            assert!(validate_external_url(bad).is_err(), "{bad}");
        }
        assert!(validate_external_url(&format!(
            "https://example.com/{}",
            "a".repeat(MAX_URL_LENGTH)
        ))
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn reveal_paths_must_be_plain_and_absolute() {
        assert!(validate_reveal_path("/Users/me/sites/blog").is_ok());
        for bad in [
            "",
            "relative/site",
            "/Users/me/../../etc",
            "/Users/./me",
            "/tmp/a\0b",
        ] {
            assert!(validate_reveal_path(bad).is_err(), "{bad:?}");
        }
        assert!(validate_reveal_path(&format!("/{}", "a".repeat(MAX_PATH_LENGTH))).is_err());
    }

    #[test]
    fn site_windows_are_asked_for_only_by_the_apps_own_site_pages() {
        assert_eq!(
            site_window_request(&u("http://127.0.0.1:4410/sites/a1b2c3d4e5f6?galley-window=new"), 4410),
            Some("/sites/a1b2c3d4e5f6".into())
        );
        assert_eq!(
            site_window_request(
                &u("http://127.0.0.1:4410/sites/a1b2/edit?path=src%2Fx.md&galley-window=new&token=zzz"),
                4410
            ),
            Some("/sites/a1b2/edit?path=src%2Fx.md".into())
        );
        for no in [
            "http://127.0.0.1:4410/sites/a1b2",
            "http://127.0.0.1:4410/settings?galley-window=new",
            "http://127.0.0.1:4410/?galley-window=new",
            "http://127.0.0.1:4411/sites/a1b2?galley-window=new",
            "https://example.com/sites/a1b2?galley-window=new",
            "http://127.0.0.1:4410/sites/..%2Fetc?galley-window=new",
            "http://127.0.0.1:4410/sites/a%20b?galley-window=new",
            "http://127.0.0.1:4410/sites/a1b2?galley-window=yes",
        ] {
            assert_eq!(site_window_request(&u(no), 4410), None, "{no}");
        }
        assert_eq!(site_id_of_path("/sites/abc123/proof"), Some("abc123"));
        assert_eq!(site_id_of_path("/sites/"), None);
        assert_eq!(site_id_of_path("/site/abc"), None);
    }

    #[cfg(unix)]
    #[test]
    fn folders_arriving_from_outside_are_checked_like_a_picked_folder() {
        let base = std::env::temp_dir().join(format!("desktop-open-test-{}", std::process::id()));
        let site = base.join("my site");
        std::fs::create_dir_all(&site).unwrap();
        let shown = site.to_string_lossy().into_owned();
        let encoded = url::form_urlencoded::byte_serialize(shown.as_bytes()).collect::<String>();

        assert_eq!(open_request(&shown).unwrap(), site);
        assert_eq!(open_request(&format!("galley://open?path={encoded}")).unwrap(), site);
        assert_eq!(open_request(Url::from_directory_path(&site).unwrap().as_str()).unwrap(), site);
        for bad in [
            "galley://delete?path=/tmp".to_string(),
            "galley://open".to_string(),
            "galley://open?path=relative/folder".to_string(),
            format!("galley://open?path={encoded}%2F..%2F.."),
            "file://server/share/folder".to_string(),
            "relative/folder".to_string(),
            base.join("missing").to_string_lossy().into_owned(),
            "/tmp/a\0b".to_string(),
        ] {
            assert!(open_request(&bad).is_err(), "{bad}");
        }
        let file = base.join("file.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(open_request(&file.to_string_lossy()).is_err(), "a file is not a folder");
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn only_a_reported_site_root_can_be_revealed() {
        let base = std::env::temp_dir().join(format!("desktop-reveal-test-{}", std::process::id()));
        let site = base.join("site");
        let inside = site.join("src");
        std::fs::create_dir_all(&inside).unwrap();
        let sites =
            serde_json::json!([{ "id": "a", "root": site.to_string_lossy() }, { "id": "b" }]);
        let roots = site_roots(&sites);
        assert_eq!(roots.len(), 1);
        assert!(is_site_root(&site, &roots).is_some());
        assert!(is_site_root(&inside, &roots).is_none());
        assert!(is_site_root(&base, &roots).is_none());
        assert!(is_site_root(&base.join("missing"), &roots).is_none());
        #[cfg(unix)]
        {
            let link = base.join("link-to-site");
            std::os::unix::fs::symlink(&site, &link).unwrap();
            assert!(
                is_site_root(&link, &roots).is_some(),
                "a link to a site is that site"
            );
        }
        std::fs::remove_dir_all(base).unwrap();
    }
}
