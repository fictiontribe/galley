/**
 * Elementor pages → outline.
 *
 * Two readers, one result. An export file carries `_elementor_data`, the
 * builder's own JSON (sections → columns → widgets, or flexbox containers),
 * which is the most faithful source. The REST API only has the rendered
 * page: deeply nested wrapper divs where every element carries
 * `data-element_type` (section, column, container, widget) and widgets say
 * what they are in `data-widget_type` ("icon-box.default"). Both are read
 * into the same sections/columns/items, so the rebuild brief doesn't depend
 * on how the site was read.
 */
import type { OutlineColumn, OutlineItem, OutlineSection, PageOutline, WordPressMedia } from "../../types";
import { collapse, elements, parseFragment, textOf, type DomElement } from "../dom";
import { videoEmbed } from "../embeds";
import { itemsFromHtml, sectionHints, type HtmlToMarkdown } from "../outline";

export interface ElementorContext {
  toMarkdown: HtmlToMarkdown;
  mediaById?(id: number): WordPressMedia | undefined;
}

// ─────────────────────────────────────────────────────────── from the HTML

/** Whether rendered content is an Elementor layout. */
export function isElementorHtml(html: string): boolean {
  return /data-elementor-type=|class="[^"]*\belementor-section\b|data-element_type="(section|container)"/.test(html);
}

/**
 * The nearest descendants that are Elementor elements (not their
 * descendants). Classic elements carry `data-element_type`; the newer
 * "atomic" elements (Elementor 3.30+/4) carry `data-e-type`, and an atomic
 * widget is the element itself — an <h2>, a <p>, an <a> — with no wrapper.
 */
function typedChildren(element: DomElement): DomElement[] {
  const out: DomElement[] = [];
  const walk = (node: DomElement) => {
    for (const child of elements(node.children)) {
      if (child.hasAttribute("data-element_type") || child.hasAttribute("data-e-type")) out.push(child);
      else walk(child);
    }
  };

  walk(element);
  return out;
}

function typeOf(element: DomElement): string {
  return element.getAttribute("data-element_type") ?? element.getAttribute("data-e-type") ?? "";
}

/** Anything that isn't a widget or a classic column holds other elements: sections, containers, atomic div blocks and flexboxes, tabs. */
function isContainer(type: string): boolean {
  return type !== "widget" && type !== "column" && type !== "" && !/^e-form/.test(type);
}

function widthOf(element: DomElement): number | undefined {
  const match = /\belementor-col-(\d+)\b/.exec(element.getAttribute("class") ?? "");

  return match ? Number(match[1]) : undefined;
}

function widgetItemsFromDom(widget: DomElement, context: ElementorContext): OutlineItem[] {
  const type = (widget.getAttribute("data-widget_type") ?? "").split(".")[0] ?? "";
  const body = widget.querySelector(".elementor-widget-container") ?? widget;
  const link = (element: DomElement | null) => (element?.closest("a") ?? element?.querySelector("a"))?.getAttribute("href") ?? "";
  const image = (element: DomElement | null) => (element ? { src: element.getAttribute("data-src") ?? element.getAttribute("src") ?? "", alt: element.getAttribute("alt") ?? "" } : undefined);

  switch (type) {
    case "heading":
    case "animated-headline": {
      const heading = body.querySelector("h1, h2, h3, h4, h5, h6");
      const text = textOf(body);

      return text ? [{ kind: "heading", level: heading ? Number(heading.nodeName[1]) : 2, text }] : [];
    }
    case "text-editor":
    case "theme-post-content":
      return itemsFromHtml(body, context.toMarkdown);
    case "image": {
      const img = body.querySelector("img");
      const picture = image(img);

      if (!picture?.src) return [];
      const caption = textOf(body.querySelector("figcaption"));
      const href = link(img);

      return [{ kind: "image", ...picture, ...(caption ? { caption } : {}), ...(href ? { href } : {}) }];
    }
    case "button": {
      const anchor = body.querySelector("a");
      const label = textOf(body.querySelector(".elementor-button-text") ?? anchor);

      return label ? [{ kind: "button", label, href: anchor?.getAttribute("href") ?? "" }] : [];
    }
    case "icon-box":
    case "image-box":
    case "call-to-action":
    case "flip-box": {
      const heading = body.querySelector(".elementor-icon-box-title, .elementor-image-box-title, .elementor-cta__title, .elementor-flip-box__layer__title, h1, h2, h3, h4, h5, h6");
      const text = body.querySelector(".elementor-icon-box-description, .elementor-image-box-description, .elementor-cta__description, .elementor-flip-box__layer__description");
      const img = body.querySelector("img");
      const button = body.querySelector(".elementor-cta__button, .elementor-flip-box__button, a.elementor-button");
      const icon = body.querySelector(".elementor-icon, i, svg");
      const card: OutlineItem = {
        kind: "card",
        ...(icon && !img ? { icon: iconName(icon) } : {}),
        ...(img ? { image: image(img)! } : {}),
        ...(textOf(heading) ? { heading: textOf(heading) } : {}),
        ...(text && textOf(text) ? { text: context.toMarkdown(text.innerHTML).trim() } : {}),
        ...(button && textOf(button) ? { link: { label: textOf(button), href: button.getAttribute("href") ?? link(button) } } : {}),
      };

      return [card];
    }
    case "icon-list": {
      const list = elements(body.querySelectorAll(".elementor-icon-list-item")).map((item) => textOf(item.querySelector(".elementor-icon-list-text") ?? item)).filter(Boolean);

      return list.length ? [{ kind: "list", items: list }] : [];
    }
    case "testimonial": {
      const name = textOf(body.querySelector(".elementor-testimonial-name"));
      const role = textOf(body.querySelector(".elementor-testimonial-job"));
      const img = body.querySelector("img");

      return [{ kind: "quote", text: textOf(body.querySelector(".elementor-testimonial-content")), ...(name ? { name } : {}), ...(role ? { role } : {}), ...(img ? { image: image(img)!.src } : {}) }];
    }
    case "testimonial-carousel":
    case "reviews":
      return elements(body.querySelectorAll(".swiper-slide:not(.swiper-slide-duplicate), .elementor-testimonial")).flatMap((slide): OutlineItem[] => {
        const text = textOf(slide.querySelector(".elementor-testimonial__text, .elementor-testimonial__content"));
        const name = textOf(slide.querySelector(".elementor-testimonial__name"));
        const role = textOf(slide.querySelector(".elementor-testimonial__title"));

        return text ? [{ kind: "quote", text, ...(name ? { name } : {}), ...(role ? { role } : {}) }] : [];
      });
    case "accordion":
    case "toggle": {
      const titles = elements(body.querySelectorAll(".elementor-tab-title"));
      const qa = titles.map((title) => {
        const id = title.getAttribute("aria-controls");
        const answer = id ? body.querySelector(`#${cssEscape(id)}`) : (title.nextSibling as DomElement | null);

        return { question: textOf(title), answer: answer ? context.toMarkdown(answer.innerHTML).trim() : "" };
      });

      return qa.length ? [{ kind: "faq", items: qa.filter((entry) => entry.question) }] : [];
    }
    case "nested-accordion": {
      const qa = elements(body.querySelectorAll("details")).map((details) => {
        const summary = details.querySelector("summary");
        const question = textOf(summary);

        summary?.remove();
        return { question, answer: context.toMarkdown(details.innerHTML).trim() };
      });

      return qa.length ? [{ kind: "faq", items: qa }] : [];
    }
    case "price-table": {
      const amount = [".elementor-price-table__currency", ".elementor-price-table__integer-part", ".elementor-price-table__fractional-part"]
        .map((selector) => textOf(body.querySelector(selector)))
        .join("")
        .replace(/(\d)(\d{2})$/, (whole, a: string, b: string) => (body.querySelector(".elementor-price-table__fractional-part") ? `${a}.${b}` : whole));
      const button = body.querySelector("a.elementor-price-table__button, a.elementor-button");
      const period = textOf(body.querySelector(".elementor-price-table__period"));

      return [
        {
          kind: "price",
          name: textOf(body.querySelector(".elementor-price-table__heading")),
          price: amount || textOf(body.querySelector(".elementor-price-table__price")),
          ...(period ? { period } : {}),
          features: elements(body.querySelectorAll(".elementor-price-table__features-list li")).map(textOf).filter(Boolean),
          ...(button && textOf(button) ? { button: { label: textOf(button), href: button.getAttribute("href") ?? "" } } : {}),
          ...(body.querySelector(".elementor-price-table__ribbon") ? { featured: true } : {}),
        },
      ];
    }
    case "counter": {
      const number = body.querySelector(".elementor-counter-number");
      const value = `${textOf(body.querySelector(".elementor-counter-number-prefix"))}${number?.getAttribute("data-to-value") ?? textOf(number)}${textOf(body.querySelector(".elementor-counter-number-suffix"))}`;

      return [{ kind: "counter", value, label: textOf(body.querySelector(".elementor-counter-title")) }];
    }
    case "image-gallery":
    case "gallery":
    case "image-carousel":
    case "media-carousel": {
      const images = elements(body.querySelectorAll("img"))
        .filter((img) => !img.closest(".swiper-slide-duplicate"))
        .map((img) => image(img)!)
        .filter((picture) => picture.src && !picture.src.startsWith("data:"));

      return images.length ? [{ kind: "gallery", images }] : [];
    }
    case "form": {
      const form = body.querySelector("form");
      const fields = elements(body.querySelectorAll(".elementor-field-group label, .elementor-field-label"))
        .map((label) => textOf(label))
        .filter(Boolean);
      const placeholders = fields.length
        ? []
        : elements(body.querySelectorAll("input[placeholder], textarea[placeholder]")).map((input) => input.getAttribute("placeholder") ?? "");

      return [{ kind: "form", ...(form?.getAttribute("name") ? { name: form.getAttribute("name")! } : {}), fields: [...fields, ...placeholders].filter(Boolean) }];
    }
    case "video": {
      const iframe = body.querySelector("iframe, video");

      if (iframe) return [{ kind: "embed", html: iframe.outerHTML, provider: iframe.nodeName === "IFRAME" ? "video" : "a video file" }];
      // Elementor renders the player lazily; the address sits in data-settings.
      const settings = parseJson(body.closest("[data-settings]")?.getAttribute("data-settings") ?? widget.getAttribute("data-settings") ?? "");
      const url = String(settings.youtube_url ?? settings.vimeo_url ?? (settings.hosted_url as { url?: string } | undefined)?.url ?? "");
      const embed = url ? videoEmbed(url) : null;

      if (embed) return [{ kind: "embed", html: embed.html, provider: embed.provider }];
      return url ? [{ kind: "embed", html: `<video controls src="${url}"></video>`, provider: "a video file" }] : [];
    }
    case "google_maps": {
      const iframe = body.querySelector("iframe");

      return iframe ? [{ kind: "embed", html: iframe.outerHTML, provider: "Google Maps" }] : [];
    }
    case "html":
    case "shortcode":
      return itemsFromHtml(body, context.toMarkdown);
    case "spacer":
    case "divider":
    case "menu-anchor":
    case "nav-menu":
    case "social-icons":
    case "share-buttons":
    case "search-form":
      return [];
    case "icon": {
      return [{ kind: "icon", ...(iconName(body) ? { name: iconName(body) } : {}) }];
    }
    default: {
      // A widget this reader doesn't know: its content as Markdown, so lists and links keep their shape.
      const text = textOf(body) ? context.toMarkdown(body.innerHTML).trim() : "";

      return text ? [{ kind: "other", widget: type || "widget", text }] : [];
    }
  }
}

function cssEscape(id: string): string {
  return id.replace(/[^\w-]/g, (char) => `\\${char}`);
}

function iconName(element: DomElement): string {
  const target = element.querySelector?.("i") ?? element;
  const classes = (target.getAttribute("class") ?? "").split(/\s+/);
  const named = classes.find((name) => /^(fa|eicon)-[\w-]+$/.test(name) && !/^fa-(solid|regular|brands)$/.test(name));

  if (named) return named.replace(/^(fa|eicon)-/, "");
  const svg = element.querySelector?.("svg") ?? null;
  const svgClass = /e-(?:fas|far|fab)-([\w-]+)/.exec(svg?.getAttribute("class") ?? "")?.[1];

  return svgClass ?? "";
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;

    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** An atomic widget is plain HTML (heading, paragraph, button, image, icon); read it like any other HTML. */
function atomicItems(element: DomElement, context: ElementorContext): OutlineItem[] {
  const holder = element.ownerDocument.createElement("div");

  holder.appendChild(element.cloneNode(true));
  if (element.nodeName === "A" && /\be-button-base\b/.test(element.getAttribute("class") ?? "")) {
    const label = textOf(element);

    return label ? [{ kind: "button", label, href: element.getAttribute("href") ?? "" }] : [];
  }
  if (/\be-svg-base\b/.test(element.getAttribute("class") ?? "")) return element.nodeName === "A" ? [] : [{ kind: "icon" }];
  return itemsFromHtml(holder, context.toMarkdown);
}

function widgetItems(element: DomElement, context: ElementorContext): OutlineItem[] {
  return element.hasAttribute("data-widget_type") ? widgetItemsFromDom(element, context) : atomicItems(element, context);
}

function formItems(element: DomElement): OutlineItem[] {
  const fields = elements(element.querySelectorAll("label"))
    .map((label) => textOf(label).replace(/\s*\*$/, ""))
    .filter(Boolean);

  return [{ kind: "form", fields }];
}

function itemsOfDom(element: DomElement, context: ElementorContext): OutlineItem[] {
  const items: OutlineItem[] = [];

  for (const child of typedChildren(element)) {
    const type = typeOf(child);

    if (type === "widget") {
      items.push(...widgetItems(child, context));
    } else if (/^e-form$/.test(type)) {
      items.push(...formItems(child));
    } else if (type === "column") {
      items.push(...itemsOfDom(child, context));
    } else if (isContainer(type)) {
      const columns = columnsOfDom(child, context);

      if (columns.length > 1) items.push({ kind: "row", columns });
      else items.push(...(columns[0]?.items ?? []));
    }
  }
  return items;
}

function columnsOfDom(element: DomElement, context: ElementorContext): OutlineColumn[] {
  const children = typedChildren(element);
  const type = typeOf(element);

  if (type === "section") {
    return children.filter((child) => typeOf(child) === "column").map((column) => ({ ...(widthOf(column) ? { width: widthOf(column)! } : {}), items: itemsOfDom(column, context) }));
  }
  // A container: child containers side by side are its columns; widgets directly inside are one column.
  const containers = children.filter((child) => isContainer(typeOf(child)));

  if (containers.length >= 2 && containers.length === children.length && isRow(element)) {
    return containers.map((container) => ({ items: itemsOfDom(container, context) }));
  }
  return [{ items: itemsOfDom(element, context) }];
}

/** Containers stacked in a column are not side-by-side columns; Elementor marks direction in data-settings. */
function isRow(element: DomElement): boolean {
  const settings = parseJson(element.getAttribute("data-settings") ?? "");

  return !String(settings.flex_direction ?? "").startsWith("column");
}

export function elementorOutlineFromHtml(html: string, context: ElementorContext): PageOutline {
  const root = parseFragment(html);
  const layout = root.querySelector("[data-elementor-type]") ?? root;
  let tops = typedChildren(layout).filter((element) => typeOf(element) !== "column");

  // One wrapper around the whole page is not a section: look inside it until the page splits into parts.
  for (let guard = 0; guard < 6 && tops.length === 1 && isContainer(typeOf(tops[0]!)); guard += 1) {
    const inner = typedChildren(tops[0]!);

    if (inner.length < 2 || !inner.every((element) => isContainer(typeOf(element)))) break;
    tops = inner;
  }
  const sections: OutlineSection[] = [];

  for (const top of tops) {
    const type = typeOf(top);
    const columns = type === "widget" ? [{ items: widgetItems(top, context) }] : /^e-form$/.test(type) ? [{ items: formItems(top) }] : columnsOfDom(top, context);

    if (columns.every((column) => column.items.length === 0)) continue;
    const anchor = top.getAttribute("id") || top.querySelector(".elementor-menu-anchor")?.getAttribute("id") || undefined;
    const base = { index: sections.length, ...(anchor ? { anchor } : {}), columns };

    sections.push({ ...base, hints: sectionHints(base) });
  }
  return { builder: "elementor", from: "html", sections };
}

// ─────────────────────────────────────────────────────────── from _elementor_data

interface ElementorElement {
  id?: string;
  elType?: string;
  widgetType?: string;
  isInner?: boolean;
  settings?: Record<string, unknown>;
  elements?: ElementorElement[];
}

const CURRENCIES: Record<string, string> = {
  dollar: "$",
  euro: "€",
  pound: "£",
  yen: "¥",
  rupee: "₹",
  indian_rupee: "₹",
  real: "R$",
  krona: "kr",
  franc: "₣",
  shekel: "₪",
  baht: "฿",
  lira: "₺",
  ruble: "₽",
  peso: "₱",
  won: "₩",
  guilder: "ƒ",
};

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function urlOf(value: unknown): string {
  return value && typeof value === "object" ? str((value as { url?: unknown }).url) : "";
}

function plain(html: string): string {
  return /[<&]/.test(html) ? collapse(parseFragment(html).textContent ?? "") : collapse(html);
}

function widgetItemsFromData(element: ElementorElement, context: ElementorContext): OutlineItem[] {
  const s = element.settings ?? {};
  const md = (html: string) => context.toMarkdown(html).trim();
  const imageOf = (value: unknown) => {
    const url = urlOf(value);
    const id = Number((value as { id?: unknown } | undefined)?.id);
    const media = Number.isFinite(id) ? context.mediaById?.(id) : undefined;

    return url ? { src: url, alt: str((value as { alt?: unknown }).alt) || media?.alt || "" } : null;
  };

  switch (element.widgetType) {
    case "heading": {
      const text = plain(str(s.title));
      const level = Number(/^h(\d)$/.exec(str(s.header_size) || "h2")?.[1] ?? 2);

      return text ? [{ kind: "heading", level, text }] : [];
    }
    case "animated-headline": {
      const text = collapse([str(s.before_text), str(s.highlighted_text) || str(s.rotating_text).split("\n")[0], str(s.after_text)].join(" "));

      return text ? [{ kind: "heading", level: Number(/^h(\d)$/.exec(str(s.tag) || "h3")?.[1] ?? 3), text }] : [];
    }
    case "text-editor":
      return itemsFromHtml(parseFragment(str(s.editor)), context.toMarkdown);
    case "image": {
      const picture = imageOf(s.image);

      if (!picture) return [];
      const caption = s.caption_source === "custom" ? str(s.caption) : "";
      const href = s.link_to === "custom" ? urlOf(s.link) : "";

      return [{ kind: "image", ...picture, ...(caption ? { caption } : {}), ...(href ? { href } : {}) }];
    }
    case "button":
      return str(s.text) ? [{ kind: "button", label: plain(str(s.text)), href: urlOf(s.link) }] : [];
    case "icon-box":
    case "image-box":
    case "call-to-action":
    case "flip-box": {
      const picture = imageOf(s.image ?? s.bg_image);
      const icon = (s.selected_icon as { value?: unknown } | undefined)?.value ?? s.icon;
      const heading = plain(str(s.title_text ?? s.title ?? s.title_text_a));
      const text = str(s.description_text ?? s.description ?? s.description_text_a);
      const label = plain(str(s.button ?? s.button_text));

      return [
        {
          kind: "card",
          ...(icon && !picture ? { icon: str(icon).replace(/^.*\bfa-/, "") } : {}),
          ...(picture && element.widgetType !== "call-to-action" ? { image: picture } : {}),
          ...(heading ? { heading } : {}),
          ...(text ? { text: md(text) } : {}),
          ...(label ? { link: { label, href: urlOf(s.link) } } : {}),
        },
      ];
    }
    case "icon-list": {
      const list = (Array.isArray(s.icon_list) ? s.icon_list : []).map((entry) => plain(str((entry as { text?: unknown }).text))).filter(Boolean);

      return list.length ? [{ kind: "list", items: list }] : [];
    }
    case "testimonial": {
      const name = plain(str(s.testimonial_name));
      const role = plain(str(s.testimonial_job));
      const picture = imageOf(s.testimonial_image);

      return [{ kind: "quote", text: plain(str(s.testimonial_content)), ...(name ? { name } : {}), ...(role ? { role } : {}), ...(picture ? { image: picture.src } : {}) }];
    }
    case "testimonial-carousel":
    case "reviews":
      return (Array.isArray(s.slides) ? s.slides : []).flatMap((slide): OutlineItem[] => {
        const entry = slide as Record<string, unknown>;
        const text = plain(str(entry.content));
        const name = plain(str(entry.name));
        const role = plain(str(entry.title));

        return text ? [{ kind: "quote", text, ...(name ? { name } : {}), ...(role ? { role } : {}) }] : [];
      });
    case "accordion":
    case "toggle": {
      const qa = (Array.isArray(s.tabs) ? s.tabs : []).map((tab) => ({ question: plain(str((tab as { tab_title?: unknown }).tab_title)), answer: md(str((tab as { tab_content?: unknown }).tab_content)) }));

      return qa.length ? [{ kind: "faq", items: qa.filter((entry) => entry.question) }] : [];
    }
    case "nested-accordion": {
      const titles = (Array.isArray(s.items) ? s.items : []).map((item) => plain(str((item as { item_title?: unknown }).item_title)));
      const answers = (element.elements ?? []).map((child) => itemsOfData(child, context));
      const qa = titles.map((question, i) => ({ question, answer: (answers[i] ?? []).map((item) => (item.kind === "text" ? item.markdown : "text" in item ? String(item.text ?? "") : "")).filter(Boolean).join("\n\n") }));

      return qa.length ? [{ kind: "faq", items: qa }] : [];
    }
    case "price-table": {
      const symbol = s.currency_symbol === "custom" ? str(s.currency_symbol_custom) : (CURRENCIES[str(s.currency_symbol) || "dollar"] ?? "");
      const period = plain(str(s.period));
      const label = plain(str(s.button_text));

      return [
        {
          kind: "price",
          name: plain(str(s.heading)),
          price: `${symbol}${str(s.price)}`,
          ...(period ? { period } : {}),
          features: (Array.isArray(s.features_list) ? s.features_list : []).map((feature) => plain(str((feature as { item_text?: unknown }).item_text))).filter(Boolean),
          ...(label ? { button: { label, href: urlOf(s.link) } } : {}),
          ...(s.show_ribbon === "yes" ? { featured: true } : {}),
        },
      ];
    }
    case "price-list":
      return (Array.isArray(s.price_list) ? s.price_list : []).map((entry): OutlineItem => {
        const row = entry as Record<string, unknown>;

        return { kind: "price", name: plain(str(row.title)), price: plain(str(row.price)), features: str(row.item_description) ? [plain(str(row.item_description))] : [] };
      });
    case "counter": {
      const value = `${str(s.prefix)}${str(s.ending_number)}${str(s.suffix)}`;

      return [{ kind: "counter", value, label: plain(str(s.title)) }];
    }
    case "image-gallery":
    case "gallery":
    case "image-carousel":
    case "media-carousel": {
      const list = (s.wp_gallery ?? s.gallery ?? s.carousel ?? s.slides) as unknown;
      const images = (Array.isArray(list) ? list : []).map((entry) => imageOf((entry as { image?: unknown }).image ?? entry)).filter((picture): picture is { src: string; alt: string } => Boolean(picture));

      return images.length ? [{ kind: "gallery", images }] : [];
    }
    case "form": {
      const fields = (Array.isArray(s.form_fields) ? s.form_fields : []).map((field) => {
        const entry = field as Record<string, unknown>;

        return plain(str(entry.field_label) || str(entry.placeholder) || str(entry.custom_id));
      });

      return [{ kind: "form", ...(str(s.form_name) ? { name: str(s.form_name) } : {}), fields: fields.filter(Boolean) }];
    }
    case "video": {
      const type = str(s.video_type) || "youtube";
      const url = type === "hosted" ? urlOf(s.hosted_url) : str(s[`${type}_url`]);
      const embed = url ? videoEmbed(url) : null;

      if (embed) return [{ kind: "embed", html: embed.html, provider: embed.provider }];
      return url ? [{ kind: "embed", html: `<video controls src="${url}"></video>`, provider: "a video file" }] : [];
    }
    case "google_maps": {
      const address = str(s.address);

      return address
        ? [{ kind: "embed", html: `<iframe src="https://maps.google.com/maps?q=${encodeURIComponent(address)}&amp;output=embed" width="600" height="450" title="${address.replace(/"/g, "&quot;")}" loading="lazy"></iframe>`, provider: "Google Maps" }]
        : [];
    }
    case "html":
      return itemsFromHtml(parseFragment(str(s.html)), context.toMarkdown);
    case "shortcode":
      return str(s.shortcode) ? [{ kind: "other", widget: "shortcode", text: str(s.shortcode) }] : [];
    case "icon": {
      const icon = (s.selected_icon as { value?: unknown } | undefined)?.value;

      return [{ kind: "icon", ...(icon ? { name: str(icon).replace(/^.*\bfa-/, "") } : {}) }];
    }
    case "spacer":
    case "divider":
    case "menu-anchor":
    case "nav-menu":
    case "social-icons":
    case "share-buttons":
    case "search-form":
      return [];
    default: {
      const text = textSettings(s);

      return text ? [{ kind: "other", widget: element.widgetType ?? "widget", text }] : [];
    }
  }
}

/** For widgets we don't know: the words they carry, so nothing silently disappears. */
function textSettings(settings: Record<string, unknown>): string {
  const out: string[] = [];
  const visit = (value: unknown, key: string) => {
    if (typeof value === "string" && /(title|text|content|editor|description|heading|label)$/i.test(key) && value.trim()) out.push(plain(value));
    else if (Array.isArray(value)) value.forEach((entry) => visit(entry, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, k);
  };

  for (const [key, value] of Object.entries(settings)) visit(value, key);
  return out.join(" — ");
}

function itemsOfData(element: ElementorElement, context: ElementorContext): OutlineItem[] {
  if (element.elType === "widget") return widgetItemsFromData(element, context);
  const columns = columnsOfData(element, context);

  if (columns.length > 1) return [{ kind: "row", columns }];
  return columns[0]?.items ?? [];
}

function columnsOfData(element: ElementorElement, context: ElementorContext): OutlineColumn[] {
  const children = element.elements ?? [];

  if (element.elType === "section") {
    return children
      .filter((child) => child.elType === "column")
      .map((column) => {
        const width = Number(column.settings?._column_size ?? column.settings?._inline_size);

        return { ...(Number.isFinite(width) && width > 0 ? { width } : {}), items: column.elements?.flatMap((child) => itemsOfData(child, context)) ?? [] };
      });
  }
  if (element.elType === "column") return [{ items: children.flatMap((child) => itemsOfData(child, context)) }];
  const containers = children.filter((child) => child.elType === "container");
  const direction = str(element.settings?.flex_direction);
  // Containers are side by side when the parent's direction is a row; when the export doesn't say, a parent holding only containers is read as a row.
  const sideBySide = direction.startsWith("row") || direction === "";

  if (containers.length >= 2 && containers.length === children.length && sideBySide) {
    return containers.map((container) => {
      const width = Number((container.settings?.width as { size?: unknown } | undefined)?.size);

      return { ...(Number.isFinite(width) && width > 0 ? { width } : {}), items: itemsOfData(container, context) };
    });
  }
  return [{ items: children.flatMap((child) => itemsOfData(child, context)) }];
}

/** `_elementor_data` as stored: a JSON string (an array of top-level elements). */
export function parseElementorData(value: unknown): ElementorElement[] | null {
  let data = value;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  return Array.isArray(data) ? (data as ElementorElement[]) : null;
}

export function elementorOutlineFromData(value: unknown, context: ElementorContext): PageOutline | null {
  const data = parseElementorData(value);

  if (!data) return null;
  const sections: OutlineSection[] = [];

  for (const top of data) {
    const columns = top.elType === "widget" ? [{ items: widgetItemsFromData(top, context) }] : columnsOfData(top, context);

    if (columns.every((column) => column.items.length === 0)) continue;
    const anchor = str(top.settings?._element_id) || undefined;
    const base = { index: sections.length, ...(anchor ? { anchor } : {}), columns };

    sections.push({ ...base, hints: sectionHints(base) });
  }
  return { builder: "elementor", from: "elementor-data", sections };
}
