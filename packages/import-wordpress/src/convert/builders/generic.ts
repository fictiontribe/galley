/**
 * Divi, WPBakery and Beaver Builder pages → outline.
 *
 * These builders render rows of columns of modules with their own class
 * names; an export file carries Divi and WPBakery layouts as shortcodes,
 * which convert/shortcodes.ts turns into the same plain structure
 * (`data-gwp-role="section|row|column|module"`). Either way the page is read
 * as sections → columns → items. The common content modules (blurbs and
 * call-outs, testimonials, toggles, price tables, counters) are recognised;
 * everything else contributes its headings, text, images, buttons and lists.
 */
import type { BuilderName, OutlineColumn, OutlineSection, PageOutline } from "../../types";
import { elements, parseFragment, textOf, type DomDocument, type DomElement } from "../dom";
import { itemsFromHtml, sectionHints, type HtmlToMarkdown } from "../outline";

interface Layout {
  section: string;
  column: string;
}

const LAYOUTS: Record<BuilderName | "shortcodes", Layout> = {
  shortcodes: { section: '[data-gwp-role="section"]', column: '[data-gwp-role="column"]' },
  divi: { section: ".et_pb_section", column: ".et_pb_column" },
  wpbakery: { section: ".vc_section, .vc_row:not(.vc_inner)", column: ".wpb_column, .vc_column_container" },
  beaver: { section: ".fl-row", column: ".fl-col" },
  elementor: { section: ".elementor-top-section, .e-con.e-parent", column: ".elementor-top-column" },
};

/** Which builder rendered this HTML, judged by its layout classes. */
export function builderOfHtml(html: string): BuilderName | null {
  if (/data-elementor-type=|\belementor-section\b|data-element_type="(section|container)"/.test(html)) return "elementor";
  if (/\bet_pb_section\b|\bet_pb_row\b/.test(html)) return "divi";
  if (/\bvc_row\b|\bwpb_row\b|\bwpb_column\b/.test(html)) return "wpbakery";
  if (/\bfl-builder-content\b|\bfl-row\b/.test(html)) return "beaver";
  return null;
}

function replaceWith(doc: DomDocument, element: DomElement, html: string): void {
  const holder = doc.createElement("div");

  holder.innerHTML = html;
  element.replaceWith(holder);
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Rewrites the builders' rendered modules into the plain shapes the outline reader knows. */
function normalizeModules(root: DomElement): void {
  const doc = root.ownerDocument;

  for (const blurb of elements(root.querySelectorAll(".et_pb_blurb, .fl-callout, .vc_cta3"))) {
    const img = blurb.querySelector("img");
    const heading = textOf(blurb.querySelector(".et_pb_module_header, .fl-callout-title, h1, h2, h3, h4, h5, h6"));
    const text = blurb.querySelector(".et_pb_blurb_description, .fl-callout-text, .vc_cta3-content p");
    const icon = blurb.querySelector(".et-pb-icon, .fl-icon, i");
    const link = blurb.querySelector("a.fl-button, a.et_pb_more_button");

    replaceWith(
      doc,
      blurb,
      `<div class="gwp-card">${img ? `<img src="${esc(img.getAttribute("src") ?? "")}" alt="${esc(img.getAttribute("alt") ?? "")}">` : ""}${icon && !img ? '<i class="gwp-icon"></i>' : ""}${heading ? `<h3>${esc(heading)}</h3>` : ""}${text ? text.innerHTML : ""}${link ? `<a class="gwp-button" href="${esc(link.getAttribute("href") ?? "")}">${esc(textOf(link))}</a>` : ""}</div>`
    );
  }
  for (const quote of elements(root.querySelectorAll(".et_pb_testimonial, .fl-testimonial"))) {
    const text = textOf(quote.querySelector(".et_pb_testimonial_description_inner, .fl-testimonial-text") ?? quote);
    const author = textOf(quote.querySelector(".et_pb_testimonial_author, .fl-testimonial-author"));
    const role = textOf(quote.querySelector(".et_pb_testimonial_position, .fl-testimonial-role"));

    replaceWith(doc, quote, `<blockquote><p>${esc(text)}</p>${author ? `<cite>${esc(author)}${role ? `, ${esc(role)}` : ""}</cite>` : ""}</blockquote>`);
  }
  for (const toggle of elements(root.querySelectorAll(".et_pb_toggle, .vc_toggle, .vc_tta-panel, .fl-accordion-item"))) {
    const title = textOf(toggle.querySelector(".et_pb_toggle_title, .vc_toggle_title, .vc_tta-title-text, .fl-accordion-button-label"));
    const body = toggle.querySelector(".et_pb_toggle_content, .vc_toggle_content, .vc_tta-panel-body, .fl-accordion-content");

    replaceWith(doc, toggle, `<details><summary>${esc(title)}</summary>${body?.innerHTML ?? ""}</details>`);
  }
  for (const table of elements(root.querySelectorAll(".et_pb_pricing_table, .fl-pricing-table-column"))) {
    const name = textOf(table.querySelector(".et_pb_pricing_title, .fl-pricing-table-title"));
    const amount = `${textOf(table.querySelector(".et_pb_dollar_sign"))}${textOf(table.querySelector(".et_pb_sum, .fl-pricing-table-price"))}`;
    const period = textOf(table.querySelector(".et_pb_frequency, .fl-pricing-table-duration"));
    const features = elements(table.querySelectorAll(".et_pb_pricing li, .fl-pricing-table-features li")).map(textOf).filter(Boolean);
    const button = table.querySelector("a.et_pb_pricing_table_button, a.fl-button");

    replaceWith(
      doc,
      table,
      `<div class="gwp-price"${table.getAttribute("class")?.includes("featured") ? ' data-featured="1"' : ""}><h3>${esc(name)}</h3><p class="gwp-amount">${esc(amount)}${period ? `<span class="gwp-period">${esc(period)}</span>` : ""}</p><ul>${features.map((feature) => `<li>${esc(feature)}</li>`).join("")}</ul>${button ? `<a class="gwp-button" href="${esc(button.getAttribute("href") ?? "")}">${esc(textOf(button))}</a>` : ""}</div>`
    );
  }
  for (const counter of elements(root.querySelectorAll(".et_pb_number_counter, .fl-number"))) {
    const value = counter.getAttribute("data-number-value") ?? textOf(counter.querySelector(".percent-value, .fl-number-int"));
    const label = textOf(counter.querySelector("h3, .title, .fl-number-after-text"));

    replaceWith(doc, counter, `<div class="gwp-counter"><span class="gwp-value">${esc(value)}</span><span class="gwp-label">${esc(label)}</span></div>`);
  }
}

function nearest(element: DomElement, selector: string, stop: DomElement): DomElement | null {
  let node = element.parentNode;

  while (node && node !== stop) {
    if (node.nodeType === 1 && node.matches(selector)) return node;
    node = node.parentNode;
  }
  return null;
}

function widthOf(column: DomElement): number | undefined {
  const fromData = Number(column.getAttribute("data-gwp-width"));

  if (Number.isFinite(fromData) && fromData > 0) return fromData;
  const classes = column.getAttribute("class") ?? "";
  const divi = /\bet_pb_column_(\d)_(\d)\b/.exec(classes);
  const bakery = /\bvc_col-(?:sm|md|lg|xs)-(\d+)\b/.exec(classes);

  if (divi) return Math.round((Number(divi[1]) / Number(divi[2])) * 100);
  if (bakery) return Math.round((Number(bakery[1]) / 12) * 100);
  return undefined;
}

export function builderOutlineFromHtml(html: string, builder: BuilderName, from: "html" | "shortcodes", toMarkdown: HtmlToMarkdown): PageOutline {
  const root = parseFragment(html);
  const layout = LAYOUTS[from === "shortcodes" ? "shortcodes" : builder];

  normalizeModules(root);
  const sections: OutlineSection[] = [];
  const tops = elements(root.querySelectorAll(layout.section)).filter((section) => !nearest(section, layout.section, root));
  const blocks = tops.length > 0 ? tops : [root];

  for (const top of blocks) {
    const columns: OutlineColumn[] = elements(top.querySelectorAll(layout.column))
      .filter((column) => !nearest(column, layout.column, top))
      .map((column) => ({ ...(widthOf(column) ? { width: widthOf(column)! } : {}), items: itemsFromHtml(column, toMarkdown) }));
    const filled = columns.length > 0 ? columns : [{ items: itemsFromHtml(top, toMarkdown) }];

    if (filled.every((column) => column.items.length === 0)) continue;
    const anchor = top.getAttribute("id") || undefined;
    const base = { index: sections.length, ...(anchor ? { anchor } : {}), columns: filled };

    sections.push({ ...base, hints: sectionHints(base) });
  }
  return { builder, from, sections };
}
