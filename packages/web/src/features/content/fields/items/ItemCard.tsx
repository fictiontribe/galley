import { memo, useEffect, useRef, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import type { FieldPath, JsonValue } from "@galley/core/types";
import { Icon, Menu, ProofMark, cx, type MenuItem } from "@/ui";
import { FormIcon } from "@/ui/form/FormIcon";
import { ToolButton } from "@/ui/form/ToolButton";
import { count } from "@/lib/format";
import { useChangeKind, useEditCount, useFormValue } from "../../form/context";

/** What a card asks its list to do. Stable across renders (methods read the latest list). */
export interface ItemController {
  noun: string;
  toggle: (id: string) => void;
  move: (from: number, to: number, id: string) => void;
  duplicate: (index: number) => void;
  remove: (index: number) => void;
  /** Add a new item at this position (blocks open the palette). */
  addAt: (index: number) => void;
  select: (text: string) => void;
  dragStart: (index: number, event: DragEvent) => void;
  dragOver: (index: number, event: DragEvent<HTMLElement>) => void;
  drop: (event: DragEvent) => void;
  dragEnd: () => void;
}

export interface ItemCardProps {
  id: string;
  index: number;
  total: number;
  listPath: FieldPath;
  open: boolean;
  /** Focus the head after a move or an add. */
  focusToken: number;
  /** Drop indicator: "before" / "after" this card while dragging. */
  dropEdge: "before" | "after" | null;
  dragging: boolean;
  controller: ItemController;
  /** Type label ("Hero") and one-line summary for the head. */
  describe: (item: JsonValue | undefined, index: number) => { label: string; summary: string; key: string };
  renderBody: (itemPath: FieldPath, item: JsonValue | undefined) => ReactNode;
}

function EditMark({ path }: { path: FieldPath }) {
  const edits = useEditCount(path);
  const kind = useChangeKind(path);
  if (edits === 0) return null;
  if (kind === "added") {
    return (
      <span className="g-field__state app-card-mark app-card-mark--new">
        <ProofMark kind="caret" />
        New
      </span>
    );
  }
  // Only moved (nothing inside changed): say so, with the proofreader's transpose mark.
  if (kind === "moved" && edits === 1) {
    return (
      <span className="g-field__state app-card-mark">
        <ProofMark kind="transpose" />
        Moved
      </span>
    );
  }
  return (
    <span className="g-field__state app-card-mark">
      <ProofMark kind="caret" />
      {edits === 1 ? "Edited" : count(edits, "edit")}
    </span>
  );
}

/** One section (or list item): a folded head with its label and summary, the fields inside when open. */
export const ItemCard = memo(function ItemCard({ id, index, total, listPath, open, focusToken, dropEdge, dragging, controller, describe, renderBody }: ItemCardProps) {
  const itemPath = [...listPath, index];
  const item = useFormValue(itemPath);
  const head = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const { label, summary, key } = describe(item, index);
  const noun = controller.noun;

  useEffect(() => {
    if (focusToken > 0) head.current?.focus();
  }, [focusToken]);

  const onHeadKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const to = index + (event.key === "ArrowUp" ? -1 : 1);
    if (to >= 0 && to < total) controller.move(index, to, id);
  };

  const menu: MenuItem[] = [
    { id: "above", label: `Add ${noun} above`, icon: "plus", onSelect: () => controller.addAt(index) },
    { id: "below", label: `Add ${noun} below`, icon: "plus", onSelect: () => controller.addAt(index + 1) },
    { id: "duplicate", label: "Duplicate", icon: "copy", onSelect: () => controller.duplicate(index) },
    { kind: "separator", id: "sep" },
    { id: "remove", label: `Remove ${noun}`, icon: "trash", tone: "danger", onSelect: () => controller.remove(index) },
  ];

  return (
    <div
      ref={card}
      data-path={itemPath.join(".")}
      className={cx("g-block app-card", open && "app-card--open", dragging && "app-card--dragging", dropEdge && `app-card--drop-${dropEdge}`)}
      onDragOver={(event) => controller.dragOver(index, event)}
      onDrop={(event) => controller.drop(event)}
    >
      <div className="g-block__head app-card__head">
        <span
          className="app-card__grip"
          draggable
          title={`Drag to move this ${noun}`}
          aria-hidden="true"
          onDragStart={(event) => {
            if (card.current) event.dataTransfer.setDragImage(card.current, 24, 18);
            controller.dragStart(index, event);
          }}
          onDragEnd={() => controller.dragEnd()}
        >
          <FormIcon name="grip" />
        </span>
        <button
          ref={head}
          type="button"
          className="app-card__toggle"
          aria-expanded={open}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          onClick={() => {
            controller.toggle(id);
            controller.select(summary || label);
          }}
          onKeyDown={onHeadKey}
        >
          <ProofMark kind="chevron" className={cx("app-card__chevron", !open && "app-card__chevron--closed")} />
          <span className="app-card__titles">
            <span className="app-card__label">{label}</span>
            <span className={cx("app-card__summary", !summary && "app-card__summary--empty")}>{summary || "Empty"}</span>
          </span>
          <span className="g-sr">
            , {noun} {index + 1} of {total}. Alt and arrow keys move it.
          </span>
        </button>
        <EditMark path={itemPath} />
        <span className="g-field__key app-card__key">{key}</span>
        <span className="app-card__actions">
          <ToolButton icon="arrow-up" label={`Move ${noun} up`} disabled={index === 0} onClick={() => controller.move(index, index - 1, id)} />
          <ToolButton icon="arrow-down" label={`Move ${noun} down`} disabled={index === total - 1} onClick={() => controller.move(index, index + 1, id)} />
          <Menu
            label={`${label} options`}
            placement="bottom-end"
            items={menu}
            trigger={(props) => (
              <button {...props} type="button" className="g-btn g-btn--quiet g-btn--sm g-btn--icon" aria-label={`More for ${label}`}>
                <Icon name="more" />
              </button>
            )}
          />
        </span>
      </div>
      {open ? <div className="g-block__body app-card__body">{renderBody(itemPath, item)}</div> : null}
    </div>
  );
});
