/**
 * Pure helpers for the inbox: what a row says, the answers in the form's
 * order, how the visitor arrived, and the answers a test submission sends.
 */
import type { FormDefinition, FormField, FormSubmission } from "@galley/core/kit";

const LAYOUT = new Set(["heading", "paragraph"]);

export interface LabelledAnswer {
  id: string;
  label: string;
  value: string;
  type: string;
}

function text(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : value;
}

/** Option values shown as their labels, ticked boxes as “Yes”. */
function display(field: FormField | undefined, value: string | string[]): string {
  if (!field) return text(value);
  if (field.type === "checkbox" || field.type === "consent") return value === "yes" ? "Yes" : text(value);
  if (field.options?.length) {
    const label = (item: string) => field.options?.find((option) => option.value === item)?.label || item;
    return Array.isArray(value) ? value.map(label).join(", ") : label(value);
  }
  return text(value);
}

/**
 * What an answer is called: the field's label; for a consent box with no
 * label, its own sentence (formatting marks dropped, cut short at a word);
 * the field's id only when there is nothing else.
 */
export function answerLabel(field: FormField): string {
  const label = field.label?.trim();
  if (label) return label;
  const sentence = (field.text ?? "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!sentence) return field.id;
  if (sentence.length <= 60) return sentence;
  const cut = sentence.slice(0, 59);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 59).replace(/[,;:.\s]+$/, "")}…`;
}

/** Every answer with its label, in the form's order; answers for fields the form no longer has come last under their ids. */
export function labelledAnswers(definition: FormDefinition | null, submission: FormSubmission): LabelledAnswer[] {
  const rows: LabelledAnswer[] = [];
  const seen = new Set<string>();
  for (const field of definition?.fields ?? []) {
    if (LAYOUT.has(field.type)) continue;
    seen.add(field.id);
    const value = submission.values[field.id];
    if (value === undefined) continue;
    rows.push({ id: field.id, label: answerLabel(field), value: display(field, value), type: field.type });
  }
  for (const [id, value] of Object.entries(submission.values)) {
    if (!seen.has(id)) rows.push({ id, label: id, value: text(value), type: "text" });
  }
  return rows;
}

const NAME_LIKE = /(^|[_-])(name|full_?name|first_?name|last_?name|surname|company|organisation|organization)($|[_-])/i;

/** The two or three most telling answers for a row: name-like and e-mail first, then the first other text. */
export function rowSummary(definition: FormDefinition | null, submission: FormSubmission, max = 3): string[] {
  const answers = labelledAnswers(definition, submission).filter((row) => row.type !== "hidden" && row.value.trim() !== "");
  const score = (row: LabelledAnswer) => {
    if (row.type === "email" || /e-?mail/i.test(row.id)) return 1;
    if (NAME_LIKE.test(row.id) || /name/i.test(row.label)) return 0;
    if (row.type === "textarea") return 3;
    return 2;
  };
  return [...answers]
    .sort((a, b) => score(a) - score(b) || answers.indexOf(a) - answers.indexOf(b))
    .slice(0, max)
    .map((row) => (row.value.length > 90 ? `${row.value.slice(0, 89)}…` : row.value).replace(/\s+/g, " "));
}

const UTM_LABELS: Record<string, string> = {
  utm_source: "Source",
  utm_medium: "Medium",
  utm_campaign: "Campaign",
  utm_term: "Term",
  utm_content: "Content",
};

/** How the visitor arrived: the page's utm_* parameters, then any UTM-filled hidden fields. */
export function arrival(definition: FormDefinition | null, submission: FormSubmission): Array<{ label: string; value: string }> {
  const out = new Map<string, string>();
  try {
    if (submission.page?.url) {
      for (const [key, value] of new URL(submission.page.url).searchParams) {
        if (key.startsWith("utm_") && value) out.set(UTM_LABELS[key] ?? key, value);
      }
    }
  } catch {
    // A stored page address that isn't one shows nothing here.
  }
  for (const field of definition?.fields ?? []) {
    if (field.autofill?.from !== "utm" || !field.autofill.key) continue;
    const value = text(submission.values[field.id]);
    const label = UTM_LABELS[field.autofill.key] ?? field.label ?? field.autofill.key;
    if (value && !out.has(label)) out.set(label, value);
  }
  return [...out].map(([label, value]) => ({ label, value }));
}

/** Answers that pass the form's own rules, for "Send a test submission". */
export function sampleAnswers(definition: FormDefinition): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const field of definition.fields) {
    if (LAYOUT.has(field.type) || field.showWhen) continue;
    const sample = sampleFor(field);
    if (sample !== undefined) values[field.id] = sample;
  }
  return values;
}

function sampleFor(field: FormField): string | string[] | undefined {
  const first = field.options?.[0]?.value;
  switch (field.type) {
    case "email":
      return "test.visitor@example.com";
    case "tel":
      return "+1 555 0100";
    case "url":
      return "https://example.com";
    case "number": {
      const min = field.validation?.min ?? 1;
      return String(min);
    }
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "select":
    case "radio":
      return first;
    case "checkboxes":
      return first ? [first] : undefined;
    case "checkbox":
    case "consent":
      return field.required ? "yes" : undefined;
    case "hidden":
      return field.defaultValue || (field.required ? "test" : undefined);
    case "textarea":
      return "This is a test submission sent from the inbox.";
    default: {
      if (field.defaultValue) return field.defaultValue;
      const base = /name/i.test(field.id) || /name/i.test(field.label ?? "") ? "Test visitor" : "Test";
      const min = field.validation?.minLength ?? 0;
      return base.length >= min ? base : base.padEnd(min, "x");
    }
  }
}
