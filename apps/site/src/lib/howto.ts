/**
 * How-to guides: src/data/howto.json, one task per guide, a picture per step
 * (public/howto/<slug>-<n>.webp + @1x). The /how-to/ pages, the tour's "How to
 * do it" links and the docs' "Step by step" lines all read this file, so a
 * guide that isn't in it is never linked.
 */
import data from "../data/howto.json";
import { capture, noteMissing, pictureExists, type Picture } from "./media";

export interface HowtoStep {
  image?: string;
  alt?: string;
  /** The instruction, in markdown (bold for button names). */
  do: string;
  /** What you'll see once it's done, in markdown. */
  see?: string;
}

export interface Howto {
  slug: string;
  title: string;
  summary: string;
  /** The full guide in the docs, e.g. /docs/editing/redirects/ */
  guide: string;
  /** What's needed before starting, in markdown. */
  needs?: string;
  steps: HowtoStep[];
}

const asText = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/**
 * Only what can be shown: a step needs its instruction and a picture that is
 * on disk; a guide needs a slug, a title and at least one such step. Anything
 * else in the file (a null entry, a step still to be captured) is left out and
 * listed in the build log — never an error.
 */
function usable(raw: unknown): Howto | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const slug = asText(g.slug);
  const title = asText(g.title);
  if (!slug || !title || !/^[a-z0-9-]+$/.test(slug)) return null;
  const steps: HowtoStep[] = [];
  for (const rawStep of Array.isArray(g.steps) ? g.steps : []) {
    if (!rawStep || typeof rawStep !== "object") continue;
    const st = rawStep as Record<string, unknown>;
    const image = asText(st.image);
    const todo = asText(st.do);
    if (!todo || !image) continue;
    if (!pictureExists(image)) {
      noteMissing(image, `step of the how-to "${slug}" left out`);
      continue;
    }
    steps.push({ image, alt: asText(st.alt), do: todo, see: asText(st.see) });
  }
  if (steps.length === 0) {
    console.warn(`[site] howto.json: "${slug}" has no step with its picture yet; left out.`);
    return null;
  }
  return { slug, title, summary: asText(g.summary) ?? "", guide: asText(g.guide) ?? "/docs/", needs: asText(g.needs), steps };
}

export const howtos: Howto[] = (Array.isArray((data as { guides?: unknown }).guides) ? ((data as { guides: unknown[] }).guides) : []).map(usable)
  // One page per slug: a repeated slug keeps its first guide.
  .filter((g, i, all): g is Howto => g !== null && all.findIndex((o) => o?.slug === g.slug) === i);

export const howtoHref = (slug: string) => `/how-to/${slug}/`;

export const howtoOf = (slug: string | undefined) => (slug ? howtos.find((g) => g.slug === slug) : undefined);

/** The how-tos whose full guide is this docs page (its address, without #anchor). */
export function howtosForDoc(href: string): Howto[] {
  return howtos.filter((g) => g.guide.split("#")[0] === href);
}

/** One group of guides in the /how-to/ filter, and how many guides it holds. */
export interface HowtoGroup {
  id: string;
  label: string;
  count: number;
}

/**
 * The how-to index's filter, from the `filter` list in
 * src/content/pages/how-to.md: each entry is a group with an id (its address,
 * /how-to/?show=<id>), a label and the slugs of its guides. The groups live
 * there, not in howto.json, because the capture script rewrites that file. A
 * guide belongs to the first group that names it; one that no group names
 * shows under "All" only, and a group with no guide isn't offered.
 */
export function howtoGroups(filter: unknown, guides: Howto[] = howtos): { groups: HowtoGroup[]; groupOf: Map<string, string> } {
  const groupOf = new Map<string, string>();
  const groups: HowtoGroup[] = [];
  for (const raw of Array.isArray(filter) ? filter : []) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Record<string, unknown>;
    const id = asText(f.id);
    const label = asText(f.label);
    if (!id || !label || !/^[a-z0-9-]+$/.test(id) || groups.some((g) => g.id === id)) continue;
    let count = 0;
    for (const slug of Array.isArray(f.guides) ? f.guides : []) {
      if (typeof slug !== "string" || groupOf.has(slug) || !guides.some((g) => g.slug === slug)) continue;
      groupOf.set(slug, id);
      count++;
    }
    if (count > 0) groups.push({ id, label, count });
  }
  return { groups, groupOf };
}

/** A step's picture, or null (missing files are listed in the build log). */
export function stepPicture(step: HowtoStep): Picture | null {
  return step.image ? capture(step.image)?.pic ?? null : null;
}

/** The first step that has a picture, for the index. */
export function firstPicture(g: Howto): { pic: Picture; alt: string } | null {
  for (const step of g.steps) {
    const pic = stepPicture(step);
    if (pic) return { pic, alt: step.alt ?? "" };
  }
  return null;
}
