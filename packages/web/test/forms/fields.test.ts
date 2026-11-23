import { describe, expect, it } from "vitest";
import type { FormDefinition } from "@galley/core/kit";
import { defaultField, kindOfField, PALETTE } from "@/features/forms/logic/fieldTypes";
import { addStepOps, fieldsOnStep, insertFieldsOps, moveToStepOps, removeStepOps, renameFieldOps, renameStepOps, stepCount, stepTitles, widthOps } from "@/features/forms/logic/fieldOps";
import { cleanName, idFollowingLabel, nameFromLabel, uniqueName } from "@/features/forms/logic/names";
import { missingTracking, trackingFields } from "@/features/forms/logic/tracking";
import { optionsFromLines } from "@/features/forms/logic/options";
import { slotsOf, structureOf } from "@/features/forms/logic/structure";
import { FORM_STARTERS } from "@/features/forms/logic/starters";
import { applyOpsLocal } from "@/features/content/form/ops";
import { readForm, toJson, type JsonObject } from "@/features/forms/logic/json";

const form = (patch: Partial<FormDefinition> = {}): FormDefinition => ({
  name: "Contact",
  fields: [
    { id: "name", type: "text", label: "Name", width: "half" },
    { id: "email", type: "email", label: "Email", required: true },
    { id: "size", type: "select", label: "Size", options: [{ value: "a", label: "A" }] },
  ],
  submitLabel: "Send",
  destinations: [{ provider: "galley", settings: {} }],
  afterSubmit: [],
  ...patch,
});

describe("names", () => {
  it("takes a name from a label", () => {
    expect(nameFromLabel("Company size (staff)")).toBe("company_size_staff");
    expect(nameFromLabel("Café")).toBe("cafe");
    expect(nameFromLabel("  ")).toBe("field");
    expect(nameFromLabel("2nd choice")).toBe("field_2nd_choice");
  });
  it("finds a free name", () => {
    expect(uniqueName("email", ["email", "email_2"])).toBe("email_3");
    expect(uniqueName("phone", ["email"])).toBe("phone");
  });
  it("cleans a typed name", () => {
    expect(cleanName(" first name! ")).toBe("first_name");
  });
  it("lets a new field's id follow its label until something refers to it", () => {
    const f = form();
    expect(idFollowingLabel(f, 2, "Company size")).toBe("company_size");
    expect(idFollowingLabel(f, 2, "Size")).toBeNull();
    expect(idFollowingLabel(f, 2, "Email")).toBe("email_2");
    const referenced = form({ fields: [...f.fields, { id: "other", type: "text", showWhen: { field: "size", equals: "a" } }] });
    expect(idFollowingLabel(referenced, 2, "Company size")).toBeNull();
    const named = form({ fields: [{ id: "x", type: "text", name: "sent_as" }] });
    expect(idFollowingLabel(named, 0, "Anything")).toBeNull();
  });
});

describe("default fields", () => {
  it("gives email a label, required, and the name email", () => {
    expect(defaultField("email", [])).toEqual({ id: "email", type: "email", label: "Email", required: true });
  });
  it("never repeats an id and keeps the step", () => {
    expect(defaultField("email", ["email"], 1)).toMatchObject({ id: "email_2", step: 1 });
  });
  it("starts choices with options and consent with text", () => {
    expect(defaultField("choice", []).options).toHaveLength(3);
    expect(defaultField("consent", [])).toMatchObject({ type: "consent", required: true });
    expect(defaultField("heading", [])).toMatchObject({ id: "heading", type: "heading" });
  });
  it("puts id, type and label first, as people read the file", () => {
    expect(Object.keys(defaultField("tel", []))).toEqual(["id", "type", "label"]);
  });
  it("maps fields back to their palette tile", () => {
    expect(kindOfField({ type: "radio" })).toBe("choice");
    expect(PALETTE.map((item) => item.kind)).toContain("hidden");
  });
});

describe("field ops", () => {
  it("adds a field as one insert", () => {
    expect(insertFieldsOps(1, [{ id: "phone", type: "tel" }])).toEqual([{ op: "insert", path: ["fields"], index: 1, value: { id: "phone", type: "tel" } }]);
  });
  it("sets half width, and removes the key for full", () => {
    expect(widthOps(form(), 1, "half")).toEqual([{ op: "set", path: ["fields", 1, "width"], value: "half" }]);
    expect(widthOps(form(), 0, "full")).toEqual([{ op: "unset", path: ["fields", 0, "width"] }]);
    expect(widthOps(form(), 0, "half")).toEqual([]);
  });
  it("moves a field to a step, and back to the first by removing the key", () => {
    expect(moveToStepOps(form(), 0, 1)).toEqual([{ op: "set", path: ["fields", 0, "step"], value: 1 }]);
    const stepped = form({ fields: [{ id: "a", type: "text", step: 1 }] });
    expect(moveToStepOps(stepped, 0, 0)).toEqual([{ op: "unset", path: ["fields", 0, "step"] }]);
  });
  it("adds steps with titles", () => {
    expect(addStepOps(form())).toEqual([{ op: "set", path: ["steps"], value: [{ title: "Step 1" }, { title: "Step 2" }] }]);
    const two = form({ steps: [{ title: "You" }, { title: "Project" }] });
    expect(addStepOps(two)).toEqual([{ op: "insert", path: ["steps"], index: 2, value: { title: "Step 3" } }]);
    expect(stepTitles(two)).toEqual(["You", "Project"]);
  });
  it("renames a step, filling titles up to it", () => {
    expect(renameStepOps(form({ steps: [{ title: "A" }, { title: "B" }] }), 1, "Project")).toEqual([{ op: "set", path: ["steps", 1, "title"], value: "Project" }]);
  });
  it("removes a step: its fields join the step before, later ones move up", () => {
    const f = form({
      steps: [{ title: "A" }, { title: "B" }, { title: "C" }],
      fields: [
        { id: "a", type: "text" },
        { id: "b", type: "text", step: 1 },
        { id: "c", type: "text", step: 2 },
      ],
    });
    expect(removeStepOps(f, 1)).toEqual([
      { op: "unset", path: ["fields", 1, "step"] },
      { op: "set", path: ["fields", 2, "step"], value: 1 },
      { op: "remove", path: ["steps"], index: 1 },
    ]);
    const two = form({ steps: [{ title: "A" }, { title: "B" }], fields: [{ id: "a", type: "text", step: 1 }] });
    expect(removeStepOps(two, 0)).toEqual([{ op: "unset", path: ["fields", 0, "step"] }, { op: "unset", path: ["steps"] }]);
  });
  it("counts steps from titles and from fields", () => {
    expect(stepCount(form())).toBe(1);
    expect(stepCount(form({ fields: [{ id: "a", type: "text", step: 2 }] }))).toBe(3);
    expect(fieldsOnStep([{ step: 1 }, {}, { step: 1 }], 1)).toEqual([0, 2]);
  });
  it("renames a field and everything that points at it", () => {
    const f = form({
      fields: [
        { id: "size", type: "select" },
        { id: "why", type: "text", showWhen: { field: "size", equals: "a" } },
      ],
      destinations: [{ provider: "hubspot", settings: {}, mapping: { size: "numemployees" }, when: { field: "size", equals: "a" } }],
      afterSubmit: [{ type: "redirect", url: "/t/", passFields: ["size"] }],
    });
    const ops = renameFieldOps(f, 0, "company_size");
    const after = readForm(applyOpsLocal(toJson(f) as JsonObject, ops));
    expect(after.fields[0]?.id).toBe("company_size");
    expect(after.fields[1]?.showWhen?.field).toBe("company_size");
    expect(after.destinations[0]?.mapping).toEqual({ company_size: "numemployees" });
    expect(after.destinations[0]?.when?.field).toBe("company_size");
    expect(after.afterSubmit[0]).toMatchObject({ passFields: ["company_size"] });
  });
});

describe("tracking fields", () => {
  it("adds the UTM five, the page address and the referrer", () => {
    const fields = trackingFields("first");
    expect(fields.map((field) => field.id)).toEqual(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "page_url", "referrer"]);
    expect(fields[0]?.autofill).toEqual({ from: "utm", key: "utm_source", touch: "first" });
  });
  it("skips the ones already there", () => {
    expect(missingTracking([{ id: "utm_source" }, { id: "referrer" }], "last")).toHaveLength(5);
  });
});

describe("options from a pasted list", () => {
  it("makes one option per line, with values, skipping blanks and repeats", () => {
    expect(optionsFromLines("Small\n\n- Medium\nLarge | xl\nsmall")).toEqual([
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "xl", label: "Large" },
    ]);
    expect(optionsFromLines("1–10\n201–1,000\nMore than 1,000").map((option) => option.value)).toEqual(["1-10", "201-1000", "more-than-1000"]);
  });
});

describe("structure", () => {
  it("changes when fields move or resize, not when a label is typed", () => {
    const a = structureOf(toJson(form().fields));
    const typed = structureOf(toJson(form({ fields: form().fields.map((field, i) => (i === 0 ? { ...field, label: "Full name" } : field)) }).fields));
    expect(typed).toBe(a);
    expect(slotsOf(a).map((slot) => [slot.key, slot.half])).toEqual([
      ["name", true],
      ["email", false],
      ["size", false],
    ]);
  });
  it("keys duplicate ids apart", () => {
    expect(slotsOf(structureOf([{ id: "a" }, { id: "a" }])).map((slot) => slot.key)).toEqual(["a", "a#1"]);
  });
});

describe("starting points", () => {
  it("are complete forms with unique field ids", () => {
    for (const starter of FORM_STARTERS) {
      expect(starter.form.name).toBeTruthy();
      expect(starter.form.submitLabel).toBeTruthy();
      expect(starter.form.destinations.length).toBeGreaterThan(0);
      const ids = starter.form.fields.map((field) => field.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
