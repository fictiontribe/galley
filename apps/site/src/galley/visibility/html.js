// Vendored from @galley/astro 0.3.1 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// A small, tolerant HTML reader for the pages a site builds: enough of the
// HTML parsing rules to turn Astro's (and any static generator's) output
// into a tree — void elements, raw-text elements, comments, entities, the
// common implied end tags — and no more. The kit depends on nothing but
// Astro, so it can't bring a full parser; built pages are regular enough,
// and everything built from this tree only ever reports what it found.

/**
 * @typedef {object} Element
 * @property {"element"} type
 * @property {string} name  Lower-case tag name.
 * @property {Record<string, string>} attrs  Lower-case names, decoded values.
 * @property {Node[]} children
 * @property {Element | null} parent
 */
/** @typedef {{ type: "text"; value: string; parent: Element | null }} Text */
/** @typedef {Element | Text} Node */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "template", "iframe", "noembed", "noframes"]);
/** Opening one of these closes an open <p> (HTML's "close a p element"). */
const CLOSES_P = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul",
]);

const NAMED = /** @type {Record<string, string>} */ ({
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“",
  rdquo: "”", bdquo: "„", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", middot: "·",
  bull: "•", copy: "©", reg: "®", trade: "™", times: "×", divide: "÷", deg: "°", euro: "€",
  pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", plusmn: "±", frac12: "½",
  frac14: "¼", frac34: "¾", larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔",
  check: "✓", minus: "−", prime: "′", Prime: "″", shy: "­", zwj: "‍", zwnj: "‌",
  eacute: "é", egrave: "è", aacute: "á", agrave: "à", iacute: "í", oacute: "ó", uacute: "ú",
  ouml: "ö", uuml: "ü", auml: "ä", szlig: "ß", ccedil: "ç", ntilde: "ñ", colon: ":", sol: "/",
  num: "#", lpar: "(", rpar: ")", lsqb: "[", rsqb: "]", lowbar: "_", ast: "*", grave: "`", vert: "|", equals: "=",
});

/** Character references → characters. Unknown names stay as written. */
export function decodeEntities(/** @type {string} */ text) {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (whole, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);

      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED[ref];

    return named === undefined ? whole : named;
  });
}

/** @param {string} name @param {Element | null} parent @returns {Element} */
function element(name, parent) {
  return { type: "element", name, attrs: {}, children: [], parent };
}

/**
 * Reads the attributes of a start tag (the text between the name and `>`).
 *
 * @param {string} source
 * @returns {Record<string, string>}
 */
function readAttributes(source) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const pattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

  for (const match of source.matchAll(pattern)) {
    const name = (match[1] ?? "").toLowerCase();

    if (!name || name in attrs) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** Where a start tag ends: the first `>` outside quotes. */
function tagEnd(/** @type {string} */ html, /** @type {number} */ from) {
  let quote = "";

  for (let index = from; index < html.length; index += 1) {
    const char = html[index];

    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return index;
  }
  return -1;
}

/**
 * The document as a tree under a root element named "#document".
 *
 * @param {string} html
 * @returns {Element}
 */
export function parseHtml(html) {
  const root = element("#document", null);
  /** @type {Element[]} */
  const stack = [root];
  const current = () => /** @type {Element} */ (stack[stack.length - 1]);
  /** @param {string} value */
  const addText = (value) => {
    if (!value) return;
    const parent = current();
    const last = parent.children[parent.children.length - 1];

    if (last && last.type === "text") last.value += value;
    else parent.children.push({ type: "text", value, parent });
  };
  /** Closes the innermost open `name`, and everything opened inside it. */
  const close = (/** @type {string} */ name) => {
    for (let index = stack.length - 1; index > 0; index -= 1) {
      if (stack[index]?.name === name) {
        stack.length = index;
        return true;
      }
    }
    return false;
  };
  /** Whether `name` is open, without crossing one of `scope`. */
  const openWithin = (/** @type {string} */ name, /** @type {Set<string>} */ scope) => {
    for (let index = stack.length - 1; index > 0; index -= 1) {
      const open = stack[index]?.name ?? "";

      if (open === name) return true;
      if (scope.has(open)) return false;
    }
    return false;
  };
  const LIST_SCOPE = new Set(["ul", "ol", "menu", "table", "div", "section", "article", "main", "body"]);
  const DL_SCOPE = new Set(["dl", "table", "div", "section", "article", "main", "body"]);
  const TABLE_SCOPE = new Set(["table"]);
  let at = 0;

  while (at < html.length) {
    const lt = html.indexOf("<", at);

    if (lt === -1) {
      addText(decodeEntities(html.slice(at)));
      break;
    }
    if (lt > at) addText(decodeEntities(html.slice(at, lt)));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);

      at = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);

      at = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html[lt + 1] === "/") {
      const match = /^<\/([a-zA-Z][^\s/>]*)[^>]*>/.exec(html.slice(lt, lt + 200));

      if (!match) {
        addText("<");
        at = lt + 1;
        continue;
      }
      close((match[1] ?? "").toLowerCase());
      at = lt + match[0].length;
      continue;
    }
    const nameMatch = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 100));

    if (!nameMatch) {
      addText("<");
      at = lt + 1;
      continue;
    }
    const end = tagEnd(html, lt + nameMatch[0].length);

    if (end === -1) {
      addText(decodeEntities(html.slice(lt)));
      break;
    }
    const name = (nameMatch[1] ?? "").toLowerCase();
    const node = element(name, null);

    node.attrs = readAttributes(html.slice(lt + nameMatch[0].length, end).replace(/\/\s*$/, ""));
    // The implied end tags built pages rely on most.
    if (CLOSES_P.has(name) && openWithin("p", new Set(["button", "table", "td", "th"]))) close("p");
    if (name === "li" && openWithin("li", LIST_SCOPE)) close("li");
    if ((name === "dt" || name === "dd") && (openWithin("dt", DL_SCOPE) || openWithin("dd", DL_SCOPE))) {
      if (!close("dd")) close("dt");
    }
    if (name === "tr" && openWithin("tr", TABLE_SCOPE)) close("tr");
    if ((name === "td" || name === "th") && (openWithin("td", new Set(["tr", "table"])) || openWithin("th", new Set(["tr", "table"])))) {
      if (!close("td")) close("th");
    }
    if (name === "option" && openWithin("option", new Set(["select", "datalist"]))) close("option");
    node.parent = current();
    current().children.push(node);
    at = end + 1;
    if (VOID.has(name)) continue;
    if (RAW.has(name)) {
      const closeAt = html.toLowerCase().indexOf(`</${name}`, at);
      const text = html.slice(at, closeAt === -1 ? html.length : closeAt);

      if (text) node.children.push({ type: "text", value: name === "title" || name === "textarea" ? decodeEntities(text) : text, parent: node });
      if (closeAt === -1) break;
      const closeEnd = html.indexOf(">", closeAt);

      at = closeEnd === -1 ? html.length : closeEnd + 1;
      continue;
    }
    // `<path … />` in inline SVG closes itself (foreign content). HTML
    // elements written that way are treated the same: generators that emit
    // `<div />` mean an empty element too.
    if (html[end - 1] === "/") continue;
    stack.push(node);
  }
  return root;
}

/**
 * Every element under `node` (depth first, document order) for which `test`
 * is true. `skip` prunes a subtree.
 *
 * @param {Element} node
 * @param {(el: Element) => boolean} test
 * @param {(el: Element) => boolean} [skip]
 * @returns {Element[]}
 */
export function findAll(node, test, skip) {
  /** @type {Element[]} */
  const out = [];
  /** @param {Element} at */
  const walk = (at) => {
    for (const child of at.children) {
      if (child.type !== "element") continue;
      if (skip && skip(child)) continue;
      if (test(child)) out.push(child);
      walk(child);
    }
  };

  walk(node);
  return out;
}

/**
 * The first element under `node` for which `test` is true.
 *
 * @param {Element} node
 * @param {(el: Element) => boolean} test
 * @returns {Element | null}
 */
export function find(node, test) {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (test(child)) return child;
    const inner = find(child, test);

    if (inner) return inner;
  }
  return null;
}

/** The text of a subtree, whitespace collapsed. Raw-text elements count as no text. */
export function textOf(/** @type {Node} */ node) {
  /** @type {string[]} */
  const parts = [];
  /** @param {Node} at */
  const walk = (at) => {
    if (at.type === "text") {
      parts.push(at.value);
      return;
    }
    if (at.name === "script" || at.name === "style" || at.name === "template" || at.name === "noscript") return;
    for (const child of at.children) walk(child);
    if (at.name === "br") parts.push(" ");
  };

  walk(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** Whether the element (or one of its ancestors) is `name`. */
export function within(/** @type {Element | null} */ node, /** @type {string} */ name) {
  for (let at = node; at; at = at.parent) if (at.name === name) return true;
  return false;
}
