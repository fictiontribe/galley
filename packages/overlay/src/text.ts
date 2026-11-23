/**
 * Which element a click means, and what text it shows.
 *
 * The target is the smallest element whose own visible text is something a
 * person would call "a bit of copy": a heading, paragraph, list item, link,
 * button, label or cell — never a section or card that merely contains copy.
 * Inline wrappers (<em>, <span>) and links inside a sentence count as part of
 * that sentence, so a click anywhere in “Make more of the *home you have*”
 * means the whole heading.
 */

/** Elements whose text is never copy. */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "IFRAME", "CANVAS", "VIDEO", "AUDIO", "OBJECT", "SELECT", "TEXTAREA", "INPUT", "HEAD", "TITLE"]);

/** Elements that are copy in their own right when they hold text. */
const TEXT_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "A", "BUTTON", "LABEL", "TD", "TH", "DT", "DD", "FIGCAPTION", "BLOCKQUOTE", "SUMMARY", "CAPTION", "LEGEND", "CITE", "OPTION"]);

/** Phrasing wrappers that are part of the text around them. */
const INLINE_TAGS = new Set(["SPAN", "EM", "STRONG", "B", "I", "SMALL", "MARK", "CODE", "SUP", "SUB", "ABBR", "S", "U", "DEL", "INS", "KBD", "VAR", "Q", "TIME", "BDI", "BDO", "DATA", "FONT"]);

/** Inside one of these, an element is a container, not a bit of copy. */
const STRUCTURE = "p,h1,h2,h3,h4,h5,h6,li,ul,ol,dl,div,section,article,aside,header,footer,nav,main,table,tr,blockquote,figure,form,fieldset,details";

/** Elements whose end separates words ("<li>One</li><li>Two</li>" reads "One Two"). */
const BREAKS = new Set(["BR", "P", "DIV", "LI", "TR", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6", "DT", "DD", "BLOCKQUOTE", "FIGCAPTION", "SECTION", "ARTICLE", "HEADER", "FOOTER"]);

const WORDS = /[\p{L}\p{N}]/u;

export const tagOf = (element: Element): string => element.tagName.toUpperCase();

/** Whitespace collapsed to single spaces, trimmed — the form the resolver compares. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function computed(element: Element): CSSStyleDeclaration | null {
  const view = element.ownerDocument.defaultView;
  try {
    return view ? view.getComputedStyle(element) : null;
  } catch {
    return null;
  }
}

/** Hidden by attribute or style, on its own (not counting ancestors). */
function hiddenSelf(element: Element, style: CSSStyleDeclaration | null = computed(element)): boolean {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return true;
  return style !== null && (style.display === "none" || style.visibility === "hidden");
}

/** A flex or grid container lays its children out as separate items, not running text. */
function isLayout(style: CSSStyleDeclaration | null): boolean {
  return style !== null && /(^|-)(flex|grid)$/.test(style.display);
}

/** Whether an element's box starts a new line (so its text is a separate word). */
function isBlock(style: CSSStyleDeclaration | null): boolean {
  return style !== null && style.display !== "" && !style.display.startsWith("inline") && style.display !== "contents";
}

/** Whether the element can be seen at all: it and none of its ancestors are hidden. */
export function isVisible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (hiddenSelf(current)) return false;
  }
  return true;
}

/** The text a visitor reads in `element`: hidden and decorative parts left out, whitespace collapsed. */
export function visibleText(element: Element): string {
  let out = "";
  const walk = (node: Node, layout: boolean) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out += child.nodeValue ?? "";
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = tagOf(el);
      if (tag === "BR") {
        out += " ";
        continue;
      }
      if (SKIP_TAGS.has(tag)) continue;
      const style = computed(el);
      if (hiddenSelf(el, style)) continue;
      walk(el, isLayout(style));
      // Items of a flex/grid row and block boxes read as separate words, however the markup runs them together.
      if (layout || BREAKS.has(tag) || isBlock(style)) out += " ";
    }
  };
  walk(element, isLayout(computed(element)));
  return collapse(out);
}

/** Text worth editing: at least two characters and at least one letter or digit. */
export function meaningful(text: string): boolean {
  return text.length >= 2 && WORDS.test(text);
}

function hasOwnText(element: Element): boolean {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3 && WORDS.test(child.nodeValue ?? "")) return true;
  }
  return false;
}

const hasStructure = (element: Element): boolean => element.querySelector(STRUCTURE) !== null;
const isRoot = (element: Element): boolean => {
  const tag = tagOf(element);
  return tag === "BODY" || tag === "HTML";
};

/** An element that is a bit of copy by itself (before promotion to its sentence). */
export function isTextBearing(element: Element): boolean {
  const tag = tagOf(element);
  if (isRoot(element) || SKIP_TAGS.has(tag)) return false;
  if (!TEXT_TAGS.has(tag) && !hasOwnText(element)) return false;
  if (hasStructure(element)) return false;
  return meaningful(visibleText(element));
}

/** Climb from an inline piece to the sentence it belongs to. */
function promote(element: Element): Element {
  let current = element;
  for (;;) {
    const parent = current.parentElement;
    if (!parent || isRoot(parent) || hasStructure(parent) || isLayout(computed(parent))) return current;
    const tag = tagOf(current);
    const parentTag = tagOf(parent);
    const inlinePart = INLINE_TAGS.has(tag) && (TEXT_TAGS.has(parentTag) || hasOwnText(parent));
    const linkInSentence = (tag === "A" || tag === "BUTTON" || tag === "LABEL") && hasOwnText(parent);
    const linkIsHeading = tag === "A" && TEXT_TAGS.has(parentTag) && parentTag !== "A" && visibleText(parent) === visibleText(current);
    if (!inlinePart && !linkInSentence && !linkIsHeading) return current;
    current = parent;
  }
}

/** The bit of copy a pointer at `start` means, or null when it means none. */
export function editableTarget(start: Element | null): Element | null {
  for (let element = start; element && !isRoot(element); element = element.parentElement) {
    if (isTextBearing(element)) return promote(element);
  }
  return null;
}

/** The image a pointer at `start` means, or null. */
export function imageTarget(start: Element | null): HTMLImageElement | null {
  if (!start) return null;
  const tag = tagOf(start);
  if (tag === "IMG") return start as HTMLImageElement;
  if (tag === "PICTURE") return start.querySelector("img");
  return null;
}

/** Every bit of copy on the page, in document order (the set occurrences count within). */
export function copyElements(root: ParentNode): Element[] {
  const out: Element[] = [];
  for (const element of Array.from(root.querySelectorAll("body *"))) {
    if (isTextBearing(element) && promote(element) === element && isVisible(element)) out.push(element);
  }
  return out;
}

export interface Occurrence {
  text: string;
  occurrence: number;
  total: number;
}

/** The element's text and which of the page's same-text bits of copy it is. */
export function occurrenceOf(element: Element, root: ParentNode = element.ownerDocument): Occurrence {
  const text = visibleText(element);
  const same = copyElements(root).filter((candidate) => visibleText(candidate) === text);
  const index = same.indexOf(element);
  return { text, occurrence: Math.max(0, index), total: Math.max(1, same.length) };
}

/** The `occurrence`-th bit of copy showing exactly `text`, or null. */
export function findCopy(root: ParentNode, text: string, occurrence = 0): Element | null {
  const wanted = collapse(text);
  const same = copyElements(root).filter((candidate) => visibleText(candidate) === wanted);
  return same[occurrence] ?? null;
}
