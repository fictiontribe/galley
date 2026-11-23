/**
 * What the Forms and Scripts screens show on a site without the site kit:
 * "Set it up for me" — one button that adds the kit as pending changes —
 * and, when part of the site's code is too unusual to change without
 * guessing, exactly what is left and two ways to finish it.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SiteKitStatus, SiteKitStep } from "@galley/core/api";
import type { Job } from "@galley/core/types";
import { errorShape } from "@/lib/api";
import { useMeta } from "@/lib/stores/meta";
import { useJob, useShowingJob } from "@/lib/stores/jobs";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { Button, EmptyState, ErrorState, ProofMark, Skeleton, Spinner, buttonClass } from "@/ui";
import { docsPage } from "../logic/locate";
import { useAllowBuild, useAssistantPanel, useAssistantReady } from "./assistant";
import { splitSteps, startKitSetup, useKitStatus } from "./kit";

export interface SetupStateProps {
  feature: "forms" | "scripts";
}

const WORDS = {
  forms: {
    title: "This site doesn’t have forms yet.",
    body: "Forms are files the site’s own pages show, so the site needs the site kit first. Set it up for me adds it, with a first “Contact” form, as changes you check in Proof.",
    left: "Forms are nearly set up.",
  },
  scripts: {
    title: "This site doesn’t manage its scripts here yet.",
    body: "Scripts are kept in one setup file the site reads when it builds, so the site needs the site kit first. Set it up for me adds it as changes you check in Proof.",
    left: "Scripts are nearly set up.",
  },
} as const;

function StepList({ steps }: { steps: SiteKitStep[] }) {
  return (
    <ul className="kit-setup__steps">
      {steps.map((step) => (
        <li key={step.id} className={`kit-setup__step kit-setup__step--${step.state}`}>
          <span className="kit-setup__step-label">{step.label}</span>
          {step.state === "left" && step.detail ? <span className="kit-setup__step-detail">{step.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function DeveloperSteps({ steps }: { steps: SiteKitStep[] }) {
  const snippets = steps.filter((step) => step.snippet);
  if (snippets.length === 0) return null;
  return (
    <details className="app-details kit-setup__dev">
      <summary>For developers</summary>
      {snippets.map((step) => (
        <div key={step.id} className="kit-setup__snippet">
          <p className="g-field__key">{step.snippet!.file}</p>
          <pre className="kit-embed__code">
            <code>{step.snippet!.code}</code>
          </pre>
        </div>
      ))}
    </details>
  );
}

/** The set-up as it runs: the step under way, in the engine's words. */
function Running({ detail }: { detail: string | undefined }) {
  return (
    <EmptyState mark="caret" title="Setting up forms and scripts…" body={detail ?? "Reading the site"}>
      <div className="kit-setup__working" role="status">
        <Spinner label="Setting up" />
      </div>
    </EmptyState>
  );
}

/** What a site needs before this screen can work, and the one button that does it. */
export function SetupState({ feature }: SetupStateProps) {
  const navigate = useNavigate();
  const siteId = useSite((s) => s.detail?.id ?? "");
  const docsUrl = useMeta((s) => s.meta?.brand.docsUrl);
  const ready = useAssistantReady();
  const allowBuild = useAllowBuild();
  const show = useAssistantPanel((s) => s.show);
  const status = useKitStatus(siteId);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const job = useJob(jobId);
  const words = WORDS[feature];
  const running = starting || (jobId !== null && (job === null || job.state === "running"));
  useShowingJob(jobId, running);

  // When the set-up ends the site is read again (the screens switch over by themselves); say how it went.
  const ended = (done: Job) => {
    if (done.state === "error") {
      notify({ tone: "danger", title: "Couldn’t set up forms and scripts", body: done.detail ?? "Nothing was changed." });
      return;
    }
    notify({
      tone: done.output ? "warning" : "success",
      title: "Forms and scripts are set up",
      body: done.detail,
      ...(done.output ? { detail: done.output } : {}),
      action: { label: "Open Proof", onClick: () => navigate(`/sites/${siteId}/proof`) },
      duration: 12000,
    });
  };

  const run = async () => {
    setStarting(true);
    try {
      const started = await startKitSetup(siteId, ended);
      setJobId(started.id);
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t set up forms and scripts", body: errorShape(error).message });
    } finally {
      setStarting(false);
    }
  };

  if (running) return <Running detail={job?.detail} />;
  if (status.loading || !siteId) return <Skeleton lines={4} height={14} />;
  if (!status.data) return <ErrorState title="Couldn’t check this site’s set-up" error={status.error} onRetry={() => void status.refetch()} />;
  const kit: SiteKitStatus = status.data;
  const docs = docsPage(docsUrl, feature);

  if (!kit.supported) {
    const guide = docsPage(docsUrl, "adapters");
    return (
      <EmptyState
        mark="pilcrow"
        title="The site kit is for Astro sites today."
        body={kit.reason}
        actions={
          guide ? (
            <a className={buttonClass("primary")} href={guide} target="_blank" rel="noreferrer">
              Read the adapter guide
            </a>
          ) : null
        }
      />
    );
  }
  const { ready: todo, left } = splitSteps(kit);
  const docsLink = (primary: boolean) =>
    docs ? (
      <a className={buttonClass(primary ? "primary" : "secondary")} href={docs} target="_blank" rel="noreferrer">
        How a developer does it
      </a>
    ) : null;
  const askAssistant =
    ready && allowBuild && kit.assistantRequest ? (
      <Button variant={todo.length > 0 ? "secondary" : "primary"} icon="chat" onClick={() => show({ draft: kit.assistantRequest, mode: "build" })}>
        Ask the assistant to finish it
      </Button>
    ) : null;

  // Nothing set-up can still do: say what's left, and offer the two ways to finish it.
  if (todo.length === 0 && left.length > 0) {
    return (
      <EmptyState
        mark="caret"
        title={words.left}
        body={`Set-up did everything it could without guessing. ${left.length === 1 ? "One part of the site’s code is" : `${left.length} parts of the site’s code are`} left:`}
        actions={
          <>
            {askAssistant}
            {docsLink(!askAssistant)}
          </>
        }
      >
        <StepList steps={left} />
        <DeveloperSteps steps={left} />
      </EmptyState>
    );
  }
  if (!kit.buildAllowed) {
    return (
      <EmptyState
        mark="pilcrow"
        title={words.title}
        body="Setting it up changes the site’s code, and this site’s settings turn that off. Turn on “Allow build mode” in Site settings › Assistant, or have a developer add the site kit by hand."
        actions={
          <>
            <Link className={buttonClass("primary")} to={`/sites/${siteId}/settings#assistant`}>
              Open Site settings › Assistant
            </Link>
            {docsLink(false)}
          </>
        }
      />
    );
  }
  return (
    <EmptyState
      mark="pilcrow"
      title={words.title}
      body={words.body}
      actions={
        <>
          <Button variant="primary" icon="plus" busy={starting} busyLabel="Starting…" onClick={() => void run()}>
            Set it up for me
          </Button>
          {docsLink(false)}
        </>
      }
    >
      <StepList steps={[...todo, ...left]} />
      {left.length > 0 ? <p className="g-hint">The parts marked as left need a developer or the assistant afterwards; set-up won’t guess at them.</p> : null}
      {feature === "forms" ? (
        <p className="g-hint kit-setup__inbox">
          {kit.inbox.reachable && kit.inbox.address
            ? `The live site’s forms will send to this app’s inbox at ${kit.inbox.address}.`
            : "Forms in the preview send to this app’s inbox. Visitors can’t reach it from this computer, so the Forms screen then asks where the live site should send submissions."}
        </p>
      ) : null}
    </EmptyState>
  );
}

/** On a screen that works already: a part of the set-up still left (the scripts in the layout), with the same two ways to finish. */
export function SetupLeftNotice({ step }: { step: SiteKitStep["id"] }) {
  const siteId = useSite((s) => s.detail?.id ?? "");
  const status = useKitStatus(siteId);
  const ready = useAssistantReady();
  const allowBuild = useAllowBuild();
  const show = useAssistantPanel((s) => s.show);
  const left = status.data?.steps.find((candidate) => candidate.id === step && candidate.state === "left");
  if (!left || !status.data) return null;
  return (
    <div className="kit-callout" role="note">
      <ProofMark kind="bang" className="kit-callout__mark" />
      <div className="kit-callout__main">
        <p className="kit-callout__title">One part of the set-up is left: {left.label.toLowerCase()}</p>
        {left.detail ? <p className="kit-callout__body">{left.detail} Until then, nothing here loads on the site’s pages.</p> : null}
        <DeveloperSteps steps={[left]} />
        {ready && allowBuild && status.data.assistantRequest ? (
          <div className="kit-callout__actions">
            <Button size="sm" variant="primary" icon="chat" onClick={() => show({ draft: status.data!.assistantRequest, mode: "build" })}>
              Ask the assistant to finish it
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
