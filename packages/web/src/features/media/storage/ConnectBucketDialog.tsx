/**
 * "Keep media in a bucket" — choose Cloudflare R2 or Amazon S3, do the
 * numbered steps on the provider's side (their own button names, the
 * policies filled in with this bucket's name), paste the values, and Galley
 * checks for real before anything is saved: it stores a tiny test picture,
 * reads it back, lists, loads it from the public address and removes it.
 * A failed step says what to change and puts the cursor in that field.
 *
 * Connected, the same dialog shows where files go, checks again, changes the
 * settings, or stops using the bucket (the files stay; pages keep working).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { MediaCheckResult, MediaStoreField, MediaStoreFieldId, MediaStoreInfo, MediaStorageStatus } from "@galley/core/media-storage/contract";
import { keyPolicy, publicPolicy } from "@galley/core/media-storage/info";
import type { MediaStorageConfig } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { invalidate } from "@/lib/query";
import { keys } from "@/lib/sync";
import { notify } from "@/lib/stores/toasts";
import { usePlaceWords } from "@/lib/where";
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, ErrorState, Field, Icon, Input, ProofMark, Skeleton, Spinner, buttonClass, cx } from "@/ui";
import { copyText } from "@/features/deploy/parts";
import "@/features/deploy/deploy.css";
import { useConnectors, useMediaStorage } from "./useMediaStorage";

type Values = Record<MediaStoreFieldId, string>;
const EMPTY: Values = { account: "", bucket: "", region: "", endpoint: "", prefix: "", publicUrl: "", accessKeyId: "", secretAccessKey: "" };

function valuesOf(config: MediaStorageConfig | null): Values {
  if (!config) return { ...EMPTY };
  return {
    account: config.account ?? "",
    bucket: config.bucket,
    region: config.region ?? "",
    endpoint: config.endpoint ?? "",
    prefix: (config.prefix ?? "").replace(/\/$/, ""),
    publicUrl: config.publicUrl,
    accessKeyId: "",
    secretAccessKey: "",
  };
}

function configOf(connector: string, values: Values): MediaStorageConfig {
  const config: MediaStorageConfig = { connector, bucket: values.bucket.trim(), publicUrl: values.publicUrl.trim() };
  if (values.account.trim()) config.account = values.account.trim();
  if (values.region.trim()) config.region = values.region.trim();
  if (values.endpoint.trim()) config.endpoint = values.endpoint.trim();
  if (values.prefix.trim()) config.prefix = values.prefix.trim();
  return config;
}

/** The provider's side: numbered steps, each with its link and, for S3, the policy to paste. */
function ProviderSteps({ info, values }: { info: MediaStoreInfo; values: Values }) {
  const target = { bucket: values.bucket.trim() || "YOUR-BUCKET", prefix: values.prefix.trim() };
  return (
    <ol className="media-storage__steps">
      {info.steps.map((step) => {
        const policy = step.copy === "key-policy" ? keyPolicy(target) : step.copy === "public-policy" ? publicPolicy(target) : null;
        return (
          <li key={step.title} className="media-storage__step">
            <h3 className="media-storage__step-title">{step.title}</h3>
            {step.text.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {step.url ? (
              <a className={buttonClass("secondary", "sm")} href={step.url} target="_blank" rel="noopener noreferrer">
                <Icon name="external" />
                {step.linkLabel ?? "Open the page"}
              </a>
            ) : null}
            {policy ? (
              <div className="media-storage__copy">
                <pre aria-label={step.copy === "key-policy" ? "The key's policy" : "The bucket policy"}>{policy}</pre>
                <Button variant="secondary" size="sm" icon="copy" onClick={() => copyText(policy, "Policy")}>
                  Copy
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The check, step by step: done, failed (with what to change), or not tried. */
export function CheckSteps({ result, running }: { result: MediaCheckResult | null; running: boolean }) {
  if (running) {
    return (
      <p className="media-storage__checking" role="status">
        <Spinner label="Checking" /> Checking for real: storing a tiny test picture, reading it back, loading it from the public address…
      </p>
    );
  }
  if (!result) return null;
  return (
    <div className="media-check" role={result.ok ? "status" : "alert"}>
      <ol className="media-check__steps">
        {result.steps.map((step) => (
          <li key={step.id} className={cx("media-check__step", `media-check__step--${step.state}`)}>
            {step.state === "ok" ? <Icon name="check" /> : step.state === "failed" ? <ProofMark kind="bang" /> : <span className="media-check__dot" aria-hidden="true" />}
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      {result.ok ? null : <p className="media-check__message">{result.message}</p>}
      {result.detail ? (
        <details className="app-details">
          <summary>Technical details</summary>
          <pre className="app-error__detail">{result.detail}</pre>
        </details>
      ) : null}
    </div>
  );
}

function KeyField({ field, value, onChange, error, stored, inputRef }: { field: MediaStoreField; value: string; onChange: (value: string) => void; error?: string; stored: { configured: boolean; hint?: string; source: string | null } | null; inputRef: (node: HTMLInputElement | null) => void }) {
  const where = usePlaceWords();
  const [replacing, setReplacing] = useState(false);
  if (stored?.configured && !replacing && !error) {
    return (
      <div className="deploy-key__stored" role="status">
        <Icon name="check" />
        <span>{stored.source === "env" ? `${field.label}: from the environment this app was started with, ending in ${stored.hint ?? "····"}.` : `${field.label} saved, ending in ${stored.hint ?? "····"}.`}</span>
        {stored.source === "env" ? null : (
          <button type="button" className="app-link-button" onClick={() => setReplacing(true)}>
            Paste a different one
          </button>
        )}
      </div>
    );
  }
  return (
    <Field label={field.label} hint={field.secret ? `${field.help.replace("Kept in this site's key store", `Kept ${where.keyStore}`)}` : field.help} error={error}>
      <Input ref={inputRef} type={field.secret ? "password" : "text"} mono autoComplete="off" spellCheck={false} value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function Summary({ siteId, status, onEdit, onChecked }: { siteId: string; status: MediaStorageStatus; onEdit: () => void; onChecked: (result: MediaCheckResult) => void }) {
  const config = status.bucket.config!;
  return (
    <div className="media-storage__summary">
      <dl className="app-media-details__facts">
        <dt>Kept in</dt>
        <dd>{status.bucket.store?.name ?? config.connector}</dd>
        <dt>Bucket</dt>
        <dd className="g-mono">{config.bucket}</dd>
        {config.prefix ? (
          <>
            <dt>Folder</dt>
            <dd className="g-mono">{config.prefix}</dd>
          </>
        ) : null}
        <dt>Public address</dt>
        <dd className="g-mono">{config.publicUrl}</dd>
        <dt>Key</dt>
        <dd>{status.bucket.keys.accessKeyId.configured ? `Saved, ending in ${status.bucket.keys.accessKeyId.hint ?? "····"}` : "Missing — paste it again"}</dd>
      </dl>
      {status.bucket.trialAddress ? (
        <p className="media-storage__note">
          <ProofMark kind="bang" /> This is an r2.dev address: rate-limited and meant for trying out. Connect a custom domain to the bucket on Cloudflare before the site goes live, then change the address here.
        </p>
      ) : null}
      <div className="app-media-details__actions">
        <CheckAgain siteId={siteId} onChecked={onChecked} />
        <Button variant="secondary" onClick={onEdit}>
          Change settings
        </Button>
      </div>
    </div>
  );
}

function CheckAgain({ siteId, onChecked }: { siteId: string; onChecked: (result: MediaCheckResult) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      icon="check"
      busy={busy}
      onClick={() => {
        setBusy(true);
        void api("POST /api/sites/:siteId/media/storage/check", { params: { siteId }, body: {} })
          .then(onChecked, (error: unknown) => notify({ tone: "danger", title: "Couldn’t check the bucket", body: errorShape(error).message }))
          .finally(() => setBusy(false));
      }}
    >
      Check again
    </Button>
  );
}

export function ConnectBucketDialog({ siteId, open, onClose }: { siteId: string; open: boolean; onClose: () => void }) {
  const status = useMediaStorage(siteId);
  const connectors = useConnectors();
  const connected = status.data?.bucket.config ?? null;
  const [editing, setEditing] = useState(false);
  const [connector, setConnector] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({ ...EMPTY });
  const [result, setResult] = useState<MediaCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [forgetKeys, setForgetKeys] = useState(false);
  const inputs = useRef(new Map<MediaStoreFieldId, HTMLInputElement>());

  // Opening starts from what is saved.
  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setResult(null);
    setConnector(connected?.connector ?? null);
    setValues(valuesOf(connected));
  }, [open, connected]);

  const info = useMemo(() => connectors.data?.connectors.find((candidate) => candidate.id === connector) ?? null, [connectors.data, connector]);
  const failed = result && !result.ok ? result.steps.find((step) => step.state === "failed") : undefined;
  const showForm = !connected || editing;

  useEffect(() => {
    if (failed?.field) inputs.current.get(failed.field)?.focus();
  }, [failed]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!connector) return;
    setBusy(true);
    setResult(null);
    try {
      const answer = await api("PUT /api/sites/:siteId/media/storage", {
        params: { siteId },
        body: { config: configOf(connector, values), ...(values.accessKeyId.trim() ? { accessKeyId: values.accessKeyId } : {}), ...(values.secretAccessKey.trim() ? { secretAccessKey: values.secretAccessKey } : {}) },
      });
      setResult(answer.check);
      if (answer.status) {
        invalidate(keys.media(siteId));
        setValues((current) => ({ ...current, accessKeyId: "", secretAccessKey: "" }));
        setEditing(false);
        notify({ tone: "success", title: "Bucket connected", body: `New files go to ${info?.name ?? "the bucket"}. Files already in the repository stay where they are.` });
      }
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t connect the bucket", body: errorShape(error).message, detail: errorShape(error).detail });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    await api("DELETE /api/sites/:siteId/media/storage", { params: { siteId }, query: { forgetKeys } });
    invalidate(keys.media(siteId));
    setStopping(false);
    onClose();
    notify({ tone: "neutral", title: "New files go to the repository again", body: "The files already in the bucket stay there, and pages that use them keep working." });
  };

  const stored = status.data?.bucket.keys ?? null;
  const sameStore = connected && connected.connector === connector;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={connected && !editing ? "Where new media goes" : "Keep media in a bucket"}
        size="lg"
        footer={
          showForm ? (
            <>
              {connected ? (
                <Button variant="quiet" onClick={() => setEditing(false)}>
                  Back
                </Button>
              ) : null}
              <Button variant="primary" type="submit" form="media-storage-form" disabled={!info} busy={busy}>
                Check and connect
              </Button>
            </>
          ) : (
            <>
              <Button variant="quiet" onClick={() => setStopping(true)}>
                Stop using the bucket
              </Button>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </>
          )
        }
      >
        {status.status === "error" ? <ErrorState title="Couldn’t load the storage settings" error={status.error} /> : null}
        {!status.data || !connectors.data ? (
          <Skeleton lines={4} />
        ) : !showForm ? (
          <>
            <Summary siteId={siteId} status={status.data} onEdit={() => setEditing(true)} onChecked={setResult} />
            <CheckSteps result={result} running={false} />
          </>
        ) : (
          <form id="media-storage-form" className="media-storage" onSubmit={(event) => void submit(event)}>
            <p className="deploy-setup__lede">Pictures, PDFs and videos uploaded from now on go to the bucket instead of the site’s repository, and pages use their full public address. Files already in the repository stay there.</p>
            <fieldset className="deploy-choices">
              <legend className="g-sr">Which kind of bucket</legend>
              {connectors.data.connectors.map((candidate) => (
                <label key={candidate.id} className={cx("deploy-choice", connector === candidate.id && "deploy-choice--on")}>
                  <input type="radio" name="media-connector" value={candidate.id} checked={connector === candidate.id} onChange={() => setConnector(candidate.id)} />
                  <span className="deploy-choice__body">
                    <span className="deploy-choice__title">
                      {candidate.name}
                      {candidate.recommended ? <Badge tone="accent" mark={null}>Recommended</Badge> : null}
                    </span>
                    <span className="deploy-choice__text">{candidate.blurb}</span>
                    {candidate.pricingUrl ? (
                      <a className="g-link deploy-choice__link" href={candidate.pricingUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                        {candidate.name}’s prices
                      </a>
                    ) : null}
                  </span>
                </label>
              ))}
            </fieldset>
            {info ? (
              <>
                {info.why ? <p className="media-storage__why">{info.why}</p> : null}
                <ProviderSteps info={info} values={values} />
                <p className="deploy-key__grants">
                  <Icon name="key" />
                  <span>{info.keyGrants}</span>
                </p>
                <div className="media-storage__fields">
                  {info.fields.map((field) =>
                    field.id === "accessKeyId" || field.id === "secretAccessKey" ? (
                      <KeyField
                        key={field.id}
                        field={field}
                        value={values[field.id]}
                        onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
                        error={failed?.field === field.id ? failed.message : undefined}
                        stored={sameStore && stored ? stored[field.id] : null}
                        inputRef={(node) => {
                          if (node) inputs.current.set(field.id, node);
                          else inputs.current.delete(field.id);
                        }}
                      />
                    ) : (
                      <Field key={field.id} label={field.required ? field.label : `${field.label} (optional)`} hint={field.id === "publicUrl" ? `${field.help} ${info.publicNote}` : field.help} error={failed?.field === field.id ? failed.message : undefined}>
                        <Input
                          ref={(node: HTMLInputElement | null) => {
                            if (node) inputs.current.set(field.id, node);
                            else inputs.current.delete(field.id);
                          }}
                          mono
                          spellCheck={false}
                          autoComplete="off"
                          value={values[field.id]}
                          placeholder={field.placeholder}
                          onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                        />
                      </Field>
                    )
                  )}
                </div>
                <CheckSteps result={result} running={busy} />
              </>
            ) : null}
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={stopping}
        onClose={() => setStopping(false)}
        title="Stop putting new files in the bucket?"
        body={
          <>
            <p>New files go to the site’s repository again. Everything already in the bucket stays there, and pages that use it keep working.</p>
            <Checkbox label="Also remove the bucket’s key from this app" checked={forgetKeys} onChange={setForgetKeys} />
          </>
        }
        confirmLabel="Stop using the bucket"
        busyLabel="Stopping"
        cancelLabel="Keep using it"
        errorTitle="Couldn’t change where files go"
        onConfirm={stop}
      />
    </>
  );
}
