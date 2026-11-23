import type { FormField } from "@galley/core/kit";
import { Field, Select } from "@/ui";
import { fieldPath } from "../logic/fieldOps";
import { PATTERN_PRESETS, patternChoice, patternProblem, presetById } from "../logic/validation";
import { BoundNumber, BoundText, BoundToggle } from "../file/Bound";
import { useEdits } from "../file/hooks";

const LENGTH_TYPES = new Set<FormField["type"]>(["text", "textarea", "tel", "url", "email"]);
const PATTERN_TYPES = new Set<FormField["type"]>(["text", "textarea", "tel", "number"]);

/** Checks on an answer: friendly presets first, a custom pattern last, and the message visitors see. */
export function ValidationEditor({ index, field }: { index: number; field: FormField }) {
  const edits = useEdits();
  const path = (key: string) => fieldPath(index, "validation", key);
  const choice = patternChoice(field.validation);
  const pattern = field.validation?.pattern ?? "";
  const options = [
    { value: "none", label: "No pattern" },
    ...PATTERN_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
    { value: "custom", label: "Custom pattern…" },
  ];
  const choose = (next: string) => {
    if (next === "none") {
      edits.apply({ op: "unset", path: path("pattern") });
      return;
    }
    if (next === "custom") {
      edits.choose(path("pattern"), pattern || "^.+$");
      return;
    }
    const preset = presetById(next);
    if (!preset) return;
    edits.apply({ op: "set", path: path("pattern"), value: preset.pattern }, ...(field.validation?.message ? [] : [{ op: "set" as const, path: path("message"), value: preset.message }]));
  };

  return (
    <div className="kit-insp__group">
      {field.type === "email" ? <BoundToggle path={path("businessEmailOnly")} label="Work email only" description="Refuses free mailboxes like gmail.com and outlook.com." /> : null}
      {LENGTH_TYPES.has(field.type) ? (
        <div className="app-form-row">
          <BoundNumber path={path("minLength")} label="Fewest characters" min={0} />
          <BoundNumber path={path("maxLength")} label="Most characters" min={0} />
        </div>
      ) : null}
      {field.type === "number" ? (
        <div className="app-form-row">
          <BoundNumber path={path("min")} label="Smallest number" />
          <BoundNumber path={path("max")} label="Largest number" />
        </div>
      ) : null}
      {PATTERN_TYPES.has(field.type) ? (
        <Field label="Must look like">
          <Select value={choice} options={options} onChange={choose} />
        </Field>
      ) : null}
      {choice === "custom" ? <BoundText path={path("pattern")} label="Custom pattern" mono hint="For developers: a regular expression the whole answer must match." error={patternProblem(pattern)} /> : null}
      {field.validation ? <BoundText path={path("message")} label="Message when it doesn’t" placeholder="Check this and try again." hint="Shown under the field to the visitor." /> : null}
    </div>
  );
}
