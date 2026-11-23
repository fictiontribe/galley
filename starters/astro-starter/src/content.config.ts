// Content model for the site.
//
// Four collections — pages, blog, authors, team — each a folder of markdown
// files with YAML front matter, and `forms`, one JSON file per form (the site
// kit's format, src/galley/schema.js). Pages are built from an ordered list of
// `sections`; every section has a `type` that names a component in
// src/components/sections/. To add a section type: write the component, add a
// schema below, add it to `section`, register it in
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

/** A link rendered as a button: { label, href }. */
const link = z.object({
  label: z.string(),
  href: z.string(),
});

/** Names of the icons in src/components/Icon.astro that content may use. */
const icon = z.enum([
  "compass",
  "ruler",
  "pencil",
  "home",
  "layers",
  "leaf",
  "sun",
  "key",
  "hammer",
  "chat",
  "calendar",
  "clipboard",
  "mail",
  "pin",
  "clock",
  "check",
]);

/** Every section accepts `id` (an anchor for links like /about/#team) and `tone`. */
const common = {
  id: z.string().optional(),
  tone: tone.default("default"),
};

// ── Section types ──────────────────────────────────────────────────────────
// Prop names are shared: eyebrow, heading, text, items, image, imageAlt, cta,
// secondaryCta, plus the variant options align, imageSide and columns.

const heroSection = z.object({
  type: z.literal("hero"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  cta: link.optional(),
  secondaryCta: link.optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  align: align.default("left"),
});

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
});

const featuresSection = z.object({
  type: z.literal("features"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  columns: z.number().int().min(2).max(4).default(3),
  items: z.array(
    z.object({
      icon: icon.optional(),
      heading: z.string(),
      text: z.string(),
      cta: link.optional(),
    }),
  ),
});

const splitSection = z.object({
  type: z.literal("split"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(z.string()).optional(),
  image: z.string(),
  imageAlt: z.string(),
  imageSide: z.enum(["left", "right"]).default("right"),
  cta: link.optional(),
  secondaryCta: link.optional(),
});

const statsSection = z.object({
  type: z.literal("stats"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  columns: z.number().int().min(2).max(4).default(4),
  items: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      text: z.string().optional(),
    }),
  ),
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
    }),
  ),
  cta: link.optional(),
});

const testimonialSection = z.object({
  type: z.literal("testimonial"),
  ...common,
  quote: z.string(),
  name: z.string(),
  role: z.string().optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
});

const testimonialsSection = z.object({
  type: z.literal("testimonials"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  columns: z.number().int().min(2).max(3).default(3),
  items: z.array(
    z.object({
      quote: z.string(),
      name: z.string(),
      role: z.string().optional(),
    }),
  ),
});

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
});

const gallerySection = z.object({
  type: z.literal("gallery"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  columns: z.number().int().min(2).max(4).default(3),
  items: z.array(
    z.object({
      image: z.string(),
      imageAlt: z.string(),
      caption: z.string().optional(),
    }),
  ),
});

const teamSection = z.object({
  type: z.literal("team"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Team members to show, by file name. Leave out to show everyone, in `order`. */
  members: z.array(reference("team")).optional(),
  columns: z.number().int().min(2).max(4).default(4),
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
  cta: link.optional(),
});

const richTextSection = z.object({
  type: z.literal("rich-text"),
  ...common,
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  /** Markdown. */
  text: z.string(),
  align: align.default("left"),
});

const ctaSection = z.object({
  type: z.literal("cta"),
  ...common,
  tone: tone.default("accent"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  cta: link,
  secondaryCta: link.optional(),
  align: align.default("left"),
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
  logosSection,
  featuresSection,
  splitSection,
  statsSection,
  stepsSection,
  testimonialSection,
  testimonialsSection,
  pricingSection,
  faqSection,
  gallerySection,
  teamSection,
  postsSection,
  richTextSection,
  ctaSection,
  contactSection,
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

const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: pageSchema,
});

const blog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    /** Who wrote it, by file name in src/content/authors/ (e.g. "nell-okafor"). */
    author: reference("authors"),
    image: z.string(),
    imageAlt: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

/** The people who write the journal — the team, and guests. */
const authors = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/authors" }),
  schema: z.object({
    name: z.string(),
    /** A job title, or "Guest writer". */
    role: z.string().optional(),
    photo: z.string().optional(),
    bio: z.string(),
  }),
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

/** One form per file; the file name is the form's id (`form: contact` in a section). */
const forms = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/forms" }),
  schema: formSchema,
});

export const collections = { pages, blog, authors, team, forms };
