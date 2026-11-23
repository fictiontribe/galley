/**
 * The strict schemas: the brand file (read from the site, imported, or sent
 * back edited by the app) and the three shapes the model may answer with.
 *
 * Model answers are data, never instructions: each call has no tools, asks
 * for exactly one of these shapes through structured outputs, and its answer
 * is parsed again here — an extra key, a wrong type or a missing field fails
 * the whole answer, and nothing is kept from it.
 */
import { z } from "zod";
import { PRODUCT, SITE_URL } from "../brand";
import { COLOR_ROLES, type ColorRole, type SiteBrandFile } from "./types";

const roleEnum = z.enum(COLOR_ROLES as [ColorRole, ...ColorRole[]]);
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/, "must be a colour like #1A1712");
const confidence = z.enum(["measured", "declared", "inferred"]);
const evidence = z
  .object({
    kind: z.enum(["file", "page", "source", "website"]),
    file: z.string().max(500).optional(),
    line: z.number().int().min(0).optional(),
    page: z.string().max(500).optional(),
    element: z.string().max(200).optional(),
    source: z.string().max(80).optional(),
    sourceName: z.string().max(300).optional(),
    sourcePage: z.number().int().min(0).optional(),
    url: z.string().max(2000).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();
const sourced = { confidence, evidence: z.array(evidence).max(40) };
const text = (max: number) => z.string().max(max);
const id = z.string().min(1).max(80);

const scaleStep = z.object({ id, name: text(120), value: text(400), token: text(120).optional(), uses: z.number().int().min(0).optional(), ...sourced }).strict();

export const siteBrandFileSchema = z
  .object({
    $schema: z.string().max(300).optional(),
    version: z.literal(1),
    name: text(200),
    updatedAt: text(40),
    colors: z
      .array(z.object({ id, role: roleEnum, name: text(120), value: hex, token: text(120).optional(), usage: text(300).optional(), ...sourced }).strict())
      .max(80),
    contrast: z
      .array(z.object({ text: id, background: id, ratio: z.number().min(0).max(21), result: z.enum(["aaa", "aa", "large", "fail"]), measuredOn: z.array(text(500)).max(40).optional() }).strict())
      .max(200),
    typography: z
      .object({
        fonts: z
          .array(
            z
              .object({
                id,
                role: z.enum(["display", "body", "mono", "other"]),
                family: text(120),
                fallbacks: z.array(text(120)).max(12),
                source: z.object({ kind: z.enum(["package", "file", "embedded", "system", "unknown"]), ref: text(300).optional() }).strict(),
                weights: z.array(z.number().int().min(1).max(1000)).max(20),
                token: text(120).optional(),
                ...sourced,
              })
              .strict()
          )
          .max(12),
        scale: z
          .array(
            z
              .object({
                id,
                role: z.enum(["h1", "h2", "h3", "h4", "h5", "h6", "lead", "body", "small", "button", "label", "link"]),
                font: id,
                size: text(200),
                px: z.number().min(0).max(1000).optional(),
                weight: z.number().int().min(1).max(1000),
                lineHeight: text(60),
                letterSpacing: text(60).optional(),
                token: text(120).optional(),
                ...sourced,
              })
              .strict()
          )
          .max(24),
      })
      .strict(),
    spacing: z.array(scaleStep).max(40),
    radius: z.array(scaleStep).max(20),
    shadows: z.array(scaleStep).max(20),
    logos: z
      .array(
        z
          .object({
            id,
            file: text(500),
            format: z.enum(["svg", "png", "jpg", "webp", "gif", "other"]),
            variant: z.enum(["primary", "reverse", "mono", "mark", "wordmark", "other"]),
            background: z.enum(["light", "dark", "any"]),
            colors: z.array(hex).max(12),
            viewBox: text(80).optional(),
            clearSpace: text(200).optional(),
            minSize: text(200).optional(),
            notes: text(500).optional(),
            doNotUse: z.boolean().optional(),
            ...sourced,
          })
          .strict()
      )
      .max(20),
    imagery: z
      .object({ direction: text(600), subjects: z.array(text(200)).max(12), light: text(300), palette: z.array(hex).max(12), avoid: z.array(text(200)).max(12), ...sourced })
      .strict()
      .nullable(),
    components: z
      .array(
        z
          .object({
            type: text(120),
            label: text(120),
            whenToUse: text(400),
            usedOn: z.array(text(500)).max(60),
            count: z.number().int().min(0),
            file: text(500).optional(),
            thumbnail: text(500).optional(),
            ...sourced,
          })
          .strict()
      )
      .max(80),
    voice: z
      .object({
        summary: text(800),
        tone: z.array(text(80)).max(10),
        rules: z
          .array(
            z
              .object({
                rule: text(400),
                quote: z.object({ text: text(400), where: text(300) }).strict().optional(),
                before: text(400).optional(),
                after: text(400).optional(),
              })
              .strict()
          )
          .max(20),
        vocabulary: z.array(z.object({ say: text(120), insteadOf: z.array(text(120)).max(10), why: text(300).optional() }).strict()).max(40),
        formatting: z.object({ headlineCase: z.enum(["sentence", "title", "upper", "mixed"]), punctuation: text(300), numbers: text(300), cta: text(300) }).strict(),
        ...sourced,
      })
      .strict()
      .nullable(),
    layout: z.object({ do: z.array(text(300)).max(20), dont: z.array(text(300)).max(20) }).strict(),
    tokensFile: text(500).optional(),
  })
  .strict();

export function parseBrandFile(value: unknown): { ok: true; brand: SiteBrandFile } | { ok: false; problem: string } {
  const result = siteBrandFileSchema.safeParse(value);

  if (result.success) return { ok: true, brand: result.data as SiteBrandFile };
  const issue = result.error.issues[0];

  return { ok: false, problem: issue ? `${issue.path.join(".") || "the file"}: ${issue.message}` : "it couldn't be read" };
}

// ─────────────────────────────────────────────────────────────── model answers
//
// Structured outputs don't take length or number limits (the SDK strips them
// from what it sends), so these schemas carry structure only; lengths are cut
// after parsing. Empty strings and 0 stand for "not known", so every field is
// required and the model can't leave a key out.

const pageNumber = z.number().int();

/** One uploaded file read on its own: what it says about the brand. */
export const readingSchema = z
  .object({
    summary: z.string(),
    colors: z.array(z.object({ hex: z.string(), name: z.string(), role: z.enum(["unknown", ...COLOR_ROLES] as [string, ...string[]]), page: pageNumber, how: z.enum(["stated", "seen"]) }).strict()),
    fonts: z.array(z.object({ family: z.string(), role: z.enum(["display", "body", "mono", "other", "unknown"]), page: pageNumber, how: z.enum(["stated", "seen"]) }).strict()),
    logo: z.array(z.object({ rule: z.string(), page: pageNumber }).strict()),
    voice: z.array(z.object({ rule: z.string(), example: z.string(), page: pageNumber }).strict()),
    vocabulary: z.array(z.object({ say: z.string(), insteadOf: z.array(z.string()), page: pageNumber }).strict()),
    imagery: z.array(z.object({ rule: z.string(), page: pageNumber }).strict()),
    layout: z.array(z.object({ rule: z.string(), page: pageNumber }).strict()),
    instructionsSeen: z.boolean(),
  })
  .strict();

export type Reading = z.infer<typeof readingSchema>;

/**
 * Everything gathered, put together: roles for the candidates, the voice, the guide's rules.
 *
 * What goes over the wire uses plain strings where the answer is one of a
 * list (roles, variants): a schema with every list spelled out compiles to a
 * grammar too large for the API. The answer is still checked strictly here,
 * and anything outside the lists is dropped by `normalizeSynthesis`.
 */
export const synthesisSchema = z
  .object({
    colors: z.array(z.object({ candidate: z.string(), role: z.string(), name: z.string(), usage: z.string() }).strict()),
    fonts: z.array(z.object({ candidate: z.string(), role: z.string() }).strict()),
    voice: z
      .object({
        summary: z.string(),
        tone: z.array(z.string()),
        rules: z.array(z.object({ rule: z.string(), quote: z.string(), where: z.string(), before: z.string(), after: z.string() }).strict()),
        vocabulary: z.array(z.object({ say: z.string(), insteadOf: z.array(z.string()), why: z.string() }).strict()),
        formatting: z.object({ headlineCase: z.string(), punctuation: z.string(), numbers: z.string(), cta: z.string() }).strict(),
      })
      .strict(),
    layout: z.object({ do: z.array(z.string()), dont: z.array(z.string()) }).strict(),
    imagery: z.object({ direction: z.string(), subjects: z.array(z.string()), light: z.string(), palette: z.array(z.string()), avoid: z.array(z.string()) }).strict(),
    components: z.array(z.object({ type: z.string(), whenToUse: z.string() }).strict()),
    logos: z.array(z.object({ candidate: z.string(), variant: z.string(), background: z.string(), clearSpace: z.string(), minSize: z.string(), notes: z.string() }).strict()),
    flags: z.array(z.string()),
    questions: z.array(z.object({ text: z.string(), target: z.string(), options: z.array(z.string()) }).strict()),
  })
  .strict();

type WireSynthesis = z.infer<typeof synthesisSchema>;
type LogoVariant = "primary" | "reverse" | "mono" | "mark" | "wordmark" | "other";

export interface Synthesis extends Omit<WireSynthesis, "colors" | "fonts" | "voice" | "logos"> {
  colors: Array<{ candidate: string; role: ColorRole; name: string; usage: string }>;
  fonts: Array<{ candidate: string; role: "display" | "body" | "mono" | "other" }>;
  voice: Omit<WireSynthesis["voice"], "formatting"> & { formatting: { headlineCase: "sentence" | "title" | "upper" | "mixed"; punctuation: string; numbers: string; cta: string } };
  logos: Array<{ candidate: string; variant: LogoVariant; background: "light" | "dark" | "any"; clearSpace: string; minSize: string; notes: string }>;
}

const oneOf = <T extends string>(list: readonly T[], value: string): T | null => {
  const clean = value.trim().toLowerCase() as T;

  return list.includes(clean) ? clean : null;
};

/** The answer with every listed value checked: unknown roles and variants are left out, never guessed into place. */
export function normalizeSynthesis(wire: WireSynthesis): Synthesis {
  return {
    ...wire,
    colors: wire.colors.flatMap((c) => {
      const role = oneOf(COLOR_ROLES, c.role);

      return role ? [{ ...c, role }] : [];
    }),
    fonts: wire.fonts.flatMap((f) => {
      const role = oneOf(["display", "body", "mono", "other"] as const, f.role);

      return role ? [{ ...f, role }] : [];
    }),
    voice: { ...wire.voice, formatting: { ...wire.voice.formatting, headlineCase: oneOf(["sentence", "title", "upper", "mixed"] as const, wire.voice.formatting.headlineCase) ?? "mixed" } },
    logos: wire.logos.flatMap((l) => {
      const variant = oneOf(["primary", "reverse", "mono", "mark", "wordmark", "other"] as const, l.variant);
      const background = oneOf(["light", "dark", "any"] as const, l.background) ?? "any";

      return variant ? [{ ...l, variant, background }] : [];
    }),
  };
}

/** A change asked for in words ("make the accent warmer"): edits to the proposal, and one sentence back. */
export const revisionSchema = z
  .object({
    changes: z.array(
      z
        .object({
          target: z.enum(["color.value", "color.name", "color.role", "font.family", "voice.summary", "voice.tone", "imagery.direction", "layout.do", "layout.dont", "vocabulary.add"]),
          /** The colour or font id the change is about; "" for the others. */
          id: z.string(),
          value: z.string(),
        })
        .strict()
    ),
    reply: z.string(),
  })
  .strict();

export type Revision = z.infer<typeof revisionSchema>;

export { hex as hexSchema };

/**
 * The JSON Schema of brand.json, for editors (the file names it in its
 * `$schema`). `galley schema --out` writes it beside the config's schema so
 * the docs site can serve both.
 */
/** Kept here rather than imported from files.ts, which imports this module. */
const BRAND_SCHEMA_ID = () => `${SITE_URL}/schema/brand.json`;

export function brandJsonSchema(): object {
  const schema = z.toJSONSchema(siteBrandFileSchema, { unrepresentable: "any", io: "input" }) as Record<string, unknown>;
  const properties = (schema.properties ?? {}) as Record<string, unknown>;

  // A brand file names its own schema; the strict object would otherwise refuse that key.
  return { ...schema, properties: { $schema: { type: "string" }, ...properties }, $id: BRAND_SCHEMA_ID(), title: `${PRODUCT.name} brand file`, description: "A site's brand: colours, fonts, type and spacing scales, logo rules, imagery direction, section types and the voice guide (galley/brand/brand.json)." };
}
