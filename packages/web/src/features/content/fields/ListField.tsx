import { useCallback, useEffect, useRef, useState } from "react";
import type { Field, FieldPath, JsonValue } from "@galley/core/types";
import { count } from "@/lib/format";
import type { DataSourceSummary } from "@galley/core/api";
import { Button, IconButton, Input, ProofMark, Skeleton } from "@/ui";
import { ToolButton } from "@/ui/form/ToolButton";
import { useEditCount, useForm, useFormValue } from "../form/context";
import { insertId, moveId, newItemId, removeId } from "../form/ids";
import { insertOp, moveOp, removeOp } from "../form/ops";
import { newListItem } from "../form/scaffold";
import { itemSummary } from "../form/summary";
import { asText, useBinding } from "./binding";
import { type FieldProps } from "./common";
import { DataSourceOffNote, DataSourceRowPicker, useListSource } from "./DataSourceField";
import { FieldControl } from "./FieldControl";
import { FieldList } from "./FieldList";
import { FieldShell, RequiredMark } from "./FieldShell";
import { ItemCards } from "./items/ItemCards";
import { useItemIds } from "./items/useItemIds";

const SIMPLE = new Set(["string", "text", "url", "number", "date", "datetime", "select", "color", "reference"]);
const EMPTY: JsonValue[] = [];
const NO_FIELDS: Field[] = [];

function SimpleRow({ of, path, index, total, label, onMove, onRemove, autoFocus, source }: { of: Field; path: FieldPath; index: number; total: number; label: string; onMove: (from: number, to: number) => void; onRemove: (index: number) => void; autoFocus: boolean; source: DataSourceSummary | null }) {
  const { value, change, commit, focus } = useBinding({ ...of, required: true }, path, Boolean(source));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const numeric = of.type === "number";
  return (
    <li className={source ? "app-simple-list__row app-simple-list__row--pick" : "app-simple-list__row"}>
      {source && of.dataSource ? (
        // Each item is one value from the source; a row left empty stays empty rather than writing a guess.
        <DataSourceRowPicker sourceId={of.dataSource} source={source} value={value} noun={label} label={`${label} ${index + 1}`} onChange={(next) => change(next ?? "")} onFocus={focus} autoFocus={autoFocus} />
      ) : (
        <Input
          ref={input}
          size="sm"
          aria-label={`${label} ${index + 1}`}
          inputMode={numeric ? "decimal" : undefined}
          value={asText(value)}
          onChange={(event) => {
            const text = event.target.value;
            if (numeric && text.trim() !== "" && Number.isFinite(Number(text))) change(Number(text));
            else change(text);
          }}
          onBlur={commit}
          onFocus={focus}
        />
      )}
      <ToolButton icon="arrow-up" label={`Move ${label.toLowerCase()} ${index + 1} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)} />
      <ToolButton icon="arrow-down" label={`Move ${label.toLowerCase()} ${index + 1} down`} disabled={index === total - 1} onClick={() => onMove(index, index + 1)} />
      <IconButton icon="close" label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => onRemove(index)} />
    </li>
  );
}

/** A list of short values (strings, links, numbers): one compact row each. */
function SimpleList({ field, path, showKey }: FieldProps) {
  const { store } = useForm();
  const of = field.of ?? { key: "item", label: "Item", type: "string", required: false, source: "inferred" };
  const value = useFormValue(path);
  const items = Array.isArray(value) ? value : EMPTY;
  const { ids, expect } = useItemIds(items);
  const [focusId, setFocusId] = useState<string | null>(null);
  const picking = useListSource(of);

  const move = (from: number, to: number) => {
    expect(moveId(ids, from, to));
    store.actions.apply(moveOp(path, from, to));
  };
  const remove = (index: number) => {
    expect(removeId(ids, index));
    store.actions.apply(removeOp(path, index));
  };
  const add = () => {
    const id = newItemId();
    expect(insertId(ids, items.length, id));
    store.actions.apply(insertOp(path, items.length, newListItem(of)));
    setFocusId(id);
  };

  if (picking.loading) {
    return (
      <FieldShell field={field} path={path} showKey={showKey} group>
        <Skeleton height={32} />
      </FieldShell>
    );
  }
  return (
    <FieldShell field={field} path={path} showKey={showKey} group note={picking.sourceId && !picking.source ? <DataSourceOffNote sourceId={picking.sourceId} /> : undefined}>
      {items.length > 0 ? (
        <ol className="app-simple-list">
          {items.map((_, index) => {
            const id = ids[index] ?? String(index);
            return <SimpleRow key={id} of={of} path={[...path, index]} index={index} total={items.length} label={of.label} onMove={move} onRemove={remove} autoFocus={focusId === id} source={picking.source} />;
          })}
        </ol>
      ) : null}
      <Button size="sm" variant="quiet" icon="plus" className="app-add" onClick={add}>
        Add {of.label.toLowerCase()}
      </Button>
    </FieldShell>
  );
}

/** A list of groups (FAQ questions, pricing plans, links): folding cards, reorderable. */
function CardList({ field, path, showKey }: FieldProps) {
  const { store } = useForm();
  const of = field.of;
  const value = useFormValue(path);
  const length = Array.isArray(value) ? value.length : 0;
  const edits = useEditCount(path);
  const [added, setAdded] = useState<{ index: number; token: number } | null>(null);
  const noun = (of?.label ?? "Item").toLowerCase();
  const pathRef = useRef(path);
  pathRef.current = path;

  const describe = useCallback(
    (item: JsonValue | undefined, index: number) => ({
      label: `${of?.label ?? "Item"} ${index + 1}`,
      summary: itemSummary(item, of?.fields),
      key: `${field.key}[${index}]`,
    }),
    [of, field.key],
  );
  const renderBody = useCallback(
    (itemPath: FieldPath) => (of?.type === "object" ? <FieldList fields={of.fields ?? NO_FIELDS} basePath={itemPath} /> : of ? <FieldControl field={of} path={itemPath} /> : null),
    [of],
  );
  const onAdd = useCallback(
    (index: number) => {
      store.actions.apply(insertOp(pathRef.current, index, newListItem(of)));
      setAdded({ index, token: Date.now() });
    },
    [store, of],
  );

  return (
    <section className="app-list" data-path={path.join(".")}>
      <div className="app-list__head">
        <span className="g-label">
          {field.label}
          {field.required ? <RequiredMark /> : null}
        </span>
        {showKey ? <span className="g-field__key">{field.key}</span> : null}
        <span className="g-hint">{count(length, noun)}</span>
        {edits > 0 ? (
          <span className="g-field__state">
            <ProofMark kind="caret" />
            {edits === 1 ? "Edited" : count(edits, "edit")}
          </span>
        ) : null}
      </div>
      <ItemCards path={path} noun={noun} describe={describe} renderBody={renderBody} onAdd={onAdd} added={added} />
      <Button size="sm" variant="quiet" icon="plus" className="app-add" onClick={() => onAdd(length)}>
        Add {noun}
      </Button>
    </section>
  );
}

/** `list`: compact rows for short values, cards for groups. */
export function ListField(props: FieldProps) {
  const of = props.field.of;
  if (!of || SIMPLE.has(of.type)) return <SimpleList {...props} />;
  return <CardList {...props} />;
}
