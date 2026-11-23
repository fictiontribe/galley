import type { FormAutofill } from "@galley/core/kit";
import { Field, SegmentedControl, Select } from "@/ui";
import { fieldPath } from "../logic/fieldOps";
import { BoundText } from "../file/Bound";
import { useEdits } from "../file/hooks";

const SOURCES: Array<{ value: FormAutofill["from"] | "none"; label: string }> = [
  { value: "none", label: "Nothing — use the default value" },
  { value: "utm", label: "A campaign code (UTM)" },
  { value: "query", label: "Part of the page address" },
  { value: "page-url", label: "The page address" },
  { value: "page-title", label: "The page title" },
  { value: "referrer", label: "The page the visitor came from" },
  { value: "cookie", label: "A cookie" },
];

const KEY_LABEL: Partial<Record<FormAutofill["from"], { label: string; placeholder: string; hint: string }>> = {
  utm: { label: "Which code", placeholder: "utm_source", hint: "utm_source, utm_medium, utm_campaign, utm_term or utm_content." },
  query: { label: "Name in the address", placeholder: "ref", hint: "For ?ref=spring, the name is ref." },
  cookie: { label: "Cookie name", placeholder: "_ga", hint: "Only cookies the site itself sets can be read." },
};

/** Where a hidden (or prefilled) field takes its value from on the page. */
export function AutofillEditor({ index, autofill }: { index: number; autofill: FormAutofill | undefined }) {
  const edits = useEdits();
  const path = fieldPath(index, "autofill");
  const from = autofill?.from ?? "none";
  const key = autofill && KEY_LABEL[autofill.from];
  return (
    <div className="kit-insp__group">
      <Field label="Filled from">
        <Select
          value={from}
          options={SOURCES}
          onChange={(next) => {
            if (next === "none") edits.apply({ op: "unset", path });
            else {
              const source = next as FormAutofill["from"];
              const value: { from: string; key?: string } = { from: source };
              if (KEY_LABEL[source]) value.key = autofill?.key ?? KEY_LABEL[source]?.placeholder;
              edits.apply({ op: "set", path, value });
            }
          }}
        />
      </Field>
      {key ? <BoundText path={[...path, "key"]} label={key.label} placeholder={key.placeholder} hint={key.hint} mono keep /> : null}
      {autofill?.from === "utm" ? (
        <Field label="From which visit" group hint={autofill.touch === "first" ? "The code from the visitor’s first arrival, even weeks before." : "The code from the visit when the form was sent."}>
          <SegmentedControl
            label="From which visit"
            options={[
              { value: "last", label: "Latest" },
              { value: "first", label: "First" },
            ]}
            value={autofill.touch === "first" ? "first" : "last"}
            onChange={(next) => edits.choose([...path, "touch"], next === "last" ? undefined : next)}
          />
        </Field>
      ) : null}
    </div>
  );
}
