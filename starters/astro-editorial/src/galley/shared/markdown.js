// Vendored from @galley/astro 0.4.3 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The little Markdown a form's texts may use — **bold**, *italic*, `code`
// and [links](https://…) — rendered to escaped HTML. Nothing else is
// interpreted: no raw HTML, no images, no headings.
//
// `{{field}}` placeholders become `<span data-galley-value="field"></span>`;
// the browser fills them with the visitor's answer as plain text after a
// submission. They are never filled inside a link address, so an answer can
// never become a link.

const ESCAPES = /** @type {Record<string, string>} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });

/** @param {string} text */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_-]*)\s*\}\}/g;

/** Escaped text with `{{field}}` placeholders turned into fill-in spans. */
function text(/** @type {string} */ raw) {
  return escapeHtml(raw).replace(PLACEHOLDER, (_, id) => `<span data-galley-value="${id}"></span>`);
}

/**
 * Only addresses that go somewhere ordinary: http(s), mail, phone, or a path
 * or anchor on this site. Anything else (javascript:, data:) becomes "#".
 *
 * @param {string} url
 */
export function safeUrl(url) {
  const value = url.trim();

  if (/^(https?:|mailto:|tel:)/i.test(value) || /^[/#?.]/.test(value)) return value;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return "#";
}

/**
 * A site-root address ("/privacy/") under the site's base path ("/docs" →
 * "/docs/privacy/"), so links written from the site root keep working in a
 * sub-path build. Full addresses, protocol-relative ones, anchors and
 * addresses already under the base are left as they are.
 *
 * @param {string} url
 * @param {string} [base]  e.g. "/docs" or "/docs/"; "" or "/" for none.
 */
export function withBase(url, base = "") {
  const prefix = base.replace(/\/+$/, "");

  if (!prefix || !url.startsWith("/") || url.startsWith("//") || url === prefix || url.startsWith(`${prefix}/`)) return url;
  return `${prefix}${url}`;
}

/** @typedef {{ base?: string }} MarkdownOptions */

const INLINE = /\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * One line (or a few) of inline Markdown as HTML.
 *
 * @param {string} source
 * @param {MarkdownOptions} [options]  `base`: the site's base path, for links written from the site root.
 * @returns {string}
 */
export function inlineMarkdown(source, options = {}) {
  let out = "";
  let last = 0;

  for (const match of String(source).matchAll(INLINE)) {
    out += text(source.slice(last, match.index));
    const [, bold, italic, code, label, href] = match;

    if (bold !== undefined) out += `<strong>${inlineMarkdown(bold, options)}</strong>`;
    else if (italic !== undefined) out += `<em>${inlineMarkdown(italic, options)}</em>`;
    else if (code !== undefined) out += `<code>${escapeHtml(code)}</code>`;
    else if (label !== undefined && href !== undefined) {
      const url = withBase(safeUrl(href.replace(PLACEHOLDER, "")), options.base);
      const external = /^https?:/i.test(url);

      out += `<a href="${escapeHtml(url)}"${external ? ' rel="noopener"' : ""}>${inlineMarkdown(label, options)}</a>`;
    }
    last = (match.index ?? 0) + match[0].length;
  }
  return out + text(source.slice(last));
}

/**
 * Paragraphs of inline Markdown: blank lines separate paragraphs, single
 * line breaks are kept.
 *
 * @param {string} source
 * @param {MarkdownOptions} [options]
 * @returns {string}
 */
export function markdownParagraphs(source, options = {}) {
  return String(source)
    .trim()
    .split(/\n\s*\n/)
    .filter((part) => part.trim())
    .map((part) => `<p>${part.trim().split(/\n/).map((line) => inlineMarkdown(line, options)).join("<br>")}</p>`)
    .join("");
}

/**
 * The plain words of a Markdown text — for a consent text sent to a provider
 * that records what the visitor agreed to.
 *
 * @param {string} source
 */
export function plainText(source) {
  return String(source)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
