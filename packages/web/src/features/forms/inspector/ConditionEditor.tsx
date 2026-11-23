import type { FieldPath } from "@galley/core/types";
import type { FormField } from "@galley/core/kit";
import { Button, Field, Input, Select } from "@/ui";
import { conditionTargets, ruleValues } from "../logic/conditions";
import { useEdits } from "../file/hooks";

export interface Rule {
  field: string;
  equals?: string;
  notEquals?: string;
}

export interface ConditionEditorProps {
  /** Where the rule lives in the file (`fields.3.showWhen`, `destinations.1.when`). */
  path: FieldPath;
  rule: Rule | undefined;
  fields: readonly FormField[];
  /** The field the rule belongs to (left out of the choices). */
  selfId: string | null;
  /** Destinations only allow "is". */
  allowNot?: boolean;
  label: string;
  addLabel: string;
  hint: string;
}

/** "Show only when…": pick another field and the answer it must have. */
export function ConditionEditor({ path, rule, fields, selfId, allowNot = true, label, addLabel, hint }: ConditionEditorProps) {
  const edits = useEdits();
  const targets = conditionTargets(fields, selfId);
  if (!rule) {
    return (
      <Field label={label} hint={targets.length === 0 ? "Add another field first — a rule needs a field to look at." : hint} group>
        <Button
          size="sm"
          variant="secondary"
          disabled={targets.length === 0}
          onClick={() => {
            const target = targets[0];
            if (!target) return;
            const first = ruleValues(target)?.[0]?.value;
            edits.apply({ op: "set", path, value: first !== undefined ? { field: target.id, equals: first } : allowNot ? { field: target.id } : { field: target.id, equals: "" } });
          }}
        >
          {addLabel}
        </Button>
      </Field>
    );
  }
  const target = fields.find((field) => field.id === rule.field);
  const values = ruleValues(target);
  const negated = rule.notEquals !== undefined;
  const filled = rule.equals === undefined && rule.notEquals === undefined;
  const current = negated ? (rule.notEquals ?? "") : (rule.equals ?? "");
  const valueKey = negated ? "notEquals" : "equals";
  const comparisons = [
    ...(allowNot && !values ? [{ value: "filled", label: "has an answer" }] : []),
    { value: "is", label: "is" },
    ...(allowNot ? [{ value: "not", label: "isn’t" }] : []),
  ];
  return (
    <Field label={label} group hint={target ? undefined : "The field this looked at was removed. Pick another, or remove the rule."}>
      <div className="kit-rule">
        <Select
          aria-label="Field"
          value={target ? rule.field : ""}
          placeholder={target ? undefined : "Pick a field"}
          options={targets.map((candidate) => ({ value: candidate.id, label: candidate.label?.trim() || candidate.id }))}
          onChange={(id) => {
            const first = ruleValues(fields.find((field) => field.id === id))?.[0]?.value;
            edits.apply({ op: "set", path, value: first !== undefined ? { field: id, [valueKey]: first } : allowNot ? { field: id } : { field: id, equals: "" } });
          }}
        />
        {comparisons.length > 1 ? (
          <Select
            aria-label="Comparison"
            value={filled ? "filled" : negated ? "not" : "is"}
            options={comparisons}
            onChange={(next) => edits.apply({ op: "set", path, value: next === "filled" ? { field: rule.field } : { field: rule.field, [next === "not" ? "notEquals" : "equals"]: current } })}
          />
        ) : (
          <span className="kit-rule__word">is</span>
        )}
        {filled && allowNot && !values ? null : values ? (
          <Select aria-label="Answer" value={current} options={values} onChange={(next) => edits.choose([...path, valueKey], next)} />
        ) : (
          <Input aria-label="Answer" size="sm" value={current} placeholder="An answer" onChange={(event) => edits.type([...path, valueKey], event.target.value, true)} onBlur={() => edits.commit([...path, valueKey])} />
        )}
      </div>
      <Button size="sm" variant="quiet" onClick={() => edits.apply({ op: "unset", path })}>
        Remove the rule
      </Button>
    </Field>
  );
}
