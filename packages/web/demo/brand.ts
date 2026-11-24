/**
 * The sample site's saved brand, for the Brand screen: what reading Caddow
 * finds — its colours and fonts from src/styles/tokens.css (the "Chalk"
 * look), its sections from galley.config.json, its voice from its own
 * pages. The mock's own brand is another, invented studio's, so the demo
 * answers with this one, saved as it would be after a first reading.
 */
import type { SiteBrandFile } from "@galley/core/sitebrand/types";

const TOKENS = "src/styles/tokens.css";
const ev = (line: number, note: string) => ({ kind: "file" as const, file: TOKENS, line, note });
const page = (path: string, note: string) => ({ kind: "page" as const, page: path, note });

export const CADDOW_BRAND: SiteBrandFile = {
  version: 1,
  name: "Caddow",
  updatedAt: "2026-11-21T10:12:00.000Z",
  colors: [
    { id: "background", role: "background", name: "Chalk", value: "#F7F6F3", token: "--color-background", usage: "The page ground", confidence: "measured", evidence: [page("/", "68% of the grounds on 6 pages"), ev(48, "--color-background: oklch(97.3% 0.004 95)")] },
    { id: "surface", role: "surface", name: "Paper", value: "#FDFDFC", token: "--color-surface", usage: "Inputs and the menu", confidence: "declared", evidence: [ev(49, "--color-surface")] },
    { id: "surface-muted", role: "surface-muted", name: "Lime wash", value: "#E9E6E1", token: "--color-surface-muted", usage: "Muted sections", confidence: "measured", evidence: [page("/", "the workroom section")] },
    { id: "text", role: "text", name: "Ink", value: "#110F0D", token: "--color-text", usage: "Headings and body text", confidence: "measured", evidence: [page("/", "84% of the text")] },
    { id: "text-muted", role: "text-muted", name: "Slate", value: "#5A5753", token: "--color-text-muted", usage: "Secondary copy and captions", confidence: "measured", evidence: [page("/journal/", "dates and reading times")] },
    { id: "accent", role: "accent", name: "Ultramarine", value: "#1C3DBB", token: "--color-accent", usage: "Links and the primary button", confidence: "measured", evidence: [page("/", "2 buttons, links")] },
    { id: "accent-text", role: "accent-text", name: "On ultramarine", value: "#F8F7F4", token: "--color-accent-contrast", usage: "Text on the accent", confidence: "declared", evidence: [ev(58, "--color-accent-contrast")] },
    { id: "inverse-background", role: "inverse-background", name: "Night ink", value: "#110F0D", token: "--color-inverse-background", usage: "The footer and inverse sections", confidence: "measured", evidence: [page("/", "the footer")] },
  ],
  contrast: [
    { text: "text", background: "background", ratio: 18.2, result: "aaa", measuredOn: ["/", "/atelier/"] },
    { text: "text-muted", background: "background", ratio: 6.9, result: "aa", measuredOn: ["/journal/"] },
    { text: "accent", background: "background", ratio: 8.1, result: "aaa", measuredOn: ["/"] },
    { text: "accent-text", background: "accent", ratio: 8.4, result: "aaa" },
  ],
  typography: {
    fonts: [
      { id: "display", role: "display", family: "Bodoni Moda Variable", fallbacks: ["Bodoni 72", "Didot", "Times New Roman", "serif"], source: { kind: "package", ref: "@fontsource-variable/bodoni-moda" }, weights: [400, 500], token: "--font-display", confidence: "measured", evidence: [page("/", "every heading on 6 pages"), ev(85, "--font-display")] },
      { id: "body", role: "body", family: "Albert Sans Variable", fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"], source: { kind: "package", ref: "@fontsource-variable/albert-sans" }, weights: [400, 500], token: "--font-body", confidence: "measured", evidence: [page("/", "body text on 6 pages"), ev(86, "--font-body")] },
      { id: "mono", role: "mono", family: "Spline Sans Mono Variable", fallbacks: ["ui-monospace", "Menlo", "monospace"], source: { kind: "package", ref: "@fontsource-variable/spline-sans-mono" }, weights: [400, 500], token: "--font-mono", confidence: "measured", evidence: [page("/", "eyebrows and buttons")] },
    ],
    scale: [
      { id: "h1", role: "h1", font: "display", size: "88px", px: 88, weight: 400, lineHeight: "0.95", letterSpacing: "-1.8px", confidence: "measured", evidence: [page("/", "the campaign heading")] },
      { id: "h2", role: "h2", font: "display", size: "48px", px: 48, weight: 400, lineHeight: "1.05", confidence: "measured", evidence: [page("/", "8 on 4 pages")] },
      { id: "body", role: "body", font: "body", size: "18px", px: 18, weight: 400, lineHeight: "1.55", confidence: "measured", evidence: [page("/journal/why-we-make-forty/", "the long reads")] },
      { id: "button", role: "button", font: "mono", size: "13px", px: 13, weight: 500, lineHeight: "1", letterSpacing: "1.3px", confidence: "measured", evidence: [page("/", "2 buttons")] },
    ],
  },
  spacing: [
    { id: "space-s", name: "space-s", value: "1rem", token: "--space-s", uses: 18, confidence: "measured", evidence: [ev(132, "--space-s")] },
    { id: "space-l", name: "space-l", value: "clamp(1.75rem, 1.4rem + 1.4vw, 2.75rem)", token: "--space-l", confidence: "declared", evidence: [ev(134, "--space-l")] },
    { id: "space-section", name: "space-section", value: "clamp(4rem, 2.6rem + 5.6vw, 8rem)", token: "--space-section", uses: 11, confidence: "measured", evidence: [ev(137, "--space-section")] },
  ],
  radius: [{ id: "radius-m", name: "radius-m", value: "0", token: "--radius-m", uses: 0, confidence: "declared", evidence: [ev(148, "--radius-m: 0 — square corners everywhere")] }],
  shadows: [],
  logos: [{ id: "logo-wordmark", file: "inline svg wordmark", format: "svg", variant: "wordmark", background: "light", colors: ["#110F0D"], viewBox: "0 0 160 24", confidence: "measured", evidence: [page("/", "header logo, letter-spaced capitals")] }],
  imagery: {
    direction: "Daylit photographs of the clothes worn outdoors, against lime-washed walls and harbour stone; long shadows, low sun, no studio backdrops.",
    subjects: ["coats and knitwear, worn", "the workroom and hands at work", "cloth up close"],
    light: "low sun from one side, late afternoon",
    palette: ["#F7F6F3", "#110F0D", "#1C3DBB", "#E9E6E1"],
    avoid: ["studio white backgrounds", "heavy filters", "crowds"],
    confidence: "inferred",
    evidence: [page("/", "29 photographs in the site's content")],
  },
  components: [
    { type: "campaign-hero", label: "Campaign hero", whenToUse: "First on a page: one photograph, the headline over it.", usedOn: ["/", "/atelier/"], count: 3, confidence: "declared", evidence: [] },
    { type: "statement", label: "Statement", whenToUse: "One sentence the label believes, set large.", usedOn: ["/"], count: 2, confidence: "declared", evidence: [] },
    { type: "lookbook-grid", label: "Lookbook grid", whenToUse: "Looks from a lookbook, each linking to its place in it.", usedOn: ["/", "/collections/"], count: 2, confidence: "declared", evidence: [] },
    { type: "pieces", label: "Pieces", whenToUse: "Garments as cards, with a price as text.", usedOn: ["/"], count: 1, confidence: "declared", evidence: [] },
    { type: "story", label: "Story", whenToUse: "A passage of writing, optionally with a drop cap.", usedOn: ["/atelier/"], count: 2, confidence: "declared", evidence: [] },
  ],
  voice: {
    summary: "Plain, exact and unhurried: the label talks like the person at the cutting table — about cloth, numbers and time — and never sells.",
    tone: ["plain", "exact", "warm", "unhurried"],
    rules: [
      { rule: "Say what a thing is made of and how many there are.", quote: { text: "Forty of each, cut by hand in Marrowby from cloth we can trace back to the sheep.", where: "/" } },
      { rule: "No sales language: no drops, no limited editions, no urgency.", quote: { text: "No sales, no drops, no seasons off.", where: "/" }, before: "Shop the exclusive drop before it’s gone!", after: "When a coat sells out, we make it again next year." },
      { rule: "No exclamation marks.", before: "Our new collection is here!", after: "Autumn–Winter 2026 is out now." },
    ],
    vocabulary: [
      { say: "coat, knit, piece", insteadOf: ["product", "item"], why: "they are clothes" },
      { say: "the workroom", insteadOf: ["our studio", "HQ"] },
    ],
    formatting: { headlineCase: "sentence", punctuation: "No exclamation marks; curly quotes.", numbers: "Digits for counts and prices: 40 coats, £640.", cta: "A verb and an object: “Find a stockist”." },
    confidence: "inferred",
    evidence: [page("/", "58 pieces of the site's own copy")],
  },
  layout: { do: ["One photograph at a time, large, with room around it.", "Words beside pictures on the page's split line."], dont: ["Don't round corners: the look is square.", "Don't set body text on the ultramarine."] },
  tokensFile: TOKENS,
};

export const CADDOW_GUIDE = `# Caddow — brand guide

## Voice

${CADDOW_BRAND.voice?.summary ?? ""}

## Look

Chalk: lime-washed white, ink and one ultramarine accent. Bodoni Moda for headings, Albert Sans for reading, Spline Sans Mono for small labels and buttons. Square corners.

## Photographs

${CADDOW_BRAND.imagery?.direction ?? ""}
`;
