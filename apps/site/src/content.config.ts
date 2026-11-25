// Content model for galley.fictiontribe.com.
//
// Every word on the site lives in these collections or in src/data/*.json, so
// the site is itself a Galley site. Marketing pages are lists of sections
// (`sections`, one entry per section, discriminated by `type`); prose pages
// (privacy, changelog, agent.md, 404) keep their words in the markdown body
// and a few front-matter fields.
//
// Kept plain and statically readable: Galley's Astro adapter parses this file
// without running it (starters/README.md §3).

import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const link = z.object({ label: z.string(), href: z.string() });

/** One picture, always real: a capture of the app, a capture of an example site, a recording, or a file this site serves. */
const visual = z.object({
  /** screen: public/screens/<src>.webp (+ @1x) · site: public/sites/<src>.webp (+ @1x) · recording: public/screens/<src>.webm + <src>-poster.webp · file: a path this site serves, shown as text */
  kind: z.enum(["screen", "site", "recording", "file"]).default("screen"),
  src: z.string(),
  alt: z.string(),
  /** screen only: the capture to show until `src` has been captured (a named slot waiting for its picture): a screen's name, or a picture in another folder ("docs/brand"). */
  fallback: z.string().optional(),
  /** What the stand-in shows, while it is the one shown. */
  fallbackAlt: z.string().optional(),
  /** Move the capture inside its panel, in CSS pixels (negative pulls it up or left). On the tour, only the capture itself moves, never its stand-in. */
  x: z.number().optional(),
  y: z.number().optional(),
  /** The capture to show instead in dark mode (same folder; about the same shape, so nothing moves when it swaps), and what it shows. Only the one in use is downloaded. Used by the home hero (layout canvas). */
  dark: z.string().optional(),
  darkAlt: z.string().optional(),
  /** Tour insets only: show just this much of the capture (CSS pixels from where x and y put it), as a detail. */
  w: z.number().optional(),
  h: z.number().optional(),
});

const common = {
  /** Anchor for links to this section. */
  id: z.string().optional(),
  /** Leave the section out of the page (kept in the file, ready to switch back on). */
  hidden: z.boolean().optional(),
};

/** A page's first screen. showcase: the live site with Galley's proof laid over it · canvas: the words in a compact block, then one app window as wide as the page · split: text beside one picture · text: words only. */
const heroSection = z.object({
  type: z.literal("hero"),
  ...common,
  layout: z.enum(["showcase", "canvas", "split", "text"]).default("split"),
  /** showcase: centre the words over the picture. */
  align: z.enum(["start", "center"]).optional(),
  notice: link.optional(),
  eyebrow: z.string().optional(),
  heading: z.string(),
  text: z.string(),
  cta: link.optional(),
  /** A quieter second link beside the action. */
  secondary: link.optional(),
  /** The label of a second action to the in-browser demo; shown only while src/data/site.json → demo.available is true. */
  demo: z.string().optional(),
  /** A short line under the action (while Galley isn't published). */
  note: z.string().optional(),
  /** The line under the action once install.published is true in site.json. */
  notePublished: z.string().optional(),
  /** Show the first command to type (src/data/site.json → install) with a Copy button. */
  command: z.boolean().optional(),
  /** A link that copies a file this site serves (e.g. /agent.md) instead of opening it. */
  copyFile: link.optional(),
  visual: visual.optional(),
  /** showcase only: the window laid over the live site, and the two windows' labels. */
  overlay: visual.optional(),
  labels: z.object({ site: z.string(), overlay: z.string() }).optional(),
  caption: z.string().optional(),
});

const filmSection = z.object({
  type: z.literal("film"),
  ...common,
  heading: z.string(),
  text: z.string(),
  /** Files in public/video without extension: <src>.webm, <src>.mp4, <src>-poster.webp, <src>.en.vtt */
  video: z.string(),
  title: z.string(),
  captions: z.string(),
  transcript: link.optional(),
  /** wide: the film across the page, its chapters as numbered steps under it · side: the words beside it · story: the chapters first, as steps scrolling past one picture that stays in view (`pinned`), each with its own picture, then the film. */
  layout: z.enum(["side", "wide", "story"]).default("side"),
  /** story only: the picture that stays in view beside the steps. */
  pinned: visual.optional(),
  /** Points in the film to jump to, in seconds; `text` is one line under the chapter (wide). */
  /** `icon`: a glyph name from brand/icons.ts, drawn beside the step's name. */
  /** `visual` (story): the step's own picture. */
  chapters: z.array(z.object({ label: z.string(), icon: z.string().optional(), time: z.number(), text: z.string().optional(), visual: visual.optional() })).default([]),
  link: link.optional(),
  chaptersLabel: z.string().optional(),
});

const tabsSection = z.object({
  type: z.literal("tabs"),
  ...common,
  heading: z.string(),
  text: z.string(),
  tabsLabel: z.string(),
  tabs: z.array(z.object({ label: z.string(), text: z.string().optional(), visual })),
  link: link.optional(),
});

/** An example proof, set in text: each change struck out and written in, with Put back. */
const proofSection = z.object({
  type: z.literal("proof"),
  ...common,
  heading: z.string(),
  text: z.string(),
  link: link.optional(),
  sheet: z.object({
    label: z.string(),
    title: z.string(),
    badge: z.string(),
    changes: z.array(
      z.object({
        path: z.string(),
        /** A whole value replaced. */
        before: z.string().optional(),
        after: z.string().optional(),
        /** Or words swapped inside a value: the text with [old|new] where they change. */
        inline: z.string().optional(),
      }),
    ),
  }),
  notesLabel: z.string(),
  notes: z.array(z.object({ mark: z.enum(["insert", "delete", "change", "stet"]), title: z.string(), text: z.string() })),
});

/** The dark band: one idea beside what a terminal shows. */
const bandSection = z.object({
  type: z.literal("band"),
  ...common,
  heading: z.string(),
  text: z.string(),
  link: link.optional(),
  terminal: z.object({ title: z.string(), note: z.string().optional(), label: z.string(), lines: z.array(z.string()) }),
});

const startersSection = z.object({
  type: z.literal("starters"),
  ...common,
  /** feature: the first tall beside the others · gallery: two columns · row: three across · stage: the first tall, its page scrolling inside it with the visitor's scroll, the other two stacked beside it (no commands). */
  layout: z.enum(["feature", "gallery", "row", "stage"]).default("feature"),
  heading: z.string(),
  text: z.string(),
  link: link.optional(),
  items: z.array(
    z.object({
      /** A folder in starters/ whose starter.json and galley/previews/ give the pictures and looks. */
      starter: z.string().optional(),
      /** Tall captures of the starter's home page per look: public/sites/<tall>-<look>.webp */
      tall: z.string().optional(),
      name: z.string(),
      kind: z.string(),
      text: z.string(),
      /** An id in src/data/status.json, shown as its badge. */
      status: z.string().optional(),
      link: link.optional(),
    }),
  ),
  /** feature only: a short line about building pages from the starters' sections, with its recording. */
  builder: z
    .object({
      status: z.string(),
      text: z.string(),
      visual,
      /** A few of one starter's section pictures (starters/<starter>/galley/sections/<type>.webp), with their labels. */
      starter: z.string().optional(),
      sections: z.array(z.string()).default([]),
      sectionsLabel: z.string().optional(),
    })
    .optional(),
  note: z.string().optional(),
});

const splitSection = z.object({
  type: z.literal("split"),
  ...common,
  eyebrow: z.string().optional(),
  /** An id in src/data/status.json, shown as its badge. */
  status: z.string().optional(),
  heading: z.string(),
  text: z.string(),
  points: z.array(z.string()).default([]),
  link: link.optional(),
  /** Picture on the left. */
  flip: z.boolean().optional(),
  visual,
});

/** What's in the release, rendered from src/data/status.json. */
const statusSection = z.object({
  type: z.literal("status"),
  ...common,
  heading: z.string(),
  text: z.string().optional(),
  /** Status ids to show; all of them (except those marked home: false) when absent. */
  only: z.array(z.string()).optional(),
  /** Status groups to show, in order. */
  groups: z.array(z.string()).optional(),
  /** Show each item's one line (on), or its label only (off). */
  lines: z.boolean().default(true),
  /** With lines off: the items whose line is shown anyway. */
  linesFor: z.array(z.string()).default([]),
  /** One row per status: its badge, then its items' labels in a line (the home page). */
  compact: z.boolean().optional(),
  link: link.optional(),
});

const cardsSection = z.object({
  type: z.literal("cards"),
  ...common,
  heading: z.string(),
  /** Hide the heading visually (it stays for screen readers). */
  quiet: z.boolean().optional(),
  items: z.array(z.object({ eyebrow: z.string().optional(), title: z.string(), text: z.string(), href: z.string() })),
});

const closeSection = z.object({
  type: z.literal("close"),
  ...common,
  heading: z.string(),
  text: z.string(),
  actions: z.array(link).default([]),
  /** Show the commands that start Galley (src/data/site.json → install) and what they print. */
  commands: z.boolean().optional(),
  points: z.array(z.string()).default([]),
});

const listsSection = z.object({
  type: z.literal("lists"),
  ...common,
  heading: z.string(),
  text: z.string().optional(),
  columns: z.array(z.object({ title: z.string(), mark: z.enum(["insert", "delete", "change", "stet"]), points: z.array(z.string()), note: z.string().optional() })),
});

const comparisonSection = z.object({
  type: z.literal("comparison"),
  ...common,
  heading: z.string(),
  text: z.string(),
  caption: z.string(),
  columns: z.array(z.string()),
  /** better: which side is stronger on the row (ours = the second column, theirs = the third), or even. */
  rows: z.array(z.object({ label: z.string(), ours: z.string(), theirs: z.string(), better: z.enum(["ours", "theirs", "even"]).optional(), more: z.string().optional() })),
  note: z.string().optional(),
});

const stepsSection = z.object({
  type: z.literal("steps"),
  ...common,
  heading: z.string(),
  text: z.string(),
  items: z.array(z.object({ title: z.string(), text: z.string(), status: z.string().optional(), visual })),
});

/** People: one featured first, the rest as equals. Photographs in public/team/<photo>.webp (+ @1x). */
const teamSection = z.object({
  type: z.literal("team"),
  ...common,
  heading: z.string(),
  /** Hide the heading visually (it stays for screen readers). */
  quiet: z.boolean().optional(),
  people: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      line: z.string(),
      photo: z.string(),
      /** Alt text for the photograph: the person's name, never their appearance. */
      alt: z.string(),
      featured: z.boolean().optional(),
    }),
  ),
});

const faqSection = z.object({
  type: z.literal("faq"),
  ...common,
  heading: z.string(),
  items: z.array(z.object({ q: z.string(), a: z.string() })),
});

/**
 * One part of the product tour (/tour/): a heading, one line, and the screens
 * that belong to it. Each item is one thing the app does, captioned in a
 * sentence, with its status badge and a link to its how-to.
 *   full — the words in a row above a wide capture
 *   wide — the words beside a large capture (flip: the capture on the left)
 *   half — two half items side by side, each capture above its words
 * An `inset` is a second, smaller capture laid over the first one's corner.
 */
const tourSection = z.object({
  type: z.literal("tour"),
  ...common,
  /** The part's name in the tour's index. */
  label: z.string(),
  heading: z.string(),
  text: z.string().optional(),
  items: z.array(
    z.object({
      id: z.string().optional(),
      heading: z.string(),
      text: z.string(),
      /** An id in src/data/status.json, shown as its badge. */
      status: z.string().optional(),
      /** A guide's slug in src/data/howto.json: "How to do it" links to it. */
      howto: z.string().optional(),
      /** Where "How to do it" goes while there is no such how-to (a docs page). */
      guide: z.string().optional(),
      layout: z.enum(["full", "wide", "flip", "half"]).default("wide"),
      /** The panel's shape on wide screens when its picture needs more height (e.g. "5/4"). */
      ratio: z.string().optional(),
      /** One quiet line under the link: how the pictures were made, when a reader would wonder. */
      note: z.string().optional(),
      /** A link of its own instead of "How to do it" (e.g. to /apps/). */
      link: link.optional(),
      /** Leave the whole item out until its main capture exists (no words-only item for a screen still to come). */
      whenPictured: z.boolean().optional(),
      visual,
      inset: visual.optional(),
    }),
  ),
});

/** A row of small captures, each a link into the tour, with one action. */
const filmstripSection = z.object({
  type: z.literal("filmstrip"),
  ...common,
  heading: z.string(),
  text: z.string(),
  link: link,
  /** `icon`: the glyph the app gives that screen (a name from brand/icons.ts). */
  items: z.array(z.object({ label: z.string(), icon: z.string().optional(), href: z.string(), visual })),
});

/** The desktop app: icon, one sentence, a capture of the app, and the download once src/data/downloads.json offers one (until then, a way to /apps/). */
const desktopSection = z.object({
  type: z.literal("desktop"),
  ...common,
  heading: z.string(),
  text: z.string(),
  /** The button without JavaScript (it goes to /apps/), and the link to the other systems. */
  fallback: z.string(),
  other: z.string(),
  /** The button while downloads are off: to /apps/. */
  apps: z.string(),
  /** Said beside a system that isn't signed yet. */
  unsigned: z.string().optional(),
});

const section = z.discriminatedUnion("type", [
  heroSection,
  filmSection,
  tabsSection,
  proofSection,
  bandSection,
  startersSection,
  splitSection,
  statusSection,
  cardsSection,
  closeSection,
  listsSection,
  comparisonSection,
  stepsSection,
  faqSection,
  teamSection,
  tourSection,
  filmstripSection,
  desktopSection,
]);

/** Anything else is kept and skipped, so a half-written section never breaks the build. */
const unknownSection = z.object({ type: z.string() }).passthrough();

export const pageSchema = z.object({
  title: z.string(),
  description: z.string(),
  /** Prose pages: a small head over the markdown body. */
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  lead: z.string().optional(),
  noindex: z.boolean().default(false),
  sections: z.array(z.union([section, unknownSection])).default([]),
});

const pages = defineCollection({
  loader: glob({ base: "./src/content/pages", pattern: "**/*.md" }),
  schema: pageSchema.passthrough(),
});

const docs = defineCollection({
  loader: glob({ base: "./src/content/docs", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** One of the group ids in src/data/docs.json. */
    group: z.string(),
    /** Position inside the group, lowest first. */
    order: z.number().default(100),
    /** Shorter title for the navigation, when the page title is long. */
    navTitle: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { pages, docs };
