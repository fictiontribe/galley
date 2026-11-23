/**
 * Fields read from a form on the provider's side, turned into this form's
 * fields — each mapped back to the provider's own name.
 */
import type { FormIntrospectField } from "@galley/core/api";
import type { FormField, FormFieldType } from "@galley/core/kit";
import { nameFromLabel, uniqueName } from "./names";

const TYPES: Record<string, FormFieldType> = {
  email: "email",
  text: "text",
  string: "text",
  single_line_text: "text",
  textarea: "textarea",
  multi_line_text: "textarea",
  phone: "tel",
  tel: "tel",
  phonenumber: "tel",
  number: "number",
  numeric: "number",
  url: "url",
  date: "date",
  select: "select",
  dropdown: "select",
  picklist: "select",
  radio: "radio",
  checkbox: "checkbox",
  booleancheckbox: "checkbox",
  checkboxes: "checkboxes",
  multiselect: "checkboxes",
  hidden: "hidden",
};

export function fieldTypeFor(remote: FormIntrospectField): FormFieldType {
  if (remote.type) {
    const key = remote.type.toLowerCase().replace(/[\s-]+/g, "_");
    const type = TYPES[key] ?? TYPES[key.replace(/_/g, "")];
    if (type) return type;
  }
  if (/mail/.test(remote.name.toLowerCase())) return "email";
  return remote.options?.length ? "select" : "text";
}

export interface ImportPlan {
  fields: FormField[];
  /** Field id → the provider's name, for this destination's mapping. */
  mapping: Array<{ fieldId: string; name: string }>;
  /** Provider fields this form already sends (by mapped or own name). */
  skipped: string[];
}

/** New fields for the chosen provider fields, skipping any the form already sends under that name. */
export function planImport(remote: readonly FormIntrospectField[], existing: readonly Pick<FormField, "id">[], alreadySent: ReadonlySet<string>): ImportPlan {
  const taken = existing.map((field) => field.id);
  const fields: FormField[] = [];
  const mapping: ImportPlan["mapping"] = [];
  const skipped: string[] = [];
  for (const item of remote) {
    if (alreadySent.has(item.name)) {
      skipped.push(item.name);
      continue;
    }
    const label = item.label?.trim() || item.name;
    const id = uniqueName(nameFromLabel(label), [...taken, ...fields.map((field) => field.id)]);
    const type = fieldTypeFor(item);
    const field: FormField = { id, type, label };
    if (item.required) field.required = true;
    if (item.options?.length && (type === "select" || type === "radio" || type === "checkboxes")) field.options = item.options.map((option) => ({ value: option.value, label: option.label || option.value }));
    fields.push(field);
    if (item.name !== id) mapping.push({ fieldId: id, name: item.name });
  }
  return { fields, mapping, skipped };
}
