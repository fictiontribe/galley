/**
 * Rebuild briefs for page-builder pages.
 *
 * The importer never calls a model. For each page a builder made, it
 * prepares the task the assistant will be given when the person presses
 * "Rebuild with sections": the page's outline, and for every section of it
 * the target site's own section type that fits, how sure that is, and why.
 *
 * The rules are deterministic and conservative. Each outline section is
 * classified by what it holds (a form → contact; prices → pricing; questions
 * with answers → FAQ; quotes → testimonials; numbers with labels → stats;
 * repeated icon/image + heading + text groups → features; a row of images →
 * logos or a gallery; the first section with one heading, a little text and
 * a button → hero; a heading, short text and a button later on → call to
 * action; one image beside text → split; headings and text → rich text).
 * Then a section type is looked for by name *and* by shape (it must have
 * fields the content can fill). When none fits, the suggestion says "no
 * close match" instead of forcing one.
 */
import type { BlockType, Field, JsonValue } from "@galley/core/types";
import { flatItems } from "./convert/outline";
import type { BuilderName, OutlineItem, OutlineSection, PageOutline, RebuildBrief, SectionSuggestion } from "./types";

export type Shape = "contact" | "pricing" | "faq" | "testimonial" | "testimonials" | "stats" | "features" | "steps" | "logos" | "gallery" | "hero" | "cta" | "split" | "video" | "rich-text" | "unknown";

const SHAPE_WORDS: Record<Shape, string> = {
  contact: "a contact form",
  pricing: "price plans",
  faq: "questions and answers",
  testimonial: "a quote",
  testimonials: "several quotes",
  stats: "numbers with labels",
  features: "a set of features",
  steps: "numbered steps",
  logos: "a row of logos",
  gallery: "a gallery",
  hero: "an opening heading with a button",
  cta: "a call to action",
  split: "an image beside text",
  video: "an embedded player",
  "rich-text": "text",
  unknown: "mixed content",
};

/** Names a section type might go by, most specific first. */
const NAMES: Record<Shape, RegExp[]> = {
  contact: [/contact/, /enquir|inquir/, /form/],
  pricing: [/pric/, /plans?$|tiers?|packages?/],
  faq: [/faq/, /questions?/, /accordion/],
  testimonial: [/^testimonial$|^quote$|^review$/, /testimonial(?!s)|quote(?!s)|review(?!s)/],
  testimonials: [/testimonials|reviews|quotes/, /testimonial|review|quote/],
  stats: [/stats?|statistics/, /numbers?|metrics?|counters?|figures/],
  features: [/features?/, /benefits?|services?|cards?|highlights?|usps?|values?|grid/],
  steps: [/steps?|process/, /how.?it.?works|timeline/],
  logos: [/logos?/, /clients?|partners?|brands?|sponsors?/],
  gallery: [/gallery/, /images|photos|portfolio/],
  hero: [/hero/, /banner|jumbotron|masthead|splash|intro/],
  cta: [/^cta$|call.?to.?action/, /signup|banner/],
  split: [/split/, /media.?text|image.?text|text.?image|two.?col|feature.?row/],
  video: [/video/, /embed/],
  "rich-text": [/rich.?text|prose/, /^(text|content|markdown|body|copy|article)$/],
  unknown: [],
};

type Item<K extends OutlineItem["kind"]> = Extract<OutlineItem, { kind: K }>;

function of<K extends OutlineItem["kind"]>(items: OutlineItem[], kind: K): Array<Item<K>> {
  return items.filter((item): item is Item<K> => item.kind === kind);
}

function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifySection(section: OutlineSection): { shape: Shape; reason: string } {
  const items = flatItems(section.columns);
  const headings = of(items, "heading");
  const texts = of(items, "text");
  const buttons = of(items, "button");
  const images = [...of(items, "image"), ...of(items, "gallery").flatMap((gallery) => gallery.images.map((image) => ({ kind: "image" as const, ...image })))];
  const cards = of(items, "card");
  const quotes = of(items, "quote");
  const faqs = of(items, "faq").flatMap((faq) => faq.items);
  const prices = of(items, "price");
  const counters = of(items, "counter");
  const forms = of(items, "form");
  const embeds = of(items, "embed");
  const filled = section.columns.filter((column) => column.items.length > 0);
  const rows = section.columns.flatMap((column) => of(column.items, "row"));
  // Groups are the section's own columns, or the columns of a row nested inside it — whichever repeats a heading with text.
  const isGroup = (column: OutlineSection["columns"][number]) => of(column.items, "heading").length >= 1 && (of(column.items, "text").length >= 1 || of(column.items, "list").length >= 1);
  const groupSets = [filled, ...rows.map((row) => row.columns.filter((column) => column.items.length > 0))].filter((set) => set.length >= 2 && set.every(isGroup));
  const groupColumns = groupSets.sort((a, b) => b.length - a.length)[0] ?? [];
  const groupLike = groupColumns.length >= 2;

  if (forms.length) return { shape: "contact", reason: `It holds a form${forms[0]!.fields.length ? ` (${forms[0]!.fields.join(", ")})` : ""}.` };
  if (prices.length) return { shape: "pricing", reason: `It holds ${prices.length} price ${prices.length === 1 ? "plan" : "plans"}.` };
  if (faqs.length >= 2 || (faqs.length === 1 && headings.length <= 1)) return { shape: "faq", reason: `It holds ${faqs.length} ${faqs.length === 1 ? "question" : "questions"} with answers.` };
  if (quotes.length === 1 && texts.length <= 1) return { shape: "testimonial", reason: `It's one quote${quotes[0]!.name ? ` from ${quotes[0]!.name}` : ""}.` };
  if (quotes.length >= 2) return { shape: "testimonials", reason: `It holds ${quotes.length} quotes.` };
  if (counters.length >= 2) return { shape: "stats", reason: `It holds ${counters.length} numbers with labels.` };
  const groups = cards.length >= 2 ? cards.length : groupLike ? groupColumns.length : 0;

  if (groups >= 2) {
    const numbered = (cards.length ? cards.map((card) => card.heading ?? "") : groupColumns.map((column) => of(column.items, "heading")[0]?.text ?? "")).every((text) => /^(step\s*)?\d+[.):]?\s/i.test(text));

    return numbered
      ? { shape: "steps", reason: `It holds ${groups} numbered steps, each with a heading and text.` }
      : { shape: "features", reason: `It repeats the same group ${groups} times (${cards.length ? "an icon or image, a heading and text" : "a heading and text"}).` };
  }
  if (images.length >= 3 && texts.length === 0 && headings.length <= 1 && cards.length === 0) {
    const logos = section.hints.some((hint) => /logos/.test(hint));

    return logos ? { shape: "logos", reason: `It's a row of ${images.length} logos.` } : { shape: "gallery", reason: `It's ${images.length} images with little else.` };
  }
  if (section.index === 0 && headings.length >= 1 && headings.length <= 2 && buttons.length >= 1 && texts.length <= 2) {
    return { shape: "hero", reason: "It opens the page with a main heading, a short text and a button." };
  }
  const shortText = texts.reduce((total, text) => total + plainText(text.markdown).length, 0) <= 400;

  if (headings.length <= 1 && buttons.length >= 1 && texts.length <= 1 && images.length === 0 && shortText) {
    return { shape: "cta", reason: "It's a heading with a short text and a button." };
  }
  if (images.length === 1 && (headings.length >= 1 || texts.length >= 1) && filled.length === 2) {
    return { shape: "split", reason: "It puts one image beside a heading and text." };
  }
  if (embeds.length >= 1 && texts.length <= 1) return { shape: "video", reason: "It's mainly an embedded player." };
  if (headings.length + texts.length + of(items, "list").length > 0) {
    return { shape: "rich-text", reason: "It's headings and text." };
  }
  return { shape: "unknown", reason: "Its content doesn't follow a pattern this importer recognises." };
}

// ─────────────────────────────────────────────────────────── filling fields

function fieldNamed(fields: Field[], names: string[]): Field | undefined {
  const norm = (key: string) => key.toLowerCase().replace(/[-_]/g, "");

  for (const name of names) {
    const found = fields.find((field) => norm(field.key) === name);

    if (found) return found;
  }
  return undefined;
}

const HEADING = ["heading", "title", "headline"];
const TEXT = ["text", "body", "description", "content", "subheading", "subtitle", "lede", "intro", "copy", "summary"];
const CTA = ["cta", "button", "primarycta", "action", "link"];
const SECOND_CTA = ["secondarycta", "secondarybutton", "secondary"];
const IMAGE = ["image", "src", "photo", "picture", "media", "background", "backgroundimage"];
const ALT = ["imagealt", "alt", "photoalt"];
const ITEMS = ["items", "features", "cards", "list", "entries", "plans", "tiers", "questions", "faqs", "logos", "images", "quotes", "testimonials", "stats", "steps"];

/** A `{ label, href }`-like object field filled from a button. */
function linkValue(field: Field, button: { label: string; href: string }): JsonValue | undefined {
  if (field.type === "url" || field.type === "string") return button.href;
  if (field.type !== "object" || !field.fields) return undefined;
  const label = fieldNamed(field.fields, ["label", "text", "title", "name"]);
  const href = fieldNamed(field.fields, ["href", "url", "link", "to"]);

  if (!label || !href) return undefined;
  return { [label.key]: button.label, [href.key]: button.href };
}

function textValue(field: Field, markdown: string): string {
  return field.type === "markdown" ? markdown : plainText(markdown);
}

interface Filled {
  content: { [key: string]: JsonValue };
  missing: string[];
  /** Content the section type has no field for. */
  unplaced: string[];
}

function fill(block: BlockType, shape: Shape, section: OutlineSection, discriminator: string): Filled {
  const items = flatItems(section.columns);
  const content: { [key: string]: JsonValue } = {};
  const fields = block.fields;
  const set = (names: string[], value: JsonValue | undefined) => {
    const field = fieldNamed(fields, names);

    if (field && value !== undefined && value !== "" && !(field.key in content)) content[field.key] = value;
    return field;
  };
  const headings = of(items, "heading");
  const texts = of(items, "text");
  const buttons = of(items, "button");
  const images = of(items, "image");
  const itemsField = fieldNamed(fields, ITEMS);
  const itemFields = itemsField?.of?.fields ?? itemsField?.fields ?? [];
  const textField = fieldNamed(fields, TEXT);
  // Groups (cards or columns) take the section's own heading only when the section has one outside them.
  const groupedByColumns = (shape === "features" || shape === "steps") && of(items, "card").length === 0;
  // When columns are the groups, their headings belong to the groups; the section's own heading is one standing alone.
  const leadHeading = groupedByColumns
    ? section.columns.map((column) => column.items).find((columnItems) => of(columnItems, "heading").length && !of(columnItems, "text").length && !of(columnItems, "row").length)?.find((item): item is Item<"heading"> => item.kind === "heading")?.text ??
      section.columns.flatMap((column) => column.items).find((item): item is Item<"heading"> => item.kind === "heading" && section.columns.some((c) => c.items[0] === item && of(c.items, "row").length > 0))?.text
    : headings[0]?.text;

  if (shape !== "testimonial") set(HEADING, leadHeading);
  if (textField && texts[0] && !["faq", "features", "steps", "testimonials"].includes(shape)) set(TEXT, textValue(textField, shape === "rich-text" ? texts.map((text) => text.markdown).join("\n\n") : texts[0].markdown));
  const cta = fieldNamed(fields, CTA);

  if (cta && buttons[0] && shape !== "pricing") {
    const value = linkValue(cta, buttons[0]);

    if (value !== undefined) content[cta.key] = value;
    const second = fieldNamed(fields, SECOND_CTA);

    if (second && buttons[1]) {
      const secondValue = linkValue(second, buttons[1]);

      if (secondValue !== undefined) content[second.key] = secondValue;
    }
  }
  if (["hero", "split", "cta", "rich-text", "contact"].includes(shape) && images[0]) {
    set(IMAGE, images[0].src);
    set(ALT, images[0].alt);
  }
  const subset = (names: string[], value: JsonValue | undefined, target: { [key: string]: JsonValue }) => {
    const field = fieldNamed(itemFields, names);

    if (field && value !== undefined && value !== "") target[field.key] = field.type === "markdown" || typeof value !== "string" ? value : value;
  };
  let list: Array<{ [key: string]: JsonValue }> = [];

  switch (shape) {
    case "features":
    case "steps": {
      const cards = of(items, "card");
      const groups = cards.length
        ? cards.map((card) => ({ heading: card.heading, text: card.text, image: card.image, icon: card.icon, link: card.link }))
        : [...section.columns, ...section.columns.flatMap((column) => of(column.items, "row").flatMap((row) => row.columns))]
            .filter((column) => of(column.items, "heading").length)
            .map((column) => ({ heading: of(column.items, "heading")[0]?.text, text: of(column.items, "text").map((text) => text.markdown).join("\n\n") || of(column.items, "list").map((l) => l.items.join("; ")).join(""), image: of(column.items, "image")[0], icon: of(column.items, "icon")[0]?.name, link: of(column.items, "button")[0] }));

      list = groups.map((group) => {
        const entry: { [key: string]: JsonValue } = {};

        subset(HEADING.concat(["name"]), group.heading, entry);
        subset(TEXT, group.text ? plainText(group.text) : undefined, entry);
        const iconField = fieldNamed(itemFields, ["icon"]);

        if (iconField && group.icon && (!iconField.options || iconField.options.includes(group.icon))) entry[iconField.key] = group.icon;
        if (group.image) {
          subset(IMAGE, group.image.src, entry);
          subset(ALT, group.image.alt, entry);
        }
        const linkField = fieldNamed(itemFields, CTA);

        if (linkField && group.link) {
          const value = linkValue(linkField, group.link);

          if (value !== undefined) entry[linkField.key] = value;
        }
        return entry;
      });
      break;
    }
    case "faq":
      list = of(items, "faq")
        .flatMap((faq) => faq.items)
        .map((qa) => {
          const entry: { [key: string]: JsonValue } = {};

          subset(["question", "q", "title", "heading"], qa.question, entry);
          subset(["answer", "a", "text", "body", "content"], plainText(qa.answer), entry);
          return entry;
        });
      break;
    case "pricing":
      list = of(items, "price").map((price) => {
        const entry: { [key: string]: JsonValue } = {};

        subset(["name", "title", "heading", "plan"], price.name, entry);
        subset(["price", "amount", "cost"], price.price, entry);
        subset(["period", "per", "interval", "frequency"], price.period, entry);
        const featuresField = fieldNamed(itemFields, ["features", "items", "list", "includes"]);

        if (featuresField && price.features.length) entry[featuresField.key] = price.features;
        const linkField = fieldNamed(itemFields, CTA);

        if (linkField && price.button) {
          const value = linkValue(linkField, price.button);

          if (value !== undefined) entry[linkField.key] = value;
        }
        const featured = fieldNamed(itemFields, ["featured", "highlighted", "highlight", "popular"]);

        if (featured && price.featured) entry[featured.key] = true;
        return entry;
      });
      break;
    case "testimonial": {
      const quote = of(items, "quote")[0];

      if (quote) {
        set(["quote", "text", "body", "content"], quote.text);
        set(["name", "author", "person", "cite"], quote.name);
        set(["role", "title", "job", "position", "company"], quote.role);
        set(IMAGE, quote.image);
      }
      break;
    }
    case "testimonials":
      list = of(items, "quote").map((quote) => {
        const entry: { [key: string]: JsonValue } = {};

        subset(["quote", "text", "body", "content"], quote.text, entry);
        subset(["name", "author", "person", "cite"], quote.name, entry);
        subset(["role", "title", "job", "position", "company"], quote.role, entry);
        return entry;
      });
      break;
    case "stats":
      list = of(items, "counter").map((counter) => {
        const entry: { [key: string]: JsonValue } = {};

        subset(["value", "number", "stat", "figure"], counter.value, entry);
        subset(["label", "title", "text", "caption"], counter.label, entry);
        return entry;
      });
      break;
    case "logos":
    case "gallery": {
      const pictures = [...images, ...of(items, "gallery").flatMap((gallery) => gallery.images)];

      list = pictures.map((picture) => {
        const entry: { [key: string]: JsonValue } = {};

        subset(IMAGE.concat(["logo"]), picture.src, entry);
        subset(ALT, picture.alt, entry);
        if (shape === "logos") subset(["name", "title", "label"], picture.alt, entry);
        subset(["caption"], "caption" in picture ? picture.caption : undefined, entry);
        return entry;
      });
      break;
    }
    default:
      break;
  }
  if (itemsField && list.length) content[itemsField.key] = list;
  // What the section type needs that the old section didn't have.
  const missing = fields
    .filter((field) => field.required && !(field.key in content) && field.default === undefined && field.key !== discriminator)
    .map((field) => field.label || field.key);

  if (itemsField && list.length) {
    const requiredInner = itemFields.filter((field) => field.required && field.default === undefined);

    for (const field of requiredInner) {
      if (list.some((entry) => !(field.key in entry))) missing.push(`${itemsField.label || itemsField.key} › ${field.label || field.key}`);
    }
  }
  const unplaced: string[] = [];

  if (["hero", "cta", "split", "contact"].includes(shape)) {
    if (texts.length && !textField) unplaced.push("its text");
    if (buttons.length && !cta) unplaced.push("its button");
    if (images.length && !fieldNamed(fields, IMAGE) && shape !== "contact") unplaced.push("its image");
  }
  return { content, missing: [...new Set(missing)], unplaced };
}

/** Whether a block type's fields can hold this shape at all. */
function holds(block: BlockType, shape: Shape): boolean {
  const fields = block.fields;
  const items = fieldNamed(fields, ITEMS);
  const inner = items?.of?.fields ?? [];
  const has = (names: string[], list = fields) => Boolean(fieldNamed(list, names));

  switch (shape) {
    case "features":
    case "steps":
      return Boolean(items) && has(HEADING.concat(["name"]), inner) && has(TEXT, inner);
    case "faq":
      return Boolean(items) && has(["question", "q", "title", "heading"], inner) && has(["answer", "a", "text", "body", "content"], inner);
    case "pricing":
      return Boolean(items) && has(["price", "amount", "cost"], inner);
    case "testimonials":
      return Boolean(items) && has(["quote", "text", "body", "content"], inner);
    case "testimonial":
      return has(["quote", "text", "body", "content"]) && !items;
    case "stats":
      return Boolean(items) && has(["value", "number", "stat", "figure"], inner);
    case "logos":
    case "gallery":
      return Boolean(items) && has(IMAGE.concat(["logo"]), inner);
    case "hero":
      return has(HEADING);
    case "cta":
      return has(HEADING) && has(CTA);
    case "split":
      return has(IMAGE) && (has(HEADING) || has(TEXT));
    case "contact":
      return has(HEADING) || has(TEXT);
    case "video":
    case "rich-text":
      return Boolean(fieldNamed(fields, TEXT)) && fields.some((field) => fieldNamed([field], TEXT) && (field.type === "markdown" || field.type === "text" || field.type === "string"));
    default:
      return false;
  }
}

function nameRank(block: BlockType, shape: Shape): number {
  const name = `${block.type} ${block.label}`.toLowerCase();
  const patterns = NAMES[shape];

  for (let i = 0; i < patterns.length; i += 1) if (patterns[i]!.test(block.type.toLowerCase()) || patterns[i]!.test(name)) return i;
  return -1;
}

export function suggestSection(section: OutlineSection, blocks: BlockType[], discriminator = "type"): SectionSuggestion {
  const { shape, reason } = classifySection(section);

  if (shape === "unknown") return { section: section.index, blockType: null, confidence: "none", reason: `No close match. ${reason}` };
  const scored = blocks
    .map((block) => ({ block, rank: nameRank(block, shape), fits: holds(block, shape) }))
    .filter((entry) => entry.rank >= 0 || entry.fits)
    // Name and shape together beat either alone; among equals, the more specific name wins.
    .sort((a, b) => Number(b.fits && b.rank >= 0) - Number(a.fits && a.rank >= 0) || Number(b.fits) - Number(a.fits) || (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank));
  // Shape alone is only trusted for the specific shapes; a bare "has a heading" fits almost anything.
  const best = scored.find((entry) => entry.fits && (entry.rank >= 0 || ["features", "steps", "faq", "pricing", "testimonials", "stats", "logos", "gallery"].includes(shape)));

  if (!best) {
    return { section: section.index, blockType: null, confidence: "none", reason: `No close match: ${reason.replace(/\.$/, "")}, and this site has no section type for ${SHAPE_WORDS[shape]}.` };
  }
  const filled = fill(best.block, shape, section, discriminator);
  let confidence: SectionSuggestion["confidence"] = best.rank >= 0 && best.fits ? "high" : "medium";

  if (filled.missing.length || filled.unplaced.length) confidence = confidence === "high" ? "medium" : "low";
  const missing = filled.missing.length ? ` It needs ${filled.missing.map((name) => `“${name}”`).join(", ")}, which the old section didn't have — ask the person or leave the section out.` : "";
  const unplaced = filled.unplaced.length ? ` It has no place for ${filled.unplaced.join(" or ")}; keep ${filled.unplaced.length === 1 ? "it" : "them"} in a text section or leave ${filled.unplaced.length === 1 ? "it" : "them"} out.` : "";
  const formNote = shape === "contact" ? " Forms need a form service on a static site, so the form itself won't send anything until one is set up." : "";

  return {
    section: section.index,
    blockType: best.block.type,
    confidence,
    reason: `${reason} “${best.block.label || best.block.type}” ${best.rank >= 0 ? "is the section made for that" : "has the fields for it"}.${missing}${unplaced}${formNote}`,
    content: filled.content,
  };
}

function quote(text: string | undefined, max = 70): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();

  return `“${clean.length > max ? `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : clean}”`;
}

function summarizeSection(section: OutlineSection): string {
  const items = flatItems(section.columns);
  const heading = of(items, "heading")[0]?.text;

  return [heading ? `heading ${quote(heading)}` : "", section.hints.join("; ")].filter(Boolean).join(" — ");
}

export function buildRebuildBrief(input: { title: string; path: string; url: string | null; builder: BuilderName; outline: PageOutline; blocks: BlockType[]; blocksLabel: string; discriminator?: string }): RebuildBrief {
  const suggestions = input.outline.sections.map((section) => suggestSection(section, input.blocks, input.discriminator));
  const builderName = { elementor: "Elementor", divi: "Divi", wpbakery: "WPBakery", beaver: "Beaver Builder" }[input.builder];
  const lines = input.outline.sections.map((section, i) => {
    const suggestion = suggestions[i]!;
    const what = summarizeSection(section) || "content";

    return suggestion.blockType
      ? `${i + 1}. ${what} → a “${suggestion.blockType}” section (${suggestion.confidence} confidence). ${suggestion.reason}`
      : `${i + 1}. ${what} → no close match. Keep its words in a text section, or ask the person how they'd like it shown.`;
  });
  const brief = [
    `Rebuild the page “${input.title}”${input.url ? ` (${input.url})` : ""} from this site's own ${input.blocksLabel}. On WordPress it was made with ${builderName}; it was imported as plain text so nothing was lost, and that text is in the page now.`,
    "",
    "Sections, in order:",
    ...lines,
    "",
    "Proposed content for the matched sections, read from the old page (fill what's missing only from the person's answers):",
    "```json",
    JSON.stringify(
      suggestions.filter((suggestion) => suggestion.blockType).map((suggestion) => ({ type: suggestion.blockType, ...suggestion.content })),
      null,
      2
    ),
    "```",
    "",
    "Use the words exactly as they are in the outline — don't add claims, numbers, names or links that aren't there. The images are already in the media library at the addresses shown. When the sections are in place, remove the imported text below them so nothing appears twice. The change will wait in Proof for the person to check.",
  ].join("\n");

  return { title: input.title, path: input.path, url: input.url, builder: input.builder, outline: input.outline, suggestions, brief };
}

function images(section: OutlineSection): string[] {
  const out: string[] = [];
  const visit = (items: OutlineItem[]) => {
    for (const item of items) {
      if (item.kind === "image") out.push(item.src);
      else if (item.kind === "card" && item.image) out.push(item.image.src);
      else if (item.kind === "gallery") out.push(...item.images.map((image) => image.src));
      else if (item.kind === "quote" && item.image) out.push(item.image);
      else if (item.kind === "row") for (const column of item.columns) visit(column.items);
    }
  };

  for (const column of section.columns) visit(column.items);
  return out;
}

/**
 * The same brief, as the app hands it to the assistant: the message a person
 * sees in the chat (so it reads as a request, not a data dump) and that the
 * assistant works from. It names the page to change, the order of sections
 * with the section type each one should become, the images already in the
 * media library, and the section types this site has — and keeps the brief's
 * rules: the outline's words only, nothing invented, the imported text
 * removed once the sections hold it, the change left in Proof.
 */
export function rebuildRequest(rebuild: RebuildBrief, sectionTypes: Array<{ type: string; label?: string }>, originalUrl?: string): string {
  const builderName = { elementor: "Elementor", divi: "Divi", wpbakery: "WPBakery", beaver: "Beaver Builder" }[rebuild.builder];
  const label = (type: string) => sectionTypes.find((entry) => entry.type === type)?.label || type;
  const lines = rebuild.outline.sections.map((section, i) => {
    const suggestion = rebuild.suggestions[i];
    const what = summarizeSection(section) || "content";
    const pictures = images(section);
    const picturesText = pictures.length ? ` Images: ${pictures.slice(0, 6).join(", ")}${pictures.length > 6 ? ` and ${pictures.length - 6} more` : ""}.` : "";

    return suggestion?.blockType
      ? `${i + 1}. ${what} → a “${label(suggestion.blockType)}” section (\`${suggestion.blockType}\`, ${suggestion.confidence} confidence).${picturesText}`
      : `${i + 1}. ${what} → no close match: keep its words in a text section, or ask me how to show it.${picturesText}`;
  });
  const proposals = rebuild.suggestions.filter((suggestion) => suggestion.blockType && suggestion.content && Object.keys(suggestion.content).length);

  return [
    `Rebuild the page “${rebuild.title}” (${rebuild.path}) from this site's own sections. On the old site it was made with ${builderName}${originalUrl ? ` (${originalUrl})` : ""}; it was imported as plain text, which is in the page now.`,
    "",
    "Sections, top to bottom:",
    ...lines,
    "",
    `Section types this site has: ${sectionTypes.map((entry) => `${entry.label || entry.type} (\`${entry.type}\`)`).join(", ")}.`,
    ...(proposals.length
      ? ["", "What each matched section should hold, read from the old page:", "```json", JSON.stringify(proposals.map((suggestion) => ({ type: suggestion.blockType, ...suggestion.content })), null, 1), "```"]
      : []),
    "",
    "Use the page's words exactly as they are — no new claims, numbers, names or links. The images are already in the media library at the addresses shown. When the sections hold everything, remove the imported text so nothing appears twice. Change only this page; I'll check it in Proof.",
  ].join("\n");
}
