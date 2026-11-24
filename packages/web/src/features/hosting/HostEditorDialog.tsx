/**
 * "Host the editor online" — the guided flow, built like "Put this site
 * online": one question per step, Back and Continue, kept while the dialog is
 * open. Where (the hosts, found out from the server) → Connect (the access
 * keys, and what they can do on the account) → the address and the host's
 * choices → what the new install is handed → the plan, with its cost, read
 * before anything exists → creating, as a job → done.
 *
 * Nothing is created before the review's button; keys are handed over only
 * when each one is ticked; the setup link is asked for at the click that
 * opens it and never shown.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { EditorHostAccount, EditorHostInfo, HostedEditorPlan, HostedEditorStatus } from "@galley/core/hosting/types";
import type { Job, SecretName } from "@galley/core/types";
import { useFollowJob } from "@/features/install/transport";
import { api, errorShape } from "@/lib/api";
import { invalidate, useQuery } from "@/lib/query";
import { useShowingJob } from "@/lib/stores/jobs";
import { useSite } from "@/lib/stores/site";
import { keys } from "@/lib/sync";
import { Badge, Button, Checkbox, Dialog, ErrorState, Field, Icon, Input, ProofMark, Select, Skeleton, Toggle, buttonClass, cx } from "@/ui";
import {
  blockingGaps,
  byHandGaps,
  chosenAccount,
  choiceProblems,
  costPhrase,
  credentialName,
  displayRepository,
  emptyDraft,
  keysReady,
  kindWords,
  nextStep,
  offeredKeys,
  planIsStale,
  planRequest,
  previousStep,
  priceDate,
  reachLines,
  secretOf,
  sleepsWhileUnused,
  stepLabel,
  suggestedAddresses,
  threeNames,
  toggleKey,
  withDefaultOptions,
  type FlowDraft,
  type FlowStep,
} from "./logic";
import { CostBlock, EditorJobFailure, EditorProgress, FilesList, HandoverLines, PlanProblems, ResourceSections, StepsList } from "./parts";
import { openFirstRun, useEditorHosts, useEditorHostingUi } from "./useHosting";

const FORM_ID = "host-editor-form";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="host-section">
      <h3 className="host-section__title">{title}</h3>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────── 1. where

function WhereStep({ hosts, absent, value, onPick }: { hosts: EditorHostInfo[]; absent: Array<{ name: string; reason: string }>; value: string | null; onPick: (id: string) => void }) {
  return (
    <>
      <p className="deploy-setup__lede">Choose where the editor runs. It’s yours: on your own account or computer, with its own password.</p>
      <fieldset className="deploy-choices deploy-choices--list">
        <legend className="g-sr">Where the editor runs</legend>
        {hosts.map((host, index) => (
          <label key={host.id} className={cx("deploy-choice", value === host.id && "deploy-choice--on")}>
            <input type="radio" name="editor-host" value={host.id} checked={value === host.id} onChange={() => onPick(host.id)} data-autofocus={index === 0 ? true : undefined} />
            <span className="deploy-choice__body">
              <span className="deploy-choice__title">{host.name}</span>
              <span className="deploy-choice__text">{host.summary}</span>
              <span className="host-choice__facts">
                <span>{kindWords(host.kind)}</span>
                <span>{`${costPhrase(host.cost).replace(/^./, (first) => first.toUpperCase())} · prices read ${priceDate(host.cost.checked)}`}</span>
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {absent.length > 0 ? (
        <details className="host-absent">
          <summary>{`Why not ${absent.map((entry) => entry.name).join(", ").replace(/, ([^,]*)$/, " or $1")}?`}</summary>
          <ul className="host-absent__list">
            {absent.map((entry) => (
              <li key={entry.name}>
                <strong>{entry.name}</strong> — {entry.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────── 2. connect

function CredentialBlock({
  host,
  index,
  credential,
  value,
  error,
  busy,
  onChange,
  onCheck,
}: {
  host: EditorHostInfo;
  index: number;
  credential: EditorHostInfo["credentials"][number];
  value: string;
  error: string | null;
  busy: boolean;
  onChange: (value: string) => void;
  onCheck: () => void;
}) {
  const secret = secretOf(host, credential.secret);
  const [replacing, setReplacing] = useState(false);
  const stored = secret?.configured && !replacing;
  return (
    <div className="host-credential">
      <p className="host-credential__title">
        {credentialName(credential.label)}
        {!credential.required ? (
          <>
            {" "}
            <Badge tone="neutral" mark={null}>
              Optional
            </Badge>
          </>
        ) : null}
      </p>
      <p className="host-text">{credential.help}</p>
      {stored ? (
        <div className="deploy-key__stored" role="status">
          <Icon name="check" />
          <span>{secret?.source === "env" ? `Using the key this app was started with, ending in ${secret.hint ?? "····"}.` : `A key is saved, ending in ${secret?.hint ?? "····"}.`}</span>
          {secret?.source === "env" ? null : (
            <button type="button" className="app-link-button" onClick={() => setReplacing(true)}>
              Use a different key
            </button>
          )}
        </div>
      ) : (
        <>
          <a className={buttonClass("secondary", "sm")} href={credential.docsUrl} target="_blank" rel="noopener noreferrer" style={{ justifySelf: "start" }}>
            <Icon name="external" />
            Where to make the key
          </a>
          {credential.permissions.length > 0 ? (
            <div className="deploy-key__grants">
              <Icon name="key" />
              <div>
                <span>Give it these permissions, in this order:</span>
                <ol className="deploy-key__steps">
                  {credential.permissions.map((permission) => (
                    <li key={permission}>{permission}</li>
                  ))}
                </ol>
              </div>
            </div>
          ) : null}
          <div className="host-credential__row">
            <Field label={credentialName(credential.label)} hint="Kept on this computer only. Afterwards only its last four characters are shown." error={error ?? undefined}>
              <Input
                type="password"
                mono
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onCheck();
                  }
                }}
                data-autofocus={index === 0 ? true : undefined}
              />
            </Field>
            <Button variant="secondary" onClick={onCheck} busy={busy} busyLabel="Checking…" disabled={!value.trim()}>
              Check
            </Button>
          </div>
          {!credential.required ? <p className="g-hint">You can go on without it. What it would do is then listed as steps to do by hand.</p> : null}
        </>
      )}
    </div>
  );
}

function Gaps({ account }: { account: EditorHostAccount }) {
  const blocking = blockingGaps(account);
  const byHand = byHandGaps(account);
  if (blocking.length === 0 && byHand.length === 0) return null;
  const one = (gap: EditorHostAccount["gaps"][number]) => (
    <p key={gap.what} className={cx("host-gap", gap.blocking && "host-gap--blocking")} role={gap.blocking ? "alert" : undefined}>
      <ProofMark kind={gap.blocking ? "bang" : "stet"} />
      <span>
        <span className="host-gap__what">{gap.what}</span>
        {gap.where}
        {gap.url ? (
          <>
            {" "}
            <a className="g-link" href={gap.url} target="_blank" rel="noopener noreferrer">
              Open the page
            </a>
          </>
        ) : null}
        {gap.blocking ? null : <span className="g-hint"> You’ll do this step by hand.</span>}
      </span>
    </p>
  );
  return (
    <div className="host-gaps">
      {blocking.length > 0 ? <p className="host-confirm-line">This has to be fixed before the editor can be created:</p> : null}
      {blocking.map(one)}
      {byHand.map(one)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── 3. address and choices

function ChoicesStep({ host, account, draft, update, showProblems }: { host: EditorHostInfo; account: EditorHostAccount | null; draft: FlowDraft; update: (patch: Partial<FlowDraft>) => void; showProblems: boolean }) {
  const problems = showProblems ? choiceProblems(draft, account) : {};
  const names = threeNames(draft);
  const suggestions = suggestedAddresses(account).filter((name) => name !== draft.address.trim());
  const accounts = account?.accounts ?? [];
  const regions = account?.regions ?? [];
  const accountId = chosenAccount(draft, account);
  return (
    <>
      <Field label="The editor’s address" hint="Just the name, like cms.example.com." error={problems.address}>
        <Input mono value={draft.address} spellCheck={false} autoComplete="off" placeholder="cms.example.com" onChange={(event) => update({ address: event.target.value })} data-autofocus />
      </Field>
      {suggestions.length > 0 ? (
        <p className="host-suggest">
          <span>On your domains:</span>
          {suggestions.map((name) => (
            <button key={name} type="button" className="g-chip" onClick={() => update({ address: name })}>
              {name}
            </button>
          ))}
        </p>
      ) : null}
      {names ? (
        <dl className="host-names" aria-label="The three names">
          <dt>Editor</dt>
          <dd className="g-mono">{names.editor}</dd>
          <dt>Preview</dt>
          <dd className="g-mono">{names.preview}</dd>
          <dt>Live comparison</dt>
          <dd className="g-mono">{names.live}</dd>
        </dl>
      ) : null}
      <p className="deploy-setup__note">
        <Icon name="globe" />
        <span>The editor uses three names: its own, one for the preview of your changes, and one to compare against the live site. All three must be on a domain that’s yours.</span>
      </p>
      <details className="app-details" open={Boolean(problems.preview || problems.live || draft.previewAddress || draft.liveAddress) || undefined}>
        <summary>Change these names</summary>
        <div className="host-names-edit">
          <Field label="The preview’s name" hint={names ? `Empty: ${names.preview}` : "Empty: made from the editor’s address"} error={problems.preview}>
            <Input mono value={draft.previewAddress} spellCheck={false} autoComplete="off" onChange={(event) => update({ previewAddress: event.target.value })} />
          </Field>
          <Field label="The live comparison’s name" hint={names ? `Empty: ${names.live}` : "Empty: made from the editor’s address"} error={problems.live}>
            <Input mono value={draft.liveAddress} spellCheck={false} autoComplete="off" onChange={(event) => update({ liveAddress: event.target.value })} />
          </Field>
        </div>
      </details>
      <Field label="Short name" hint="Everything created carries it, so you can find it on the host. Lowercase letters, digits and dashes." error={problems.name}>
        <Input mono value={draft.name} maxLength={25} spellCheck={false} autoComplete="off" onChange={(event) => update({ name: event.target.value.toLowerCase().replace(/\s+/g, "-") })} />
      </Field>
      {accounts.length > 1 ? (
        <Field label="Account" hint={`Where on ${host.name} it’s created.`} error={problems.account}>
          <Select value={accountId} onChange={(value) => update({ account: value })} placeholder="Choose an account" options={accounts.map((entry) => ({ value: entry.id, label: entry.name }))} />
        </Field>
      ) : accounts.length === 1 ? (
        <p className="host-text">{`Created in “${accounts[0]!.name}” on ${host.name}.`}</p>
      ) : null}
      {regions.length > 0 ? (
        <Field label="Where it runs" hint="Closest to the people who edit is quickest.">
          <Select value={draft.options.region ?? regions[0]!.id} onChange={(value) => update({ options: { ...draft.options, region: value } })} options={regions.map((region) => ({ value: region.id, label: region.name }))} />
        </Field>
      ) : null}
      {host.options.length > 0 ? (
        <div className="host-options">
          {host.options.map((option) => (
            <fieldset key={option.key} className="deploy-choices deploy-choices--list">
              <legend className="g-label">{option.label}</legend>
              {option.help ? <p className="g-hint" style={{ margin: 0 }}>{option.help}</p> : null}
              {option.choices.map((choice) => (
                <label key={choice.value} className={cx("deploy-choice deploy-choice--row", (draft.options[option.key] ?? option.default) === choice.value && "deploy-choice--on")}>
                  <input type="radio" name={`option-${option.key}`} value={choice.value} checked={(draft.options[option.key] ?? option.default) === choice.value} onChange={() => update({ options: { ...draft.options, [option.key]: choice.value } })} />
                  <span className="deploy-choice__body">
                    <span className="deploy-choice__title">{choice.label}</span>
                    {choice.note ? <span className="deploy-choice__text">{choice.note}</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────── 4. handover

function HandoverStep({ siteId, draft, update }: { siteId: string; draft: FlowDraft; update: (patch: Partial<FlowDraft>) => void }) {
  const detail = useSite((s) => (s.detail?.id === siteId ? s.detail : null));
  const settings = useQuery(keys.settings(), () => api("GET /api/settings"));
  const repository = displayRepository(detail?.remoteUrl);
  const author = settings.data?.author;
  const identity = author?.name?.trim() && author.email?.trim() ? `${author.name} <${author.email}>` : null;
  const live = detail?.model.urls.production ?? null;
  const offered = offeredKeys(settings.data?.secrets);
  const set = (patch: Partial<FlowDraft["handover"]>) => update({ handover: { ...draft.handover, ...patch } });
  const value = (shown: string | null, missing: string) => <p className={cx("host-handover-choice__value", shown && "g-mono")}>{shown ?? missing}</p>;

  return (
    <>
      <p className="deploy-setup__lede">What the new editor gets from this site, so it opens ready to work. Turn off anything it shouldn’t have.</p>
      <div className="host-handover-choice">
        <Toggle checked={draft.handover.repository} onChange={(checked) => set({ repository: checked })} label="The repository’s address" description="The editor makes its own key for it — you’ll add that key to the repository during first run." />
        {draft.handover.repository ? value(repository, "This site has no repository address, so first run asks for one.") : null}
      </div>
      <div className="host-handover-choice">
        <Toggle checked={draft.handover.identity} onChange={(checked) => set({ identity: checked })} label="The publishing name and e-mail" description="Published versions are signed with them." />
        {draft.handover.identity ? value(settings.loading ? "…" : identity, "None is set here, so first run asks for them.") : null}
      </div>
      <div className="host-handover-choice">
        <Toggle checked={draft.handover.liveAddress} onChange={(checked) => set({ liveAddress: checked })} label="The live address" description="So changes can be compared with what visitors see." />
        {draft.handover.liveAddress ? value(live, "This site has no live address yet, so first run asks for it.") : null}
      </div>
      <fieldset className="host-keys">
        <legend>Keys</legend>
        {settings.loading ? (
          <Skeleton lines={2} />
        ) : offered.length === 0 ? (
          <p className="host-text">No keys on this computer that the editor could use.</p>
        ) : (
          <>
            <p className="host-text">Each one is a copy: it stays on this computer too. None is sent unless you tick it.</p>
            {offered.map((key) => (
              <Checkbox
                key={key.name}
                checked={draft.handover.keys.includes(key.name)}
                onChange={(checked) => set({ keys: toggleKey(draft.handover.keys, key.name as SecretName, checked) })}
                label={`${key.label}, ending in ${key.hint}`}
                description={`${key.does} A copy.`}
              />
            ))}
          </>
        )}
      </fieldset>
      <p className="deploy-setup__note">
        <Icon name="key" />
        <span>Nothing else leaves this computer. The editor gets its own password and its own key for the repository — this computer’s aren’t copied.</span>
      </p>
    </>
  );
}

// ─────────────────────────────────────────────────────────────── 5. review

function ReviewStep({ plan, host, account, options, refreshed }: { plan: HostedEditorPlan; host: EditorHostInfo; account: EditorHostAccount | null; options: Record<string, string>; refreshed: boolean }) {
  return (
    <>
      {refreshed ? (
        <p className="deploy-setup__note" role="status">
          <Icon name="refresh" />
          <span>The plan was more than fifteen minutes old, so it was made again. Check it once more.</span>
        </p>
      ) : null}
      {plan.problems.length > 0 ? <PlanProblems problems={plan.problems} /> : null}
      <Section title="The three names">
        <dl className="host-names">
          <dt>Editor</dt>
          <dd className="g-mono">{plan.addresses.editor}</dd>
          <dt>Preview</dt>
          <dd className="g-mono">{plan.addresses.preview}</dd>
          <dt>Live comparison</dt>
          <dd className="g-mono">{plan.addresses.live}</dd>
        </dl>
      </Section>
      {plan.resources.length > 0 ? (
        <ResourceSections resources={plan.resources} host={{ id: plan.host, name: plan.hostName }} known={account ?? undefined} title={(place) => `What will be created on ${place}`} fallback="What will be created elsewhere" />
      ) : (
        <Section title="What will be created">
          <p className="host-text">Nothing is created on an account. You start the editor yourself with the files below.</p>
        </Section>
      )}
      <Section title="What it costs">
        <CostBlock cost={plan.cost} hostName={host.name} sleeps={sleepsWhileUnused(host, options)} />
      </Section>
      <Section title="What it will be handed">
        <HandoverLines lines={plan.handover} />
      </Section>
      {plan.steps.length > 0 ? (
        <Section title={host.kind === "self-run" ? "What you’ll do" : "What you’ll do by hand"}>
          <StepsList steps={plan.steps} />
        </Section>
      ) : null}
      {plan.files.length > 0 ? (
        <Section title="The files">
          <FilesList files={plan.files} />
        </Section>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────── the dialog

interface Failure {
  title: string;
  error: unknown;
}

export function HostEditorDialog({ siteId, status, onStatus }: { siteId: string; status: HostedEditorStatus | undefined; onStatus: () => Promise<HostedEditorStatus | undefined> }) {
  const open = useEditorHostingUi((s) => s.openFor === siteId);
  const close = useEditorHostingUi((s) => s.close);
  const hosts = useEditorHosts(open);
  const [step, setStep] = useState<FlowStep>("where");
  const [draft, setDraft] = useState<FlowDraft>(() => emptyDraft());
  const [account, setAccount] = useState<{ host: string; value: EditorHostAccount } | null>(null);
  const [keyInput, setKeyInput] = useState<Partial<Record<SecretName, string>>>({});
  const [keyError, setKeyError] = useState<Partial<Record<SecretName, string>>>({});
  const [checkingKey, setCheckingKey] = useState<SecretName | null>(null);
  const [plan, setPlan] = useState<{ value: HostedEditorPlan; at: number; refreshed: boolean } | null>(null);
  const [created, setCreated] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [notYet, setNotYet] = useState<string | null>(null);
  const job = useFollowJob(created);
  const body = useRef<HTMLDivElement>(null);
  useShowingJob(created?.id ?? null, open);

  const host = hosts.data?.hosts.find((entry) => entry.id === draft.host) ?? null;
  const accountHere = account && account.host === draft.host ? account.value : null;
  const update = (patch: Partial<FlowDraft>) => {
    setFailure(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  // Fresh each time it opens — unless an editor is being created from it right now.
  useEffect(() => {
    if (!open) return;
    if (created && job?.state === "running") return;
    setStep("where");
    setDraft(emptyDraft(status?.suggestedName ?? ""));
    setAccount(null);
    setKeyInput({});
    setKeyError({});
    setPlan(null);
    setCreated(null);
    setFailure(null);
    setShowProblems(false);
    setNotYet(null);
    void hosts.refetch();
  }, [open]);

  // The first host listed starts selected.
  useEffect(() => {
    if (open && step === "where" && !draft.host && hosts.data?.hosts[0]) setDraft((current) => ({ ...current, host: hosts.data!.hosts[0]!.id }));
  }, [open, step, draft.host, hosts.data]);

  // Each step takes focus at its first control, so keyboard and screen-reader users land in it.
  useEffect(() => {
    if (!open) return;
    const target = body.current?.querySelector<HTMLElement>("[data-autofocus]") ?? body.current;
    target?.focus({ preventScroll: true });
  }, [step, open, Boolean(hosts.data)]);

  /** What the stored keys can do on the account. Creates nothing. */
  const inspect = async (key?: { secret: SecretName; value: string }) => {
    if (!draft.host) return;
    const value = await api("POST /api/editor-hosts/:hostId/connect", { params: { hostId: draft.host }, body: key ? { key: key.value, secret: key.secret } : {} });
    setAccount({ host: draft.host, value });
    setDraft((current) => ({ ...current, options: host ? withDefaultOptions(current.options, host, value) : current.options }));
    return value;
  };

  // Arriving at Connect with every needed key stored: look at the account straight away.
  useEffect(() => {
    if (!open || step !== "connect" || !host || accountHere || !keysReady(host)) return;
    setBusy(true);
    inspect()
      .catch((caught: unknown) => setFailure({ title: `Couldn’t check the ${host.name} account`, error: caught }))
      .finally(() => setBusy(false));
  }, [open, step, host?.id, Boolean(accountHere), host && keysReady(host)]);

  const checkKey = async (secret: SecretName) => {
    const value = keyInput[secret]?.trim();
    if (!value || !host) return;
    setCheckingKey(secret);
    setKeyError((current) => ({ ...current, [secret]: undefined }));
    setFailure(null);
    try {
      await inspect({ secret, value });
      setKeyInput((current) => ({ ...current, [secret]: "" }));
      await hosts.refetch();
      invalidate(keys.settings());
    } catch (caught) {
      // Under the field; a key saved before stays in use (the message says so).
      setKeyError((current) => ({ ...current, [secret]: errorShape(caught).message }));
    } finally {
      setCheckingKey(null);
    }
  };

  const makePlan = async (refreshed = false) => {
    setBusy(true);
    setFailure(null);
    try {
      const value = await api("POST /api/sites/:siteId/editor/plan", { params: { siteId }, body: planRequest(draft, accountHere) });
      setPlan({ value, at: Date.now(), refreshed });
      return value;
    } catch (caught) {
      setFailure({ title: "Couldn’t make the plan", error: caught });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!plan || plan.value.problems.length > 0) return;
    // A plan is good for fifteen minutes: an older one is made again and read again.
    if (planIsStale(plan.at)) {
      await makePlan(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const started = await api("POST /api/sites/:siteId/editor", { params: { siteId }, body: { plan: plan.value.id, confirm: true } });
      setCreated(started);
      setStep("creating");
    } catch (caught) {
      setFailure({ title: "Couldn’t start creating the editor", error: caught });
    } finally {
      setBusy(false);
    }
  };

  // The job finishing moves the flow on: files and steps still to run, or done.
  useEffect(() => {
    if (step !== "creating" || !job || job.state === "running") return;
    if (job.state === "error") {
      setStep("failed");
      invalidate(keys.editor(siteId));
      return;
    }
    void onStatus().then((next) => setStep(next?.pending ? "pending" : "done"));
  }, [job?.state, step]);

  const check = async () => {
    setBusy(true);
    setFailure(null);
    setNotYet(null);
    try {
      const next = await api("POST /api/sites/:siteId/editor/check", { params: { siteId } });
      invalidate(keys.editor(siteId));
      if (!next.pending && next.record?.handedOver) setStep("done");
      else setNotYet(`${next.record?.addresses.editor ?? "The editor"} isn’t answering yet. Check the steps, give it a minute, then check again.`);
    } catch (caught) {
      setFailure({ title: "Couldn’t check the editor", error: caught });
    } finally {
      setBusy(false);
    }
  };

  const next = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !host) return;
    setFailure(null);
    if (step === "where") {
      if (host.credentials.length > 0) {
        setStep("connect");
        return;
      }
      // No key to connect: still ask what the host offers (it creates nothing).
      setBusy(true);
      try {
        if (!accountHere) await inspect();
        setStep("choices");
      } catch (caught) {
        setFailure({ title: `Couldn’t ask ${host.name} what it offers`, error: caught });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === "connect") {
      if (!accountHere || blockingGaps(accountHere).length > 0) return;
      setStep("choices");
      return;
    }
    if (step === "choices") {
      setShowProblems(true);
      if (Object.keys(choiceProblems(draft, accountHere)).length > 0) return;
      setDraft((current) => ({ ...current, account: chosenAccount(current, accountHere) }));
      setStep("handover");
      return;
    }
    if (step === "handover") {
      setPlan(null);
      setStep("review");
      await makePlan();
      return;
    }
    if (step === "review") await create();
  };

  const back = () => {
    setFailure(null);
    setStep(previousStep(step, host));
  };

  const hostName = host?.name ?? "the host";
  const managed = host?.kind === "managed";
  const pending = status?.pending ?? (plan ? { steps: plan.value.steps, files: plan.value.files } : null);
  const address = plan?.value.addresses.editor ?? status?.record?.addresses.editor ?? null;
  const titles: Record<FlowStep, string> = {
    where: "Host the editor online",
    connect: `Connect ${hostName}`,
    choices: "Its address and choices",
    handover: "What it will be handed",
    review: "Check the plan",
    creating: managed ? "Putting the editor online…" : "Getting it ready…",
    pending: managed ? "A few steps by hand" : "Start it on your computer",
    done: "The editor is online",
    failed: "Couldn’t put the editor online",
  };

  let content: ReactNode;
  if (!hosts.data) {
    content = hosts.status === "error" ? <ErrorState compact title="Couldn’t load the places the editor can run" error={hosts.error} onRetry={() => void hosts.refetch()} /> : <Skeleton lines={5} />;
  } else if (step === "where") {
    content = <WhereStep hosts={hosts.data.hosts} absent={hosts.data.absent} value={draft.host} onPick={(id) => update({ host: id })} />;
  } else if (!host) {
    content = <ErrorState compact title="That host isn’t offered any more" message="Go back and choose another." />;
  } else if (step === "connect") {
    content = (
      <>
        <p className="deploy-setup__lede">{`${host.name} needs an access key so this app can see what your account can do — and, once you say yes, create the editor there.`}</p>
        {host.credentials.map((credential, index) => (
          <CredentialBlock
            key={credential.secret}
            host={host}
            index={index}
            credential={credential}
            value={keyInput[credential.secret] ?? ""}
            error={keyError[credential.secret] ?? null}
            busy={checkingKey === credential.secret}
            onChange={(value) => setKeyInput((current) => ({ ...current, [credential.secret]: value }))}
            onCheck={() => void checkKey(credential.secret)}
          />
        ))}
        {!keysReady(host) ? null : !accountHere ? (
          busy ? (
            <p className="host-text" role="status">{`Checking what the key can do on ${host.name}…`}</p>
          ) : null
        ) : (
          <>
            {blockingGaps(accountHere).length === 0 ? (
              <p className="deploy-key__stored" role="status">
                <Icon name="check" />
                <span>{`The key can create the editor on ${host.name}.`}</span>
              </p>
            ) : null}
            {reachLines(host, accountHere).length > 0 ? (
              <ul className="host-reach" aria-label="What the keys can reach">
                {reachLines(host, accountHere).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            <Gaps account={accountHere} />
          </>
        )}
      </>
    );
  } else if (step === "choices") {
    content = <ChoicesStep host={host} account={accountHere} draft={draft} update={update} showProblems={showProblems} />;
  } else if (step === "handover") {
    content = <HandoverStep siteId={siteId} draft={draft} update={update} />;
  } else if (step === "review") {
    content = plan ? <ReviewStep plan={plan.value} host={host} account={accountHere} options={draft.options} refreshed={plan.refreshed} /> : busy ? <Skeleton lines={8} /> : null;
  } else if (step === "creating") {
    content = (
      <>
        <EditorProgress job={job} managed={managed} />
        <p className="host-text">You can close this. It keeps going, and the Online screen shows how it’s getting on.</p>
      </>
    );
  } else if (step === "pending") {
    content = (
      <>
        <p className="deploy-setup__lede">{managed ? `It’s created on ${host.name}. A few things are left for you to do.` : "Everything is ready. Start the editor on your computer with these files and steps."}</p>
        {pending?.steps.length ? <StepsList steps={pending.steps} /> : null}
        {pending?.files.length ? <FilesList files={pending.files} /> : null}
        {notYet ? (
          <p className="host-gap" role="status">
            <ProofMark kind="stet" />
            <span>{notYet}</span>
          </p>
        ) : null}
      </>
    );
  } else if (step === "done") {
    content = (
      <div className="deploy-done">
        {address ? (
          <div className="deploy-address">
            <p className="g-eyebrow">The editor’s address</p>
            <a className={cx("deploy-address__link", address.length > 30 && "deploy-address__link--long")} href={`https://${address}`} target="_blank" rel="noopener noreferrer">
              {address}
            </a>
          </div>
        ) : null}
        <p className="host-text">Open first run to choose its password and connect the repository with the editor’s own key. The link works once.</p>
        <p className="deploy-setup__note">
          <Icon name="check" />
          <span>The site’s settings now note the editor’s address. That change shows in Proof, to publish like any other.</span>
        </p>
      </div>
    );
  } else if (step === "failed" && job?.state === "error") {
    content = <EditorJobFailure job={job} title="Couldn’t put the editor online" madeSoFar />;
  }

  const label = stepLabel(step, host);
  const footer =
    step === "done" ? (
      <>
        <Button variant="secondary" onClick={close}>
          Done
        </Button>
        {status?.record?.setup !== "done" ? (
          <Button variant="primary" icon="external" onClick={() => openFirstRun(siteId)} data-autofocus>
            Open first run
          </Button>
        ) : null}
      </>
    ) : step === "creating" ? (
      <Button variant="secondary" onClick={close}>
        Keep going in the background
      </Button>
    ) : step === "pending" ? (
      <>
        <Button variant="secondary" onClick={close}>
          Later
        </Button>
        <Button variant="primary" busy={busy} busyLabel="Checking…" onClick={() => void check()}>
          {managed ? "I’ve done these — check" : "I’ve started it — check"}
        </Button>
      </>
    ) : step === "failed" ? (
      <Button variant="primary" onClick={close}>
        Close
      </Button>
    ) : (
      <>
        {step === "where" ? (
          <Button variant="secondary" onClick={close}>
            Not now
          </Button>
        ) : (
          <Button variant="secondary" onClick={back} disabled={busy}>
            Back
          </Button>
        )}
        <Button
          variant="primary"
          type="submit"
          form={FORM_ID}
          busy={busy && step !== "connect"}
          busyLabel={step === "review" ? (plan ? "Starting…" : "Making the plan…") : "Checking…"}
          disabled={
            !hosts.data ||
            !host ||
            (step === "connect" && (!accountHere || blockingGaps(accountHere).length > 0 || !keysReady(host))) ||
            (step === "review" && (!plan || plan.value.problems.length > 0))
          }
        >
          {step === "review" ? (host?.kind === "self-run" ? "Get the files" : "Create the editor") : step === "handover" ? "See the plan" : "Continue"}
        </Button>
      </>
    );

  return (
    <Dialog open={open} onClose={close} title={titles[step]} size="lg" footer={footer} dismissible={!busy}>
      <form id={FORM_ID} className="deploy-setup" onSubmit={(event) => void next(event)} noValidate>
        {label ? <p className="g-eyebrow deploy-setup__eyebrow">{label}</p> : null}
        <div ref={body} className="host-flow" tabIndex={-1}>
          {content}
          {failure ? <ErrorState compact title={failure.title} error={failure.error} onRetry={step === "review" ? () => void makePlan() : undefined} retryLabel="Make the plan again" /> : null}
          {step === "review" && plan && plan.value.problems.length === 0 ? <p className="host-confirm-line">Nothing has been created yet.</p> : null}
        </div>
      </form>
    </Dialog>
  );
}
