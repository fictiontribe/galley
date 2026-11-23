/**
 * Checks over the content files alone — always available, no preview or
 * build needed. Each check reports only what the files show; anything that
 * depends on how the site renders a value (a title pattern, a fallback
 * image) is left to the rendered checks.
 */
import type { EditOp, FieldPath, JsonValue, SiteModel } from "../types";
import type { ContentLink, ContentPage } from "./content";
import { finding } from "./finding";
import { pathKey, type Redirect } from "./files";
import { collapse, cut, DISPLAY, fitWidth, shingles, similarPairs, textWidth, words } from "./text";
import type { Finding, FixEdit, FixProposal } from "./types";

export interface ContentContext {
  model: SiteModel;
  pages: ContentPage[];
  siteName: string;
  now: Date;
  redirects: Redirect[];
  /** Pages moved in the pending changes: old address key → new address. */
  moves: Map<string, string>;
}

export const VAGUE_LINK_TEXT = new Set(["click here", "click", "here", "this", "this link", "link", "read more", "more", "learn more", "go", "this page", "click this"]);
const PLACEHOLDER = [
  { pattern: /lorem ipsum|dolor sit amet/i, what: "lorem ipsum" },
  // Not a markdown link or image ("[Add a webhook](…)"): those brackets are link text.
  { pattern: /(?<![!\]])\[(add|insert|your|todo|tbd|placeholder|enter|replace)\b[^\]]{0,60}\](?![(:[])/i, what: "a bracketed placeholder" },
  { pattern: /\b(TODO|TBD|FIXME|XXX)\b/, what: "a to-do marker" },
  { pattern: /\b(your (company|business) name|company name here|insert (text|image) here)\b/i, what: "template wording" },
];
const EXAMPLE_ADDRESS = /\b[\w.+-]+@example\.(com|org|net)\b|https?:\/\/(www\.)?example\.(com|org|net)\b/i;
const FILE_NAME_ALT = /^(img|image|dsc|pic|photo|screenshot|untitled)?[-_ ]?\d*[\w-]*\.(png|jpe?g|gif|webp|avif|svg)$|^(img|dsc|dscn|pxl|image)[-_]?\d+$/i;
const REDUNDANT_ALT = /^(an? )?(image|picture|photo|photograph|graphic|icon) of\b/i;
const BARE_ALT = /^(image|picture|photo|graphic|img|spacer|icon|logo)$/i;
/** Words in an image's file name, or phrases in its description, that suggest it holds facts people quote. */
const FACT_FILE = /(^|[-_./])(menu|menus|prices|price-?list|pricelist|opening-?hours|hours|opening-?times|timetable|flyer|poster|tariffs?|rate-?card)([-_.]|$)/i;
const FACT_ALT = /\b(price list|menu|opening hours|opening times|timetable|rate card)\b/i;
const EVENTISH = /event|webinar|workshop|course|meetup|conference|class|session/i;

function isLocal(href: string): boolean {
  return /^\/(?!\/)/.test(href);
}

/** The pages people can visit and that aren't kept out on purpose. */
function visible(page: ContentPage): boolean {
  return page.isPage && !page.draft && !page.noindex.value && !/(^|\/)404$/.test(page.path.replace(/\.[^.]+$/, ""));
}

function ref(page: ContentPage): { path: string; url: string | null; title?: string } {
  return { path: page.path, url: page.url, ...(page.title ? { title: page.title.value } : {}) };
}

function base(page: ContentPage) {
  return { path: page.path, url: page.url, ...(page.title ? { pageTitle: page.title.value } : {}) };
}

/** One edit that replaces a link's target, wherever the link lives. */
export function relinkEdit(page: ContentPage, link: ContentLink, to: string): EditOp | null {
  if (link.inBody) {
    if (!link.raw) return null;
    return { op: "body-replace", find: link.raw, replace: link.raw.replace(link.href, to), all: true };
  }
  if (!link.field) return null;
  const stored = page.strings.find((entry) => entry.field && entry.field.join("\u0000") === link.field!.join("\u0000"))?.value;

  if (stored === undefined) return null;
  if (stored === link.href) return { op: "set", path: link.field, value: to };
  if (link.raw && stored.includes(link.raw)) return { op: "set", path: link.field, value: stored.split(link.raw).join(link.raw.replace(link.href, to)) };
  return null;
}

function brandPattern(siteName: string): RegExp | null {
  const name = siteName.trim();

  if (name.length < 3) return null;
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
}

const SEPARATOR = /\s*[|·—–\-:•»]\s*/;

/** A title with the site name taken off its start or end (with its separator), or null when it isn't there. */
export function withoutBrand(title: string, siteName: string): string | null {
  const name = siteName.trim();

  if (!name) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tail = new RegExp(`${SEPARATOR.source}${escaped}\\s*$`, "i");
  const head = new RegExp(`^\\s*${escaped}${SEPARATOR.source}`, "i");

  if (tail.test(title)) return title.replace(tail, "").trim() || null;
  if (head.test(title)) return title.replace(head, "").trim() || null;
  return null;
}

export function titleChecks(ctx: ContentContext, page: ContentPage): Finding[] {
  const out: Finding[] = [];

  if (!visible(page)) return out;
  if (!page.title || !page.title.value.trim()) {
    if (page.titleFieldExists) out.push(finding("title-missing", { ...base(page), field: page.title?.field ?? null, fieldLabel: page.title?.label ?? "Title", write: "title", evidence: { note: "The title field is empty." } }));
    return out;
  }
  const title = collapse(page.title.value);
  const brand = brandPattern(ctx.siteName);
  const repeats = brand ? (title.match(brand) ?? []).length : 0;

  if (repeats >= 2 && page.title.field) {
    const fixed = withoutBrand(title, ctx.siteName);

    out.push(
      finding("title-brand-repeated", {
        ...base(page),
        field: page.title.field,
        fieldLabel: page.title.label,
        evidence: { value: title, note: `“${ctx.siteName}” appears ${repeats} times.` },
        ...(fixed ? { fix: { label: "Remove the repeated name", before: title, after: fixed, edits: [{ path: page.path, ops: [{ op: "set", path: page.title.field, value: fixed }], summary: `Set ${page.title.label} to “${fixed}”` }] } } : {}),
      })
    );
  }
  const width = textWidth(title, DISPLAY.title.fontPx);

  if (width > DISPLAY.title.limit) {
    out.push(
      finding("title-long", {
        ...base(page),
        field: page.title.field,
        fieldLabel: page.title.label,
        write: "title",
        evidence: {
          value: title,
          measure: { label: "Estimated width in a desktop result", value: width, limit: DISPLAY.title.limit, unit: "px", reasoning: `${DISPLAY.title.reasoning} This is the title as written; the site may add its name to it.` },
          note: `Would likely show as “${fitWidth(title, DISPLAY.title.fontPx, DISPLAY.title.limit).shown}”.`,
        },
      })
    );
  }
  if (words(title).length <= 1 && title.length <= 3) out.push(finding("title-short", { ...base(page), field: page.title.field, fieldLabel: page.title.label, write: "title", evidence: { value: title } }));
  return out;
}

export function descriptionChecks(page: ContentPage): Finding[] {
  if (!visible(page) || !page.descriptionField) return [];
  const value = collapse(page.description?.value ?? "");
  const label = page.description?.label ?? "Description";

  if (!value) return [finding("description-missing", { ...base(page), field: page.descriptionField, fieldLabel: label, write: "description", evidence: { note: "The description field is empty, so results show text Google picks from the page." } })];
  const width = textWidth(value, DISPLAY.description.fontPx);

  if (value.length < 50) {
    return [finding("description-short", { ...base(page), field: page.descriptionField, fieldLabel: label, write: "description", evidence: { value, measure: { label: "Length", value: value.length, limit: 50, unit: "characters", reasoning: "Fewer than 50 characters rarely says enough to choose a result by. Google gives no minimum; it asks for descriptions that aren't too short." } } })];
  }
  if (width > DISPLAY.description.limit * 1.5) {
    return [
      finding("description-long", {
        ...base(page),
        field: page.descriptionField,
        fieldLabel: label,
        evidence: { value: cut(value, 400), measure: { label: "Estimated width in a desktop result", value: width, limit: DISPLAY.description.limit, unit: "px", reasoning: `${DISPLAY.description.reasoning} Flagged only past one and a half times that.` } },
      }),
    ];
  }
  return [];
}

function duplicates(pages: ContentPage[], pick: (page: ContentPage) => string | null): Map<string, ContentPage[]> {
  const groups = new Map<string, ContentPage[]>();

  for (const page of pages) {
    const value = pick(page);

    if (!value) continue;
    const key = collapse(value).toLowerCase();
    const list = groups.get(key);

    if (list) list.push(page);
    else groups.set(key, [page]);
  }
  for (const [key, list] of groups) if (list.length < 2) groups.delete(key);
  return groups;
}

export function duplicateChecks(ctx: ContentContext): Finding[] {
  const out: Finding[] = [];
  const pages = ctx.pages.filter(visible);

  for (const list of duplicates(pages, (page) => page.title?.value ?? null).values()) {
    for (const page of list) {
      out.push(finding("title-duplicate", { ...base(page), field: page.title?.field ?? null, fieldLabel: page.title?.label ?? "Title", write: "title", evidence: { value: page.title!.value, pages: list.filter((other) => other !== page).map(ref) } }));
    }
  }
  for (const list of duplicates(pages, (page) => page.description?.value ?? null).values()) {
    for (const page of list) {
      out.push(finding("description-duplicate", { ...base(page), field: page.descriptionField, fieldLabel: page.description?.label ?? "Description", write: "description", evidence: { value: cut(page.description!.value, 200), pages: list.filter((other) => other !== page).map(ref) } }));
    }
  }
  return out;
}

export function imageChecks(page: ContentPage): Finding[] {
  const out: Finding[] = [];

  if (page.draft) return out;
  for (const issue of page.issues) {
    if (issue.code !== "broken-image") continue;
    out.push(finding("image-broken", { ...base(page), key: issue.field?.join(".") ?? issue.message, field: issue.field ?? null, evidence: { note: issue.message } }));
  }
  page.images.forEach((image) => {
    const key = `${image.field?.join(".") ?? "body"}:${image.src}`;
    const alt = image.alt === null ? null : collapse(image.alt);

    if (image.altField === null && !image.inBody) return; // Nowhere to write alt text: the rendered check sees what the page does.
    if (!alt) {
      // Right beside a name or caption that says what it shows, an empty alt is correct (W3C).
      if (image.beside) return;
      // An empty alt field is right for a decorative image, so this asks rather than asserts.
      out.push(finding("image-alt-missing", { ...base(page), key, field: image.altField, write: "alt", evidence: { value: image.src, note: "Leave it empty only if the image is purely decorative." } }));
      return;
    }
    const file = image.src.split(/[?#]/)[0]!.split("/").pop() ?? "";

    if (FILE_NAME_ALT.test(alt) || alt.toLowerCase() === file.toLowerCase() || BARE_ALT.test(alt)) {
      out.push(finding("image-alt-filename", { ...base(page), key, field: image.altField, write: "alt", evidence: { value: alt, note: `For ${image.src}.` } }));
    } else if (REDUNDANT_ALT.test(alt)) {
      out.push(finding("image-alt-redundant", { ...base(page), key, field: image.altField, write: "alt", evidence: { value: alt } }));
    }
  });
  return out;
}

/**
 * The page's own first picture as its share picture: offered only when the
 * rendered page has none at all and the page has an empty field for one.
 */
export function leadImageFix(page: ContentPage | null): FixProposal | null {
  if (!page || !page.shareImageField || page.shareImage) return null;
  const lead = page.images.find((image) => !image.inBody && image.field && /^\/(?!\/)/.test(image.src) && !/logo|icon|avatar/i.test(image.field.join(".")));

  if (!lead) return null;
  return { label: "Use the page's own picture", after: lead.src, edits: [{ path: page.path, ops: [{ op: "set", path: page.shareImageField, value: lead.src }], summary: `Set the share picture to ${lead.src}` }] };
}

/** Links: broken ones (the engine's own check), and the text links say. */
export function linkChecks(ctx: ContentContext, page: ContentPage): Finding[] {
  const out: Finding[] = [];

  if (page.draft) return out;
  for (const issue of page.issues) {
    if (issue.code !== "broken-link") continue;
    const target = /link to (\S+) in/.exec(issue.message)?.[1] ?? "";
    const links = page.links.filter((link) => isLocal(link.href) && pathKey(link.href) === pathKey(target) && (!issue.field || (link.field ?? []).join(".") === issue.field.join(".")));
    const moved = ctx.moves.get(pathKey(target)) ?? ctx.redirects.find((redirect) => pathKey(redirect.from) === pathKey(target) && redirect.status >= 300 && redirect.status < 400)?.to;
    const edits: FixEdit[] = [];

    if (moved && links.length) {
      const ops = links.map((link) => {
        const suffix = link.href.slice((link.href.split(/[?#]/)[0] ?? "").length);

        return relinkEdit(page, link, `${moved}${suffix}`);
      });

      if (ops.every((op): op is EditOp => op !== null)) edits.push({ path: page.path, ops: dedupeOps(ops), summary: `Point the link at ${moved}` });
    }
    out.push(
      finding("link-broken", {
        ...base(page),
        key: `${issue.field?.join(".") ?? "body"}:${target}`,
        field: issue.field ?? null,
        evidence: { value: target, note: moved ? `That page now lives at ${moved}.` : issue.message },
        ...(edits.length ? { fix: { label: "Point it at the new address", before: target, after: moved!, edits } } : {}),
      })
    );
  }
  page.links.forEach((link, index) => {
    const text = link.text.toLowerCase().replace(/[.…!?:→›»\s]+$/g, "").trim();

    if (!VAGUE_LINK_TEXT.has(text)) return;
    out.push(finding("link-text-vague", { ...base(page), key: `${link.field?.join(".") ?? "body"}:${index}`, field: link.field, evidence: { value: link.text, note: `Links to ${link.href}.` } }));
  });
  return out;
}

function dedupeOps(ops: EditOp[]): EditOp[] {
  const seen = new Set<string>();

  return ops.filter((op) => {
    const key = JSON.stringify(op);

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pages nothing in the content links to. Only for collections whose pages aren't listed by code (see caller). */
export function orphanChecks(ctx: ContentContext, inbound: Map<string, Set<string>>, eligible: (page: ContentPage) => boolean, how: string): Finding[] {
  const out: Finding[] = [];

  for (const page of ctx.pages) {
    if (!visible(page) || !page.url || page.url === "/" || !eligible(page)) continue;
    const from = inbound.get(pathKey(page.url));

    if (from && [...from].some((source) => source !== page.path)) continue;
    out.push(finding("page-orphan", { ...base(page), evidence: { note: how } }));
  }
  return out;
}

/** Local link targets → the entries (and data files) that link there. */
export function contentInbound(pages: ContentPage[]): Map<string, Set<string>> {
  const inbound = new Map<string, Set<string>>();

  for (const page of pages) {
    for (const link of page.links) {
      if (!isLocal(link.href)) continue;
      const key = pathKey(link.href);
      const set = inbound.get(key) ?? new Set<string>();

      set.add(page.path);
      inbound.set(key, set);
    }
  }
  return inbound;
}

/** The same page linked as /x and /x/: one site finding per page, with the edits that make them agree. */
export function slashChecks(ctx: ContentContext): Finding[] {
  const forms = new Map<string, Map<string, Array<{ page: ContentPage; link: ContentLink }>>>();

  for (const page of ctx.pages) {
    for (const link of page.links) {
      if (!isLocal(link.href)) continue;
      const bare = link.href.split(/[?#]/)[0]!;

      if (bare === "/" || /\.[a-z0-9]{2,5}$/i.test(bare)) continue;
      const key = pathKey(bare);
      const map = forms.get(key) ?? new Map();

      map.set(bare, [...(map.get(bare) ?? []), { page, link }]);
      forms.set(key, map);
    }
  }
  const out: Finding[] = [];
  const urls = new Map(ctx.pages.filter((page) => page.url).map((page) => [pathKey(page.url!), page.url!]));

  for (const [key, map] of forms) {
    if (map.size < 2) continue;
    const preferred = urls.get(key);
    const used = [...map.keys()];
    const edits: FixEdit[] = [];

    if (preferred) {
      const byPage = new Map<string, EditOp[]>();

      for (const [form, uses] of map) {
        if (form === preferred) continue;
        for (const { page, link } of uses) {
          const suffix = link.href.slice(form.length);
          const op = relinkEdit(page, link, `${preferred}${suffix}`);

          if (op) byPage.set(page.path, dedupeOps([...(byPage.get(page.path) ?? []), op]));
        }
      }
      for (const [path, ops] of byPage) edits.push({ path, ops, summary: `Link to ${preferred} the same way everywhere` });
    }
    const target = ctx.pages.find((page) => page.url && pathKey(page.url) === key);

    out.push(
      finding("link-slash-mixed", {
        scope: "site",
        key,
        ...(target ? { url: target.url, pageTitle: target.title?.value } : { url: key }),
        evidence: { values: used, note: preferred ? `The page's own address is ${preferred}.` : "The page's own address isn't known, so the app can't choose one." },
        ...(edits.length ? { fix: { label: `Use ${preferred} everywhere`, after: preferred, edits } } : {}),
      })
    );
  }
  return out;
}

export function noindexChecks(ctx: ContentContext, page: ContentPage, navTargets: Set<string>): Finding[] {
  if (!page.isPage || page.draft || !page.noindex.value || !page.url) return [];
  const home = page.url === "/";
  const linked = navTargets.has(pathKey(page.url));

  if (!home && !linked) return [];
  const field = page.noindex.field;
  const raw = field ? page.strings.find((entry) => entry.field?.join(".") === field.join("."))?.value : undefined;
  // A boolean switch can simply be turned off; a "robots" text field is the person's to rewrite.
  const fix = field && raw === undefined ? { label: "Let search engines show it", edits: [{ path: page.path, ops: [{ op: "set" as const, path: field, value: false as JsonValue }], summary: "Turn off “keep out of search”" }] } : null;

  return [finding("noindex-important", { ...base(page), field, severity: home ? "must" : "should", title: home ? "The home page is kept out of search" : "A page in the menu is kept out of search", evidence: { note: home ? "This is the site's home page." : "The site's menu or footer links to it." }, fix })];
}

export function placeholderChecks(page: ContentPage): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();

  for (const { value: raw, field } of page.strings) {
    const where = field?.join(".") ?? "body";
    // Code samples quote placeholders on purpose ("TODO", "[your key]").
    const value = raw.replace(/^(```|~~~)[\s\S]*?^\1/gm, " ").replace(/`[^`\n]*`/g, " ").replace(/<(code|pre)\b[\s\S]*?<\/\1>/gi, " ");

    for (const { pattern, what } of PLACEHOLDER) {
      const match = pattern.exec(value);

      if (!match || seen.has(`${where}:${what}`)) continue;
      seen.add(`${where}:${what}`);
      const at = match.index;

      out.push(finding("placeholder-text", { ...base(page), key: `${where}:${what}`, field, evidence: { value: cut(value.slice(Math.max(0, at - 40), at + 80), 140), note: `Contains ${what}: “${match[0]}”.` } }));
    }
  }
  return out;
}

/** example.com addresses, one finding for the whole site: they are one job (put the real addresses in). */
export function exampleAddressChecks(pages: ContentPage[]): Finding[] {
  const found: Array<{ page: ContentPage; value: string }> = [];

  for (const page of pages) {
    const seen = new Set<string>();

    for (const { value } of page.strings) {
      for (const match of value.matchAll(new RegExp(EXAMPLE_ADDRESS.source, "gi"))) {
        if (seen.has(match[0].toLowerCase())) continue;
        seen.add(match[0].toLowerCase());
        found.push({ page, value: match[0] });
      }
    }
  }
  if (!found.length) return [];
  const pagesWith = [...new Map(found.map((item) => [item.page.path, item.page])).values()];

  return [
    finding("placeholder-address", {
      scope: "site",
      evidence: {
        values: [...new Set(found.map((item) => item.value))].slice(0, 12),
        pages: pagesWith.slice(0, 20).map(ref),
        note: `${found.length} example address${found.length === 1 ? "" : "es"} in ${pagesWith.length} ${pagesWith.length === 1 ? "file" : "files"}.`,
      },
    }),
  ];
}

export function headingContentChecks(page: ContentPage): Finding[] {
  const out: Finding[] = [];

  if (!visible(page)) return out;
  page.headings.forEach((heading, index) => {
    if (!heading.inBody) return;
    const count = words(heading.text).length;

    if (count === 0 || count > 25) {
      out.push(finding("heading-decoration", { ...base(page), key: String(index), evidence: { value: heading.text || "(empty)", note: count === 0 ? "A heading with no words in it." : `A heading of ${count} words reads as a paragraph.` } }));
    }
  });
  const bodyHeadings = page.headings.filter((heading) => heading.inBody && heading.level >= 2).length;
  const bodyWords = page.strings.find((entry) => entry.field === null)?.value;
  const count = bodyWords ? words(bodyWords).length : 0;

  if (count > 700 && bodyHeadings === 0) {
    out.push(finding("long-no-subheads", { ...base(page), evidence: { measure: { label: "Words in the main text", value: count, limit: 700, unit: "words", reasoning: "Flagged above 700 words with no subheading at all. Google sets no length; this is about being able to scan the page." } } }));
  }
  return out;
}

const SHINGLES = new WeakMap<ContentPage, Set<number>>();

/** Shingles per read of a page: an unchanged page (same object from the cache) is never re-shingled. */
function shinglesOf(page: ContentPage): Set<number> {
  let set = SHINGLES.get(page);

  if (!set) {
    set = shingles(page.text);
    SHINGLES.set(page, set);
  }
  return set;
}

export function qualityChecks(ctx: ContentContext, listingKeys: Set<string>, renderedWords?: Map<string, number>): Finding[] {
  const out: Finding[] = [];
  const pages = ctx.pages.filter(visible);
  const lists = new Set(ctx.model.collections.flatMap((collection) => [collection.id.toLowerCase(), collection.label.toLowerCase()]));

  for (const page of pages) {
    if (page.url === "/" || listingKeys.has(pathKey(page.url ?? ""))) continue;
    // A section that shows other entries (posts, a changelog, a team) makes the page longer than its own fields.
    if (page.sections.some((type) => lists.has(type.toLowerCase()) || /posts|list|feed|archive|latest|index|team|changelog|customers|logos|gallery/i.test(type))) continue;
    const sent = renderedWords?.get(pathKey(page.url ?? ""));

    if (sent !== undefined && sent >= 60) continue;
    if (page.words < 60) {
      out.push(finding("thin-page", { ...base(page), evidence: { measure: { label: "Words of text in the content", value: page.words, limit: 60, unit: "words", reasoning: "Counted from the page's own fields and main text. Google has no word-count target; under 60 words there is little to read or quote." } } }));
    }
  }
  const docs = pages.filter((page) => page.words >= 150).map((page) => ({ id: page.path, shingles: shinglesOf(page) }));

  for (const pair of similarPairs(docs, 0.8)) {
    const a = pages.find((page) => page.path === pair.a)!;
    const b = pages.find((page) => page.path === pair.b)!;

    out.push(finding("near-duplicate", { ...base(a), key: b.path, evidence: { pages: [ref(b)], measure: { label: "Shared five-word phrases", value: Math.round(pair.similarity * 100), limit: 80, unit: "words", reasoning: "Jaccard similarity of five-word shingles, in percent. Flagged at 80% or more, for pages of 150 words or more." } } }));
  }
  return out;
}

export function aiContentChecks(ctx: ContentContext, page: ContentPage): Finding[] {
  const out: Finding[] = [];

  if (!visible(page)) return out;
  if (page.url === "/" && ctx.siteName.trim()) {
    const opening = words(page.text).slice(0, 150).join(" ");
    const name = words(ctx.siteName).filter((word) => word.length >= 4);
    const mentioned = name.length ? name.some((word) => opening.includes(word)) : opening.includes(ctx.siteName.toLowerCase());

    if (!mentioned) {
      out.push(finding("ai-intro-unclear", { ...base(page), write: "intro", evidence: { value: cut(page.text, 220), note: `“${ctx.siteName}” doesn't appear in the first 150 words of the page's text.` } }));
    }
  }
  const text = page.text;
  const hasFacts = /[£$€]\s?\d|\d\s?(am|pm)\b|\b\d{1,2}[:.]\d{2}\b/i.test(text);

  page.images.forEach((image) => {
    const file = image.src.split(/[?#]/)[0]!.split("/").pop() ?? "";

    if (!(FACT_FILE.test(file) || FACT_ALT.test(image.alt ?? "")) || hasFacts) return;
    out.push(finding("facts-in-images", { ...base(page), key: image.src, field: image.field, evidence: { value: image.src, note: "The picture's name or description suggests prices or times, and the page's text has none." } }));
  });
  return out;
}

export function bylineChecks(ctx: ContentContext, page: ContentPage): Finding[] {
  const collection = ctx.model.collections.find((c) => c.id === page.collection);

  if (!visible(page) || !collection) return [];
  const out: Finding[] = [];

  if (collection.dateField && !page.date.value) out.push(finding("byline-missing", { ...base(page), key: "date", field: page.date.field, title: "No date", evidence: { note: `Other ${collection.label.toLowerCase()} carry a date.` } }));
  if (page.author.field && !page.author.value) out.push(finding("byline-missing", { ...base(page), key: "author", field: page.author.field, title: "No author", evidence: { note: "This kind of page has an author field, and it's empty." } }));
  return out;
}

export function upcomingChecks(ctx: ContentContext, page: ContentPage): Finding[] {
  const collection = ctx.model.collections.find((c) => c.id === page.collection);

  if (!visible(page) || !collection || !page.date.value) return [];
  if (!EVENTISH.test(`${collection.id} ${collection.label}`)) return [];
  const when = Date.parse(page.date.value);

  if (Number.isNaN(when) || when >= ctx.now.getTime() - 24 * 3600_000) return [];
  return [finding("date-past-upcoming", { ...base(page), field: page.date.field, evidence: { value: page.date.value, note: `It's in “${collection.label}”, and that date has passed.` } })];
}

/** Section headings carry no level in content, so they don't count as subheadings here. */
export function navTargets(model: SiteModel, pages: ContentPage[]): Set<string> {
  const data = new Set(model.collections.filter((collection) => collection.kind === "data").map((collection) => collection.id));
  const out = new Set<string>();

  for (const page of pages) {
    if (!data.has(page.collection)) continue;
    for (const link of page.links) if (isLocal(link.href)) out.add(pathKey(link.href));
  }
  return out;
}

export function fieldEquals(a: FieldPath | null | undefined, b: FieldPath | null | undefined): boolean {
  return (a ?? []).join("\u0000") === (b ?? []).join("\u0000");
}
