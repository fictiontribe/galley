/**
 * "Rebuild all": the pages, the model and the estimated cost are shown
 * before anything starts; then the queue's progress, page by page, with Stop.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ImportRebuildStatus } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { useJob, useJobs } from "@/lib/stores/jobs";
import { count } from "@/lib/format";
import { Button, Dialog, ErrorState, Icon, ProofMark, Skeleton, Spinner, buttonClass, cx } from "@/ui";
import { importKeys } from "./data";
import { costRange } from "./logic";
import { SettingsLink } from "@/features/accounts/SettingsLink";

export function RebuildAllDialog({ siteId, open, onClose, onFinished }: { siteId: string; open: boolean; onClose: () => void; onFinished: () => void }) {
  const plan = useQuery(importKeys.rebuildPlan(siteId), () => api("GET /api/sites/:siteId/import/rebuild-all", { params: { siteId } }), { enabled: open });
  const [status, setStatus] = useState<ImportRebuildStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const job = useJob(status?.job.id ?? null);
  const running = job ? job.state === "running" : status?.job.state === "running";

  const start = async () => {
    setStarting(true);
    setProblem(null);
    try {
      const started = await api("POST /api/sites/:siteId/import/rebuild-all", { params: { siteId }, body: {} });
      useJobs.getState().upsert(started.job);
      setStatus(started);
      const poll = async () => {
        const now = await api("GET /api/sites/:siteId/import/rebuild-all/:jobId", { params: { siteId, jobId: started.job.id } });
        setStatus(now);
        if (now.job.state === "running") setTimeout(() => void poll(), 1200);
        else onFinished();
      };
      setTimeout(() => void poll(), 800);
    } catch (error) {
      setProblem(errorShape(error).message);
    } finally {
      setStarting(false);
    }
  };
  const stop = async () => {
    if (!status) return;
    setStatus(await api("POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel", { params: { siteId, jobId: status.job.id } }));
  };
  const cost = costRange(plan.data?.estimate ?? null);
  const pages = plan.data?.pages ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rebuild every page-builder page"
      description="Each page gets its own conversation with the assistant, one after another. Every result lands in Proof for you to check."
      size="md"
      footer={
        status ? (
          running ? (
            <Button variant="danger-quiet" icon="stop" onClick={() => void stop()}>
              Stop after this page
            </Button>
          ) : (
            <>
              <Button variant="quiet" onClick={onClose}>
                Close
              </Button>
              <Link className={buttonClass("primary", "md")} to={`/sites/${siteId}/proof`}>
                Open Proof
              </Link>
            </>
          )
        ) : (
          <>
            <Button variant="quiet" onClick={onClose}>
              Not now
            </Button>
            {plan.data && !plan.data.connected ? (
              <SettingsLink route="PUT /api/secrets/:name" className={buttonClass("primary", "md")} to="/settings" fallback="An owner of this editor can connect the assistant.">
                Connect the assistant
              </SettingsLink>
            ) : (
              <Button variant="primary" busy={starting} busyLabel="Starting…" disabled={!plan.data || pages.length === 0} onClick={() => void start()}>
                {`Rebuild ${count(pages.length, "page")}`}
              </Button>
            )}
          </>
        )
      }
    >
      {plan.loading ? (
        <div aria-busy="true">
          <Skeleton height={64} />
        </div>
      ) : plan.status === "error" && !plan.data ? (
        <ErrorState compact title="Couldn’t work out the cost" error={plan.error} onRetry={() => void plan.refetch()} />
      ) : status ? (
        <ol className="imp-queue" aria-live="polite">
          {status.pages.map((page) => (
            <li key={page.path} className={cx("imp-queue__item", `imp-queue__item--${page.state}`)}>
              <span className="imp-queue__mark" aria-hidden="true">
                {page.state === "done" ? <Icon name="check" /> : page.state === "working" ? <Spinner label="Working" /> : page.state === "failed" ? <ProofMark kind="bang" /> : <span className="imp-step__dot" />}
              </span>
              <span className="imp-queue__title">{page.title}</span>
              <span className="imp-queue__state">{page.state === "done" ? "In Proof" : page.state === "working" ? "Rebuilding…" : page.state === "failed" ? (page.reason ?? "Couldn’t finish") : page.state === "stopped" ? "Not started" : "Waiting"}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="imp-cost">
          <p className="imp-cost__figure">{cost ?? "No price known for this model"}</p>
          <p className="imp-cost__text">
            {`Estimated for ${count(pages.length, "page")} with ${plan.data?.model ?? "the assistant’s model"}, at list prices. What is really spent shows in App settings › Usage.`}
          </p>
          <ul className="imp-chips">
            {pages.map((page) => (
              <li key={page.path} className="g-tag">
                {page.title}
                {page.rebuilt ? " · started before" : ""}
              </li>
            ))}
          </ul>
          {problem ? (
            <p className="g-error-text" role="alert">
              <ProofMark kind="bang" />
              <span>{problem}</span>
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
