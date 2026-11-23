import { memo, useId } from "react";
import type { FormDefinition, FormField } from "@galley/core/kit";
import { cx } from "@/ui";
import { TICKED } from "../logic/conditions";
import type { Answer } from "../logic/validation";
import { InlineText } from "./InlineText";

export type Labels = NonNullable<NonNullable<FormDefinition["appearance"]>["labels"]>;

export interface FieldPreviewProps {
  field: FormField;
  labels: Labels;
  /** "design": a picture of the field (nothing to type in). "test": a working control. */
  mode: "design" | "test";
  value?: Answer;
  onChange?: (value: Answer) => void;
  error?: string | null;
}

function Required() {
  return (
    <span className="kit-pv__req" aria-hidden="true">
      *
    </span>
  );
}

/** A box that looks like an input, for the design view. */
function Box({ text, kind = "input", placeholder }: { text?: string; kind?: "input" | "area" | "select"; placeholder?: boolean }) {
  return <span className={cx("kit-pv__box", `kit-pv__box--${kind}`, placeholder && "kit-pv__box--placeholder")}>{text}</span>;
}

const INPUT_TYPE: Partial<Record<FormField["type"], string>> = { email: "email", tel: "tel", url: "url", number: "number", date: "date", text: "text" };

function asText(value: Answer | undefined): string {
  return Array.isArray(value) ? value.join(", ") : (value ?? "");
}

function Choices({ field, mode, value, onChange, multiple }: FieldPreviewProps & { multiple: boolean }) {
  const name = useId();
  const chosen = Array.isArray(value) ? value : value ? [value] : [];
  return (
    <span className="kit-pv__choices">
      {(field.options ?? []).map((option, index) => {
        const checked = chosen.includes(option.value);
        return (
          <label key={`${option.value}-${index}`} className="kit-pv__choice">
            {mode === "test" ? (
              <input
                type={multiple ? "checkbox" : "radio"}
                name={name}
                checked={checked}
                onChange={(event) => {
                  if (!onChange) return;
                  if (!multiple) onChange(option.value);
                  else onChange(event.target.checked ? [...chosen, option.value] : chosen.filter((item) => item !== option.value));
                }}
              />
            ) : (
              <span className={cx("kit-pv__tick", !multiple && "kit-pv__tick--round")} aria-hidden="true" />
            )}
            <span>{option.label || option.value}</span>
          </label>
        );
      })}
    </span>
  );
}

function Control(props: FieldPreviewProps & { inputId: string; describedBy?: string }) {
  const { field, mode, value, onChange, inputId, describedBy, labels, error } = props;
  const placeholder = field.placeholder ?? (labels === "hidden" || labels === "floating" ? field.label : undefined);
  const invalid = error ? true : undefined;
  if (field.type === "radio") return <Choices {...props} multiple={false} />;
  if (field.type === "checkboxes") return <Choices {...props} multiple />;
  if (field.type === "select") {
    if (mode === "design") return <Box kind="select" text={placeholder ?? "Choose…"} placeholder />;
    return (
      <select id={inputId} className="kit-pv__input" value={asText(value)} aria-invalid={invalid} aria-describedby={describedBy} onChange={(event) => onChange?.(event.target.value)}>
        <option value="">{placeholder ?? "Choose…"}</option>
        {(field.options ?? []).map((option, index) => (
          <option key={`${option.value}-${index}`} value={option.value}>
            {option.label || option.value}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "textarea") {
    if (mode === "design") return <Box kind="area" text={placeholder ?? field.defaultValue} placeholder={!field.defaultValue} />;
    return <textarea id={inputId} className="kit-pv__input kit-pv__input--area" rows={4} placeholder={placeholder} value={asText(value)} aria-invalid={invalid} aria-describedby={describedBy} onChange={(event) => onChange?.(event.target.value)} />;
  }
  if (mode === "design") return <Box text={field.defaultValue || placeholder} placeholder={!field.defaultValue} />;
  return (
    <input
      id={inputId}
      className="kit-pv__input"
      type={INPUT_TYPE[field.type] ?? "text"}
      placeholder={placeholder}
      value={asText(value)}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
}

function Tickbox(props: FieldPreviewProps & { inputId: string; describedBy?: string }) {
  const { field, mode, value, onChange, inputId, describedBy, error } = props;
  const text = field.type === "consent" ? (field.text ?? field.label ?? "") : (field.label ?? "");
  return (
    <span className="kit-pv__choice kit-pv__choice--single">
      {mode === "test" ? (
        <input id={inputId} type="checkbox" checked={value === TICKED} aria-invalid={error ? true : undefined} aria-describedby={describedBy} onChange={(event) => onChange?.(event.target.checked ? TICKED : "")} />
      ) : (
        <span className="kit-pv__tick" aria-hidden="true" />
      )}
      <label htmlFor={mode === "test" ? inputId : undefined} className="kit-pv__tick-text">
        <InlineText text={text} />
        {field.required ? <Required /> : null}
      </label>
    </span>
  );
}

/** One field as a visitor sees it, drawn from its definition. */
export const FieldPreview = memo(function FieldPreview(props: FieldPreviewProps) {
  const { field, labels, mode, error } = props;
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const describedBy = [error ? errorId : null, field.help ? helpId : null].filter(Boolean).join(" ") || undefined;

  if (field.type === "heading") return <h3 className="kit-pv__heading">{field.text || field.label || "Heading"}</h3>;
  if (field.type === "paragraph") return <InlineText as="p" text={field.text || field.label || ""} className="kit-pv__paragraph" />;
  if (field.type === "hidden") return null;

  const tick = field.type === "checkbox" || field.type === "consent";
  const group = field.type === "radio" || field.type === "checkboxes";
  const Label = mode === "test" && !group ? "label" : "span";
  return (
    <div className={cx("kit-pv", `kit-pv--labels-${labels}`, error && "kit-pv--error")} role={mode === "test" && group ? "group" : undefined} aria-labelledby={mode === "test" && group ? `${inputId}-label` : undefined}>
      {tick ? null : (
        <Label id={`${inputId}-label`} className={cx("kit-pv__label", labels === "hidden" && "g-sr")} htmlFor={Label === "label" ? inputId : undefined}>
          {field.label || "Untitled field"}
          {field.required ? <Required /> : null}
        </Label>
      )}
      {tick ? <Tickbox {...props} inputId={inputId} describedBy={describedBy} /> : <Control {...props} inputId={inputId} describedBy={describedBy} />}
      {error ? (
        <span id={errorId} className="kit-pv__error">
          {error}
        </span>
      ) : null}
      {field.help ? (
        <span id={helpId} className="kit-pv__help">
          {field.help}
        </span>
      ) : null}
    </div>
  );
});
