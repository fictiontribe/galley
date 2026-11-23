/**
 * Builder actions as edit ops on the form's file. Each touches only what it
 * changes: adding a field is one `insert` into `fields`, widening one is one
 * `set` (or `unset` back to the default), moving a field to another step is
 * one `set` of its `step`. Step changes renumber only the fields they must.
 */
import type { FieldPath } from "@galley/core/types";
import type { FormDefinition, FormField } from "@galley/core/kit";
import { insertOp, removeOp, type DataOp } from "@/features/content/form/ops";
import { toJson } from "./json";

export const FIELDS: FieldPath = ["fields"];
export const STEPS: FieldPath = ["steps"];

export const fieldPath = (index: number, ...rest: Array<string | number>): FieldPath => ["fields", index, ...rest];

/** The step a field is on (absent = the first). */
export function stepOf(field: Pick<FormField, "step">): number {
  return typeof field.step === "number" && field.step > 0 ? Math.floor(field.step) : 0;
}

/** How many steps the form has (at least 1). */
export function stepCount(form: Pick<FormDefinition, "steps" | "fields">): number {
  const declared = form.steps?.length ?? 0;
  const used = form.fields.reduce((most, field) => Math.max(most, stepOf(field) + 1), 1);
  return Math.max(1, declared, used);
}

/** Indexes (into `fields`) of the fields on one step, in file order. */
export function fieldsOnStep(fields: readonly Pick<FormField, "step">[], step: number): number[] {
  return fields.flatMap((field, index) => (stepOf(field) === step ? [index] : []));
}

/** Insert new fields at `index` (in order), as one batch. */
export function insertFieldsOps(index: number, fields: readonly FormField[]): DataOp[] {
  return fields.map((field, offset) => insertOp(FIELDS, index + offset, toJson(field)));
}

/** The undo of `insertFieldsOps`. */
export function removeInsertedOps(index: number, count: number): DataOp[] {
  return Array.from({ length: count }, () => removeOp(FIELDS, index));
}

/** Half or full width; "full" is the default and is written by removing the key. */
export function widthOps(form: FormDefinition, index: number, width: "full" | "half"): DataOp[] {
  const field = form.fields[index];
  if (!field) return [];
  const current = field.width ?? "full";
  if (current === width) return [];
  return width === "half" ? [{ op: "set", path: fieldPath(index, "width"), value: "half" }] : [{ op: "unset", path: fieldPath(index, "width") }];
}

/** Put a field on another step. */
export function moveToStepOps(form: FormDefinition, index: number, step: number): DataOp[] {
  const field = form.fields[index];
  if (!field || stepOf(field) === step) return [];
  return step === 0 ? [{ op: "unset", path: fieldPath(index, "step") }] : [{ op: "set", path: fieldPath(index, "step"), value: step }];
}

/** Titles for every step the form shows ("Step 2" where none is written). */
export function stepTitles(form: Pick<FormDefinition, "steps" | "fields">): string[] {
  return Array.from({ length: stepCount(form) }, (_, index) => form.steps?.[index]?.title?.trim() || `Step ${index + 1}`);
}

/** Add a step at the end. A one-step form gains its first two titles. */
export function addStepOps(form: FormDefinition): DataOp[] {
  const count = stepCount(form);
  const declared = form.steps?.length ?? 0;
  if (declared === 0) {
    const steps = Array.from({ length: count + 1 }, (_, index) => ({ title: `Step ${index + 1}` }));
    return [{ op: "set", path: STEPS, value: steps }];
  }
  const ops: DataOp[] = [];
  for (let index = declared; index <= count; index++) ops.push(insertOp(STEPS, index, { title: `Step ${index + 1}` }));
  return ops;
}

/** Rename a step (the list is filled up to it when the file has fewer titles). */
export function renameStepOps(form: FormDefinition, step: number, title: string): DataOp[] {
  const declared = form.steps?.length ?? 0;
  if (step < declared) return [{ op: "set", path: [...STEPS, step, "title"], value: title }];
  const ops: DataOp[] = [];
  if (declared === 0) {
    const steps = Array.from({ length: Math.max(step + 1, stepCount(form)) }, (_, index) => ({ title: index === step ? title : `Step ${index + 1}` }));
    return [{ op: "set", path: STEPS, value: steps }];
  }
  for (let index = declared; index <= step; index++) ops.push(insertOp(STEPS, index, { title: index === step ? title : `Step ${index + 1}` }));
  return ops;
}

/**
 * Remove a step: its fields join the step before it (or the next one, for the
 * first), later fields move up one step. With one step left the titles go.
 */
export function removeStepOps(form: FormDefinition, step: number): DataOp[] {
  const count = stepCount(form);
  if (count <= 1 || step < 0 || step >= count) return [];
  const ops: DataOp[] = [];
  const target = step === 0 ? 0 : step - 1;
  form.fields.forEach((field, index) => {
    const on = stepOf(field);
    let next = on;
    if (on === step) next = target;
    else if (on > step) next = on - 1;
    if (next === on) return;
    ops.push(next === 0 ? { op: "unset", path: fieldPath(index, "step") } : { op: "set", path: fieldPath(index, "step"), value: next });
  });
  const declared = form.steps?.length ?? 0;
  if (count - 1 <= 1) {
    if (declared > 0) ops.push({ op: "unset", path: STEPS });
  } else if (step < declared) ops.push(removeOp(STEPS, step));
  return ops;
}

/**
 * Rename a field's id, and every reference to it: conditions, destination
 * mappings and conditions, answers carried to a page.
 */
export function renameFieldOps(form: FormDefinition, index: number, next: string): DataOp[] {
  const field = form.fields[index];
  if (!field || !next || field.id === next) return [];
  const from = field.id;
  const ops: DataOp[] = [{ op: "set", path: fieldPath(index, "id"), value: next }];
  form.fields.forEach((other, at) => {
    if (other.showWhen?.field === from) ops.push({ op: "set", path: fieldPath(at, "showWhen", "field"), value: next });
  });
  form.destinations.forEach((destination, at) => {
    if (destination.when?.field === from) ops.push({ op: "set", path: ["destinations", at, "when", "field"], value: next });
    const mapped = destination.mapping?.[from];
    if (mapped !== undefined) {
      ops.push({ op: "unset", path: ["destinations", at, "mapping", from] });
      ops.push({ op: "set", path: ["destinations", at, "mapping", next], value: mapped });
    }
  });
  form.afterSubmit.forEach((action, at) => {
    if (action.type !== "redirect" || !action.passFields) return;
    action.passFields.forEach((id, position) => {
      if (id === from) ops.push({ op: "set", path: ["afterSubmit", at, "passFields", position], value: next });
    });
  });
  return ops;
}

/** What still names a field elsewhere in the form, counted by kind for the toast. */
export interface FieldUses {
  /** Ops that remove the uses — sent before the field itself is removed, so their indexes still hold. */
  ops: DataOp[];
  /** Ops that put them back — sent after the field is back in its place. */
  undo: DataOp[];
  rules: number;
  mappings: number;
  answers: number;
}

/**
 * Everything that names the field at `index`: other fields' "show only
 * when…" rules, destinations' conditions and mappings, answers passed on by a
 * redirect. Left behind they'd name a field the form doesn't have — which the
 * site's build refuses — so removing a field removes them in the same edit,
 * and one Undo puts all of it back.
 */
export function fieldUsesOps(form: FormDefinition, index: number): FieldUses {
  const id = form.fields[index]?.id;
  const out: FieldUses = { ops: [], undo: [], rules: 0, mappings: 0, answers: 0 };
  if (!id) return out;
  form.fields.forEach((other, at) => {
    if (at === index || other.showWhen?.field !== id) return;
    out.ops.push({ op: "unset", path: fieldPath(at, "showWhen") });
    out.undo.push({ op: "set", path: fieldPath(at, "showWhen"), value: toJson(other.showWhen) });
    out.rules += 1;
  });
  form.destinations.forEach((destination, at) => {
    if (destination.when?.field === id) {
      out.ops.push({ op: "unset", path: ["destinations", at, "when"] });
      out.undo.push({ op: "set", path: ["destinations", at, "when"], value: toJson(destination.when) });
      out.rules += 1;
    }
    const mapped = destination.mapping?.[id];
    if (mapped !== undefined) {
      out.ops.push({ op: "unset", path: ["destinations", at, "mapping", id] });
      out.undo.push({ op: "set", path: ["destinations", at, "mapping", id], value: mapped });
      out.mappings += 1;
    }
  });
  form.afterSubmit.forEach((action, at) => {
    if (action.type !== "redirect" || !action.passFields) return;
    const positions = action.passFields.flatMap((field, position) => (field === id ? [position] : []));
    // Highest first, so each removal leaves the next position where it was; put back lowest first.
    for (const position of [...positions].reverse()) out.ops.push(removeOp(["afterSubmit", at, "passFields"], position));
    for (const position of positions) out.undo.push(insertOp(["afterSubmit", at, "passFields"], position, id));
    out.answers += positions.length;
  });
  return out;
}

/** "2 rules and 1 mapping" — what went with the field, for the toast. */
export function describeUses(uses: Pick<FieldUses, "rules" | "mappings" | "answers">): string | null {
  const parts = [
    uses.rules ? `${uses.rules} ${uses.rules === 1 ? "rule" : "rules"}` : null,
    uses.mappings ? `${uses.mappings} ${uses.mappings === 1 ? "mapping" : "mappings"}` : null,
    uses.answers ? `${uses.answers === 1 ? "an answer" : `${uses.answers} answers`} passed to a page` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
