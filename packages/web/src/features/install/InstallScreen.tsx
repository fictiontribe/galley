/**
 * /install — a hosted install's own page: where it is, what it runs, the
 * repository it is connected to (and its key), the publishing name, who can
 * sign in, backups, and what is stored where. With accounts, "who can sign
 * in" is People (features/accounts) and each person's own password lives in
 * Your account; a server from before accounts keeps the one shared password
 * and "Sign out everywhere" here, as before.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PRODUCT } from "@galley/core/brand";
import type { DeployKeyInfo, InstallInfo } from "@galley/core/install/types";
import { useTopBar } from "@/app/chrome";
import { api, errorShape } from "@/lib/api";
import { disconnectEvents } from "@/lib/events";
import { absoluteTime, bytes, relativeTime } from "@/lib/format";
import { clearQueries, setQueryData, useQuery } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Badge, Button, ConfirmDialog, Dialog, ErrorState, Field, Input, PageHeader, ProofMark, Skeleton } from "@/ui";
import { accessWords, isFixed, passphraseProblem, passwordProblem } from "./logic";
import { KeySteps, Problem, RestoreFlow } from "./parts";
import { downloadBackup } from "./transport";
import { useAccount } from "@/lib/may";
import { PeopleSection } from "@/features/accounts/People";
import "./install.css";

function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="app-settings__section" id={id} aria-labelledby={`${id}-title`}>
      <header className="app-settings__section-head">
        <h2 className="app-settings__section-title" id={`${id}-title`}>
          {title}
        </h2>
        {description ? <p className="app-settings__section-text">{description}</p> : null}
      </header>
      <div className="app-settings__section-body">{children}</div>
    </section>
  );
}

function SetOnServerNote() {
  return <p className="g-hint">Set by whoever runs the server, so it can’t be changed here.</p>;
}

function Where({ info }: { info: InstallInfo }) {
  return (
    <Section id="where" title="Where it is">
      <dl className="install-facts">
        <dt>Address</dt>
        <dd>
          <a className="g-link g-mono" href={info.address} target="_blank" rel="noopener noreferrer">
            {info.address}
          </a>
        </dd>
        <dt>Preview</dt>
        <dd className="g-mono">{info.previewAddress ?? <span className="g-faint">No address set, so the preview stays empty</span>}</dd>
        <dt>Live site</dt>
        <dd className="g-mono">{info.liveAddress ?? <span className="g-faint">Not set</span>}</dd>
        <dt>Version</dt>
        <dd>{info.version}</dd>
        <dt>Set up</dt>
        <dd>{absoluteTime(info.createdAt)}</dd>
      </dl>
    </Section>
  );
}

function Repository({ info, onKey }: { info: InstallInfo; onKey: (key: DeployKeyInfo) => void }) {
  const [confirming, setConfirming] = useState(false);
  const site = info.site;
  return (
    <Section id="repository" title="The site’s repository" description="Where the site is kept. Each publish sends a new version there.">
      <dl className="install-facts">
        <dt>Site</dt>
        <dd>{site.name ?? <span className="g-faint">Not connected yet</span>}</dd>
        <dt>Repository</dt>
        <dd className="g-mono">{site.repository ?? <span className="g-faint">Not connected yet</span>}</dd>
        <dt>Reached with</dt>
        <dd>{accessWords(site.access)}</dd>
      </dl>
      {site.access === "deploy-key" && site.deployKey ? (
        <>
          <KeySteps info={site.deployKey} repository={site.repository ?? ""} />
          <div>
            <Button variant="secondary" size="sm" icon="key" onClick={() => setConfirming(true)}>
              Make a new key…
            </Button>
          </div>
          <ConfirmDialog
            open={confirming}
            onClose={() => setConfirming(false)}
            title="Make a new key?"
            body="The key the repository has now stops working at once: until you add the new one, with write access, publishing can’t reach the repository. Your changes stay safe here meanwhile."
            confirmLabel="Make a new key"
            cancelLabel="Keep this key"
            busyLabel="Making…"
            errorTitle="Couldn’t make a new key"
            onConfirm={async () => {
              const key = await api("POST /api/setup/deploy-key", { body: { rotate: true } });
              onKey(key);
              notify({ tone: "success", title: "New key made", body: "Add it to the repository with write access before the next publish." });
            }}
          />
        </>
      ) : site.access === "token" ? (
        <p className="install-note">The access token is stored on the server and is never shown again. To use another one, whoever runs the server replaces it there.</p>
      ) : null}
    </Section>
  );
}

function Author({ info }: { info: InstallInfo }) {
  const account = useAccount();
  if (account) {
    return (
      <Section id="author" title="Publishing name" description="Each version is recorded with the name and e-mail of the person who published it.">
        <p className="install-note">
          Yours is {account.name || "not set yet"}
          {account.email ? <span className="g-mono"> &lt;{account.email}&gt;</span> : null}. Change it in{" "}
          <Link className="g-link" to="/account">
            Your account
          </Link>
          .
        </p>
      </Section>
    );
  }
  return (
    <Section id="author" title="Publishing name" description="Recorded with each version published from this editor.">
      {info.author ? (
        <p className="install-note">
          {info.author.name} <span className="g-mono">&lt;{info.author.email}&gt;</span>
        </p>
      ) : (
        <p className="install-note g-faint">Not set yet.</p>
      )}
      {isFixed(info.fixed, "author") ? (
        <SetOnServerNote />
      ) : (
        <p className="install-note">
          Change it in{" "}
          <Link className="g-link" to="/settings#you">
            App settings › You
          </Link>
          .
        </p>
      )}
    </Section>
  );
}

function Password({ info, onChanged }: { info: InstallInfo; onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!current) {
      setProblem("Enter the password you sign in with now.");
      return;
    }
    const issue = passwordProblem(next, again);
    if (issue) {
      setProblem(issue);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api("POST /api/install/password", { body: { current, next } });
      setCurrent("");
      setNext("");
      setAgain("");
      onChanged();
      notify({ tone: "success", title: "Password changed", body: "Every other browser was signed out. This one stays signed in." });
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="password" title="Password" description={info.passwordChangedAt ? `Changed ${relativeTime(info.passwordChangedAt)}.` : undefined}>
      {isFixed(info.fixed, "password") ? (
        <SetOnServerNote />
      ) : (
        <form className="app-form-stack" onSubmit={(event) => void submit(event)} noValidate>
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
          </Field>
          <div className="app-form-row">
            <Field label="New password">
              <Input type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
            </Field>
            <Field label="New password again">
              <Input type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
            </Field>
          </div>
          <p className="g-hint">Changing it signs out every other browser signed in to this editor. This one stays signed in.</p>
          {problem ? <Problem>{problem}</Problem> : null}
          <div>
            <Button type="submit" variant="primary" size="sm" busy={busy} busyLabel="Changing…">
              Change password
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function SignOutEverywhere() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  return (
    <Section id="sessions" title="Sign out everywhere" description="For a lost laptop or a password that was shared too widely.">
      <div>
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Sign out everywhere…
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Sign out everywhere?"
        body="Every browser signed in to this editor is signed out, this one included. Anyone who wants back in needs the password. Unpublished changes stay as they are."
        confirmLabel="Sign out everywhere"
        cancelLabel="Stay signed in"
        busyLabel="Signing out…"
        errorTitle="Couldn’t sign out everywhere"
        onConfirm={async () => {
          await api("POST /api/auth/logout-all");
          disconnectEvents();
          clearQueries();
          await useMeta.getState().load();
          navigate("/login", { replace: true });
        }}
      />
    </Section>
  );
}

function BackupDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setPassphrase("");
    setAgain("");
    setProblem(null);
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const issue = passphraseProblem(passphrase, again);
    if (issue) {
      setProblem(issue);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const name = await downloadBackup(passphrase, PRODUCT.slug);
      notify({ tone: "success", title: "Backup downloaded", body: `Saved as “${name}”. Keep it somewhere safe, apart from the passphrase.` });
      onDone();
      close();
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Download a backup"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Not now
          </Button>
          <Button type="submit" form="install-backup-form" variant="primary" busy={busy} busyLabel="Preparing…">
            Download backup
          </Button>
        </>
      }
    >
      <form id="install-backup-form" className="app-form-stack" onSubmit={(event) => void submit(event)} noValidate>
        <p className="install-note">The file holds the site with its unpublished changes, this editor’s settings, and the keys stored here — so it is sealed with a passphrase you choose now.</p>
        <p className="install-warning">
          <ProofMark kind="bang" />
          <span>The passphrase can’t be recovered. Without it, the backup can’t be opened by anyone, you included.</span>
        </p>
        <Field label="Passphrase">
          <Input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} data-autofocus />
        </Field>
        <Field label="The same passphrase again">
          <Input type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
        </Field>
        {problem ? <Problem>{problem}</Problem> : null}
      </form>
    </Dialog>
  );
}

function RestoreDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const accounts = useAccount() !== null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Restore from a backup"
      dismissible={!busy}
      footer={
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Not now
        </Button>
      }
    >
      <div className="app-form-stack">
        <p className="install-warning">
          <ProofMark kind="bang" />
          <span>{`Restoring replaces everything this editor keeps — the site and its unpublished changes, settings, stored keys and ${accounts ? "the people who can sign in" : "the password"} — with what the backup holds. What’s here now is gone unless you download a backup of it first.`}</span>
        </p>
        <RestoreFlow
          onBusy={setBusy}
          // Everything was replaced, sessions included: start again from the top.
          onDone={() => window.location.assign("/")}
        />
      </div>
    </Dialog>
  );
}

function Backup({ info, onChanged }: { info: InstallInfo; onChanged: () => void }) {
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  return (
    <Section id="backup" title="Backup" description="One file with everything this editor keeps, to put back here or on a new server.">
      <p className="install-note">{info.lastBackupAt ? `Last backup downloaded ${relativeTime(info.lastBackupAt)}.` : "No backup has been downloaded yet."}</p>
      <div className="install-actions">
        <Button variant="primary" icon="download" onClick={() => setBackingUp(true)}>
          Download a backup…
        </Button>
        <Button variant="secondary" icon="upload" onClick={() => setRestoring(true)}>
          Restore from a backup…
        </Button>
      </div>
      <BackupDialog open={backingUp} onClose={() => setBackingUp(false)} onDone={onChanged} />
      <RestoreDialog open={restoring} onClose={() => setRestoring(false)} />
    </Section>
  );
}

function Storage({ info }: { info: InstallInfo }) {
  return (
    <Section id="storage" title="What is stored where">
      <p className="install-note">
        Everything this editor keeps is in one folder on the server, <span className="g-mono">{info.dataFolder}</span>. Previews are the site’s own code, running on this server.
      </p>
      <table className="app-table install-table">
        <caption className="g-sr">What is stored where</caption>
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col">Where</th>
            <th scope="col">Size</th>
            <th scope="col">In a backup</th>
          </tr>
        </thead>
        <tbody>
          {info.storage.map((line) => (
            <tr key={line.id}>
              <th scope="row">{line.label}</th>
              <td className="g-mono">{line.path}</td>
              <td className="install-table__num">{line.bytes === null ? "—" : bytes(line.bytes)}</td>
              <td>{line.inBackup ? <Badge tone="success">Yes</Badge> : <Badge mark={null}>Not carried</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export function InstallScreen() {
  useTopBar({ crumbs: [{ label: "Install" }] });
  const accounts = useAccount() !== null;
  const info = useQuery(keys.install(), () => api("GET /api/install"));
  const refresh = () => void info.refetch();
  return (
    <div className="app-screen">
      <div className="app-screen__inner app-settings">
        <PageHeader title="Install" description="This editor on its server: where it is, the repository it works on, who can sign in, and its backups." />
        {info.loading ? (
          <div aria-busy="true">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} height={140} style={{ marginBlockEnd: "var(--space-6)" }} />
            ))}
          </div>
        ) : info.status === "error" && !info.data ? (
          <ErrorState title="Couldn’t load the install’s details" error={info.error} onRetry={refresh} />
        ) : info.data ? (
          <div className="app-settings__sections">
            <Where info={info.data} />
            <Repository info={info.data} onKey={(deployKey) => info.data && setQueryData(keys.install(), { ...info.data, site: { ...info.data.site, deployKey } })} />
            <Author info={info.data} />
            {accounts ? (
              <PeopleSection />
            ) : (
              <>
                <Password info={info.data} onChanged={refresh} />
                <SignOutEverywhere />
              </>
            )}
            <Backup info={info.data} onChanged={refresh} />
            <Storage info={info.data} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
