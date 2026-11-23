/**
 * Brand check and drift — read-only, never blocking.
 *
 * Check: the pending changes against the brand — a colour or font that
 * isn't the brand's, a contrast pair that fails, copy that uses a word the
 * guide says not to — each as a plain suggestion with the place.
 *
 * Drift: the site re-measured against the brand — colours and fonts on the
 * pages the brand doesn't know, and brand values nothing uses.
 */
import { contrastRatio, deltaE, normalizeColor } from "./color";
import { scanDeclared, splitFamilies } from "./declared";
import type { MergedMeasurements } from "./measured";
import { roleWords } from "./proposal";
import type { BrandCheckItem, DriftReport, SiteBrandFile } from "./types";

const COLOR_LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)/g;
const CODE = /\.(css|scss|sass|less|pcss|astro|vue|svelte|jsx|tsx|html)$/i;
const CONTENT = /\.(md|mdx|markdown|json|ya?ml|toml|txt)$/i;
const fontKey = (family: string) => family.toLowerCase().replace(/\s+variable$/, "").replace(/[^a-z0-9]/g, "");
const GENERIC = /^(serif|sans-serif|monospace|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont|inherit|initial|unset|cursive|emoji)$/i;

export interface ChangedFile {
  path: string;
  /** The new text (null when deleted or binary). */
  after: string | null;
  /** Lines added, with their numbers in the new file. */
  added: Array<{ line: number; text: string }>;
}

export function checkChanges(brand: SiteBrandFile, files: ChangedFile[], options: { brandDir: string }): BrandCheckItem[] {
  const items: BrandCheckItem[] = [];
  const known = brand.colors.map((c) => c.value);
  const families = new Set(brand.typography.fonts.flatMap((f) => [fontKey(f.family), ...f.fallbacks.map(fontKey)]));
  const words = (brand.voice?.vocabulary ?? []).flatMap((v) => v.insteadOf.map((not) => ({ not, say: v.say })));

  for (const file of files) {
    if (file.path.startsWith(`${options.brandDir}/`)) continue;
    if (CODE.test(file.path)) {
      for (const { line, text } of file.added) {
        for (const match of text.matchAll(COLOR_LITERAL)) {
          if (/color-mix\(\s*in\s+$/i.test(text.slice(0, match.index))) continue;
          const hex = normalizeColor(match[0]);

          if (!hex || hex.length > 7 || known.some((k) => deltaE(k, hex) < 2.5)) continue;
          items.push({ kind: "colour", text: `${hex} isn't one of the brand's colours.${brand.tokensFile ? ` Use one of the properties in ${brand.tokensFile}.` : ""}`, path: file.path, line, value: hex });
        }
        const declared = /(?:font-family|--font[\w-]*)\s*:\s*([^;{}]+)/i.exec(text);

        if (declared && families.size) {
          const first = splitFamilies(declared[1]!)[0];

          if (first && !/var\(/.test(first) && !GENERIC.test(first) && !families.has(fontKey(first))) items.push({ kind: "font", text: `“${first}” isn't one of the brand's fonts.`, path: file.path, line, value: first });
        }
      }
      // The tokens file changed: do the brand's pairs still read?
      if (brand.tokensFile === file.path && file.after) {
        const scan = scanDeclared([{ path: file.path, content: file.after }], () => null, { tokensFile: file.path });
        const now = (token?: string) => (token ? normalizeColor(scan.variables.find((v) => v.name === token)?.resolved ?? "") : null);

        for (const pair of brand.contrast) {
          const text = brand.colors.find((c) => c.id === pair.text);
          const ground = brand.colors.find((c) => c.id === pair.background);

          if (!text || !ground) continue;
          const fg = now(text.token) ?? text.value;
          const bg = now(ground.token) ?? ground.value;
          const ratio = contrastRatio(fg, bg);

          if (ratio < 4.5 && pair.ratio >= 4.5) items.push({ kind: "contrast", text: `${roleWords(text.role).replace(/^./, (c) => c.toUpperCase())} on the ${roleWords(ground.role)} is now ${ratio.toFixed(1)}:1, which is hard to read.`, path: file.path });
        }
      }
    }
    if (CONTENT.test(file.path) && words.length) {
      for (const { line, text } of file.added) {
        for (const word of words) {
          const pattern = new RegExp(`(^|[^\\p{L}])(${word.not.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[^\\p{L}])`, "iu");
          const found = pattern.exec(text);

          if (found) items.push({ kind: "words", text: `“${found[2]}” — the brand guide says “${word.say}”.`, path: file.path, line, value: found[2]! });
        }
      }
    }
    if (items.length >= 60) break;
  }
  return items.slice(0, 60);
}

/** `referenced`: custom properties the site's styles use with var(); a brand value used only there (a border) still counts as used. */
export function drift(brand: SiteBrandFile, measured: MergedMeasurements, now: Date, referenced: Set<string> = new Set()): DriftReport {
  const totalText = measured.colors.reduce((sum, c) => sum + c.textArea, 0) || 1;
  const totalGround = measured.colors.reduce((sum, c) => sum + c.groundArea, 0) || 1;
  const unknown: DriftReport["unknown"] = [];
  let matching = 0;

  for (const use of measured.colors) {
    const share = Math.max(use.textArea / totalText, use.groundArea / totalGround);

    if (share < 0.005 && use.button === 0 && use.link < 3) continue;
    if (brand.colors.some((c) => deltaE(c.value, use.hex) < 2)) {
      matching += 1;
      continue;
    }
    unknown.push({ kind: "colour", value: use.hex, where: [...use.pages].slice(0, 6), area: Math.round(share * 1000) / 10 });
  }
  const families = new Set(brand.typography.fonts.map((f) => fontKey(f.family)));
  const seenFamilies = new Map<string, Set<string>>();

  for (const style of measured.type) {
    const set = seenFamilies.get(style.family) ?? new Set();

    for (const page of style.pages) set.add(page);
    seenFamilies.set(style.family, set);
  }
  for (const [family, pages] of seenFamilies) {
    if (families.has(fontKey(family))) matching += 1;
    else unknown.push({ kind: "font", value: family, where: [...pages].slice(0, 6) });
  }
  const unused: DriftReport["unused"] = [];

  for (const color of brand.colors) {
    if (color.token && referenced.has(color.token)) continue;
    if (!measured.colors.some((use) => deltaE(use.hex, color.value) < 2)) unused.push({ kind: "colour", value: color.value, name: color.name });
  }
  for (const font of brand.typography.fonts) {
    if (![...seenFamilies.keys()].some((family) => fontKey(family) === fontKey(font.family))) unused.push({ kind: "font", value: font.family, name: font.role });
  }
  return { checkedAt: now.toISOString(), pages: measured.pages, unknown: unknown.sort((a, b) => (b.area ?? 0) - (a.area ?? 0)).slice(0, 30), unused, matching };
}
