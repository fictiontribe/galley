/// <reference path="../vendor.d.ts" />
/**
 * The HTML parser. domino is a WHATWG-conformant HTML parser and DOM (it is
 * the one Turndown itself uses in Node), so content is read the way a browser
 * would read it — unclosed tags, stray entities and all — and the same tree
 * feeds both the Markdown conversion and the page-builder outline.
 */
import domino from "@mixmark-io/domino";

/** The slice of the DOM the importer uses (domino ships no types). */
export interface DomNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  parentNode: DomElement | null;
  childNodes: ArrayLike<DomNode>;
  nextSibling: DomNode | null;
  previousSibling: DomNode | null;
  cloneNode(deep: boolean): DomNode;
}

export interface DomElement extends DomNode {
  tagName: string;
  id: string;
  className: string;
  innerHTML: string;
  outerHTML: string;
  children: ArrayLike<DomElement>;
  firstElementChild: DomElement | null;
  ownerDocument: DomDocument;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  readonly attributes: ArrayLike<{ name: string; value: string }>;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  closest(selector: string): DomElement | null;
  matches(selector: string): boolean;
  appendChild<T extends DomNode>(node: T): T;
  insertBefore<T extends DomNode>(node: T, before: DomNode | null): T;
  replaceChild(node: DomNode, old: DomNode): DomNode;
  removeChild(node: DomNode): DomNode;
  replaceWith(...nodes: DomNode[]): void;
  remove(): void;
  classList: { contains(name: string): boolean };
}

export interface DomDocument {
  createElement(tag: string): DomElement;
  createTextNode(text: string): DomNode;
  createComment(text: string): DomNode;
  body: DomElement;
}

export const ELEMENT = 1;
export const TEXT = 3;
export const COMMENT = 8;

/** Parses an HTML fragment into a detached container element. */
export function parseFragment(html: string): DomElement {
  const document = (domino as unknown as { createDocument(html: string, force?: boolean): DomDocument }).createDocument(
    `<!doctype html><html><body><div id="gwp-root">${html}</div></body></html>`,
    true
  );

  return document.body.querySelector("#gwp-root")!;
}

/** Decodes entities and drops tags: "Caf&eacute; <em>Nord</em>" → "Café Nord". */
export function htmlToText(html: string): string {
  if (!/[<&]/.test(html)) return html.trim();
  return collapse(parseFragment(html).textContent ?? "");
}

export function collapse(text: string): string {
  return text.replace(/[\s ]+/g, " ").trim();
}

export function elements(list: ArrayLike<DomElement>): DomElement[] {
  return Array.from(list);
}

export function isElement(node: DomNode | null | undefined): node is DomElement {
  return Boolean(node) && node!.nodeType === ELEMENT;
}

export function hasClass(element: DomElement, pattern: RegExp): boolean {
  return (element.getAttribute("class") ?? "").split(/\s+/).some((name) => pattern.test(name));
}

/** Replaces an element with its children. */
export function unwrap(element: DomElement): void {
  const parent = element.parentNode;

  if (!parent) return;
  while (element.childNodes.length > 0) parent.insertBefore(element.childNodes[0]!, element);
  parent.removeChild(element);
}

export function textOf(element: DomElement | null | undefined): string {
  return element ? collapse(element.textContent ?? "") : "";
}
