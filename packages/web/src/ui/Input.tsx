import { useLayoutEffect, useRef, type ComponentPropsWithRef, type Ref } from "react";
import { useFieldControl } from "./Field";
import { cx } from "./cx";

function useControlProps(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling" }) {
  const field = useFieldControl();
  return {
    id: props.id ?? field?.id,
    "aria-describedby": props["aria-describedby"] ?? field?.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field?.invalid ? true : undefined),
  };
}

export interface InputProps extends Omit<ComponentPropsWithRef<"input">, "size"> {
  size?: "sm" | "md";
  mono?: boolean;
}

/** One-line text input. Inside a <Field> it is labelled automatically. */
export function Input({ size = "md", mono, className, ...rest }: InputProps) {
  const control = useControlProps(rest);
  return <input className={cx("g-input", size === "sm" && "g-input--sm", mono && "g-input--mono", className)} {...rest} {...control} />;
}

export interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
  /** Grow with the content up to this many rows, then scroll (default 12). */
  maxRows?: number;
  mono?: boolean;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }
  };
}

/** Multi-line input that grows with its content. */
export function Textarea({ maxRows = 12, mono, className, ref, onInput, rows = 2, ...rest }: TextareaProps) {
  const control = useControlProps(rest);
  const inner = useRef<HTMLTextAreaElement | null>(null);

  const fit = () => {
    const el = inner.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 22;
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    el.style.blockSize = "auto";
    const max = line * maxRows + chrome;
    el.style.blockSize = `${Math.min(el.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth), max)}px`;
    el.style.overflowY = el.scrollHeight + chrome > max ? "auto" : "hidden";
  };

  useLayoutEffect(fit, [rest.value, maxRows]);

  return (
    <textarea
      ref={mergeRefs(inner, ref)}
      rows={rows}
      className={cx("g-textarea app-textarea", mono && "g-input--mono", className)}
      onInput={(event) => {
        fit();
        onInput?.(event);
      }}
      {...rest}
      {...control}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<"select">, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown first, as an empty choice. */
  placeholder?: string;
}

/** Native select in the brand wrapper (chevron, pill-free square input). */
export function Select({ value, onChange, options, placeholder, className, ...rest }: SelectProps) {
  const control = useControlProps(rest);
  return (
    <span className="g-select-wrap">
      <select className={cx("g-select", className)} value={value} onChange={(event) => onChange(event.target.value)} {...rest} {...control}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
