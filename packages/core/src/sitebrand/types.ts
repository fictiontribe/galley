/**
 * The site's brand — its look and its voice — as data. Types only, no
 * runtime: the web app's fixture backend imports this file directly.
 *
 * Two words are kept apart on purpose. "Brand" in `src/brand.ts` and the
 * white-label `BrandConfig` is the PRODUCT's own name and colour; everything
 * here is the brand of a site the product edits, called `siteBrand` in code.
 *
 * Every value carries where it came from and how sure the engine is:
 *   measured  read from the rendered pages in the person's own preview
 *   declared  written down somewhere: a tokens file, a CSS rule, a guideline PDF that states it
 *   inferred  worked out — by the model from a picture, or by grouping what was seen
 */

export type Confidence = "measured" | "declared" | "inferred";

/** Where one value was found. Plain enough to print as "page 14 of Guidelines.pdf" or "tokens.css:12". */
export interface Evidence {
  kind: "file" | "page" | "source" | "website";
  /** Repo-relative file (kind "file"). */
  file?: string;
  line?: number;
  /** URL path on the site (kind "page"), e.g. "/pricing/". */
  page?: string;
  /** What on the page: "h1", "button", "body text". */
  element?: string;
  /** Uploaded source id (kind "source"). */
  source?: string;
  /** Its file name, kept so the evidence still reads after the source is removed. */
  sourceName?: string;
  /** 1-based PDF page. */
  sourcePage?: number;
  /** A fetched website's address (kind "website"). */
  url?: string;
  /** A short quote or detail ("“#1A1A1A — body text”"). */
  note?: string;
}

export type ColorRole =
  | "background"
  | "surface"
  | "surface-muted"
  | "text"
  | "text-muted"
  | "accent"
  | "accent-text"
  | "accent-strong"
  | "border"
  | "inverse-background"
  | "inverse-text"
  | "positive"
  | "negative"
  | "notice"
  | "other";

export const COLOR_ROLES: readonly ColorRole[] = [
  "background",
  "surface",
  "surface-muted",
  "text",
  "text-muted",
  "accent",
  "accent-text",
  "accent-strong",
  "border",
  "inverse-background",
  "inverse-text",
  "positive",
  "negative",
  "notice",
  "other",
];

export interface BrandColor {
  id: string;
  role: ColorRole;
  /** What people call it: "Paper", "Signal orange". */
  name: string;
  /** "#RRGGBB" (or "#RRGGBBAA" when translucent), upper case. */
  value: string;
  /** The site's own name for it, when it has one: "--color-accent". */
  token?: string;
  /** One line on where it is used. */
  usage?: string;
  confidence: Confidence;
  evidence: Evidence[];
}

export type ContrastResult = "aaa" | "aa" | "large" | "fail";

export interface ContrastPair {
  /** BrandColor ids. */
  text: string;
  background: string;
  ratio: number;
  result: ContrastResult;
  /** Pages where this pairing was measured, when it was. */
  measuredOn?: string[];
}

export type FontRole = "display" | "body" | "mono" | "other";

export interface FontSource {
  /** package: an npm font package; file: a font file in the site; embedded: inside an uploaded PDF; system: an installed font. */
  kind: "package" | "file" | "embedded" | "system" | "unknown";
  /** Package name, file path or source name. */
  ref?: string;
}

export interface BrandFont {
  id: string;
  role: FontRole;
  /** The family name as CSS uses it: "Geist Variable". */
  family: string;
  fallbacks: string[];
  source: FontSource;
  weights: number[];
  token?: string;
  confidence: Confidence;
  evidence: Evidence[];
}

export type TypeRole = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "lead" | "body" | "small" | "button" | "label" | "link";

export interface TypeStyle {
  id: string;
  role: TypeRole;
  /** BrandFont id. */
  font: string;
  /** As measured ("48px") or declared ("clamp(2rem, 1.55rem + 2.25vw, 3.6rem)"). */
  size: string;
  /** The size in px at the measured width, for drawing the specimen. */
  px?: number;
  weight: number;
  lineHeight: string;
  letterSpacing?: string;
  token?: string;
  confidence: Confidence;
  evidence: Evidence[];
}

/** One step of a spacing, radius or shadow scale. */
export interface ScaleStep {
  id: string;
  name: string;
  value: string;
  token?: string;
  /** How often it was seen on the measured pages. */
  uses?: number;
  confidence: Confidence;
  evidence: Evidence[];
}

export interface BrandLogo {
  id: string;
  /** Repo-relative path, a source id ("source:<id>"), or a page image address. */
  file: string;
  format: "svg" | "png" | "jpg" | "webp" | "gif" | "other";
  variant: "primary" | "reverse" | "mono" | "mark" | "wordmark" | "other";
  /** Which grounds it is made for. */
  background: "light" | "dark" | "any";
  colors: string[];
  viewBox?: string;
  clearSpace?: string;
  minSize?: string;
  notes?: string;
  /** A source the person marked "do not use" (an old logo). */
  doNotUse?: boolean;
  confidence: Confidence;
  evidence: Evidence[];
}

export interface Imagery {
  /** One or two sentences: what pictures on this site look like. */
  direction: string;
  subjects: string[];
  light: string;
  /** Hex colours pictures lean towards. */
  palette: string[];
  avoid: string[];
  confidence: Confidence;
  evidence: Evidence[];
}

export interface BrandComponent {
  /** The section type ("hero") or component name. */
  type: string;
  label: string;
  /** When to use it, in one line. */
  whenToUse: string;
  /** URL paths of pages that use it. */
  usedOn: string[];
  count: number;
  /** Repo-relative component file, when found. */
  file?: string;
  /** Repo-relative picture of it (galley/sections/<type>.webp). */
  thumbnail?: string;
  confidence: Confidence;
  evidence: Evidence[];
}

export interface VoiceRule {
  rule: string;
  /** Real copy that shows it, quoted exactly. */
  quote?: { text: string; where: string };
  before?: string;
  after?: string;
}

export interface Vocabulary {
  say: string;
  /** Words to avoid in its place (comma-separated phrases are split into a list). */
  insteadOf: string[];
  why?: string;
}

export interface Voice {
  summary: string;
  tone: string[];
  rules: VoiceRule[];
  vocabulary: Vocabulary[];
  formatting: {
    headlineCase: "sentence" | "title" | "upper" | "mixed";
    punctuation: string;
    numbers: string;
    cta: string;
  };
  confidence: Confidence;
  evidence: Evidence[];
}

/** `galley/brand/brand.json`. */
export interface SiteBrandFile {
  $schema?: string;
  version: 1;
  name: string;
  updatedAt: string;
  colors: BrandColor[];
  contrast: ContrastPair[];
  typography: { fonts: BrandFont[]; scale: TypeStyle[] };
  spacing: ScaleStep[];
  radius: ScaleStep[];
  shadows: ScaleStep[];
  logos: BrandLogo[];
  imagery: Imagery | null;
  components: BrandComponent[];
  voice: Voice | null;
  layout: { do: string[]; dont: string[] };
  /** The site's tokens file, when it has one: what "Apply to the site" edits. */
  tokensFile?: string;
}

// ─────────────────────────────────────────────────────────────── sources

export type SourceType = "pdf" | "image" | "svg" | "text" | "website";

export interface BrandSource {
  id: string;
  name: string;
  type: SourceType;
  mime: string;
  bytes: number;
  sha256: string;
  addedAt: string;
  /** The person's note: "old logo, do not use". */
  note?: string;
  /** "site": a copy sits in the brand folder (versioned). "outside": too large — kept in this app's own folder for the site. */
  stored: "site" | "outside";
  /** Repo-relative path once saved into the site. */
  file?: string;
  pages?: number;
  width?: number;
  height?: number;
  /** Plain sentences: what was learned from it. */
  learned: string[];
  /** Why it could only be read in part, in plain words. */
  limited?: string;
  /** The person's choice: leave it out of the analysis. */
  ignored?: boolean;
}

/** `galley/brand/sources/manifest.json`. */
export interface SourceManifest {
  version: 1;
  sources: BrandSource[];
}

// ─────────────────────────────────────────────────────────────── measuring

/**
 * What the overlay measured on one rendered page (packages/overlay/src/measure.ts).
 * Colours are "#RRGGBB" / "#RRGGBBAA"; sizes are CSS pixels. Size-capped.
 */
export interface MeasureSummary {
  path: string;
  title: string;
  viewport: { width: number; height: number };
  /** Text colour on its effective background, with the text area it covers. */
  pairs: Array<{ text: string; background: string; area: number; count: number; roles: string[]; ratio: number }>;
  /** Ground colours of large boxes (body, sections), by area. */
  grounds: Array<{ color: string; area: number }>;
  type: Array<{ role: "heading" | "body" | "button" | "link" | "label"; tag: string; family: string; size: number; weight: number; lineHeight: number; letterSpacing: number; count: number }>;
  radii: Array<{ value: string; count: number }>;
  shadows: Array<{ value: string; count: number }>;
  spacing: Array<{ value: number; count: number }>;
  buttons: Array<{ background: string; color: string; border: string; radius: string; paddingX: number; paddingY: number; family: string; weight: number; size: number; count: number; sample: string }>;
  links: Array<{ color: string; decoration: string; count: number }>;
  logos: Array<{ kind: "img" | "svg"; src?: string; alt?: string; width: number; height: number; colors: string[]; viewBox?: string }>;
  /** Font families the page asked for, and whether the browser loaded them. */
  fonts: Array<{ family: string; status: "loaded" | "unloaded" | "error" }>;
  /** Custom properties declared on :root in the page's own stylesheets. */
  variables: Array<{ name: string; value: string }>;
  /** Internal links by how often they appear (for choosing more pages to measure). */
  internalLinks: Array<{ path: string; count: number }>;
  /** Real copy, for the voice: headings, body sentences, button labels. */
  copy: Array<{ role: "heading" | "body" | "button"; text: string }>;
  /** Parts were cut to stay under the size cap. */
  truncated: boolean;
}

// ─────────────────────────────────────────────────────────────── proposal

export interface BrandQuestion {
  id: string;
  /** The question in plain words: "The PDF says #1A1A1A for text; the site uses #111827 — which is right?" */
  text: string;
  /** What it decides: "colors.text", "fonts.body". */
  target: string;
  options: Array<{ label: string; value: string; evidence: Evidence[] }>;
  answer?: string;
}

export interface BrandFinding {
  id: string;
  kind: "issue" | "note";
  text: string;
  /** Hex values, token names or files it is about. */
  about?: string[];
}

/** The draft the person reviews. Kept in the app's own folder for the site until "Save the brand". */
export interface BrandProposal {
  id: string;
  createdAt: string;
  from: "site" | "material" | "both";
  brand: SiteBrandFile;
  questions: BrandQuestion[];
  findings: BrandFinding[];
  /** Sources added since this proposal was made: "3 new findings to review". */
  pendingSources: string[];
  /** What the analysis cost, as recorded in the site's usage. */
  cost: number | null;
  model: string | null;
}

export interface BrandStep {
  label: string;
  state: "waiting" | "running" | "done" | "skipped" | "error";
  detail?: string;
}

/** What the Brand screen needs. */
export interface SiteBrandState {
  /** The saved brand (from the site's files), or null. */
  brand: SiteBrandFile | null;
  /** guide.md as saved. */
  guide: string | null;
  sources: BrandSource[];
  proposal: BrandProposal | null;
  /** The running or last analysis. */
  analysis: { jobId: string; steps: BrandStep[]; partial: Partial<Pick<SiteBrandFile, "colors" | "typography">> | null; state: "running" | "done" | "error" | "cancelled"; error?: string } | null;
  /** Where the files live and the size above which a source stays outside the site. */
  settings: { dir: string; largeFileBytes: number; tokensFile: string | null };
  /** Whether the site has pages to read (offer "Read it from this site" first). */
  hasPages: boolean;
  /** Whether an assistant key is set (the analysis needs it). */
  assistant: boolean;
  /** The exact text the assistant receives about the brand. */
  digest: string | null;
  /** The imagery direction (direction, subjects, light, palette, things to avoid) image and video generation receive as `brandDirection`; null without one. */
  imagery?: string | null;
  /** Repo paths of the brand files that have unpublished changes. */
  pending: string[];
  /** brand.json exists but couldn't be read: why, in plain words. */
  problem: string | null;
  /** Sources added but not saved into the site yet. */
  staged: string[];
  /**
   * Sources added and not read yet ("2 new files to read · Read them"), with
   * or without a proposal open. Ignored ones are left out.
   */
  unread?: string[];
  /**
   * The site's styles are still being scanned for its web fonts and tokens
   * file (the first open after the app starts); ask again shortly for them.
   */
  scanning?: boolean;
  /** The site's own web fonts the Brand screen can load (served by the API), one per family. */
  webFonts: Array<{ family: string; weight: string; style: string; url: string }>;
}

/** One surgical edit "Apply to the site" makes to the tokens file. */
export interface TokenEdit {
  token: string;
  line: number;
  before: string;
  after: string;
  /** What it is, in plain words: "Background". */
  label: string;
}

export interface ApplyPlan {
  file: string;
  edits: TokenEdit[];
  /** Brand values with no token to put them in, or tokens left as they were, in plain words. */
  notes: string[];
  /** Contrast pairs that would fail after the change. */
  warnings: string[];
}

export interface BrandCheckItem {
  kind: "colour" | "font" | "contrast" | "words";
  text: string;
  path: string;
  line?: number;
  value?: string;
}

export interface DriftReport {
  checkedAt: string;
  pages: string[];
  /** On the site, not in the brand. */
  unknown: Array<{ kind: "colour" | "font"; value: string; where: string[]; area?: number }>;
  /** In the brand, not seen on the measured pages. */
  unused: Array<{ kind: "colour" | "font"; value: string; name: string }>;
  matching: number;
}
