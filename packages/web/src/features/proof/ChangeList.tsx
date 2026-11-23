import { useRef, useState, type KeyboardEvent } from "react";
import type { FileChange } from "@galley/core/types";
import { dirName, fileName, mediaFacts } from "@/lib/format";
import { useChanges } from "@/lib/stores/changes";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, ChangeCount, ConfirmDialog, type BadgeTone } from "@/ui";
import { discardCopy, orderedPaths, type ChangeGroup } from "./changes";
import { useChangeName, useCollections } from "./useNames";

const STATUS: Record<FileChange["status"], { label: string; tone: BadgeTone }> = {
  added: { label: "New", tone: "insert" },
  modified: { label: "Edited", tone: "change" },
  deleted: { label: "Deleted", tone: "delete" },
};

function Row({ change, current, onSelect, onDiscard }: { change: FileChange; current: boolean; onSelect: () => void; onDiscard: () => void }) {
  const status = STATUS[change.status];
  const title = useChangeName()(change);
  return (
    <li className="g-file proof-row" aria-current={current || undefined}>
      <button type="button" className="proof-row__select" data-path={change.path} aria-current={current || undefined} tabIndex={current ? 0 : -1} onClick={onSelect}>
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="g-file__main">
          <span className="g-file__title">{title}</span>
          <span className="g-file__path">
            {dirName(change.path)}
            <b>{fileName(change.path)}</b>
            {change.media ? ` · ${mediaFacts(change.media)}` : null}
          </span>
        </span>
        {change.binary ? (
          <span className="g-tally">
            <span className="g-tally__chg">image</span>
          </span>
        ) : (
          <ChangeCount additions={change.additions} deletions={change.deletions} />
        )}
      </button>
      <Button variant="quiet" size="sm" className="proof-row__discard" onClick={onDiscard} aria-label={`${change.status === "deleted" ? "Put back" : "Discard"} ${title}`}>
        {change.status === "deleted" ? "Put back" : "Discard"}
      </Button>
    </li>
  );
}

export interface ChangeListProps {
  groups: ChangeGroup[];
  selected: string | null;
  onSelect: (path: string) => void;
}

/** The pending changes, grouped; ↑/↓ move through them, Home/End jump. */
export function ChangeList({ groups, selected, onSelect }: ChangeListProps) {
  const discard = useChanges((s) => s.discard);
  const [confirming, setConfirming] = useState<FileChange | null>(null);
  const collections = useCollections();
  const nameOf = useChangeName();
  const root = useRef<HTMLDivElement>(null);
  const paths = orderedPaths(groups);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("proof-row__select")) return;
    const at = paths.indexOf(target.dataset.path ?? "");
    const next =
      event.key === "ArrowDown" ? paths[Math.min(paths.length - 1, at + 1)] : event.key === "ArrowUp" ? paths[Math.max(0, at - 1)] : event.key === "Home" ? paths[0] : event.key === "End" ? paths[paths.length - 1] : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onSelect(next);
    root.current?.querySelector<HTMLElement>(`.proof-row__select[data-path="${CSS.escape(next)}"]`)?.focus();
  };

  const copy = confirming ? discardCopy(confirming, collections) : null;

  return (
    <div ref={root} className="proof-list" onKeyDown={onKeyDown}>
      {groups.map((group) => (
        <section key={group.id} className="proof-group" aria-labelledby={`proof-group-${group.id}`}>
          <h2 id={`proof-group-${group.id}`} className="g-eyebrow proof-group__title">
            {group.label} <span className="proof-group__count">{group.files.length}</span>
          </h2>
          <ul className="proof-group__rows" aria-label={group.label}>
            {group.files.map((file) => (
              <Row key={file.path} change={file} current={file.path === selected} onSelect={() => onSelect(file.path)} onDiscard={() => setConfirming(file)} />
            ))}
          </ul>
        </section>
      ))}
      {copy && confirming ? (
        <ConfirmDialog
          open
          onClose={() => setConfirming(null)}
          title={copy.title}
          body={copy.body}
          confirmLabel={copy.confirmLabel}
          busyLabel={copy.busyLabel}
          errorTitle="Couldn’t discard"
          onConfirm={async () => {
            await discard([confirming.path]);
            notify({ tone: "neutral", title: confirming.status === "deleted" ? `${nameOf(confirming)} is back` : `Discarded changes to ${nameOf(confirming)}` });
          }}
        />
      ) : null}
    </div>
  );
}
