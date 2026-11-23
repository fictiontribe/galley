/**
 * Server-side checks of a submission against its form definition. A static
 * site's own script checks answers before sending them, but anyone can post
 * to the capture address, so every rule is checked again here — in the same
 * words the form builder's "Test" run and the site's script use, so a visitor
 * never sees two different messages for one mistake.
 *
 * Rules, per field: layout fields (heading, paragraph) take no answer; a
 * field whose "show only when…" rule doesn't hold is ignored (its answer is
 * dropped and it can't be required); an answer for a field the form doesn't
 * have is dropped and counted.
 */
import type { FormDefinition, FormField } from "../kit";
import { FREE_MAILBOXES, matchesPattern } from "./shared";

/**
 * The free mailboxes and the pattern guard live in ./shared.ts, which has no
 * dependencies, so the web app checks answers with the very same data.
 */
export { FREE_MAILBOXES } from "./shared";

/** The value a ticked yes/no box is stored as. */
export const TICKED = "yes";

/** Longest single-line answer kept when the field sets no limit of its own. */
export const DEFAULT_MAX_LENGTH = 2000;
/** Longest multi-line answer kept when the field sets no limit. The 64 KB body limit applies anyway. */
export const DEFAULT_TEXTAREA_MAX_LENGTH = 20_000;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_LIKE = /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i;
const PHONE = /^[+()0-9 .-]{6,}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LAYOUT = new Set(["heading", "paragraph"]);
const CHOICE = new Set(["select", "radio", "checkboxes"]);
const UNTICKED = new Set(["", "false", "no", "off", "0"]);

export type Answer = string | string[];
export type Answers = { [fieldId: string]: Answer };

export interface ValidationOutcome {
  /** The answers that are kept: known, shown, trimmed. Empty answers are left out. */
  values: Answers;
  /** Field id → a plain message for the visitor. Empty when everything is fine. */
  errors: { [fieldId: string]: string };
  /** Answers for fields the form doesn't have. */
  dropped: number;
  /** Answers for fields hidden by their "show only when…" rule. */
  ignored: number;
}

export function isLayoutField(field: FormField): boolean {
  return LAYOUT.has(field.type);
}

function asList(value: Answer | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Whether a field's "show only when…" rule holds — the builder's semantics exactly. */
export function ruleHolds(rule: NonNullable<FormField["showWhen"]>, answers: Answers): boolean {
  const given = asList(answers[rule.field]);

  if (rule.equals !== undefined) return given.includes(rule.equals);
  if (rule.notEquals !== undefined) return !given.includes(rule.notEquals);
  if (rule.in) return given.some((value) => rule.in?.includes(value));
  return given.some((value) => value.trim() !== "");
}

function isRealDate(text: string): boolean {
  const match = DATE.exec(text);

  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Normalises the raw answer for a field: trimmed text, a list for multi-choice, "yes" or nothing for a box. */
function normalise(field: FormField, raw: unknown): Answer | undefined | { error: string } {
  if (raw === undefined || raw === null) return undefined;
  if (field.type === "checkboxes") {
    const list = Array.isArray(raw) ? raw : [raw];

    if (!list.every((item) => typeof item === "string")) return { error: "Choose an option." };
    const values = [...new Set((list as string[]).map((item) => item.trim()).filter(Boolean))];

    return values.length ? values : undefined;
  }
  if (Array.isArray(raw)) {
    if (raw.length === 1 && typeof raw[0] === "string") raw = raw[0];
    else return { error: "This takes one answer." };
  }
  if (typeof raw !== "string") return { error: "This takes one answer." };
  if (field.type === "checkbox" || field.type === "consent") return UNTICKED.has(raw.trim().toLowerCase()) ? undefined : TICKED;
  const text = field.type === "textarea" ? raw.replace(/\r\n?/g, "\n").trim() : raw.trim();

  return text === "" ? undefined : text;
}

/** What's wrong with one shown field's answer, or null. */
function check(field: FormField, value: Answer | undefined): string | null {
  const v = field.validation ?? {};

  if (value === undefined) {
    if (!field.required) return null;
    if (field.type === "consent" || field.type === "checkbox") return "Tick this box to continue.";
    return CHOICE.has(field.type) ? "Choose an option." : "Fill this in.";
  }
  if (CHOICE.has(field.type)) {
    const allowed = new Set((field.options ?? []).map((option) => option.value));
    // A form whose choices are filled in on the page keeps no option list; nothing to compare with then.
    if (allowed.size && !asList(value).every((item) => allowed.has(item))) return "Choose one of the options given.";
    if (field.type !== "checkboxes") return null;
  }
  const text = Array.isArray(value) ? value.join(", ") : value;

  if (field.type === "email") {
    if (!EMAIL.test(text)) return "Enter an e-mail address, like name@example.com.";
    const domain = text.split("@")[1]?.toLowerCase() ?? "";

    if (v.businessEmailOnly && FREE_MAILBOXES.includes(domain)) return v.message || "Use your work e-mail address.";
  }
  if (field.type === "url" && !URL_LIKE.test(text)) return "Enter a web address, like example.com.";
  if (field.type === "tel" && !PHONE.test(text)) return "Enter a phone number.";
  if (field.type === "date" && !isRealDate(text)) return "Enter a date, like 2026-03-14.";
  if (field.type === "number") {
    const number = Number(text);

    if (!Number.isFinite(number)) return "Enter a number.";
    if (v.min !== undefined && number < v.min) return v.message || `Enter ${v.min} or more.`;
    if (v.max !== undefined && number > v.max) return v.message || `Enter ${v.max} or less.`;
  }
  const maxLength = v.maxLength ?? (field.type === "textarea" ? DEFAULT_TEXTAREA_MAX_LENGTH : DEFAULT_MAX_LENGTH);

  if (v.minLength !== undefined && text.length < v.minLength) return v.message || `Use at least ${v.minLength} characters.`;
  if (text.length > maxLength) return v.message || `Use ${maxLength} characters or fewer.`;
  // Patterns come from the site's own form file. The whole answer must match,
  // as in the browser; one that can't be compiled, that the guard calls slow,
  // or an answer too long to check safely is skipped — never fatal for the
  // visitor, and never able to stall this server (shared.ts, "the pattern guard").
  if (v.pattern && matchesPattern(v.pattern, text) === false) return v.message || "This doesn’t look right. Check it and try again.";
  return null;
}

/**
 * Check `raw` (the `values` of a posted submission) against `form`. Hidden
 * fields (type "hidden") are filled on the page, so only their length is
 * checked — and "required" still holds for them.
 */
export function validateSubmission(form: FormDefinition, raw: unknown): ValidationOutcome {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const known = new Map(form.fields.filter((field) => !isLayoutField(field)).map((field) => [field.id, field]));
  const errors: ValidationOutcome["errors"] = {};
  const normalised: Answers = {};
  let dropped = 0;

  for (const key of Object.keys(input)) {
    const field = known.get(key);

    if (!field) {
      dropped += 1;
      continue;
    }
    const value = normalise(field, input[key]);

    if (value && typeof value === "object" && !Array.isArray(value)) errors[key] = value.error;
    else if (value !== undefined) normalised[key] = value;
  }

  const hidden = hiddenFields([...known.values()], normalised);
  const values: Answers = {};
  let ignored = 0;

  for (const field of known.values()) {
    if (hidden.has(field.id)) {
      if (normalised[field.id] !== undefined) ignored += 1;
      delete errors[field.id];
      continue;
    }
    if (errors[field.id]) continue;
    const message = field.type === "hidden" ? hiddenCheck(field, normalised[field.id]) : check(field, normalised[field.id]);

    if (message) errors[field.id] = message;
    else if (normalised[field.id] !== undefined) values[field.id] = normalised[field.id]!;
  }
  return { values, errors, dropped, ignored };
}

/**
 * Fields hidden by their rule. A field shown only when a hidden field has an
 * answer is hidden too — that answer is never sent — so the rules are
 * re-evaluated without the hidden answers until nothing changes.
 */
function hiddenFields(fields: FormField[], answers: Answers): Set<string> {
  let hidden = new Set<string>();

  for (let round = 0; round <= fields.length; round += 1) {
    const visible: Answers = {};

    for (const [id, value] of Object.entries(answers)) if (!hidden.has(id)) visible[id] = value;
    const next = new Set(fields.filter((field) => field.showWhen && !ruleHolds(field.showWhen, visible)).map((field) => field.id));

    if (next.size === hidden.size && [...next].every((id) => hidden.has(id))) return next;
    hidden = next;
  }
  return hidden;
}

function hiddenCheck(field: FormField, value: Answer | undefined): string | null {
  if (value === undefined) return field.required ? "Fill this in." : null;
  const text = Array.isArray(value) ? value.join(", ") : value;

  return text.length > (field.validation?.maxLength ?? DEFAULT_MAX_LENGTH) ? "This is too long." : null;
}
