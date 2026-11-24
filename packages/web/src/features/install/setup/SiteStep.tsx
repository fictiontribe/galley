/**
 * First run, step 2: connect the install's one site — a repository that
 * already holds it, or a starter sent to an empty one — reached with the
 * editor's own key (recommended) or an access token from the code host.
 * Follows the connect job through a reload: the server keeps its state.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { DeployKeyInfo, SetupStatus, SiteAccessCheck } from "@galley/core/install/types";
import type { Job } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { looksLikeRepository } from "@/lib/hosted";
import { useQuery } from "@/lib/query";
import { useSites } from "@/lib/stores/sites";
import { keys } from "@/lib/sync";
import { Badge, Button, ErrorState, Field, Icon, Input, ProofMark, Select, Skeleton, cx } from "@/ui";
import { connectRequest, describeCheck, emptySiteDraft, siteDraftProblem, type SiteDraft } from "../logic";
import { JobProgress, KeySteps, Problem } from "../parts";
import { useFollowJob } from "../transport";
import { StepHead, type StepProps } from "./head";

/** The form, minus the access token, kept for this tab so a reload (or "Check again") still knows it. */
const SAVED = "galley.setup.site";

function loadDraft(status: SetupStatus): SiteDraft {
  // The folder comes with the repository: a site the server already knows in a folder is connected in that folder.
  const fromServer: Partial<SiteDraft> = status.site.repository
    ? { repository: status.site.repository, folder: status.site.folder ?? "", ...(status.site.access !== "none" ? { access: status.site.access } : {}) }
    : {};
  try {
    const raw = sessionStorage.getItem(SAVED);
    const saved = raw ? (JSON.parse(raw) as Partial<SiteDraft>) : {};
    // What the server knows wins over what this tab remembered.
    return { ...emptySiteDraft(), ...saved, ...fromServer };
  } catch {
    return { ...emptySiteDraft(), ...fromServer };
  }
}

function Choice<T extends string>({ name, value, current, title, text, badge, onChange }: { name: string; value: T; current: T; title: string; text: string; badge?: string; onChange: (value: T) => void }) {
  return (
    <label className={cx("deploy-choice", current === value && "deploy-choice--on")}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => onChange(value)} />
      <span className="deploy-choice__body">
        <span className="deploy-choice__title">
          {title}
          {badge ? (
            <Badge tone="accent" mark={null}>
              {badge}
            </Badge>
          ) : null}
        </span>
        <span className="deploy-choice__text">{text}</span>
      </span>
    </label>
  );
}

function useDeployKey(enabled: boolean, known: DeployKeyInfo | null): { key: DeployKeyInfo | null; error: unknown; retry: () => void } {
  const [key, setKey] = useState<DeployKeyInfo | null>(known);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || key) return;
    let current = true;
    setError(null);
    api("POST /api/setup/deploy-key", { body: {} })
      .then((made) => current && setKey(made))
      .catch((caught: unknown) => current && setError(caught));
    return () => {
      current = false;
    };
  }, [enabled, key, attempt]);
  return { key, error, retry: () => setAttempt((n) => n + 1) };
}

function CheckLine({ check, draft }: { check: SiteAccessCheck; draft: SiteDraft }) {
  const said = describeCheck(check, draft.source, draft.access);
  return (
    <p className={`setup__check setup__check--${said.tone}`} role="status">
      {said.tone === "success" ? <Icon name="check" /> : <ProofMark kind="bang" />}
      <span>{said.text}</span>
    </p>
  );
}

/** The connect job, live. When it ends, the server's own status says what's next. */
function Connecting({ job, onEnded }: { job: Job | null; onEnded: () => void }) {
  const live = useFollowJob(job, onEnded);
  useEffect(() => {
    if (live && live.state !== "running") onEnded();
  }, [live?.state]);
  return <JobProgress job={live} title={live?.label ?? "Connecting the site…"} />;
}

export function SiteStep({ status, onStatus, heading }: StepProps) {
  const [draft, setDraft] = useState<SiteDraft>(() => loadDraft(status));
  // Kept apart from the draft: an access token is never written to storage.
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(status.site.state === "none");
  const [check, setCheck] = useState<SiteAccessCheck | null>(null);
  const [busy, setBusy] = useState<"check" | "connect" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const starters = useQuery(keys.starters(), () => api("GET /api/starters"), { enabled: draft.source === "starter" });
  const deployKey = useDeployKey(draft.access === "deploy-key" && (editing || status.site.state === "waiting"), status.site.deployKey);
  const fixed = status.fixed.includes("site");

  useEffect(() => {
    try {
      sessionStorage.setItem(SAVED, JSON.stringify(draft));
    } catch {
      // Not remembered across reloads; the server still knows the repository.
    }
  }, [draft]);

  useEffect(() => {
    const first = starters.data?.[0];
    if (draft.source === "starter" && first && !starters.data?.some((starter) => starter.id === draft.starter)) setDraft((current) => ({ ...current, starter: first.id, look: null }));
  }, [starters.data, draft.source, draft.starter]);

  const update = (patch: Partial<SiteDraft>) => {
    setProblem(null);
    setCheck(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const refresh = async () => {
    try {
      const next = await api("GET /api/setup");
      if (next.site.state === "connected") void useSites.getState().load();
      setEditing(next.site.state === "none");
      onStatus(next);
    } catch (caught) {
      setProblem(errorShape(caught).message);
    }
  };

  const runCheck = async (): Promise<SiteAccessCheck | null> => {
    const issue = siteDraftProblem(draft, token, looksLikeRepository);
    if (issue) {
      setProblem(issue);
      return null;
    }
    setProblem(null);
    const result = await api("POST /api/setup/site/check", { body: connectRequest(draft, token) });
    setCheck(result);
    return result;
  };

  const doCheck = async () => {
    setBusy("check");
    try {
      await runCheck();
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(null);
    }
  };

  const connect = async (event?: FormEvent) => {
    event?.preventDefault();
    const issue = siteDraftProblem(draft, token, looksLikeRepository);
    if (issue) {
      setProblem(issue);
      return;
    }
    setBusy("connect");
    setProblem(null);
    try {
      const job = await api("POST /api/setup/site", { body: connectRequest(draft, token) });
      setToken("");
      setEditing(false);
      onStatus({ ...status, site: { ...status.site, state: "connecting", repository: draft.repository.trim(), access: draft.access, job, problem: null } });
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(null);
    }
  };

  /** Waiting for the key: check, and connect as soon as the repository answers. */
  const checkAgain = async () => {
    setBusy("check");
    try {
      const result = await runCheck();
      if (result && describeCheck(result, draft.source, draft.access).canConnect) {
        setBusy(null);
        await connect();
        return;
      }
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(null);
    }
  };

  const starter = useMemo(() => starters.data?.find((candidate) => candidate.id === draft.starter) ?? null, [starters.data, draft.starter]);

  if (status.site.state === "connecting") {
    return (
      <div className="wizard-form">
        <StepHead heading={heading} title="Connecting the site…" lede={draft.source === "starter" ? "The starter is copied, recorded as the site’s first version and sent to the repository. This can take a minute." : "The site is copied from the repository to this editor. A large site can take a few minutes."} />
        <Connecting job={status.site.job} onEnded={() => void refresh()} />
      </div>
    );
  }

  if (status.site.state === "waiting" && !editing) {
    return (
      <div className="wizard-form">
        <StepHead heading={heading} title="Waiting for the key." lede="The repository hasn’t accepted this editor’s key yet. Add it with write access, then check again — nothing else needs doing here." />
        <p className="install-note">
          Repository: <span className="g-mono">{status.site.repository}</span>
          {status.site.folder ? (
            <>
              {" "}
              · the site is its folder <span className="g-mono">{status.site.folder}</span>
            </>
          ) : null}
        </p>
        {deployKey.key ? <KeySteps info={deployKey.key} repository={status.site.repository ?? draft.repository} /> : deployKey.error ? <ErrorState compact title="Couldn’t show the key" error={deployKey.error} onRetry={deployKey.retry} /> : <Skeleton height={96} />}
        {check ? <CheckLine check={check} draft={draft} /> : null}
        {problem ? <Problem>{problem}</Problem> : null}
        <div className="wizard-actions">
          {fixed ? null : (
            <Button type="button" variant="quiet" onClick={() => setEditing(true)}>
              Change the repository
            </Button>
          )}
          <span className="g-toolbar__spacer" />
          <Button variant="primary" busy={busy !== null} busyLabel={busy === "connect" ? "Connecting…" : "Checking…"} onClick={() => void checkAgain()}>
            Check again
          </Button>
        </div>
      </div>
    );
  }

  if (status.site.state === "failed" && !editing) {
    return (
      <div className="wizard-form">
        <StepHead heading={heading} title="Couldn’t connect the site." lede={status.site.problem ?? "The repository couldn’t be copied to this editor."} />
        {status.site.job?.output ? (
          <details className="app-details">
            <summary>Technical details</summary>
            <pre className="app-error__detail">{status.site.job.output}</pre>
          </details>
        ) : null}
        <p className="install-note">Check the address and how the editor reaches the repository, then try again.</p>
        <div className="wizard-actions">
          <span className="g-toolbar__spacer" />
          <Button variant="primary" onClick={() => setEditing(true)} data-autofocus>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (fixed) {
    return (
      <div className="wizard-form">
        <StepHead heading={heading} title="Connect the site." lede="Whoever runs the server set which repository this editor works on, so it’s connected from there." />
        <p className="install-note">
          Repository: <span className="g-mono">{status.site.repository ?? "not set yet"}</span>
        </p>
        <div className="wizard-actions">
          <span className="g-toolbar__spacer" />
          <Button variant="primary" onClick={() => void refresh()}>
            Check again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="wizard-form" onSubmit={(event) => void connect(event)} noValidate>
      <StepHead heading={heading} title="Connect the site." lede="This editor works on one site, kept in a repository on your code host. Each publish sends a new version there." />
      <fieldset className="deploy-choices">
        <legend className="g-sr">Where the site comes from</legend>
        <Choice name="setup-source" value="existing" current={draft.source} title="A repository that already holds the site" text="The editor copies the site from it and opens it." onChange={(source) => update({ source })} />
        <Choice name="setup-source" value="starter" current={draft.source} title="Start from a starter" text="A complete sample site, sent to an empty repository as its first version." onChange={(source) => update({ source })} />
      </fieldset>

      {draft.source === "starter" ? (
        starters.loading ? (
          <Skeleton height={72} />
        ) : !starters.data ? (
          <ErrorState compact title="Couldn’t list the starters" error={starters.error} onRetry={() => void starters.refetch()} />
        ) : (
          <>
            <fieldset className="app-fieldset wizard-starters">
              <legend className="g-label">Starter</legend>
              {starters.data.map((candidate) => (
                <label key={candidate.id} className={cx("app-model wizard-starter", draft.starter === candidate.id && "app-model--checked")}>
                  <input type="radio" name="setup-starter" className="app-model__radio" checked={draft.starter === candidate.id} onChange={() => update({ starter: candidate.id, look: null })} />
                  <span className="app-model__text">
                    <span className="app-model__name">{candidate.name}</span>
                    <span className="app-model__blurb">{candidate.description}</span>
                  </span>
                  {candidate.previewUrl ? <img className="wizard-starter__image" src={candidate.previewUrl} alt="" /> : <span className="g-tag">{candidate.framework}</span>}
                </label>
              ))}
            </fieldset>
            <div className="app-form-row">
              <Field label="Site name" hint="Optional. Shown in the editor; you can change it later">
                <Input value={draft.name} onChange={(event) => update({ name: event.target.value })} maxLength={100} autoComplete="organization" />
              </Field>
              {starter?.looks && starter.looks.length > 1 ? (
                <Field label="Look">
                  <Select value={draft.look ?? starter.looks[0]?.id ?? ""} onChange={(look) => update({ look })} options={starter.looks.map((look) => ({ value: look.id, label: look.label }))} />
                </Field>
              ) : null}
            </div>
          </>
        )
      ) : null}

      <Field
        label="Repository address"
        hint={draft.source === "starter" ? "An empty repository — make one on your code host first, with nothing in it" : "Copy it from the repository’s page on your code host"}
      >
        <Input mono spellCheck={false} autoComplete="off" value={draft.repository} placeholder="git@github.com:you/site.git" onChange={(event) => update({ repository: event.target.value })} data-autofocus />
      </Field>

      {draft.source === "existing" ? (
        <Field label="Folder inside the repository" hint="Optional. Only when the site isn’t at the top of the repository — for example apps/site">
          <Input mono spellCheck={false} autoComplete="off" value={draft.folder} placeholder="the top of the repository" onChange={(event) => update({ folder: event.target.value })} />
        </Field>
      ) : null}

      <fieldset className="deploy-choices">
        <legend className="g-label">How the editor reaches it</legend>
        <Choice
          name="setup-access"
          value="deploy-key"
          current={draft.access}
          title="This editor’s own key"
          badge="Recommended"
          text="Add a key this editor made to the repository. It opens that one repository and nothing else."
          onChange={(access) => update({ access })}
        />
        <Choice name="setup-access" value="token" current={draft.access} title="An access token from your code host" text="Paste one you made there. It reaches whatever your code host lets it reach." onChange={(access) => update({ access })} />
      </fieldset>

      {draft.access === "deploy-key" ? (
        deployKey.key ? (
          <KeySteps info={deployKey.key} repository={draft.repository} />
        ) : deployKey.error ? (
          <ErrorState compact title="Couldn’t make the editor’s key" error={deployKey.error} onRetry={deployKey.retry} />
        ) : (
          <Skeleton height={96} />
        )
      ) : (
        <Field label="Access token" hint="Made on your code host, with read and write access to this repository. Stored in this editor’s key store on the server — never in the site or its repository — and never shown again.">
          <Input type="password" mono autoComplete="off" spellCheck={false} value={token} onChange={(event) => (setToken(event.target.value), setCheck(null), setProblem(null))} />
        </Field>
      )}

      {check ? <CheckLine check={check} draft={draft} /> : null}
      {problem ? <Problem>{problem}</Problem> : null}
      <div className="wizard-actions">
        <Button type="button" variant="secondary" busy={busy === "check"} busyLabel="Checking…" disabled={busy === "connect"} onClick={() => void doCheck()}>
          Check
        </Button>
        <span className="g-toolbar__spacer" />
        <Button type="submit" variant="primary" busy={busy === "connect"} busyLabel="Connecting…" disabled={busy === "check" || (check !== null && !describeCheck(check, draft.source, draft.access).canConnect)}>
          Connect
        </Button>
      </div>
    </form>
  );
}
