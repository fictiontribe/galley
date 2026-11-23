import { memo, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Field, FieldPath } from "@galley/core/types";
import { count } from "@/lib/format";
import { ProofMark } from "@/ui";
import { useForm, useFormState } from "../form/context";
import { getAt, isObject, pathKey } from "../form/paths";
import { inferField } from "./common";
import { FieldControl } from "./FieldControl";

export interface FieldListProps {
  fields: readonly Field[];
  /** Path of the object these fields belong to ([] for the entry itself). */
  basePath: FieldPath;
  showKeys?: boolean;
  /** Keys handled elsewhere (a section's type). */
  skip?: readonly string[];
  /** Fields this entry carries that the site's fields don't describe (top level). */
  extraFields?: readonly Field[];
}

/** The "…Alt" sibling of an image field, edited with the image. */
function altFor(image: Field, fields: readonly Field[]): Field | undefined {
  if (image.type !== "image") return undefined;
  const wanted = [`${image.key}alt`, `${image.key}_alt`, `${image.key}-alt`];
  return fields.find((field) => wanted.includes(field.key.toLowerCase()) && (field.type === "string" || field.type === "text") && !field.hidden);
}

function OtherFields({ fields, basePath, showKeys }: { fields: Field[]; basePath: FieldPath; showKeys?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="app-other">
      <button type="button" className="app-other__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ProofMark kind="chevron" className={open ? undefined : "app-card__chevron--closed"} />
        Other fields
        <span className="g-hint">{count(fields.length, "field")}</span>
      </button>
      {open ? (
        <div className="app-other__body">
          <p className="g-hint app-other__note">These are in the file, but the site doesn’t describe them, so they get plain controls. They’re kept exactly as they are unless you change them.</p>
          {fields.map((field) => (
            <FieldControl key={field.key} field={field} path={[...basePath, field.key]} showKey={showKeys} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The fields of one object, in the site's order. Image fields take their alt
 * text with them; keys in the file that no field describes appear under
 * "Other fields", so nothing is ever dropped.
 */
export const FieldList = memo(
  function FieldList({ fields, basePath, showKeys, skip = [], extraFields = [] }: FieldListProps) {
    const { store } = useForm();
    const dataKeys = useFormState(
      useShallow((state) => {
        const value = getAt(state.data, basePath);
        return isObject(value) ? Object.keys(value) : [];
      }),
    );

    const { shown, alts } = useMemo(() => {
      const visible = fields.filter((field) => !field.hidden && !skip.includes(field.key));
      const paired = new Map<string, Field>();
      for (const field of visible) {
        const alt = altFor(field, visible);
        if (alt) paired.set(field.key, alt);
      }
      const taken = new Set([...paired.values()].map((field) => field.key));
      return { shown: visible.filter((field) => !taken.has(field.key)), alts: paired };
    }, [fields, skip]);

    const others = useMemo(() => {
      const known = new Set([...fields.map((field) => field.key), ...skip]);
      const extra = extraFields.filter((field) => !field.hidden && !known.has(field.key));
      for (const field of extra) known.add(field.key);
      // Inference reads each value once; the controls then subscribe to their own values.
      const object = getAt(store.getState().data, basePath);
      const inferred = dataKeys.filter((key) => !known.has(key)).map((key) => inferField(key, isObject(object) ? object[key] : undefined));
      return [...extra, ...inferred];
    }, [fields, skip, extraFields, dataKeys, store, basePath]);

    return (
      <>
        {shown.map((field) => (
          <FieldControl key={field.key} field={field} path={[...basePath, field.key]} showKey={showKeys} altField={alts.get(field.key)} />
        ))}
        {others.length > 0 ? <OtherFields fields={others} basePath={basePath} showKeys={showKeys} /> : null}
      </>
    );
  },
  (a, b) => a.fields === b.fields && a.skip === b.skip && a.extraFields === b.extraFields && a.showKeys === b.showKeys && pathKey(a.basePath) === pathKey(b.basePath),
);
