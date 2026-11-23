/**
 * The brand as one file, two ways:
 *
 * - The bundle (`<site>.brand.json`): brand.json, guide.md and the sources
 *   manifest together, so an agency can carry a client's brand to another
 *   site. Importing one makes a proposal to review — it never writes.
 * - Design tokens (`<site>.tokens.json`), in the W3C Design Tokens
 *   Community Group format, 2025.10 — the first stable version
 *   (https://www.designtokens.org/TR/2025.10/format/ and
 *   https://www.designtokens.org/TR/2025.10/color/): colours as
 *   { colorSpace: "srgb", components, alpha, hex }, dimensions as
 *   { value, unit } in px or rem, fontFamily, fontWeight, shadow and
 *   typography composites. Values the format can't express (a fluid clamp())
 *   stay in $extensions, under a reverse-domain key, which tools must keep.
 */
import { SITE_URL } from "../brand";
import { GalleyError } from "../errors";
import { parseColor } from "./color";
import { parseBrandFile } from "./schema";
import type { BrandProposal, ScaleStep, SiteBrandFile, SourceManifest } from "./types";

export const BUNDLE_KIND = "site-brand-bundle";
export const DTCG_MEDIA_TYPE = "application/design-tokens+json";

export interface BrandBundle {
  kind: typeof BUNDLE_KIND;
  version: 1;
  exportedAt: string;
  brand: SiteBrandFile;
  guide: string | null;
  /** What the brand was set up from (names and what was learned; the files themselves stay with the site). */
  sources: SourceManifest;
}

export function exportBundle(brand: SiteBrandFile, guide: string | null, sources: SourceManifest, now: Date): BrandBundle {
  return { kind: BUNDLE_KIND, version: 1, exportedAt: now.toISOString(), brand, guide, sources };
}

export function readBundle(value: unknown): { brand: SiteBrandFile; guide: string | null; sources: SourceManifest } {
  if (!value || typeof value !== "object") throw new GalleyError("invalid", "That file isn't a brand. Export one from a site's Brand screen first.");
  const raw = value as Partial<BrandBundle>;

  if (raw.kind !== BUNDLE_KIND || raw.version !== 1) throw new GalleyError("invalid", "That file isn't a brand. Export one from a site's Brand screen first.");
  const parsed = parseBrandFile(raw.brand);

  if (!parsed.ok) throw new GalleyError("invalid", `That brand file can't be used: ${parsed.problem}.`);
  const guide = typeof raw.guide === "string" ? raw.guide.slice(0, 100_000) : null;
  const sources: SourceManifest = raw.sources && raw.sources.version === 1 && Array.isArray(raw.sources.sources) ? { version: 1, sources: raw.sources.sources.slice(0, 40).map((s) => ({ ...s, stored: "outside" as const, file: undefined as never })) } : { version: 1, sources: [] };

  return { brand: parsed.brand, guide, sources };
}

/** An imported brand, as a proposal: its evidence kept, its sources listed but not present. */
export function proposalFromBundle(bundle: { brand: SiteBrandFile; guide: string | null }, siteName: string, now: Date): BrandProposal {
  return {
    id: now.getTime().toString(36),
    createdAt: now.toISOString(),
    from: "material",
    brand: { ...bundle.brand, name: siteName, updatedAt: now.toISOString(), tokensFile: undefined as never },
    questions: [],
    findings: [{ id: "imported", kind: "note", text: `Imported from another site's brand${bundle.brand.name ? ` (${bundle.brand.name})` : ""}. Check it against this site before saving.` }],
    pendingSources: [],
    cost: null,
    model: null,
  };
}

const EXTENSION_KEY = (() => {
  const host = new URL(SITE_URL).hostname.split(".").reverse().join(".");

  return `${host}.brand`;
})();

function dimension(value: string): { value: number; unit: "px" | "rem" } | null {
  const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(value.trim());

  if (match) return { value: Number(match[1]), unit: match[2] as "px" | "rem" };
  return value.trim() === "0" ? { value: 0, unit: "px" } : null;
}

function colorValue(hex: string): Record<string, unknown> | null {
  const parsed = parseColor(hex);

  if (!parsed) return null;
  const round = (n: number) => Math.round(n * 10_000) / 10_000;

  return { colorSpace: "srgb", components: [round(parsed.r), round(parsed.g), round(parsed.b)], ...(parsed.a < 1 ? { alpha: round(parsed.a) } : {}), hex: hex.slice(0, 7).toLowerCase() };
}

/** One shadow layer "0 1px 2px #000" → the composite, or null when it isn't that simple. */
function shadowLayer(text: string): Record<string, unknown> | null {
  const inset = /\binset\b/.test(text);
  const colorMatch = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))/.exec(text);
  const color = colorMatch ? colorValue(colorMatch[0]) : null;
  const lengths = text.replace(colorMatch?.[0] ?? "", "").replace(/\binset\b/, "").trim().split(/\s+/).map(dimension);

  if (!color || lengths.length < 2 || lengths.length > 4 || lengths.some((l) => l === null)) return null;
  const [offsetX, offsetY, blur = { value: 0, unit: "px" }, spread = { value: 0, unit: "px" }] = lengths as Array<{ value: number; unit: string }>;

  return { color, offsetX, offsetY, blur, spread, ...(inset ? { inset: true } : {}) };
}

function splitLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const tokenName = (text: string) => text.replace(/^--/, "").replace(/[{}.$]/g, "-").replace(/^-+|-+$/g, "") || "token";

export function exportDesignTokens(brand: SiteBrandFile): Record<string, unknown> {
  const tokens: Record<string, unknown> = { $description: `${brand.name}: colours, fonts and sizes.` };
  const color: Record<string, unknown> = { $type: "color" };

  for (const entry of brand.colors) {
    const value = colorValue(entry.value);

    if (!value) continue;
    color[tokenName(entry.id)] = {
      $value: value,
      $description: `${entry.name}${entry.usage ? ` — ${entry.usage}` : ""}`,
      $extensions: { [EXTENSION_KEY]: { role: entry.role, ...(entry.token ? { cssProperty: entry.token } : {}), confidence: entry.confidence } },
    };
  }
  tokens.color = color;
  const font: Record<string, unknown> = {};

  for (const entry of brand.typography.fonts) {
    font[tokenName(entry.id)] = { $type: "fontFamily", $value: [entry.family, ...entry.fallbacks], $extensions: { [EXTENSION_KEY]: { role: entry.role, source: entry.source, ...(entry.token ? { cssProperty: entry.token } : {}) } } };
  }
  if (Object.keys(font).length) tokens.font = font;
  const typography: Record<string, unknown> = {};

  for (const style of brand.typography.scale) {
    const size = dimension(style.size) ?? (style.px ? { value: style.px, unit: "px" as const } : null);
    const lineHeight = Number(style.lineHeight);

    if (!size || !Number.isFinite(lineHeight)) continue;
    typography[tokenName(style.id)] = {
      $type: "typography",
      $value: {
        fontFamily: `{font.${tokenName(style.font)}}`,
        fontSize: size,
        fontWeight: style.weight,
        lineHeight,
        letterSpacing: (style.letterSpacing ? dimension(style.letterSpacing) : null) ?? { value: 0, unit: "px" },
      },
    };
  }
  if (Object.keys(typography).length) tokens.typography = typography;
  const group = (steps: ScaleStep[], type: "dimension" | "shadow"): Record<string, unknown> | null => {
    const out: Record<string, unknown> = { $type: type };
    const fluid: Record<string, string> = {};

    for (const step of steps) {
      if (type === "dimension") {
        const value = dimension(step.value);

        if (value) out[tokenName(step.name)] = { $value: value };
        else fluid[tokenName(step.name)] = step.value;
      } else {
        const layers = splitLayers(step.value).map(shadowLayer);

        if (layers.length && layers.every(Boolean)) out[tokenName(step.name)] = { $value: layers.length === 1 ? layers[0] : layers };
        else fluid[tokenName(step.name)] = step.value;
      }
    }
    if (Object.keys(fluid).length) out.$extensions = { [EXTENSION_KEY]: { cssValues: fluid } };
    return Object.keys(out).length > 1 ? out : null;
  };
  const spacing = group(brand.spacing, "dimension");
  const radius = group(brand.radius, "dimension");
  const shadow = group(brand.shadows, "shadow");

  if (spacing) tokens.spacing = spacing;
  if (radius) tokens.radius = radius;
  if (shadow) tokens.shadow = shadow;
  return tokens;
}
