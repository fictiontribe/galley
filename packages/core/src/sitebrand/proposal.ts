/**
 * From what was found to a proposal the person reviews.
 *
 *   1. Candidates (deterministic): every colour and font the site declares,
 *      the pages render, or the material states or paints — merged when they
 *      are the same value, each keeping all of its evidence.
 *   2. The evidence pack: those candidates, the sections, the real copy and
 *      what each source said, as compact data for the model.
 *   3. The model (model.ts) names roles for candidate ids and writes the
 *      voice. It can't add a colour that wasn't found.
 *   4. The proposal (deterministic): roles applied to the candidates, contrast
 *      measured, conflicts between sources turned into questions, quotes
 *      checked against the real copy, near-duplicate colours flagged.
 */
import { contrastRatio, contrastResult, deltaE, isNeutral, normalizeColor, parseColor } from "./color";
import type { DeclaredScan } from "./declared";
import type { Inventory } from "./inventory";
import type { MergedMeasurements } from "./measured";
import type { Reading, Synthesis } from "./schema";
import type { StoredSource } from "./sources";
import type {
  BrandColor,
  BrandComponent,
  BrandFinding,
  BrandFont,
  BrandLogo,
  BrandProposal,
  BrandQuestion,
  ColorRole,
  Confidence,
  ContrastPair,
  Evidence,
  FontRole,
  ScaleStep,
  SiteBrandFile,
  TypeStyle,
} from "./types";

// ─────────────────────────────────────────────────────────────── roles from names

/** Role from a token name, most specific first. Hints only — the model and the person decide. */
const ROLE_PATTERNS: Array<[RegExp, ColorRole]> = [
  [/inverse.*(background|bg|ground|surface)$|(bg|background)-inverse|footer-bg/, "inverse-background"],
  [/inverse.*(text|ink|fg|foreground)$/, "inverse-text"],
  [/accent-?(contrast|on|ink|foreground|text-on)$|on-accent|primary-foreground|on-primary/, "accent-text"],
  [/accent-?(strong|hover|dark|pressed|deep)$|primary-(hover|dark|strong)/, "accent-strong"],
  [/paper|canvas|^background$|^bg$|page-bg|^color-background$/, "background"],
  [/surface-?(muted|sunken|alt|subtle|2)$|(bg|background)-(muted|subtle|alt)$|muted-?(bg|background|surface)$/, "surface-muted"],
  [/surface|raised|card|panel/, "surface"],
  [/(background|bg)$/, "background"],
  [/(text|ink|fg)-?(muted|secondary|subtle|soft|2)$|muted-?(text|ink|fg)$/, "text-muted"],
  [/^(color-)?(text|ink|fg|foreground|body)$|ink-primary|text-primary|-text$/, "text"],
  [/border|line|rule|divider|hairline/, "border"],
  [/accent$|^(color-)?primary$|^(color-)?brand$/, "accent"],
  [/positive|success/, "positive"],
  [/negative|danger|error/, "negative"],
  [/notice|warning/, "notice"],
];

/** Where on the site something was seen, in words: "on the home page", "on /about/ and /contact/"; empty when nowhere is known. */
export function pagesWords(pages: readonly string[]): string {
  const named = [...new Set(pages.filter((page) => typeof page === "string" && page.trim()))].slice(0, 3).map((page) => (page === "/" ? "the home page" : page));
  if (named.length === 0) return "";
  if (named.length === 1) return `on ${named[0]}`;
  return `on ${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

export function roleFromName(token: string): ColorRole | null {
  const name = token.replace(/^-+/, "").replace(/^colou?r-/, "").toLowerCase();

  for (const [pattern, role] of ROLE_PATTERNS) if (pattern.test(name) || pattern.test(`color-${name}`)) return role;
  return null;
}

export function fontRoleFromName(token: string): FontRole | null {
  const name = token.toLowerCase();

  if (/mono|code/.test(name)) return "mono";
  if (/display|heading|head|title|serif(?!-)|brand/.test(name)) return "display";
  if (/body|text|sans|base|copy|ui/.test(name)) return "body";
  return null;
}

/** Decorative tokens (illustration fills, scrims) aren't brand colours unless the pages use them as such. */
const DECORATIVE = /shot|scrim|overlay|shadow|illustration|chart|syntax|code-/;

const ROLE_WORDS: Record<ColorRole, string> = {
  background: "background",
  surface: "surface",
  "surface-muted": "muted surface",
  text: "text",
  "text-muted": "muted text",
  accent: "accent",
  "accent-text": "text on the accent",
  "accent-strong": "accent hover",
  border: "border",
  "inverse-background": "dark ground",
  "inverse-text": "text on the dark ground",
  positive: "positive",
  negative: "negative",
  notice: "notice",
  other: "colour",
};

export function roleWords(role: ColorRole): string {
  return ROLE_WORDS[role];
}

// ─────────────────────────────────────────────────────────────── candidates

export interface ColorCandidate {
  id: string;
  hex: string;
  tokens: string[];
  hint: ColorRole | null;
  /** Names a source gave it. */
  names: string[];
  /** Roles sources stated for it. */
  statedRoles: Array<{ role: ColorRole; evidence: Evidence }>;
  evidence: Evidence[];
  /** Seen on the site's rendered pages. */
  onPages: boolean;
  declared: boolean;
  /** Painted in a source file (pixels, PDF fills). */
  inFile: boolean;
  textArea: number;
  groundArea: number;
  button: number;
  link: number;
}

export interface FontCandidate {
  id: string;
  family: string;
  fallbacks: string[];
  tokens: string[];
  hint: FontRole | null;
  source: BrandFont["source"];
  weights: Set<number>;
  evidence: Evidence[];
  onPages: boolean;
  loaded: boolean | null;
  declared: boolean;
  roles: Set<string>;
}

export interface LogoCandidate {
  id: string;
  file: string;
  format: BrandLogo["format"];
  colors: string[];
  viewBox?: string;
  note?: string;
  evidence: Evidence[];
  onPages: boolean;
}

export interface SourceInput {
  source: StoredSource;
  reading: Reading | null;
}

export interface CandidateInput {
  declared: DeclaredScan | null;
  measured: MergedMeasurements | null;
  sources: SourceInput[];
  /** A fetched website's declarations. */
  website: { url: string; declared: DeclaredScan } | null;
}

export interface Candidates {
  colors: ColorCandidate[];
  fonts: FontCandidate[];
  logos: LogoCandidate[];
}

const fontKey = (family: string) => family.toLowerCase().replace(/\s+variable$/, "").replace(/[^a-z0-9]/g, "");
const sourceEvidence = (source: StoredSource, page?: number, note?: string): Evidence => ({
  kind: "source",
  source: source.id,
  sourceName: source.name,
  ...(page && page > 0 ? { sourcePage: page } : {}),
  ...(note ? { note: note.slice(0, 300) } : {}),
});

export function buildCandidates(input: CandidateInput): Candidates {
  const colors: ColorCandidate[] = [];
  // Two declared tokens are two colours however close they are (a ground and a text colour can differ by a hair);
  // only measured and file colours are folded into a near-identical one, since that difference is rendering noise.
  const color = (hex: string, declared = false): ColorCandidate => {
    const solid = hex.slice(0, 7).toUpperCase();
    let found = colors.find((c) => c.hex === solid) ?? (declared ? undefined : colors.find((c) => deltaE(c.hex, solid) < 1));

    if (!found) {
      found = { id: `c${colors.length + 1}`, hex: solid, tokens: [], hint: null, names: [], statedRoles: [], evidence: [], onPages: false, declared: false, inFile: false, textArea: 0, groundArea: 0, button: 0, link: 0 };
      colors.push(found);
    }
    return found;
  };
  const addDeclared = (scan: DeclaredScan, website: string | null) => {
    for (const variable of scan.variables) {
      if (variable.kind !== "color" || !/^(:root|@theme|html)/.test(variable.context)) continue;
      if (scan.tokensFile && variable.file !== scan.tokensFile && !website) continue;
      const hex = normalizeColor(variable.resolved);

      if (!hex || DECORATIVE.test(variable.name)) continue;
      const candidate = color(hex, true);

      candidate.declared = true;
      if (!candidate.tokens.includes(variable.name)) candidate.tokens.push(variable.name);
      candidate.hint ??= roleFromName(variable.name);
      candidate.evidence.push(website ? { kind: "website", url: website, note: `${variable.name}: ${variable.raw}`.slice(0, 300) } : { kind: "file", file: variable.file, line: variable.line, note: `${variable.name}: ${variable.raw}`.slice(0, 300) });
    }
    for (const other of scan.otherColors.slice(0, 30)) {
      const candidate = color(other.value);

      candidate.declared = true;
      candidate.tokens.push(other.name);
      candidate.evidence.push({ kind: "file", file: other.file, line: other.line, note: other.name });
    }
  };

  if (input.declared) addDeclared(input.declared, null);
  if (input.website) addDeclared(input.website.declared, input.website.url);
  const measured = input.measured;

  if (measured) {
    const totalText = measured.colors.reduce((sum, c) => sum + c.textArea, 0) || 1;
    const totalGround = measured.colors.reduce((sum, c) => sum + c.groundArea, 0) || 1;

    for (const use of measured.colors) {
      const significant = use.textArea / totalText >= 0.01 || use.groundArea / totalGround >= 0.01 || use.button > 0 || use.link > 2;

      if (!significant) continue;
      const candidate = color(use.hex);
      const pages = [...use.pages];

      candidate.onPages = true;
      candidate.textArea += use.textArea;
      candidate.groundArea += use.groundArea;
      candidate.button += use.button;
      candidate.link += use.link;
      const what = [
        use.textArea / totalText >= 0.01 ? `${Math.round((use.textArea / totalText) * 100)}% of the text` : null,
        use.groundArea / totalGround >= 0.01 ? `${Math.round((use.groundArea / totalGround) * 100)}% of the grounds` : null,
        use.button ? `${use.button} button${use.button === 1 ? "" : "s"}` : null,
        use.link > 2 ? "links" : null,
      ].filter(Boolean);

      candidate.evidence.push({ kind: "page", page: pages[0]!, element: [...use.roles].join(", ") || "ground", note: `${what.join(", ")} on ${pages.length === 1 ? pages[0] : `${pages.length} pages`}` });
    }
  }
  for (const { source, reading } of input.sources) {
    if (source.ignored) continue;
    for (const entry of source.facts.palette?.slice(0, 6) ?? []) {
      if (entry.share < 0.03) continue;
      const candidate = color(entry.color);

      candidate.inFile = true;
      candidate.evidence.push(sourceEvidence(source, undefined, `${Math.round(entry.share * 100)}% of the picture`));
    }
    for (const entry of source.facts.svg?.colors.slice(0, 6) ?? []) {
      const candidate = color(entry.color);

      candidate.inFile = true;
      candidate.evidence.push(sourceEvidence(source, undefined, `painted in the drawing (${Math.round(entry.share * 100)}%)`));
    }
    for (const entry of source.facts.pdf?.colors.filter((c) => c.share >= 0.01 || c.text >= 5).slice(0, 8) ?? []) {
      const candidate = color(entry.color);

      candidate.inFile = true;
      candidate.evidence.push(sourceEvidence(source, undefined, entry.share >= 0.01 ? `fills ${Math.round(entry.share * 100)}% of its pages` : "used for its text"));
    }
    for (const stated of reading?.colors ?? []) {
      const hex = normalizeColor(stated.hex);

      if (!hex) continue;
      // A colour read off a picture is snapped to the measured pixel colour it matches, so it isn't a second near-copy.
      const exact = stated.how === "seen" ? colors.find((c) => c.inFile && deltaE(c.hex, hex) < 4) : null;
      const candidate = exact ?? color(hex);
      const evidence = sourceEvidence(source, stated.page, `${stated.how === "stated" ? "states" : "shows"} ${hex}${stated.name ? ` (“${stated.name}”)` : ""}`);

      if (stated.how === "stated") candidate.declared = true;
      else candidate.inFile = true;
      if (stated.name && !candidate.names.includes(stated.name)) candidate.names.push(stated.name.slice(0, 80));
      // A role read off a picture is a guess; only a role the material states can raise a question.
      if (stated.role !== "unknown" && stated.how === "stated") candidate.statedRoles.push({ role: stated.role as ColorRole, evidence });
      candidate.evidence.push(evidence);
    }
  }
  // Hints from use, where names said nothing.
  if (measured) {
    const byGround = [...colors].filter((c) => c.onPages).sort((a, b) => b.groundArea - a.groundArea);
    const byText = [...colors].filter((c) => c.onPages).sort((a, b) => b.textArea - a.textArea);
    const byButton = [...colors].filter((c) => c.button > 0 && !isNeutral(c.hex)).sort((a, b) => b.button - a.button);

    if (byGround[0] && !colors.some((c) => c.hint === "background")) byGround[0].hint ??= "background";
    if (byText[0] && !colors.some((c) => c.hint === "text")) byText[0].hint ??= "text";
    if (byButton[0] && !colors.some((c) => c.hint === "accent")) byButton[0].hint ??= "accent";
  }

  const fonts: FontCandidate[] = [];
  const font = (family: string): FontCandidate => {
    const key = fontKey(family);
    let found = fonts.find((f) => fontKey(f.family) === key);

    if (!found) {
      found = { id: `f${fonts.length + 1}`, family, fallbacks: [], tokens: [], hint: null, source: { kind: "unknown" }, weights: new Set(), evidence: [], onPages: false, loaded: null, declared: false, roles: new Set() };
      fonts.push(found);
    }
    return found;
  };

  for (const scan of [input.declared, input.website?.declared].filter((s): s is DeclaredScan => Boolean(s))) {
    for (const declared of scan.fonts) {
      if (scan.tokensFile && declared.file !== scan.tokensFile && scan === input.declared) continue;
      const candidate = font(declared.family);

      candidate.declared = true;
      candidate.fallbacks = candidate.fallbacks.length ? candidate.fallbacks : declared.fallbacks;
      if (declared.token && !candidate.tokens.includes(declared.token)) candidate.tokens.push(declared.token);
      candidate.hint ??= declared.token ? fontRoleFromName(declared.token) : null;
      if (declared.source.kind !== "unknown") candidate.source = declared.source;
      candidate.evidence.push(scan === input.declared ? { kind: "file", file: declared.file, line: declared.line, note: `${declared.token ?? "font"}: ${declared.family}` } : { kind: "website", url: input.website!.url, note: `${declared.token ?? "font"}: ${declared.family}` });
    }
    for (const face of scan.fontFaces) {
      const candidate = fonts.find((f) => fontKey(f.family) === fontKey(face.family));
      const weights = face.weight.split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= 1000);

      if (candidate) for (const weight of weights) candidate.weights.add(weight);
    }
  }
  for (const used of measured?.type ?? []) {
    const candidate = font(used.family);

    candidate.onPages = true;
    candidate.roles.add(used.role === "heading" ? `${used.tag}` : used.role);
    candidate.weights.add(used.weight);
  }
  for (const status of measured?.fonts ?? []) {
    const candidate = fonts.find((f) => fontKey(f.family) === fontKey(status.family));

    if (candidate) candidate.loaded = candidate.loaded === true || status.status === "loaded";
  }
  for (const candidate of fonts) {
    if (!candidate.onPages || !measured) continue;
    const pages = measured.type.filter((t) => fontKey(t.family) === fontKey(candidate.family)).flatMap((t) => t.pages);

    candidate.evidence.push({ kind: "page", page: pages[0] ?? "/", element: [...candidate.roles].slice(0, 4).join(", "), note: `set on ${new Set(pages).size === 1 ? pages[0] : `${new Set(pages).size} pages`}` });
    if (!candidate.hint) candidate.hint = candidate.roles.has("h1") || candidate.roles.has("h2") ? "display" : candidate.roles.has("body") ? "body" : null;
  }
  for (const { source, reading } of input.sources) {
    if (source.ignored) continue;
    for (const embedded of source.facts.pdf?.fonts ?? []) {
      const candidate = font(embedded.family);

      if (candidate.source.kind === "unknown") candidate.source = { kind: "embedded", ref: source.name };
      candidate.evidence.push(sourceEvidence(source, undefined, `embedded (${embedded.styles.join(", ")})`));
    }
    for (const stated of reading?.fonts ?? []) {
      if (!stated.family.trim()) continue;
      const candidate = font(stated.family.trim().slice(0, 120));

      if (stated.how === "stated") candidate.declared = true;
      if (stated.role !== "unknown") candidate.hint ??= stated.role as FontRole;
      candidate.evidence.push(sourceEvidence(source, stated.page, `${stated.how === "stated" ? "names" : "shows"} ${stated.family}`));
    }
  }

  const logos: LogoCandidate[] = [];

  for (const logo of measured?.logos ?? []) {
    const file = logo.kind === "img" ? (logo.src ?? "") : `inline svg${logo.viewBox ? ` ${logo.viewBox}` : ""}`;
    const format = logo.kind === "svg" ? "svg" : ((/\.(svg|png|jpe?g|webp|gif)(\?|$)/i.exec(logo.src ?? "")?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? "other") as BrandLogo["format"]);

    logos.push({ id: `l${logos.length + 1}`, file, format, colors: logo.colors, ...(logo.viewBox ? { viewBox: logo.viewBox } : {}), ...(logo.alt ? { note: logo.alt } : {}), evidence: [{ kind: "page", page: logo.pages[0]!, element: "header logo" }], onPages: true });
  }
  for (const { source } of input.sources) {
    if (source.type !== "svg" && source.type !== "image") continue;
    logos.push({
      id: `source:${source.id}`,
      file: source.file ?? `source:${source.id}`,
      format: source.type === "svg" ? "svg" : ((({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }) as Record<string, BrandLogo["format"]>)[source.mime] ?? "other"),
      colors: (source.facts.svg?.colors ?? source.facts.palette ?? []).slice(0, 6).map((c) => c.color),
      ...(source.facts.svg?.viewBox ? { viewBox: source.facts.svg.viewBox } : {}),
      ...(source.note ? { note: source.note } : {}),
      evidence: [sourceEvidence(source)],
      onPages: false,
    });
  }
  return { colors, fonts, logos };
}

// ─────────────────────────────────────────────────────────────── the pack

export interface PackInput {
  siteName: string;
  candidates: Candidates;
  measured: MergedMeasurements | null;
  inventory: Inventory | null;
  sources: SourceInput[];
  websiteCopy: Array<{ text: string; where: string }>;
  notes: string[];
}

function printEvidence(evidence: Evidence): string {
  if (evidence.kind === "file") return `${evidence.file}${evidence.line ? `:${evidence.line}` : ""}${evidence.note ? ` (${evidence.note})` : ""}`;
  if (evidence.kind === "page") return `measured on ${evidence.page}${evidence.note ? ` — ${evidence.note}` : ""}`;
  if (evidence.kind === "website") return `${evidence.url}${evidence.note ? ` (${evidence.note})` : ""}`;
  return `${evidence.sourcePage ? `page ${evidence.sourcePage} of ` : ""}${evidence.sourceName}${evidence.note ? ` — ${evidence.note}` : ""}`;
}

export { printEvidence };

/** All real copy the voice may quote. */
export function copyPool(input: Pick<PackInput, "measured" | "inventory" | "websiteCopy">): Array<{ text: string; where: string }> {
  const lines = [
    ...(input.measured?.copy.map((line) => ({ text: line.text, where: line.page })) ?? []),
    ...(input.inventory?.copy ?? []),
    ...input.websiteCopy,
  ];
  const seen = new Set<string>();

  return lines.filter((line) => {
    const key = line.text.toLowerCase();

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function evidencePack(input: PackInput): unknown {
  const { candidates } = input;

  return {
    site: { name: input.siteName, pagesMeasured: input.measured?.pages ?? [] },
    colorCandidates: candidates.colors.slice(0, 60).map((c) => ({
      id: c.id,
      hex: c.hex,
      ...(c.tokens.length ? { tokens: c.tokens.slice(0, 6) } : {}),
      ...(c.hint ? { hint: c.hint } : {}),
      ...(c.names.length ? { namedInSources: c.names.slice(0, 3) } : {}),
      ...(c.statedRoles.length ? { statedRoles: [...new Set(c.statedRoles.map((r) => r.role))] } : {}),
      contrastOnWhite: contrastRatio(c.hex, "#FFFFFF"),
      evidence: c.evidence.slice(0, 5).map(printEvidence),
    })),
    fontCandidates: candidates.fonts.slice(0, 16).map((f) => ({
      id: f.id,
      family: f.family,
      ...(f.tokens.length ? { tokens: f.tokens } : {}),
      ...(f.hint ? { hint: f.hint } : {}),
      ...(f.roles.size ? { usedFor: [...f.roles] } : {}),
      ...(f.loaded === false ? { loaded: false } : {}),
      evidence: f.evidence.slice(0, 4).map(printEvidence),
    })),
    typeSeen: input.measured?.type.slice(0, 16).map((t) => ({ role: t.role, tag: t.tag, family: t.family, size: t.size, weight: t.weight, lineHeight: t.lineHeight, count: t.count })) ?? [],
    buttons: input.measured?.buttons.slice(0, 4) ?? [],
    logoCandidates: candidates.logos.map((l) => ({ id: l.id, file: l.file, format: l.format, colors: l.colors, ...(l.viewBox ? { viewBox: l.viewBox } : {}), ...(l.note ? { personNote: l.note } : {}) })),
    sections: input.inventory?.components.slice(0, 40).map((c) => ({ type: c.type, label: c.label, ...(c.whenToUse ? { described: c.whenToUse } : {}), count: c.count, usedOn: c.usedOn.slice(0, 5) })) ?? [],
    copy: copyPool(input).slice(0, 70),
    sources: input.sources
      .filter((s) => !s.source.ignored)
      .map((s) => ({ id: s.source.id, name: s.source.name, type: s.source.type, ...(s.source.note ? { personNote: s.source.note } : {}), learned: s.source.learned, ...(s.reading ? { read: s.reading } : {}) })),
    notes: input.notes,
  };
}

// ─────────────────────────────────────────────────────────────── the proposal

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";

function unique(id: string, taken: Set<string>): string {
  let out = id;

  for (let i = 2; taken.has(out); i += 1) out = `${id}-${i}`;
  taken.add(out);
  return out;
}

function confidenceOf(onPages: boolean, declared: boolean, inFile: boolean): Confidence {
  if (onPages) return "measured";
  if (declared) return "declared";
  return inFile ? "measured" : "inferred";
}

const collapseText = (text: string) => text.replace(/[“”"]/g, '"').replace(/[‘’']/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

const TEXT_ROLES: ColorRole[] = ["text", "text-muted", "accent"];
/**
 * Below this, the text measured is all but the colour of the ground measured
 * behind it: a page nobody could read. In practice it means the ground
 * wasn't the one the text sits on (a photograph, a video or a layer drawn
 * behind it), so such a pair is left out rather than reported.
 */
export const UNKNOWN_GROUND_RATIO = 1.5;
const GROUND_ROLES: ColorRole[] = ["background", "surface", "surface-muted"];

export function contrastPairs(colors: BrandColor[], measured: MergedMeasurements | null): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  const add = (text: BrandColor, ground: BrandColor) => {
    if (text.id === ground.id || pairs.some((p) => p.text === text.id && p.background === ground.id)) return;
    const ratio = contrastRatio(text.value, ground.value);
    const seen = measured?.pairs.filter((p) => deltaE(p.text, text.value) < 2 && deltaE(p.background, ground.value) < 2).flatMap((p) => p.pages) ?? [];

    pairs.push({ text: text.id, background: ground.id, ratio, result: contrastResult(ratio), ...(seen.length ? { measuredOn: [...new Set(seen)].slice(0, 10) } : {}) });
  };

  for (const role of TEXT_ROLES) {
    for (const ground of GROUND_ROLES) {
      for (const text of colors.filter((c) => c.role === role)) for (const g of colors.filter((c) => c.role === ground)) add(text, g);
    }
  }
  for (const text of colors.filter((c) => c.role === "accent-text")) for (const g of colors.filter((c) => c.role === "accent")) add(text, g);
  for (const text of colors.filter((c) => c.role === "inverse-text")) for (const g of colors.filter((c) => c.role === "inverse-background")) add(text, g);
  // Pairs the pages really show, between brand colours, that the role grid didn't cover.
  for (const seen of measured?.pairs.slice(0, 30) ?? []) {
    if (seen.ratio < UNKNOWN_GROUND_RATIO) continue;
    const text = colors.find((c) => deltaE(c.value, seen.text) < 2);
    const ground = colors.find((c) => deltaE(c.value, seen.background) < 2);

    if (text && ground) add(text, ground);
  }
  return pairs;
}

/** "11 greys in use; 4 are within 2% of each other" and the pairs the pages fail on. */
export function measuredFindings(measured: MergedMeasurements | null, colors: BrandColor[]): BrandFinding[] {
  if (!measured) return [];
  const findings: BrandFinding[] = [];
  const neutrals = measured.colors.filter((c) => isNeutral(c.hex) && (c.textArea > 0 || c.groundArea > 0));
  const close = new Set<string>();

  for (const a of neutrals) for (const b of neutrals) if (a !== b && deltaE(a.hex, b.hex) < 2) close.add(a.hex).add(b.hex);
  if (neutrals.length >= 5 && close.size >= 2) {
    findings.push({ id: "near-greys", kind: "issue", text: `${neutrals.length} greys in use; ${close.size} are within 2% of each other.`, about: [...close].slice(0, 8) });
  }
  // A brand colour by the name the brand gives it ("Paper"), else by its role ("the muted text colour"); any other colour by its value.
  const nameOf = (hex: string) => {
    const brand = colors.find((c) => deltaE(c.value, hex) < 2);

    if (!brand) return hex;
    const name = brand.name.trim();

    return name && name.toLowerCase() !== roleWords(brand.role) ? name : `the ${roleWords(brand.role)} colour`;
  };

  for (const pair of measured.pairs.slice(0, 40)) {
    const headingOnly = pair.roles.every((role) => role === "heading");
    const needed = headingOnly ? 3 : 4.5;

    if (pair.ratio >= needed || pair.ratio < UNKNOWN_GROUND_RATIO || findings.length > 8) continue;
    const [what, verb] = pair.roles.includes("body") ? ["Body text", "is"] : pair.roles.includes("link") ? ["Links", "are"] : pair.roles.includes("button") ? ["Button text", "is"] : headingOnly ? ["Headings", "are"] : ["Text", "is"];
    const where = pagesWords(pair.pages);
    const text = `${what} in ${nameOf(pair.text)} on ${nameOf(pair.background)} ${verb} ${pair.ratio.toFixed(1)}:1${where ? ` ${where}` : ""}.`;

    findings.push({ id: `contrast-${pair.text}-${pair.background}`.toLowerCase(), kind: "issue", text: text.charAt(0).toUpperCase() + text.slice(1), about: [pair.text, pair.background] });
  }
  for (const font of measured.fonts) {
    if (font.status === "error") findings.push({ id: `font-${slug(font.family)}`, kind: "issue", text: `The font ${font.family} failed to load ${pagesWords(font.pages.slice(0, 1)) || "on a page"}; visitors see the fallback.`, about: [font.family] });
  }
  return findings;
}

export interface BuildInput extends PackInput {
  from: BrandProposal["from"];
  synthesis: Synthesis;
  declared: DeclaredScan | null;
  /** The previous saved brand, so its id and names carry over. */
  previous: SiteBrandFile | null;
  now: () => Date;
  cost: number | null;
  model: string | null;
}

export function buildProposal(input: BuildInput): BrandProposal {
  const { candidates, synthesis, measured } = input;
  const byId = new Map(candidates.colors.map((c) => [c.id, c]));
  const taken = new Set<string>();
  const colors: BrandColor[] = [];
  const usedCandidates = new Set<string>();
  const roleTaken = new Set<ColorRole>();

  const toColor = (candidate: ColorCandidate, role: ColorRole, name: string, usage: string): BrandColor => ({
    id: unique(slug(role === "other" ? name : role), taken),
    role,
    name: name.trim().slice(0, 80) || candidate.names[0] || roleWords(role).replace(/^./, (c) => c.toUpperCase()),
    value: candidate.hex,
    ...(candidate.tokens[0]?.startsWith("--") ? { token: candidate.tokens[0] } : {}),
    ...(usage.trim() ? { usage: usage.trim().slice(0, 240) } : {}),
    confidence: confidenceOf(candidate.onPages, candidate.declared, candidate.inFile),
    evidence: candidate.evidence.slice(0, 8),
  });

  for (const assigned of synthesis.colors) {
    const candidate = byId.get(assigned.candidate);

    if (!candidate || (usedCandidates.has(candidate.id) && assigned.role === "other")) continue;
    // A role named on the token wins over the model's reading of it.
    const role = candidate.hint && candidate.tokens.some((t) => roleFromName(t) === candidate.hint) && candidate.hint !== assigned.role && !roleTaken.has(candidate.hint) ? candidate.hint : assigned.role;

    if (role !== "other" && roleTaken.has(role)) continue;
    colors.push(toColor(candidate, role, assigned.name, assigned.usage));
    usedCandidates.add(candidate.id);
    if (role !== "other") roleTaken.add(role);
  }
  // Tokens whose names say their role plainly, that the model passed over.
  for (const candidate of candidates.colors) {
    if (usedCandidates.has(candidate.id) || !candidate.hint || roleTaken.has(candidate.hint) || !candidate.tokens.some((t) => roleFromName(t) === candidate.hint)) continue;
    colors.push(toColor(candidate, candidate.hint, "", ""));
    usedCandidates.add(candidate.id);
    roleTaken.add(candidate.hint);
  }
  // Questions: a source states one value for a role, the site (or another source) another.
  const questions: BrandQuestion[] = [];

  // Only the roles that decide the look are worth stopping for; other disagreements are noted.
  const QUESTION_ROLES = new Set<ColorRole>(["background", "surface", "text", "accent"]);
  const disagreements: BrandFinding[] = [];

  for (const candidate of candidates.colors) {
    for (const stated of candidate.statedRoles) {
      const current = colors.find((c) => c.role === stated.role);

      if (!current || deltaE(current.value, candidate.hex) < 2.5) continue;
      // One document giving two values for a role (a light and a dark theme, say) isn't a disagreement between sources.
      const sameSource = current.evidence.some((e) => e.kind === "source" && e.source === stated.evidence.source);
      const where = current.evidence.find((e) => e.kind === "page") ? "the site uses" : current.evidence.find((e) => e.kind === "file") ? "the site's styles say" : "another source says";

      if (stated.role === "other") continue;
      if (!QUESTION_ROLES.has(stated.role) || sameSource) {
        if (disagreements.length < 6) disagreements.push({ id: `also-${stated.role}-${candidate.hex}`.toLowerCase(), kind: "note", text: `${stated.evidence.sourceName}${stated.evidence.sourcePage ? ` (p. ${stated.evidence.sourcePage})` : ""} also gives ${candidate.hex} for ${roleWords(stated.role)}; the proposal uses ${current.value}.`, about: [candidate.hex, current.value] });
        continue;
      }
      const id = `q-${stated.role}`;

      if (questions.some((q) => q.id === id)) continue;
      questions.push({
        id,
        target: `colors.${stated.role}`,
        text: `${stated.evidence.sourceName} says ${candidate.hex} for ${roleWords(stated.role)}; ${where} ${current.value} — which is right?`,
        options: [
          { label: `${candidate.hex}${stated.evidence.sourcePage ? `, as on page ${stated.evidence.sourcePage} of ${stated.evidence.sourceName}` : `, as ${stated.evidence.sourceName} says`}`, value: candidate.hex, evidence: [stated.evidence] },
          { label: `${current.value}, as ${where.replace(/ (uses|say|says)$/, "")} ${where.endsWith("uses") ? "uses" : "says"}`, value: current.value, evidence: current.evidence.slice(0, 3) },
        ],
      });
    }
  }
  for (const question of synthesis.questions.slice(0, 4)) {
    const options = question.options.filter((o) => o.trim()).slice(0, 4);

    if (!question.text.trim() || options.length < 2 || questions.some((q) => q.target === question.target)) continue;
    questions.push({ id: unique(`q-${slug(question.target || question.text)}`, taken), target: question.target.slice(0, 80), text: question.text.slice(0, 300), options: options.map((o) => ({ label: o.slice(0, 160), value: o.slice(0, 160), evidence: [] })) });
  }

  // Fonts.
  const fontById = new Map(candidates.fonts.map((f) => [f.id, f]));
  const fonts: BrandFont[] = [];
  const fontTaken = new Set<string>();

  for (const assigned of synthesis.fonts) {
    const candidate = fontById.get(assigned.candidate);

    if (!candidate || fontTaken.has(candidate.id)) continue;
    fontTaken.add(candidate.id);
    fonts.push({
      id: unique(assigned.role === "other" ? slug(candidate.family) : assigned.role, taken),
      role: assigned.role,
      family: candidate.family,
      fallbacks: candidate.fallbacks.slice(0, 8),
      source: candidate.source,
      weights: [...candidate.weights].sort((a, b) => a - b).slice(0, 12),
      ...(candidate.tokens[0] ? { token: candidate.tokens[0] } : {}),
      confidence: confidenceOf(candidate.onPages, candidate.declared, candidate.source.kind === "embedded"),
      evidence: candidate.evidence.slice(0, 6),
    });
  }
  const fontFor = (family: string) => fonts.find((f) => fontKey(f.family) === fontKey(family));
  // Type scale: what the pages set, by role.
  const scale: TypeStyle[] = [];

  // Body is what paragraphs are set in. The most frequent paragraph style can be a label (a mono eyebrow
  // written as <p>), so mono faces and label sizes only count when there is nothing else.
  const paragraphs = (measured?.type ?? []).filter((t) => t.role === "body" && t.tag === "p");
  const prose = paragraphs.filter((t) => fontFor(t.family)?.role !== "mono" && !/mono|code/i.test(t.family) && t.size >= 14);
  const bodyPick = prose.find((t) => fontFor(t.family)?.role === "body") ?? prose[0] ?? paragraphs[0] ?? measured?.type.find((t) => t.role === "body");

  for (const role of ["h1", "h2", "h3", "h4", "body", "small", "button", "link"] as const) {
    const pick = role === "body" ? bodyPick : measured?.type.find((t) => (role.startsWith("h") ? t.tag === role : role === "small" ? t.role === "label" : t.role === role));
    const owner = pick ? fontFor(pick.family) : undefined;

    if (!pick || !owner) continue;
    scale.push({
      id: role,
      role,
      font: owner.id,
      size: `${pick.size}px`,
      px: pick.size,
      weight: pick.weight,
      lineHeight: `${Math.round((pick.lineHeight / pick.size) * 100) / 100}`,
      ...(pick.letterSpacing ? { letterSpacing: `${pick.letterSpacing}px` } : {}),
      confidence: "measured",
      evidence: [{ kind: "page", page: pick.pages[0]!, element: pick.tag, note: `${pick.count} on ${pick.pages.length === 1 ? pick.pages[0] : `${pick.pages.length} pages`}` }],
    });
  }

  // Scales: declared tokens, with how often the pages use each value.
  const toPx = (value: string) => {
    const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(value.trim());

    return match ? Number(match[1]) * (match[2] === "rem" ? 16 : 1) : null;
  };
  const steps = (kind: "space" | "radius" | "shadow", seen: Array<{ value: string | number; count: number }>): ScaleStep[] => {
    const declared = (input.declared?.variables ?? []).filter((v) => v.kind === kind && v.file === input.declared?.tokensFile && /^(:root|@theme)/.test(v.context));

    if (declared.length) {
      return declared.slice(0, 16).map((v) => {
        const px = toPx(v.resolved);
        const uses = seen.filter((s) => (typeof s.value === "number" ? s.value === px : toPx(String(s.value)) === px || String(s.value) === v.resolved)).reduce((sum, s) => sum + s.count, 0);

        return { id: unique(slug(v.name), taken), name: v.name.replace(/^--/, ""), value: v.raw, token: v.name, ...(uses ? { uses } : {}), confidence: uses ? "measured" : "declared", evidence: [{ kind: "file", file: v.file, line: v.line }] };
      });
    }
    return seen
      .filter((s) => s.count >= 2)
      .slice(0, 8)
      .map((s) => ({ id: unique(`${kind}-${slug(String(s.value))}`, taken), name: typeof s.value === "number" ? `${s.value}px` : String(s.value).slice(0, 40), value: typeof s.value === "number" ? `${s.value}px` : String(s.value), uses: s.count, confidence: "measured" as const, evidence: [{ kind: "page" as const, page: measured?.pages[0] ?? "/", note: `${s.count} times` }] }));
  };

  // Logos.
  const logoById = new Map(candidates.logos.map((l) => [l.id, l]));
  const logos: BrandLogo[] = [];

  for (const assigned of synthesis.logos) {
    const candidate = logoById.get(assigned.candidate);

    if (!candidate || logos.some((l) => l.file === candidate.file)) continue;
    const doNotUse = candidate.note ? /\b(do\s*not|don'?t|never)\s+use\b/i.test(candidate.note) : false;

    logos.push({
      id: unique(slug(`logo-${assigned.variant}`), taken),
      file: candidate.file,
      format: candidate.format,
      variant: assigned.variant,
      background: assigned.background,
      colors: candidate.colors.filter((c) => /^#[0-9A-F]{6}$/i.test(c)).map((c) => c.toUpperCase()).slice(0, 8),
      ...(candidate.viewBox ? { viewBox: candidate.viewBox } : {}),
      ...(assigned.clearSpace.trim() ? { clearSpace: assigned.clearSpace.trim().slice(0, 200) } : {}),
      ...(assigned.minSize.trim() ? { minSize: assigned.minSize.trim().slice(0, 200) } : {}),
      ...(assigned.notes.trim() || candidate.note ? { notes: (assigned.notes.trim() || candidate.note || "").slice(0, 300) } : {}),
      ...(doNotUse ? { doNotUse: true } : {}),
      confidence: candidate.onPages ? "measured" : "declared",
      evidence: candidate.evidence,
    });
  }

  // Components.
  const components: BrandComponent[] = (input.inventory?.components ?? []).map((component) => {
    const said = synthesis.components.find((c) => c.type === component.type);

    return { ...component, whenToUse: component.whenToUse || said?.whenToUse.slice(0, 300) || "", confidence: component.whenToUse ? component.confidence : said ? "inferred" : component.confidence };
  });

  // Voice: quotes must be real copy, or point at a source.
  const pool = copyPool(input);
  const sourceNames = input.sources.map((s) => s.source.name.toLowerCase());
  const realQuote = (raw: string, where: string): { text: string; where: string } | null => {
    // The guide sets its own quotation marks; a quote that arrives already quoted would be shown twice.
    const quote = raw.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, "");
    const wanted = collapseText(quote);

    if (wanted.length < 3) return null;
    const line = pool.find((l) => collapseText(l.text).includes(wanted));

    if (line) return { text: quote.trim().slice(0, 300), where: line.where };
    if (sourceNames.some((name) => where.toLowerCase().includes(name))) return { text: quote.trim().slice(0, 300), where: where.slice(0, 200) };
    return null;
  };
  const voice = synthesis.voice;
  const voiceEvidence: Evidence[] = [
    ...(pool.length ? [{ kind: "page" as const, page: pool[0]!.where, note: `${pool.length} pieces of the site's own copy` }] : []),
    ...input.sources.filter((s) => s.reading?.voice.length).map((s) => sourceEvidence(s.source, s.reading!.voice[0]!.page)),
  ];
  const brandVoice: SiteBrandFile["voice"] = voice.summary.trim()
    ? {
        summary: voice.summary.trim().slice(0, 700),
        tone: voice.tone.map((t) => t.trim().slice(0, 60)).filter(Boolean).slice(0, 8),
        rules: voice.rules.slice(0, 12).map((rule) => {
          const quote = rule.quote.trim() ? realQuote(rule.quote, rule.where) : null;

          return { rule: rule.rule.trim().slice(0, 300), ...(quote ? { quote } : {}), ...(rule.before.trim() ? { before: rule.before.trim().slice(0, 300) } : {}), ...(rule.after.trim() ? { after: rule.after.trim().slice(0, 300) } : {}) };
        }),
        vocabulary: voice.vocabulary
          .filter((v) => v.say.trim() && v.insteadOf.some((w) => w.trim()))
          .slice(0, 24)
          .map((v) => ({ say: v.say.trim().slice(0, 100), insteadOf: v.insteadOf.map((w) => w.trim().slice(0, 100)).filter(Boolean).slice(0, 8), ...(v.why.trim() ? { why: v.why.trim().slice(0, 200) } : {}) })),
        formatting: { headlineCase: voice.formatting.headlineCase, punctuation: voice.formatting.punctuation.slice(0, 240), numbers: voice.formatting.numbers.slice(0, 240), cta: voice.formatting.cta.slice(0, 240) },
        confidence: "inferred",
        evidence: voiceEvidence.slice(0, 6),
      }
    : null;

  const imagery = synthesis.imagery.direction.trim()
    ? {
        direction: synthesis.imagery.direction.trim().slice(0, 500),
        subjects: synthesis.imagery.subjects.map((s) => s.trim().slice(0, 160)).filter(Boolean).slice(0, 8),
        light: synthesis.imagery.light.trim().slice(0, 240),
        palette: synthesis.imagery.palette
          .map((value) => byId.get(value)?.hex ?? normalizeColor(value)?.slice(0, 7) ?? null)
          .filter((v): v is string => Boolean(v))
          .slice(0, 8),
        avoid: synthesis.imagery.avoid.map((s) => s.trim().slice(0, 160)).filter(Boolean).slice(0, 8),
        confidence: "inferred" as const,
        evidence: [
          ...(input.inventory?.images.length ? [{ kind: "page" as const, page: input.inventory.pages[0] ?? "/", note: `${input.inventory.images.length} images in the site's content` }] : []),
          ...input.sources.filter((s) => s.reading?.imagery.length).map((s) => sourceEvidence(s.source, s.reading!.imagery[0]!.page)),
        ],
      }
    : null;

  const brand: SiteBrandFile = {
    version: 1,
    name: input.siteName,
    updatedAt: input.now().toISOString(),
    colors,
    contrast: contrastPairs(colors, measured),
    typography: { fonts, scale },
    spacing: steps("space", measured?.spacing ?? []),
    radius: steps("radius", measured?.radii ?? []),
    shadows: steps("shadow", measured?.shadows ?? []),
    logos,
    imagery,
    components,
    voice: brandVoice,
    layout: { do: synthesis.layout.do.map((s) => s.trim().slice(0, 240)).filter(Boolean).slice(0, 10), dont: synthesis.layout.dont.map((s) => s.trim().slice(0, 240)).filter(Boolean).slice(0, 10) },
    ...(input.declared?.tokensFile ? { tokensFile: input.declared.tokensFile } : {}),
  };
  const findings = [
    ...measuredFindings(measured, colors),
    ...disagreements,
    ...input.sources
      .filter((s) => s.reading?.instructionsSeen)
      .map((s): BrandFinding => ({ id: `instructions-${s.source.id}`, kind: "note", text: `${s.source.name} contains text addressed to an assistant. It was read as part of the document and not followed.` })),
    ...synthesis.flags.slice(0, 8).map((text, index): BrandFinding => ({ id: `flag-${index + 1}`, kind: "issue", text: text.trim().slice(0, 300) })),
  ].filter((f) => f.text);

  return {
    id: `${input.now().getTime().toString(36)}`,
    createdAt: input.now().toISOString(),
    from: input.from,
    brand,
    questions,
    findings,
    pendingSources: [],
    cost: input.cost,
    model: input.model,
  };
}

/** Recomputes what follows from the colours after an edit. */
export function refresh(brand: SiteBrandFile, measured: MergedMeasurements | null = null): SiteBrandFile {
  const colors = brand.colors.map((c) => ({ ...c, value: (normalizeColor(c.value) ?? c.value).slice(0, c.value.length > 7 ? 9 : 7) }));
  const previous = new Map(brand.contrast.map((p) => [`${p.text}|${p.background}`, p.measuredOn]));
  const contrast = contrastPairs(colors, measured).map((pair) => {
    const seen = previous.get(`${pair.text}|${pair.background}`);

    return seen && !pair.measuredOn ? { ...pair, measuredOn: seen } : pair;
  });

  return { ...brand, colors, contrast };
}

export function isColor(value: string): boolean {
  return parseColor(value) !== null;
}
