import { useState, type KeyboardEvent } from "react";
import { useForm } from "@/features/content/form/context";
import { count } from "@/lib/format";
import { Button, Icon, Menu, cx, type MenuItem } from "@/ui";
import { addStepOps, removeStepOps, renameStepOps, stepCount } from "../logic/fieldOps";
import { readForm } from "../logic/json";
import { useEdits } from "../file/hooks";
import { useBuilder } from "../editor/builderState";

export interface StepTabsProps {
  titles: readonly string[];
  /** Fields on each step. */
  counts: readonly number[];
}

/** A multi-step form's steps, as tabs above the canvas: switch, add, rename, remove. */
export function StepTabs({ titles, counts }: StepTabsProps) {
  const { store } = useForm();
  const edits = useEdits();
  const step = useBuilder((s) => s.step);
  const setStep = useBuilder((s) => s.setStep);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const form = () => readForm(store.getState().data);

  const add = () => {
    const current = form();
    edits.apply(...addStepOps(current));
    setStep(stepCount(current));
  };
  const rename = (index: number) => {
    setDraft(titles[index] ?? "");
    setRenaming(index);
  };
  const saveName = () => {
    if (renaming === null) return;
    const title = draft.trim();
    if (title && title !== titles[renaming]) edits.apply(...renameStepOps(form(), renaming, title));
    setRenaming(null);
  };
  const remove = (index: number) => {
    edits.apply(...removeStepOps(form(), index));
    setStep(Math.max(0, Math.min(step, titles.length - 2)));
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = (index + (event.key === "ArrowRight" ? 1 : -1) + titles.length) % titles.length;
      setStep(next);
      requestAnimationFrame(() => document.getElementById(`kit-step-${next}`)?.focus());
    } else if (event.key === "F2") {
      event.preventDefault();
      rename(index);
    }
  };

  if (titles.length <= 1) {
    return (
      <div className="kit-steps kit-steps--single">
        <Button size="sm" variant="quiet" icon="plus" onClick={add}>
          Split into steps
        </Button>
      </div>
    );
  }

  return (
    <div className="kit-steps">
      <div className="kit-steps__list" role="tablist" aria-label="Steps of this form">
        {titles.map((title, index) => {
          const items: MenuItem[] = [
            { id: "rename", label: "Rename step…", onSelect: () => rename(index) },
            { id: "remove", label: "Remove step", tone: "danger", onSelect: () => remove(index), hint: counts[index] ? `${count(counts[index] ?? 0, "field")} move` : undefined },
          ];
          return (
            <span key={index} className={cx("kit-step", index === step && "kit-step--current")}>
              {renaming === index ? (
                <input
                  className="g-input g-input--sm kit-step__rename"
                  aria-label={`Name of step ${index + 1}`}
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={saveName}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveName();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button
                  id={`kit-step-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={index === step}
                  tabIndex={index === step ? 0 : -1}
                  className="kit-step__tab"
                  onClick={() => setStep(index)}
                  onDoubleClick={() => rename(index)}
                  onKeyDown={(event) => onTabKey(event, index)}
                >
                  <span className="kit-step__number">{index + 1}</span>
                  {title}
                  <span className="kit-step__count">{counts[index] ?? 0}</span>
                </button>
              )}
              <Menu
                label={`${title} options`}
                items={items}
                placement="bottom-end"
                trigger={(props) => (
                  <button {...props} type="button" className="g-btn g-btn--quiet g-btn--sm g-btn--icon kit-step__more" aria-label={`More for ${title}`}>
                    <Icon name="chevron-down" />
                  </button>
                )}
              />
            </span>
          );
        })}
      </div>
      <Button size="sm" variant="quiet" icon="plus" onClick={add}>
        Add step
      </Button>
    </div>
  );
}
