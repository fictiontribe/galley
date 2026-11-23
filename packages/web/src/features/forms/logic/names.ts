/**
 * Field names. A field's id is the name it is sent under (unless the file
 * sets `name`), so a new field takes its id from its label — "Company size"
 * → `company_size` — and, while it is new, keeps following the label until
 * someone edits the name by hand or something else refers to it.
 */
import type { FormDefinition, FormField } from "@galley/core/kit";

const MAX = 40;

/** "Company size (staff)" → "company_size_staff". Empty labels give "field". */
export function nameFromLabel(label: string): string {
  const base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX)
    .replace(/_+$/g, "");
  if (!base) return "field";
  return /^[0-9]/.test(base) ? `field_${base}` : base;
}

/** What a typed name becomes: lowercase letters, digits, hyphens and underscores. */
export function cleanName(typed: string): string {
  return typed
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, MAX * 2);
}

/** `base`, or `base_2`, `base_3`… — the first one not in `taken`. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The name a field is sent under when a destination's mapping doesn't say otherwise. */
export function sentName(field: Pick<FormField, "id" | "name">): string {
  return field.name || field.id;
}

/** Whether anything in the form points at this field id (conditions, mappings, carried answers). */
export function isReferenced(form: FormDefinition, id: string): boolean {
  if (form.fields.some((field) => field.showWhen?.field === id)) return true;
  if (form.destinations.some((destination) => destination.when?.field === id || Boolean(destination.mapping && Object.hasOwn(destination.mapping, id)))) return true;
  return form.afterSubmit.some((action) => action.type === "redirect" && action.passFields?.includes(id));
}

/**
 * The id a newly added field should take for its new label, or null when it
 * should keep the one it has (the file names it separately, or something
 * already points at it). Only for fields added in this session — existing
 * fields never change the name they are sent under because a label changed.
 */
export function idFollowingLabel(form: FormDefinition, index: number, nextLabel: string): string | null {
  const field = form.fields[index];
  if (!field || field.name || isReferenced(form, field.id)) return null;
  const others = form.fields.filter((_, at) => at !== index).map((other) => other.id);
  const next = uniqueName(nameFromLabel(nextLabel), others);
  return next === field.id ? null : next;
}
