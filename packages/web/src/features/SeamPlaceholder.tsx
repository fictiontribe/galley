import type { ReactNode } from "react";
import { ProofMark, cx, type MarkKind } from "@/ui";

export interface SeamPlaceholderProps {
  /** Display face, ends with a full stop. */
  title: string;
  /** One sentence on what will be here. */
  body: ReactNode;
  mark?: MarkKind;
  /** Fit a pane instead of a full screen. */
  compact?: boolean;
  children?: ReactNode;
}

/**
 * Stand-in for a feature that is still being built: a galley sheet with its
 * crop marks, saying plainly what will appear. Replaced by the real feature.
 */
export function SeamPlaceholder({ title, body, mark = "caret", compact, children }: SeamPlaceholderProps) {
  return (
    <div className={cx("app-seam", compact && "app-seam--compact")}>
      <div className="g-sheet g-crop g-ruled app-seam__sheet">
        <p className="g-eyebrow">Coming together</p>
        <ProofMark kind={mark} tone="insert" className="app-seam__mark" />
        <h2 className="app-seam__title">{title}</h2>
        <p className="app-seam__body">{body}</p>
        {children}
      </div>
    </div>
  );
}
