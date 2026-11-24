/**
 * Which element on the page is which section of the entry — without guessing.
 *
 * Markers first: a site that renders `data-galley-block="<field>.<index>"` on
 * each section's root says exactly where every section is. Otherwise the
 * page is mapped by evidence: each section's own strings and images (only
 * this section holds them, and each shows on exactly one element of the
 * page) are found, and the section's root is their lowest common ancestor,
 * widened while it still holds no other section's evidence. A mapping is
 * accepted only when every section resolved to a distinct element, none
 * contains another, and their order on the page is the content order.
 * Anything less declines: there is no partial or probable mapping.
 */
import type { OverlaySectionList } from "@galley/core/types";
import { collapse, copyElements, isVisible, visibleText } from "./text";

export const BLOCK_ATTR = "data-galley-block";
export const BLOCK_TYPE_ATTR = "data-galley-block-type";

export interface MappedSection {
  /** `<field>.<index>`. */
  key: string;
  field: string;
  index: number;
  type: string;
  label: string;
  element: Element;
}

export type SectionMap =
  | { ok: true; how: "markers" | "evidence"; sections: MappedSection[] }
  /**
   * `stale`: the page shows a different set of sections than the content (it hasn't reloaded yet).
   * `cause`: `unmarked` when the page carries no markers for these sections and their words don't
   * tell them apart; `mismatch` when it marks sections that don't match the content.
   */
  | { ok: false; stale: boolean; reason: string; cause: "unmarked" | "mismatch" };

export const sectionKey = (field: string, index: number): string => `${field}.${index}`;

const fail = (reason: string, stale = false, cause: "unmarked" | "mismatch" = "mismatch"): SectionMap => ({ ok: false, stale, reason, cause });
const name = (label: string, index: number) => `section ${index + 1} (${label})`;

const SITE_CHROME = "header,footer,nav,[role=banner],[role=contentinfo],[role=navigation]";

/** Every section is its own element, none inside another, in content order. */
function verify(sections: MappedSection[]): SectionMap | null {
  for (let i = 0; i < sections.length; i++) {
    const a = sections[i] as MappedSection;
    for (let j = i + 1; j < sections.length; j++) {
      const b = sections[j] as MappedSection;
      if (a.element === b.element) return fail(`${name(a.label, a.index)} and ${name(b.label, b.index)} resolve to the same element.`);
      if (a.element.contains(b.element) || b.element.contains(a.element)) return fail(`${name(a.label, a.index)} and ${name(b.label, b.index)} are nested.`);
    }
  }
  // Within one field, page order must be content order.
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1] as MappedSection;
    const next = sections[i] as MappedSection;
    if (prev.field !== next.field) continue;
    if (!(prev.element.compareDocumentPosition(next.element) & 4)) return fail(`${name(next.label, next.index)} comes before ${name(prev.label, prev.index)} on the page.`, true);
  }
  return null;
}

function byMarkers(doc: Document, lists: OverlaySectionList[]): SectionMap {
  const out: MappedSection[] = [];
  for (const list of lists) {
    const marked = Array.from(doc.querySelectorAll(`[${BLOCK_ATTR}]`)).filter((element) => {
      const key = element.getAttribute(BLOCK_ATTR) ?? "";
      return key.slice(0, key.lastIndexOf(".")) === list.field;
    });
    if (marked.length !== list.sections.length) return fail(`The page marks ${marked.length} sections of “${list.field}”; the content has ${list.sections.length}.`, true);
    for (const section of list.sections) {
      const key = sectionKey(list.field, section.index);
      const found = marked.filter((element) => element.getAttribute(BLOCK_ATTR) === key);
      if (found.length !== 1) return fail(found.length === 0 ? `No element is marked “${key}”.` : `${found.length} elements are marked “${key}”.`, found.length === 0);
      const element = found[0] as Element;
      const type = element.getAttribute(BLOCK_TYPE_ATTR);
      if (type !== null && type !== section.type) return fail(`“${key}” is a ${type} on the page and a ${section.type} in the content.`, true);
      out.push({ key, field: list.field, index: section.index, type: section.type, label: section.label, element });
    }
  }
  return verify(out) ?? { ok: true, how: "markers", sections: out };
}

/** The address an image shows, in the forms content stores it (path, or the original behind an optimised URL). */
function imageAddresses(image: HTMLImageElement): string[] {
  const out: string[] = [];
  const raw = image.getAttribute("src") ?? "";
  for (const value of [raw, image.currentSrc]) {
    if (!value) continue;
    try {
      const url = new URL(value, image.ownerDocument.baseURI);
      out.push(url.pathname, decodeURI(url.pathname));
      const href = url.searchParams.get("href");
      if (href) out.push(href);
    } catch {
      out.push(value);
    }
  }
  return out;
}

function lowestCommonAncestor(elements: Element[]): Element | null {
  let common: Element | null = elements[0] ?? null;
  for (const element of elements.slice(1)) {
    while (common && !common.contains(element)) common = common.parentElement;
  }
  return common;
}

const isPageRoot = (element: Element) => element.tagName === "BODY" || element.tagName === "HTML";

function byEvidence(doc: Document, lists: OverlaySectionList[]): SectionMap {
  // Each text and image that shows on exactly one element of the page.
  const textHolders = new Map<string, Element[]>();
  for (const element of copyElements(doc)) {
    const text = visibleText(element);
    const holders = textHolders.get(text);
    if (holders) holders.push(element);
    else textHolders.set(text, [element]);
  }
  const imageHolders = new Map<string, Element[]>();
  for (const image of Array.from(doc.querySelectorAll("body img"))) {
    if (!isVisible(image)) continue;
    for (const address of new Set(imageAddresses(image as HTMLImageElement))) {
      const holders = imageHolders.get(address);
      if (holders) holders.push(image);
      else imageHolders.set(address, [image]);
    }
  }
  const only = (holders: Element[] | undefined): Element | null => (holders && holders.length === 1 ? (holders[0] as Element) : null);

  const all = lists.flatMap((list) => list.sections.map((section) => ({ list, section })));
  const evidence = all.map(({ section }) => {
    const found = new Set<Element>();
    for (const text of section.texts) {
      const element = only(textHolders.get(collapse(text)));
      if (element) found.add(element);
    }
    for (const address of section.images) {
      const element = only(imageHolders.get(address));
      if (element) found.add(element);
    }
    return [...found];
  });
  const owner = new Map<Element, number>();
  for (let at = 0; at < evidence.length; at++) {
    for (const element of evidence[at] as Element[]) {
      // The same element can't be evidence for two sections (the host keeps strings distinct; this is the page's word).
      if (owner.has(element) && owner.get(element) !== at) return fail("Two sections show the same text.");
      owner.set(element, at);
    }
  }
  const holdsOther = (candidate: Element, at: number) => {
    for (const [element, of] of owner) if (of !== at && candidate.contains(element)) return true;
    return false;
  };
  const crossesChrome = (candidate: Element, root: Element) => {
    for (const chrome of Array.from(candidate.querySelectorAll(SITE_CHROME))) {
      if (!chrome.contains(root) && !root.contains(chrome)) return true;
    }
    return false;
  };

  const out: MappedSection[] = [];
  for (let at = 0; at < all.length; at++) {
    const { list, section } = all[at] as (typeof all)[number];
    const own = evidence[at] as Element[];
    if (own.length === 0) return fail(`${name(section.label, section.index)} shows no text or image that only it has.`);
    let root = lowestCommonAncestor(own);
    if (!root || isPageRoot(root) || holdsOther(root, at)) return fail(`${name(section.label, section.index)} is mixed in with other sections.`);
    for (let parent = root.parentElement; parent && !isPageRoot(parent) && !holdsOther(parent, at) && !crossesChrome(parent, root); parent = parent.parentElement) {
      root = parent;
    }
    out.push({ key: sectionKey(list.field, section.index), field: list.field, index: section.index, type: section.type, label: section.label, element: root });
  }
  return verify(out) ?? { ok: true, how: "evidence", sections: out };
}

/** Maps every section of `lists` to its element on the page, or says why it can't. */
export function mapSections(doc: Document, allLists: OverlaySectionList[]): SectionMap {
  // An empty list has nothing on the page to find.
  const lists = allLists.filter((list) => list.sections.length > 0);
  if (lists.length === 0) return { ok: true, how: "markers", sections: [] };
  const markedFields = new Set(
    Array.from(doc.querySelectorAll(`[${BLOCK_ATTR}]`), (element) => {
      const key = element.getAttribute(BLOCK_ATTR) ?? "";
      return key.slice(0, key.lastIndexOf("."));
    }),
  );
  const marked = lists.filter((list) => markedFields.has(list.field));
  // A site that marks its sections is read by its markers only; evidence is for sites that don't.
  if (marked.length === lists.length) return byMarkers(doc, lists);
  if (marked.length > 0) return fail("Some sections are marked on the page and some aren’t.");
  const found = byEvidence(doc, lists);
  // Only here is "the site hasn't marked its sections" true: the page drew, and it marks none of them.
  return found.ok ? found : { ...found, cause: "unmarked" };
}
