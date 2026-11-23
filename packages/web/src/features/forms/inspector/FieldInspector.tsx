import { useEffect, useRef } from "react";
import type { FormField } from "@galley/core/kit";
import { useForm, useFormValue } from "@/features/content/form/context";
import { Field, IconButton, Input, SegmentedControl, Select } from "@/ui";
import { fieldPath, stepOf, stepTitles } from "../logic/fieldOps";
import { hasOptions, isLayout, typeLabel } from "../logic/fieldTypes";
import { readForm, settingText } from "../logic/json";
import { idFollowingLabel } from "../logic/names";
import { BoundText, BoundToggle } from "../file/Bound";
import { useEdits, useFormDoc } from "../file/hooks";
import { useBuilder } from "../editor/builderState";
import { useFieldActions } from "../editor/useFieldActions";
import { AutofillEditor } from "./AutofillEditor";
import { ConditionEditor } from "./ConditionEditor";
import { NameEditor } from "./NameEditor";
import { OptionsEditor } from "./OptionsEditor";
import { ValidationEditor } from "./ValidationEditor";

const PLACEHOLDER_TYPES = new Set<FormField["type"]>(["text", "email", "tel", "url", "number", "textarea", "select", "date"]);

function LabelInput({ index, field, fresh }: { index: number; field: FormField; fresh: boolean }) {
  const { store } = useForm();
  const edits = useEdits();
  const select = useBuilder((s) => s.select);
  const markFresh = useBuilder((s) => s.markFresh);
  const input = useRef<HTMLInputElement>(null);
  const path = fieldPath(index, "label");
  const value = settingText(useFormValue(path));
  // A field just added: put the cursor in its label, ready to type.
  const focused = useRef(false);
  useEffect(() => {
    if (fresh && !focused.current) input.current?.select();
    focused.current = true;
  }, [fresh]);
  return (
    <Field label={field.type === "consent" ? "Name in the answers" : "Label"} hint={field.type === "consent" ? "What this agreement is called where the answers arrive." : undefined}>
      <Input
        ref={input}
        value={value}
        placeholder="What visitors see above the field"
        onChange={(event) => {
          const next = event.target.value;
          // While new, the name it's sent under follows the label ("Company size" → company_size).
          const id = fresh ? idFollowingLabel(readForm(store.getState().data), index, next) : null;
          edits.type(path, next === "" ? undefined : next);
          if (id) {
            edits.type(fieldPath(index, "id"), id, true);
            markFresh(id);
            select(id);
          }
        }}
        onBlur={() => {
          edits.commit(path);
          edits.commit(fieldPath(index, "id"));
        }}
      />
    </Field>
  );
}

function ChoiceStyle({ index, field }: { index: number; field: FormField }) {
  const edits = useEdits();
  if (field.type !== "select" && field.type !== "radio") return null;
  return (
    <Field label="Show as" group>
      <SegmentedControl
        label="Show as"
        options={[
          { value: "select", label: "Dropdown" },
          { value: "radio", label: "List" },
        ]}
        value={field.type}
        onChange={(next) => edits.choose(fieldPath(index, "type"), next)}
      />
    </Field>
  );
}

/** Everything about the selected field, in the order people decide it. */
export function FieldInspector({ index, fieldKey }: { index: number; fieldKey: string }) {
  const form = useFormDoc();
  const field = form.fields[index];
  const fresh = useBuilder((s) => s.fresh.has(fieldKey));
  const select = useBuilder((s) => s.select);
  const actions = useFieldActions();
  if (!field) return null;
  const layout = isLayout(field);
  const hidden = field.type === "hidden";
  const titles = stepTitles(form);
  const p = (...rest: Array<string | number>) => fieldPath(index, ...rest);

  return (
    <div className="kit-insp" aria-label={`${field.label || "Field"} settings`} role="region">
      <div className="kit-insp__head">
        <div className="kit-insp__titles">
          <span className="g-eyebrow">{typeLabel(field)}</span>
          <span className="kit-insp__title">{field.label || field.text || "Untitled field"}</span>
        </div>
        <IconButton icon="copy" label="Duplicate field" onClick={() => actions.duplicate(index)} />
        <IconButton icon="trash" label="Remove field" onClick={() => actions.remove(index)} />
        <IconButton icon="close" label="Back to the form’s settings" onClick={() => select(null)} />
      </div>

      {field.type === "heading" || field.type === "paragraph" ? (
        <BoundText path={p("text")} label={field.type === "heading" ? "Heading" : "Text"} multiline={field.type === "paragraph"} keep hint={field.type === "paragraph" ? "**bold**, *italic* and [links](/privacy/) work here." : undefined} />
      ) : (
        <LabelInput index={index} field={field} fresh={fresh} />
      )}
      {field.type === "consent" ? <BoundText path={p("text")} label="Agreement text" multiline keep hint="What the box says. [Links](/privacy/) work here." /> : null}
      {PLACEHOLDER_TYPES.has(field.type) ? <BoundText path={p("placeholder")} label="Placeholder" placeholder="Shown faintly inside the empty field" /> : null}
      {!layout && !hidden ? <BoundText path={p("help")} label="Help" placeholder="A line under the field" /> : null}
      {!layout && !hidden ? <BoundToggle path={p("required")} label="Required" description={field.required ? "Visitors can’t send the form without it." : "Visitors may leave it empty."} /> : null}
      <ChoiceStyle index={index} field={field} />
      {hasOptions(field) ? <OptionsEditor index={index} /> : null}
      {!layout && !hidden ? (
        <Field label="Width" group hint="Two half-width fields sit side by side on wide screens.">
          <SegmentedControl
            label="Width"
            options={[
              { value: "full", label: "Full" },
              { value: "half", label: "Half" },
            ]}
            value={field.width === "half" ? "half" : "full"}
            onChange={(next) => actions.width(index, next)}
          />
        </Field>
      ) : null}
      {titles.length > 1 ? (
        <Field label="Step">
          <Select value={String(stepOf(field))} options={titles.map((title, step) => ({ value: String(step), label: `${step + 1}. ${title}` }))} onChange={(next) => actions.toStep(index, Number(next))} />
        </Field>
      ) : null}
      {hidden ? <AutofillEditor index={index} autofill={field.autofill} /> : null}
      {!layout ? <BoundText path={p("defaultValue")} label={hidden ? "Default value" : "Starts with"} placeholder={hidden ? "Sent when nothing fills it" : "An answer filled in already"} /> : null}

      {!layout && !hidden ? (
        <details className="app-details kit-insp__more" open={Boolean(field.validation)}>
          <summary>Checks</summary>
          <ValidationEditor index={index} field={field} />
        </details>
      ) : null}

      <ConditionEditor
        path={p("showWhen")}
        rule={field.showWhen}
        fields={form.fields}
        selfId={field.id}
        label="Show only when…"
        addLabel="Add a rule"
        hint="Shown, and sent, only when another field has a given answer."
      />

      {!layout ? (
        <details className="app-details kit-insp__more">
          <summary>Advanced</summary>
          <NameEditor index={index} field={field} />
          {!hidden ? <AutofillEditor index={index} autofill={field.autofill} /> : null}
        </details>
      ) : null}
    </div>
  );
}
