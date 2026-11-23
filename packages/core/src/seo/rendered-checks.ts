/**
 * Checks over the rendered pages: what visitors and crawlers are actually
 * sent. They run only on a preview or build that already exists, over a
 * stated sample, and report evidence straight from the HTML.
 */
import type { MediaItem } from "../types";
import type { ContentPage } from "./content";
import { leadImageFix, withoutBrand } from "./content-checks";
import { finding } from "./finding";
import { pathKey } from "./files";
import { jsonLdNodes, typesOf, type PageFacts } from "./html";
import { cut, DISPLAY, fitWidth, textWidth, wordCount } from "./text";
import type { Finding } from "./types";

export interface RenderedPage {
  urlPath: string;
  status: number;
  facts: PageFacts;
  page: ContentPage | null;
}

export const PLACEHOLDER_HOST = /(^|\.)(example\.(com|org|net)|localhost|127\.0\.0\.1)$/i;
const FILE_NAME_ALT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const BARE_ALT = /^(image|picture|photo|graphic|img|spacer)$/i;

function where(rendered: RenderedPage) {
  const page = rendered.page;

  return page
    ? { path: page.path, url: page.url, ...(page.title ? { pageTitle: page.title.value } : {}), rendered: true }
    : { url: rendered.urlPath, ...(rendered.facts.title ? { pageTitle: rendered.facts.title } : {}), rendered: true };
}

export function robotsMeta(facts: PageFacts): string {
  return `${facts.metas.get("robots") ?? ""} ${facts.metas.get("googlebot") ?? ""}`.toLowerCase();
}

export function isNoindex(facts: PageFacts): boolean {
  return /noindex|\bnone\b/.test(robotsMeta(facts));
}

/** The site's own name as the page declares it (og:site_name), else the app's name for the site. */
export function brandOf(facts: PageFacts, fallback: string): string {
  return facts.metas.get("og:site_name")?.trim() || fallback;
}

export function renderedTitleChecks(rendered: RenderedPage, siteName: string): Finding[] {
  const { facts } = rendered;
  const out: Finding[] = [];
  const at = where(rendered);
  const page = rendered.page;

  if (!facts.title) {
    if (!page?.title) out.push(finding("title-missing", { ...at, evidence: { note: "The page is sent without a title." } }));
    return out;
  }
  const brand = brandOf(facts, siteName);
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const repeats = brand.length >= 3 ? (facts.title.match(new RegExp(escaped, "gi")) ?? []).length : 0;

  if (repeats >= 2) {
    // The site adds its name; the title field has it too. Taking it off the field is the unambiguous fix.
    const stored = page?.title?.value;
    const fixed = stored && page?.title?.field ? withoutBrand(stored, brand) : null;

    out.push(
      finding("title-brand-repeated", {
        ...at,
        field: page?.title?.field ?? null,
        ...(page?.title ? { fieldLabel: page.title.label } : {}),
        evidence: { value: facts.title, note: `“${brand}” appears ${repeats} times in the title the page is sent with.` },
        // A name used naturally ("About Ferrow · Ferrow") is less clear-cut than a doubled suffix.
        ...(fixed ? {} : { severity: "idea" as const }),
        ...(fixed && page ? { fix: { label: "Remove the repeated name", before: stored!, after: fixed, edits: [{ path: page.path, ops: [{ op: "set" as const, path: page.title!.field!, value: fixed }], summary: `Set ${page.title!.label} to “${fixed}”` }] } } : {}),
      })
    );
  }
  const width = textWidth(facts.title, DISPLAY.title.fontPx);

  if (width > DISPLAY.title.limit) {
    out.push(
      finding("title-long", {
        ...at,
        field: page?.title?.field ?? null,
        write: page?.title?.field ? "title" : null,
        evidence: {
          value: facts.title,
          measure: { label: "Estimated width in a desktop result", value: width, limit: DISPLAY.title.limit, unit: "px", reasoning: DISPLAY.title.reasoning },
          note: `Would likely show as “${fitWidth(facts.title, DISPLAY.title.fontPx, DISPLAY.title.limit).shown}”.`,
        },
      })
    );
  }
  const rest = facts.title.replace(new RegExp(escaped, "gi"), "").replace(/[\s|·—–\-:•»]+/g, " ").trim();

  if (rest.length <= 3) out.push(finding("title-short", { ...at, field: page?.title?.field ?? null, write: page?.title?.field ? "title" : null, evidence: { value: facts.title, note: rest ? undefined : "Apart from the site's name, the title is empty." } }));
  return out;
}

export function renderedDescriptionChecks(rendered: RenderedPage): Finding[] {
  const description = rendered.facts.metas.get("description")?.trim() ?? "";

  if (description || isNoindex(rendered.facts)) return [];
  return [finding("description-missing", { ...where(rendered), field: rendered.page?.descriptionField ?? null, write: rendered.page?.descriptionField ? "description" : null, evidence: { note: "The page is sent without a description." } })];
}

export function headingChecks(rendered: RenderedPage): Finding[] {
  const out: Finding[] = [];
  const { headings } = rendered.facts;
  const at = where(rendered);
  const ones = headings.filter((heading) => heading.level === 1);

  if (ones.length === 0) out.push(finding("h1-missing", { ...at, evidence: { note: headings.length ? `The first heading is level ${headings[0]!.level}: “${cut(headings[0]!.text, 80)}”.` : "The page has no headings at all." } }));
  else if (ones.length > 1) out.push(finding("h1-multiple", { ...at, evidence: { values: ones.map((heading) => cut(heading.text, 80)) } }));
  // A skip is going down more than one level; coming back up (h4 → h2) is fine.
  for (let i = 1; i < headings.length; i += 1) {
    const before = headings[i - 1]!;
    const heading = headings[i]!;

    if (heading.level > before.level + 1) {
      out.push(finding("heading-skip", { ...at, evidence: { values: [`h${before.level} “${cut(before.text, 60)}”`, `h${heading.level} “${cut(heading.text, 60)}”`], note: `Goes from level ${before.level} to level ${heading.level}.` } }));
      break;
    }
  }
  return out;
}

/**
 * `contentAlts`: for images whose alt text lives in a content field, the
 * values stored there. A problem that comes from the field is reported once,
 * on the entry that holds it — not again on every listing page that shows
 * the picture; a page that drops or changes the stored text is reported.
 */
export async function imageRenderChecks(rendered: RenderedPage, media: Map<string, MediaItem>, size: (url: string) => Promise<number | null>, contentAlts: Map<string, Set<string>> = new Map()): Promise<Finding[]> {
  const out: Finding[] = [];
  const at = where(rendered);
  let missingDims = 0;
  const examples: string[] = [];

  for (const image of rendered.facts.images) {
    if (!image.src || image.src.startsWith("data:")) continue;
    const src = image.src.split(/[?#]/)[0]!;
    const local = /^\/(?!\/)/.test(src);

    const stored = contentAlts.get(image.src);

    if (image.alt === null && !(stored && [...stored].every((alt) => alt.trim() === ""))) {
      out.push(finding("image-alt-missing", { ...at, key: image.src, evidence: { value: image.src, note: "The image has no alt attribute at all. Give it a description, or alt=\"\" if it's purely decorative." } }));
    } else if (image.alt && !stored?.has(image.alt)) {
      const alt = image.alt.trim();

      if (FILE_NAME_ALT.test(alt) || BARE_ALT.test(alt)) out.push(finding("image-alt-filename", { ...at, key: image.src, evidence: { value: alt, note: `For ${image.src}.` } }));
    }
    if (!image.width || !image.height) {
      if (!image.ratioStyle) {
        missingDims += 1;
        if (examples.length < 5) examples.push(image.src);
      }
    }
    if (local && !/\.svg$/i.test(src)) {
      const item = media.get(src);
      const shownWidth = Number(image.width);

      if (item?.width && shownWidth > 0 && !image.srcset && item.width > shownWidth * 2.5 && item.width > 1600) {
        out.push(finding("image-oversized", { ...at, key: image.src, evidence: { value: image.src, measure: { label: "Width of the file", value: item.width, limit: Math.round(shownWidth * 2.5), unit: "pixels wide", reasoning: `The page shows it at most ${shownWidth} px wide (its width attribute) and offers no smaller versions. Flagged past two and a half times that, which covers sharp screens.` } } }));
      } else {
        const bytes = item?.size ?? (await size(src));

        if (bytes !== null && bytes > 1_000_000) out.push(finding("image-oversized", { ...at, key: image.src, evidence: { value: image.src, measure: { label: "File size", value: bytes, limit: 1_000_000, unit: "bytes", reasoning: "Flagged above 1 MB: most photos for the web compress well below that." } } }));
      }
    }
  }
  if (missingDims > 0) out.push(finding("image-dimensions-missing", { ...at, evidence: { values: examples, note: `${missingDims} image${missingDims === 1 ? "" : "s"} without width and height, and no reserved space.` } }));
  return out;
}

export async function shareImageRenderChecks(rendered: RenderedPage, exists: (urlPath: string) => Promise<boolean>): Promise<Finding[]> {
  const og = rendered.facts.metas.get("og:image")?.trim();
  const at = where(rendered);

  if (isNoindex(rendered.facts)) return [];
  if (!og) return [finding("share-image-missing", { ...at, field: rendered.page?.shareImageField ?? null, fix: leadImageFix(rendered.page) })];
  let path: string | null = null;

  try {
    const url = new URL(og, "http://local.invalid");

    path = url.hostname === "local.invalid" || PLACEHOLDER_HOST.test(url.hostname) ? url.pathname : null;
  } catch {
    path = null;
  }
  if (path && !(await exists(path))) return [finding("share-image-broken", { ...at, field: rendered.page?.shareImageField ?? null, evidence: { value: og } })];
  return [];
}

export function linkRenderChecks(rendered: RenderedPage, idsOf: (urlPath: string) => Set<string> | null): Finding[] {
  const out: Finding[] = [];
  const at = where(rendered);
  let empty = 0;
  const emptyExamples: string[] = [];

  for (const anchor of rendered.facts.anchors) {
    if (!anchor.text && !anchor.label && !anchor.imageAlt.trim()) {
      empty += 1;
      if (emptyExamples.length < 5) emptyExamples.push(anchor.href || "(no address)");
    }
    const hash = anchor.href.indexOf("#");

    if (hash === -1 || anchor.href.length === hash + 1) continue;
    const target = anchor.href.slice(0, hash) || rendered.urlPath;

    if (!/^\/(?!\/)/.test(target)) continue;
    let fragment = anchor.href.slice(hash + 1);

    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      // Keep it as written.
    }
    const ids = idsOf(pathKey(target));

    if (ids && !ids.has(fragment) && fragment !== "top" && fragment !== "main") {
      out.push(finding("link-anchor-missing", { ...at, key: anchor.href, evidence: { value: anchor.href, note: `No element on ${target} has the id “${fragment}”.` } }));
    }
  }
  if (empty) out.push(finding("link-text-empty", { ...at, evidence: { values: emptyExamples, note: `${empty} link${empty === 1 ? "" : "s"} with no text, label or image description.` } }));
  return out;
}

export function canonicalChecks(rendered: RenderedPage): Finding[] {
  const out: Finding[] = [];
  const at = where(rendered);
  const canonicals = rendered.facts.links.filter((link) => link.rel === "canonical").map((link) => link.href);

  if (isNoindex(rendered.facts)) return out;
  if (canonicals.length === 0) return [finding("canonical-missing", at)];
  if (new Set(canonicals).size > 1) out.push(finding("canonical-multiple", { ...at, evidence: { values: canonicals } }));
  const first = canonicals[0]!;

  if (!/^https?:\/\//i.test(first)) {
    out.push(finding("canonical-relative", { ...at, evidence: { value: first } }));
    return out;
  }
  try {
    const url = new URL(first);

    if (pathKey(url.pathname) !== pathKey(rendered.urlPath)) out.push(finding("canonical-elsewhere", { ...at, evidence: { value: first, note: `This page is ${rendered.urlPath}.` } }));
  } catch {
    out.push(finding("canonical-relative", { ...at, evidence: { value: first } }));
  }
  return out;
}

const REQUIRED: Array<{ types: string[]; check: (node: Record<string, unknown>) => string[]; source: string }> = [
  {
    types: ["BreadcrumbList"],
    source: "googleBreadcrumb",
    check(node) {
      const items = Array.isArray(node.itemListElement) ? (node.itemListElement as Array<Record<string, unknown>>) : [];
      const missing: string[] = [];

      if (items.length < 2) missing.push("at least two itemListElement entries");
      items.forEach((item, index) => {
        if (typeof item?.position !== "number") missing.push(`position on item ${index + 1}`);
        if (!item?.name && !(item?.item && typeof item.item === "object" && (item.item as Record<string, unknown>).name)) missing.push(`name on item ${index + 1}`);
        if (index < items.length - 1 && !item?.item) missing.push(`item (its address) on item ${index + 1}`);
      });
      return missing;
    },
  },
  { types: ["WebSite"], source: "googleSiteNames", check: (node) => ["name", "url"].filter((key) => !node[key]) },
  { types: ["Event"], source: "googleEvent", check: (node) => ["name", "startDate", "location"].filter((key) => !node[key]) },
  {
    types: ["LocalBusiness", "Restaurant", "Store", "ProfessionalService", "MedicalBusiness", "LegalService", "FinancialService", "FoodEstablishment", "HealthAndBeautyBusiness", "HomeAndConstructionBusiness", "AutomotiveBusiness", "LodgingBusiness"],
    source: "googleLocalBusiness",
    check: (node) => ["name", "address"].filter((key) => !node[key]),
  },
  { types: ["Product"], source: "googleProduct", check: (node) => [...(!node.name ? ["name"] : []), ...(!node.offers && !node.review && !node.aggregateRating ? ["one of offers, review or aggregateRating"] : [])] },
];

export function structuredDataChecks(rendered: RenderedPage): { findings: Finding[]; types: string[] } {
  const out: Finding[] = [];
  const at = where(rendered);
  const types = new Set<string>();

  rendered.facts.jsonld.forEach((block, index) => {
    if (block.error) {
      out.push(finding("jsonld-invalid", { ...at, key: String(index), evidence: { value: cut(block.raw, 160), note: block.error } }));
      return;
    }
    for (const node of jsonLdNodes(block.value)) {
      const nodeTypes = typesOf(node);

      for (const type of nodeTypes) types.add(type);
      for (const rule of REQUIRED) {
        if (!nodeTypes.some((type) => rule.types.includes(type))) continue;
        const missing = rule.check(node);

        if (missing.length) out.push(finding("jsonld-required-missing", { ...at, key: `${index}:${nodeTypes[0]}`, title: `${nodeTypes[0]} details are missing required properties`, evidence: { values: missing, note: `Google lists these as required for ${nodeTypes[0]}.` } }));
      }
      if (nodeTypes.includes("FAQPage")) out.push(finding("jsonld-faq-retired", { ...at, key: String(index) }));
    }
  });
  return { findings: out, types: [...types].sort() };
}

export function jsOnlyCheck(rendered: RenderedPage): Finding[] {
  const page = rendered.page;
  const sent = wordCount(rendered.facts.text);

  if (!page || page.words < 150 || sent >= 40 || sent >= page.words * 0.2) return [];
  return [finding("js-only-content", { ...where(rendered), evidence: { measure: { label: "Words in the page as sent, before any script runs", value: sent, limit: page.words, unit: "words", reasoning: `The content has ${page.words} words; the HTML the server sends has ${sent}. The rest is added by scripts in the browser.` } } })];
}

export function noindexRenderedCheck(rendered: RenderedPage, important: boolean): Finding[] {
  if (!isNoindex(rendered.facts) || !important || rendered.page?.noindex.value) return [];
  const home = pathKey(rendered.urlPath) === "/";

  return [finding("noindex-important", { ...where(rendered), severity: home ? "must" : "should", title: home ? "The home page is kept out of search" : "A page in the menu is kept out of search", evidence: { value: robotsMeta(rendered.facts).trim(), note: "Set by the site's code, not by a field on this page." } })];
}
