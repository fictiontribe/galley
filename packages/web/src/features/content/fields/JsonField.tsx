import { useState } from "react";
import type { JsonValue } from "@galley/core/types";
import { CodeEditor } from "@/ui/form/CodeEditor";
import { useBinding } from "./binding";
import { type FieldProps } from "./common";
import { FieldShell } from "./FieldShell";

function format(value: JsonValue | undefined): string {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

/** `json`: anything the form has no control for, edited as structured text. Only readable text is saved. */
export function JsonField({ field, path, showKey }: FieldProps) {
  const { value, change, commit, focus } = useBinding(field, path);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <FieldShell field={field} path={path} showKey={showKey} group note={problem ?? undefined}>
      <CodeEditor
        value={format(value)}
        language="json"
        label={field.label}
        onFocus={focus}
        onBlur={commit}
        onChange={(text) => {
          if (text.trim() === "") {
            setProblem(null);
            change(undefined);
            return;
          }
          try {
            change(JSON.parse(text) as JsonValue);
            setProblem(null);
          } catch {
            setProblem("This can’t be read yet — check the brackets, quotes and commas. It isn’t saved until it can.");
          }
        }}
      />
    </FieldShell>
  );
}
