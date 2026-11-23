import { useEffect, useState } from "react";
import type { FormField } from "@galley/core/kit";
import { useForm } from "@/features/content/form/context";
import { Field, Input } from "@/ui";
import { fieldPath, renameFieldOps } from "../logic/fieldOps";
import { readForm } from "../logic/json";
import { cleanName, sentName } from "../logic/names";
import { useEdits } from "../file/hooks";
import { useBuilder } from "../editor/builderState";

/**
 * The name an answer is sent under. Usually the field's id: renaming it also
 * renames every rule and mapping that points at it. When the file gives the
 * field a separate `name`, that is what's edited.
 */
export function NameEditor({ index, field }: { index: number; field: FormField }) {
  const { store } = useForm();
  const edits = useEdits();
  const select = useBuilder((s) => s.select);
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? sentName(field);
  useEffect(() => setTyped(null), [field.id, field.name]);

  const others = readForm(store.getState().data).fields.filter((_, at) => at !== index);
  const clean = cleanName(shown);
  const taken = Boolean(clean) && others.some((other) => other.id === clean || other.name === clean);
  const problem = !clean ? "A field needs a name to be sent under." : taken ? `Another field is already sent as “${clean}”.` : clean !== shown ? "Names use letters, digits, hyphens and underscores only." : null;

  const save = () => {
    if (typed === null) return;
    setTyped(null);
    if (!clean || taken || clean === sentName(field)) return;
    if (field.name) {
      edits.apply({ op: "set", path: fieldPath(index, "name"), value: clean });
      return;
    }
    edits.apply(...renameFieldOps(readForm(store.getState().data), index, clean));
    select(clean);
  };

  return (
    <Field label="Name that is sent" hint={problem ? undefined : "What destinations receive this answer as, unless a destination maps it to another name."} error={problem}>
      <Input
        mono
        value={shown}
        spellCheck={false}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") setTyped(null);
        }}
      />
    </Field>
  );
}
