/**
 * "Also set them on Cloudflare": what it does and why, what the access key
 * needs, the plan before anything changes ("add 412, change 3, remove 9"),
 * progress while Cloudflare works through the list, the result, and a
 * re-check at any time. The key itself never reaches this screen — only
 * whether one is stored.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CloudflareCheck, CloudflarePlan, CloudflareRedirectItem, RedirectsOverview } from "@galley/core/redirects-info";
import { CLOUDFLARE_BULK_KEY_STEPS, CLOUDFLARE_KEY_URL } from "@galley/core/redirects-info";
import { api, errorShape } from "@/lib/api";
import { useJob, useJobs, useShowingJob } from "@/lib/stores/jobs";
import { notify } from "@/lib/stores/toasts";
import { Button, ConfirmDialog, Dialog, ErrorState, Field, Icon, Input, ProofMark, Spinner } from "@/ui";
import { redirectKeys, setOverview } from "./data";
import { invalidate } from "@/lib/query";
import { SITE_SETTINGS_LEVEL } from "@galley/core/install/route-access";
import { useMaySiteSettings, whoMayFirst } from "@/lib/may";

/** Under the account and domains, for someone whose role doesn't include the site's settings, where they are kept. */
export const CLOUDFLARE_SETTINGS_BY_OTHERS = `They’re kept in the site’s settings: ${whoMayFirst(SITE_SETTINGS_LEVEL).toLowerCase()} of this editor can change them.`;

type Step = "setup" | "plan" | "applying" | "done";

function ItemLine({ item }: { item: CloudflareRedirectItem }) {
  return (
    <li className="g-mono">
      {item.source_url}
      {item.subpath_matching ? " (and below)" : ""} → {item.target_url} <span className="g-faint">{item.status_code}</span>
    </li>
  );
}

function PlanView({ plan }: { plan: CloudflarePlan }) {
  const nothing = plan.list === "none" && plan.rule === "none";
  const parts = [plan.add ? `add ${plan.add.toLocaleString()}` : "", plan.change ? `change ${plan.change.toLocaleString()}` : "", plan.remove ? `remove ${plan.remove.toLocaleString()}` : ""].filter(Boolean);

  return (
    <div className="redir-plan">
      <p className="redir-plan__headline">{nothing ? "Cloudflare already matches the list. Nothing to change." : `${parts.length ? parts.join(", ").replace(/^./, (char) => char.toUpperCase()) : "No redirects to change"} on Cloudflare.`}</p>
      <ul className="redir-plan__facts">
        <li>{plan.list === "create" ? `A new redirect list, “${plan.listName}”, made by this app.` : `The list “${plan.listName}”, made by this app${plan.unchanged ? `: ${plan.unchanged.toLocaleString()} stay as they are` : ""}.`}</li>
        <li>{plan.rule === "create" ? "One rule that turns the list on, for your account." : plan.rule === "update" ? "The rule that turns the list on is put back the way this app set it." : "The rule that turns the list on is already there."}</li>
        <li>{`For ${plan.hostnames.join(" and ")}. Lists and rules this app didn’t make aren’t touched.`}</li>
      </ul>
      {plan.examples.add.length ? (
        <details className="redir-plan__list" open={plan.add <= 5}>
          <summary>{`Added (${plan.add.toLocaleString()})`}</summary>
          <ul>{plan.examples.add.map((item) => <ItemLine key={item.source_url} item={item} />)}</ul>
        </details>
      ) : null}
      {plan.examples.change.length ? (
        <details className="redir-plan__list">
          <summary>{`Changed (${plan.change.toLocaleString()})`}</summary>
          <ul>{plan.examples.change.map((pair) => <ItemLine key={pair.after.source_url} item={pair.after} />)}</ul>
        </details>
      ) : null}
      {plan.examples.remove.length ? (
        <details className="redir-plan__list">
          <summary>{`Removed (${plan.remove.toLocaleString()})`}</summary>
          <ul>{plan.examples.remove.map((item) => <ItemLine key={item.source_url} item={item} />)}</ul>
        </details>
      ) : null}
      {plan.skipped.length ? (
        <details className="redir-plan__list">
          <summary>{`Can’t go on Cloudflare (${plan.skipped.length.toLocaleString()})`}</summary>
          <ul>
            {plan.skipped.slice(0, 20).map((item) => (
              <li key={item.from}>
                <span className="g-mono">{item.from}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {plan.notes.map((note) => (
        <p key={note} className="redir-plan__note">
          <Icon name="warning" /> {note}
        </p>
      ))}
    </div>
  );
}

function KeySteps() {
  return (
    <div className="redir-key">
      <ol className="redir-key__steps">
        {CLOUDFLARE_BULK_KEY_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <a className="app-link-button" href={CLOUDFLARE_KEY_URL} target="_blank" rel="noopener noreferrer">
        Open Cloudflare’s API Tokens page <Icon name="external" />
      </a>
    </div>
  );
}

export function CloudflareDialog({ siteId, open, onClose, overview }: { siteId: string; open: boolean; onClose: () => void; overview: RedirectsOverview }) {
  const summary = overview.cloudflare!;
  // The account and domains are kept in the site's settings file: shown, not changed, by someone whose role doesn't include it.
  const maySettings = useMaySiteSettings();
  const [step, setStep] = useState<Step>("setup");
  const [account, setAccount] = useState(summary.account ?? "");
  const [hostnames, setHostnames] = useState(summary.hostnames.join(", "));
  const [plan, setPlan] = useState<CloudflarePlan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(summary.jobId);
  const [check, setCheck] = useState<CloudflareCheck | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const job = useJob(jobId);
  const permission = Boolean(error) && errorShape(error).code === "forbidden";

  useShowingJob(jobId, open && step === "applying");
  useEffect(() => {
    if (!open) return;
    setStep(summary.jobId && useJobs.getState().jobs.find((candidate) => candidate.id === summary.jobId)?.state === "running" ? "applying" : "setup");
    setAccount(summary.account ?? "");
    setHostnames(summary.hostnames.join(", "));
    setPlan(null);
    setError(null);
    setCheck(null);
  }, [open]);
  useEffect(() => {
    if (step === "applying" && job && job.state !== "running") {
      setStep("done");
      invalidate(redirectKeys.all(siteId));
    }
  }, [job, step, siteId]);

  const domains = hostnames
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const changed = (summary.accountFrom !== "deploy" && account.trim() !== (summary.account ?? "")) || domains.join(",") !== summary.hostnames.join(",");

  const seePlan = async () => {
    setBusy(true);
    setError(null);
    try {
      if (changed) {
        setOverview(
          siteId,
          await api("PUT /api/sites/:siteId/redirects/settings", {
            params: { siteId },
            body: { cloudflare: { ...(summary.accountFrom !== "deploy" ? { account: account.trim() || null } : {}), hostnames: domains } },
          })
        );
      }
      setPlan(await api("POST /api/sites/:siteId/redirects/cloudflare/plan", { params: { siteId } }));
      setStep("plan");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const started = await api("POST /api/sites/:siteId/redirects/cloudflare/apply", { params: { siteId }, body: { planId: plan.id } });

      useJobs.getState().upsert(started);
      setJobId(started.id);
      setStep("applying");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  const recheck = async () => {
    setBusy(true);
    try {
      setCheck(await api("POST /api/sites/:siteId/redirects/cloudflare/check", { params: { siteId } }));
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const footer =
    step === "setup" ? (
      <>
        <Button variant="secondary" onClick={onClose}>
          Not now
        </Button>
        <Button variant="primary" busy={busy} busyLabel="Asking Cloudflare…" disabled={!summary.keyConfigured || !domains.length || !account.trim()} onClick={() => void seePlan()}>
          See the plan
        </Button>
      </>
    ) : step === "plan" ? (
      <>
        <Button variant="secondary" onClick={() => setStep("setup")}>
          Back
        </Button>
        <Button variant="primary" busy={busy} busyLabel="Starting…" disabled={!plan || (plan.list === "none" && plan.rule === "none")} onClick={() => void apply()}>
          Apply on Cloudflare
        </Button>
      </>
    ) : step === "done" ? (
      <>
        <Button variant="secondary" busy={busy} busyLabel="Checking…" onClick={() => void recheck()}>
          Check Cloudflare matches
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </>
    ) : null;

  return (
    <Dialog open={open} onClose={onClose} size="lg" dismissible={step !== "applying"} title="Set the redirects on Cloudflare" description="Cloudflare then answers the old addresses itself, in front of the site, with room for far more redirects than the file takes." footer={footer}>
      {step === "setup" ? (
        <div className="redir-cfd">
          <ul className="redir-cfd__facts">
            <li>Only once the site is on its own domain in this Cloudflare account, with its traffic going through Cloudflare (the orange cloud). Not on a workers.dev address.</li>
            <li>This app makes one redirect list and one rule, named for this site, and changes nothing else on Cloudflare.</li>
            <li>The file that travels with the site stays as well. Where both have a redirect, Cloudflare’s comes first.</li>
          </ul>
          {summary.accountFrom === "deploy" ? (
            <p className="g-hint">Account: the one this site is put online with.</p>
          ) : (
            <Field label="Cloudflare account ID" hint="On the account’s home page in the Cloudflare dashboard, under Account ID.">
              <Input mono value={account} readOnly={!maySettings} onChange={(event) => setAccount(event.target.value)} placeholder="0123456789abcdef0123456789abcdef" />
            </Field>
          )}
          <Field label="The site’s domains" hint="Separate several with commas, like example.com, www.example.com.">
            <Input mono value={hostnames} readOnly={!maySettings} onChange={(event) => setHostnames(event.target.value)} placeholder="www.example.com" />
          </Field>
          {maySettings ? null : <p className="g-hint">{CLOUDFLARE_SETTINGS_BY_OTHERS}</p>}
          {!summary.keyConfigured ? (
            <p className="redir-cfd__key">
              <ProofMark kind="bang" /> Add a Cloudflare access key first, in the site’s <Link to={`/sites/${siteId}/online`}>Online settings</Link>. Then give it these permissions:
            </p>
          ) : null}
          <details className="redir-cfd__perm" open={!summary.keyConfigured || permission}>
            <summary>The access key needs {summary.permissions.join(" and ")}</summary>
            <KeySteps />
          </details>
          {error ? <ErrorState compact title={permission ? "The access key can’t change Bulk Redirects yet" : "Couldn’t make the plan"} error={error} /> : null}
          {summary.last ? (
            <button type="button" className="app-link-button redir-cfd__remove" onClick={() => setRemoveOpen(true)}>
              Take them off Cloudflare…
            </button>
          ) : null}
        </div>
      ) : step === "plan" && plan ? (
        <>
          <PlanView plan={plan} />
          {error ? <ErrorState compact title="Couldn’t start" error={error} /> : null}
        </>
      ) : step === "applying" ? (
        <div className="redir-cfd__progress" aria-live="polite">
          <Spinner label="Working" />
          <p>{job?.detail ?? "Starting…"}</p>
          <span className="redir-meter__bar" aria-hidden="true">
            <span style={{ inlineSize: `${Math.round((job?.progress ?? 0.05) * 100)}%` }} />
          </span>
          <p className="g-hint">Cloudflare works through long lists in the background. You can close this; the result shows here and on the Redirects screen.</p>
        </div>
      ) : (
        <div className="redir-cfd__done" aria-live="polite">
          {job?.state === "done" ? (
            <p className="redir-cfd__ok">
              <ProofMark kind="reg" /> {job.detail}
            </p>
          ) : (
            <ErrorState compact title="Couldn’t set them on Cloudflare" message={job?.detail ?? "Cloudflare didn’t finish."} detail={job?.output} />
          )}
          {check ? (
            check.matches ? (
              <p className="redir-cfd__ok">
                <ProofMark kind="reg" /> Cloudflare matches the list.
              </p>
            ) : (
              <ul className="redir-cfd__diff">
                {check.differences.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )
          ) : null}
          {error ? <ErrorState compact title="Couldn’t check Cloudflare" error={error} /> : null}
        </div>
      )}
      <ConfirmDialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title="Take the redirects off Cloudflare?"
        body="This removes the redirect list and the rule this app made. The site’s own redirect file stays, so redirects within its limits keep working."
        confirmLabel="Take them off"
        cancelLabel="Keep them"
        tone="danger"
        errorTitle="Couldn’t take them off Cloudflare"
        onConfirm={async () => {
          setOverview(siteId, await api("POST /api/sites/:siteId/redirects/cloudflare/remove", { params: { siteId } }));
          notify({ tone: "success", title: "Taken off Cloudflare" });
          onClose();
        }}
      />
    </Dialog>
  );
}
