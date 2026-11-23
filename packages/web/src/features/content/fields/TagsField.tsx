import { TagInput } from "@/ui/form/TagInput";
import { useForm } from "../form/context";
import { insertOp, removeOp } from "../form/ops";
import { useBinding } from "./binding";
import { type FieldProps } from "./common";
import { FieldShell } from "./FieldShell";

/** `tags`: chips. Adding is an insert at the end, removing is a remove — never a rewrite of the list. */
export function TagsField({ field, path, showKey }: FieldProps) {
  const { store } = useForm();
  const { value, focus } = useBinding(field, path);
  const tags = Array.isArray(value) ? value.map((tag) => (typeof tag === "string" ? tag : String(tag))) : [];
  return (
    <FieldShell field={field} path={path} showKey={showKey}>
      <TagInput
        tags={tags}
        label={field.label}
        suggestions={field.options}
        onFocus={focus}
        onAdd={(tag) => store.actions.apply(insertOp(path, tags.length, tag))}
        onRemove={(index) => store.actions.apply(removeOp(path, index))}
      />
    </FieldShell>
  );
}
