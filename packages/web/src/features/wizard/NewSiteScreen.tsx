import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTopBar } from "@/app/chrome";
import { useChatUi } from "@/features/chat/store";
import { api, errorShape } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { useJob, useJobs, useShowingJob } from "@/lib/stores/jobs";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Button, ErrorState, ProofMark, Spinner, buttonClass } from "@/ui";
import { STEPS, briefMessage, emptyDraft, stepProblem, toBrief, type BriefDraft, type WizardStep } from "./brief";
import { AboutStep, CreateStep, NameStep, StarterStep, StyleStep } from "./steps";
import "./wizard.css";

const SAVED = "galley.newSite";
const STEP_LABEL: Record<WizardStep, string> = { name: "Name", starter: "Starter", about: "About", style: "Look and pages", create: "Create" };

function loadDraft(): BriefDraft {
  try {
    const raw = sessionStorage.getItem(SAVED);
    return raw ? { ...emptyDraft(), ...(JSON.parse(raw) as Partial<BriefDraft>) } : emptyDraft();
  } catch {
    return emptyDraft();
  }
}

/** Following the create job, then opening the editor with the assistant already building. */
function Progress({ jobId, draft, withBrief, onBack }: { jobId: string; draft: BriefDraft; withBrief: boolean; onBack: () => void }) {
  const navigate = useNavigate();
  const job = useJob(jobId);
  useShowingJob(jobId);
  const opened = useRef(false);

  useEffect(() => {
    if (!job || job.state !== "done" || !job.siteId || opened.current) return;
    opened.current = true;
    const siteId = job.siteId;
    useJobs.getState().dismiss(job.id);
    sessionStorage.removeItem(SAVED);
    if (job.detail && job.detail !== "The site is ready.") notify({ tone: "warning", title: "Created, with one problem", body: job.detail });
    const open = () => navigate(`/sites/${siteId}/edit`);
    // Starting from WordPress: the content comes from the old site, so the next stop is the import.
    if (draft.fromWordPress) {
      navigate(`/sites/${siteId}/import?from=new`);
      return;
    }
    if (!withBrief) {
      useChatUi.getState().setThread(siteId, null);
      open();
      return;
    }
    // The first conversation is the build itself: build mode, started from the brief.
    const brief = toBrief(draft);
    void (async () => {
      try {
        const thread = await api("POST /api/sites/:siteId/threads", { params: { siteId }, body: { mode: "build", title: `Build ${draft.name.trim()}` } });
        useChatUi.getState().setThread(siteId, thread.id);
        useChatUi.getState().confirmBuild(siteId);
        await api("POST /api/sites/:siteId/threads/:threadId/messages", { params: { siteId, threadId: thread.id }, body: { text: briefMessage(brief), mode: "build", brief } });
      } catch (error) {
        notify({ tone: "warning", title: "The site is ready, but the assistant didn’t start", body: `${errorShape(error).message} You can ask it from the editor.` });
      }
      open();
    })();
  }, [job, draft, withBrief, navigate]);

  if (job?.state === "error") {
    return (
      <div className="wizard-progress">
        <ErrorState title="Couldn’t create the site" message={job.detail ?? "The starter couldn’t be copied."} onRetry={onBack} retryLabel="Back to the brief" />
      </div>
    );
  }
  const progress = job?.progress ?? 0;
  const phases = [
    { label: "Copying the starter", done: progress >= 0.3 },
    { label: "Installing what the site needs", done: job?.state === "done", active: progress >= 0.3 },
    { label: draft.fromWordPress ? "Opening the WordPress import" : withBrief ? "Opening the editor and starting the assistant" : "Opening the editor", done: false, active: job?.state === "done" },
  ];
  return (
    <div className="wizard-progress" aria-busy="true">
      <p className="g-eyebrow">New site</p>
      <h1 className="wizard-title">{`Setting up ${draft.name.trim()}…`}</h1>
      <p className="wizard-lede">The first install can take a few minutes. You can leave this screen; the site appears in Sites when it’s ready.</p>
      <ol className="wizard-phases">
        {phases.map((phase, index) => {
          const running = !phase.done && (index === 0 ? true : Boolean(phase.active));
          return (
            <li key={phase.label} className={phase.done ? "wizard-phase wizard-phase--done" : running ? "wizard-phase wizard-phase--running" : "wizard-phase"}>
              {phase.done ? <ProofMark kind="caret" tone="insert" label="Done" /> : running ? <Spinner label="Working" /> : <span className="wizard-phase__dot" aria-hidden="true" />}
              <span>{phase.label}</span>
            </li>
          );
        })}
      </ol>
      <div className="app-progress" role="progressbar" aria-label="Setting up the site" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span className="app-progress__bar" style={{ inlineSize: `${Math.max(4, Math.round(progress * 100))}%` }} />
      </div>
      {job?.detail ? <p className="wizard-detail g-mono">{job.detail}</p> : null}
    </div>
  );
}

/** /new — a short brief, a starter copied, and the assistant builds the site while the preview fills in. */
export function NewSiteScreen() {
  useTopBar({ crumbs: [{ label: "Sites", to: "/" }, { label: "New site" }] });
  const starters = useQuery(keys.starters(), () => api("GET /api/starters"));
  const settings = useQuery(keys.settings(), () => api("GET /api/settings"));
  const keyReady = settings.data ? settings.data.secrets.some((secret) => secret.name === "anthropic" && secret.configured) : null;
  const [draft, setDraft] = useState<BriefDraft>(loadDraft);
  const [step, setStep] = useState<WizardStep>("name");
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState<"brief" | "plain" | null>(null);
  const [job, setJob] = useState<{ id: string; withBrief: boolean } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(SAVED, JSON.stringify(draft));
    } catch {
      // Not remembered across visits; the flow still works.
    }
  }, [draft]);
  useEffect(() => {
    const first = starters.data?.[0];
    if (first && !starters.data?.some((starter) => starter.id === draft.starter)) setDraft((current) => ({ ...current, starter: first.id }));
  }, [starters.data, draft.starter]);
  // Each step announces itself and takes focus at its heading, so keyboard and screen-reader users land in it.
  useEffect(() => heading.current?.focus(), [step]);

  const update = (patch: Partial<BriefDraft>) => {
    setProblem(null);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const index = STEPS.indexOf(step);
  const next = () => {
    const issue = stepProblem(step, draft);
    if (issue) {
      setProblem(issue);
      return;
    }
    // From WordPress, the brief steps are skipped: the old site's content takes their place.
    const following = step === "starter" && draft.fromWordPress ? "create" : STEPS[index + 1];
    if (following) setStep(following);
  };
  const back = () => {
    setProblem(null);
    const previous = step === "create" && draft.fromWordPress ? "starter" : STEPS[index - 1];
    if (previous) setStep(previous);
  };

  const create = async (withBrief: boolean) => {
    const issue = withBrief ? stepProblem("create", draft) : (stepProblem("name", draft) ?? stepProblem("starter", draft));
    if (issue) {
      setProblem(issue);
      return;
    }
    setCreating(withBrief ? "brief" : "plain");
    try {
      const started = await api("POST /api/sites/create", { body: { name: draft.name.trim(), starter: draft.starter, ...(withBrief ? { brief: toBrief(draft) } : {}) } });
      useJobs.getState().upsert(started);
      setJob({ id: started.id, withBrief });
    } catch (error) {
      setProblem(errorShape(error).message);
    } finally {
      setCreating(null);
    }
  };

  if (job) return <Progress jobId={job.id} draft={draft} withBrief={job.withBrief} onBack={() => setJob(null)} />;

  return (
    <div className="app-screen wizard">
      <div className="wizard-sheet">
        <ol className="wizard-steps" aria-label="Steps">
          {STEPS.map((item, at) => (
            <li key={item} className={at === index ? "wizard-step wizard-step--current" : at < index ? "wizard-step wizard-step--done" : "wizard-step"} aria-current={at === index ? "step" : undefined}>
              <span className="wizard-step__number">{at + 1}</span>
              <span className="wizard-step__label">{STEP_LABEL[item]}</span>
            </li>
          ))}
        </ol>
        <form
          className="wizard-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === "create") void create(keyReady !== false && !draft.fromWordPress);
            else next();
          }}
        >
          {step === "name" ? <NameStep draft={draft} update={update} heading={heading} /> : null}
          {step === "starter" ? <StarterStep draft={draft} update={update} heading={heading} starters={starters} /> : null}
          {step === "about" ? <AboutStep draft={draft} update={update} heading={heading} /> : null}
          {step === "style" ? <StyleStep draft={draft} update={update} heading={heading} /> : null}
          {step === "create" && !draft.fromWordPress ? <CreateStep draft={draft} heading={heading} keyReady={keyReady} /> : null}
          {step === "create" && draft.fromWordPress ? (
            <header className="wizard-head">
              <h1 ref={heading} tabIndex={-1} className="wizard-title">{`Create ${draft.name.trim()}, then bring your WordPress site in`}</h1>
              <p className="wizard-lede">The starter is copied first. Then you point at your WordPress site — its address or an export file — see what will come across, and bring it over.</p>
            </header>
          ) : null}
          {problem ? (
            <p className="g-error-text wizard-problem" role="alert">
              <ProofMark kind="bang" />
              <span>{problem}</span>
            </p>
          ) : null}
          <div className="wizard-actions">
            {index > 0 ? (
              <Button type="button" variant="quiet" onClick={back}>
                Back
              </Button>
            ) : (
              <Link className={buttonClass("quiet", "md")} to="/">
                Not now
              </Link>
            )}
            <span className="g-toolbar__spacer" />
            {step !== "create" ? (
              <Button type="submit" variant="primary">
                Continue
              </Button>
            ) : draft.fromWordPress ? (
              <Button type="submit" variant="primary" busy={creating === "plain"} busyLabel="Creating…">
                Create and continue
              </Button>
            ) : keyReady === false ? (
              <>
                <Button type="button" variant="secondary" busy={creating === "plain"} busyLabel="Creating…" onClick={() => void create(false)}>
                  Create the starter as it is
                </Button>
                <Link className={buttonClass("primary", "md")} to="/settings">
                  Add a key first
                </Link>
              </>
            ) : (
              <Button type="submit" variant="primary" busy={creating === "brief"} busyLabel="Creating…" disabled={keyReady === null}>
                Create site
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
