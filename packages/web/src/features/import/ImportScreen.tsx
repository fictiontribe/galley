/**
 * /sites/:siteId/import — "Bring your WordPress site": where it is → what
 * will come across → bringing it over → the report. One step on screen at a
 * time. Everything lands as pending changes; the flow never publishes.
 *
 * The application password, when one is needed, lives in this screen's
 * memory only: it is sent with the requests that read the site and is never
 * stored in the browser.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { ImportInspection, ImportPlanView, ImportRunStatus, ImportSource } from "@galley/core/types";
import { useTopBar } from "@/app/chrome";
import { useChatUi } from "@/features/chat/store";
import { api, errorShape } from "@/lib/api";
import { invalidate, setQueryData, useQuery } from "@/lib/query";
import { useChanges } from "@/lib/stores/changes";
import { useJobs } from "@/lib/stores/jobs";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { Button, ErrorState, ProofMark, Skeleton, buttonClass, cx } from "@/ui";
import { importKeys } from "./data";
import { FLOW, FLOW_LABEL, reportHead, reportStanding, type FlowStep } from "./logic";
import { PlanStep } from "./PlanStep";
import { RebuildAllDialog } from "./RebuildAllDialog";
import { ReportStep } from "./ReportStep";
import { RunStep } from "./RunStep";
import { SourceStep } from "./SourceStep";
import "./import.css";

function Stepper({ step }: { step: FlowStep }) {
  const at = FLOW.indexOf(step);
  return (
    <ol className="imp-stepper" aria-label="Steps">
      {FLOW.map((item, index) => (
        <li key={item} className={cx("imp-stepper__item", index === at && "imp-stepper__item--current", index < at && "imp-stepper__item--done")} aria-current={index === at ? "step" : undefined}>
          <span className="imp-stepper__number">{index + 1}</span>
          <span className="imp-stepper__label">{FLOW_LABEL[item]}</span>
        </li>
      ))}
    </ol>
  );
}

export function ImportScreen() {
  const { siteId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const detail = useSite((s) => s.detail);
  useTopBar({ crumbs: [{ label: detail?.name ?? "Site", to: `/sites/${siteId}` }, { label: "Bring your WordPress site" }] });
  const fresh = params.get("from") === "new";
  const stored = useQuery(importKeys.report(siteId), () => api("GET /api/sites/:siteId/import/report", { params: { siteId } }));
  const [step, setStep] = useState<FlowStep | null>(null);
  const [ready, setReady] = useState<{ source: ImportSource; look: ImportInspection } | null>(null);
  const [plan, setPlan] = useState<ImportPlanView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [planning, setPlanning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [run, setRun] = useState<ImportRunStatus | null>(null);
  const [stopping, setStopping] = useState(false);
  const [rebuilding, setRebuilding] = useState<string | null>(null);
  const [rebuildAll, setRebuildAll] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // A site that was imported into before opens on its report; otherwise on step 1.
  useEffect(() => {
    if (step !== null || stored.loading) return;
    setStep(stored.data?.report && params.get("again") === null && !fresh ? "report" : "source");
  }, [stored.loading, stored.data, step, params, fresh]);
  useEffect(() => heading.current?.focus({ preventScroll: true }), [step]);
  // The report says where its changes stand (waiting, published, discarded): read it again whenever the pending changes move.
  const pending = useChanges((s) => s.changes);
  useEffect(() => {
    if (pending) invalidate(importKeys.report(siteId));
  }, [pending, siteId]);

  // Follow the run until it ends; the job events keep the activity tray in step too.
  useEffect(() => {
    if (!run || run.state !== "running") return;
    const timer = setTimeout(async () => {
      try {
        const now = await api("GET /api/sites/:siteId/import/runs/:runId", { params: { siteId, runId: run.id } });
        setRun(now);
        if (now.state !== "running") {
          if (now.report) setQueryData(importKeys.report(siteId), { report: now.report });
          invalidate(["site", siteId]);
          // The top bar's count of pending changes follows straight away.
          void useChanges.getState().refresh();
        }
      } catch {
        // A missed poll is retried by the next one.
        setRun({ ...run });
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [run, siteId]);

  const loadPlan = async (source: ImportSource, given: Record<string, string>) => {
    setPlanning(true);
    setProblem(null);
    try {
      const next = await api("POST /api/sites/:siteId/import/plan", { params: { siteId }, body: { source, answers: given } });
      setPlan(next);
      setStep("plan");
    } catch (error) {
      setProblem(errorShape(error).message);
    } finally {
      setPlanning(false);
    }
  };
  const answer = (id: string, value: string) => {
    const given = { ...answers, [id]: value };
    setAnswers(given);
    if (ready) void loadPlan(ready.source, given);
  };
  const start = async () => {
    if (!ready || !plan) return;
    setProblem(null);
    try {
      // Every question goes with the answer the picture showed.
      const given = Object.fromEntries(plan.questions.map((question) => [question.id, answers[question.id] ?? question.answer]));
      const started = await api("POST /api/sites/:siteId/import/run", { params: { siteId }, body: { source: ready.source, answers: given } });
      useJobs.getState().upsert(started.job);
      setRun(started);
      setStep("run");
    } catch (error) {
      setProblem(errorShape(error).message);
    }
  };
  const stop = async () => {
    if (!run) return;
    setStopping(true);
    try {
      setRun(await api("POST /api/sites/:siteId/import/runs/:runId/cancel", { params: { siteId, runId: run.id } }));
    } finally {
      setStopping(false);
    }
  };
  const rebuild = async (path: string) => {
    setRebuilding(path);
    try {
      const { threadId } = await api("POST /api/sites/:siteId/import/rebuild", { params: { siteId }, body: { path } });
      useChatUi.getState().setThread(siteId, threadId);
      useChatUi.getState().confirmBuild(siteId);
      invalidate(importKeys.report(siteId));
      navigate(`/sites/${siteId}/edit?path=${encodeURIComponent(path)}`);
    } catch (error) {
      const shape = errorShape(error);
      notify({ tone: "warning", title: shape.code === "unconfigured" ? "Connect the assistant first" : "Couldn’t start the rebuild", body: shape.message });
    } finally {
      setRebuilding(null);
    }
  };

  const report = step === "report" ? (run?.report ?? stored.data?.report ?? null) : null;
  const sourceTitle = plan?.source.title || ready?.look.title || "the old site";
  const head: Record<FlowStep, { title: string; lede: string }> = {
    source: {
      title: "Where is your WordPress site?",
      lede: fresh ? `${detail?.name ?? "Your new site"} is ready. Paste your WordPress site’s address, or drop an export file, to bring its content in.` : "Paste its address, or drop an export file. Nothing on the old site changes — this only reads what it shows visitors.",
    },
    plan: { title: `Here’s what comes across from ${sourceTitle}`, lede: `Into ${detail?.name ?? "this site"}, as pending changes you check in Proof. Nothing is written until you start.` },
    run: {
      title: run?.state === "done" ? "It’s all here" : run?.state === "stopped" ? "Stopped part-way" : run?.state === "error" ? "The import couldn’t finish" : "Bringing it over…",
      lede: run?.state === "running" ? `From ${sourceTitle} into ${detail?.name ?? "this site"}.` : "",
    },
    report: report ? reportHead(report) : { title: "Your WordPress site is here", lede: "" },
  };

  if (step === null) {
    return (
      <div className="app-screen imp" aria-busy="true">
        <div className="imp-sheet">
          <Skeleton width={180} height={12} />
          <Skeleton width={420} height={36} />
          <Skeleton height={120} />
        </div>
      </div>
    );
  }
  if (stored.status === "error" && !stored.data && step === "report") {
    return (
      <div className="app-screen imp">
        <ErrorState title="Couldn’t load the import" error={stored.error} onRetry={() => void stored.refetch()} />
      </div>
    );
  }
  const { title, lede } = head[step];

  return (
    <div className="app-screen imp">
      <div className="imp-sheet">
        <header className="imp-head">
          <p className="g-eyebrow">Bring your WordPress site</p>
          <Stepper step={step} />
          <h1 ref={heading} tabIndex={-1} className="imp-title" key={`${step}-${title}`}>
            {title}
          </h1>
          {lede ? <p className="imp-lede">{lede}</p> : null}
        </header>

        <div className="imp-body" key={step}>
          {step === "source" ? <SourceStep siteId={siteId} onReady={setReady} initial={ready} /> : null}
          {step === "plan" && plan ? <PlanStep plan={plan} answers={answers} onAnswer={answer} busy={planning} /> : null}
          {step === "run" && run ? <RunStep status={run} onStop={() => void stop()} stopping={stopping} /> : null}
          {step === "report" && report ? <ReportStep siteId={siteId} report={report} onAgain={() => (setRun(null), ready ? void loadPlan(ready.source, answers) : setStep("source"))} onRebuild={(path) => void rebuild(path)} onRebuildAll={() => setRebuildAll(true)} rebuilding={rebuilding} /> : null}
        </div>

        {problem ? (
          <p className="g-error-text imp-problem-line" role="alert">
            <ProofMark kind="bang" />
            <span>{problem}</span>
          </p>
        ) : null}

        <footer className="imp-actions">
          {step === "source" ? (
            <>
              <Link className={buttonClass("quiet", "md")} to={`/sites/${siteId}`}>
                Not now
              </Link>
              <span className="g-toolbar__spacer" />
              <Button variant="primary" disabled={!ready} busy={planning} busyLabel="Reading the site…" onClick={() => ready && void loadPlan(ready.source, answers)}>
                Continue
              </Button>
            </>
          ) : step === "plan" ? (
            <>
              <Button variant="quiet" onClick={() => setStep("source")}>
                Back
              </Button>
              <span className="g-toolbar__spacer" />
              <Button variant="primary" disabled={planning || !plan || plan.counts.posts + plan.counts.pages === 0} onClick={() => void start()}>
                {plan ? `Bring over ${plan.counts.posts + plan.counts.pages} ${plan.counts.posts + plan.counts.pages === 1 ? "entry" : "entries"}` : "Bring it over"}
              </Button>
            </>
          ) : step === "run" && run && run.state !== "running" ? (
            <>
              {run.state === "error" ? (
                <Button variant="quiet" onClick={() => setStep("plan")}>
                  Back to the plan
                </Button>
              ) : null}
              <span className="g-toolbar__spacer" />
              {run.report ? (
                <Button variant="primary" onClick={() => setStep("report")}>
                  {run.state === "stopped" ? "See what arrived" : "See the report"}
                </Button>
              ) : null}
            </>
          ) : step === "report" && report && reportStanding(report) === "discarded" ? (
            <>
              <span className="g-toolbar__spacer" />
              <Button variant="primary" onClick={() => (setRun(null), setPlan(null), setStep("source"))}>
                Start again
              </Button>
            </>
          ) : step === "report" ? (
            <>
              <Button variant="quiet" onClick={() => (setRun(null), setPlan(null), setStep("source"))}>
                Import again
              </Button>
              <span className="g-toolbar__spacer" />
              <Link className={buttonClass("primary", "md")} to={`/sites/${siteId}/proof`}>
                Open Proof
              </Link>
            </>
          ) : null}
        </footer>
      </div>
      <RebuildAllDialog siteId={siteId} open={rebuildAll} onClose={() => setRebuildAll(false)} onFinished={() => invalidate(importKeys.report(siteId))} />
    </div>
  );
}
