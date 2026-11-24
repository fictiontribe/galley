/**
 * Draws the working copy onto a built page of the sample site, in place.
 *
 * The page was built from the last published version. For its own entry,
 * each changed value is found where the site put it — inside the section's
 * `data-galley-block` marker, by the words it showed (as the overlay finds a
 * clicked text) — and replaced with the new words, rendered the way the
 * site renders them. Pictures are swapped by their address, the title and
 * description go into <head>. Sections are put in their new order. Values
 * from other files (a menu label, a story's title in a list) are replaced
 * wherever the page shows exactly those words. Whatever can't be found is
 * counted, and the page says so rather than pretend.
 *
 * Every replacement remembers what it replaced, so the next drawing starts
 * from the built page again (a change that was put back disappears).
 */
import type { JsonValue } from "@galley/core/types";
import type { PageState } from "../bridge";
import { inlineHtml, leafChanges, paragraphsOf, plainText, planFor, type Leaf } from "./changes";
import { isIdentity, matchSections } from "./sections";

export interface Drawn {
  /** Changes drawn on the page. */
  shown: number;
  /** Changes that couldn't be placed on this page (labels). */
  missing: string[];
  /** Sections that are new and can't be drawn (their type). */
  added: string[];
  /** The sections' order differs from the page as drawn: a fresh page is needed to put them in it. */
  needsFreshPage: boolean;
}

const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "svg"]);
const collapse = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();

export function createDrawing(doc: Document, base: string) {
  const texts = new Map<Element, string>();
  const attributes = new Map<Element, Map<string, string | null>>();
  const pristine = { title: doc.title, description: doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? null };
  /** The section order drawn on this page: null until the first drawing (the built order). */
  let order: Array<number | null> | null = null;

  const remember = (element: Element) => {
    if (!texts.has(element)) texts.set(element, element.innerHTML);
  };
  const rememberAttribute = (element: Element, name: string) => {
    const saved = attributes.get(element) ?? new Map<string, string | null>();
    if (!saved.has(name)) saved.set(name, element.getAttribute(name));
    attributes.set(element, saved);
  };

  function restore(): void {
    for (const [element, html] of texts) {
      // Being retyped in place by the overlay right now: leave it to the person.
      if ((element as HTMLElement).isContentEditable) continue;
      element.innerHTML = html;
    }
    texts.clear();
    for (const [element, saved] of attributes) {
      for (const [name, value] of saved) value === null ? element.removeAttribute(name) : element.setAttribute(name, value);
    }
    attributes.clear();
    doc.title = pristine.title;
    if (pristine.description !== null) doc.querySelector('meta[name="description"]')?.setAttribute("content", pristine.description);
  }

  /** The deepest elements in `scope` whose words are exactly `text` (compared as plain text). */
  function findText(scope: Element, text: string): Element[] {
    const want = plainText(text);
    if (!want) return [];
    const found: Element[] = [];
    const walker = doc.createTreeWalker(scope, 1 /* SHOW_ELEMENT */, {
      acceptNode: (node) => (SKIP.has((node as Element).tagName) || (node as Element).closest("[data-demo-note]") ? 2 /* REJECT */ : 1 /* ACCEPT */),
    });
    for (let node: Node | null = scope; node; node = walker.nextNode()) {
      const element = node as Element;
      if (collapse(element.textContent) !== want) continue;
      // An outer element with the same words is the wrapper of a match already found inside it.
      for (let i = found.length - 1; i >= 0; i--) if (found[i]?.contains(element)) found.splice(i, 1);
      found.push(element);
    }
    return found;
  }

  function replaceWords(scope: Element, before: string, after: string): boolean {
    const single = findText(scope, before);
    if (single.length > 0) {
      for (const element of single) {
        const paragraphs = paragraphsOf(after);
        if (paragraphs.length > 1 && element.tagName === "P" && element.parentElement) {
          remember(element.parentElement);
          const parts = paragraphs.map((part) => {
            const p = element.cloneNode(false) as Element;
            p.innerHTML = inlineHtml(part);
            return p;
          });
          element.replaceWith(...parts);
        } else {
          remember(element);
          element.innerHTML = inlineHtml(after);
        }
      }
      return true;
    }
    // Several paragraphs: each was its own element, side by side.
    const parts = paragraphsOf(before);
    if (parts.length > 1) {
      const elements = parts.map((part) => findText(scope, part)[0]);
      const first = elements[0];
      const parent = first?.parentElement;
      if (first && parent && elements.every((element) => element && element.parentElement === parent)) {
        remember(parent);
        const next = paragraphsOf(after).map((part) => {
          const p = first.cloneNode(false) as Element;
          p.innerHTML = inlineHtml(part);
          return p;
        });
        first.replaceWith(...next);
        for (const element of elements.slice(1)) element?.remove();
        return true;
      }
    }
    // Words that aren't text on the page: a picture's description, a link's label for screen readers.
    for (const name of ["alt", "aria-label", "title"]) {
      const matches = [...scope.querySelectorAll(`[${name}]`)].filter((element) => collapse(element.getAttribute(name)) === plainText(before));
      if (matches.length === 0) continue;
      for (const element of matches) {
        rememberAttribute(element, name);
        element.setAttribute(name, plainText(after));
      }
      return true;
    }
    // A link's address.
    if (/^(\/|https?:|mailto:)/.test(before)) {
      const links = [...scope.querySelectorAll("a[href]")].filter((link) => link.getAttribute("href") === before || link.getAttribute("href") === `${base}${before}`);
      for (const link of links) {
        rememberAttribute(link, "href");
        link.setAttribute("href", after.startsWith("/") ? `${base}${after}` : after);
      }
      if (links.length > 0) return true;
    }
    // Already showing the new words: the person retyped them on the page itself.
    const already = findText(scope, after);
    for (const element of already) texts.set(element, inlineHtml(before));
    return already.length > 0;
  }

  function replacePicture(scope: Element, before: string, after: string): boolean {
    const images = [...scope.querySelectorAll("img, source")].filter((element) => {
      const src = element.getAttribute("src") ?? element.getAttribute("srcset") ?? "";
      return src.split(/[\s,]/)[0]?.endsWith(before) ?? false;
    });
    for (const element of images) {
      for (const name of ["src", "srcset"]) {
        if (!element.hasAttribute(name)) continue;
        rememberAttribute(element, name);
        if (name === "srcset") element.removeAttribute(name);
        else element.setAttribute(name, `${base}${after}`);
      }
    }
    return images.length > 0;
  }

  const blockElement = (key: string | null): Element | null => (key ? doc.querySelector(`[data-galley-block="${key}"]`) : null);

  function drawLeaf(leaf: Leaf, own: boolean): boolean {
    const plan = planFor(leaf, own);
    const body = doc.body;
    switch (plan.kind) {
      case "none":
        return false;
      case "title": {
        const before = plainText(String(leaf.before));
        doc.title = doc.title.includes(before) ? doc.title.replace(before, plainText(plan.after)) : doc.title;
        replaceWords(body, String(leaf.before), plan.after);
        return true;
      }
      case "description":
        doc.querySelector('meta[name="description"]')?.setAttribute("content", plainText(plan.after));
        replaceWords(body, String(leaf.before), plan.after);
        return true;
      case "image":
        return replacePicture(blockElement(plan.scope) ?? body, plan.before, plan.after);
      case "text": {
        const scope = blockElement(plan.scope);
        if (scope && replaceWords(scope, plan.before, plan.after)) return true;
        // A field drawn outside its section's marker (a page's own header), or a page with no markers.
        return replaceWords(body, plan.before, plan.after);
      }
    }
  }

  /** Put the page's sections in the order they have now; true if it could (or needn't). */
  function arrange(match: Array<number | null>, types: string[]): string[] {
    const built = [...doc.querySelectorAll("[data-galley-block^='sections.']")].filter((element) => /^sections\.\d+$/.test(element.getAttribute("data-galley-block") ?? ""));
    const byIndex = new Map(built.map((element) => [Number(element.getAttribute("data-galley-block")?.split(".")[1]), element]));
    const first = built[0];
    const parent = first?.parentElement;
    if (!first || !parent) return [];
    const anchor = doc.createComment("sections");
    parent.insertBefore(anchor, first);
    const added: string[] = [];
    const placed: Element[] = match.map((from, index) => {
      const existing = from === null ? undefined : byIndex.get(from);
      if (existing) return existing;
      const type = types[index] ?? "section";
      added.push(type);
      const note = doc.createElement("section");
      note.className = "galley-demo-new-section";
      note.setAttribute("data-demo-note", "");
      note.textContent = `New section: ${type.replace(/-/g, " ")}. The demo can’t draw a section this page wasn’t built with. On your own site the preview shows it the way the site renders it.`;
      return note;
    });
    for (const element of built) element.remove();
    let after: Node = anchor;
    placed.forEach((element, index) => {
      element.setAttribute("data-galley-block", `sections.${index}`);
      if (types[index]) element.setAttribute("data-galley-block-type", types[index] as string);
      after.parentNode?.insertBefore(element, after.nextSibling);
      after = element;
    });
    anchor.remove();
    return added;
  }

  function draw(state: PageState): Drawn {
    restore();
    const drawn: Drawn = { shown: 0, missing: [], added: [], needsFreshPage: false };
    const entry = state.entry;
    if (entry?.base && entry.current) {
      const before = Array.isArray(entry.base.sections) ? (entry.base.sections as JsonValue[]) : null;
      const after = Array.isArray(entry.current.sections) ? (entry.current.sections as JsonValue[]) : null;
      let base: { [key: string]: JsonValue } = entry.base;
      if (before && after) {
        const match = matchSections(before, after);
        const identity = isIdentity(match, before.length);
        if (order === null) {
          order = match;
          if (!identity) drawn.added = arrange(match, after.map((section) => (section && typeof section === "object" && !Array.isArray(section) ? String(section.type ?? "") : "")));
        } else if (JSON.stringify(order) !== JSON.stringify(match)) {
          drawn.needsFreshPage = true;
          return drawn;
        }
        // Compare each section with the built section it is, wherever it now sits.
        base = { ...entry.base, sections: match.map((from, index) => (from === null ? (after[index] as JsonValue) : (before[from] as JsonValue))) };
      }
      for (const leaf of leafChanges(base, entry.current)) {
        if (drawLeaf(leaf, true)) drawn.shown++;
        else drawn.missing.push(leaf.path.join(" › "));
      }
    }
    for (const other of state.others) {
      for (const change of other.changes) {
        if (typeof change.before !== "string" || typeof change.after !== "string") continue;
        // Only exact words elsewhere on the page: a menu label, a story's title in a list.
        if (replaceWords(doc.body, change.before, change.after)) drawn.shown++;
      }
    }
    return drawn;
  }

  return { draw, restore };
}
