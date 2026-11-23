/**
 * Validation, in friendly presets first and a custom pattern last, and the
 * checks the "Test" run makes on an answer — the same rules the field's
 * settings describe.
 */
import type { FormField } from "@galley/core/kit";
import { FREE_MAILBOXES, PATTERN_RISK_MESSAGE, patternRisk } from "@galley/core/forms/shared";
import { isLayout } from "./fieldTypes";

export type Validation = NonNullable<FormField["validation"]>;

export interface PatternPreset {
  id: string;
  label: string;
  pattern: string;
  message: string;
}

/** Patterns people ask for, by what they mean. */
export const PATTERN_PRESETS: readonly PatternPreset[] = [
  { id: "letters", label: "Letters and spaces only", pattern: "^[\\p{L} .'-]+$", message: "Use letters only." },
  { id: "digits", label: "Digits only", pattern: "^[0-9]+$", message: "Use digits only." },
  { id: "us-zip", label: "US ZIP code", pattern: "^[0-9]{5}(-[0-9]{4})?$", message: "Enter a 5-digit ZIP code." },
  { id: "no-links", label: "No links", pattern: "^(?![\\s\\S]*(https?://|www\\.))[\\s\\S]*$", message: "Leave out links, please." },
];

export type PatternChoice = "none" | "custom" | (string & {});

/** Which preset a field's pattern is (or "custom" for anything else, "none" when there is none). */
export function patternChoice(validation: Validation | undefined): PatternChoice {
  const pattern = validation?.pattern;
  if (!pattern) return "none";
  return PATTERN_PRESETS.find((preset) => preset.pattern === pattern)?.id ?? "custom";
}

export function presetById(id: string): PatternPreset | undefined {
  return PATTERN_PRESETS.find((preset) => preset.id === id);
}

/** Whether a custom pattern can be used at all; the plain reason when it can't, or when it could stall the site's form. */
export function patternProblem(pattern: string): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern, "u");
  } catch {
    return "This pattern can’t be read, so it won’t be checked. Check its brackets and backslashes.";
  }
  // The same rule the capture server applies, so the builder says it before Proof does.
  return patternRisk(pattern) ? PATTERN_RISK_MESSAGE.replace("site's", "site’s") : null;
}

/**
 * Free mailbox providers refused by "business email only": the one list the
 * capture server uses too, from the engine's dependency-free shared module
 * (the site kit's free-email-domains.js is its source; a test keeps them equal).
 */
export { FREE_MAILBOXES };

/** What visitors are told — the site runtime's own default words (a site may change them). */
export const RUNTIME_MESSAGES = {
  required: "Fill in this answer.",
  requiredChoice: "Choose an answer.",
  requiredCheck: "Tick this box to continue.",
  email: "Enter an email address, like name@example.com.",
  businessEmail: "Use your work email address. {domain} is a personal mailbox.",
  url: "Enter a full web address, starting with https://.",
  tel: "Enter a phone number, using digits.",
  number: "Enter a number.",
  date: "Enter a date.",
  min: "Enter {min} or more.",
  max: "Enter {max} or less.",
  minLength: "Use at least {min} characters.",
  maxLength: "Use {max} characters or fewer.",
  pattern: "Check the format of this answer.",
} as const;

export type Answer = string | string[];

const asList = (value: Answer | undefined): string[] => (Array.isArray(value) ? value : value ? [value] : []).filter((item) => item !== "");

/**
 * What's wrong with an answer, in the words a visitor would see, or null when
 * it's fine. Mirrors the site runtime's check (`@galley/astro` forms/logic.js
 * `problem`) so a test run refuses exactly what the live form refuses: the
 * field's own message, when it has one, replaces every default.
 */
export function checkAnswer(field: FormField, value: Answer | undefined): string | null {
  const rules = field.validation ?? {};
  const say = (key: keyof typeof RUNTIME_MESSAGES, vars: Record<string, string | number> = {}) =>
    rules.message || RUNTIME_MESSAGES[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
  const list = asList(value);
  const text = Array.isArray(value) ? value.join(",") : (value ?? "");
  if (isLayout(field) || field.type === "hidden") return null;
  if (list.length === 0 || ((field.type === "checkbox" || field.type === "consent") && text !== "true")) {
    if (!field.required) return null;
    if (field.type === "checkbox" || field.type === "consent") return say("requiredCheck");
    return say(field.type === "select" || field.type === "radio" || field.type === "checkboxes" ? "requiredChoice" : "required");
  }
  switch (field.type) {
    case "email": {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return say("email");
      const domain = text.split("@").pop()?.toLowerCase() ?? "";
      if (rules.businessEmailOnly && FREE_MAILBOXES.includes(domain)) return say("businessEmail", { domain });
      break;
    }
    case "url":
      try {
        if (!/^https?:$/.test(new URL(text).protocol)) return say("url");
      } catch {
        return say("url");
      }
      break;
    case "tel":
      if (!/^[+()\d\s./-]+$/.test(text) || text.replace(/\D/g, "").length < 5) return say("tel");
      break;
    case "number": {
      const number = Number(text);
      if (!Number.isFinite(number) || text.trim() === "") return say("number");
      if (rules.min !== undefined && number < rules.min) return say("min", { min: rules.min });
      if (rules.max !== undefined && number > rules.max) return say("max", { max: rules.max });
      break;
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) return say("date");
      break;
    case "select":
    case "radio":
    case "checkboxes":
      if (field.options && !list.every((item) => field.options?.some((option) => option.value === item))) return say("requiredChoice");
      break;
  }
  if (field.type !== "checkboxes" && field.type !== "number") {
    if (rules.minLength !== undefined && text.length < rules.minLength) return say("minLength", { min: rules.minLength });
    if (rules.maxLength !== undefined && text.length > rules.maxLength) return say("maxLength", { max: rules.maxLength });
  }
  if (rules.pattern) {
    try {
      if (!new RegExp(`^(?:${rules.pattern})$`, "u").test(text)) return say("pattern");
    } catch {
      return null;
    }
  }
  return null;
}

/** One line for the canvas: what the field's rules are, or null when it has none beyond required. */
export function describeValidation(field: FormField): string | null {
  const v = field.validation;
  if (!v) return null;
  const parts: string[] = [];
  if (v.businessEmailOnly) parts.push("work email only");
  if (v.minLength !== undefined && v.maxLength !== undefined) parts.push(`${v.minLength}–${v.maxLength} characters`);
  else if (v.minLength !== undefined) parts.push(`at least ${v.minLength} characters`);
  else if (v.maxLength !== undefined) parts.push(`up to ${v.maxLength} characters`);
  if (v.min !== undefined && v.max !== undefined) parts.push(`${v.min} to ${v.max}`);
  else if (v.min !== undefined) parts.push(`${v.min} or more`);
  else if (v.max !== undefined) parts.push(`${v.max} or less`);
  const choice = patternChoice(v);
  if (choice === "custom") parts.push("custom check");
  else if (choice !== "none") parts.push(presetById(choice)?.label.toLowerCase() ?? "");
  return parts.length ? parts.join(" · ") : null;
}
