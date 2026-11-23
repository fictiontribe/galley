import { useCallback, useMemo, useRef, type DragEvent } from "react";
import type { FormField } from "@galley/core/kit";
import { useForm, useFormState, useFormValue } from "@/features/content/form/context";
import { EmptyState, Icon, cx } from "@/ui";
import { describeRule } from "../logic/conditions";
import { stepTitles } from "../logic/fieldOps";
import { isObject, readForm } from "../logic/json";
import { slotsOf, structureOf } from "../logic/structure";
import { useBuilder } from "../editor/builderState";
import { useFieldActions } from "../editor/useFieldActions";
import { CanvasField, type CanvasFieldControls } from "./CanvasField";
import type { Labels } from "./FieldPreview";
import { InsertMenu } from "./InsertMenu";
import { StepTabs } from "./StepTabs";
import { dropEdge, useCanvasDrag } from "./useCanvasDrag";

function useAppearance(): { labels: Labels; compact: boolean; inline: boolean } {
  const appearance = useFormValue(["appearance"]);
  const a = isObject(appearance) ? appearance : {};
  const labels = a.labels === "floating" || a.labels === "hidden" ? a.labels : "above";
  return { labels, compact: a.size === "compact", inline: a.layout === "inline" };
}

/** The form as visitors see it, drawn from the file — and directly editable: select, drag, resize, insert. */
export function Canvas() {
  const { store } = useForm();
  const structure = useFormState((state) => structureOf(state.data.fields));
  const steps = useFormValue(["steps"]);
  const submitLabel = useFormValue(["submitLabel"]);
  const slots = useMemo(() => slotsOf(structure), [structure]);
  const titles = useMemo(() => stepTitles({ steps: Array.isArray(steps) ? (steps as unknown as Array<{ title?: string }>) : undefined, fields: slots.map((slot) => ({ step: slot.step })) as FormField[] }), [steps, slots]);
  const stepNow = useBuilder((s) => s.step);
  const step = Math.min(stepNow, titles.length - 1);
  const selected = useBuilder((s) => s.selected);
  const focus = useBuilder((s) => s.focus);
  const select = useBuilder((s) => s.select);
  const actions = useFieldActions();
  const scroller = useRef<HTMLDivElement>(null);
  const { labels, compact, inline } = useAppearance();

  const visible = useMemo(() => slots.filter((slot) => slot.step === step), [slots, step]);
  const counts = useMemo(() => titles.map((_, index) => slots.filter((slot) => slot.step === index).length), [titles, slots]);
  const drag = useCanvasDrag(scroller, {
    move: (from, to) => actions.move(from, to, { announce: true }),
    insert: (kind, index) => actions.add(kind, index),
  });

  const latest = useRef(visible);
  latest.current = visible;
  const describeCondition = useCallback(
    (field: FormField) => {
      if (!field.showWhen) return null;
      return describeRule(field.showWhen, readForm(store.getState().data).fields);
    },
    [store],
  );

  const controls = useMemo<CanvasFieldControls>(
    () => ({
      select: (key) => select(key),
      step: (position, delta) => {
        const target = latest.current[position + delta];
        if (target) select(target.key, true);
      },
      // Alt+↑/↓ and the field's menu: the same Undo toast as a drag.
      move: (from, to) => {
        actions.move(from, to, { announce: true });
        const slot = latest.current.find((candidate) => candidate.index === from);
        if (slot) select(slot.key, true);
      },
      remove: (index) => {
        const list = latest.current;
        const at = list.findIndex((slot) => slot.index === index);
        actions.remove(index);
        const neighbour = list[at + 1] ?? list[at - 1];
        if (neighbour) select(neighbour.key, true);
      },
      duplicate: actions.duplicate,
      width: actions.width,
      toStep: actions.toStep,
      insert: (kind, index) => actions.add(kind, index),
      dragStart: drag.startField,
      dragOver: drag.overField,
      drop: drag.dropHere,
      dragEnd: drag.end,
    }),
    [actions, select, drag.startField, drag.overField, drag.dropHere, drag.end],
  );

  const lastIndex = visible.length > 0 ? (visible[visible.length - 1]?.index ?? slots.length - 1) : slots.length - 1;
  const onEndOver = (event: DragEvent) => drag.overEnd(lastIndex, event);
  const multi = titles.length > 1;
  const submit = typeof submitLabel === "string" && submitLabel.trim() ? submitLabel : "Send";

  return (
    <div className="kit-canvas" ref={scroller}>
      <StepTabs titles={titles} counts={counts} />
      <div
        className={cx("kit-sheet", compact && "kit-sheet--compact", inline && "kit-sheet--inline")}
        onClick={(event) => {
          if (event.target === event.currentTarget) select(null);
        }}
      >
        {visible.length === 0 ? (
          <div className={cx("kit-canvas__empty", drag.drop && "kit-canvas__empty--over")} onDragOver={onEndOver} onDrop={drag.dropHere}>
            <EmptyState
              compact
              title={slots.length === 0 ? "No fields yet." : "No fields on this step yet."}
              body="Drag a field type here from the left, or pick one."
              actions={
                <InsertMenu
                  label="Add a field"
                  onPick={(kind) => actions.add(kind, lastIndex + 1)}
                  trigger={(props) => (
                    <button {...props} type="button" className="g-btn g-btn--secondary g-btn--sm">
                      <Icon name="plus" />
                      Add a field
                    </button>
                  )}
                />
              }
            />
          </div>
        ) : (
          <div className="kit-grid" role="group" aria-label={multi ? `Fields on ${titles[step]}` : "Fields"}>
            {visible.map((slot, position) => (
              <CanvasField
                key={slot.key}
                index={slot.index}
                fieldKey={slot.key}
                position={position}
                total={visible.length}
                prevIndex={visible[position - 1]?.index ?? null}
                nextIndex={visible[position + 1]?.index ?? null}
                half={slot.half}
                selected={selected === slot.key}
                focusToken={selected === slot.key ? focus : 0}
                dropEdge={dropEdge(drag.drop, slot.index)}
                dragging={drag.dragging === slot.index}
                labels={labels}
                stepTitles={titles}
                describeCondition={describeCondition}
                controls={controls}
              />
            ))}
            <div className={cx("kit-grid__end", drag.drop?.over === lastIndex && drag.drop.after && "kit-grid__end--over")} onDragOver={onEndOver} onDrop={drag.dropHere} aria-hidden="true" />
          </div>
        )}
        <div className="kit-sheet__actions">
          {multi && step > 0 ? (
            <span className="kit-pv__button kit-pv__button--back" aria-hidden="true">
              Back
            </span>
          ) : null}
          <button type="button" className={cx("kit-pv__button", selected === null && "kit-pv__button--selected")} onClick={() => select(null)} aria-label={`${multi && step < titles.length - 1 ? "Next" : submit} button — edit the form’s settings`}>
            {multi && step < titles.length - 1 ? (Array.isArray(steps) && isObject(steps[step]) && typeof steps[step].nextLabel === "string" ? steps[step].nextLabel : "Next") : submit}
          </button>
        </div>
      </div>
      {slots.length > 0 ? (
        <p className="kit-canvas__hint">
          Click a field to change it. Drag to reorder, or use Alt and the arrow keys. Drag a field’s right edge to set its width.
        </p>
      ) : null}
    </div>
  );
}
