import { useMemo, useRef, type KeyboardEvent } from "react";
import type { FormAction } from "@galley/core/kit";
import { useFormValue } from "@/features/content/form/context";
import { insertOp } from "@/features/content/form/ops";
import { planMove, planRemove } from "@/features/content/fields/items/listPlan";
import { notify } from "@/lib/stores/toasts";
import { FormIcon } from "@/ui/form/FormIcon";
import { ToolButton } from "@/ui/form/ToolButton";
import { EmptyState, IconButton, Menu, ProofMark, cx, type MenuItem } from "@/ui";
import { ACTION_KINDS, actionKind, actionNotes, canAdd, insertIndex, newAction, REDIRECT_DELAY_WITH_MESSAGE } from "../logic/actions";
import { toJson } from "../logic/json";
import { AREA_MARKS } from "../logic/marks";
import { useAllowBuild } from "../file/assistant";
import { useEdits, useFormDoc } from "../file/hooks";
import { useChangeMarks } from "../file/KitFile";
import { useListDrag, type ListDrag } from "../file/useListDrag";
import { ActionBody } from "./ActionBody";
import { sampleAnswers, ThankYou } from "./ThankYou";

const PATH = ["afterSubmit"];

function ActionCard({ siteId, index, total, action, drag, onMove, onRemove }: { siteId: string; index: number; total: number; action: FormAction; drag: ListDrag; onMove: (from: number, to: number) => void; onRemove: (index: number) => void }) {
  const form = useFormDoc();
  const allowBuild = useAllowBuild();
  const card = useRef<HTMLElement>(null);
  const kind = actionKind(action.type);
  const onKey = (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const to = index + (event.key === "ArrowUp" ? -1 : 1);
    if (to >= 0 && to < total) onMove(index, to);
  };
  return (
    <section ref={card} className="g-block kit-action" aria-labelledby={`action-${index}`} {...drag.card(index)}>
      <header className="g-block__head kit-action__head" onKeyDown={onKey}>
        <span className="kit-dest__grip" aria-hidden="true" title="Drag to change the order" {...drag.grip(index, () => card.current)}>
          <FormIcon name="grip" />
        </span>
        <span className="kit-action__number">{index + 1}</span>
        <span id={`action-${index}`} className="kit-action__name">
          {kind.label}
        </span>
        <span className="kit-dest__tools">
          <ToolButton icon="arrow-up" label={`Move “${kind.label}” up`} disabled={index === 0} onClick={() => onMove(index, index - 1)} />
          <ToolButton icon="arrow-down" label={`Move “${kind.label}” down`} disabled={index === total - 1} onClick={() => onMove(index, index + 1)} />
          <IconButton icon="trash" label={`Remove “${kind.label}”`} onClick={() => onRemove(index)} />
        </span>
      </header>
      <div className="g-block__body kit-action__body">
        <ActionBody siteId={siteId} index={index} action={action} fields={form.fields} allowBuild={allowBuild} hasMessage={form.afterSubmit.some((other) => other.type === "message")} />
      </div>
    </section>
  );
}

/** "After sending": the steps that run once a submission succeeds, in order, with a live preview of the thank-you. */
export function AfterSending({ siteId }: { siteId: string }) {
  const form = useFormDoc();
  const edits = useEdits();
  const allowBuild = useAllowBuild();
  const raw = useFormValue(PATH);
  const marks = useChangeMarks();
  const scroller = useRef<HTMLDivElement>(null);
  const list = Array.isArray(raw) ? raw : [];
  const actions = form.afterSubmit;
  const move = (from: number, to: number) => {
    const plan = planMove(PATH, list.length, from, to);
    if (plan) edits.apply(...plan.ops);
  };
  const drag = useListDrag(scroller, move);
  const remove = (index: number) => {
    const plan = planRemove(PATH, list, index);
    if (!plan) return;
    const label = actions[index] ? actionKind(actions[index].type).label : "Step";
    edits.apply(...plan.ops);
    notify({ tone: "neutral", title: `“${label}” removed`, action: { label: "Undo", onClick: () => edits.apply(...plan.undo) }, duration: 10000 });
  };
  const add = (type: FormAction["type"]) => {
    const ops = [insertOp(PATH, insertIndex(actions, type), toJson(newAction(type, actions)))];
    // A thank-you added after a page change: give the page change a wait so both are seen.
    const redirect = actions.findIndex((action) => action.type === "redirect");
    if (type === "message" && redirect >= 0 && !(actions[redirect] as Extract<FormAction, { type: "redirect" }>).delaySeconds) {
      ops.push({ op: "set", path: [...PATH, redirect + 1, "delaySeconds"], value: REDIRECT_DELAY_WITH_MESSAGE });
    }
    edits.apply(...ops);
  };
  const items: MenuItem[] = ACTION_KINDS.map((kind) => {
    const available = canAdd(actions, kind.type, allowBuild);
    return { id: kind.type, label: kind.label, hint: available.ok ? kind.description : available.reason, disabled: !available.ok, onSelect: () => add(kind.type) };
  });
  const answers = useMemo(() => sampleAnswers(form.fields), [form.fields]);
  const notes = actionNotes(actions);
  const addMenu = (
    <Menu
      label="Add a step"
      items={items}
      trigger={(props) => (
        <button {...props} type="button" className="g-btn g-btn--secondary g-btn--sm">
          Add a step
        </button>
      )}
    />
  );

  return (
    <div className="kit-tab-body" ref={scroller}>
      <div className="kit-tab-body__inner kit-after">
        <div className="kit-after__main">
          <header className="kit-tab-head">
            <div>
              <h2 className="kit-tab-head__title">After sending</h2>
              <p className="kit-tab-head__lede">These run in order once the main destination accepts the submission.</p>
            </div>
            {addMenu}
          </header>
          {actions.length === 0 ? (
            <EmptyState compact title="Nothing happens after sending yet." body="Add a thank-you, a page to go to, a download, or a conversion to record." actions={addMenu} />
          ) : (
            <div className={cx("kit-dests", marks.has(AREA_MARKS.afterSubmit) && "kit-dests--flash")}>
              {actions.map((action, index) => (
                <ActionCard key={`${index}-${action.type}`} siteId={siteId} index={index} total={actions.length} action={action} drag={drag} onMove={move} onRemove={remove} />
              ))}
            </div>
          )}
          {notes.map((note) => (
            <p key={note} className="g-margin-note kit-note">
              <ProofMark kind="pilcrow" />
              <span>{note}</span>
            </p>
          ))}
        </div>
        <aside className="kit-after__preview" aria-label="What the visitor sees after sending">
          <p className="g-eyebrow">What the visitor sees</p>
          <ThankYou actions={actions} answers={answers} />
          <p className="g-hint">Answers appear in place of their names; here each shows as its field’s label.</p>
        </aside>
      </div>
    </div>
  );
}
