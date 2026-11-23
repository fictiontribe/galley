/**
 * guide.md — written from the brand, for people and for the assistant: the
 * voice with real examples, the words to use and avoid, formatting rules,
 * and do/don't for layout and imagery. Short and concrete.
 *
 * And the digest: the compact block the assistant gets in its instructions
 * (the guide plus the colours, fonts, sizes and sections by name).
 */
import { PRODUCT } from "../brand";
import { roleWords } from "./proposal";
import type { ContrastPair, SiteBrandFile } from "./types";

const CASE: Record<string, string> = {
  sentence: "Sentence case: only the first word and names take a capital.",
  title: "Title Case: the main words take capitals.",
  upper: "Upper case, set in type (write them in sentence case in the source).",
  mixed: "Case varies across the site; no single rule is followed.",
};

export function renderGuide(brand: SiteBrandFile): string {
  const lines: string[] = [`# ${brand.name} — brand guide`, ""];
  const voice = brand.voice;

  lines.push(`Kept by ${PRODUCT.name} with the brand in \`brand.json\`. Change it on the Brand screen, or edit this file by hand — the assistant reads it before every change.`, "");
  if (voice) {
    lines.push("## Voice", "", voice.summary, "");
    if (voice.tone.length) lines.push(`**Tone:** ${voice.tone.join(", ")}.`, "");
    for (const rule of voice.rules) {
      lines.push(`- **${rule.rule}**`);
      if (rule.quote) lines.push(`  - On the site: “${rule.quote.text}” (${rule.quote.where})`);
      if (rule.before && rule.after) lines.push(`  - Instead of “${rule.before}”, write “${rule.after}”`);
      else if (rule.after) lines.push(`  - For example: “${rule.after}”`);
    }
    if (voice.rules.length) lines.push("");
    if (voice.vocabulary.length) {
      lines.push("## Words", "", "| Say | Not |", "| --- | --- |");
      for (const word of voice.vocabulary) lines.push(`| ${word.say} | ${word.insteadOf.join(", ")}${word.why ? ` — ${word.why}` : ""} |`);
      lines.push("");
    }
    lines.push("## Formatting", "");
    lines.push(`- **Headlines:** ${CASE[voice.formatting.headlineCase] ?? voice.formatting.headlineCase}`);
    if (voice.formatting.punctuation) lines.push(`- **Punctuation:** ${voice.formatting.punctuation}`);
    if (voice.formatting.numbers) lines.push(`- **Numbers:** ${voice.formatting.numbers}`);
    if (voice.formatting.cta) lines.push(`- **Buttons and links:** ${voice.formatting.cta}`);
    lines.push("");
  }
  if (brand.layout.do.length || brand.layout.dont.length) {
    lines.push("## Layout", "");
    for (const item of brand.layout.do) lines.push(`- Do: ${item}`);
    for (const item of brand.layout.dont) lines.push(`- Don't: ${item}`);
    lines.push("");
  }
  if (brand.imagery) {
    lines.push("## Imagery", "", brand.imagery.direction, "");
    if (brand.imagery.subjects.length) lines.push(`- **Subjects:** ${brand.imagery.subjects.join("; ")}`);
    if (brand.imagery.light) lines.push(`- **Light:** ${brand.imagery.light}`);
    if (brand.imagery.palette.length) lines.push(`- **Palette:** ${brand.imagery.palette.join(", ")}`);
    for (const item of brand.imagery.avoid) lines.push(`- Don't: ${item}`);
    lines.push("");
  }
  const logos = brand.logos.filter((l) => !l.doNotUse);
  const retired = brand.logos.filter((l) => l.doNotUse);

  if (brand.logos.length) {
    lines.push("## Logo", "");
    for (const logo of logos) lines.push(`- ${logo.variant} (${logo.file}) on ${logo.background === "any" ? "any ground" : `${logo.background} grounds`}${logo.clearSpace ? `; clear space: ${logo.clearSpace}` : ""}${logo.minSize ? `; smallest: ${logo.minSize}` : ""}${logo.notes ? ` — ${logo.notes}` : ""}`);
    for (const logo of retired) lines.push(`- Don't use ${logo.file}${logo.notes ? ` (${logo.notes})` : ""}.`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const DIGEST_CHARS = 7_000;

function contrastLine(pair: ContrastPair, brand: SiteBrandFile): string | null {
  const text = brand.colors.find((c) => c.id === pair.text);
  const ground = brand.colors.find((c) => c.id === pair.background);

  return text && ground ? `${roleWords(text.role)} on ${roleWords(ground.role)} ${pair.ratio}:1` : null;
}

/** What the assistant is told about the brand. Deterministic: same brand, same bytes. */
export function brandDigest(brand: SiteBrandFile, guide: string | null): string {
  const lines: string[] = ["The site's brand (galley/brand). Work inside it: use these colours, fonts and sections; don't invent new ones."];
  const token = (value?: string) => (value ? ` var(${value})` : "");

  lines.push("", "Colours:");
  for (const color of brand.colors) lines.push(`- ${roleWords(color.role)}: ${color.name} ${color.value}${token(color.token)}${color.usage ? ` — ${color.usage}` : ""}`);
  const failing = brand.contrast.filter((p) => p.result === "fail").map((p) => contrastLine(p, brand)).filter(Boolean);

  if (failing.length) lines.push(`Too faint to read (don't use for text): ${failing.join("; ")}.`);
  if (brand.typography.fonts.length) {
    lines.push("", "Fonts:");
    for (const font of brand.typography.fonts) lines.push(`- ${font.role}: ${font.family}${token(font.token)}`);
  }
  if (brand.typography.scale.length) {
    lines.push("Sizes: " + brand.typography.scale.map((s) => `${s.role} ${s.size}/${s.lineHeight} ${s.weight}`).join(" · "));
  }
  if (brand.tokensFile) {
    lines.push(
      "",
      `In build mode: every colour, font and size is a custom property in ${brand.tokensFile}. Use them by name (var(--…)) in components; never write a colour value or a font name anywhere else, and add a new property there only when the person asks for a new value.`
    );
  }
  if (brand.components.length) {
    lines.push("", "Sections (use these; model a new one on an existing one of the same type):");
    for (const c of brand.components.slice(0, 40)) lines.push(`- ${c.type}${c.whenToUse ? ` — ${c.whenToUse}` : ""}`);
  }
  if (brand.imagery) lines.push("", `Imagery: ${brand.imagery.direction}${brand.imagery.avoid.length ? ` Avoid: ${brand.imagery.avoid.join("; ")}.` : ""}`);
  let digest = lines.join("\n");

  if (guide?.trim()) digest += `\n\nThe brand guide:\n\n${guide.trim()}`;
  return digest.length > DIGEST_CHARS ? `${digest.slice(0, DIGEST_CHARS)}\n\n[The rest of the guide is in galley/brand/guide.md.]` : digest;
}

/** The imagery direction as a brief for image generation. */
export function imageryBrief(brand: SiteBrandFile): string | null {
  const imagery = brand.imagery;

  if (!imagery) return null;
  const parts = [imagery.direction];

  if (imagery.subjects.length) parts.push(`Subjects: ${imagery.subjects.join(", ")}.`);
  if (imagery.light) parts.push(`Light: ${imagery.light}.`);
  if (imagery.palette.length) parts.push(`Palette: ${imagery.palette.join(", ")}.`);
  if (imagery.avoid.length) parts.push(`Avoid: ${imagery.avoid.join(", ")}.`);
  return parts.join(" ").replace(/\.\./g, ".").slice(0, 800);
}
