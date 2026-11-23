// The kit implements the contract in packages/core/src/kit.ts. Three things
// must never drift from it: the package's mirror of the types (src/kit.d.ts),
// the zod schemas sites validate their files with (src/schema.js), and the
// catalogue data the app lists (src/catalog-data.js). The type assertions run
// under `tsc` (pnpm typecheck); the rest under vitest.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { z } from "astro/zod";
import type * as Core from "../../core/src/kit";
import { FORM_PROVIDERS as CORE_PROVIDERS, SCRIPT_INTEGRATIONS as CORE_INTEGRATIONS } from "../../core/src/kit-catalog";
import type * as Mirror from "../src/kit";
import { FORM_PROVIDERS, SCRIPT_INTEGRATIONS } from "../src/catalog-data.js";
import { formProviders, scriptIntegrations } from "../src/catalog.js";
import { consentSettingsSchema, formActionSchema, formDestinationSchema, formFieldSchema, formSchema, scriptEntrySchema, scriptsSchema } from "../src/schema.js";
import { BUILDERS } from "../src/scripts/snippets.js";
import { FREE_EMAIL_DOMAINS } from "../src/forms/free-email-domains.js";
import { FREE_MAILBOXES } from "../../core/src/forms/validate";
import { mirrors } from "../scripts/sync-contract.mjs";

// ── Type-level: mutually assignable, and the same keys at every level ────
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Keys<A, B> = Same<keyof NonNullable<A>, keyof NonNullable<B>>;
const assert = <T extends true>(): T => true as T;

// The mirror is the contract.
assert<Same<Core.FormDefinition, Mirror.FormDefinition>>();
assert<Same<Core.FormField, Mirror.FormField>>();
assert<Same<Core.FormAction, Mirror.FormAction>>();
assert<Same<Core.FormDestination, Mirror.FormDestination>>();
assert<Same<Core.FormSubmission, Mirror.FormSubmission>>();
assert<Same<Core.ScriptsConfig, Mirror.ScriptsConfig>>();
assert<Same<Core.ScriptEntry, Mirror.ScriptEntry>>();
assert<Same<Core.ConsentSettings, Mirror.ConsentSettings>>();
assert<Same<Core.ScriptIntegrationInfo, Mirror.ScriptIntegrationInfo>>();
assert<Same<Core.FormProviderInfo, Mirror.FormProviderInfo>>();

// The schemas parse exactly the contract's shapes.
type Form = z.infer<typeof formSchema>;
type Field = z.infer<typeof formFieldSchema>;
type Scripts = z.infer<typeof scriptsSchema>;
type Entry = z.infer<typeof scriptEntrySchema>;
type Consent = z.infer<typeof consentSettingsSchema>;

assert<Same<Form, Mirror.FormDefinition>>();
assert<Keys<Form, Mirror.FormDefinition>>();
assert<Keys<Form["spam"], Mirror.FormDefinition["spam"]>>();
assert<Keys<Form["appearance"], Mirror.FormDefinition["appearance"]>>();
assert<Keys<NonNullable<Form["steps"]>[number], NonNullable<Mirror.FormDefinition["steps"]>[number]>>();
assert<Same<Field, Mirror.FormField>>();
assert<Keys<Field, Mirror.FormField>>();
assert<Keys<Field["validation"], Mirror.FormField["validation"]>>();
assert<Keys<Field["showWhen"], Mirror.FormField["showWhen"]>>();
assert<Keys<Field["autofill"], Mirror.FormField["autofill"]>>();
assert<Same<z.infer<typeof formDestinationSchema>, Mirror.FormDestination>>();
assert<Keys<z.infer<typeof formDestinationSchema>, Mirror.FormDestination>>();
assert<Same<z.infer<typeof formActionSchema>, Mirror.FormAction>>();
assert<Same<Scripts, Mirror.ScriptsConfig>>();
assert<Keys<Scripts, Mirror.ScriptsConfig>>();
assert<Same<Entry, Mirror.ScriptEntry>>();
assert<Keys<Entry, Mirror.ScriptEntry>>();
assert<Same<Consent, Mirror.ConsentSettings>>();
assert<Keys<Consent, Mirror.ConsentSettings>>();
assert<Keys<Consent["banner"], Mirror.ConsentSettings["banner"]>>();
assert<Keys<NonNullable<Consent["banner"]>["categories"], NonNullable<Mirror.ConsentSettings["banner"]>["categories"]>>();

describe("the contract mirror", () => {
  it("src/kit.d.ts and src/catalog-data.js are what scripts/sync-contract.mjs writes today", () => {
    const expected = mirrors();

    for (const [name, text] of Object.entries(expected)) {
      expect(readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"), `${name} is stale: run node scripts/sync-contract.mjs`).toBe(text);
    }
  });

  it("the catalogue is the core catalogue, entry for entry", () => {
    expect(FORM_PROVIDERS).toEqual(CORE_PROVIDERS);
    expect(SCRIPT_INTEGRATIONS).toEqual(CORE_INTEGRATIONS);
    expect(formProviders).toBe(FORM_PROVIDERS);
    expect(scriptIntegrations).toBe(SCRIPT_INTEGRATIONS);
    expect(JSON.parse(JSON.stringify(scriptIntegrations))).toEqual(scriptIntegrations);
  });

  it("the server refuses exactly the free mailboxes the page refuses (this package's list is the source)", () => {
    expect([...FREE_MAILBOXES]).toEqual(FREE_EMAIL_DOMAINS);
  });

  it("every catalogued script kind has a snippet builder, and every built-in form provider a submitter", async () => {
    expect(Object.keys(BUILDERS).sort()).toEqual(SCRIPT_INTEGRATIONS.map((entry) => entry.kind).sort());
    for (const { id } of FORM_PROVIDERS) {
      const module = await import(`../src/client/providers/${id}.js`);

      expect(typeof module.submit, id).toBe("function");
    }
  });
});

describe("formSchema", () => {
  const valid = {
    name: "Contact",
    submitLabel: "Send",
    fields: [
      { id: "email", type: "email", label: "Email", required: true },
      { id: "topic", type: "select", label: "Topic", options: [{ value: "a", label: "A" }] },
      { id: "detail", type: "text", label: "Detail", showWhen: { field: "topic", equals: "a" } },
    ],
    destinations: [{ provider: "galley", settings: {} }],
    afterSubmit: [{ type: "message", text: "Thanks" }],
  };

  it("accepts a complete form", () => {
    expect(formSchema.safeParse(valid).success).toBe(true);
  });

  it("says plainly what is wrong across fields", () => {
    const result = formSchema.safeParse({
      ...valid,
      fields: [...valid.fields, { id: "email", type: "radio", label: "Again" }, { id: "x", type: "text", showWhen: { field: "nope" } }],
      destinations: [{ provider: "hubspot", settings: { portalId: "12", formId: "nope" }, mapping: { ghost: "g" } }],
    });

    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((issue) => issue.message);

    expect(messages).toContain("Two fields are called “email”. Each field needs its own id.");
    expect(messages).toContain("“email” is a radio field, so it needs at least one option.");
    expect(messages).toContain("“x” depends on “nope”, which isn't a field of this form.");
    expect(messages).toContain("The mapping names “ghost”, which isn't a field of this form.");
    expect(messages.some((message) => message.startsWith("“12” doesn't look like a HubSpot hub id"))).toBe(true);
  });
});

describe("scriptsSchema", () => {
  it("refuses an id that doesn't fit the vendor's pattern, saying what it should look like", () => {
    const result = scriptsSchema.safeParse({ scripts: [{ id: "gtm", kind: "gtm", enabled: true, settings: { containerId: "UA-123" } }] });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toBe("“UA-123” doesn't look like a Google Tag Manager Container ID (it looks like GTM-XXXXXXX).");
    expect(result.error!.issues[0]!.path).toEqual(["scripts", 0, "settings", "containerId"]);
  });

  it("needs required settings only for enabled entries", () => {
    expect(scriptsSchema.safeParse({ scripts: [{ id: "ga", kind: "ga4", enabled: false, settings: {} }] }).success).toBe(true);
    expect(scriptsSchema.safeParse({ scripts: [{ id: "ga", kind: "ga4", enabled: true, settings: {} }] }).success).toBe(false);
  });

  it("keeps custom attributes away from src, type and event handlers", () => {
    const bad = scriptsSchema.safeParse({ scripts: [{ id: "c", kind: "custom", enabled: true, settings: { src: "https://cdn.example.com/a.js", attributes: { onload: "x()" } } }] });

    expect(bad.success).toBe(false);
    expect(scriptsSchema.safeParse({ scripts: [{ id: "c", kind: "custom", enabled: true, settings: { src: "https://cdn.example.com/a.js", attributes: { "data-key": "k", defer: true } } }] }).success).toBe(true);
  });
});
