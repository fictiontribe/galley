/**
 * The engine's copy of the site kit's schema (src/site-kit/schema.ts) must
 * be the kit's schema (packages/astro/src/schema.js — what a site's build
 * runs) and must parse exactly the contract's types (src/kit.ts). Three
 * checks, any of which fails when one of the three changes alone:
 * - types: z.infer of each engine schema is the contract type (under tsc);
 * - structure: both schemas, walked, describe the same keys, types, enums,
 *   patterns and refinements;
 * - behaviour: on a corpus of good and broken files both accept and refuse
 *   the same files with the same issues.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type * as Kit from "../../src/kit";
import * as engine from "../../src/site-kit/schema";

// ── Types: mutually assignable, the same keys ─────────────────────────────
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Keys<A, B> = Same<keyof NonNullable<A>, keyof NonNullable<B>>;
const assert = <T extends true>(): T => true as T;

assert<Same<z.infer<typeof engine.formSchema>, Kit.FormDefinition>>();
assert<Keys<z.infer<typeof engine.formSchema>, Kit.FormDefinition>>();
assert<Same<z.infer<typeof engine.formFieldSchema>, Kit.FormField>>();
assert<Keys<z.infer<typeof engine.formFieldSchema>, Kit.FormField>>();
assert<Keys<z.infer<typeof engine.formFieldSchema>["validation"], Kit.FormField["validation"]>>();
assert<Same<z.infer<typeof engine.formDestinationSchema>, Kit.FormDestination>>();
assert<Same<z.infer<typeof engine.formActionSchema>, Kit.FormAction>>();
assert<Same<z.infer<typeof engine.scriptsSchema>, Kit.ScriptsConfig>>();
assert<Same<z.infer<typeof engine.scriptEntrySchema>, Kit.ScriptEntry>>();
assert<Keys<z.infer<typeof engine.scriptEntrySchema>, Kit.ScriptEntry>>();
assert<Same<z.infer<typeof engine.consentSettingsSchema>, Kit.ConsentSettings>>();
assert<Keys<z.infer<typeof engine.consentSettingsSchema>, Kit.ConsentSettings>>();

const KIT_SCHEMA = fileURLToPath(new URL("../../../astro/src/schema.js", import.meta.url));
// Loaded by address: the kit is plain JavaScript on Astro's zod, outside this package's types.
const kit = (await import(pathToFileURL(KIT_SCHEMA).href)) as Record<string, z.ZodType & { _zod: { def: Def } }> & { FIELD_TYPES: readonly string[] };

interface Def {
  type: string;
  [key: string]: unknown;
}

type Schema = { _zod: { def: Def } };

/** A zod schema as plain data: its kind, keys, values, patterns and refinements. Lazy schemas are named, not followed. */
function describeSchema(schema: Schema, depth = 0): unknown {
  const def = schema._zod.def;
  const checks = ((def.checks as Schema[] | undefined) ?? []).map((check) => {
    const inner = check._zod.def as Def & { check?: string; format?: string; pattern?: RegExp; value?: unknown; minimum?: unknown; inclusive?: boolean };

    return { check: inner.check, format: inner.format, pattern: inner.pattern?.source, value: inner.value ?? inner.minimum, inclusive: inner.inclusive, fn: typeof inner.fn === "function" ? "refine" : undefined };
  });
  const base = { type: def.type, ...(checks.length ? { checks } : {}) };

  if (depth > 12) return base;
  switch (def.type) {
    case "object":
      return { ...base, shape: Object.fromEntries(Object.entries(def.shape as Record<string, Schema>).map(([key, value]) => [key, describeSchema(value, depth + 1)])) };
    case "optional":
    case "nullable":
    case "default":
      return { ...base, inner: describeSchema(def.innerType as Schema, depth + 1) };
    case "array":
      return { ...base, element: describeSchema(def.element as Schema, depth + 1) };
    case "record":
      return { ...base, key: describeSchema(def.keyType as Schema, depth + 1), value: describeSchema(def.valueType as Schema, depth + 1) };
    case "union":
      return { ...base, discriminator: def.discriminator, options: (def.options as Schema[]).map((option) => describeSchema(option, depth + 1)) };
    case "enum":
      return { ...base, entries: def.entries };
    case "literal":
      return { ...base, values: def.values };
    case "pipe":
      return { ...base, in: describeSchema(def.in as Schema, depth + 1), out: describeSchema(def.out as Schema, depth + 1) };
    case "lazy":
      return { ...base, lazy: describeSchema((def.getter as () => Schema)(), depth + 4) };
    default:
      return base;
  }
}

const EXPORTS = ["formFieldSchema", "formDestinationSchema", "formActionSchema", "formSchema", "scriptEntrySchema", "consentSettingsSchema", "scriptsSchema"] as const;

describe("the engine's kit schema is the site kit's schema", () => {
  it("has the same field types", () => {
    expect([...engine.FIELD_TYPES]).toEqual([...kit.FIELD_TYPES]);
  });

  for (const name of EXPORTS) {
    it(`${name}: the same structure`, () => {
      expect(describeSchema(engine[name] as unknown as Schema)).toEqual(describeSchema(kit[name]!));
    });
  }

  const contact = {
    name: "Contact",
    submitLabel: "Send",
    fields: [
      { id: "email", type: "email", label: "Email", required: true, validation: { businessEmailOnly: true, pattern: "^.+@.+$" } },
      { id: "phone", type: "tel", label: "Phone" },
      { id: "topic", type: "select", label: "Topic", options: [{ value: "a", label: "A" }] },
      { id: "detail", type: "text", label: "Detail", showWhen: { field: "topic", equals: "a" }, step: 1 },
      { id: "source", type: "hidden", autofill: { from: "utm", key: "utm_source", touch: "first" } },
    ],
    steps: [{ title: "You" }, { title: "More" }],
    destinations: [
      { provider: "galley", settings: {} },
      { provider: "hubspot", settings: { portalId: "12345678", formId: "0f8fad5b-d9cb-469f-a165-70867728950e" }, mapping: { email: "email" }, when: { field: "topic", equals: "a" } },
    ],
    afterSubmit: [
      { type: "event", name: "lead", params: { topic: "{{topic}}" } },
      { type: "message", title: "Thanks", text: "We'll write." },
      { type: "redirect", url: "/thanks/", passFields: ["email"] },
    ],
    spam: { honeypot: true, minSeconds: 3 },
    appearance: { layout: "stacked", labels: "floating" },
  };
  const forms: Array<[string, unknown]> = [
    ["a complete form", contact],
    ["a minimal form", { name: "A", submitLabel: "Go", fields: [], destinations: [{ provider: "galley", settings: {} }], afterSubmit: [] }],
    ["two fields with one id", { ...contact, fields: [...contact.fields, { id: "email", type: "text" }] }],
    ["a choice without options", { ...contact, fields: [{ id: "pick", type: "radio", label: "Pick" }] }],
    ["a condition on a missing field", { ...contact, fields: [{ id: "x", type: "text", showWhen: { field: "ghost" } }] }],
    ["a step past the last", { ...contact, steps: undefined }],
    ["a pattern a browser can't read", { ...contact, fields: [{ id: "z", type: "text", validation: { pattern: "([" } }] }],
    ["a provider setting in the wrong shape", { ...contact, destinations: [{ provider: "marketo", settings: { munchkinId: "123", formId: "x", host: "http://x" } }] }],
    ["no destinations", { ...contact, destinations: [] }],
    ["a mapping naming a missing field", { ...contact, destinations: [{ provider: "galley", settings: {}, mapping: { ghost: "g" } }] }],
    ["a redirect passing a missing field", { ...contact, afterSubmit: [{ type: "redirect", url: "/x/", passFields: ["ghost"] }] }],
    ["an unknown field type", { ...contact, fields: [{ id: "x", type: "colour" }] }],
    ["a bad field id", { ...contact, fields: [{ id: "Work Email", type: "email" }] }],
    ["a boolean given as text", { ...contact, fields: [{ id: "x", type: "text", required: "yes" }] }],
    ["an unknown action", { ...contact, afterSubmit: [{ type: "wiggle" }] }],
    ["no name", { ...contact, name: undefined }],
  ];
  const scripts: Array<[string, unknown]> = [
    ["a complete setup", { consent: { mode: "banner", googleConsentMode: true, banner: { policyUrl: "/privacy/", categories: { analytics: { label: "Stats" } } } }, scripts: [{ id: "gtm", kind: "gtm", enabled: true, settings: { containerId: "GTM-AB12CDE3" }, load: "idle", include: ["/"] }] }],
    ["a malformed container id", { scripts: [{ id: "gtm", kind: "gtm", enabled: true, settings: { containerId: "GTM-12" } }] }],
    ["a missing id on an enabled entry", { scripts: [{ id: "ga", kind: "ga4", enabled: true, settings: {} }] }],
    ["the same id twice", { scripts: [{ id: "a", kind: "custom", enabled: true, settings: { src: "https://x.example/a.js" } }, { id: "a", kind: "custom", enabled: false, settings: {} }] }],
    ["a custom script with no source", { scripts: [{ id: "c", kind: "custom", enabled: true, settings: {} }] }],
    ["a custom attribute that sets an event handler", { scripts: [{ id: "c", kind: "custom", enabled: true, settings: { src: "https://x.example/a.js", attributes: { onload: "x()" } } }] }],
    ["an unknown consent mode", { consent: { mode: "maybe" }, scripts: [] }],
    ["plausible without a script id or domain", { scripts: [{ id: "p", kind: "plausible", enabled: true, settings: {} }] }],
  ];
  const outcome = (result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }) => ({
    success: result.success,
    issues: (result.error?.issues ?? []).map((issue) => ({ code: issue.code, path: issue.path.map(String), message: issue.message })),
  });

  for (const [label, file] of forms) {
    it(`forms: ${label} — same verdict and issues`, () => {
      expect(outcome(engine.formSchema.safeParse(file))).toEqual(outcome(kit.formSchema!.safeParse(file) as never));
    });
  }
  for (const [label, file] of scripts) {
    it(`scripts: ${label} — same verdict and issues`, () => {
      expect(outcome(engine.scriptsSchema.safeParse(file))).toEqual(outcome(kit.scriptsSchema!.safeParse(file) as never));
    });
  }
});
