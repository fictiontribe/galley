// Content model for the site.
//
// Collections, each a folder of plain files:
//   blog     src/content/blog/*.md       posts → /blog/<file>/
//   authors  src/content/authors/*.md    people → /authors/<file>/
//   series   src/content/series/*.md     a run of posts → /series/<file>/
//   pages    src/content/pages/**/*.md   pages built from `sections` → /<file>/
//   forms    src/content/forms/*.json    one form per file (the site kit's format)
//
// Posts are Markdown, never MDX: charts, comparison tables and the rest are
// fenced blocks in the body (```chart … ```), whose YAML follows the "Embeds"
// schemas below; the same schemas are page sections, so a chart can sit on a
// page or in a post. Images are plain paths under /images/ (public/images/).
//
// To add a section type: write the component in src/components/sections/, add
// a schema below and put it in `section`, register it in
// src/components/Sections.astro, and describe it in galley.config.json.

import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { formSchema } from "./galley/schema.js";

// ── Shared pieces ──────────────────────────────────────────────────────────

/** Background of a section. */
const tone = z.enum(["default", "muted", "inverse", "accent"]);

/** A link shown as a button or a text link: { label, href }. */
const link = z.object({
  label: z.string(),
  href: z.string(),
});

/** How wide an embed sits in a post: the reading column, or wider. */
const width = z.enum(["text", "wide"]);

/** Every section accepts `id` (an anchor, e.g. /about/#numbers) and `tone`. */
const common = {
  id: z.string().optional(),
  tone: tone.default("default"),
};

// ── Embeds ─────────────────────────────────────────────────────────────────
// Each is a fenced block in a post (```chart) with these fields as YAML, and
// a page section of the same name with the same fields.

/** A chart: lines, areas, bars or columns, drawn as SVG with its numbers in a table beneath. */
const chartFields = {
  /** line: change over time. area: a total over time. column: few categories, side by side. bar: ranked categories, long labels. stacked: parts of a whole per category. */
  chart: z.enum(["line", "area", "column", "bar", "stacked"]).default("line"),
  title: z.string().optional(),
  /** One sentence on what to see, under the title. */
  text: z.string().optional(),
  /** The categories along the bottom (or down the side, for bars): months, years, names. */
  labels: z.array(z.coerce.string()),
  /** One or more series; each `values` lines up with `labels`. */
  series: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.number().nullable()),
    }),
  ),
  /** Unit after each value: "kWh", "%", "°C". */
  unit: z.string().optional(),
  /** Unit before each value: "£", "$". */
  prefix: z.string().optional(),
  /** The series the story is about, by name; the others are drawn quieter. */
  highlight: z.string().optional(),
  /** Start the value axis here instead of at zero (line charts only). */
  min: z.number().optional(),
  max: z.number().optional(),
  /** Notes pinned to a label: { at: "Mar", label: "Heat pump on" }. */
  notes: z.array(z.object({ at: z.coerce.string(), label: z.string() })).optional(),
  /** Where the numbers come from, in small print. */
  source: z.string().optional(),
  width: width.default("wide"),
};

/** A comparison table: options across the top, what you compare them on down the side. */
const compareFields = {
  title: z.string().optional(),
  text: z.string().optional(),
  /** Column headings, left to right. */
  columns: z.array(z.string()),
  /** A row's `values` line up with `columns`: "yes", "no", "partly" or a few words. `group` starts a new block of rows. */
  rows: z.array(
    z.object({
      label: z.string(),
      values: z.array(z.coerce.string()).default([]),
      group: z.string().optional(),
      note: z.string().optional(),
    }),
  ),
  /** The column to pick out, counting from 1. */
  highlight: z.number().int().min(1).max(8).optional(),
  /** A word over the highlighted column: "Our pick". */
  badge: z.string().optional(),
  source: z.string().optional(),
  width: width.default("wide"),
};

/** A few figures, set large, each with what it counts. */
const statsFields = {
  title: z.string().optional(),
  items: z.array(
    z.object({
      value: z.coerce.string(),
      label: z.string(),
      /** "-38%" or "+£120": shown small beside the figure. */
      change: z.string().optional(),
      /** Whether the change is good news (green) or bad (red). */
      trend: z.enum(["good", "bad", "neutral"]).default("neutral"),
    }),
  ),
  source: z.string().optional(),
  width: width.default("text"),
};

/** The end of a review: a score, one sentence, and what is good and bad. */
const verdictFields = {
  title: z.string(),
  /** A score out of `outOf`, e.g. 4 (out of 5) or 8.5 (out of 10). */
  score: z.number().optional(),
  outOf: z.number().default(5),
  summary: z.string(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  /** Who it suits, and who should look elsewhere. */
  bestFor: z.string().optional(),
  width: width.default("text"),
};

/** Two lists side by side: for and against. */
const prosconsFields = {
  title: z.string().optional(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  prosLabel: z.string().optional(),
  consLabel: z.string().optional(),
  width: width.default("text"),
};

/** Dated events, in order. */
const timelineFields = {
  title: z.string().optional(),
  items: z.array(
    z.object({
      date: z.coerce.string(),
      title: z.string(),
      text: z.string().optional(),
    }),
  ),
  width: width.default("text"),
};

/** Numbered steps: how to do something. */
const stepsFields = {
  title: z.string().optional(),
  items: z.array(
    z.object({
      title: z.string(),
      text: z.string().optional(),
      /** "20 minutes", "£15". */
      meta: z.string().optional(),
    }),
  ),
  width: width.default("text"),
};

/** Questions and answers that open one at a time. */
const faqFields = {
  title: z.string().optional(),
  items: z.array(
    z.object({
      question: z.string(),
      /** Markdown. */
      answer: z.string(),
    }),
  ),
  width: width.default("text"),
};

/** Photographs in a grid, each with an optional caption. */
const galleryFields = {
  title: z.string().optional(),
  items: z.array(
    z.object({
      image: z.string(),
      imageAlt: z.string(),
      caption: z.string().optional(),
    }),
  ),
  columns: z.number().int().min(2).max(4).default(2),
  width: width.default("wide"),
};

/** A line from the post, set large to slow the reader down. */
const pullquoteFields = {
  quote: z.string(),
  name: z.string().optional(),
  role: z.string().optional(),
  width: width.default("text"),
};

/** A film: its poster frame and a play mark, linking to where it is hosted. Nothing is embedded. */
const videoFields = {
  title: z.string(),
  href: z.string(),
  image: z.string(),
  imageAlt: z.string(),
  /** "12:40". */
  duration: z.string().optional(),
  caption: z.string().optional(),
  width: width.default("wide"),
};

/** The points to take away, as a short list in a box. */
const takeawaysFields = {
  title: z.string().optional(),
  items: z.array(z.string()),
  width: width.default("text"),
};

/** The embed schemas by kind, for the post page (src/lib/embeds.ts). */
export const embedSchemas = {
  chart: z.object(chartFields),
  compare: z.object(compareFields),
  stats: z.object(statsFields),
  verdict: z.object(verdictFields),
  proscons: z.object(prosconsFields),
  timeline: z.object(timelineFields),
  steps: z.object(stepsFields),
  faq: z.object(faqFields),
  gallery: z.object(galleryFields),
  pullquote: z.object(pullquoteFields),
  video: z.object(videoFields),
  takeaways: z.object(takeawaysFields),
};

// ── Section types ──────────────────────────────────────────────────────────
// Prop names are shared: eyebrow, heading, text, items, image, imageAlt, cta;
// variants are enums with defaults. `*word*` in a heading is the accent.

const introSection = z.object({
  type: z.literal("intro"),
  ...common,
  eyebrow: z.string().optional(),
  /** The site's one sentence, set large. */
  heading: z.string(),
  text: z.string().optional(),
  cta: link.optional(),
  secondaryCta: link.optional(),
  /** A portrait or photograph beside the words. */
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  /** statement: words only, large. portrait: words beside a round portrait. */
  layout: z.enum(["statement", "portrait"]).default("statement"),
});

const featuredSection = z.object({
  type: z.literal("featured"),
  ...common,
  heading: z.string().optional(),
  /** The lead post, by file name. Leave out to lead with the newest post marked `featured`. */
  post: reference("blog").optional(),
  /** How many more posts to list beside the lead. */
  more: z.number().int().min(0).max(6).default(3),
  /** lead: a large photograph with the rest beside it. split: two posts, side by side, then the rest. */
  layout: z.enum(["lead", "split"]).default("lead"),
});

const postsSection = z.object({
  type: z.literal("posts"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  /** Only posts filed under this tag. */
  tag: z.string().optional(),
  /** Skip this many of the newest posts (the ones a `featured` section above already shows). */
  offset: z.number().int().min(0).max(12).default(0),
  limit: z.number().int().min(1).max(24).default(6),
  /** list: title, line and date in rows. cards: photographs in a grid. index: titles and dates only, by year. */
  layout: z.enum(["list", "cards", "index"]).default("list"),
  cta: link.optional(),
});

const topicsSection = z.object({
  type: z.literal("topics"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  /** Show how many posts each topic has. */
  counts: z.boolean().default(true),
});

const seriesSection = z.object({
  type: z.literal("series"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  /** Series to show, by file name. Leave out for all of them. */
  items: z.array(reference("series")).optional(),
});

const authorSection = z.object({
  type: z.literal("author"),
  ...common,
  /** The author, by file name in src/content/authors/. */
  author: reference("authors"),
  heading: z.string().optional(),
  /** Markdown; leave out to use the author's own bio. */
  text: z.string().optional(),
  cta: link.optional(),
});

const newsletterSection = z.object({
  type: z.literal("newsletter"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** The form, by file name in src/content/forms/ — usually one email field. */
  form: reference("forms").default("newsletter"),
  note: z.string().optional(),
  /** inline: the heading beside the form. stacked: the form under the heading. */
  layout: z.enum(["inline", "stacked"]).default("inline"),
});

const richTextSection = z.object({
  type: z.literal("rich-text"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  /** Markdown. */
  text: z.string(),
  /** column: one reading column. margin: the heading in the margin beside the text. */
  layout: z.enum(["column", "margin"]).default("column"),
});

const imageSection = z.object({
  type: z.literal("image"),
  ...common,
  image: z.string(),
  imageAlt: z.string(),
  caption: z.string().optional(),
  /** wide: across the page. full: edge to edge. text: the reading column. */
  size: z.enum(["text", "wide", "full"]).default("wide"),
  ratio: z.enum(["landscape", "wide", "panorama"]).default("wide"),
});

const ctaSection = z.object({
  type: z.literal("cta"),
  ...common,
  tone: tone.default("muted"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  cta: link,
  secondaryCta: link.optional(),
});

const contactSection = z.object({
  type: z.literal("contact"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** The form, by file name in src/content/forms/. */
  form: reference("forms").default("contact"),
  /** Ways to get in touch beside the form: { label, value, href }. */
  items: z.array(z.object({ label: z.string(), value: z.string(), href: z.string().optional() })).optional(),
});

const chartSection = z.object({ type: z.literal("chart"), ...common, ...chartFields });
const compareSection = z.object({ type: z.literal("compare"), ...common, ...compareFields });
const statsSection = z.object({ type: z.literal("stats"), ...common, ...statsFields });
const timelineSection = z.object({ type: z.literal("timeline"), ...common, ...timelineFields });
const faqSection = z.object({ type: z.literal("faq"), ...common, ...faqFields });
const pullquoteSection = z.object({ type: z.literal("pullquote"), ...common, ...pullquoteFields });
const gallerySection = z.object({ type: z.literal("gallery"), ...common, ...galleryFields });

/** Every known section type, told apart by `type`. */
const section = z.discriminatedUnion("type", [
  introSection,
  featuredSection,
  postsSection,
  topicsSection,
  seriesSection,
  authorSection,
  newsletterSection,
  richTextSection,
  imageSection,
  ctaSection,
  contactSection,
  chartSection,
  compareSection,
  statsSection,
  timelineSection,
  faqSection,
  pullquoteSection,
  gallerySection,
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
  const result = section.safeParse(value);
  for (const issue of result.error?.issues ?? []) {
    ctx.addIssue({ code: "custom", path: issue.path, message: `${value.type}: ${issue.message}` });
  }
});

// ── Collections ────────────────────────────────────────────────────────────

/** A page: its sections, then its Markdown body (if any) as prose. */
export const pageSchema = z.object({
  title: z.string(),
  description: z.string(),
  /** Share image. Falls back to `shareImage` in site.json. */
  image: z.string().optional(),
  noindex: z.boolean().default(false),
  sections: z.array(z.union([section, unknownSection])).default([]),
});

/** A post. The Markdown body is the post; embeds are fenced blocks in it. */
export const postSchema = z.object({
  title: z.string(),
  /** The standfirst: one or two sentences under the title, and the description search engines and feeds show. */
  description: z.string(),
  date: z.coerce.date(),
  /** When the post last changed in substance. Shown beside the date, and in the feeds and structured data. */
  updated: z.coerce.date().optional(),
  /** The author, by file name in src/content/authors/. */
  author: reference("authors"),
  tags: z.array(z.string()).default([]),
  /** The series this post belongs to, by file name in src/content/series/, and its place in it. */
  series: reference("series").optional(),
  seriesPart: z.number().int().min(1).optional(),
  /** The cover photograph, also the share image. */
  image: z.string(),
  imageAlt: z.string(),
  imageCaption: z.string().optional(),
  /** Two to four sentences a reader in a hurry needs, shown above the post as "In short". */
  takeaways: z.array(z.string()).optional(),
  /** What the post rests on, listed at the end. */
  sources: z.array(z.object({ title: z.string(), href: z.string().optional(), note: z.string().optional() })).default([]),
  /** How AI was used in writing it — shown at the end, in the reader's words from site.json. */
  ai: z.enum(["none", "research", "editing", "drafting"]).optional(),
  /** What changed, and when, after it was published. */
  revisions: z.array(z.object({ date: z.coerce.date(), note: z.string() })).default([]),
  /** Show the contents list beside a long post. */
  toc: z.boolean().default(true),
  featured: z.boolean().default(false),
  /** The post's first home, when it was published somewhere else first: the canonical link points there. */
  canonical: z.string().optional(),
  noindex: z.boolean().default(false),
  draft: z.boolean().default(false),
});

export const authorSchema = z.object({
  name: z.string(),
  /** "Writes the blog", "Guest writer, heating engineer". */
  role: z.string(),
  photo: z.string(),
  photoAlt: z.string().optional(),
  /** One or two sentences, shown under posts. The Markdown body is the longer bio on the author's page. */
  bio: z.string(),
  links: z.array(link).default([]),
});

export const seriesSchema = z.object({
  title: z.string(),
  description: z.string(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  /** Still being written: says so on the series page. */
  ongoing: z.boolean().default(false),
});

const blog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/blog" }),
  schema: postSchema,
});

const authors = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/authors" }),
  schema: authorSchema,
});

const series = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/series" }),
  schema: seriesSchema,
});

const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: pageSchema,
});

/** One form per file; the file name is the form's id (`form: newsletter` in a section). */
const forms = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/forms" }),
  schema: formSchema,
});

export const collections = { blog, authors, series, pages, forms };
