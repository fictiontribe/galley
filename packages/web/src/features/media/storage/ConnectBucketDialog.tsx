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
import type { MediaImagesConfig, MediaStorageConfig } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { invalidate } from "@/lib/query";
import { keys } from "@/lib/sync";
import { notify } from "@/lib/stores/toasts";
import { usePlaceWords } from "@/lib/where";
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, ErrorState, Field, Icon, Input, ProofMark, Skeleton, Spinner, buttonClass, cx } from "@/ui";
import { copyText } from "@/features/deploy/parts";
import "@/features/deploy/deploy.css";
import { useConnectors, useMediaStorage } from "./useMediaStorage";
import { MoveFiles } from "./MoveFiles";

type Values = Record<MediaStoreFieldId, string>;
const EMPTY: Values = { account: "", bucket: "", region: "", endpoint: "", prefix: "", publicUrl: "", accessKeyId: "", secretAccessKey: "", accountHash: "", variant: "", deliveryUrl: "", token: "" };
const IMAGES = "cloudflare-images";

function imagesValuesOf(config: MediaImagesConfig): Values {
  return { ...EMPTY, account: config.account, accountHash: config.accountHash, variant: config.variant ?? "", deliveryUrl: config.deliveryUrl ?? "" };
}

function imagesConfigOf(values: Values): MediaImagesConfig {
  return {
    connector: IMAGES,
    account: values.account.trim(),
    accountHash: values.accountHash.trim(),
    ...(values.variant.trim() ? { variant: values.variant.trim() } : {}),
    ...(values.deliveryUrl.trim() ? { deliveryUrl: values.deliveryUrl.trim() } : {}),
  };
}

function valuesOf(config: MediaStorageConfig | null): Values {
  if (!config) return { ...EMPTY };
  return {
    ...EMPTY,
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
      {result.ok || result.steps.some((step) => step.state === "failed" && step.field) ? null : <p className="media-check__message">{result.message}</p>}
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

function Summary({ siteId, status, onEdit, onStop, onChecked }: { siteId: string; status: MediaStorageStatus; onEdit: (connector: string) => void; onStop: (what: "bucket" | "images") => void; onChecked: (result: MediaCheckResult) => void }) {
  const config = status.bucket.config;
  const images = status.images.config;
  return (
    <div className="media-storage__summary">
      <p className="deploy-setup__lede">
        {images ? `Pictures go to Cloudflare Images; other files go to ${config ? "the bucket" : "the site’s repository"}.` : config ? "New files go to the bucket." : "New files are kept in the site’s repository."}
      </p>
      {config ? (
        <section className="media-storage__connection" aria-label="The bucket">
          <h3 className="media-storage__step-title">{status.bucket.store?.name ?? config.connector}</h3>
          <dl className="app-media-details__facts">
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
              <ProofMark kind="bang" /> This is an r2.dev address: rate-limited and meant for trying out. Connect a custom domain to the bucket on Cloudflare before the site goes live, then change the address below.
            </p>
          ) : null}
          <div className="app-media-details__actions">
            <CheckAgain siteId={siteId} what="bucket" onChecked={onChecked} />
            <Button size="sm" variant="secondary" onClick={() => onEdit(config.connector)}>
              Change settings
            </Button>
            <Button size="sm" variant="quiet" onClick={() => onStop("bucket")}>
              Stop using the bucket
            </Button>
          </div>
        </section>
      ) : null}
      {images ? (
        <section className="media-storage__connection" aria-label="Cloudflare Images">
          <h3 className="media-storage__step-title">Cloudflare Images</h3>
          <dl className="app-media-details__facts">
            <dt>Account hash</dt>
            <dd className="g-mono">{images.accountHash}</dd>
            <dt>Variant</dt>
            <dd className="g-mono">{images.variant ?? "public"}</dd>
            <dt>Delivered from</dt>
            <dd className="g-mono">{images.deliveryUrl ?? "https://imagedelivery.net"}</dd>
            <dt>Token</dt>
            <dd>{status.images.token.use === "deploy" ? "The site’s Cloudflare key for putting it online" : status.images.token.configured ? `Saved, ending in ${status.images.token.hint ?? "····"}` : "Missing — paste it again"}</dd>
          </dl>
          <div className="app-media-details__actions">
            <CheckAgain siteId={siteId} what="images" onChecked={onChecked} />
            <Button size="sm" variant="secondary" onClick={() => onEdit("cloudflare-images")}>
              Change settings
            </Button>
            <Button size="sm" variant="quiet" onClick={() => onStop("images")}>
              Stop using Images
            </Button>
          </div>
        </section>
      ) : null}
      <div className="app-media-details__actions">
        {!config ? (
          <Button size="sm" variant="secondary" onClick={() => onEdit("r2")}>
            Keep files in a bucket…
          </Button>
        ) : null}
        {!images ? (
          <Button size="sm" variant="secondary" onClick={() => onEdit("cloudflare-images")}>
            Keep pictures in Cloudflare Images…
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CheckAgain({ siteId, what, onChecked }: { siteId: string; what: "bucket" | "images"; onChecked: (result: MediaCheckResult) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      icon="check"
      busy={busy}
      onClick={() => {
        setBusy(true);
        void (what === "images" ? api("POST /api/sites/:siteId/media/images/check", { params: { siteId }, body: {} }) : api("POST /api/sites/:siteId/media/storage/check", { params: { siteId }, body: {} }))
          .then(onChecked, (error: unknown) => notify({ tone: "danger", title: "Couldn’t check it", body: errorShape(error).message }))
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
  const bucketConfig = status.data?.bucket.config ?? null;
  const imagesConfig = status.data?.images.config ?? null;
  const connected = bucketConfig ?? imagesConfig;
  const [editing, setEditing] = useState(false);
  const [useDeployKey, setUseDeployKey] = useState(false);
  const [connector, setConnector] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({ ...EMPTY });
  const [result, setResult] = useState<MediaCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState<"bucket" | "images" | null>(null);
  const [forgetKeys, setForgetKeys] = useState(false);
  const inputs = useRef(new Map<MediaStoreFieldId, HTMLInputElement>());

  // Opening starts from what is saved.
  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setResult(null);
    setConnector(bucketConfig?.connector ?? (imagesConfig ? IMAGES : null));
    setValues(bucketConfig ? valuesOf(bucketConfig) : imagesConfig ? imagesValuesOf(imagesConfig) : { ...EMPTY });
    setUseDeployKey(status.data?.images.token.use === "deploy");
  }, [open, bucketConfig, imagesConfig]);

  /** Opens the form for one connection, from what is saved for it. */
  const edit = (id: string) => {
    setConnector(id);
    setValues(id === IMAGES ? (imagesConfig ? imagesValuesOf(imagesConfig) : { ...EMPTY }) : bucketConfig && bucketConfig.connector === id ? valuesOf(bucketConfig) : { ...EMPTY });
    setResult(null);
    setEditing(true);
  };

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
      const answer =
        connector === IMAGES
          ? await api("PUT /api/sites/:siteId/media/images", {
              params: { siteId },
              body: { config: imagesConfigOf(values), ...(values.token.trim() && !useDeployKey ? { token: values.token } : {}), ...(useDeployKey ? { useDeployKey: true } : {}) },
            })
          : await api("PUT /api/sites/:siteId/media/storage", {
              params: { siteId },
              body: { config: configOf(connector, values), ...(values.accessKeyId.trim() ? { accessKeyId: values.accessKeyId } : {}), ...(values.secretAccessKey.trim() ? { secretAccessKey: values.secretAccessKey } : {}) },
            });
      setResult(answer.check);
      if (answer.status) {
        invalidate(keys.media(siteId));
        setValues((current) => ({ ...current, accessKeyId: "", secretAccessKey: "", token: "" }));
        setEditing(false);
        notify(
          connector === IMAGES
            ? { tone: "success", title: "Cloudflare Images connected", body: "New pictures go to Cloudflare Images; other files go where they went before. Pictures already in the repository stay where they are." }
            : { tone: "success", title: "Bucket connected", body: `New files go to ${info?.name ?? "the bucket"}. Files already in the repository stay where they are.` }
        );
      }
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t connect the bucket", body: errorShape(error).message, detail: errorShape(error).detail });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (stopping === "images") await api("DELETE /api/sites/:siteId/media/images", { params: { siteId }, query: { forgetKeys } });
    else await api("DELETE /api/sites/:siteId/media/storage", { params: { siteId }, query: { forgetKeys } });
    invalidate(keys.media(siteId));
    const what = stopping;
    setStopping(null);
    notify(
      what === "images"
        ? { tone: "neutral", title: "New pictures go where other files go again", body: "The pictures already in Cloudflare Images stay there, and pages that use them keep working." }
        : { tone: "neutral", title: "New files don’t go to the bucket any more", body: "The files already in the bucket stay there, and pages that use them keep working." }
    );
  };

  const stored = status.data?.bucket.keys ?? null;
  const sameStore = connector === IMAGES ? Boolean(imagesConfig) : Boolean(bucketConfig && bucketConfig.connector === connector);
  const storedFor = (id: MediaStoreFieldId) =>
    !sameStore ? null : id === "token" ? (status.data?.images.token.use === "own" ? status.data.images.token : null) : id === "accessKeyId" || id === "secretAccessKey" ? (stored?.[id] ?? null) : null;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={connected && !editing ? "Where new media goes" : connector === IMAGES ? "Keep pictures in Cloudflare Images" : "Keep media in a bucket"}
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
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          )
        }
      >
        {status.status === "error" ? <ErrorState title="Couldn’t load the storage settings" error={status.error} /> : null}
        {!status.data || !connectors.data ? (
          <Skeleton lines={4} />
        ) : !showForm ? (
          <>
            <Summary siteId={siteId} status={status.data} onEdit={edit} onStop={setStopping} onChecked={setResult} />
            <CheckSteps result={result} running={false} />
            <MoveFiles siteId={siteId} bucket={Boolean(bucketConfig)} images={Boolean(imagesConfig)} onStarted={onClose} />
          </>
        ) : (
          <form id="media-storage-form" className="media-storage" onSubmit={(event) => void submit(event)}>
            <p className="deploy-setup__lede">
              {connector === IMAGES
                ? "Pictures uploaded from now on go to Cloudflare Images, which sends each visitor a resized WebP or AVIF; PDFs, videos and anything over its limits go to the bucket, or the repository. Pages use each picture’s full address. Pictures already in the repository stay there."
                : "Pictures, PDFs and videos uploaded from now on go to the bucket instead of the site’s repository, and pages use their full public address. Files already in the repository stay there."}
            </p>
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
                {connector === IMAGES && status.data.cloudflare.keyStored ? (
                  <Checkbox label="Use the site’s Cloudflare key (the one for putting it online)" description="It needs Account › Cloudflare Images › Edit too; the check says if it hasn’t." checked={useDeployKey} onChange={setUseDeployKey} />
                ) : null}
                <div className="media-storage__fields">
                  {info.fields.filter((field) => !(field.id === "token" && useDeployKey && connector === IMAGES)).map((field) =>
                    field.id === "accessKeyId" || field.id === "secretAccessKey" || field.id === "token" ? (
                      <KeyField
                        key={field.id}
                        field={field}
                        value={values[field.id]}
                        onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
                        error={failed?.field === field.id ? failed.message : undefined}
                        stored={storedFor(field.id)}
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
        open={stopping !== null}
        onClose={() => setStopping(null)}
        title={stopping === "images" ? "Stop putting new pictures in Cloudflare Images?" : "Stop putting new files in the bucket?"}
        body={
          <>
            <p>
              {stopping === "images"
                ? "New pictures go where other files go. Everything already in Cloudflare Images stays there, and pages that use it keep working."
                : "New files go elsewhere (Cloudflare Images for pictures, if it is connected; else the repository). Everything already in the bucket stays there, and pages that use it keep working."}
            </p>
            <Checkbox label={stopping === "images" ? "Also remove the Images token from this app" : "Also remove the bucket’s key from this app"} checked={forgetKeys} onChange={setForgetKeys} />
          </>
        }
        confirmLabel={stopping === "images" ? "Stop using Images" : "Stop using the bucket"}
        busyLabel="Stopping"
        cancelLabel="Keep using it"
        errorTitle="Couldn’t change where files go"
        onConfirm={stop}
      />
    </>
  );
}
