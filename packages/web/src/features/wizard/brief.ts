/**
 * The new-site brief as the wizard collects it: sensible defaults, the
 * checks each step makes before moving on, and what the chat shows when the
 * assistant starts building from it.
 */
import type { SiteBrief } from "@galley/core/types";
import { joinWords } from "@/lib/format";

export interface BriefDraft {
  name: string;
  starter: string;
  description: string;
  audience: string;
  tone: string;
  pages: string[];
  brandColor: string;
  notes: string;
  /** "Start from my WordPress site": the starter is copied, then the import screen brings the old site's content into it (no brief needed). */
  fromWordPress?: boolean;
}

export type WizardStep = "name" | "starter" | "about" | "style" | "create";
export const STEPS: WizardStep[] = ["name", "starter", "about", "style", "create"];

export const DEFAULT_PAGES = ["Home", "About", "Services", "Contact"];
export const TONES = ["Warm and plain", "Confident and direct", "Calm and expert", "Friendly and playful"];
export const DEFAULT_COLOR = "#2F5D50";
export const MAX_PAGES = 12;

export function emptyDraft(starter = ""): BriefDraft {
  return { name: "", starter, description: "", audience: "", tone: "", pages: [...DEFAULT_PAGES], brandColor: DEFAULT_COLOR, notes: "" };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const isHexColor = (value: string): boolean => HEX.test(value.trim());

/** Pages with one more, unless it's empty, already there (in any case) or there are enough. */
export function addPage(pages: string[], name: string): string[] {
  const page = name.trim().replace(/\s+/g, " ");
  if (!page || pages.length >= MAX_PAGES || pages.some((existing) => existing.toLowerCase() === page.toLowerCase())) return pages;
  return [...pages, page.charAt(0).toUpperCase() + page.slice(1)];
}

/** What stops a step, in one sentence, or null when it can move on. */
export function stepProblem(step: WizardStep, draft: BriefDraft): string | null {
  switch (step) {
    case "name":
      if (!/[\p{L}\p{N}]/u.test(draft.name)) return "Give the site a name with at least one letter or number.";
      if (draft.name.trim().length > 100) return "That name is too long. Keep it under 100 characters.";
      return null;
    case "starter":
      return draft.starter ? null : "Choose a starter to begin from.";
    case "about":
      return draft.description.trim().length < 12 ? "Say what the organisation is and does in a sentence or two." : null;
    case "style":
      if (draft.pages.length === 0) return "Add at least one page.";
      if (draft.brandColor.trim() && !isHexColor(draft.brandColor)) return "The brand colour should be a hex value like #2F5D50.";
      return null;
    case "create":
      return STEPS.slice(0, -1)
        .map((earlier) => stepProblem(earlier, draft))
        .find((problem) => problem !== null) ?? null;
  }
}

/** The brief the assistant receives: trimmed, with empty answers left out. */
export function toBrief(draft: BriefDraft): SiteBrief {
  const brief: SiteBrief = { description: draft.description.trim() };
  if (draft.audience.trim()) brief.audience = draft.audience.trim();
  if (draft.tone.trim()) brief.tone = draft.tone.trim();
  if (draft.pages.length) brief.pages = draft.pages;
  if (isHexColor(draft.brandColor)) brief.brandColor = draft.brandColor.trim();
  if (draft.notes.trim()) brief.notes = draft.notes.trim();
  return brief;
}

/** The short line the chat shows as the person's first message. */
export function briefMessage(brief: SiteBrief): string {
  return brief.pages?.length ? `Build the site from my brief: ${joinWords(brief.pages)}.` : "Build the site from my brief.";
}
