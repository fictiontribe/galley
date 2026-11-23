import type { ReactNode } from "react";
import { ProofMark, type MarkKind } from "./ProofMark";
import { cx } from "./cx";

export interface EmptyStateProps {
  /** Display face, ends with a full stop: "Nothing to proof yet." */
  title: string;
  /** One sentence: what will appear here and the one way to make it appear. */
  body?: ReactNode;
  /** One action (two at most). */
  actions?: ReactNode;
  /** The mark on the little proof sheet (default pilcrow — an empty page). */
  mark?: MarkKind;
  /** Smaller, without the sheet, for panes and cards. */
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}

/** An empty page, set like a proof sheet: crop marks, ruled lines and one mark. */
export function EmptyState({ title, body, actions, mark = "pilcrow", compact, className, children }: EmptyStateProps) {
  const Heading = compact ? "h3" : "h2";
  return (
    <div className={cx("g-empty", compact && "app-empty--compact", className)}>
      {compact ? null : (
        <div className="g-sheet g-crop g-ruled app-empty__sheet">
          <ProofMark kind={mark} className="g-empty__mark" />
        </div>
      )}
      <Heading className="g-empty__title">{title}</Heading>
      {body ? <p className="g-empty__body">{body}</p> : null}
      {children}
      {actions ? <div className="g-empty__actions">{actions}</div> : null}
    </div>
  );
}
