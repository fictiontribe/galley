/**
 * "Use your own domain": type the address → a plan in plain words (nothing
 * changes yet) → yes → the host attaches it and Galley waits until it answers
 * over HTTPS → the result, with the offer to compare against it in Proof.
 * When the host needs a DNS record the person creates (Vercel, or a domain
 * outside the account), the record is shown with Copy and "Check again".
 */
import { useEffect, useState, type FormEvent } from "react";
import type { DeployDomainConfig, DomainPlan, DomainRecord, Job } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { invalidate } from "@/lib/query";
import { useJob, useJobs, useShowingJob } from "@/lib/stores/jobs";
import { notify } from "@/lib/stores/toasts";
import { Button, ConfirmDialog, Dialog, ErrorState, Field, Icon, IconButton, Input, ProofMark, Spinner, buttonClass } from "@/ui";
import { configuredDomains, hostOf } from "./logic";
import { AddressBlock, copyText } from "./parts";
import { applyLiveAddress, deployKeys, useDeployStatus, useDeployUi } from "./useDeploy";
import "./deploy.css";

/** The records the person must create at their DNS provider, each with Copy. */
export function DomainRecords({ records }: { records: DomainRecord[] }) {
  return (
    <table className="deploy-records">
      <thead>
        <tr>
          <th scope="col">Type</th>
          <th scope="col">Name</th>
          <th scope="col">Value</th>
          <th scope="col">
            <span className="g-sr">Copy</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <tr key={`${record.type}-${record.name}-${record.value}`}>
            <td className="g-mono">{record.type}</td>
            <td className="g-mono">{record.name}</td>
            <td className="g-mono deploy-records__value">{record.value}</td>
            <td>
              <IconButton icon="copy" label={`Copy the ${record.type} value`} onClick={() => copyText(record.value, "Value")} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const PLAN_MARK: Record<DomainPlan["status"], "reg" | "bang" | "stet"> = {
  ready: "reg",
  "needs-dns": "stet",
  already: "reg",
  taken: "bang",
  "dns-conflict": "bang",
  "not-in-account": "bang",
  "not-online": "bang",
};

export function DomainDialog({ siteId }: { siteId: string }) {
  const open = useDeployUi((s) => s.domain);
  const initialHost = useDeployUi((s) => s.domainHost);
  const setOpen = useDeployUi((s) => s.setDomain);
  const status = useDeployStatus(siteId);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<DomainPlan | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [compared, setCompared] = useState(false);
  const job = useJob(jobId);
  const activeHost = plan?.hostname ?? (initialHost || text.trim().toLowerCase() || status.data?.config?.domain?.hostname || "");
  const records = (activeHost ? status.data?.domainRecordsByHost?.[activeHost] : undefined) ?? status.data?.domainRecords ?? [];

  useShowingJob(jobId, open);
  useEffect(() => {
    if (!open) return;
    setText(initialHost ?? "");
    setPlan(null);
    setError(null);
    setJobId(null);
    setCompared(false);
  }, [open, initialHost]);
  // A finished job changes the status (the live address, records to create).
  useEffect(() => {
    if (job && job.state !== "running") invalidate(deployKeys.status(siteId));
  }, [job?.state]);

  const check = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setPlan(await api("POST /api/sites/:siteId/deploy/domain/plan", { params: { siteId }, body: { hostname: text } }));
    } catch (caught) {
      setError(errorShape(caught));
    } finally {
      setBusy(false);
    }
  };
  const run = async (call: () => Promise<Job>) => {
    setBusy(true);
    setError(null);
    try {
      const started = await call();
      useJobs.getState().upsert(started);
      setJobId(started.id);
    } catch (caught) {
      setError(errorShape(caught));
    } finally {
      setBusy(false);
    }
  };
  const attach = () => run(() => api("POST /api/sites/:siteId/deploy/domain", { params: { siteId }, body: { hostname: plan!.hostname } }));
  const checkAgain = () => run(() => api("POST /api/sites/:siteId/deploy/domain/check", { params: { siteId }, body: activeHost ? { hostname: activeHost } : {} }));
  const close = () => setOpen(false);

  const working = job?.state === "running";
  const answered = job?.state === "done" && job.url;
  const waitingForDns = job?.state === "done" && !job.url;
  const failed = job?.state === "error";
  const title = answered ? "Your address answers" : working ? "Setting up your address…" : waitingForDns ? "One DNS record to go" : failed ? "Couldn’t use that address" : "Use your own domain";

  let body;
  if (working) {
    body = (
      <div className="deploy-progress" role="status" aria-live="polite">
        <p className="deploy-domain__working">
          <Spinner label={job.detail ?? "Working"} />
          <span>{job?.detail}</span>
        </p>
        <p className="g-hint">This can take a few minutes while the certificate is set up. You can close this; it carries on.</p>
      </div>
    );
  } else if (answered) {
    body = (
      <div className="deploy-done">
        <AddressBlock url={job.url!} caption="The site's live address" />
        {status.data?.liveAddressSet || compared ? (
          <p className="deploy-setup__note" role="status">
            <Icon name="check" />
            <span>Proof compares your changes against this address.</span>
          </p>
        ) : (
          <div className="deploy-offer">
            <div>
              <p className="deploy-offer__title">Compare against this address?</p>
              <p className="deploy-offer__text">Proof can show your changes beside what visitors see at {hostOf(job.url!)}.</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void applyLiveAddress(siteId).then(
                  () => setCompared(true),
                  (caught: unknown) => setError(errorShape(caught))
                )
              }
            >
              Use this address
            </Button>
          </div>
        )}
      </div>
    );
  } else if (waitingForDns) {
    body = (
      <div className="deploy-setup">
        <p className="deploy-setup__lede">Create this record where {activeHost || "the domain"}’s DNS is managed. Then check again — it can take a few minutes to be seen.</p>
        <DomainRecords records={records} />
      </div>
    );
  } else {
    body = (
      <form id="deploy-domain-form" className="deploy-setup" onSubmit={(event) => void check(event)} noValidate>
        {failed && job ? (
          <div className="deploy-failure" role="alert">
            <ProofMark kind="bang" className="deploy-failure__mark" />
            <p className="deploy-failure__body">{job.detail}</p>
          </div>
        ) : null}
        <p className="deploy-setup__lede">Visitors reach the site at an address of yours, like www.example.com, instead of the host’s own. You’ll see exactly what changes before anything does.</p>
        <Field label="Address" hint="The full address: www.example.com, or example.com itself.">
          <Input
            mono
            value={text}
            placeholder="www.example.com"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value);
              setPlan(null);
            }}
            data-autofocus
          />
        </Field>
        {plan ? (
          <div className={`deploy-plan deploy-plan--${plan.canAttach || plan.status === "already" ? "ok" : "no"}`} role="status">
            <ProofMark kind={PLAN_MARK[plan.status]} className="deploy-plan__mark" />
            <div>
              <p className="deploy-plan__text">{plan.summary}</p>
              {plan.records?.length ? <DomainRecords records={plan.records} /> : null}
              {plan.helpUrl ? (
                <a className="g-link" href={plan.helpUrl} target="_blank" rel="noopener noreferrer">
                  How to do that on the host
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </form>
    );
  }

  const footer = working ? (
    <Button variant="secondary" onClick={close}>
      Keep going in the background
    </Button>
  ) : answered ? (
    <Button variant="primary" onClick={close} data-autofocus>
      Done
    </Button>
  ) : waitingForDns ? (
    <>
      <Button variant="secondary" onClick={close}>
        Later
      </Button>
      <Button variant="primary" busy={busy} busyLabel="Checking…" onClick={() => void checkAgain()}>
        Check again
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={close} disabled={busy}>
        Not now
      </Button>
      {plan && (plan.canAttach || plan.status === "already") && plan.hostname === text.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") ? (
        <Button variant="primary" busy={busy} busyLabel="Starting…" onClick={() => void attach()}>
          {plan.status === "already" ? "Use it as the live address" : "Use this address"}
        </Button>
      ) : (
        <Button variant="primary" type="submit" form="deploy-domain-form" busy={busy} busyLabel="Checking…" disabled={!text.trim()}>
          Check
        </Button>
      )}
    </>
  );

  return (
    <Dialog open={open} onClose={close} title={title} size="md" footer={footer} dismissible={!busy}>
      <div className="deploy-setup">
        {body}
        {error ? <ErrorState compact title="Couldn’t check that address" message={error.message} detail={error.detail} /> : null}
      </div>
    </Dialog>
  );
}

/** The Online card's own-domain list: each address, its state, Check again, Stop using it — and the way to add another. */
export function DomainSection({ siteId }: { siteId: string }) {
  const status = useDeployStatus(siteId);
  const domains = configuredDomains(status.data?.config);
  const [removing, setRemoving] = useState<DeployDomainConfig | null>(null);
  const fallback = status.data?.config?.defaultUrl;

  if (!status.data?.config) return null;
  if (domains.length === 0) {
    return (
      <Button variant="quiet" size="sm" icon="globe" onClick={() => useDeployUi.getState().setDomain(true)}>
        Use your own domain…
      </Button>
    );
  }
  return (
    <div className="deploy-domain">
      {domains.map((domain, index) => {
        const records = status.data?.domainRecordsByHost?.[domain.hostname] ?? (index === 0 ? status.data?.domainRecords : undefined) ?? [];

        return (
          <div key={domain.hostname} className="deploy-domain__item">
            <p className="deploy-domain__line">
              <span className="g-mono">{domain.hostname}</span>
              <span>{domain.pending ? " · not answering yet" : index === 0 && domains.length > 1 ? " · primary address" : " · your own address"}</span>
            </p>
            {records.length ? <DomainRecords records={records} /> : null}
            <div className="deploy-card__actions">
              {domain.pending ? (
                <Button variant="secondary" size="sm" onClick={() => useDeployUi.getState().setDomain(true, domain.hostname)}>
                  Check again…
                </Button>
              ) : (
                <a className={buttonClass("quiet", "sm")} href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" />
                  Open
                </a>
              )}
              <Button variant="danger-quiet" size="sm" onClick={() => setRemoving(domain)}>
                Stop using this address
              </Button>
            </div>
          </div>
        );
      })}
      <div className="deploy-card__actions">
        <Button variant="quiet" size="sm" icon="globe" onClick={() => useDeployUi.getState().setDomain(true, null)}>
          Add another domain…
        </Button>
      </div>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Stop using ${removing.hostname}?` : ""}
        body={
          removing?.attached
            ? `${removing.hostname} stops showing this site${domains.length === 1 && fallback ? `, and the live address goes back to ${hostOf(fallback)}` : ""}. The domain itself and its other records aren’t touched. You can use the address again later.`
            : `${removing ? `${removing.hostname} was set up outside this app, so it stays as it is on the host.` : ""}${domains.length === 1 && fallback ? ` The live address goes back to ${hostOf(fallback)}.` : ""}`
        }
        confirmLabel="Stop using this address"
        busyLabel="Stopping…"
        cancelLabel="Keep it"
        tone="danger"
        errorTitle="Couldn’t stop using the address"
        onConfirm={async () => {
          if (!removing) return;
          await api("DELETE /api/sites/:siteId/deploy/domain", { params: { siteId }, query: { hostname: removing.hostname } });
          invalidate(deployKeys.status(siteId));
          notify({ tone: "success", title: "Address removed", body: `${removing.hostname} is no longer listed for this site.` });
        }}
      />
    </div>
  );
}
