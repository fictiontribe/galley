import { useCallback, useMemo, useRef, useState } from "react";
import type { BlockType, Field, FieldPath, JsonValue } from "@galley/core/types";
import { count } from "@/lib/format";
import { Button, ProofMark } from "@/ui";
import { useEditCount, useForm, useFormValue } from "../form/context";
import { addSection } from "../form/addSection";
import { blockLabel, blockTypeOf, itemSummary } from "../form/summary";
import { type FieldProps } from "./common";
import { FieldList } from "./FieldList";
import { RequiredMark } from "./FieldShell";
import { ItemCards } from "./items/ItemCards";
import { SectionPalette } from "./SectionPalette";

const NO_FIELDS: Field[] = [];
const NO_BLOCKS: BlockType[] = [];

/** `blocks`: the page's sections — fold, reorder, duplicate, remove, and add from the site's own section types. */
export function BlocksField({ field, path, showKey }: FieldProps) {
  const { store, entryPath } = useForm();
  const value = useFormValue(path);
  const items = Array.isArray(value) ? value : [];
  const edits = useEditCount(path);
  const discriminator = field.discriminator ?? "type";
  const skip = useMemo(() => [discriminator], [discriminator]);
  const blocks = field.blocks ?? NO_BLOCKS;
  const [palette, setPalette] = useState<number | null>(null);
  const [added, setAdded] = useState<{ index: number; token: number } | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const describe = useCallback(
    (item: JsonValue | undefined, index: number) => {
      const block = blockTypeOf(item, field);
      const type = block?.type ?? "";
      return { label: blockLabel(item, field), summary: itemSummary(item, block?.fields), key: `${field.key}[${index}]${type ? ` · ${type}` : ""}` };
    },
    [field],
  );

  const renderBody = useCallback(
    (itemPath: FieldPath, item: JsonValue | undefined) => {
      const block = blockTypeOf(item, field);
      return (
        <>
          {block ? null : <p className="g-hint">This section type isn’t described by the site, so its fields get plain controls.</p>}
          <FieldList fields={block?.fields ?? NO_FIELDS} basePath={itemPath} skip={skip} />
        </>
      );
    },
    [field, skip],
  );

  const positionWords = (index: number): string => {
    if (index >= items.length) return items.length === 0 ? "on this page" : "at the end of the page";
    if (index === 0) return "at the top of the page";
    return `after “${blockLabel(items[index - 1], field)}”`;
  };

  const add = (block: BlockType) => {
    const index = palette ?? items.length;
    // The same insert the Arrange panel makes on the page.
    addSection({ store, field, path: pathRef.current, block, index, entryPath });
    setPalette(null);
    setAdded({ index, token: Date.now() });
  };

  return (
    <section className="app-list app-sections" data-path={path.join(".")}>
      <div className="app-list__head">
        <span className="g-label">
          {field.label}
          {field.required ? <RequiredMark /> : null}
        </span>
        {showKey ? <span className="g-field__key">{field.key}</span> : null}
        <span className="g-hint">{count(items.length, "section")}</span>
        {edits > 0 ? (
          <span className="g-field__state">
            <ProofMark kind="caret" />
            {edits === 1 ? "Edited" : count(edits, "edit")}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? <p className="app-sections__empty">No sections yet. Add the first one from the types this site already uses.</p> : null}
      <ItemCards path={path} noun="section" describe={describe} renderBody={renderBody} onAdd={setPalette} added={added} />
      <Button size="sm" variant="quiet" icon="plus" className="app-add" onClick={() => setPalette(items.length)} disabled={blocks.length === 0}>
        Add section
      </Button>
      <SectionPalette open={palette !== null} onClose={() => setPalette(null)} blocks={blocks} position={positionWords(palette ?? items.length)} onPick={add} />
    </section>
  );
}
