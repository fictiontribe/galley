/** Plain words for the Brand screen (brand/voice.md): roles, contrast, evidence, confidence. */
import type { BrandSource, ColorRole, Confidence, ContrastResult, Evidence, SourceType } from "@galley/core/sitebrand/types";
import { entryName } from "@/lib/format";

export const ROLE_LABEL: Record<ColorRole, string> = {
  background: "Background",
  surface: "Surface",
  "surface-muted": "Muted surface",
  text: "Text",
  "text-muted": "Muted text",
  accent: "Accent",
  "accent-text": "Text on accent",
  "accent-strong": "Accent, pressed",
  border: "Lines",
  "inverse-background": "Dark ground",
  "inverse-text": "Text on dark",
  positive: "Positive",
  negative: "Negative",
  notice: "Notice",
  other: "Other",
};

/** A text colour's partner ground: the role its own name already says it sits on. */
const PARTNER: Partial<Record<ColorRole, ColorRole>> = { "accent-text": "accent", "inverse-text": "inverse-background" };
/** Those text colours as a noun when they sit on some other ground. */
const TEXT_NOUN: Partial<Record<ColorRole, string>> = { "accent-text": "The accent’s text colour", "inverse-text": "The dark ground’s text colour" };

/** A contrast pair in words: "Text on background", "Text on accent" — never "Text on accent on accent". */
export function pairWords(text: ColorRole, ground: ColorRole): string {
  if (PARTNER[text] === ground) return ROLE_LABEL[text];
  return `${TEXT_NOUN[text] ?? ROLE_LABEL[text]} on ${ROLE_LABEL[ground].toLowerCase()}`;
}

export const COLOR_ROLE_ORDER: ColorRole[] = ["background", "surface", "surface-muted", "text", "text-muted", "accent", "accent-text", "accent-strong", "border", "inverse-background", "inverse-text", "positive", "negative", "notice", "other"];

/** "Easy to read" / "Only for large text" / "Hard to read". */
export function contrastWords(result: ContrastResult): string {
  return result === "aaa" || result === "aa" ? "Easy to read" : result === "large" ? "Large text only" : "Hard to read";
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { measured: "Measured", declared: "Declared", inferred: "Inferred" };
export const CONFIDENCE_HINT: Record<Confidence, string> = {
  measured: "Seen in use: on the site's pages, or in the pixels of a file you added.",
  declared: "Written down: in the site's styles, or stated in material you added.",
  inferred: "Worked out — check it.",
};

/** "page 14 of Guidelines.pdf", "measured on /pricing/", "tokens.css:12". */
export function evidenceWords(evidence: Evidence): string {
  switch (evidence.kind) {
    case "file":
      return `${evidence.file?.split("/").pop() ?? "a file"}${evidence.line ? `:${evidence.line}` : ""}`;
    case "page":
      return `measured on ${evidence.page === "/" ? "the home page" : (evidence.page ?? "a page")}`;
    case "website":
      return `on ${evidence.url ? new URL(evidence.url).hostname : "the website"}`;
    case "source":
      return evidence.sourcePage ? `page ${evidence.sourcePage} of ${evidence.sourceName}` : (evidence.sourceName ?? "your material");
  }
}

/** The first two places, joined: "measured on the home page and tokens.css:12". */
export function whereFrom(evidence: Evidence[]): string {
  const words = [...new Set(evidence.map(evidenceWords))];

  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!;
  return `${words[0]} and ${words.length === 2 ? words[1] : `${words.length - 1} more`}`;
}

export const TYPE_WORDS: Record<SourceType, string> = { pdf: "PDF", image: "Picture", svg: "Drawing (SVG)", text: "Note", website: "Website" };

/** What will be done with a file, before it is read. */
export function plan(source: Pick<BrandSource, "type" | "pages" | "limited">): string {
  if (source.limited) return source.limited;
  switch (source.type) {
    case "pdf":
      return `Read page by page${source.pages ? ` (${source.pages === 1 ? "1 page" : `${source.pages} pages`})` : ""}: colours, fonts and the rules it gives.`;
    case "image":
      return "Colours measured from its pixels; the picture read for logo, type and mood.";
    case "svg":
      return "Read as a drawing: its colours and shape. Never run.";
    case "text":
      return "Read as notes about the brand.";
    case "website":
      return "Its styles and words read as material.";
  }
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Text colour (ink or paper) that reads on a swatch. */
export function inkFor(hex: string): string {
  // Whichever of the two inks reads better on the colour, by WCAG contrast — not a fixed lightness cut-off,
  // which left mid-dark colours (a brand's text colour) with dark ink on them.
  const luminance = (value: string) => {
    const clean = value.replace("#", "");
    const channel = (i: number) => {
      const c = parseInt(clean.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  };
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const ground = luminance(hex);
  const dark = "#141210";
  const light = "#FAF7F0";

  if (!Number.isFinite(ground)) return dark;
  return ratio(ground, luminance(dark)) >= ratio(ground, luminance(light)) ? dark : light;
}

/**
 * Where a piece of material is, true at each moment. A file small enough is
 * copied into the site's brand folder when the brand is saved; until then
 * it waits in this app's own folder. Large files and web pages read for
 * their styles always stay outside the site.
 */
export function whereKept(source: Pick<BrandSource, "type" | "bytes" | "stored" | "file">, staged: boolean, settings: { dir: string; largeFileBytes: number }): string {
  if (source.stored === "site" && source.file) return `in the site, ${source.file}`;
  if (staged && source.type !== "website" && source.bytes <= settings.largeFileBytes) return `goes into the site (${settings.dir}/sources/) when you save`;
  return "kept outside the site";
}

/**
 * Where a quoted line of the site's copy is, named the way the rest of the
 * app names pages: the analysis records the page's address ("/",
 * "/atelier/"), which says little on its own. With the entry at that address
 * it is the page's name ("Home page", "Atelier"); without one the home page
 * is still the home page, and anything else (a source's name, another
 * site's address) reads as it was written.
 */
export function quotePlace(where: string, entry?: { path: string; title?: string } | null): string {
  if (entry) return entryName(entry.path, entry.title);
  if (where.trim() === "/") return "Home page";
  return where;
}
