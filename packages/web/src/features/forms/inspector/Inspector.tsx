import { useMemo } from "react";
import { useFormState } from "@/features/content/form/context";
import { slotsOf, structureOf } from "../logic/structure";
import { useBuilder } from "../editor/builderState";
import { FieldInspector } from "./FieldInspector";
import { FormSettings } from "./FormSettings";

/** The right-hand panel: the selected field's settings, or the form's own. */
export function Inspector() {
  const selected = useBuilder((s) => s.selected);
  const structure = useFormState((state) => structureOf(state.data.fields));
  const slot = useMemo(() => slotsOf(structure).find((candidate) => candidate.key === selected) ?? null, [structure, selected]);
  return <div className="kit-inspector">{slot ? <FieldInspector key={slot.index} index={slot.index} fieldKey={slot.key} /> : <FormSettings />}</div>;
}
