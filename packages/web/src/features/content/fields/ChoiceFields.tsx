import { useState } from "react";
import { Input, Select, Toggle } from "@/ui";
import { fromDateInput, fromDateTimeInput, isPickable, toDateInput, toDateTimeInput } from "../form/dates";
import { asText, useBinding } from "./binding";
import { placeholderFor, type FieldProps } from "./common";
import { FieldShell } from "./FieldShell";

/** `boolean`: a switch, sent at once. */
export function BooleanField({ field, path, showKey }: FieldProps) {
  const { value, change, focus } = useBinding(field, path, true);
  return (
    <FieldShell field={field} path={path} showKey={showKey}>
      <span className="app-toggle-inline" onFocus={focus}>
        <Toggle checked={value === true} onChange={(checked) => change(checked)} />
        <span className="g-hint" aria-hidden="true">
          {value === true ? "On" : "Off"}
        </span>
      </span>
    </FieldShell>
  );
}

/** `select`: one of the field's options; the stored value stays listed even when it isn't one of them. */
export function SelectField({ field, path, showKey }: FieldProps) {
  const { value, change, focus } = useBinding(field, path, true);
  const current = asText(value);
  const options = (field.options ?? []).map((option) => ({ value: option, label: option }));
  if (current && !options.some((option) => option.value === current)) options.unshift({ value: current, label: current });
  return (
    <FieldShell field={field} path={path} showKey={showKey}>
      <Select
        value={current}
        options={options}
        placeholder={field.required && current ? undefined : "Choose…"}
        onChange={(next) => change(next === "" ? undefined : next)}
        onFocus={focus}
      />
    </FieldShell>
  );
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function swatchValue(text: string): string {
  if (!HEX.test(text)) return "#000000";
  if (text.length === 4) return `#${[...text.slice(1)].map((ch) => ch + ch).join("")}`.toLowerCase();
  return text.toLowerCase();
}

/** `color`: a swatch picker beside the hex, written as typed. */
export function ColorField({ field, path, showKey }: FieldProps) {
  const { value, change, commit, focus } = useBinding(field, path);
  const text = asText(value);
  return (
    <FieldShell field={field} path={path} showKey={showKey} note={text && !HEX.test(text) ? "The swatch can only show hex colors like #2E2BFF." : undefined}>
      <span className="app-color">
        <input
          type="color"
          className="app-color__swatch"
          aria-label={`${field.label} swatch`}
          value={swatchValue(text)}
          onFocus={focus}
          onChange={(event) => change(text === text.toUpperCase() ? event.target.value.toUpperCase() : event.target.value)}
          onBlur={commit}
        />
        <Input mono value={text} placeholder={placeholderFor(field) ?? "#2E2BFF"} onChange={(event) => change(event.target.value)} onBlur={commit} onFocus={focus} />
      </span>
    </FieldShell>
  );
}

/** `date` / `datetime`: the native picker, written back in the stored format. */
export function DateField({ field, path, showKey }: FieldProps) {
  const { value, change, commit, focus } = useBinding(field, path);
  const kind = field.type === "datetime" ? "datetime" : "date";
  // Decided once: a value the picker can't show stays a text box for this visit.
  const [asTyped] = useState(() => !isPickable(value, kind));

  if (asTyped) {
    return (
      <FieldShell field={field} path={path} showKey={showKey} note="Written in a format the date picker can’t show, so it’s kept as typed.">
        <Input value={asText(value)} onChange={(event) => change(event.target.value)} onBlur={commit} onFocus={focus} />
      </FieldShell>
    );
  }
  const shown = kind === "date" ? toDateInput(value) : toDateTimeInput(value);
  return (
    <FieldShell field={field} path={path} showKey={showKey}>
      <span className="app-date">
        <Input
          type={kind === "date" ? "date" : "datetime-local"}
          value={shown}
          onFocus={focus}
          onBlur={commit}
          onChange={(event) => {
            const picked = event.target.value;
            if (picked === "") change(undefined);
            else change(kind === "date" ? fromDateInput(picked, value) : fromDateTimeInput(picked, value));
          }}
        />
        {!field.required && shown ? (
          <button type="button" className="app-link-button app-date__clear" onClick={() => change(undefined)}>
            Clear
          </button>
        ) : null}
      </span>
    </FieldShell>
  );
}
