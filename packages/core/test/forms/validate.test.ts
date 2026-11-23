import { describe, expect, it } from "vitest";
import type { FormDefinition, FormField } from "../../src/kit";
import { validateSubmission, DEFAULT_MAX_LENGTH } from "../../src/forms/validate";

function form(fields: FormField[]): FormDefinition {
  return { name: "Test", fields, submitLabel: "Send", destinations: [{ provider: "galley", settings: {} }], afterSubmit: [] };
}

function errorFor(field: FormField, value: unknown): string | undefined {
  return validateSubmission(form([field]), value === undefined ? {} : { [field.id]: value }).errors[field.id];
}

describe("validateSubmission — field types", () => {
  it("text: trims, keeps, enforces the default length cap", () => {
    const result = validateSubmission(form([{ id: "name", type: "text" }]), { name: "  Ada  " });

    expect(result.values).toEqual({ name: "Ada" });
    expect(errorFor({ id: "name", type: "text" }, "x".repeat(DEFAULT_MAX_LENGTH + 1))).toBe(`Use ${DEFAULT_MAX_LENGTH} characters or fewer.`);
  });

  it("email: shape, and business-only refuses free mailboxes (case-insensitive)", () => {
    expect(errorFor({ id: "e", type: "email" }, "not-an-address")).toBe("Enter an e-mail address, like name@example.com.");
    expect(errorFor({ id: "e", type: "email" }, "ada@example.com")).toBeUndefined();
    expect(errorFor({ id: "e", type: "email", validation: { businessEmailOnly: true } }, "ada@GMAIL.com")).toBe("Use your work e-mail address.");
    expect(errorFor({ id: "e", type: "email", validation: { businessEmailOnly: true, message: "Work address, please." } }, "ada@yahoo.com")).toBe("Work address, please.");
    expect(errorFor({ id: "e", type: "email", validation: { businessEmailOnly: true } }, "ada@harbour.coop")).toBeUndefined();
  });

  it("tel, url, number, date", () => {
    expect(errorFor({ id: "t", type: "tel" }, "+44 (20) 7946-0018")).toBeUndefined();
    expect(errorFor({ id: "t", type: "tel" }, "call me")).toBe("Enter a phone number.");
    expect(errorFor({ id: "u", type: "url" }, "example.com/menu")).toBeUndefined();
    expect(errorFor({ id: "u", type: "url" }, "https://example.com")).toBeUndefined();
    expect(errorFor({ id: "u", type: "url" }, "not a link")).toBe("Enter a web address, like example.com.");
    expect(errorFor({ id: "n", type: "number" }, "12.5")).toBeUndefined();
    expect(errorFor({ id: "n", type: "number" }, "twelve")).toBe("Enter a number.");
    expect(errorFor({ id: "n", type: "number", validation: { min: 1 } }, "0")).toBe("Enter 1 or more.");
    expect(errorFor({ id: "n", type: "number", validation: { max: 10 } }, "11")).toBe("Enter 10 or less.");
    expect(errorFor({ id: "d", type: "date" }, "2026-03-14")).toBeUndefined();
    expect(errorFor({ id: "d", type: "date" }, "2026-02-30")).toBe("Enter a date, like 2026-03-14.");
    expect(errorFor({ id: "d", type: "date" }, "14/03/2026")).toBe("Enter a date, like 2026-03-14.");
  });

  it("textarea keeps line breaks (normalised) and has a larger cap", () => {
    const result = validateSubmission(form([{ id: "m", type: "textarea" }]), { m: "line one\r\nline two\n" });

    expect(result.values.m).toBe("line one\nline two");
    expect(errorFor({ id: "m", type: "textarea" }, "x".repeat(5000))).toBeUndefined();
  });

  it("select / radio accept only their options; checkboxes take a list", () => {
    const options = [{ value: "a", label: "A" }, { value: "b", label: "B" }];

    expect(errorFor({ id: "s", type: "select", options }, "a")).toBeUndefined();
    expect(errorFor({ id: "s", type: "select", options }, "z")).toBe("Choose one of the options given.");
    expect(errorFor({ id: "r", type: "radio", options }, "b")).toBeUndefined();
    expect(errorFor({ id: "r", type: "radio", options }, ["a", "b"])).toBe("This takes one answer.");
    expect(validateSubmission(form([{ id: "c", type: "checkboxes", options }]), { c: ["a", "b", "a"] }).values.c).toEqual(["a", "b"]);
    expect(validateSubmission(form([{ id: "c", type: "checkboxes", options }]), { c: "a" }).values.c).toEqual(["a"]);
    expect(errorFor({ id: "c", type: "checkboxes", options }, ["a", "x"])).toBe("Choose one of the options given.");
    expect(errorFor({ id: "c", type: "checkboxes", options }, [1, 2])).toBe("Choose an option.");
  });

  it("checkbox and consent: ticked is stored as yes; unticked values count as empty", () => {
    expect(validateSubmission(form([{ id: "ok", type: "checkbox" }]), { ok: "on" }).values).toEqual({ ok: "yes" });
    expect(validateSubmission(form([{ id: "ok", type: "checkbox" }]), { ok: "false" }).values).toEqual({});
    expect(errorFor({ id: "agree", type: "consent", required: true }, "")).toBe("Tick this box to continue.");
    expect(errorFor({ id: "agree", type: "consent", required: true }, "no")).toBe("Tick this box to continue.");
    expect(errorFor({ id: "agree", type: "consent", required: true }, "yes")).toBeUndefined();
  });

  it("hidden fields are length-checked only; layout fields take no answer", () => {
    const result = validateSubmission(form([{ id: "utm_source", type: "hidden" }, { id: "intro", type: "heading", text: "Hi" }]), { utm_source: "news", intro: "x" });

    expect(result.values).toEqual({ utm_source: "news" });
    expect(result.dropped).toBe(1);
    expect(errorFor({ id: "h", type: "hidden" }, "x".repeat(DEFAULT_MAX_LENGTH + 1))).toBe("This is too long.");
  });
});

describe("validateSubmission — rules", () => {
  it("required, per kind", () => {
    expect(errorFor({ id: "n", type: "text", required: true }, undefined)).toBe("Fill this in.");
    expect(errorFor({ id: "n", type: "text", required: true }, "   ")).toBe("Fill this in.");
    expect(errorFor({ id: "s", type: "select", required: true, options: [{ value: "a", label: "A" }] }, "")).toBe("Choose an option.");
    expect(errorFor({ id: "c", type: "checkboxes", required: true, options: [{ value: "a", label: "A" }] }, [])).toBe("Choose an option.");
    expect(errorFor({ id: "h", type: "hidden", required: true }, undefined)).toBe("Fill this in.");
  });

  it("lengths and patterns, with the field's own message", () => {
    expect(errorFor({ id: "z", type: "text", validation: { minLength: 5 } }, "1234")).toBe("Use at least 5 characters.");
    expect(errorFor({ id: "z", type: "text", validation: { maxLength: 3 } }, "1234")).toBe("Use 3 characters or fewer.");
    expect(errorFor({ id: "z", type: "text", validation: { pattern: "^[0-9]{5}$" } }, "1234a")).toBe("This doesn’t look right. Check it and try again.");
    expect(errorFor({ id: "z", type: "text", validation: { pattern: "^[0-9]{5}$", message: "Enter a 5-digit ZIP code." } }, "12")).toBe("Enter a 5-digit ZIP code.");
    expect(errorFor({ id: "z", type: "text", validation: { pattern: "^[\\p{L} .'-]+$" } }, "Zoë O'Brien")).toBeUndefined();
    // A pattern that can't be compiled is skipped, never fatal for the visitor.
    expect(errorFor({ id: "z", type: "text", validation: { pattern: "([" } }, "anything")).toBeUndefined();
  });

  it("showWhen: a hidden conditional field is ignored, not required, and hides its own dependants", () => {
    const fields: FormField[] = [
      { id: "kind", type: "radio", options: [{ value: "person", label: "Person" }, { value: "company", label: "Company" }] },
      { id: "company", type: "text", required: true, showWhen: { field: "kind", equals: "company" } },
      { id: "size", type: "text", required: true, showWhen: { field: "company" } },
      { id: "why", type: "text", showWhen: { field: "kind", notEquals: "company" } },
      { id: "plan", type: "text", showWhen: { field: "kind", in: ["company"] } },
    ];
    const person = validateSubmission(form(fields), { kind: "person", company: "Acme", size: "50", why: "curious", plan: "x" });

    expect(person.errors).toEqual({});
    expect(person.values).toEqual({ kind: "person", why: "curious" });
    expect(person.ignored).toBe(3);
    const company = validateSubmission(form(fields), { kind: "company", why: "x" });

    expect(company.errors).toEqual({ company: "Fill this in." });
    expect(company.values).toEqual({ kind: "company" });
  });

  it("unknown fields are dropped and counted; non-object values are treated as empty", () => {
    const result = validateSubmission(form([{ id: "name", type: "text" }]), { name: "Ada", admin: "true", __proto__x: "y" });

    expect(result.values).toEqual({ name: "Ada" });
    expect(result.dropped).toBe(2);
    expect(validateSubmission(form([{ id: "name", type: "text", required: true }]), "nope").errors).toEqual({ name: "Fill this in." });
  });

  it("refuses objects and numbers as answers", () => {
    expect(errorFor({ id: "n", type: "text" }, { $gt: "" })).toBe("This takes one answer.");
    expect(errorFor({ id: "n", type: "text" }, 42)).toBe("This takes one answer.");
  });
});
