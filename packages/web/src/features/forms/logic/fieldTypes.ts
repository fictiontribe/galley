/**
 * The field types offered in the palette, and the field each one starts as.
 * Defaults are what most forms want: an email field is labelled "Email",
 * required, and sent as `email`.
 */
import type { FormAutofill, FormField, FormFieldOption, FormFieldType } from "@galley/core/kit";
import { nameFromLabel, uniqueName } from "./names";
import { valueFromLabel } from "./options";

export type PaletteKind =
  | "text"
  | "email"
  | "tel"
  | "textarea"
  | "choice"
  | "checkboxes"
  | "checkbox"
  | "date"
  | "number"
  | "url"
  | "consent"
  | "hidden"
  | "heading"
  | "paragraph";

export interface PaletteItem {
  kind: PaletteKind;
  /** The type it is written as. */
  type: FormFieldType;
  label: string;
  /** Spoken and shown on hover: what it adds. */
  description: string;
  group: "fields" | "layout";
  /** A two-character glyph for the palette tile. */
  glyph: string;
}

export const PALETTE: readonly PaletteItem[] = [
  { kind: "text", type: "text", label: "Text", description: "A one-line answer", group: "fields", glyph: "Aa" },
  { kind: "email", type: "email", label: "Email", description: "An email address, checked as it’s typed", group: "fields", glyph: "@" },
  { kind: "tel", type: "tel", label: "Phone", description: "A phone number", group: "fields", glyph: "☏" },
  { kind: "textarea", type: "textarea", label: "Long text", description: "Several lines, for messages", group: "fields", glyph: "¶" },
  { kind: "choice", type: "select", label: "Choice", description: "One of several options, as a dropdown or a list", group: "fields", glyph: "▾" },
  { kind: "checkboxes", type: "checkboxes", label: "Checkboxes", description: "Any number of options", group: "fields", glyph: "☑" },
  { kind: "checkbox", type: "checkbox", label: "Yes-no box", description: "One box to tick", group: "fields", glyph: "✓" },
  { kind: "date", type: "date", label: "Date", description: "A day from a calendar", group: "fields", glyph: "31" },
  { kind: "number", type: "number", label: "Number", description: "A number, with an optional range", group: "fields", glyph: "#" },
  { kind: "url", type: "url", label: "Web address", description: "A link to a website", group: "fields", glyph: "↗" },
  { kind: "consent", type: "consent", label: "Consent", description: "An agreement with its own text", group: "fields", glyph: "§" },
  { kind: "hidden", type: "hidden", label: "Hidden / tracking", description: "Sent with the answers, never shown — campaign codes, the page address", group: "fields", glyph: "◌" },
  { kind: "heading", type: "heading", label: "Heading", description: "A sub-heading inside the form", group: "layout", glyph: "H" },
  { kind: "paragraph", type: "paragraph", label: "Text", description: "A line of explanation", group: "layout", glyph: "≡" },
];

export function paletteItem(kind: PaletteKind): PaletteItem {
  return PALETTE.find((item) => item.kind === kind) ?? (PALETTE[0] as PaletteItem);
}

/** The palette tile a field belongs to (select and radio are both "Choice"). */
export function kindOfField(field: Pick<FormField, "type">): PaletteKind {
  if (field.type === "select" || field.type === "radio") return "choice";
  return (PALETTE.find((item) => item.type === field.type)?.kind ?? "text") as PaletteKind;
}

/** The plain name of a field's type, for the inspector and screen readers. */
export function typeLabel(field: Pick<FormField, "type">): string {
  if (field.type === "select") return "Choice · dropdown";
  if (field.type === "radio") return "Choice · list";
  if (field.type === "paragraph") return "Text (layout)";
  return paletteItem(kindOfField(field)).label;
}

/** Layout items take no answer and are never sent. */
export function isLayout(field: Pick<FormField, "type">): boolean {
  return field.type === "heading" || field.type === "paragraph";
}

export function hasOptions(field: Pick<FormField, "type">): boolean {
  return field.type === "select" || field.type === "radio" || field.type === "checkboxes";
}

const options = (...labels: string[]): FormFieldOption[] => labels.map((label) => ({ value: valueFromLabel(label), label }));

interface Start {
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: FormFieldOption[];
  text?: string;
  autofill?: FormAutofill;
}

const STARTS: Record<PaletteKind, Start> = {
  text: { label: "Short answer" },
  email: { label: "Email", required: true },
  tel: { label: "Phone" },
  textarea: { label: "Message" },
  choice: { label: "Choose one", options: options("Option 1", "Option 2", "Option 3") },
  checkboxes: { label: "Choose any", options: options("Option 1", "Option 2", "Option 3") },
  checkbox: { label: "Keep me updated" },
  date: { label: "Date" },
  number: { label: "Number" },
  url: { label: "Website", placeholder: "https://" },
  consent: { label: "Consent", required: true, text: "I agree to the privacy policy." },
  hidden: { label: "Campaign", autofill: { from: "query", key: "campaign" } },
  heading: { label: "Heading", text: "About you" },
  paragraph: { label: "Text", text: "A line of explanation for the people filling this in." },
};

/**
 * A new field of this kind, with an id no other field has. Keys come in the
 * order people read them in the file: id, type, label, then the rest.
 */
export function defaultField(kind: PaletteKind, taken: Iterable<string>, step = 0): FormField {
  const item = paletteItem(kind);
  const start = STARTS[kind];
  const base = item.group === "layout" ? kind : nameFromLabel(start.label);
  const field: FormField = { id: uniqueName(base, taken), type: item.type, label: start.label };
  if (start.required) field.required = true;
  if (start.placeholder) field.placeholder = start.placeholder;
  if (start.options) field.options = start.options.map((option) => ({ ...option }));
  if (start.text) field.text = start.text;
  if (start.autofill) field.autofill = { ...start.autofill };
  if (step > 0) field.step = step;
  return field;
}
