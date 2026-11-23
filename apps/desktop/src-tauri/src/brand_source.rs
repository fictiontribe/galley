//! Reads the product's name and links out of `packages/core/src/brand.ts`.
//!
//! Compiled twice: by `build.rs` (which writes the result into `brand.rs` in
//! OUT_DIR) and into the app's unit tests. The file is TypeScript, so this
//! reads only what it needs — plain `key: "string"` pairs inside the two
//! exported objects and the `VERSION` constant — and fails loudly when they
//! aren't there, rather than guessing. A template literal is read only when
//! every `${…}` in it names a top-level `export const NAME = "string"`
//! (`docsUrl: \`${SITE_URL}/docs\``); anything else in one is an expression
//! and is refused.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrandSource {
    pub name: String,
    pub tagline: String,
    pub descriptor: String,
    pub maker: String,
    pub slug: String,
    pub docs_url: String,
    pub version: String,
}

/// The `{ … }` body after `export const <name>` (to its matching brace),
/// skipping braces inside strings and comments.
fn object_body<'a>(source: &'a str, name: &str) -> Option<&'a str> {
    let marker = format!("export const {name}");
    let start = source.find(&marker)?;
    let open = start + source[start..].find('{')?;
    let bytes = source.as_bytes();
    let mut depth = 0usize;
    let mut i = open;

    while i < bytes.len() {
        match bytes[i] {
            b'"' | b'\'' | b'`' => {
                let quote = bytes[i];
                i += 1;
                while i < bytes.len() && bytes[i] != quote {
                    i += if bytes[i] == b'\\' { 2 } else { 1 };
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i += 1;
            }
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&source[open + 1..i]);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// `export const NAME = "value";` at the top level of the file.
fn string_constant(source: &str, name: &str) -> Option<String> {
    let marker = format!("export const {name} = \"");
    let open = source.find(&marker)? + marker.len();
    let close = open + source[open..].find('"')?;

    Some(source[open..close].to_string())
}

/// A template literal's text with each `${NAME}` replaced by that string constant.
fn template(text: &str, source: &str) -> Option<String> {
    let mut out = String::new();
    let mut rest = text;

    while let Some(at) = rest.find("${") {
        out.push_str(&rest[..at]);
        let after = &rest[at + 2..];
        let end = after.find('}')?;
        let name = &after[..end];

        if name.is_empty() || !name.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_') {
            return None;
        }
        out.push_str(&string_constant(source, name)?);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

/// The string value of `key:` in an object body: double-quoted, or a template
/// literal of string constants only. Other expressions are skipped on
/// purpose: they aren't constants.
fn string_field_in(body: &str, key: &str, source: &str) -> Option<String> {
    for line in body.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix(key).and_then(|rest| rest.trim_start().strip_prefix(':')) else {
            continue;
        };
        if let Some(text) = rest.trim_start().strip_prefix('`') {
            let close = text.find('`')?;

            return template(&text[..close], source);
        }
    }
    string_field(body, key)
}

/// The double-quoted string value of `key:` in an object body.
fn string_field(body: &str, key: &str) -> Option<String> {
    for line in body.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix(key) else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix(':') else {
            continue;
        };
        let rest = rest.trim_start();
        let Some(rest) = rest.strip_prefix('"') else {
            continue;
        };
        let mut value = String::new();
        let mut chars = rest.chars();

        while let Some(ch) = chars.next() {
            match ch {
                '\\' => value.push(chars.next()?),
                '"' => return Some(value),
                _ => value.push(ch),
            }
        }
    }
    None
}

fn version_constant(source: &str) -> Option<String> {
    let start = source.find("export const VERSION")?;
    let rest = &source[start..];
    let open = rest.find('"')? + 1;
    let close = open + rest[open..].find('"')?;

    Some(rest[open..close].to_string())
}

pub fn parse_brand_source(source: &str) -> Result<BrandSource, String> {
    let product = object_body(source, "PRODUCT").ok_or("no `export const PRODUCT = { … }`")?;
    let brand =
        object_body(source, "DEFAULT_BRAND").ok_or("no `export const DEFAULT_BRAND = { … }`")?;
    let need = |body: &str, key: &str| {
        string_field(body, key).ok_or(format!("no string `{key}` in brand.ts"))
    };

    Ok(BrandSource {
        name: need(product, "name")?,
        tagline: need(product, "tagline")?,
        descriptor: need(product, "descriptor")?,
        maker: need(product, "maker")?,
        slug: need(product, "slug")?,
        docs_url: string_field_in(brand, "docsUrl", source).ok_or("no string `docsUrl` in brand.ts")?,
        version: version_constant(source).ok_or("no `export const VERSION = \"…\"`")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_literals_of_string_constants_are_read_and_expressions_are_not() {
        let source = r#"
            export const SITE_URL = "https://example.test";
            export const PRODUCT = {
              name: "Quill",
              tagline: "T",
              descriptor: "D",
              maker: "M",
              slug: "quill",
            } as const;
            export const DEFAULT_BRAND = {
              byline: `by ${PRODUCT.maker}`,
              docsUrl: `${SITE_URL}/docs`,
            };
            export const VERSION = "1.0.0";
        "#;
        assert_eq!(parse_brand_source(source).unwrap().docs_url, "https://example.test/docs");
        assert!(template("${PRODUCT.maker}", source).is_none());
        assert!(template("${MISSING}/x", source).is_none());
        assert_eq!(template("plain", source).as_deref(), Some("plain"));
    }
}
