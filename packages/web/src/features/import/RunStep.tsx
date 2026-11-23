/**
 * Step 3 — bringing it over: each step with its real count, one calm bar,
 * and Stop. Stopping keeps whatever already arrived, and says what that is.
 */
import type { ImportRunStatus } from "@galley/core/types";
import { Button, Icon, ProofMark, Spinner, cx } from "@/ui";
import { stepLine, visibleSteps } from "./logic";

export function RunStep({ status, onStop, stopping }: { status: ImportRunStatus; onStop: () => void; stopping: boolean }) {
  const percent = Math.round((status.state === "running" ? (status.job.progress ?? 0) : 1) * 100);
  return (
    <div className="imp-run">
      <ol className="imp-steps" aria-live="polite">
        {visibleSteps(status).map((step) => (
          <li key={step.id} className={cx("imp-step", `imp-step--${step.state}`)}>
            <span className="imp-step__mark" aria-hidden="true">
              {step.state === "done" ? <Icon name="check" /> : step.state === "running" ? <Spinner label="Working" /> : step.state === "stopped" ? <Icon name="stop" /> : <span className="imp-step__dot" />}
            </span>
            <span className="imp-step__text">{stepLine(step)}</span>
            {step.state === "running" && step.total ? (
              <span className="imp-step__bar" aria-hidden="true">
                <span style={{ inlineSize: `${Math.round(((step.done ?? 0) / step.total) * 100)}%` }} />
              </span>
            ) : null}
            <span className="g-sr">{step.state === "done" ? "done" : step.state === "running" ? "in progress" : step.state === "stopped" ? "stopped" : "waiting"}</span>
          </li>
        ))}
      </ol>
      <div className="imp-run__bar" role="progressbar" aria-label="Bringing the site over" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ inlineSize: `${Math.max(3, percent)}%` }} />
      </div>
      {status.state === "running" ? (
        <div className="imp-run__foot">
          <p className="imp-run__note">Everything lands as pending changes — nothing goes live. You can leave this screen; it keeps going.</p>
          <Button variant="danger-quiet" icon="stop" busy={stopping} busyLabel="Stopping…" onClick={onStop}>
            Stop the import
          </Button>
        </div>
      ) : status.state === "error" ? (
        <div className="imp-problem" role="alert">
          <ProofMark kind="bang" />
          <p>{status.problem?.message ?? status.message}</p>
        </div>
      ) : (
        <p className={cx("imp-run__end", status.state === "stopped" && "imp-run__end--stopped")} role="status">
          {status.message}
        </p>
      )}
    </div>
  );
}
