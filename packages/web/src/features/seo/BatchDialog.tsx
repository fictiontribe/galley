import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { WriteBatchStatus, WriteKind, WritePlan } from "@galley/core/seo/types";
import { api } from "@/lib/api";
import { useManagedAi } from "@/lib/credits";
import { Badge, Button, buttonClass, Dialog, ErrorState, Field, Input, Skeleton } from "@/ui";
import { useNameOf } from "@/lib/names";
import { count, WRITE_LABEL } from "./logic";

export interface BatchDialogProps {
  siteId: string;
  open: boolean;
  onClose: () => void;
  kind: WriteKind | null;
  /** Only these pages (one finding's "Write it for me"); all of the kind when absent. */
  paths?: string[];
  onFinished?: () => void;
}

const STATE: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  pending: { label: "Waiting", tone: "neutral" },
  written: { label: "Written", tone: "success" },
  skipped: { label: "Left as it is", tone: "warning" },
  failed: { label: "Couldn't write", tone: "danger" },
};

/**
 * An assistant-written batch: what it will do and how many requests it
 * takes, a cap, then progress page by page. Everything it writes waits in
 * Proof; it never publishes.
 */
export function BatchDialog({ siteId, open, onClose, kind, paths, onFinished }: BatchDialogProps) {
  const { managed, disabled: aiDisabled, manageUrl } = useManagedAi();
  const [plan, setPlan] = useState<WritePlan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cap, setCap] = useState(0);
  const [status, setStatus] = useState<WriteBatchStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const pathKey = paths?.join("\n") ?? "";

  useEffect(() => {
    if (!open || !kind) return;
    let alive = true;

    setPlan(null);
    setStatus(null);
    setError(null);
    api("POST /api/sites/:siteId/visibility/write/plan", { params: { siteId }, body: { kind, ...(paths ? { paths } : {}) } })
      .then((next) => {
        if (!alive) return;
        setPlan(next);
        setCap(next.requests);
      })
      .catch((reason: unknown) => alive && setError(reason));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paths is compared by its contents
  }, [open, kind, siteId, pathKey]);

  const running = status?.job.state === "running";

  useEffect(() => {
    if (!status || status.job.state !== "running") return;
    const timer = setInterval(() => {
      void api("GET /api/sites/:siteId/visibility/write/:jobId", { params: { siteId, jobId: status.job.id } })
        .then((next) => {
          setStatus(next);
          if (next.job.state !== "running") onFinished?.();
        })
        .catch(() => undefined);
    }, 800);
    return () => clearInterval(timer);
  }, [status, siteId, onFinished]);

  const start = async () => {
    if (!kind || !plan) return;
    setStarting(true);
    try {
      setStatus(await api("POST /api/sites/:siteId/visibility/write", { params: { siteId }, body: { kind, ...(paths ? { paths } : {}), limit: Math.max(1, Math.min(cap, plan.requests)) } }));
    } catch (reason) {
      setError(reason);
    } finally {
      setStarting(false);
    }
  };
  const stop = () => {
    if (status) void api("POST /api/sites/:siteId/visibility/write/:jobId/cancel", { params: { siteId, jobId: status.job.id } });
  };
  const label = kind ? WRITE_LABEL[kind] : null;
  const items = status?.items ?? plan?.items.map((item) => ({ ...item, state: "pending" as const })) ?? [];
  const name = useNameOf();
  const written = status?.items.filter((item) => item.state === "written").length ?? 0;

  let body;
  if (error) body = <ErrorState compact title="Couldn’t start writing" error={error} />;
  else if (!plan) body = <Skeleton lines={4} />;
  else if (plan.requests === 0) body = <p>Nothing to write: every page already has its {label?.noun}.</p>;
  else
    body = (
      <div className="seo-batch">
        {!status ? (
          <>
            <p className="seo-batch__lede">{plan.note}</p>
            <dl className="seo-batch__facts">
              <div>
                <dt>Pages</dt>
                <dd>{plan.requests.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Requests to the assistant</dt>
                <dd>{count(Math.min(cap || plan.requests, plan.requests), "request")}, one per page</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd className="g-mono">{plan.model}</dd>
              </div>
            </dl>
            {plan.requests > 1 ? (
              <Field label="Write at most" hint={`Up to ${plan.requests} pages. The rest stay on the list for later.`}>
                <Input type="number" min={1} max={plan.requests} value={cap} onChange={(event) => setCap(Number(event.target.value))} size="sm" />
              </Field>
            ) : null}
            {!plan.connected || aiDisabled ? (
              <p className="seo-batch__note">
                {managed ? (
                  <>
                    AI is switched off for this site. A workspace manager can turn it on in{" "}
                    {manageUrl ? (
                      <a className="g-link" href={manageUrl} target="_blank" rel="noopener noreferrer">
                        Galley Cloud
                      </a>
                    ) : (
                      "Galley Cloud"
                    )}
                    .
                  </>
                ) : (
                  "Connect the assistant in App settings to write these. Nothing is sent until then."
                )}
              </p>
            ) : null}
          </>
        ) : (
          <div className="seo-batch__progress" role="status" aria-live="polite">
            <progress max={1} value={status.job.progress ?? 0} aria-label="Progress" />
            <span>{status.job.detail}</span>
          </div>
        )}
        <ol className="seo-batch__items" aria-label="Pages">
          {items.slice(0, status ? items.length : 8).map((item) => (
            <li key={`${item.path}:${item.field.join(".")}`} className="seo-batch__item">
              <span className="seo-batch__page">
                {name(item)}
                <span className="seo-batch__field">{item.fieldLabel}</span>
              </span>
              {status ? <Badge tone={STATE[item.state]!.tone}>{STATE[item.state]!.label}</Badge> : null}
              {"value" in item && item.value ? <q className="seo-batch__value">{item.value}</q> : null}
              {"reason" in item && item.reason ? <span className="seo-batch__reason">{item.reason}</span> : null}
            </li>
          ))}
          {!status && items.length > 8 ? <li className="seo-batch__more">and {count(items.length - 8, "more page")}</li> : null}
        </ol>
      </div>
    );

  return (
    <Dialog
      open={open}
      onClose={running ? () => undefined : onClose}
      size="lg"
      title={label && plan ? label.many(plan.requests) : "Write with the assistant"}
      description="Written only from what each page already says. Everything waits in Proof; nothing is published."
      footer={
        status && !running ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {written ? (
              <Link className={buttonClass("primary")} to={`/sites/${encodeURIComponent(siteId)}/proof`} onClick={onClose}>
                Review {count(written, "change")} in Proof
              </Link>
            ) : null}
          </>
        ) : running ? (
          <Button variant="secondary" onClick={stop}>
            Stop after this page
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Not now
            </Button>
            <Button variant="primary" icon="chat" busy={starting} busyLabel="Starting…" disabled={!plan || !plan.connected || aiDisabled || plan.requests === 0} onClick={() => void start()}>
              {label && plan ? label.many(Math.min(cap || plan.requests, plan.requests)) : "Write"}
            </Button>
          </>
        )
      }
    >
      {body}
    </Dialog>
  );
}
