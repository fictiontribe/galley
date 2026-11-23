import type { ReactNode } from "react";
import type { FileChange } from "@galley/core/types";
import { dirName, fileName, friendlyLabel, mediaFacts } from "@/lib/format";
import { Badge, ChangeCount, type BadgeTone } from "@/ui";

const STATUS: Record<FileChange["status"], { label: string; tone: BadgeTone }> = {
  added: { label: "New", tone: "insert" },
  modified: { label: "Edited", tone: "change" },
  deleted: { label: "Deleted", tone: "delete" },
};

export interface FileChangeRowProps {
  change: FileChange;
  /** Actions on the right (Discard, Open). */
  actions?: ReactNode;
  /** Highlight as the selected row. */
  current?: boolean;
}

/** One pending file, per the specimen: status badge, title over path, tally, actions. */
export function FileChangeRow({ change, actions, current }: FileChangeRowProps) {
  const status = STATUS[change.status];
  return (
    <div className="g-file app-file" role="listitem" aria-current={current || undefined}>
      <Badge tone={status.tone}>{status.label}</Badge>
      <div className="g-file__main">
        <span className="g-file__title">{change.title ?? (change.kind === "media" ? fileName(change.path) : friendlyLabel(change.path))}</span>
        <span className="g-file__path">
          {dirName(change.path)}
          <b>{fileName(change.path)}</b>
          {change.media ? ` · ${mediaFacts(change.media)}` : null}
          {change.summary ? <span className="app-file__summary"> · {change.summary}</span> : null}
        </span>
      </div>
      {change.binary ? (
        <span className="g-tally">
          <span className="g-tally__chg">image</span>
        </span>
      ) : (
        <ChangeCount additions={change.additions} deletions={change.deletions} />
      )}
      {actions ? <div className="app-file__actions">{actions}</div> : <span />}
    </div>
  );
}
