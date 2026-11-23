/**
 * The structured outline of a page-builder page — shared by every builder
 * reader.
 *
 * A builder page is a stack of sections; each section has columns; each
 * column holds widgets in order. The outline keeps exactly that (headings,
 * text, images, buttons, lists, cards, quotes, questions, prices, counters,
 * forms, embeds) with no styling, plus plain-language hints about the layout
 * ("three equal columns each with an icon, a heading and text"). It is the
 * input for the rebuild brief, and also renders to the page's Markdown body
 * so the safe import and the brief always say the same thing.
 */
import type { OutlineColumn, OutlineItem, OutlineSection } from "../types";
import { collapse, elements, hasClass, textOf, type DomElement } from "./dom";
import { escapeHtml } from "./embeds";
import type { Tokens } from "./tokens";

type RowItem = Extract<OutlineItem, { kind: "row" }>;
type AnyItem = OutlineItem;

export type HtmlToMarkdown = (html: string) => string;

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${numberWord(n)} ${n === 1 ? one : many}`;
}

/** Reads ordinary HTML (a text widget, a builder module) into outline items, in document order. */
export function itemsFromHtml(root: DomElement, toMarkdown: HtmlToMarkdown): OutlineItem[] {
  const items: OutlineItem[] = [];
  let pending: string[] = [];
  const flush = () => {
    const html = pending.join("").trim();

    pending = [];
    if (!html) return;
    const markdown = toMarkdown(html).trim();

    if (markdown) items.push({ kind: "text", markdown });
  };

  const visit = (element: DomElement) => {
    const tag = element.nodeName;

    if (/^H[1-6]$/.test(tag)) {
      flush();
      const text = textOf(element);

      if (text) items.push({ kind: "heading", level: Number(tag[1]), text });
      return;
    }
    if (tag === "IMG") {
      flush();
      const src = element.getAttribute("src") ?? element.getAttribute("data-src") ?? "";
      const link = element.closest("a");

      if (src && !src.startsWith("data:")) items.push({ kind: "image", src, alt: element.getAttribute("alt") ?? "", ...(link?.getAttribute("href") ? { href: link.getAttribute("href")! } : {}) });
      return;
    }
    if (tag === "A" && isButton(element)) {
      flush();
      const label = textOf(element);

      if (label) items.push({ kind: "button", label, href: element.getAttribute("href") ?? "" });
      return;
    }
    if (tag === "UL" || tag === "OL") {
      flush();
      const list = elements(element.children)
        .filter((child) => child.nodeName === "LI")
        .map((li) => textOf(li))
        .filter(Boolean);

      if (list.length) items.push({ kind: "list", items: list, ...(tag === "OL" ? { ordered: true } : {}) });
      return;
    }
    if (tag === "BLOCKQUOTE") {
      flush();
      const cite = element.querySelector("cite, footer");
      const name = cite ? textOf(cite).replace(/^[—–-]\s*/, "") : "";

      cite?.remove();
      const [person, ...role] = name.split(/,\s*/);

      items.push({ kind: "quote", text: textOf(element), ...(person ? { name: person } : {}), ...(role.length ? { role: role.join(", ") } : {}) });
      return;
    }
    if (tag === "DETAILS") {
      flush();
      const summary = element.querySelector("summary");
      const question = textOf(summary);

      summary?.remove();
      const answer = textOf(element);
      const last = items[items.length - 1];

      if (last?.kind === "faq") last.items.push({ question, answer });
      else items.push({ kind: "faq", items: [{ question, answer }] });
      return;
    }
    if (tag === "FORM") {
      flush();
      const fields = elements(element.querySelectorAll("label"))
        .map((label) => textOf(label).replace(/\s*\*$/, ""))
        .filter(Boolean);

      items.push({ kind: "form", ...(element.getAttribute("data-gwp-form") ? { name: element.getAttribute("data-gwp-form")! } : {}), fields });
      return;
    }
    if (tag === "IFRAME" || tag === "VIDEO" || tag === "AUDIO") {
      flush();
      items.push({ kind: "embed", html: element.outerHTML, provider: tag === "IFRAME" ? hostOf(element.getAttribute("src") ?? "") : tag.toLowerCase() });
      return;
    }
    if (hasClass(element, /^gwp-card$/)) {
      flush();
      items.push(cardFrom(element, toMarkdown));
      return;
    }
    if (hasClass(element, /^gwp-price$/)) {
      flush();
      items.push(priceFrom(element));
      return;
    }
    if (hasClass(element, /^gwp-counter$/)) {
      flush();
      items.push({ kind: "counter", value: textOf(element.querySelector(".gwp-value")), label: textOf(element.querySelector(".gwp-label")) });
      return;
    }
    if (hasClass(element, /^gwp-icon$/) || tag === "SVG" || (tag === "I" && /\b(fa|fas|far|fab|dashicons|eicon)\b/.test(element.getAttribute("class") ?? ""))) {
      flush();
      items.push({ kind: "icon", ...(iconName(element) ? { name: iconName(element)! } : {}) });
      return;
    }
    if (/^(P|DIV|SECTION|ARTICLE|FIGURE|SPAN|CENTER|MAIN|HEADER|FOOTER|ASIDE)$/.test(tag) && containsStructure(element)) {
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 1) visit(child as DomElement);
        else if (collapse(child.textContent ?? "")) pending.push(escapeHtml(child.textContent ?? ""));
      }
      return;
    }
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return;
    pending.push(element.outerHTML);
  };

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 1) visit(child as DomElement);
    else if (collapse(child.textContent ?? "")) pending.push(escapeHtml(child.textContent ?? ""));
  }
  flush();
  return items;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Whether an element holds anything the outline treats as its own item (so it must be walked, not taken as text). */
function containsStructure(element: DomElement): boolean {
  return Boolean(element.querySelector("h1, h2, h3, h4, h5, h6, img, ul, ol, blockquote, details, form, iframe, video, audio, a.gwp-button, a.button, a.btn, a.wp-block-button__link, a.elementor-button, .gwp-card, .gwp-price, .gwp-counter, .gwp-icon, svg, i"));
}

function isButton(element: DomElement): boolean {
  return hasClass(element, /^(gwp-button|button|btn|wp-block-button__link|wp-element-button|elementor-button|e-button-base|et_pb_button|vc_btn3|fl-button)$/);
}

function iconName(element: DomElement): string | undefined {
  const classes = (element.getAttribute("class") ?? "").split(/\s+/);
  const named = classes.find((name) => /^(fa|eicon|dashicons)-[\w-]+$/.test(name) && !/^fa-(solid|regular|brands|light|thin|duotone)$/.test(name));

  return named?.replace(/^(fa|eicon|dashicons)-/, "");
}

function cardFrom(element: DomElement, toMarkdown: HtmlToMarkdown): OutlineItem {
  const img = element.querySelector("img");
  const heading = element.querySelector("h1, h2, h3, h4, h5, h6");
  const button = element.querySelector("a.gwp-button");
  const clone = element.cloneNode(true) as DomElement;

  for (const part of elements(clone.querySelectorAll("img, h1, h2, h3, h4, h5, h6, a.gwp-button, .gwp-icon"))) part.remove();
  const text = toMarkdown(clone.innerHTML).trim();

  return {
    kind: "card",
    ...(element.querySelector(".gwp-icon") ? { icon: "" } : {}),
    ...(img ? { image: { src: img.getAttribute("src") ?? "", alt: img.getAttribute("alt") ?? "" } } : {}),
    ...(heading ? { heading: textOf(heading) } : {}),
    ...(text ? { text } : {}),
    ...(button ? { link: { label: textOf(button), href: button.getAttribute("href") ?? "" } } : {}),
  };
}

function priceFrom(element: DomElement): OutlineItem {
  const featuresHolder = element.querySelector(".gwp-features, ul");
  const lines = featuresHolder
    ? featuresHolder.nodeName === "UL"
      ? elements(featuresHolder.querySelectorAll("li")).map(textOf)
      : (featuresHolder.textContent ?? "").split(/\n+/).map((line) => collapse(line).replace(/^[+-]\s*/, ""))
    : [];
  const button = element.querySelector("a.gwp-button, a");

  return {
    kind: "price",
    name: textOf(element.querySelector("h1, h2, h3, h4, h5, h6")),
    price: textOf(element.querySelector(".gwp-amount"))
      .replace(textOf(element.querySelector(".gwp-period")), "")
      .trim(),
    ...(textOf(element.querySelector(".gwp-period")) ? { period: textOf(element.querySelector(".gwp-period")).replace(/^\/\s*/, "") } : {}),
    features: lines.filter(Boolean),
    ...(button && textOf(button) ? { button: { label: textOf(button), href: button.getAttribute("href") ?? "" } } : {}),
    ...(element.getAttribute("data-featured") ? { featured: true } : {}),
  };
}

// ─────────────────────────────────────────────────────────── hints

function itemPhrase(item: AnyItem): string[] {
  switch (item.kind) {
    case "heading":
      return ["a heading"];
    case "text":
      return ["text"];
    case "image":
      return ["an image"];
    case "button":
      return ["a button"];
    case "list":
      return ["a list"];
    case "icon":
      return ["an icon"];
    case "card":
      return [...(item.icon !== undefined ? ["an icon"] : []), ...(item.image ? ["an image"] : []), ...(item.heading ? ["a heading"] : []), ...(item.text ? ["text"] : []), ...(item.link ? ["a link"] : [])];
    case "quote":
      return [item.name ? "a quote with a name" : "a quote"];
    case "faq":
      return [plural(item.items.length, "question") + " with answers"];
    case "price":
      return ["a price plan"];
    case "counter":
      return ["a number with a label"];
    case "gallery":
      return [plural(item.images.length, "image")];
    case "form":
      return ["a form"];
    case "embed":
      return ["an embedded player"];
    case "row":
      return ["a row of columns"];
    default:
      return ["other content"];
  }
}

function joinPhrases(parts: string[]): string {
  const compact = parts.filter((part, i) => part !== parts[i - 1]);

  if (compact.length <= 1) return compact[0] ?? "nothing";
  return `${compact.slice(0, -1).join(", ")} and ${compact[compact.length - 1]}`;
}

function signature(items: AnyItem[]): string {
  return joinPhrases(items.flatMap(itemPhrase));
}

/** Every leaf item of a section, nested rows included, in order. */
export function flatItems(columns: OutlineColumn[]): OutlineItem[] {
  return columns.flatMap((column) => (column.items as AnyItem[]).flatMap((item) => (item.kind === "row" ? flatItems(item.columns) : [item])));
}

function columnsHint(columns: OutlineColumn[]): string | null {
  const filled = columns.filter((column) => column.items.length > 0);

  if (filled.length < 2) return null;
  const widths = filled.map((column) => column.width);
  const equal = widths.every((width) => width === undefined) || widths.every((width) => width !== undefined && Math.abs(width - widths[0]!) <= 2);
  const signatures = filled.map((column) => signature(column.items as AnyItem[]));

  if (signatures.every((sig) => sig === signatures[0])) return `${numberWord(filled.length)} ${equal ? "equal " : ""}columns each with ${signatures[0]}`;
  return `${numberWord(filled.length)} columns: ${signatures.join("; ")}`;
}

function looksLikeLogos(images: Array<{ src: string; alt: string }>, headings: string[]): boolean {
  const words = /\blogos?\b|client|partner|sponsor|trusted|brand|featured in|as seen|supporters|members/i;

  return images.every((image) => /logo/i.test(`${image.src} ${image.alt}`)) || headings.some((heading) => words.test(heading));
}

export function sectionHints(section: Omit<OutlineSection, "hints">): string[] {
  const hints: string[] = [];
  const items = flatItems(section.columns);
  const headings = items.filter((item): item is Extract<OutlineItem, { kind: "heading" }> => item.kind === "heading");
  const texts = items.filter((item) => item.kind === "text");
  const buttons = items.filter((item) => item.kind === "button");
  const images = items.filter((item): item is Extract<OutlineItem, { kind: "image" }> => item.kind === "image");
  const gallery = items.flatMap((item) => (item.kind === "gallery" ? item.images : []));
  const cards = items.filter((item): item is Extract<OutlineItem, { kind: "card" }> => item.kind === "card");
  const quotes = items.filter((item): item is Extract<OutlineItem, { kind: "quote" }> => item.kind === "quote");
  const faqs = items.flatMap((item) => (item.kind === "faq" ? item.items : []));
  const prices = items.filter((item) => item.kind === "price");
  const counters = items.filter((item) => item.kind === "counter");
  const forms = items.filter((item): item is Extract<OutlineItem, { kind: "form" }> => item.kind === "form");
  const embeds = items.filter((item) => item.kind === "embed");
  const columns = columnsHint(section.columns);
  const rows = section.columns.flatMap((column) => (column.items as AnyItem[]).filter((item): item is RowItem => item.kind === "row"));

  if (section.index === 0 && headings.length === 1 && texts.length <= 2 && buttons.length >= 1 && cards.length === 0 && quotes.length === 0) {
    hints.push(`a large heading with ${texts.length ? "a short text and " : ""}${buttons.length === 1 ? "a button" : `${numberWord(buttons.length)} buttons`}${images.length ? " beside an image" : ""}`);
  }
  if (columns) hints.push(columns);
  for (const row of rows) {
    const inner = columnsHint(row.columns);

    if (inner) hints.push(`a row of ${inner}`);
  }
  // When every column is one card, one price or one quote, the columns hint already says it.
  const oneKindPerColumn = (kind: OutlineItem["kind"]) => Boolean(columns) && section.columns.filter((column) => column.items.length).every((column) => column.items.length === 1 && column.items[0]!.kind === kind);

  if (cards.length >= 2 && !oneKindPerColumn("card")) {
    const sample = cards[0]!;

    hints.push(`${numberWord(cards.length)} ${sample.image ? "image boxes" : "icon boxes"} each with ${joinPhrases(itemPhrase(sample))}`);
  }
  const allImages = [...images.map(({ src, alt }) => ({ src, alt })), ...gallery];

  if (allImages.length >= 3 && texts.length === 0 && cards.length === 0 && headings.length <= 1) {
    hints.push(looksLikeLogos(allImages, headings.map((heading) => heading.text)) ? `a row of ${numberWord(allImages.length)} logos` : `a gallery of ${numberWord(allImages.length)} images`);
  }
  if (quotes.length === 1) hints.push(quotes[0]!.name ? `a quote with a name${quotes[0]!.role ? " and a role" : ""}` : "a quote");
  if (quotes.length > 1 && !oneKindPerColumn("quote")) hints.push(`${numberWord(quotes.length)} quotes, each with a name`);
  if (faqs.length) hints.push(`${plural(faqs.length, "question")} with answers`);
  if (prices.length && !oneKindPerColumn("price")) hints.push(`${plural(prices.length, "price plan")}`);
  if (counters.length && !oneKindPerColumn("counter")) hints.push(`${plural(counters.length, "number")} with labels`);
  for (const form of forms) hints.push(`a contact form${form.fields.length ? ` with ${plural(form.fields.length, "field")}` : ""}`);
  if (embeds.length) hints.push(embeds.length === 1 ? "an embedded video or map" : `${numberWord(embeds.length)} embedded players`);
  if (hints.length === 0 && headings.length + texts.length > 0) {
    hints.push(headings.length ? `a heading with ${texts.length ? "text" : "nothing else"}` : "text");
  }
  return hints;
}

// ─────────────────────────────────────────────────────────── markdown

export function itemsToMarkdown(items: AnyItem[], tokens: Tokens): string[] {
  const out: string[] = [];
  const image = (src: string, alt: string) => `![${alt.replace(/[\[\]]/g, "")}](${src})`;

  for (const item of items) {
    switch (item.kind) {
      case "heading":
        // The page's title is its only top-level heading.
        out.push(`${"#".repeat(Math.max(2, Math.min(6, item.level)))} ${item.text}`);
        break;
      case "text":
        out.push(item.markdown);
        break;
      case "image": {
        const md = image(item.src, item.alt);

        out.push(item.href && item.href !== item.src ? `[${md}](${item.href})` : md);
        if (item.caption) out.push(`*${item.caption}*`);
        break;
      }
      case "button":
        out.push(`[${item.label}](${item.href || "#"})`);
        break;
      case "list":
        out.push(item.items.map((entry, i) => `${item.ordered ? `${i + 1}.` : "-"} ${entry}`).join("\n"));
        break;
      case "icon":
        break;
      case "card":
        if (item.image) out.push(image(item.image.src, item.image.alt));
        if (item.heading) out.push(`### ${item.heading}`);
        if (item.text) out.push(item.text);
        if (item.link) out.push(`[${item.link.label}](${item.link.href})`);
        break;
      case "quote":
        out.push(`> ${item.text}${item.name ? `\n>\n> — ${item.name}${item.role ? `, ${item.role}` : ""}` : ""}`);
        break;
      case "faq":
        for (const qa of item.items) out.push(`### ${qa.question}`, qa.answer);
        break;
      case "price":
        out.push(`### ${item.name}`, `**${item.price}**${item.period ? ` ${item.period}` : ""}`);
        if (item.features.length) out.push(item.features.map((feature) => `- ${feature}`).join("\n"));
        if (item.button) out.push(`[${item.button.label}](${item.button.href})`);
        break;
      case "counter":
        out.push(`**${item.value}** ${item.label}`);
        break;
      case "gallery":
        for (const picture of item.images) {
          out.push(image(picture.src, picture.alt));
          if (picture.caption) out.push(`*${picture.caption}*`);
        }
        break;
      case "form":
        out.push(tokens.inline(`<!-- A form${item.name ? ` (“${item.name}”)` : ""} was here${item.fields.length ? ` with ${item.fields.join(", ")}` : ""}. A static site needs a form service to receive it — see the import report. -->`));
        break;
      case "embed":
        out.push(tokens.inline(item.html));
        break;
      case "row":
        for (const column of item.columns) out.push(...itemsToMarkdown(column.items as AnyItem[], tokens));
        break;
      case "other":
        if (item.text) out.push(item.text);
        break;
    }
  }
  return out.filter((block) => block.trim() !== "");
}

export function sectionsToMarkdown(sections: OutlineSection[], tokens: Tokens): string {
  return sections
    .flatMap((section) => section.columns.flatMap((column) => itemsToMarkdown(column.items as AnyItem[], tokens)))
    .join("\n\n");
}
