import type { ReactNode } from "react";
import { useFieldControl } from "./Field";
import { cx } from "./cx";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label; the row becomes the click target. Without it, pass `aria-label`. */
  label?: ReactNode;
  /** A sentence under the label. */
  description?: ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
  id?: string;
}

/** An on/off switch (role="switch"). */
export function Toggle({ checked, onChange, label, description, disabled, id, ...aria }: ToggleProps) {
  const field = useFieldControl();
  const input = (
    <input
      type="checkbox"
      role="switch"
      className="g-toggle"
      id={id ?? (label ? undefined : field?.id)}
      checked={checked}
      disabled={disabled}
      aria-label={aria["aria-label"]}
      aria-describedby={label ? undefined : field?.describedBy}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
  if (!label) return input;
  return (
    <label className={cx("g-toggle-row app-toggle-row", disabled && "app-disabled")}>
      <span className="app-toggle-row__text">
        <span>{label}</span>
        {description ? <span className="g-hint">{description}</span> : null}
      </span>
      {input}
    </label>
  );
}

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

/** A checkbox with its label. (The brand has no checkbox; styled in app.css on the same tokens as the toggle.) */
export function Checkbox({ checked, onChange, label, description, disabled }: CheckboxProps) {
  return (
    <label className={cx("app-check", disabled && "app-disabled")}>
      <input type="checkbox" className="app-check__box" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="app-check__text">
        <span>{label}</span>
        {description ? <span className="g-hint">{description}</span> : null}
      </span>
    </label>
  );
}
