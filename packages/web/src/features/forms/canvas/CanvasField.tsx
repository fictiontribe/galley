import { memo, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import type { FormField } from "@galley/core/kit";
import { useChangeKind, useEditCount, useFormValue } from "@/features/content/form/context";
import { FormIcon } from "@/ui/form/FormIcon";
import { Icon, Menu, ProofMark, cx, type MenuItem } from "@/ui";
import { fieldPath } from "../logic/fieldOps";
import { isLayout, typeLabel, type PaletteKind } from "../logic/fieldTypes";
import { isObject } from "../logic/json";
import { fieldMark } from "../logic/marks";
import { describeAutofill } from "../logic/tracking";
import { useChangeMarks } from "../file/KitFile";
import { FieldPreview, type Labels } from "./FieldPreview";
import { InsertMenu } from "./InsertMenu";

export interface CanvasFieldControls {
  select: (key: string) => void;
  /** Move focus to the previous / next field. */
  step: (index: number, delta: -1 | 1) => void;
  move: (from: number, to: number) => void;
  remove: (index: number) => void;
  duplicate: (index: number) => void;
  width: (index: number, width: "full" | "half") => void;
  toStep: (index: number, step: number) => void;
  /** Add a field of this kind at this position in the file. */
  insert: (kind: PaletteKind, index: number) => void;
  dragStart: (index: number, event: DragEvent) => void;
  dragOver: (index: number, half: boolean, event: DragEvent<HTMLElement>) => void;
  drop: (event: DragEvent) => void;
  dragEnd: () => void;
}

export interface CanvasFieldProps {
  index: number;
  fieldKey: string;
  /** Position among the fields on this step, and how many there are. */
  position: number;
  total: number;
  /** Global index of the field before / after on this step (for moves), or null at the ends. */
  prevIndex: number | null;
  nextIndex: number | null;
  half: boolean;
  selected: boolean;
  focusToken: number;
  dropEdge: "before" | "after" | null;
  dragging: boolean;
  labels: Labels;
  stepTitles: readonly string[];
  /** Every field of the form, for "shows when…" (read, not subscribed). */
  describeCondition: (field: FormField) => string | null;
  controls: CanvasFieldControls;
}

function EditMark({ index }: { index: number }) {
  const path = fieldPath(index);
  const edits = useEditCount(path);
  const kind = useChangeKind(path);
  if (edits === 0) return null;
  return (
    <span className="g-field__state kit-cfield__mark">
      <ProofMark kind="caret" />
      {kind === "added" ? "New" : "Edited"}
    </span>
  );
}

function spokenName(field: FormField): string {
  const name = field.label?.trim() || field.text?.trim().slice(0, 60) || "Untitled";
  return `${name}, ${typeLabel(field).toLowerCase()}${field.required ? ", required" : ""}${field.width === "half" ? ", half width" : ""}`;
}

/** One field on the canvas: its picture, a select target, a grip to drag, an edge to resize, and its menu. */
export const CanvasField = memo(function CanvasField(props: CanvasFieldProps) {
  const { index, fieldKey, position, total, prevIndex, nextIndex, half, selected, focusToken, dropEdge, dragging, labels, stepTitles, describeCondition, controls } = props;
  const raw = useFormValue(fieldPath(index));
  const field = (isObject(raw) ? raw : { id: fieldKey, type: "text" }) as unknown as FormField;
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const marks = useChangeMarks();
  const flashed = marks.has(fieldMark(field.id));
  const [resizing, setResizing] = useState<"full" | "half" | null>(null);

  // Focus follows a keyboard move or a step to this field — not a mount (the field may be re-keyed while its label is typed elsewhere).
  const seenToken = useRef(focusToken);
  useEffect(() => {
    if (focusToken === seenToken.current) return;
    seenToken.current = focusToken;
    if (selected) button.current?.focus();
  }, [selected, focusToken]);

  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const to = event.key === "ArrowUp" ? prevIndex : nextIndex;
      if (to !== null) controls.move(index, to);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      controls.step(position, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === "Delete" || (event.key === "Backspace" && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      controls.remove(index);
    }
  };

  // Dragging the right edge: past three quarters of the canvas it's full width, otherwise half.
  const onEdgeDown = (event: PointerEvent<HTMLSpanElement>) => {
    const canvas = box.current?.parentElement;
    if (!canvas || !box.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const left = box.current.getBoundingClientRect().left;
    const width = canvas.getBoundingClientRect().width;
    const decide = (x: number): "full" | "half" => ((x - left) / width > 0.75 ? "full" : "half");
    setResizing(decide(event.clientX));
    const target = event.currentTarget;
    const move = (next: globalThis.PointerEvent) => setResizing(decide(next.clientX));
    const up = (next: globalThis.PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      setResizing(null);
      controls.width(index, decide(next.clientX));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const layout = isLayout(field);
  const hidden = field.type === "hidden";
  const condition = describeCondition(field);
  const shownHalf = resizing ? resizing === "half" : half;
  const menu: MenuItem[] = [
    { id: "up", label: "Move up", icon: "arrow-up", disabled: prevIndex === null, hint: "Alt ↑", onSelect: () => prevIndex !== null && controls.move(index, prevIndex) },
    { id: "down", label: "Move down", icon: "chevron-down", disabled: nextIndex === null, hint: "Alt ↓", onSelect: () => nextIndex !== null && controls.move(index, nextIndex) },
    ...(stepTitles.length > 1
      ? [
          { kind: "heading" as const, id: "steps", label: "Move to step" },
          ...stepTitles.map<MenuItem>((title, step) => ({ id: `step-${step}`, label: title, current: (field.step ?? 0) === step, onSelect: () => controls.toStep(index, step) })),
          { kind: "separator" as const, id: "sep-steps" },
        ]
      : []),
    { id: "duplicate", label: "Duplicate", icon: "copy", onSelect: () => controls.duplicate(index) },
    { kind: "separator", id: "sep" },
    { id: "remove", label: "Remove field", icon: "trash", tone: "danger", hint: "Delete", onSelect: () => controls.remove(index) },
  ];

  return (
    <div
      ref={box}
      className={cx(
        "kit-cfield",
        shownHalf && !hidden ? "kit-cfield--half" : "kit-cfield--full",
        selected && "kit-cfield--selected",
        dragging && "kit-cfield--dragging",
        dropEdge && `kit-cfield--drop-${dropEdge}`,
        hidden && "kit-cfield--hidden",
        flashed && "kit-cfield--flash",
        resizing && "kit-cfield--resizing",
      )}
      data-field={field.id}
      onDragOver={(event) => controls.dragOver(index, shownHalf && !hidden, event)}
      onDrop={controls.drop}
    >
      <button
        ref={button}
        type="button"
        className="kit-cfield__select"
        aria-pressed={selected}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"
        onClick={() => controls.select(fieldKey)}
        onKeyDown={onKey}
      >
        <span className="g-sr">
          {spokenName(field)}. Field {position + 1} of {total}. Alt and arrow keys move it.
        </span>
      </button>
      <div className="kit-cfield__body" aria-hidden="true">
        {hidden ? (
          <span className="kit-cfield__hidden">
            <span className="kit-cfield__hidden-label">{field.label || field.id}</span>
            <span className="kit-cfield__hidden-note">Hidden · {describeAutofill(field) ?? "sent with the answers"}</span>
          </span>
        ) : (
          <FieldPreview field={field} labels={labels} mode="design" />
        )}
      </div>
      <div className="kit-cfield__tags" aria-hidden="true">
        {condition ? <span className="kit-cfield__tag">{condition}</span> : null}
        {!layout && !hidden && field.validation ? <span className="kit-cfield__tag kit-cfield__tag--quiet">Checked</span> : null}
        {flashed ? <span className="kit-cfield__tag kit-cfield__tag--flash">Just changed</span> : null}
        <EditMark index={index} />
      </div>
      <div className="kit-cfield__tools">
        <span
          className="kit-cfield__grip"
          draggable
          title="Drag to move this field"
          aria-hidden="true"
          onDragStart={(event) => {
            if (box.current) event.dataTransfer.setDragImage(box.current, 24, 18);
            controls.dragStart(index, event);
          }}
          onDragEnd={controls.dragEnd}
        >
          <FormIcon name="grip" />
        </span>
        {!hidden && !layout ? (
          <button
            type="button"
            className="g-btn g-btn--quiet g-btn--sm kit-cfield__width"
            aria-pressed={half}
            title={half ? "Half width — click for full width" : "Full width — click for half width"}
            onClick={() => controls.width(index, half ? "full" : "half")}
            aria-label={`Half width for ${field.label || "this field"}`}
          >
            ½
          </button>
        ) : null}
        <Menu
          label={`${field.label || "Field"} options`}
          placement="bottom-end"
          items={menu}
          trigger={(triggerProps) => (
            <button {...triggerProps} type="button" className="g-btn g-btn--quiet g-btn--sm g-btn--icon" aria-label={`More for ${field.label || "this field"}`}>
              <Icon name="more" />
            </button>
          )}
        />
      </div>
      {!hidden && !layout ? <span className="kit-cfield__edge" title="Drag to make it half or full width" aria-hidden="true" onPointerDown={onEdgeDown} /> : null}
      <InsertMenu
        label="Add a field here"
        onPick={(kind) => controls.insert(kind, index + 1)}
        trigger={(triggerProps) => (
          <button {...triggerProps} type="button" className="kit-cfield__add" aria-label={`Add a field after ${field.label || "this one"}`}>
            <Icon name="plus" />
          </button>
        )}
      />
    </div>
  );
});
