// Vendored from @galley/astro 0.4.3 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// A rendered page → the markdown an AI agent reads: the page's main content
// as visitors see it, however it was authored (content collections, section
// blocks, hand-written Astro), with every address made absolute and nothing
// that only works in a browser — no navigation, scripts, styles, forms,
// cookie banner or tracking.
//
// What counts as the main content, in order:
//   1. an element marked data-galley-agent="main";
//   2. <main> (or role="main");
//   3. the only <article>;
//   4. <body> without its header, footer, nav and aside.
// Inside it, anything marked data-galley-agent="skip", hidden, aria-hidden or
// inert is left out; elements outside it marked data-galley-agent="include"
// are added at the end, in page order.
//
// The same tree always gives the same bytes.

import { find, findAll, textOf } from "./html.js";

/** @typedef {import("./html.js").Element} Element */
/** @typedef {import("./html.js").Node} Node */

/** Elements whose content is never part of the twin. */
const DROP = new Set([
  "script", "style", "noscript", "template", "svg", "math", "canvas", "object", "embed", "form", "button", "input", "select",
  "textarea", "option", "datalist", "nav", "dialog", "link", "meta", "head", "title", "map", "area", "slot", "progress", "meter",
]);
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "body", "dd", "details", "div", "dl", "dt", "fieldset", "figcaption", "figure",
  "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main", "ol", "p", "pre", "section", "summary",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul", "menu", "iframe", "video", "audio", "caption", "search", "center",
]);
const BREAK = "\u0000";

/**
 * @typedef {object} Context
 * @property {string} base  The page's absolute address, for resolving links.
 * @property {string} page  The page's own address without its fragment.
 */

/** @param {Element} el */
export function isSkipped(el) {
  if (DROP.has(el.name)) return true;
  const attrs = el.attrs;

  if ("hidden" in attrs || "inert" in attrs || attrs["aria-hidden"] === "true") return true;
  if (attrs["data-galley-agent"] === "skip") return true;
  if (attrs.role === "navigation" || attrs.role === "search" || attrs.role === "dialog" || attrs.role === "alertdialog") return true;
  // The kit's own pieces that only mean something in a browser.
  if ("data-galley-consent" in attrs || "data-galley-form" in attrs || "data-galley-mailto" in attrs) return true;
  return false;
}

/**
 * The element whose content is the page's main content, and the extra
 * elements marked to be included.
 *
 * @param {Element} doc
 * @returns {{ root: Element | null; extra: Element[]; whole: boolean }}
 */
export function mainContent(doc) {
  const body = find(doc, (el) => el.name === "body") ?? doc;
  const marked = find(body, (el) => el.attrs["data-galley-agent"] === "main");
  /** @type {Element | null} */
  let root = marked ?? find(body, (el) => el.name === "main") ?? find(body, (el) => el.attrs.role === "main");
  let whole = false;

  if (!root) {
    const all = findAll(body, (el) => el.name === "article");
    const top = all.filter((el) => !all.some((other) => other !== el && contains(other, el)));

    if (top.length === 1) root = top[0] ?? null;
  }
  if (!root) {
    // No main region: the body, without the site's header, footer and sidebars.
    root = { ...body, children: body.children.filter((child) => !(child.type === "element" && (child.name === "header" || child.name === "footer" || child.name === "aside"))) };
    whole = true;
  }
  const chosen = root;
  const extra = whole ? [] : findAll(body, (el) => el.attrs["data-galley-agent"] === "include" && !contains(chosen, el), (el) => el === chosen);

  return { root, extra, whole };
}

/** @param {Element} outer @param {Element} inner */
function contains(outer, inner) {
  for (let at = inner.parent; at; at = at.parent) if (at === outer) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────── escaping

/** Text as markdown text: the characters markdown would read as syntax are escaped. */
export function escapeText(/** @type {string} */ text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/[`*[\]]/g, (char) => `\\${char}`)
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (match) => match.replace("_", "\\_"))
    .replace(/<(?=[a-zA-Z/!?])/g, "\\<")
    .replace(/&(?=#?[a-zA-Z0-9]+;)/g, "\\&");
}

/** A paragraph's first characters that would start a heading, quote or list. */
function escapeStart(/** @type {string} */ line) {
  return line
    .replace(/^(#{1,6})(?=\s|$)/, "\\$1")
    .replace(/^>/, "\\>")
    .replace(/^([-+])(?=\s)/, "\\$1")
    .replace(/^(\d+)([.)])(?=\s)/, "$1\\$2")
    .replace(/^([-=])\1*$/, (match) => `\\${match}`);
}

/** A link or image address that markdown reads in one piece. */
function destination(/** @type {string} */ url) {
  return url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/</g, "%3C").replace(/>/g, "%3E");
}

/** @param {string} href @param {Context} ctx @returns {string | null} */
function absolute(href, ctx) {
  const value = href.trim();

  if (!value || /^(javascript|data|vbscript):/i.test(value)) return null;
  try {
    const url = new URL(value, ctx.base);

    if (!/^(https?|mailto|tel|ftp):$/.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────── inline

/** @param {Element} el @returns {boolean} */
function hasBlock(el) {
  return el.children.some((child) => child.type === "element" && !isSkipped(child) && (BLOCK.has(child.name) || hasBlock(child)));
}

/**
 * The inline markdown of a node's children (one line; hard breaks marked).
 *
 * @param {Node} node
 * @param {Context} ctx
 * @returns {string}
 */
function inline(node, ctx) {
  if (node.type === "text") return escapeText(node.value);
  if (isSkipped(node)) return "";
  const inner = () => joinInline(node.children, ctx);

  switch (node.name) {
    case "br":
      return BREAK;
    case "wbr":
      return "";
    case "strong":
    case "b": {
      const text = inner();

      return text.trim() ? wrap(text, "**") : text;
    }
    case "em":
    case "i":
    case "cite": {
      const text = inner();

      return text.trim() ? wrap(text, "*") : text;
    }
    case "del":
    case "s": {
      const text = inner();

      return text.trim() ? wrap(text, "~~") : text;
    }
    case "code":
    case "kbd":
    case "samp":
      return codeSpan(textOf(node));
    case "img":
      return image(node, ctx);
    case "a":
      return link(node, inner(), ctx);
    case "picture": {
      const img = find(node, (el) => el.name === "img");

      return img ? image(img, ctx) : "";
    }
    default:
      return inner();
  }
}

/**
 * Inline children joined. Two elements side by side with no text between
 * them (a row of links, "By <a>…</a><time>…</time>") are usually set apart
 * by the page's layout, not by a space in the HTML: they get a space here so
 * their words don't run together.
 *
 * @param {Node[]} children
 * @param {Context} ctx
 */
function joinInline(children, ctx) {
  let out = "";
  let lastElement = false;
  let gap = false;

  for (const child of children) {
    // A left-out element between two words (an aria-hidden "·") stood for a gap.
    if (child.type === "element" && isSkipped(child)) {
      gap = true;
      continue;
    }
    const part = inline(child, ctx);

    if (!part) continue;
    const element = child.type === "element";
    // Text only screen readers hear ("Published") stands apart from its neighbours.
    const hiddenLabel = element && /(^|\s)(visually-hidden|sr-only|screen-reader-text|galley-visually-hidden)(\s|$)/.test(child.attrs.class ?? "");

    if (hiddenLabel) gap = true;
    if ((gap || (element && lastElement)) && out && !/[\s\u0000]$/.test(out) && !/^[\s\u0000.,;:!?)\]]/.test(part) && !/[([]$/.test(out)) out += " ";
    out += part;
    lastElement = element;
    gap = hiddenLabel;
  }
  return out;
}

/** `**text**` with the spaces kept outside the markers, as markdown needs. */
function wrap(/** @type {string} */ text, /** @type {string} */ marker) {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const trail = /\s*$/.exec(text)?.[0] ?? "";

  return `${lead}${marker}${text.trim()}${marker}${trail}`;
}

function codeSpan(/** @type {string} */ text) {
  if (!text) return "";
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = longest > 0 || text.startsWith("`") || text.endsWith("`") ? " " : "";

  return `${fence}${pad}${text}${pad}${fence}`;
}

/** @param {Element} el @param {Context} ctx */
function image(el, ctx) {
  const alt = (el.attrs.alt ?? "").replace(/\s+/g, " ").trim();
  const src = absolute(el.attrs.src ?? "", ctx);

  // An empty alt marks a decorative image: there is nothing to say about it.
  if (!alt || !src) return "";
  return `![${escapeText(alt)}](${destination(src)})`;
}

/** @param {Element} el @param {string} text @param {Context} ctx */
function link(el, text, ctx) {
  const href = el.attrs.href ?? "";
  const label = text.replace(new RegExp(BREAK, "g"), " ").trim() || escapeText((el.attrs["aria-label"] ?? el.attrs.title ?? "").trim());
  const url = absolute(href, ctx);

  if (!label) return "";
  // A link to a part of this same page means nothing outside it.
  if (!url || href.trim().startsWith("#") || url.split("#")[0] === ctx.page) return text;
  return `[${label}](${destination(url)})`;
}

// ─────────────────────────────────────────────────────────────── blocks

/**
 * @param {Element} el
 * @param {Context} ctx
 * @returns {string[]}
 */
function blocks(el, ctx) {
  /** @type {string[]} */
  const out = [];
  let run = "";
  /** @type {Node[]} */
  let pending = [];
  const flush = () => {
    run += joinInline(pending, ctx);
    pending = [];
    const text = finishInline(run);

    if (text) out.push(escapeStart(text));
    run = "";
  };

  for (const child of el.children) {
    if (child.type === "text" || isSkipped(child)) {
      pending.push(child);
      continue;
    }
    if (child.name === "a" && hasBlock(child)) {
      flush();
      out.push(...linkedBlocks(child, ctx));
      continue;
    }
    if (!BLOCK.has(child.name) && !hasBlock(child)) {
      pending.push(child);
      continue;
    }
    flush();
    out.push(...block(child, ctx));
  }
  flush();
  return out;
}

/** Inline text as one paragraph: whitespace collapsed, hard breaks kept inside it. */
function finishInline(/** @type {string} */ run) {
  return run
    .replace(/[ \t\r\n\f ]+/g, (space) => (space.includes(" ") && !/[\r\n]/.test(space) ? " " : " "))
    .replace(/ ?\u0000 ?/g, BREAK)
    .replace(/^[\s\u0000]+|[\s\u0000]+$/g, "")
    .replace(/\u0000+/g, "\\\n");
}

/**
 * A card-like link around headings and paragraphs: its blocks, with the
 * first heading (or else the first paragraph) carrying the link.
 *
 * @param {Element} el
 * @param {Context} ctx
 */
function linkedBlocks(el, ctx) {
  const inner = blocks(el, ctx);
  const url = absolute(el.attrs.href ?? "", ctx);

  if (!url || (el.attrs.href ?? "").startsWith("#")) return inner;
  const index = Math.max(0, inner.findIndex((text) => /^#{1,6} /.test(text)));
  const first = inner[index];

  if (first === undefined) return inner;
  const heading = /^(#{1,6} )(.*)$/s.exec(first);

  // Links can't hold links: a block that has its own stays as it is.
  if (first.includes("](")) return inner;
  if (heading) inner[index] = `${heading[1]}[${heading[2]}](${destination(url)})`;
  else if (!/^(!\[|\||```|>|-|\d+\.)/.test(first)) inner[index] = `[${first}](${destination(url)})`;
  return inner;
}

/**
 * @param {Element} el
 * @param {Context} ctx
 * @returns {string[]}
 */
function block(el, ctx) {
  const name = el.name;

  if (/^h[1-6]$/.test(name)) {
    const text = finishInline(joinInline(el.children, ctx)).replace(/\\\n/g, " ");

    return text ? [`${"#".repeat(Number(name[1]))} ${text}`] : [];
  }
  switch (name) {
    case "p":
    case "summary":
    case "dt":
    case "caption":
    case "figcaption": {
      if (hasBlock(el)) return blocks(el, ctx);
      const text = finishInline(joinInline(el.children, ctx));

      if (!text) return [];
      return [escapeStart(name === "summary" || name === "dt" ? (/^\*\*.*\*\*$/.test(text) ? text : `**${text}**`) : text)];
    }
    case "hr":
      return ["---"];
    case "ul":
    case "ol":
    case "menu":
      return list(el, ctx);
    case "blockquote": {
      const inner = blocks(el, ctx).join("\n\n");

      return inner ? [inner.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n")] : [];
    }
    case "pre":
      return codeBlock(el);
    case "table":
      return table(el, ctx);
    case "iframe":
    case "video":
    case "audio":
      return media(el, ctx);
    default:
      return blocks(el, ctx);
  }
}

/** @param {Element} el @param {Context} ctx */
function list(el, ctx) {
  const ordered = el.name === "ol";
  const start = Number.parseInt(el.attrs.start ?? "1", 10);
  /** @type {string[]} */
  const items = [];
  let number = Number.isFinite(start) ? start : 1;

  for (const child of el.children) {
    if (child.type !== "element" || isSkipped(child)) continue;
    const content = child.name === "li" ? blocks(child, ctx) : block(child, ctx);

    if (content.length === 0) continue;
    const marker = ordered ? `${number}.` : "-";
    const indent = " ".repeat(marker.length + 1);
    const lines = content
      .map((part, index) => {
        const indented = part.split("\n").map((line, at) => (index === 0 && at === 0 ? line : line ? `${indent}${line}` : ""));

        return indented.join("\n");
      })
      .reduce((all, part, index) => {
        if (index === 0) return part;
        // A nested list follows its item directly; other blocks get a blank line.
        const tight = /^\s*(-|\d+\.) /.test(part);

        return `${all}${tight ? "\n" : "\n\n"}${part}`;
      }, "");

    items.push(`${marker} ${lines}`);
    number += 1;
  }
  return items.length ? [items.join("\n")] : [];
}

/** @param {Element} el */
function codeBlock(el) {
  const code = find(el, (child) => child.name === "code");
  const className = `${code?.attrs.class ?? ""} ${el.attrs.class ?? ""}`;
  const language = el.attrs["data-language"] ?? /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(className)?.[1] ?? "";
  /** @param {import("./html.js").Node} node @returns {string} */
  const raw = (node) => (node.type === "text" ? node.value : node.name === "br" ? "\n" : node.children.map(raw).join(""));
  const text = raw(code ?? el).replace(/^\n/, "").replace(/\s+$/, "");

  if (!text) return [];
  const longest = Math.max(2, ...[...text.matchAll(/^`{3,}/gm)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);

  return [`${fence}${language === "plaintext" || language === "text" ? "" : language}\n${text}\n${fence}`];
}

/** @param {Element} el @param {Context} ctx */
function table(el, ctx) {
  const rows = findAll(el, (child) => child.name === "tr", (child) => child.name === "table");
  const cells = rows
    .map((row) =>
      row.children
        .filter((cell) => cell.type === "element" && (cell.name === "td" || cell.name === "th"))
        .map((cell) =>
          finishInline(/** @type {Element} */ (cell).children.map((child) => (child.type === "element" && BLOCK.has(child.name) ? ` ${block(/** @type {Element} */ (child), ctx).join(" ")} ` : inline(child, ctx))).join(""))
            .replace(/\\\n/g, " ")
            .replace(/\n+/g, " ")
            .replace(/\|/g, "\\|"),
        ),
    )
    .filter((row) => row.length > 0);
  const width = Math.max(0, ...cells.map((row) => row.length));

  if (cells.length === 0 || width === 0) return [];
  const pad = (/** @type {string[]} */ row) => [...row, ...Array(width - row.length).fill("")];
  const line = (/** @type {string[]} */ row) => `| ${pad(row).join(" | ")} |`.replace(/ {2,}\|/g, " |");
  const caption = find(el, (child) => child.name === "caption");
  const out = [line(cells[0] ?? []), `| ${Array(width).fill("---").join(" | ")} |`, ...cells.slice(1).map(line)].join("\n");

  return caption ? [...block(caption, ctx), out] : [out];
}

/** An embedded video, recording or frame: a link to it, named by its title. */
function media(/** @type {Element} */ el, /** @type {Context} */ ctx) {
  const source = el.attrs.src ?? find(el, (child) => child.name === "source")?.attrs.src ?? "";
  const url = absolute(source, ctx);
  const label = (el.attrs.title ?? el.attrs["aria-label"] ?? "").trim();

  if (!url || !label) return [];
  return [`[${escapeText(label)}](${destination(url)})`];
}

/**
 * The markdown of the main content of a parsed page.
 *
 * @param {Element} doc
 * @param {{ url: string }} page  The page's absolute address.
 * @returns {{ markdown: string; hasH1: boolean; whole: boolean }}
 */
export function pageMarkdown(doc, page) {
  const { root, extra, whole } = mainContent(doc);
  const ctx = { base: page.url, page: page.url.split("#")[0] ?? page.url };
  const parts = [...(root ? blocks(root, ctx) : []), ...extra.flatMap((el) => (isSkipped(el) ? [] : BLOCK.has(el.name) ? block(el, ctx) : blocks({ ...el, children: [el] }, ctx)))];
  const markdown = parts.filter((part) => part.trim()).join("\n\n");

  return { markdown, hasH1: /^# /m.test(markdown), whole };
}
