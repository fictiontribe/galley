import { useState, type ReactNode } from "react";
import { errorShape } from "@/lib/api";
import { Button } from "./Button";
import { ProofMark } from "./ProofMark";
import { cx } from "./cx";

export interface ErrorStateProps {
  /** Lead with what didn't happen: "Couldn't load the version history". */
  title: string;
  /** A thrown value; its plain message and technical detail are shown. */
  error?: unknown;
  /** Overrides the message from `error`. What happened, then what to do. */
  message?: ReactNode;
  /** Overrides the detail from `error`. Raw text behind "Technical details". */
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra actions beside Try again. */
  actions?: ReactNode;
  /** Inline version for dialogs, panes and cards. */
  compact?: boolean;
  className?: string;
}

/** What happened and what to do, with the raw detail one click away. */
export function ErrorState({ title, error, message, detail, onRetry, retryLabel = "Try again", actions, compact, className }: ErrorStateProps) {
  const shape = error !== undefined ? errorShape(error) : null;
  const body = message ?? shape?.message;
  const raw = detail ?? shape?.detail;
  const [copied, setCopied] = useState(false);

  return (
    <div className={cx("app-error", compact && "app-error--compact", className)} role="alert">
      <ProofMark kind="bang" className="app-error__mark" />
      <div className="app-error__main">
        <p className="app-error__title">{title}</p>
        {body ? <p className="app-error__body">{body}</p> : null}
        {raw ? (
          <details className="app-details">
            <summary>Technical details</summary>
            <pre className="app-error__detail">{raw}</pre>
            <Button
              size="sm"
              variant="quiet"
              icon="copy"
              onClick={() => {
                void navigator.clipboard?.writeText(raw).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy details"}
            </Button>
          </details>
        ) : null}
        {onRetry || actions ? (
          <div className="app-error__actions">
            {onRetry ? (
              <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
                {retryLabel}
              </Button>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
