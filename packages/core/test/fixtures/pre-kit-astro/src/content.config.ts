// Content model for the site.
//
// Three collections — pages, blog, team — each a folder of markdown files with
// YAML front matter. Pages are built from an ordered list of `sections`; every
// section has a `type` that names a component in src/components/sections/.
// To add a section type: write the component, add a schema below, add it to
// `section`, and register it in src/components/Sections.astro.
//
// Images are plain string paths under /images/ (files live in public/images/).

import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// ── Shared pieces ──────────────────────────────────────────────────────────

/** Background treatment of a section. */
const tone = z.enum(["default", "muted", "inverse", "accent"]);

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

// ── Section types ──────────────────────────────────────────────────────────
// Every section accepts `id` (an anchor for links like /about/#team) and
// `tone`. Prop names are shared: eyebrow, heading, text, items, image,
// imageAlt, cta, secondaryCta, align, columns.

const heroSection = z.object({
  type: z.literal("hero"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  cta: link.optional(),
  secondaryCta: link.optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  align: z.enum(["left", "center"]).default("left"),
});

const logosSection = z.object({
  type: z.literal("logos"),
  id: z.string().optional(),
  tone: tone.default("default"),
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
  id: z.string().optional(),
  tone: tone.default("default"),
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
  id: z.string().optional(),
  tone: tone.default("default"),
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
  id: z.string().optional(),
  tone: tone.default("default"),
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
  id: z.string().optional(),
  tone: tone.default("default"),
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
  id: z.string().optional(),
  tone: tone.default("default"),
  quote: z.string(),
  name: z.string(),
  role: z.string().optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
});

const testimonialsSection = z.object({
  type: z.literal("testimonials"),
  id: z.string().optional(),
  tone: tone.default("default"),
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
  id: z.string().optional(),
  tone: tone.default("default"),
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
  id: z.string().optional(),
  tone: tone.default("default"),
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
  id: z.string().optional(),
  tone: tone.default("default"),
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
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Team members to show, by file name. Leave out to show everyone, in `order`. */
  members: z.array(reference("team")).optional(),
  columns: z.number().int().min(2).max(4).default(4),
});

const postsSection = z.object({
  type: z.literal("posts"),
  id: z.string().optional(),
  tone: tone.default("default"),
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
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  /** Markdown. */
  text: z.string(),
  align: z.enum(["left", "center"]).default("left"),
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
  align: z.enum(["left", "center"]).default("left"),
});

const contactSection = z.object({
  type: z.literal("contact"),
  id: z.string().optional(),
  tone: tone.default("default"),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string().optional(),
  /** Where the form posts. Leave out to open the visitor's email app instead. */
  action: z.string().optional(),
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
]);

/**
 * A section whose `type` is not one of the above. Accepted so a typo or a
 * half-finished section never breaks the build; it renders as a notice in
 * development and as nothing in production. Known types never fall through to
 * here, so their validation errors still fail the build.
 */
const knownSectionTypes = new Set(section.options.map((option) => option.shape.type.value));
const unknownSection = z.looseObject({ type: z.string() }).superRefine((value, ctx) => {
  if (!knownSectionTypes.has(value.type)) return;
  // A known type that failed its own schema: report that schema's errors.
  const result = section.safeParse(value);
  for (const issue of result.error?.issues ?? []) {
    ctx.addIssue({ code: "custom", path: issue.path, message: `${value.type}: ${issue.message}` });
  }
});

// ── Collections ────────────────────────────────────────────────────────────

const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** Social share image. Falls back to `shareImage` in site.json. */
    image: z.string().optional(),
    noindex: z.boolean().default(false),
    sections: z.array(z.union([section, unknownSection])).default([]),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    /** A team member's file name (e.g. "nell-okafor"), or a guest author's name. */
    author: z.string(),
    image: z.string(),
    imageAlt: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
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

export const collections = { pages, blog, team };
