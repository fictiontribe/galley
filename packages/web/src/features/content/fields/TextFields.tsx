import { useState } from "react";
import { Input, Textarea } from "@/ui";
import { placeholderFor, type FieldProps } from "./common";
import { asText, useBinding } from "./binding";
import { FieldShell } from "./FieldShell";

/** `string`: one line. */
export function StringField({ field, path, showKey }: FieldProps) {
  const { value, change, commit, focus } = useBinding(field, path);
  return (
    <FieldShell field={field} path={path} showKey={showKey}>
      <Input value={asText(value)} placeholder={placeholderFor(field)} onChange={(event) => change(event.target.value)} onBlur={commit} onFocus={focus} />
    </FieldShell>
  );
}

/** `text`: several lines, growing with the text. */
export function TextField({ field, path, showKey }: FieldProps) {
  const { value, change, commit, focus } = useBinding(field, path);
  return (
    <FieldShell field={field} path={path} showKey={showKey}>
      <Textarea value={asText(value)} placeholder={placeholderFor(field)} maxRows={14} onChange={(event) => change(event.target.value)} onBlur={commit} onFocus={focus} />
    </FieldShell>
  );
}

/** `number`: typed as text so half-typed numbers ("1.", "-") don't jump; only real numbers are sent. */
export function NumberField({ field, path, showKey }: FieldProps) {
  const { value, change, commit, focus } = useBinding(field, path);
  const stored = typeof value === "number" ? String(value) : asText(value);
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? stored;
  const invalid = typed !== null && typed.trim() !== "" && !Number.isFinite(Number(typed));

  return (
    <FieldShell field={field} path={path} showKey={showKey} note={invalid ? "This isn’t a number yet, so it hasn’t been saved." : undefined}>
      <Input
        inputMode="decimal"
        className="app-input--number"
        value={shown}
        placeholder={placeholderFor(field)}
        aria-invalid={invalid || undefined}
        onFocus={focus}
        onChange={(event) => {
          const text = event.target.value;
          setTyped(text);
          if (text.trim() === "") change(undefined);
          else if (Number.isFinite(Number(text))) change(Number(text));
        }}
        onBlur={() => {
          setTyped(null);
          commit();
        }}
      />
    </FieldShell>
  );
}
