import { useEffect, useRef, useSyncExternalStore } from "react";
import type { BlockType, Field, JsonValue } from "@galley/core/types";
import { pathKey } from "@/features/content/form/paths";
import type { FormStore } from "@/features/content/form/store";
import { ProofMark, SegmentedControl, Select, Spinner, Toggle } from "@/ui";
import { humanize, optionFields, optionValue } from "./model";

function useOptionState(store: FormStore, key: string): { saving: boolean; refusal: string | undefined } {
  const saving = useSyncExternalStore(store.subscribe, () => store.getState().saveState[key] === "saving");
  const refusal = useSyncExternalStore(store.subscribe, () => store.getState().refusals[key]);
  return { saving, refusal };
}

function OptionControl({ store, field, path, item }: { store: FormStore; field: Field; path: Array<string | number>; item: JsonValue | undefined }) {
  const key = pathKey(path);
  const { saving, refusal } = useOptionState(store, key);
  const value = optionValue(item, field);
  // One `set` at this option's own path; the queue sends it at once.
  const change = (next: JsonValue) => store.actions.edit(path, next, { required: field.required, immediate: true });
  let control;
  if (field.type === "boolean") {
    control = <Toggle checked={value === true} onChange={change} label={field.label} />;
  } else {
    const options = (field.options ?? []).map((option) => ({ value: option, label: humanize(option) }));
    control =
      typeof value === "string" && field.options?.includes(value) ? (
        <SegmentedControl label={field.label} options={options} value={value} onChange={change} className="builder-option__choices" />
      ) : (
        <Select value="" placeholder="Choose…" options={options} onChange={change} aria-label={field.label} />
      );
  }
  return (
    <div className="builder-option" data-option={field.key}>
      {field.type === "boolean" ? null : (
        <span className="builder-option__label">
          <span className="g-label">{field.label}</span>
          <span className="g-field__key">{field.key}</span>
        </span>
      )}
      <div className="builder-option__row">
        {control}
        {saving ? <Spinner label="Saving" /> : null}
      </div>
      {refusal ? (
        <p className="g-error-text" role="alert">
          <ProofMark kind="bang" />
          <span>Couldn’t change it. {refusal}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface SectionOptionsProps {
  store: FormStore;
  fieldKey: string;
  index: number;
  item: JsonValue | undefined;
  block: BlockType | undefined;
  /** Bumped when the page's Options button is pressed: focus the first option. */
  focusToken: number;
  disabled?: boolean;
}

/** A section's options as visual toggles: the schema's short choices and switches, each change one edit. */
export function SectionOptions({ store, fieldKey, index, item, block, focusToken, disabled }: SectionOptionsProps) {
  const options = optionFields(block);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusToken) return;
    root.current?.scrollIntoView({ block: "nearest" });
    root.current?.querySelector<HTMLElement>('[tabindex="0"], input, select, button')?.focus();
  }, [focusToken]);

  if (options.length === 0) {
    return (
      <p className="builder-panel__hint" ref={root} tabIndex={-1}>
        This section has no options to switch. Its words and pictures are in Edit content.
      </p>
    );
  }
  return (
    <div className="builder-options" ref={root} aria-disabled={disabled || undefined}>
      {options.map((field) => (
        <OptionControl key={field.key} store={store} field={field} path={[fieldKey, index, field.key]} item={item} />
      ))}
    </div>
  );
}
