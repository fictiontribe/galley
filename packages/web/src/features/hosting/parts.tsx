/**
 * Pieces the guided flow, the Online screen's card and removal share: the
 * cost with where it came from, what will be created, what is handed over,
 * steps and files the person runs, and a job's progress or failure.
 */
import { useState } from "react";
import type { CostEstimate, HandoverLine, HostedResource, ManualStep, RecipeFile } from "@galley/core/hosting/types";
import type { Job } from "@galley/core/types";
import { copyText } from "@/features/deploy/parts";
import { Button, Icon, ProofMark, Spinner, buttonClass, cx } from "@/ui";
import { amount, costHeadline, creationStages, priceDate, resourceGroups, resourceWords, type KnownNames } from "./logic";
import "@/features/deploy/deploy.css";
import "./hosting.css";

/** "About $13 a month" (a range when it sleeps while unused), its lines, what it assumes, and where the prices were read. */
export function CostBlock({ cost, hostName, sleeps = false }: { cost: CostEstimate; hostName: string; sleeps?: boolean }) {
  return (
    <section className="host-cost" aria-label="What it costs">
      <p className="host-cost__total">{costHeadline(cost, { sleeps })}</p>
      {cost.lines.length > 0 ? (
        <dl className="host-cost__lines">
          {cost.lines.map((line) => (
            <div key={line.label} className="host-cost__line">
              <dt>{line.label}</dt>
              <dd className="g-mono">{line.amount === 0 ? "free" : amount(line.amount, cost.currency)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="host-cost__note">{cost.note}</p>
      <p className="g-hint">
        {`An estimate, not a quote: prices read ${priceDate(cost.checked)} · `}
        <a className="g-link" href={cost.source} target="_blank" rel="noopener noreferrer">
          {`${hostName}’s prices`}
        </a>
      </p>
    </section>
  );
}

/** One thing created (or to be removed): what it is in plain words, its name on the host in small mono, then the detail. */
export function ResourceRow({ resource, known }: { resource: HostedResource; known?: KnownNames }) {
  const words = resourceWords(resource, known);
  if (!words.what) {
    return (
      <>
        <span>{words.detail ?? words.name}</span>
        {words.detail && words.name ? <span className="host-list__meta g-mono">{words.name}</span> : null}
      </>
    );
  }
  return (
    <>
      <span className="host-list__head">
        <span className="host-list__what">{words.what}</span>
        {words.name ? <span className="host-list__meta g-mono">{words.name}</span> : null}
      </span>
      {words.detail ? <span className="host-list__detail">{words.detail}</span> : null}
    </>
  );
}

/** Everything that will be created, in order, in plain words; numbered on from `start` when a list is split by place. */
export function ResourceList({ resources, known, start = 1 }: { resources: HostedResource[]; known?: KnownNames; start?: number }) {
  return (
    <ol className="host-list host-list--numbered" start={start}>
      {resources.map((resource, index) => (
        <li key={`${resource.kind}-${resource.name}-${index}`} className="host-list__item">
          <ResourceRow resource={resource} known={known} />
        </li>
      ))}
    </ol>
  );
}

/** The resources by where each lives, one titled list per place (`title(place)`; a null place gets `fallback`). */
export function ResourceSections({ resources, host, known, title, fallback }: { resources: HostedResource[]; host: { id: string; name: string }; known?: KnownNames; title: (place: string) => string; fallback: string }) {
  return (
    <>
      {resourceGroups(resources, host).map((group) => (
        <section key={group.place ?? "elsewhere"} className="host-section">
          <h3 className="host-section__title">{group.place ? title(group.place) : fallback}</h3>
          <ResourceList resources={group.resources} known={known} start={group.start} />
        </section>
      ))}
    </>
  );
}

/** What the new install is handed, exactly as the plan says it; keys show their last four characters only. */
export function HandoverLines({ lines }: { lines: HandoverLine[] }) {
  if (lines.length === 0) return <p className="host-text">Nothing from this site is handed over. The editor’s first run asks for what it needs.</p>;
  return (
    <dl className="host-handover">
      {lines.map((line) => (
        <div key={`${line.label}-${line.value}`} className="host-handover__row">
          <dt>{line.label}</dt>
          <dd className={cx(line.secret ? "g-mono" : undefined, "host-handover__value")}>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Steps only the person can do, numbered, each with its text to copy and its page. */
export function StepsList({ steps }: { steps: ManualStep[] }) {
  return (
    <ol className="host-steps">
      {steps.map((step) => (
        <li key={step.title} className="host-steps__item">
          <p className="host-steps__title">{step.title}</p>
          <p className="host-steps__detail">{step.detail}</p>
          {step.copy ? (
            <div className="host-copy">
              <code className="host-copy__text g-mono">{step.copy}</code>
              <Button size="sm" variant="quiet" icon="copy" onClick={() => copyText(step.copy!, "Text")}>
                Copy
              </Button>
            </div>
          ) : null}
          {step.url ? (
            <a className={buttonClass("quiet", "sm")} href={step.url} target="_blank" rel="noopener noreferrer">
              <Icon name="external" />
              Open the page
            </a>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function download(file: RecipeFile): void {
  const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  // "proxy/compose.yaml" is saved as "proxy-compose.yaml": a download has no folders.
  anchor.download = file.name.replace(/\//g, "-");
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One file to run: its name, its content read-only with Copy and Download. A file holding a one-time code stays hidden until "Show". */
function FileBox({ file }: { file: RecipeFile }) {
  const [shown, setShown] = useState(!file.sensitive);
  const lines = Math.min(12, Math.max(3, file.content.split("\n").length));
  return (
    <div className="host-file">
      <div className="host-file__head">
        <span className="host-file__name g-mono">{file.name}</span>
        <span className="host-file__actions">
          {file.sensitive ? (
            <Button size="sm" variant="quiet" icon="eye" onClick={() => setShown((value) => !value)} aria-pressed={shown}>
              {shown ? "Hide" : "Show"}
            </Button>
          ) : null}
          <Button size="sm" variant="quiet" icon="copy" onClick={() => copyText(file.content, file.name)}>
            Copy
          </Button>
          <Button size="sm" variant="quiet" icon="download" onClick={() => download(file)}>
            Download
          </Button>
        </span>
      </div>
      {shown ? (
        <textarea className="host-file__text g-mono" readOnly rows={lines} value={file.content} aria-label={file.name} spellCheck={false} />
      ) : (
        <p className="host-file__hidden">It holds a one-time code that lets this editor connect, so it’s hidden. Copy or download it as it is.</p>
      )}
    </div>
  );
}

export function FilesList({ files }: { files: RecipeFile[] }) {
  return (
    <div className="host-files">
      {files.map((file) => (
        <FileBox key={file.name} file={file} />
      ))}
    </div>
  );
}

/** Problems that stop the plan, in red, each with its fix. */
export function PlanProblems({ problems }: { problems: Array<{ message: string; fix?: string }> }) {
  return (
    <div className="host-problems" role="alert">
      {problems.map((problem) => (
        <p key={problem.message} className="host-problems__item">
          <ProofMark kind="bang" />
          <span>
            {problem.message}
            {problem.fix ? <span className="host-problems__fix"> {problem.fix}</span> : null}
          </span>
        </p>
      ))}
    </div>
  );
}

/** A running editor job: plain stages (for a create), a bar, and the host's own words. */
export function EditorProgress({ job, managed, stages = true }: { job: Job | null; managed: boolean; stages?: boolean }) {
  const percent = Math.round((job?.state === "done" ? 1 : (job?.progress ?? 0)) * 100);
  return (
    <div className="deploy-progress" role="status" aria-live="polite">
      {stages ? (
        <ol className="deploy-progress__steps">
          {creationStages(job, managed).map((stage) => (
            <li key={stage.label} className={cx("deploy-progress__step", `deploy-progress__step--${stage.state}`)}>
              {stage.state === "done" ? <Icon name="check" /> : stage.state === "current" ? <Spinner label={stage.label} /> : <span className="deploy-progress__dot" aria-hidden="true" />}
              <span>{stage.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="deploy-progress__bar" aria-hidden="true">
        <span style={{ inlineSize: `${percent}%` }} />
      </div>
      <p className="deploy-progress__detail">{job?.detail ?? "Getting ready…"}</p>
    </div>
  );
}

/** A failed editor job: what happened (the server's sentence), what may already exist, and the raw text behind Technical details. */
export function EditorJobFailure({ job, title, madeSoFar }: { job: Job; title: string; madeSoFar?: boolean }) {
  return (
    <div className="deploy-failure" role="alert">
      <ProofMark kind="bang" className="deploy-failure__mark" />
      <div>
        <h3 className="deploy-failure__title">{title}</h3>
        <p className="deploy-failure__body">{job.detail}</p>
        {madeSoFar ? <p className="deploy-failure__body">Anything already created is listed on the Online screen, where you can remove it.</p> : null}
        {job.output ? (
          <details className="app-details">
            <summary>Technical details</summary>
            <pre className="app-error__detail deploy-failure__output">{job.output}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
