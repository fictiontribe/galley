/**
 * What the palette, canvas and inspector do to the field list. Moves and
 * removals go through the same list plans as the content form's section
 * cards (so they produce the same edits), and offer Undo.
 */
import { useMemo, useRef } from "react";
import type { FormField } from "@galley/core/kit";
import { useForm } from "@/features/content/form/context";
import { planMove, planRemove } from "@/features/content/fields/items/listPlan";
import { insertOp } from "@/features/content/form/ops";
import { notify, useToasts } from "@/lib/stores/toasts";
import { defaultField, type PaletteKind } from "../logic/fieldTypes";
import { describeUses, FIELDS, fieldUsesOps, insertFieldsOps, moveToStepOps, removeInsertedOps, stepOf, widthOps } from "../logic/fieldOps";
import { readForm, toJson } from "../logic/json";
import { uniqueName } from "../logic/names";
import { useBuilderStore } from "./builderState";

export interface FieldActions {
  /** Add a field of this kind at `index` (on the step showing); selects it. */
  add: (kind: PaletteKind, index?: number) => void;
  /** Add ready-made fields at the end, as one edit. */
  addMany: (fields: FormField[], label: string) => void;
  move: (from: number, to: number, options?: { announce?: boolean }) => void;
  duplicate: (index: number) => void;
  remove: (index: number) => void;
  width: (index: number, width: "full" | "half") => void;
  toStep: (index: number, step: number) => void;
}

const labelOf = (field: FormField | undefined) => field?.label?.trim() || field?.text?.trim().slice(0, 40) || field?.id || "Field";

const MOVE_TOAST_MS = 8000;

export function useFieldActions(): FieldActions {
  const { store } = useForm();
  const builder = useBuilderStore();
  const lastMove = useRef<{ fieldId: string; origin: number; at: number; toastId: number; time: number } | null>(null);

  return useMemo<FieldActions>(() => {
    const form = () => readForm(store.getState().data);
    const apply = store.actions.apply;
    const ids = () => form().fields.map((field) => field.id);
    return {
      add(kind, index) {
        const current = form();
        const step = builder.getState().step;
        const at = index ?? current.fields.length;
        const field = defaultField(kind, ids(), step);
        apply(...insertFieldsOps(at, [field]));
        builder.getState().markFresh(field.id);
        builder.getState().select(field.id);
      },
      addMany(fields, label) {
        if (fields.length === 0) return;
        const at = form().fields.length;
        const step = builder.getState().step;
        const placed = fields.map((field) => (step > 0 ? { ...field, step } : field));
        apply(...insertFieldsOps(at, placed));
        notify({
          tone: "neutral",
          title: `${label} added`,
          body: `${fields.length} hidden ${fields.length === 1 ? "field" : "fields"} at the end of the form. Visitors don’t see them; they’re sent with the answers.`,
          action: { label: "Undo", onClick: () => apply(...removeInsertedOps(at, placed.length)) },
          duration: 10000,
        });
      },
      move(from, to, options) {
        const current = form();
        const plan = planMove(FIELDS, current.fields.length, from, to);
        if (!plan) return;
        apply(...plan.ops);
        if (!options?.announce) return;
        const field = current.fields[from];
        // Moving one field again and again (Alt+↓ three times) is one move to the person: one toast, whose Undo puts it back where it started.
        const last = lastMove.current;
        const continuing = last !== null && last.fieldId === field?.id && last.at === from && Date.now() - last.time < MOVE_TOAST_MS;
        const origin = continuing ? last.origin : from;
        if (continuing) useToasts.getState().dismiss(last.toastId);
        const toastId = notify({
          tone: "neutral",
          title: `${labelOf(field)} moved`,
          action: {
            label: "Undo",
            onClick: () => {
              lastMove.current = null;
              const back = planMove(FIELDS, form().fields.length, to, origin);
              if (back) apply(...back.ops);
            },
          },
          duration: MOVE_TOAST_MS,
        });
        lastMove.current = field ? { fieldId: field.id, origin, at: to, toastId, time: Date.now() } : null;
      },
      duplicate(index) {
        const current = form();
        const field = current.fields[index];
        if (!field) return;
        const copy: FormField = { ...structuredClone(field), id: uniqueName(field.id || "field", ids()) };
        if (copy.label) copy.label = `${copy.label} (copy)`;
        apply(insertOp(FIELDS, index + 1, toJson(copy)));
        builder.getState().select(copy.id, true);
      },
      remove(index) {
        const current = form();
        const raw = store.getState().data.fields;
        const plan = planRemove(FIELDS, Array.isArray(raw) ? raw : [], index);
        if (!plan) return;
        const field = current.fields[index];
        // Rules, mappings and passed answers naming the field go with it, in the same edit and the same Undo.
        const uses = fieldUsesOps(current, index);
        const went = describeUses(uses);
        apply(...uses.ops, ...plan.ops);
        if (builder.getState().selected === field?.id) builder.getState().select(null);
        notify({
          tone: "neutral",
          title: `${labelOf(field)} removed`,
          body: went ? `The ${went} that named it went too, so nothing points at a missing field. Undo puts all of it back.` : "The field is gone from this form. Undo puts it back where it was.",
          action: { label: "Undo", onClick: () => apply(...plan.undo, ...uses.undo) },
          duration: 10000,
        });
      },
      width(index, width) {
        apply(...widthOps(form(), index, width));
      },
      toStep(index, step) {
        const current = form();
        const field = current.fields[index];
        if (!field || stepOf(field) === step) return;
        apply(...moveToStepOps(current, index, step));
        builder.getState().setStep(step);
      },
    };
  }, [store, builder]);
}
