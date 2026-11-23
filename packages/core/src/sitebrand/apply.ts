/**
 * "Apply to the site": the brand's colours and fonts written into the site's
 * tokens file, as surgical edits — each value replaced at its own byte range,
 * in the notation the file already uses, nothing else touched.
 *
 * Which property gets which value: the brand colour's own token when the file
 * has it, otherwise the one property whose name says that role. A role with
 * no property, or with several candidates, is listed rather than guessed.
 */
import { contrastRatio, formatLike, normalizeColor } from "./color";
import { scanDeclared, splitFamilies, type DeclaredVar } from "./declared";
import { fontRoleFromName, roleFromName, roleWords } from "./proposal";
import type { ApplyPlan, SiteBrandFile, TokenEdit } from "./types";

export interface ApplyResult {
  plan: ApplyPlan;
  /** The file's new text. Unchanged when there are no edits. */
  content: string;
}

const quoted = (family: string, like: string) => (/^["']/.test(like.trim()) ? `${like.trim()[0]}${family}${like.trim()[0]}` : /\s/.test(family) ? `"${family}"` : family);

/** The installed families: what @font-face rules and font packages provide. */
export function planApply(brand: SiteBrandFile, file: string, content: string, installed: Set<string>): ApplyResult {
  const scan = scanDeclared([{ path: file, content }], () => null, { tokensFile: file });
  const root = scan.variables.filter((v) => v.file === file && /^(:root|@theme|html)/.test(v.context));
  const edits: Array<TokenEdit & { start: number; end: number }> = [];
  const notes: string[] = [];
  const usedTokens = new Set<string>();
  const after = new Map<string, string>();

  for (const variable of root) after.set(variable.name, variable.resolved);
  const pickFor = (role: string, matches: (v: DeclaredVar) => boolean, own?: string): DeclaredVar | "many" | null => {
    const mine = own ? root.find((v) => v.name === own) : undefined;

    if (mine) return mine;
    const found = root.filter((v) => matches(v) && !usedTokens.has(v.name));

    if (found.length === 1) return found[0]!;
    // Several: the plainest name (fewest parts) when exactly one is plainest; otherwise ask.
    const plainest = found.filter((v) => v.name.split("-").length === Math.min(...found.map((f) => f.name.split("-").length)));

    return plainest.length === 1 ? plainest[0]! : found.length ? "many" : null;
  };

  for (const color of brand.colors) {
    if (color.role === "other") continue;
    const target = pickFor(color.role, (v) => v.kind === "color" && roleFromName(v.name) === color.role, color.token);
    const label = roleWords(color.role).replace(/^./, (c) => c.toUpperCase());

    if (target === null) {
      notes.push(`${label} (${color.value}): the file has no property for it, so it wasn't added.`);
      continue;
    }
    if (target === "many") {
      notes.push(`${label} (${color.value}): more than one property could hold it, so none was changed.`);
      continue;
    }
    usedTokens.add(target.name);
    after.set(target.name, color.value);
    if (normalizeColor(target.resolved) === color.value.toUpperCase()) continue;
    if (/var\(/.test(target.raw)) {
      notes.push(`${target.name} takes its value from another property, so it was left as it is.`);
      continue;
    }
    edits.push({ token: target.name, line: target.line, before: target.raw, after: formatLike(color.value, target.raw), label, start: target.start, end: target.end });
  }
  for (const font of brand.typography.fonts) {
    if (font.role === "other") continue;
    const target = pickFor(font.role, (v) => v.kind === "font" && fontRoleFromName(v.name) === font.role, font.token);
    const label = `${font.role === "display" ? "Headings" : font.role === "body" ? "Body text" : "Code"} font`;

    if (target === null || target === "many") {
      notes.push(`${label} (${font.family}): ${target === null ? "the file has no property for it" : "more than one property could hold it"}, so it wasn't changed.`);
      continue;
    }
    usedTokens.add(target.name);
    const families = splitFamilies(target.raw);

    // "Newsreader Variable" is the variable build of "Newsreader": the same typeface, already in place.
    const same = (a?: string, b?: string) => (a ?? "").toLowerCase().replace(/\s+variable$/, "") === (b ?? "").toLowerCase().replace(/\s+variable$/, "");

    if (same(families[0], font.family)) continue;
    const firstPart = target.raw.split(",")[0] ?? "";
    const rest = target.raw.slice(firstPart.length);
    const next = `${quoted(font.family, firstPart)}${rest}`;

    edits.push({ token: target.name, line: target.line, before: target.raw, after: next, label, start: target.start, end: target.end });
    const installedHere = [...installed].some((family) => family.toLowerCase().replace(/\s+variable$/, "") === font.family.toLowerCase().replace(/\s+variable$/, ""));

    if (!installedHere) {
      notes.push(`${font.family} isn't installed in this site, so pages show the next font in the list (${families.slice(1, 3).join(", ") || "the browser's default"}) until it is — for example by adding @fontsource-variable/${font.family.toLowerCase().replace(/\s+variable$/, "").replace(/\s+/g, "-")}.`);
    }
  }
  // Properties that follow the accent but have no brand value of their own.
  if (edits.some((e) => e.label === "Accent")) {
    const followers = root.filter((v) => v.kind === "color" && /accent/.test(v.name) && !usedTokens.has(v.name)).map((v) => v.name);

    if (followers.length) notes.push(`Left as they were (the brand has no value for them): ${followers.join(", ")}.`);
  }
  // Contrast after the change, for the pairs the file's own names describe.
  const warnings: string[] = [];
  const valueOf = (role: string) => {
    const name = root.find((v) => v.kind === "color" && roleFromName(v.name) === role)?.name;

    return name ? (normalizeColor(after.get(name) ?? "") ?? null) : null;
  };
  for (const [text, ground] of [
    ["text", "background"],
    ["text-muted", "background"],
    ["text", "surface"],
    ["text-muted", "surface-muted"],
    ["accent-text", "accent"],
    ["accent", "background"],
  ] as const) {
    const fg = valueOf(text);
    const bg = valueOf(ground);

    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);

    if (ratio < (text === "accent" ? 3 : 4.5)) warnings.push(`${roleWords(text).replace(/^./, (c) => c.toUpperCase())} on the ${roleWords(ground)} would be ${ratio.toFixed(1)}:1, which is hard to read.`);
  }
  let next = content;

  for (const edit of [...edits].sort((a, b) => b.start - a.start)) next = `${next.slice(0, edit.start)}${edit.after}${next.slice(edit.end)}`;
  return {
    plan: { file, edits: edits.map(({ start: _start, end: _end, ...edit }) => edit).sort((a, b) => a.line - b.line), notes, warnings },
    content: next,
  };
}
