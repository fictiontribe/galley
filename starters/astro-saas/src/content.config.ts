// Content model for the site.
//
// Five collections — pages, customers, blog, changelog, team — each a folder
// of markdown files with YAML front matter, and `forms`, one JSON file per
// form (the site kit's format, src/galley/schema.js). Pages are built from an ordered
// list of `sections`; every section has a `type` that names a component in
// src/components/sections/. To add a section type: write the component, add
// a schema below, add it to `section`, register it in
// src/components/Sections.astro, and describe it in galley.config.json.
//
// Images are plain string paths under /images/ (files live in public/images/).

import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { formSchema } from "./galley/schema.js";

// ── Shared pieces ──────────────────────────────────────────────────────────

/** Background treatment of a section. */
const tone = z.enum(["default", "muted", "inverse", "accent"]);

/** Horizontal alignment of a section's heading block. */
const align = z.enum(["left", "center"]);

/** Which side an image sits on, on wide screens. */
const imageSide = z.enum(["left", "right"]);

/** How a product screenshot is framed: an app window, or the image alone. */
const frame = z.enum(["window", "bare"]);

/** A link rendered as a button: { label, href }. */
const link = z.object({
  label: z.string(),
  href: z.string(),
});

/** Names of the icons in src/components/Icon.astro that content may use. */
const icon = z.enum([
  "calendar",
  "checklist",
  "wrench",
  "shield",
  "certificate",
  "chart",
  "pin",
  "building",
  "users",
  "bell",
  "clock",
  "phone",
  "offline",
  "plug",
  "key",
  "lock",
  "server",
  "globe",
  "layers",
  "sync",
  "inbox",
  "webhook",
  "code",
  "table",
  "truck",
  "gauge",
  "receipt",
  "directory",
  "database",
  "eye",
  "camera",
  "route",
  "flag",
  "document",
]);

/** Industries a customer story can be filed under (and filtered by). */
const industry = z.enum(["Logistics", "Senior living", "Education", "Hospitality", "Food manufacturing", "Healthcare", "Retail"]);

/** A figure with its label: "41%" + "fewer overdue inspections". A bare number (`value: 380`) is fine too. */
const metric = z.object({
  value: z.coerce.string(),
  label: z.string(),
  text: z.string().optional(),
});

/** Every section accepts `id` (an anchor, e.g. /product/#inspections) and `tone`. */
const common = {
  id: z.string().optional(),
  tone: tone.default("default"),
};

// ── Section types ──────────────────────────────────────────────────────────
// Prop names are shared: eyebrow, heading, text, items, image, imageAlt, cta,
// secondaryCta, plus the variant options align, columns, imageSide, frame,
// layout and style.

// Heroes

const heroSection = z.object({
  type: z.literal("hero"),
  ...common,
  /** A short announcement above the heading, linking to the news. */
  announcement: link.optional(),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  cta: link.optional(),
  secondaryCta: link.optional(),
  /** Short proof points under the buttons. */
  items: z.array(z.string()).optional(),
  align: align.default("center"),
  /** Draw the planner grid behind the hero. */
  grid: z.boolean().default(true),
});

const heroSplitSection = z.object({
  type: z.literal("hero-split"),
  ...common,
  announcement: link.optional(),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  cta: link.optional(),
  secondaryCta: link.optional(),
  items: z.array(z.string()).optional(),
  image: z.string(),
  imageAlt: z.string(),
  imageSide: imageSide.default("right"),
  frame: frame.default("window"),
  grid: z.boolean().default(true),
});

const heroFormSection = z.object({
  type: z.literal("hero-form"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** What the visitor gets, as a short list beside the form. */
  items: z.array(z.string()).optional(),
  formHeading: z.string(),
  formText: z.string().optional(),
  /** The form, by file name in src/content/forms/ — its fields, wording and destination live there. */
  form: reference("forms").default("demo"),
  note: z.string().optional(),
  grid: z.boolean().default(true),
});

// Proof

const logosSection = z.object({
  type: z.literal("logos"),
  ...common,
  heading: z.string().optional(),
  items: z.array(
    z.object({
      name: z.string(),
      image: z.string(),
      href: z.string().optional(),
    }),
  ),
  layout: z.enum(["row", "grid"]).default("row"),
});

const metricsSection = z.object({
  type: z.literal("metrics"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  items: z.array(metric),
  columns: z.number().int().min(2).max(4).default(4),
  style: z.enum(["plain", "cards"]).default("plain"),
  /** Where the figures come from, in small print. */
  note: z.string().optional(),
});

const testimonialSection = z.object({
  type: z.literal("testimonial"),
  ...common,
  quote: z.string(),
  name: z.string(),
  role: z.string().optional(),
  company: z.string().optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  logo: z.string().optional(),
  cta: link.optional(),
  align: align.default("left"),
});

const testimonialsSection = z.object({
  type: z.literal("testimonials"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      quote: z.string(),
      name: z.string(),
      role: z.string().optional(),
      company: z.string().optional(),
      image: z.string().optional(),
    }),
  ),
  columns: z.number().int().min(2).max(3).default(3),
  style: z.enum(["cards", "plain"]).default("cards"),
});

const caseStudiesSection = z.object({
  type: z.literal("case-studies"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Stories to show, by file name. Leave out to show the newest. */
  items: z.array(reference("customers")).optional(),
  /** Only stories from this industry. */
  industry: industry.optional(),
  limit: z.number().int().min(1).max(12).default(3),
  layout: z.enum(["grid", "featured"]).default("grid"),
  cta: link.optional(),
});

const awardsSection = z.object({
  type: z.literal("awards"),
  ...common,
  heading: z.string().optional(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      label: z.string(),
      detail: z.string().optional(),
      image: z.string().optional(),
      imageAlt: z.string().optional(),
    }),
  ),
  style: z.enum(["badges", "ratings"]).default("badges"),
});

// Product

const featuresSection = z.object({
  type: z.literal("features"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      icon: icon.optional(),
      heading: z.string(),
      text: z.string(),
      cta: link.optional(),
    }),
  ),
  columns: z.number().int().min(2).max(4).default(3),
  style: z.enum(["plain", "cards"]).default("plain"),
  align: align.default("left"),
});

const featureSplitSection = z.object({
  type: z.literal("feature-split"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(z.string()).optional(),
  image: z.string(),
  imageAlt: z.string(),
  imageSide: imageSide.default("right"),
  frame: frame.default("window"),
  cta: link.optional(),
  secondaryCta: link.optional(),
});

const featureTabsSection = z.object({
  type: z.literal("feature-tabs"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      label: z.string(),
      heading: z.string(),
      text: z.string(),
      items: z.array(z.string()).optional(),
      image: z.string(),
      imageAlt: z.string(),
      cta: link.optional(),
    }),
  ),
  /** Tabs above the panel, or a list beside it. */
  layout: z.enum(["horizontal", "vertical"]).default("horizontal"),
  frame: frame.default("window"),
});

const stepsSection = z.object({
  type: z.literal("steps"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      heading: z.string(),
      text: z.string(),
      /** A short duration or owner, e.g. "Week 1". */
      label: z.string().optional(),
    }),
  ),
  layout: z.enum(["row", "timeline"]).default("row"),
  cta: link.optional(),
});

const integrationsSection = z.object({
  type: z.literal("integrations"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      icon: icon.optional(),
      image: z.string().optional(),
      text: z.string().optional(),
    }),
  ),
  /** One block per category, or one grid with the category on each tile. */
  layout: z.enum(["grouped", "grid"]).default("grouped"),
  cta: link.optional(),
});

const comparisonSection = z.object({
  type: z.literal("comparison"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Column headings, left to right: usually you first, then the alternatives. */
  columns: z.array(z.string()),
  /** Each row's `values` lines up with `columns`: "yes", "no", "partial" or a few words. */
  items: z.array(
    z.object({
      label: z.string(),
      values: z.array(z.string()),
    }),
  ),
  /** Which column to highlight, counting from 1. */
  highlight: z.number().int().min(1).max(4).default(1),
  note: z.string().optional(),
});

const useCasesSection = z.object({
  type: z.literal("use-cases"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      icon: icon.optional(),
      label: z.string().optional(),
      heading: z.string(),
      text: z.string(),
      href: z.string(),
      image: z.string().optional(),
      imageAlt: z.string().optional(),
    }),
  ),
  columns: z.number().int().min(2).max(4).default(3),
  style: z.enum(["cards", "list"]).default("cards"),
});

const screenshotSection = z.object({
  type: z.literal("screenshot"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  image: z.string(),
  imageAlt: z.string(),
  caption: z.string().optional(),
  /** Numbered notes under the picture. */
  items: z.array(z.object({ heading: z.string(), text: z.string() })).optional(),
  frame: frame.default("window"),
  width: z.enum(["normal", "wide"]).default("wide"),
});

// Pricing

const pricingSection = z.object({
  type: z.literal("pricing"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      name: z.string(),
      price: z.string(),
      period: z.string().optional(),
      text: z.string().optional(),
      features: z.array(z.string()).default([]),
      cta: link.optional(),
      featured: z.boolean().default(false),
      badge: z.string().optional(),
    }),
  ),
  note: z.string().optional(),
  align: align.default("center"),
});

const pricingTableSection = z.object({
  type: z.literal("pricing-table"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Plan names, left to right. */
  plans: z.array(z.string()),
  /** Groups of rows; each row's `values` lines up with `plans`. */
  items: z.array(
    z.object({
      heading: z.string(),
      rows: z.array(
        z.object({
          label: z.string(),
          values: z.array(z.string()),
        }),
      ),
    }),
  ),
  /** Which plan to highlight, counting from 1. */
  highlight: z.number().int().min(1).max(4).default(2),
});

const faqSection = z.object({
  type: z.literal("faq"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
    }),
  ),
  /** Heading beside the questions, or above them. */
  layout: z.enum(["split", "stacked"]).default("split"),
  cta: link.optional(),
});

// Content

const richTextSection = z.object({
  type: z.literal("rich-text"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  /** Markdown. */
  text: z.string(),
  align: align.default("left"),
});

const postsSection = z.object({
  type: z.literal("posts"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  limit: z.number().int().min(1).max(12).default(3),
  /** Only show posts carrying this tag. */
  tag: z.string().optional(),
  layout: z.enum(["grid", "list"]).default("grid"),
  cta: link.optional(),
});

const changelogSection = z.object({
  type: z.literal("changelog"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  limit: z.number().int().min(1).max(12).default(4),
  layout: z.enum(["list", "cards"]).default("list"),
  cta: link.optional(),
});

const teamSection = z.object({
  type: z.literal("team"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Team members to show, by file name. Leave out to show everyone, in `order`. */
  members: z.array(reference("team")).optional(),
  columns: z.number().int().min(2).max(4).default(3),
  style: z.enum(["portrait", "compact"]).default("portrait"),
});

// Trust & conversion

const securitySection = z.object({
  type: z.literal("security"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      icon: icon.optional(),
      heading: z.string(),
      text: z.string(),
    }),
  ),
  /** Short reassurance labels, shown as a row of chips. */
  badges: z.array(z.string()).optional(),
  layout: z.enum(["grid", "split"]).default("grid"),
  cta: link.optional(),
});

const ctaSection = z.object({
  type: z.literal("cta"),
  ...common,
  tone: tone.default("inverse"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  cta: link,
  secondaryCta: link.optional(),
  align: align.default("left"),
  /** A full-width band, or a panel inset in the page. */
  style: z.enum(["band", "panel"]).default("band"),
});

const contactSection = z.object({
  type: z.literal("contact"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** The form, by file name in src/content/forms/ — its fields, wording and destination live there. */
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
  layout: z.enum(["inline", "stacked"]).default("inline"),
});

const formSection = z.object({
  type: z.literal("form"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  /** Which form, by file name in src/content/forms/. */
  form: reference("forms"),
  /** Small print under the form. */
  note: z.string().optional(),
  /** Heading beside the form, or above it. */
  layout: z.enum(["stacked", "split"]).default("stacked"),
});

/** Every known section type, told apart by `type`. */
const section = z.discriminatedUnion("type", [
  heroSection,
  heroSplitSection,
  heroFormSection,
  logosSection,
  metricsSection,
  testimonialSection,
  testimonialsSection,
  caseStudiesSection,
  awardsSection,
  featuresSection,
  featureSplitSection,
  featureTabsSection,
  stepsSection,
  integrationsSection,
  comparisonSection,
  useCasesSection,
  screenshotSection,
  pricingSection,
  pricingTableSection,
  faqSection,
  richTextSection,
  postsSection,
  changelogSection,
  teamSection,
  securitySection,
  ctaSection,
  contactSection,
  newsletterSection,
  formSection,
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

/** A customer story. The markdown body is the story itself. */
export const customerSchema = z.object({
  company: z.string(),
  industry: industry,
  logo: z.string(),
  /** The story's headline — its page title. */
  headline: z.string(),
  summary: z.string(),
  date: z.coerce.date(),
  /** Cover picture for cards and the top of the story. */
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  /** Facts about the customer: { label: "Sites", value: "14 depots" }. */
  facts: z
    .array(
      z.object({
        label: z.string(),
        value: z.coerce.string(),
      }),
    )
    .default([]),
  results: z.array(metric).default([]),
  quote: z
    .object({
      text: z.string(),
      name: z.string(),
      role: z.string().optional(),
      image: z.string().optional(),
    })
    .optional(),
  featured: z.boolean().default(false),
  draft: z.boolean().default(false),
});

const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: pageSchema,
});

const customers = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/customers" }),
  schema: customerSchema,
});

const blog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    /** A team member's file name (e.g. "hana-lindqvist"), or a guest author's name. */
    author: z.string(),
    image: z.string(),
    imageAlt: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const changelog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/changelog" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    /** A release label such as "4.2", shown beside the date. */
    version: z.string().optional(),
    tags: z.array(z.enum(["New", "Improved", "Fixed"])).default([]),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

/** One form per file; the file name is the form's id (`form: contact` in a section). */
const forms = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/forms" }),
  schema: formSchema,
});

const team = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/team" }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    photo: z.string(),
    bio: z.string(),
    order: z.number().default(100),
    links: z
      .array(
        z.object({
          label: z.string(),
          href: z.string(),
        }),
      )
      .default([]),
  }),
});

export const collections = { pages, customers, blog, changelog, team, forms };
