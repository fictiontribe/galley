import { describe, expect, it } from "vitest";
import type { FormAction, FormDefinition, FormField } from "@galley/core/kit";
import { actionNotes, canAdd, fillAnswers, insertIndex, newAction, placeholdersIn } from "@/features/forms/logic/actions";
import { describeRule, isShown, ruleValues, shownIds } from "@/features/forms/logic/conditions";
import { formSlots, namesThisForm, pagesUsing, sectionFor } from "@/features/forms/logic/embed";
import { fieldTypeFor, planImport } from "@/features/forms/logic/introspect";
import { inlineParts, safeLink, wrapSelection } from "@/features/forms/logic/inline";
import { mappedName, roleOf, unmappedRequired, usualMappingChanges, usualName } from "@/features/forms/logic/mapping";
import { formChangeMarks } from "@/features/forms/logic/marks";
import type { JsonObject } from "@/features/forms/logic/json";
import { payloadFor, payloads } from "@/features/forms/logic/payload";
import { settingProblem } from "@/features/forms/logic/settings";
import { checkAnswer, describeValidation, patternChoice, patternProblem } from "@/features/forms/logic/validation";
import { FORM_PROVIDERS } from "@galley/core/kit-catalog";
import type { SearchHit, SiteModel } from "@galley/core/types";

const fields: FormField[] = [
  { id: "first_name", type: "text", label: "First name" },
  { id: "email", type: "email", label: "Work email", required: true, validation: { businessEmailOnly: true } },
  { id: "company", type: "text", label: "Company" },
  { id: "size", type: "select", label: "Company size", options: [{ value: "small", label: "1–10" }, { value: "big", label: "500+" }] },
  { id: "why", type: "textarea", label: "Why", showWhen: { field: "size", equals: "big" } },
  { id: "utm_source", type: "hidden", label: "UTM source", autofill: { from: "utm", key: "utm_source" } },
  { id: "intro", type: "paragraph", text: "Hello" },
];

const form: FormDefinition = {
  name: "Demo",
  fields,
  submitLabel: "Send",
  destinations: [
    { provider: "hubspot", settings: { portalId: "123456", formId: "x" }, mapping: { first_name: "firstname" }, constants: { lifecyclestage: "lead" } },
    { provider: "galley", settings: {}, when: { field: "size", equals: "big" } },
  ],
  afterSubmit: [],
};

describe("validation", () => {
  it("asks for required answers in plain words", () => {
    expect(checkAnswer(fields[1] as FormField, "")).toBe("Fill in this answer.");
    expect(checkAnswer({ id: "c", type: "consent", required: true }, "")).toBe("Tick this box to continue.");
    expect(checkAnswer({ id: "c", type: "consent", required: true }, "true")).toBeNull();
    expect(checkAnswer({ id: "s", type: "select", required: true }, "")).toBe("Choose an answer.");
  });
  it("refuses free mailboxes when asked to", () => {
    expect(checkAnswer(fields[1] as FormField, "sam@gmail.com")).toBe("Use your work email address. gmail.com is a personal mailbox.");
    expect(checkAnswer(fields[1] as FormField, "sam@studio.test")).toBeNull();
    expect(checkAnswer(fields[1] as FormField, "not-an-address")).toMatch(/email address/);
    expect(checkAnswer({ id: "u", type: "url" }, "example.com")).toBe("Enter a full web address, starting with https://.");
  });
  it("checks lengths, ranges and patterns, with the field's own message", () => {
    expect(checkAnswer({ id: "t", type: "text", validation: { minLength: 3 } }, "ab")).toBe("Use at least 3 characters.");
    expect(checkAnswer({ id: "n", type: "number", validation: { min: 1, max: 5 } }, "9")).toBe("Enter 5 or less.");
    expect(checkAnswer({ id: "z", type: "text", validation: { pattern: "^[0-9]+$", message: "Digits, please." } }, "12a")).toBe("Digits, please.");
    expect(checkAnswer({ id: "z", type: "text", validation: { pattern: "[0-9]+" } }, "123")).toBeNull();
    expect(checkAnswer({ id: "z", type: "text", validation: { pattern: "[0-9]+" } }, "12a")).toBe("Check the format of this answer.");
    expect(checkAnswer({ id: "z", type: "text", required: true, validation: { message: "Say something." } }, "")).toBe("Say something.");
  });
  it("names presets, and never shows a raw pattern first", () => {
    expect(patternChoice({ pattern: "^[0-9]+$" })).toBe("digits");
    expect(patternChoice({ pattern: "^x$" })).toBe("custom");
    expect(patternChoice(undefined)).toBe("none");
    expect(patternProblem("([")).toMatch(/can’t be read/);
    expect(describeValidation({ id: "e", type: "email", validation: { businessEmailOnly: true, maxLength: 80 } })).toBe("work email only · up to 80 characters");
  });
});

describe("conditions", () => {
  it("shows a field only for the right answer", () => {
    expect(isShown(fields[4] as FormField, { size: "big" })).toBe(true);
    expect(isShown(fields[4] as FormField, { size: "small" })).toBe(false);
    expect(isShown({ id: "x", type: "text", showWhen: { field: "size", notEquals: "big" } }, {})).toBe(true);
  });
  it("describes a rule with the target's labels", () => {
    expect(describeRule({ field: "size", equals: "big" }, fields)).toBe("shows when Company size is 500+");
    expect(describeRule({ field: "gone", equals: "x" }, fields)).toMatch(/removed/);
    expect(ruleValues({ id: "c", type: "checkbox" })).toEqual([{ value: "true", label: "Ticked" }]);
    const chain: FormField[] = [
      { id: "a", type: "select" },
      { id: "b", type: "text", showWhen: { field: "a", equals: "x" } },
      { id: "c", type: "text", showWhen: { field: "b", notEquals: "no" } },
    ];
    expect([...shownIds(chain, { a: "y", b: "yes" })]).toEqual(["a"]);
    expect([...shownIds(chain, { a: "x", b: "yes" })]).toEqual(["a", "b", "c"]);
  });
});

describe("mapping", () => {
  it("recognises what a field is for", () => {
    expect(roleOf({ id: "first_name", type: "text", label: "First name" })).toBe("firstName");
    expect(roleOf({ id: "x", type: "text", label: "Company size" })).toBe("companySize");
    expect(roleOf({ id: "your_name", type: "text", label: "Your name" })).toBe("fullName");
  });
  it("offers each provider's usual names", () => {
    expect(usualName("hubspot", { id: "email", type: "email" })).toBe("email");
    expect(usualName("marketo", { id: "email", type: "email" })).toBe("Email");
    expect(usualName("salesforce", { id: "last", type: "text", label: "Last name" })).toBe("last_name");
    expect(usualName("webhook", { id: "email", type: "email" })).toBeNull();
  });
  it("sends unmapped fields under their own name", () => {
    expect(mappedName({ mapping: { first_name: "firstname" } }, fields[0] as FormField)).toBe("firstname");
    expect(mappedName({}, { id: "a", type: "text", name: "alpha" })).toBe("alpha");
  });
  it("warns about a provider's required names nobody fills", () => {
    expect(unmappedRequired({ provider: "salesforce", settings: {} }, fields)).toEqual(["last_name"]);
    expect(unmappedRequired({ provider: "salesforce", settings: {}, constants: { last_name: "Unknown" } }, fields)).toEqual([]);
    expect(unmappedRequired({ provider: "marketo", settings: {} }, fields)).toEqual(["Email"]);
  });
  it("lists what “use the usual names” would change", () => {
    expect(usualMappingChanges({ provider: "marketo", settings: {} }, fields).map((change) => change.name)).toEqual(["FirstName", "Email", "Company", "NumberOfEmployees"]);
  });
});

describe("test-mode payload", () => {
  it("sends visible answers under mapped names, then fixed values", () => {
    const result = payloadFor(form, form.destinations[0]!, 0, { first_name: "Sam", email: "sam@studio.test", size: "small", why: "ignored" });
    expect(result.sent).toBe(true);
    expect(result.rows.map((row) => [row.name, row.value])).toEqual([
      ["firstname", "Sam"],
      ["email", "sam@studio.test"],
      ["company", ""],
      ["size", "small"],
      ["utm_source", ""],
      ["lifecyclestage", "lead"],
    ]);
    expect(result.rows.find((row) => row.name === "utm_source")?.filledOnPage).toBe(true);
  });
  it("skips a destination whose condition doesn't hold", () => {
    const [main, inbox] = payloads(form, { size: "small" });
    expect(main?.sent).toBe(true);
    expect(inbox?.sent).toBe(false);
    expect(payloads(form, { size: "big" })[1]?.rows.some((row) => row.name === "why")).toBe(true);
  });
});

describe("after sending", () => {
  const message: FormAction = { type: "message", text: "Thanks" };
  const redirect: FormAction = { type: "redirect", url: "/next/" };
  it("allows one thank-you and one page change", () => {
    expect(canAdd([message], "message", true).ok).toBe(false);
    expect(canAdd([redirect], "redirect", true).reason).toMatch(/only go to one/);
    expect(canAdd([], "event", false).ok).toBe(true);
  });
  it("offers custom code only where build mode is allowed", () => {
    expect(canAdd([], "script", false)).toEqual({ ok: false, reason: expect.stringMatching(/build mode/) });
    expect(canAdd([], "script", true).ok).toBe(true);
  });
  it("puts a thank-you first and waits before changing page when both are there", () => {
    expect(insertIndex([redirect], "message")).toBe(0);
    expect(newAction("redirect", [message])).toMatchObject({ delaySeconds: 3 });
    expect(actionNotes([message, { type: "redirect", url: "/x/", delaySeconds: 3 }])).toEqual(["The thank-you shows first, then the page changes after 3 seconds."]);
    expect(actionNotes([message, redirect])[0]).toMatch(/won’t be seen/);
  });
  it("fills answers into a message", () => {
    expect(fillAnswers("Thanks, {{ name }}. {{missing}}", { name: "Sam" })).toBe("Thanks, Sam. ");
    expect(placeholdersIn("{{a}} and {{b_c}}")).toEqual(["a", "b_c"]);
  });
});

describe("provider settings", () => {
  const hubspot = FORM_PROVIDERS.find((provider) => provider.id === "hubspot")!;
  it("asks for required settings and checks their pattern with an example", () => {
    const portal = hubspot.settings.find((setting) => setting.key === "portalId")!;
    expect(settingProblem(portal, "")).toBe("Add the Hub ID.");
    expect(settingProblem(portal, "abc")).toBe("Check the Hub ID — it usually looks like 12345678.");
    expect(settingProblem(portal, "12345678")).toBeNull();
    const region = hubspot.settings.find((setting) => setting.key === "region")!;
    expect(settingProblem(region, "")).toBeNull();
  });
});

describe("embedding", () => {
  const model = {
    collections: [
      {
        id: "pages",
        label: "Pages",
        kind: "entries",
        fields: [
          {
            key: "sections",
            type: "blocks",
            discriminator: "type",
            blocks: [
              { type: "hero", label: "Hero", fields: [{ key: "heading", type: "string" }] },
              { type: "form", label: "Form", fields: [{ key: "form", type: "reference", collection: "forms" }] },
            ],
          },
        ],
      },
    ],
  } as unknown as SiteModel;
  it("finds the section types that take a form", () => {
    const slots = formSlots(model);
    expect(slots).toMatchObject([{ collection: "pages", listKey: "sections", blockType: "form", formKey: "form" }]);
    expect(sectionFor(slots[0]!, "contact")).toEqual({ type: "form", form: "contact" });
  });
  it("counts a page as using a form only where a form field names it", () => {
    const hit = (path: string, field: Array<string | number>, excerpt: string, collection = "pages"): SearchHit => ({ path, collection, title: path, url: "/", excerpt, location: { kind: "field", field, label: "" } });
    const hits = [
      hit("contact.md", ["sections", 2, "form"], "contact"),
      hit("contact.md", ["title"], "Contact"),
      hit("about.md", ["sections", 0, "heading"], "contact us"),
      hit("forms/contact.json", ["name"], "contact", "forms"),
      hit("other.md", ["sections", 1, "form"], "contact-old"),
    ];
    expect(pagesUsing(hits, "contact").map((h) => h.path)).toEqual(["contact.md"]);
    expect(namesThisForm({ ...hits[0]!, location: { kind: "body", start: 0, end: 1, block: "" }, excerpt: '<Form form="contact" />' }, "contact")).toBe(true);
  });
});

describe("importing fields", () => {
  it("turns provider fields into fields mapped to the provider's names", () => {
    const plan = planImport(
      [
        { name: "email", label: "Email", type: "email", required: true },
        { name: "numemployees", label: "Number of employees", type: "select", options: [{ value: "1", label: "1" }] },
        { name: "phone", label: "Phone", type: "phonenumber" },
      ],
      [{ id: "email" }],
      new Set(["email"]),
    );
    expect(plan.skipped).toEqual(["email"]);
    expect(plan.fields).toEqual([
      { id: "number_of_employees", type: "select", label: "Number of employees", options: [{ value: "1", label: "1" }] },
      { id: "phone", type: "tel", label: "Phone" },
    ]);
    expect(plan.mapping).toEqual([{ fieldId: "number_of_employees", name: "numemployees" }]);
    expect(fieldTypeFor({ name: "Email" })).toBe("email");
  });
});

describe("inline formatting", () => {
  it("splits bold, italic and links", () => {
    expect(inlineParts("I agree to the [policy](/privacy/), **really**.")).toEqual([
      { kind: "text", text: "I agree to the " },
      { kind: "link", text: "policy", href: "/privacy/" },
      { kind: "text", text: ", " },
      { kind: "bold", text: "really" },
      { kind: "text", text: "." },
    ]);
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("/privacy/")).toBe("/privacy/");
    expect(wrapSelection("hello world", 6, 11, "**")).toEqual({ text: "hello **world**", start: 8, end: 13 });
  });
});

describe("change marks", () => {
  it("marks the fields and areas a fresh copy changed", () => {
    const before: JsonObject = { name: "A", fields: [{ id: "a", type: "text" }], destinations: [], afterSubmit: [] };
    const after: JsonObject = { name: "A", fields: [{ id: "a", type: "text", required: true }, { id: "b", type: "tel" }], destinations: [{ provider: "galley", settings: {} }], afterSubmit: [] };
    expect(formChangeMarks(before, after)).toEqual(["field:a", "field:b", "area:destinations"]);
  });
});
