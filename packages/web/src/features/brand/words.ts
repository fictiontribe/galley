/** Plain words for the Brand screen (brand/voice.md): roles, contrast, evidence, confidence. */
import type { BrandSource, ColorRole, Confidence, ContrastResult, Evidence, SourceType } from "@galley/core/sitebrand/types";

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
