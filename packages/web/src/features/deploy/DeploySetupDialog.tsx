/**
 * "Put this site online" — the guided setup: choose a host, connect it with
 * an access key (made on the host with the fewest permissions, by numbered
 * steps from its own docs), pick the account, name the project, and go. Then
 * the live progress in plain words, and the address.
 *
 * Mounted once per site frame (by the status bar item); every entry point
 * opens it with `useDeployUi.getState().openSetup()`.
 */
import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import type { DeployProjectCheck, DeployTargetInfo, FileChange } from "@galley/core/types";
import { api, errorShape, isApiFailure } from "@/lib/api";
import { invalidate, setQueryData } from "@/lib/query";
import { useChanges } from "@/lib/stores/changes";
import { useJob, useShowingJob } from "@/lib/stores/jobs";
import { useSite } from "@/lib/stores/site";
import { publishOutcome, type PublishOutcome } from "@/features/proof/publishOutcome";
import { keys } from "@/lib/sync";
import { usePlaceWords } from "@/lib/where";
import { Badge, Button, Dialog, ErrorState, Field, Icon, Input, ProofMark, Skeleton, Toggle, buttonClass, cx } from "@/ui";
import { canContinue, failureFor, initialSetup, onlineSettingsWaiting, setupReducer, targetName, type Failure, type SetupState } from "./logic";
import { AddressBlock, DeployProgress, JobFailure } from "./parts";
import { applyLiveAddress, deployKeys, setAutoDeploy, startDeploy, useDeployStatus, useDeployTargets, useDeployUi } from "./useDeploy";
import "./deploy.css";
import { plural } from "@/lib/format";

const STEP_NUMBER: Partial<Record<SetupState["step"], number>> = { host: 1, key: 2, account: 3, name: 4 };

function StepEyebrow({ step }: { step: SetupState["step"] }) {
  const number = STEP_NUMBER[step];
  return number ? <p className="g-eyebrow deploy-setup__eyebrow">{`Step ${number} of 4`}</p> : null;
}

function HostChoice({ targets, value, onChange }: { targets: DeployTargetInfo[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <fieldset className="deploy-choices">
      <legend className="g-sr">Where the site lives</legend>
      {targets.map((target) => (
        <label key={target.id} className={cx("deploy-choice", value === target.id && "deploy-choice--on")}>
          <input type="radio" name="deploy-host" value={target.id} checked={value === target.id} onChange={() => onChange(target.id)} />
          <span className="deploy-choice__body">
            <span className="deploy-choice__title">
              {target.name}
              {target.recommended ? <Badge tone="accent" mark={null}>Recommended</Badge> : null}
            </span>
            <span className="deploy-choice__text">{target.blurb}</span>
            <a className="g-link deploy-choice__link" href={target.pricingUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
              {target.name}’s prices
            </a>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function KeyStep({ target, value, onChange, error }: { target: DeployTargetInfo; value: string; onChange: (value: string) => void; error: string | null }) {
  const secret = target.secrets[0];
  const where = usePlaceWords();
  const [replacing, setReplacing] = useState(false);
  const stored = secret?.configured && !replacing;
  return (
    <div className="deploy-key">
      <p className="deploy-setup__lede">{target.name} needs an access key so this app can upload the site for you. Make one on {target.name}:</p>
      <ol className="deploy-key__steps">
        {target.keySteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <a className={buttonClass("secondary", "sm")} href={target.keyUrl} target="_blank" rel="noopener noreferrer">
        <Icon name="external" />
        Open {target.name}’s page
      </a>
      {target.keyStepsByHand?.length ? (
        <details className="app-details deploy-key__by-hand">
          <summary>Do it by hand</summary>
          <ol className="deploy-key__steps">
            {target.keyStepsByHand.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {target.keyUrlByHand ? (
            <a className="g-link" href={target.keyUrlByHand} target="_blank" rel="noopener noreferrer">
              {target.name}’s API Tokens page
            </a>
          ) : null}
        </details>
      ) : null}
      <p className="deploy-key__grants">
        <Icon name="key" />
        <span>{target.keyGrants}</span>
      </p>
      {stored ? (
        <div className="deploy-key__stored" role="status">
          <Icon name="check" />
          <span>
            {secret?.source === "env"
              ? `Using the key this app was started with, ending in ${secret.hint ?? "····"}.`
              : `A key is saved, ending in ${secret?.hint ?? "····"}.`}
          </span>
          {secret?.source === "env" ? null : (
            <button type="button" className="app-link-button" onClick={() => setReplacing(true)}>
              Use a different key
            </button>
          )}
        </div>
      ) : (
        <Field label="Access key" hint={`Kept ${where.keyStore}. Afterwards only its last four characters are shown.`} error={error ?? undefined}>
          <Input type="password" mono autoComplete="off" spellCheck={false} value={value} placeholder={`Paste the ${target.name} key`} onChange={(event) => onChange(event.target.value)} data-autofocus />
        </Field>
      )}
    </div>
  );
}

function AccountStep({ target, state, onPick }: { target: DeployTargetInfo; state: SetupState; onPick: (id: string) => void }) {
  if (!state.accounts) return <Skeleton lines={3} />;
  if (state.accounts.length === 0) {
    return (
      <Field label={`${target.accountNoun === "team" ? "Team" : "Account"} ID`} hint={`The key can’t list your ${plural(target.accountNoun)}, so type the ID. ${target.accountHelp}`}>
        <Input mono value={state.account ?? ""} onChange={(event) => onPick(event.target.value)} data-autofocus />
      </Field>
    );
  }
  return (
    <fieldset className="deploy-choices deploy-choices--list">
      <legend className="deploy-setup__lede">Which {target.accountNoun} should the site live in?</legend>
      {state.accounts.map((account) => (
        <label key={account.id} className={cx("deploy-choice deploy-choice--row", state.account === account.id && "deploy-choice--on")}>
          <input type="radio" name="deploy-account" value={account.id} checked={state.account === account.id} onChange={() => onPick(account.id)} />
          <span className="deploy-choice__title">{account.name}</span>
          <span className="deploy-choice__id g-mono">{account.id}</span>
        </label>
      ))}
      {state.accounts.length > 1 && target.narrowKey ? <KeyReachNote target={target} count={state.accounts.length} narrow={target.narrowKey} /> : null}
    </fieldset>
  );
}

/**
 * A key that reaches more than one account works, but covers more than this
 * job needs (the pre-filled page starts with every account): say so once,
 * quietly, and where to limit it — never a stop.
 */
function KeyReachNote({ target, count, narrow }: { target: DeployTargetInfo; count: number; narrow: { text: string; url: string } }) {
  return (
    <div className="deploy-key__reach" role="note">
      <ProofMark kind="stet" />
      <span>
        {`This key can reach ${count} ${plural(target.accountNoun)}. You can limit it to one on ${target.name} — `}
        <a className="g-link" href={narrow.url} target="_blank" rel="noopener noreferrer">
          here’s where
        </a>
        . <span className="g-hint">{narrow.text}</span>
      </span>
    </div>
  );
}

function checkHint(check: DeployProjectCheck | null, checking: boolean, target: string): { hint?: string; error?: string } {
  if (checking || !check) return { hint: "Lowercase letters, digits and dashes." };
  if (!check.available) return { error: check.message ?? "That name can’t be used." };
  if (check.existing) return { hint: check.message };
  return { hint: check.productionUrl ? `It’s free. The address will be ${check.productionUrl.replace(/^https:\/\//, "")}.` : `It’s free. ${target} gives the address after the first upload.` };
}

function NameStep({ state, check, checking, target, onChange }: { state: SetupState; check: DeployProjectCheck | null; checking: boolean; target: string; onChange: (value: string) => void }) {
  const { hint, error } = checkHint(check, checking, target);
  return (
    <div className="deploy-name">
      <Field label="Project name" hint={hint} error={error}>
        <Input mono value={state.project} maxLength={54} onChange={(event) => onChange(event.target.value.toLowerCase().replace(/\s+/g, "-"))} data-autofocus aria-busy={checking || undefined} />
      </Field>
      <p className="deploy-setup__note">
        <Icon name="globe" />
        <span>
          {state.intent === "preview"
            ? "The preview shows the site exactly as it is here, unpublished changes included, at an address of its own."
            : "What’s live is what you’ve published. Changes waiting in Proof stay here until you publish them."}
        </span>
      </p>
    </div>
  );
}

/** At the end of setting up: the online settings are a change in Proof, with a way to publish just them. */
function SettingsWaiting({ siteId }: { siteId: string }) {
  const files = useChanges((s) => s.changes?.files) ?? NO_CHANGES;
  const mode = useSite((s) => s.detail?.model.publish?.mode) === "pull-request" ? "pull-request" : "commit";
  const waiting = onlineSettingsWaiting(files);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);

  // Settings changed again after publishing (the live address, auto-publish): the offer comes back.
  if (!waiting && outcome && outcome.tone !== "danger") {
    return (
      <p className="deploy-setup__note" role="status">
        {outcome.tone === "success" ? <Icon name="check" /> : <ProofMark kind="bang" />}
        <span>
          {outcome.title}. {outcome.body}
        </span>
      </p>
    );
  }
  if (!waiting) return null;
  const publish = async () => {
    setBusy(true);
    try {
      const result = await api("POST /api/sites/:siteId/publish", { params: { siteId }, body: { message: waiting.message, paths: [waiting.path] } });
      setOutcome(publishOutcome(result, { message: waiting.message, mode }));
      invalidate(["site", siteId, "history"]);
      invalidate(["site", siteId, "git"]);
      void useChanges.getState().refresh();
    } catch (caught) {
      const shape = errorShape(caught);
      setOutcome({ kind: "failed", tone: "danger", title: "Couldn’t publish the settings", body: `${shape.message} They are still waiting in Proof.`, canRetry: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="deploy-offer" role="status">
      <div>
        <p className="deploy-offer__title">{waiting.title}</p>
        <p className="deploy-offer__text">{outcome && outcome.tone !== "success" ? outcome.body : waiting.body}</p>
      </div>
      <Button variant="secondary" size="sm" busy={busy} busyLabel="Publishing…" onClick={() => void publish()}>
        {waiting.button}
      </Button>
    </div>
  );
}

const NO_CHANGES: FileChange[] = [];

export function DeploySetupDialog({ siteId }: { siteId: string }) {
  const { open, intent } = useDeployUi((s) => s.setup);
  const close = useDeployUi((s) => s.closeSetup);
  const status = useDeployStatus(siteId);
  const targets = useDeployTargets();
  const [state, dispatch] = useReducer(setupReducer, undefined, () => initialSetup(null));
  const [keyValue, setKeyValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [check, setCheck] = useState<DeployProjectCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [addressUsed, setAddressUsed] = useState(false);
  const [autoDeploy, setAutoDeployShown] = useState<boolean | null>(null);
  const job = useJob(state.jobId);
  const target = targets.data?.find((candidate) => candidate.id === state.target) ?? null;
  const host = targetName(targets.data, state.target);
  const primary = useRef<HTMLButtonElement>(null);

  useShowingJob(state.jobId, open);

  // Fresh each time it opens, from what the site already has.
  useEffect(() => {
    if (!open) return;
    dispatch({ type: "reset", state: initialSetup(status.data, intent) });
    setError(null);
    setKeyError(null);
    setKeyValue("");
    setCheck(null);
    setAddressUsed(false);
    setAutoDeployShown(null);
    void targets.refetch();
  }, [open]);

  const effectiveIntent = state.intent;

  // The recommended host starts selected; one click less for most people.
  useEffect(() => {
    if (open && state.step === "host" && !state.target && targets.data) {
      const recommended = targets.data.find((candidate) => candidate.recommended) ?? targets.data[0];
      if (recommended) dispatch({ type: "pick-host", target: recommended.id });
    }
  }, [open, state.step, state.target, targets.data]);

  // The job finishing moves the setup on.
  useEffect(() => {
    if (job && state.step === "working" && job.state !== "running") dispatch({ type: "finished", job });
  }, [job?.state, state.step]);

  // The name is checked with the host as it's typed.
  useEffect(() => {
    if (state.step !== "name" || !state.target || !state.account || !state.project) return;
    setChecking(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api("POST /api/sites/:siteId/deploy/check", { params: { siteId }, body: { target: state.target!, account: state.account!, project: state.project }, signal: controller.signal })
        .then((result) => {
          setCheck(result);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setCheck(null);
          setError(failureFor(isApiFailure(caught) ? caught : errorShape(caught), host));
        })
        .finally(() => setChecking(false));
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.step, state.target, state.account, state.project]);

  /** With `key`: the host checks it first, and only a key it accepts is saved. */
  const loadAccounts = async (key?: string) => {
    const { accounts } = await api("POST /api/deploy/targets/:targetId/connect", { params: { targetId: state.target! }, body: key ? { key } : {} });
    dispatch({ type: "accounts", accounts });
    dispatch({ type: "key-saved" });
  };

  const fail = (caught: unknown) => {
    const failure = failureFor(isApiFailure(caught) ? caught : errorShape(caught), host);
    if (failure.back && failure.back !== state.step) dispatch({ type: "go", step: failure.back });
    setError(failure);
  };

  const next = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canContinue(state, check) || busy) return;
    setError(null);
    setBusy(true);
    try {
      if (state.step === "host") {
        dispatch({ type: "host", target: state.target!, keyStored: Boolean(target?.secrets[0]?.configured), skipKey: Boolean(target && target.credentials.length === 0) });
      } else if (state.step === "key") {
        if (keyValue.trim()) {
          try {
            await loadAccounts(keyValue.trim());
          } catch (caught) {
            // Shown under the field; a key that was saved before stays in use (the message says so).
            setKeyError(errorShape(caught).message);
            return;
          }
          setKeyValue("");
          setKeyError(null);
          void targets.refetch();
          invalidate(keys.settings());
        } else if (!target?.secrets[0]?.configured) {
          setKeyError(`Paste the ${host} access key to continue.`);
          return;
        } else {
          await loadAccounts();
        }
      } else if (state.step === "account") {
        dispatch({ type: "account", account: state.account ?? "" });
      } else if (state.step === "name") {
        setQueryData(deployKeys.status(siteId), await api("PUT /api/sites/:siteId/deploy", { params: { siteId }, body: { target: state.target!, account: state.account!, project: state.project } }));
        const started = await startDeploy(siteId, effectiveIntent);
        dispatch({ type: "started", jobId: started.id });
      }
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  // Going to the account step from elsewhere (a failure, Back) needs the list.
  useEffect(() => {
    if (open && state.step === "account" && !state.accounts && state.target) void loadAccounts().catch(fail);
  }, [open, state.step, state.target]);

  const working = state.step === "working";
  const done = state.step === "done";
  const preview = effectiveIntent === "preview";
  const title = done ? (preview ? "The preview is ready" : "The site is online") : working ? (preview ? "Making a preview link…" : "Putting the site online…") : state.step === "failed" ? (job ? (preview ? "Couldn’t make the preview link" : "Couldn’t put the site online") : "Couldn’t finish") : state.step === "host" ? "Put this site online" : state.step === "key" ? `Connect ${host}` : state.step === "account" ? `Choose the ${target?.accountNoun ?? "account"}` : "Name it";

  const config = status.data?.config;

  let body;
  if (!targets.data) {
    body = targets.status === "error" ? <ErrorState compact title="Couldn’t load the hosts" error={targets.error} onRetry={() => void targets.refetch()} /> : <Skeleton lines={4} />;
  } else if (state.step === "host") {
    body = (
      <>
        <p className="deploy-setup__lede">Choose where it lives. Both serve it fast, worldwide, and you can move it later.</p>
        <HostChoice targets={targets.data} value={state.target} onChange={(id) => dispatch({ type: "pick-host", target: id })} />
      </>
    );
  } else if (state.step === "key" && target) {
    body = <KeyStep target={target} value={keyValue} onChange={setKeyValue} error={keyError} />;
  } else if (state.step === "account" && target) {
    body = <AccountStep target={target} state={state} onPick={(id) => dispatch({ type: "pick-account", account: id })} />;
  } else if (state.step === "name") {
    body = <NameStep state={state} check={check} checking={checking} target={host} onChange={(value) => dispatch({ type: "project", project: value })} />;
  } else if (working) {
    body = <DeployProgress job={job} intent={effectiveIntent} />;
  } else if (done && job?.url) {
    body = (
      <div className="deploy-done">
        <AddressBlock url={job.url} caption={preview ? "Preview link" : "Live at"} />
        {preview ? (
          <p className="deploy-setup__note">
            <Icon name="eye" />
            <span>This link shows your unpublished changes — send it to whoever should check them. {target?.previewNote}</span>
          </p>
        ) : (
          <>
            {!status.data?.liveAddressSet && !addressUsed ? (
              <div className="deploy-offer">
                <div>
                  <p className="deploy-offer__title">Compare against the live site?</p>
                  <p className="deploy-offer__text">Proof can show your changes beside what visitors see now. Use this address for that.</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void applyLiveAddress(siteId).then(
                      () => setAddressUsed(true),
                      (caught: unknown) => setError(failureFor(errorShape(caught), host))
                    )
                  }
                >
                  Use this address
                </Button>
              </div>
            ) : (
              <p className="deploy-setup__note" role="status">
                <Icon name="check" />
                <span>Proof compares your changes against this address.</span>
              </p>
            )}
            <Button
              variant="quiet"
              size="sm"
              icon="globe"
              onClick={() => {
                close();
                useDeployUi.getState().setDomain(true);
              }}
            >
              Use your own domain…
            </Button>
            <Toggle
              checked={autoDeploy ?? Boolean(config?.autoDeploy)}
              onChange={(checked) => {
                // Shown at once; put back if saving it fails.
                setAutoDeployShown(checked);
                void setAutoDeploy(siteId, checked).catch((caught: unknown) => {
                  setAutoDeployShown(null);
                  setError(failureFor(errorShape(caught), host));
                });
              }}
              label="Put changes live every time I publish"
              description="Each publish puts the new version online by itself. Off: you choose when, with Put live."
            />
          </>
        )}
        <SettingsWaiting siteId={siteId} />
      </div>
    );
  } else if (state.step === "failed") {
    body = job?.state === "error" ? <JobFailure job={job} /> : null;
  }

  const backLabel = state.step === "failed" && state.retryStep === "key" ? "Check the access key" : state.step === "failed" && state.retryStep === "name" ? "Change the name" : state.step === "failed" && state.retryStep === "account" ? `Choose the ${target?.accountNoun ?? "account"}` : "Back";
  const footer = done ? (
    <Button ref={primary} variant="primary" onClick={close} data-autofocus>
      Done
    </Button>
  ) : working ? (
    <Button variant="secondary" onClick={close}>
      Keep going in the background
    </Button>
  ) : state.step === "failed" ? (
    <>
      <Button variant="secondary" onClick={close}>
        Close
      </Button>
      {state.retryStep ? (
        <Button variant="secondary" onClick={() => dispatch({ type: "back" })}>
          {backLabel}
        </Button>
      ) : null}
      <Button
        variant="primary"
        busy={busy}
        busyLabel="Starting…"
        onClick={() => {
          setBusy(true);
          void startDeploy(siteId, effectiveIntent)
            .then((started) => dispatch({ type: "started", jobId: started.id }), fail)
            .finally(() => setBusy(false));
        }}
      >
        Try again
      </Button>
    </>
  ) : (
    <>
      {state.step !== "host" ? (
        <Button variant="secondary" onClick={() => dispatch({ type: "back" })} disabled={busy}>
          Back
        </Button>
      ) : (
        <Button variant="secondary" onClick={close}>
          Not now
        </Button>
      )}
      <Button ref={primary} variant="primary" type="submit" form="deploy-setup-form" busy={busy} busyLabel={state.step === "name" ? "Starting…" : "Checking…"} disabled={!canContinue(state, check) || (state.step === "name" && checking)}>
        {state.step === "name" ? (preview ? "Make preview link" : "Put it online") : state.step === "key" ? "Connect" : "Continue"}
      </Button>
    </>
  );

  return (
    <Dialog open={open} onClose={close} title={title} size="lg" footer={footer} dismissible={!busy}>
      <form id="deploy-setup-form" className="deploy-setup" onSubmit={(event) => void next(event)} noValidate>
        <StepEyebrow step={state.step} />
        {body}
        {error ? <ErrorState compact title={error.title} message={error.body} /> : null}
      </form>
    </Dialog>
  );
}
