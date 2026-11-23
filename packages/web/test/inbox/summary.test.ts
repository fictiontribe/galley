import { describe, expect, it } from "vitest";
import type { FormDefinition, FormSubmission } from "@galley/core/kit";
import { validateSubmission } from "@galley/core/forms";
import { answerLabel, arrival, labelledAnswers, rowSummary, sampleAnswers } from "../../src/features/inbox/summary";

const form: FormDefinition = {
  name: "Contact us",
  fields: [
    { id: "intro", type: "heading", text: "Say hello" },
    { id: "message", type: "textarea", label: "Message" },
    { id: "topic", type: "select", label: "Topic", options: [{ value: "events", label: "Private events" }] },
    { id: "email", type: "email", label: "E-mail", required: true },
    { id: "full_name", type: "text", label: "Your name", required: true },
    { id: "agree", type: "consent", label: "I agree", required: true },
    { id: "src", type: "hidden", autofill: { from: "utm", key: "utm_source" } },
  ],
  submitLabel: "Send",
  destinations: [{ provider: "galley", settings: {} }],
  afterSubmit: [],
};

const submission: FormSubmission = {
  id: "01JX",
  siteId: "s",
  form: "contact",
  at: "2026-11-23T10:00:00.000Z",
  values: { message: "We’d like the back room for 18 people.", topic: "events", email: "priya@example.com", full_name: "Priya Raman", agree: "yes", src: "newsletter", old_field: "kept" },
  page: { url: "https://example.com/contact/?utm_source=newsletter&utm_campaign=spring" },
};

describe("inbox summaries", () => {
  it("lists answers in the form's order with labels; options and ticks read as words; leftovers last", () => {
    expect(labelledAnswers(form, submission).map((row) => [row.label, row.value])).toEqual([
      ["Message", "We’d like the back room for 18 people."],
      ["Topic", "Private events"],
      ["E-mail", "priya@example.com"],
      ["Your name", "Priya Raman"],
      ["I agree", "Yes"],
      ["src", "newsletter"],
      ["old_field", "kept"],
    ]);
  });

  it("puts the name and e-mail first in a row, hidden fields never", () => {
    expect(rowSummary(form, submission)).toEqual(["Priya Raman", "priya@example.com", "Private events"]);
  });

  it("reads how the visitor arrived from the page's utm_* and UTM-filled fields", () => {
    expect(arrival(form, submission)).toEqual([
      { label: "Source", value: "newsletter" },
      { label: "Campaign", value: "spring" },
    ]);
  });

  it("makes test answers that pass the server's own checks", () => {
    const values = sampleAnswers(form);
    const outcome = validateSubmission(form, values);

    expect(outcome.errors).toEqual({});
    expect(values.email).toBe("test.visitor@example.com");
    expect(values.full_name).toBe("Test visitor");
  });
});

describe("what an answer is called", () => {
  it("names an unlabelled consent box by its own sentence, shortened, never by its id", () => {
    expect(answerLabel({ id: "consent", type: "consent", text: "I agree to the [privacy policy](/privacy/)." } as never)).toBe("I agree to the privacy policy.");
    const long = answerLabel({ id: "consent", type: "consent", text: "Yes, I would like to receive the **monthly letter** about new work, events and the occasional sale, and I can unsubscribe at any time." } as never);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long).toMatch(/^Yes, I would like to receive the monthly letter/);
    expect(answerLabel({ id: "consent", type: "consent" } as never)).toBe("consent");
    expect(answerLabel({ id: "email", type: "email", label: "Work email" } as never)).toBe("Work email");
  });
});
