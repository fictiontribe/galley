import { memo, useRef, type KeyboardEvent } from "react";
import { useChangeKind, useEditCount, useFormValue } from "@/features/content/form/context";
import { FormIcon } from "@/ui/form/FormIcon";
import { ToolButton } from "@/ui/form/ToolButton";
import { Badge, IconButton, ProofMark, Toggle, cx } from "@/ui";
import { useEdits } from "@/features/forms/file/hooks";
import { useChangeMarks } from "@/features/forms/file/KitFile";
import { Mark } from "@/features/forms/file/Mark";
import type { ListDrag } from "@/features/forms/file/useListDrag";
import { readScriptEntry } from "@/features/forms/logic/json";
import { CONSENT_WORDS, LOAD_WORDS, consentOf, integrationOf, loadOf, markOf, primarySetting, scriptName } from "./logic/entries";
import { inactiveKindLine } from "@/features/plugins/catalog";
import { describePages } from "./logic/match";
import { useMayBuild } from "@/lib/may";
import { ScriptDetail } from "./ScriptDetail";

export interface ScriptRowProps {
  index: number;
  total: number;
  open: boolean;
  warned: boolean;
  drag: ListDrag;
  onToggle: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

function EditMark({ index }: { index: number }) {
  const path = ["scripts", index];
  const edits = useEditCount(path);
  const kind = useChangeKind(path);
  if (edits === 0) return null;
  return (
    <span className="g-field__state">
      <ProofMark kind="caret" />
      {kind === "added" ? "New" : "Edited"}
    </span>
  );
}

/** One installed script: name and id, on/off, where and when it loads, its consent — and its details when open. */
export const ScriptRow = memo(function ScriptRow({ index, total, open, warned, drag, onToggle, onMove, onRemove }: ScriptRowProps) {
  const raw = useFormValue(["scripts", index]);
  const edits = useEdits();
  // Turning a script on is build-mode work; turning one off isn't.
  const mayBuild = useMayBuild();
  const marks = useChangeMarks();
  const card = useRef<HTMLElement>(null);
  const entry = readScriptEntry(raw);
  if (!entry) return null;
  const name = scriptName(entry);
  const id = primarySetting(entry);
  const consent = consentOf(entry);
  const onKey = (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const to = index + (event.key === "ArrowUp" ? -1 : 1);
    if (to >= 0 && to < total) onMove(index, to);
  };
  return (
    <section ref={card} className={cx("g-block kit-script", !entry.enabled && "kit-script--off", marks.has(`script:${entry.id}`) && "kit-script--flash", warned && "kit-script--warned")} aria-label={name} {...drag.card(index)}>
      <div className="kit-script__row" onKeyDown={onKey}>
        <span className="kit-dest__grip" aria-hidden="true" title="Drag to change the order" {...drag.grip(index, () => card.current)}>
          <FormIcon name="grip" />
        </span>
        <Mark text={markOf(entry.kind)} />
        <button type="button" className="kit-script__open" aria-expanded={open} onClick={() => onToggle(index)} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">
          <ProofMark kind="chevron" className={cx("app-card__chevron", !open && "app-card__chevron--closed")} />
          <span className="kit-script__titles">
            <span className="kit-script__name">{name}</span>
            <span className="kit-script__id g-mono">{id ?? (entry.kind === "custom" ? "Code written into the page" : integrationOf(entry.kind) ? "Not set up yet" : inactiveKindLine(entry.kind))}</span>
          </span>
          <span className="g-sr">
            , script {index + 1} of {total}. Alt and arrow keys move it.
          </span>
        </button>
        <span className="kit-script__facts">
          <span>{describePages(entry)}</span>
          <span>{LOAD_WORDS[loadOf(entry)].label}</span>
          <Badge tone={consent === "necessary" ? "neutral" : "info"} mark={null}>
            {CONSENT_WORDS[consent].label}
          </Badge>
        </span>
        <EditMark index={index} />
        <span className="kit-script__switch">
          <Toggle checked={entry.enabled} disabled={!entry.enabled && !mayBuild} aria-label={entry.enabled ? `${name} is on` : `${name} is off`} onChange={(next) => edits.choose(["scripts", index, "enabled"], next)} />
        </span>
        <span className="kit-dest__tools">
          <ToolButton icon="arrow-up" label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)} />
          <ToolButton icon="arrow-down" label={`Move ${name} down`} disabled={index === total - 1} onClick={() => onMove(index, index + 1)} />
          <IconButton icon="trash" label={`Remove ${name}`} onClick={() => onRemove(index)} />
        </span>
      </div>
      {entry.note && !open ? <p className="kit-script__note">{entry.note}</p> : null}
      {open ? (
        <div className="g-block__body">
          <ScriptDetail index={index} entry={entry} />
        </div>
      ) : null}
    </section>
  );
});
