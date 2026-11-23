/**
 * The assistant's replies as HTML: Markdown with raw HTML escaped, images
 * shown as their description, and only web and mail links kept — each opening
 * in a new tab without a window reference. The result is sanitised again
 * before it reaches the page (Markdown.tsx).
 */
import { Marked } from "marked";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

/** An absolute http(s) or mailto address, or null. Site-relative links would open this app, not the site. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

const markdown = new Marked({ gfm: true, breaks: true, async: false });
markdown.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    image({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safe = safeHref(href);
      if (!safe) return label;
      const titled = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(safe)}"${titled} target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
  },
});

export function renderMarkdown(text: string): string {
  return markdown.parse(text, { async: false });
}
