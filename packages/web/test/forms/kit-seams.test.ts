/**
 * The seams between the form builder, the scripts screen, the preview and
 * the engine: one free-mailbox list and one pattern guard (from the engine's
 * dependency-free module), a removed field taking its uses with it under one
 * Undo, the preview frames' names, and kit files found by the engine's marker.
 */
import { describe, expect, it } from "vitest";
import { applyEdits } from "@galley/core/content";
import type { FormDefinition } from "@galley/core/kit";
import * as shared from "@galley/core/forms/shared";
import type { Collection, SiteModel } from "@galley/core/types";
import { describeUses, fieldUsesOps } from "@/features/forms/logic/fieldOps";
import { fileNoun, formsCollection, isKitFile, scriptsFile } from "@/features/forms/logic/locate";
import { CONTACT_FORM } from "@galley/core/forms/shared";
import { FORM_STARTERS } from "@/features/forms/logic/starters";
import { FREE_MAILBOXES, PATTERN_PRESETS, checkAnswer, patternProblem } from "@/features/forms/logic/validation";
import { frameName } from "@/features/preview/frameNames";

describe("one free-mailbox list, one pattern guard", () => {
  it("the builder refuses exactly the mailboxes the capture server refuses", () => {
    expect(FREE_MAILBOXES).toBe(shared.FREE_MAILBOXES);
    expect(FREE_MAILBOXES).toHaveLength(51);
    expect(checkAnswer({ id: "email", type: "email", validation: { businessEmailOnly: true } }, "kim@hey.com")).toBe("Use your work email address. hey.com is a personal mailbox.");
  });

  it("says a pattern could stall the site's form before Proof does, and lets every preset through", () => {
    expect(patternProblem("(a+)+$")).toBe("This pattern could be slow enough to stall the site’s form; simplify it.");
    expect(patternProblem("([")).toMatch(/^This pattern can’t be read/);
    for (const preset of PATTERN_PRESETS) expect(patternProblem(preset.pattern), preset.label).toBeNull();
  });

  it("the Contact starter is the form “Set it up for me” adds", () => {
    expect(FORM_STARTERS.find((starter) => starter.id === "contact")?.form).toBe(CONTACT_FORM);
  });
});

describe("removing a field takes what names it, under one Undo", () => {
  const form: FormDefinition = {
    name: "Demo",
    submitLabel: "Send",
    fields: [
      { id: "size", type: "select", label: "Size", options: [{ value: "big", label: "Big" }] },
      { id: "email", type: "email", label: "Email" },
      { id: "why", type: "text", label: "Why", showWhen: { field: "size", equals: "big" } },
      { id: "also", type: "text", label: "Also", showWhen: { field: "size" } },
    ],
    destinations: [
      { provider: "galley", settings: {} },
      { provider: "webhook", settings: { url: "https://hooks.example.com/x" }, when: { field: "size", equals: "big" }, mapping: { size: "company_size", email: "email" } },
    ],
    afterSubmit: [{ type: "redirect", url: "/thanks/", passFields: ["size", "email", "size"] }],
  };
  const text = `${JSON.stringify(form, null, 2)}\n`;

  it("removes the rules, mapping and passed answers with the field; Undo puts back the same bytes", () => {
    const uses = fieldUsesOps(form, 0);

    expect(describeUses(uses)).toBe("3 rules, 1 mapping and 2 answers passed to a page");
    const removed = applyEdits(text, "json", [...uses.ops, { op: "remove", path: ["fields"], index: 0 }]);

    expect(removed.refused).toEqual([]);
    const after = JSON.parse(removed.content) as FormDefinition;

    expect(after.fields.map((field) => field.id)).toEqual(["email", "why", "also"]);
    expect(after.fields.some((field) => field.showWhen)).toBe(false);
    expect(after.destinations[1]).toEqual({ provider: "webhook", settings: { url: "https://hooks.example.com/x" }, mapping: { email: "email" } });
    expect(after.afterSubmit[0]).toEqual({ type: "redirect", url: "/thanks/", passFields: ["email"] });

    const undone = applyEdits(removed.content, "json", [{ op: "insert", path: ["fields"], index: 0, value: form.fields[0]! as never }, ...uses.undo]);

    expect(JSON.parse(undone.content)).toEqual(form);
  });

  it("a field nothing names removes alone", () => {
    const uses = fieldUsesOps(form, 3);

    expect(uses.ops).toEqual([]);
    expect(describeUses(uses)).toBeNull();
  });
});

describe("the preview frames", () => {
  it("are all named galley-preview…, so the site kit keeps third-party scripts inert in them", () => {
    const names = [frameName("proposed", true), frameName("live", true), frameName("proposed", false), frameName("live", false)];

    expect(names).toEqual(["galley-preview", "galley-preview-live", "galley-preview-proof", "galley-preview-proof-live"]);
    for (const name of names) expect(name.startsWith("galley-preview")).toBe(true);
  });
});

describe("kit files, as the engine marks them", () => {
  const base = { label: "x", singular: "x", body: false, url: null, fields: [], create: true, count: 1, source: "schema" as const };
  const enquiries: Collection = { ...base, id: "enquiries", kind: "entries", path: "src/content/enquiries", format: "json", kit: "forms" };
  const setup: Collection = { ...base, id: "tags", kind: "data", path: "src/data/tags.json", format: "json", kit: "scripts" };
  const pages: Collection = { ...base, id: "pages", kind: "entries", path: "src/content/pages", format: "markdown" };
  const model = { collections: [pages, enquiries, setup] } as unknown as SiteModel;

  it("finds forms and the scripts setup by the engine's marker, whatever they are called", () => {
    expect(formsCollection(model)?.id).toBe("enquiries");
    expect(scriptsFile(model)?.id).toBe("tags");
    expect(isKitFile(enquiries) && isKitFile(setup) && !isKitFile(pages)).toBe(true);
  });

  it("names the file in the conflict notice by its kind", () => {
    expect([fileNoun(model, "enquiries"), fileNoun(model, "tags"), fileNoun(model, "pages")]).toEqual(["form", "scripts setup", "page"]);
  });
});
