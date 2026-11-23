import { useState } from "react";
import type { JsonValue } from "@galley/core/types";
import { useFormValue } from "@/features/content/form/context";
import { insertOp, moveOp, removeOp } from "@/features/content/form/ops";
import { notify } from "@/lib/stores/toasts";
import { Button, Dialog, Field, IconButton, Textarea } from "@/ui";
import { ToolButton } from "@/ui/form/ToolButton";
import { fieldPath } from "../logic/fieldOps";
import { isObject, settingText, toJson } from "../logic/json";
import { uniqueName } from "../logic/names";
import { optionsFromLines, valueFromLabel } from "../logic/options";
import { useEdits } from "../file/hooks";

function OptionRow({ index, total, path, onRemove }: { index: number; total: number; path: Array<string | number>; onRemove: () => void }) {
  const edits = useEdits();
  const labelPath = [...path, index, "label"];
  const valuePath = [...path, index, "value"];
  const label = settingText(useFormValue(labelPath));
  const value = settingText(useFormValue(valuePath));
  return (
    <li className="kit-option">
      <input
        className="g-input g-input--sm kit-option__label"
        aria-label={`Option ${index + 1}`}
        value={label}
        onChange={(event) => edits.type(labelPath, event.target.value, true)}
        onBlur={() => edits.commit(labelPath)}
      />
      <input
        className="g-input g-input--sm g-input--mono kit-option__value"
        aria-label={`Value sent for option ${index + 1}`}
        title="The value sent when this option is chosen"
        value={value}
        onChange={(event) => edits.type(valuePath, event.target.value, true)}
        onBlur={() => edits.commit(valuePath)}
      />
      <span className="kit-option__tools">
        <ToolButton icon="arrow-up" label={`Move ${label || "option"} up`} disabled={index === 0} onClick={() => edits.apply(moveOp(path, index, index - 1))} />
        <ToolButton icon="arrow-down" label={`Move ${label || "option"} down`} disabled={index === total - 1} onClick={() => edits.apply(moveOp(path, index, index + 1))} />
        <IconButton icon="close" label={`Remove ${label || "option"}`} onClick={onRemove} />
      </span>
    </li>
  );
}

/** The choices of a dropdown, list or checkboxes: add, rename, reorder, remove — or paste them, one per line. */
export function OptionsEditor({ index }: { index: number }) {
  const edits = useEdits();
  const path = fieldPath(index, "options");
  const raw = useFormValue(path);
  const options = (Array.isArray(raw) ? raw.filter(isObject) : []).map((option) => ({ value: settingText(option.value), label: settingText(option.label) }));
  const [pasting, setPasting] = useState(false);
  const [lines, setLines] = useState("");

  const add = () => {
    const label = `Option ${options.length + 1}`;
    const value = uniqueName(valueFromLabel(label), options.map((option) => option.value));
    edits.apply(insertOp(path, options.length, { value, label }));
  };
  const remove = (at: number) => {
    const removed = Array.isArray(raw) ? raw[at] : undefined;
    edits.apply(removeOp(path, at));
    if (removed !== undefined) {
      notify({ tone: "neutral", title: `${options[at]?.label || "Option"} removed`, action: { label: "Undo", onClick: () => edits.apply(insertOp(path, at, removed as JsonValue)) }, duration: 8000 });
    }
  };
  const replace = () => {
    const next = optionsFromLines(lines);
    if (next.length > 0) edits.apply({ op: "set", path, value: toJson(next) });
    setPasting(false);
  };

  return (
    <Field label="Options" group hint="The left box is what visitors see; the right is what’s sent.">
      <ul className="kit-options">
        {options.map((_, at) => (
          <OptionRow key={at} index={at} total={options.length} path={path} onRemove={() => remove(at)} />
        ))}
      </ul>
      <div className="kit-options__actions">
        <Button size="sm" variant="secondary" icon="plus" onClick={add}>
          Add option
        </Button>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            setLines(options.map((option) => option.label).join("\n"));
            setPasting(true);
          }}
        >
          Paste a list…
        </Button>
      </div>
      <Dialog
        open={pasting}
        onClose={() => setPasting(false)}
        title="Paste the options"
        description="One option per line. They replace the options this field has now."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasting(false)}>
              Keep the options
            </Button>
            <Button variant="primary" onClick={replace} disabled={optionsFromLines(lines).length === 0}>
              Use {optionsFromLines(lines).length} options
            </Button>
          </>
        }
      >
        <Textarea aria-label="Options, one per line" rows={8} maxRows={16} value={lines} onChange={(event) => setLines(event.target.value)} data-autofocus />
      </Dialog>
    </Field>
  );
}
