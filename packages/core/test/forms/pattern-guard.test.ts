/**
 * A form file's `validation.pattern` can't stall the capture server: the
 * static guard (src/forms/shared.ts) refuses the shapes that backtrack
 * without bound, answers are capped in length before a pattern runs, and a
 * refused pattern is skipped — never fatal for the visitor.
 */
import { describe, expect, it } from "vitest";
import { matchesPattern, patternRisk, PATTERN_INPUT_LIMIT } from "../../src/forms/shared";
import { validateSubmission } from "../../src/forms/validate";
import type { FormDefinition } from "../../src/kit";

describe("the pattern guard", () => {
  it.each([
    ["(a+)+$", "nested"],
    ["^(a+)+b", "nested"],
    ["(\\w*\\s?)*", "nested"],
    ["(?:\\d{1,3})+", "nested"],
    ["(\\d+-?)+", "nested"],
    ["(a|ab)+", "alternation"],
    ["(\\w|\\d)*", "alternation"],
    ["(x|)+", "alternation"],
    ["\\w+\\w+\\w+", "overlap"],
    [".*a.*b.*", "overlap"],
    ["(a)\\1", "backreference"],
  ])("refuses %s (%s)", (pattern, rule) => {
    expect(patternRisk(pattern)).toBe(rule);
  });

  it.each([
    "^[0-9]+$",
    "^[0-9]{5}(-[0-9]{4})?$",
    "^[\\p{L} .'-]+$",
    "^(?![\\s\\S]*(https?://|www\\.))[\\s\\S]*$",
    "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
    "([a-z0-9-]+\\.)+[a-z]{2,}",
    "(\\.a+)+",
    "(cat|dog)+",
    "(?:-|\\.)+",
    "\\d+\\d+",
    "^\\+?[0-9 ()-]{6,20}$",
    "[A-Z]{2}\\d{2}( ?\\d{4}){4}",
    "^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$",
  ])("lets %s run", (pattern) => {
    expect(patternRisk(pattern)).toBeNull();
  });

  it("runs the whole answer against the pattern, as the browser does", () => {
    expect(matchesPattern("[0-9]{5}", "12345")).toBe(true);
    expect(matchesPattern("[0-9]{5}", "123456")).toBe(false);
    expect(matchesPattern("a|b", "ab")).toBe(false);
  });

  it("doesn't check what it can't check safely", () => {
    expect(matchesPattern("([", "x")).toBeNull();
    expect(matchesPattern("(a+)+$", "aaaa")).toBeNull();
    expect(matchesPattern("^[a-z]+$", "a".repeat(PATTERN_INPUT_LIMIT + 1))).toBeNull();
    expect(matchesPattern("^[a-z]+$", "a".repeat(PATTERN_INPUT_LIMIT))).toBe(true);
  });
});

describe("the capture endpoint with a catastrophic pattern", () => {
  const form: FormDefinition = {
    name: "Evil",
    submitLabel: "Send",
    fields: [
      { id: "code", type: "text", label: "Code", validation: { pattern: "(a+)+$", message: "Codes are letters a." } },
      { id: "zip", type: "text", label: "ZIP", validation: { pattern: "[0-9]{5}" } },
      { id: "notes", type: "textarea", label: "Notes", validation: { pattern: "(\\w+\\s?)+$" } },
    ],
    destinations: [{ provider: "galley", settings: {} }],
    afterSubmit: [],
  };

  it("answers at once and doesn't refuse the visitor for the form's own mistake", () => {
    const started = performance.now();
    const outcome = validateSubmission(form, { code: `${"a".repeat(40)}!`, zip: "12345", notes: `${"word ".repeat(300)}!` });

    expect(performance.now() - started).toBeLessThan(500);
    expect(outcome.errors).toEqual({});
  });

  it("still refuses what a safe pattern refuses, on the whole answer", () => {
    expect(validateSubmission(form, { zip: "123456" }).errors).toEqual({ zip: "This doesn’t look right. Check it and try again." });
  });
});
