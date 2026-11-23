// No console window next to the app on Windows (release builds).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Debug-build diagnostics on stderr. Never `eprintln!`: it panics when
/// stderr is closed (the terminal that started the app went away), and a
/// panic in the signal or log threads would break quitting.
macro_rules! debug_log {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            use std::io::Write as _;
            let _ = writeln!(std::io::stderr(), $($arg)*);
        }
    };
}
pub(crate) use debug_log;

mod brand {
    include!(concat!(env!("OUT_DIR"), "/brand.rs"));
}
#[cfg(test)]
mod brand_source;
mod bridge;
#[cfg(target_os = "macos")]
mod dock;
mod env_path;
mod http;
mod menu;
mod nav;
mod net;
mod preflight;
mod procs;
#[cfg(debug_assertions)]
mod selftest;
mod server;
mod shell;
mod signals;
mod windows;

fn main() {
    signals::block();
    shell::run();
}

#[cfg(test)]
mod tests {
    use super::{brand, brand_source::parse_brand_source};

    #[test]
    fn the_generated_brand_matches_brand_ts() {
        let source = include_str!("../../../../packages/core/src/brand.ts");
        let parsed = parse_brand_source(source).unwrap();
        assert_eq!(parsed.name, brand::PRODUCT_NAME);
        assert_eq!(parsed.slug, brand::SLUG);
        assert_eq!(parsed.docs_url, brand::DOCS_URL);
        assert!(brand::ISSUES_URL.starts_with("https://"));
    }

    #[test]
    fn brand_parsing_reads_constants_and_skips_expressions() {
        let source = r#"
            export const PRODUCT = {
              name: "Quill",
              tagline: "Write \"it\".",
              descriptor: "A CMS",
              maker: "Someone",
              /** comment with { brace */
              slug: "quill",
            } as const;
            export const DEFAULT_BRAND: BrandConfig = {
              productName: PRODUCT.name,
              byline: `by ${PRODUCT.maker}`,
              docsUrl: "https://quill.example/docs",
            };
            export const VERSION = "2.0.1";
        "#;
        let parsed = parse_brand_source(source).unwrap();
        assert_eq!(parsed.name, "Quill");
        assert_eq!(parsed.tagline, "Write \"it\".");
        assert_eq!(parsed.slug, "quill");
        assert_eq!(parsed.docs_url, "https://quill.example/docs");
        assert_eq!(parsed.version, "2.0.1");
        assert!(parse_brand_source("export const PRODUCT = { name: NAME };").is_err());
    }
}
