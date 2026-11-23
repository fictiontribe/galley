// Content model for the site.
//
// Four collections of files — pages, lookbooks, journal and products (the
// story around each product: its making, its fit, what goes with it), each a
// folder of markdown files with YAML front matter — `forms`, one JSON file
// per form (the site kit's format, src/galley/schema.js; rendered by its Form
// component) — and two collections that come from the shop, not from files:
// `storeProducts` and `storeCollections` (src/lib/shop/loader.ts reads them
// from the connected store, or the demo catalogue, when the site is built).
// A section shows a product by its *handle* ("field-coat"), a plain string.
// Pages (and lookbooks, after their looks) are
// built from an ordered list of `sections`; every section has a `type` that
// names a component in src/components/sections/. To add a section type:
// write the component, add a schema below, add it to `section`, and register
// it in src/components/Sections.astro.
//
// Images are plain string paths under /images/ (files live in public/images/).
// The shot list in galley/photography/shots.json names every one of them.

import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { formSchema } from "./galley/schema.js";
import { shopLoader } from "./lib/shop/loader";

// ── Shared pieces ──────────────────────────────────────────────────────────

/** Background treatment of a section. */
const tone = z.enum(["default", "muted", "inverse", "accent"]);

/** A link rendered as a button or a text link: { label, href }. */
const link = z.object({
  label: z.string(),
  href: z.string(),
});

/** Which side of the frame the subject of a photograph stands on. */
const focus = z.enum(["left", "center", "right"]);

/** One garment in a look: "Field coat", "undyed Shetland wool", "£640", and the product it is in the shop. */
const piece = z.object({
  name: z.string(),
  detail: z.string().optional(),
  price: z.string().optional(),
  /** The product's handle in the shop ("field-coat"): the look links to it and shows the shop's price. */
  product: z.string().optional(),
});

// ── Section types ──────────────────────────────────────────────────────────
// Every section accepts `id` (an anchor for links like /atelier/#workroom)
// and `tone`. Prop names are shared: eyebrow, heading, text, image, imageAlt,
// items, cta, secondaryCta; variants are enums and booleans.

const campaignHeroSection = z.object({
  type: z.literal("campaign-hero"),
  id: z.string().optional(),
  tone: tone.default("inverse"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  cta: link.optional(),
  secondaryCta: link.optional(),
  image: z.string(),
  imageAlt: z.string(),
  /** Where the headline sits on the photograph. */
  position: z.enum(["bottom-left", "bottom-right", "center", "top-left"]).default("bottom-left"),
  /** shade: a dark band laid under the words. plate: the words on a solid block of the section's tone. */
  scrim: z.enum(["shade", "plate"]).default("shade"),
  /** full: the height of the screen. tall: four-fifths of it. */
  size: z.enum(["full", "tall"]).default("full"),
  /** The side of the frame to keep when a narrow screen crops the photograph. */
  imageFocus: focus.default("center"),
});

const splitEditorialSection = z.object({
  type: z.literal("split-editorial"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  image: z.string(),
  imageAlt: z.string(),
  /** The picture's side; text left, picture right is the house order. */
  imageSide: z.enum(["left", "right"]).default("right"),
  ratio: z.enum(["portrait", "square", "landscape"]).default("portrait"),
  cta: link.optional(),
  secondaryCta: link.optional(),
});

const lookbookGridSection = z.object({
  type: z.literal("lookbook-grid"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  /** The lookbook to show, by file name. Leave out for the newest. */
  lookbook: reference("lookbooks").optional(),
  /** How many looks to show. Leave out for all of them. */
  limit: z.number().int().min(1).max(24).optional(),
  columns: z.number().int().min(2).max(4).default(3),
  crop: z.enum(["tall", "portrait", "square"]).default("tall"),
  /** Drop every other column a little, so the grid reads like a contact sheet. */
  offset: z.boolean().default(false),
  /** Each look's line under its number. */
  captions: z.boolean().default(false),
  cta: link.optional(),
});

const lookSection = z.object({
  type: z.literal("look"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  image: z.string(),
  imageAlt: z.string(),
  pieces: z.array(piece).default([]),
  imageSide: z.enum(["left", "right"]).default("right"),
  cta: link.optional(),
});

const gallerySection = z.object({
  type: z.literal("gallery"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  /** mosaic: one large frame beside four small ones. row: one even row. grid: three columns. */
  layout: z.enum(["mosaic", "row", "grid"]).default("mosaic"),
  items: z.array(
    z.object({
      image: z.string(),
      imageAlt: z.string(),
    }),
  ),
});

const imageBandSection = z.object({
  type: z.literal("image-band"),
  id: z.string().optional(),
  tone: tone.default("default"),
  image: z.string(),
  imageAlt: z.string(),
  ratio: z.enum(["panorama", "wide"]).default("panorama"),
});

const quoteSection = z.object({
  type: z.literal("quote"),
  id: z.string().optional(),
  tone: tone.default("default"),
  quote: z.string(),
  name: z.string(),
  role: z.string().optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  size: z.enum(["large", "medium"]).default("large"),
  align: z.enum(["left", "center"]).default("left"),
});

const statementSection = z.object({
  type: z.literal("statement"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  /** The statement itself, set very large. */
  heading: z.string(),
  text: z.string().optional(),
  cta: link.optional(),
  size: z.enum(["large", "medium"]).default("large"),
  align: z.enum(["left", "center"]).default("left"),
  /** The words turn from grey to ink one by one as the sentence crosses the screen. Once a page. */
  highlight: z.boolean().default(false),
});

const piecesSection = z.object({
  type: z.literal("pieces"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  columns: z.number().int().min(2).max(4).default(4),
  ratio: z.enum(["portrait", "square"]).default("portrait"),
  items: z.array(
    z.object({
      image: z.string(),
      imageAlt: z.string(),
      name: z.string(),
      note: z.string().optional(),
      /** Shown as text: for pieces that are not in the shop (use product-rail for those that are). */
      price: z.string().optional(),
      link: link.optional(),
    }),
  ),
  cta: link.optional(),
});

const storySection = z.object({
  type: z.literal("story"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  /** Markdown. */
  text: z.string(),
  /** two-column: the heading in the left margin, the text beside it. */
  layout: z.enum(["single", "two-column"]).default("single"),
  dropCap: z.boolean().default(false),
});

const journalListSection = z.object({
  type: z.literal("journal-list"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  limit: z.number().int().min(1).max(12).default(3),
  /** Only show stories carrying this tag. */
  tag: z.string().optional(),
  layout: z.enum(["grid", "list"]).default("grid"),
  cta: link.optional(),
});

const stockistsSection = z.object({
  type: z.literal("stockists"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  /** Groups from src/data/stockists.json to show, by id. Leave out for all. */
  groups: z.array(z.string()).optional(),
  layout: z.enum(["columns", "list"]).default("columns"),
});

const marqueeSection = z.object({
  type: z.literal("marquee"),
  id: z.string().optional(),
  tone: tone.default("inverse"),
  items: z.array(z.string()).min(2),
  speed: z.enum(["slow", "normal"]).default("slow"),
  size: z.enum(["medium", "large"]).default("medium"),
});

const newsletterSection = z.object({
  type: z.literal("newsletter"),
  id: z.string().optional(),
  tone: tone.default("muted"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** The sign-up form, by file name in src/content/forms/. */
  form: reference("forms").default("newsletter"),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  layout: z.enum(["inline", "stacked"]).default("inline"),
});

const ctaSection = z.object({
  type: z.literal("cta"),
  id: z.string().optional(),
  tone: tone.default("accent"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  cta: link,
  secondaryCta: link.optional(),
  /** A photograph behind the words, under the shade. */
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  align: z.enum(["left", "center"]).default("left"),
});

const contactSection = z.object({
  type: z.literal("contact"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** The form, by file name in src/content/forms/. */
  form: reference("forms").default("contact"),
  items: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        href: z.string().optional(),
      }),
    )
    .optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
});

const filmSection = z.object({
  type: z.literal("film"),
  id: z.string().optional(),
  tone: tone.default("inverse"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** The poster frame. */
  image: z.string(),
  imageAlt: z.string(),
  /** Where the film plays — it opens there; nothing is embedded. */
  href: z.string(),
  /** "2:48" */
  duration: z.string().optional(),
  ratio: z.enum(["wide", "panorama"]).default("wide"),
});

const formSection = z.object({
  type: z.literal("form"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Which form, by file name in src/content/forms/. */
  form: reference("forms"),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
});

const chaptersSection = z.object({
  type: z.literal("chapters"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Two to four steps, each with its own photograph (shown at 4:3). */
  items: z
    .array(
      z.object({
        heading: z.string(),
        text: z.string(),
        image: z.string(),
        imageAlt: z.string(),
      }),
    )
    .min(2)
    .max(4),
});

const creditsSection = z.object({
  type: z.literal("credits"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  columns: z.number().int().min(2).max(4).default(3),
  items: z.array(
    z.object({
      role: z.string(),
      name: z.string(),
    }),
  ),
});

// ── Shop sections: products and collections by handle ──────────────────────

const featuredProductSection = z.object({
  type: z.literal("featured-product"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  /** Leave out to use the product's name. */
  heading: z.string().optional(),
  /** Why this piece, in a sentence or two. Leave out to use the start of the shop's description. */
  text: z.string().optional(),
  /** The product's handle in the shop. */
  product: z.string(),
  /** A photograph to use instead of the product's first. */
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  imageSide: z.enum(["left", "right"]).default("right"),
});

const productRailSection = z.object({
  type: z.literal("product-rail"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Products by handle, in this order. Leave empty to show a collection instead. */
  products: z.array(z.string()).default([]),
  /** A collection's handle: its products, when `products` is empty. */
  collection: z.string().optional(),
  limit: z.number().int().min(2).max(8).default(4),
  columns: z.number().int().min(2).max(4).default(4),
  ratio: z.enum(["portrait", "square"]).default("portrait"),
  cta: link.optional(),
});

const collectionGridSection = z.object({
  type: z.literal("collection-grid"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Collections by handle, in this order. Leave empty for all of them. */
  collections: z.array(z.string()).default([]),
});

const shopTheLookSection = z.object({
  type: z.literal("shop-the-look"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  image: z.string(),
  imageAlt: z.string(),
  imageSide: z.enum(["left", "right"]).default("right"),
  /** The pieces in the picture, by handle. */
  products: z.array(z.string()).min(1).max(5),
  cta: link.optional(),
});

/** Every known section type, told apart by `type`. */
const section = z.discriminatedUnion("type", [
  campaignHeroSection,
  splitEditorialSection,
  lookbookGridSection,
  lookSection,
  gallerySection,
  imageBandSection,
  quoteSection,
  statementSection,
  piecesSection,
  storySection,
  journalListSection,
  stockistsSection,
  marqueeSection,
  newsletterSection,
  ctaSection,
  contactSection,
  filmSection,
  formSection,
  chaptersSection,
  creditsSection,
  featuredProductSection,
  productRailSection,
  collectionGridSection,
  shopTheLookSection,
]);

/**
 * A section whose `type` is not one of the above. Accepted so a typo or a
 * half-finished section never breaks the build; it renders as a notice in
 * development and as nothing in production. Known types never fall through to
 * here, so their validation errors still fail the build.
 */
const knownSectionTypes: ReadonlySet<string> = new Set(section.options.map((option) => option.shape.type.value));
const unknownSection = z.looseObject({ type: z.string() }).superRefine((value, ctx) => {
  if (!knownSectionTypes.has(value.type)) return;
  // A known type that failed its own schema: report that schema's errors.
  const result = section.safeParse(value);
  for (const issue of result.error?.issues ?? []) {
    ctx.addIssue({ code: "custom", path: issue.path, message: `${value.type}: ${issue.message}` });
  }
});

// ── Collections ────────────────────────────────────────────────────────────

/** A page: its sections, then its markdown body (if any) as prose. */
export const pageSchema = z.object({
  title: z.string(),
  description: z.string(),
  /** Social share image. Falls back to `shareImage` in site.json. */
  image: z.string().optional(),
  noindex: z.boolean().default(false),
  sections: z.array(z.union([section, unknownSection])).default([]),
});

/** A season's lookbook: a cover, the looks in order, then any sections. */
export const lookbookSchema = z.object({
  title: z.string(),
  /** "Autumn–Winter 2026" */
  season: z.string(),
  /** One or two sentences; also the page's description. */
  summary: z.string(),
  /** Orders the lookbooks, newest first. */
  date: z.coerce.date(),
  cover: z.string(),
  coverAlt: z.string(),
  looks: z.array(
    z.object({
      image: z.string(),
      alt: z.string(),
      caption: z.string().optional(),
      pieces: z.array(piece).default([]),
    }),
  ),
  sections: z.array(z.union([section, unknownSection])).default([]),
  draft: z.boolean().default(false),
});

const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: pageSchema,
});

const lookbooks = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/lookbooks" }),
  schema: lookbookSchema,
});

const journal = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/journal" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    /** The writer's name, as it should be printed. */
    author: z.string(),
    image: z.string(),
    imageAlt: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

/**
 * The story around one product, shown on its page under the buy box: the
 * making, the fit, a quote, more photographs. `product` is the handle in the
 * shop; a product without a file here gets the page without the story.
 */
export const productStorySchema = z.object({
  /** The product's handle in the shop. */
  product: z.string(),
  /** A line about fit, under the sizes ("Cut generously: take your usual size"). */
  fit: z.string().optional(),
  /** Pieces that go with it, by handle. Leave empty for others from the same collection. */
  related: z.array(z.string()).default([]),
  sections: z.array(z.union([section, unknownSection])).default([]),
});

const products = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/products" }),
  schema: productStorySchema,
});

/** From the shop, when the site is built: not files, so not edited here — products are edited in the store. */
const storeProducts = defineCollection({ loader: shopLoader("products") });
const storeCollections = defineCollection({ loader: shopLoader("collections") });

/** Forms: one JSON file each, in the site kit's format. */
const forms = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/forms" }),
  schema: formSchema,
});

export const collections = { pages, lookbooks, journal, products, forms, storeProducts, storeCollections };
