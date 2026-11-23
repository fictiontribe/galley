import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { FileChange, GitStatus, PublishCheck, PublishConfig, PublishMode } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { count } from "@/lib/format";
import { invalidate } from "@/lib/query";
import { useChanges } from "@/lib/stores/changes";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { Button, Checkbox, Dialog, Field, Input, ProofMark, buttonClass } from "@/ui";
import { useChangeName } from "./useNames";
import { publishOutcome, type PublishOutcome } from "./publishOutcome";
import { sendNow } from "./sendNow";
import { usePublishCheck } from "./publishCheck";
import { authorLine } from "./authorLine";
import { PublishDeployNote, onlineOutcome } from "@/features/deploy/Online";
import { useDeployStatus } from "@/features/deploy/useDeploy";
import "./proof.css";

export interface PublishDialogProps {
  siteId: string;
  open: boolean;
  onClose: () => void;
}

const NO_FILES: FileChange[] = [];

/** What pressing the button will do, in plain terms. */
function modeSentence(config: PublishConfig | undefined): { mode: PublishMode; text: string } {
  if (config?.mode === "pull-request") return { mode: "pull-request", text: "Sends the changes for review. A developer approves them before they go live." };
  if (config && config.push && config.remote) return { mode: "commit", text: "Publishes straight away: the changes go live on the site. You can undo it from Version history." };
  return { mode: "commit", text: "Saves the changes as a new version on this computer. This site isn’t set up to send versions to a host." };
}

function Outcome({ outcome }: { outcome: PublishOutcome }) {
  const mark = outcome.tone === "danger" || outcome.tone === "warning" ? "bang" : outcome.kind === "nothing" ? "stet" : "reg";
  return (
    <div className="publish-done" role="status">
      <ProofMark kind={mark} className={`publish-done__mark publish-done__mark--${outcome.tone}`} />
      <h3 className="publish-done__title">{`${outcome.title}.`}</h3>
      <p className="publish-done__body">{outcome.body}</p>
      {outcome.detail ? (
        <details className="app-details">
          <summary>Technical details</summary>
          <pre className="app-error__detail">{outcome.detail}</pre>
        </details>
      ) : null}
    </div>
  );
}

/** Who the version will be recorded as, which setting chose that, and where to change it. */
function AuthorSmallPrint({ siteId, author, onNavigate }: { siteId: string; author: NonNullable<GitStatus["author"]>; onNavigate: () => void }) {
  const line = authorLine(author, siteId);
  return (
    <p className="g-hint publish-author">
      {line.text}{" "}
      {line.change ? (
        <>
          {line.note ? `${line.note} ` : "Change it in "}
          <Link className="g-link" to={line.change.to} onClick={onNavigate}>
            {line.change.label}
          </Link>
          .
        </>
      ) : null}
    </p>
  );
}

/** What the plugins' publish checks say about what is ticked, each under the plugin's name. */
function PluginWarnings({ check }: { check: PublishCheck }) {
  return (
    <section className={check.refusal ? "publish-warnings publish-warnings--stop" : "publish-warnings"} aria-labelledby="publish-warnings-title">
      <ProofMark kind="bang" className="publish-warnings__mark" />
      <div className="publish-warnings__body">
        <h3 id="publish-warnings-title" className="publish-warnings__title">
          {check.refusal ? `${check.refusal.plugin} will stop this publish` : "You can still publish"}
        </h3>
        <ul className="publish-warnings__list">
          {check.refusal ? <li>{check.refusal.message}</li> : null}
          {check.warnings.map((warning, index) => (
            <li key={`${warning.plugin}:${index}`}>
              <strong>{warning.plugin}</strong> — {warning.message}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** "Publish 3 changes?" — choose what goes, say it in one line, then publish (or send for review). */
export function PublishDialog({ siteId, open, onClose }: PublishDialogProps) {
  const navigate = useNavigate();
  const files = useChanges((s) => s.changes?.files) ?? NO_FILES;
  const config = useSite((s) => s.detail?.model.publish);
  const author = useSite((s) => s.detail?.git.author);
  const { mode, text: modeText } = modeSentence(config);
  const nameOf = useChangeName();
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const touched = useRef(false);
  const online = Boolean(useDeployStatus(siteId).data?.config);
  const messageInput = useRef<HTMLInputElement>(null);

  const chosen = files.filter((file) => !left.has(file.path));
  const chosenKey = chosen.map((file) => file.path).join("\n");
  const all = chosen.length === files.length;
  // Asked only while the dialog is open: what the plugins' checks say about exactly what is ticked.
  const check = usePublishCheck(siteId, open && !outcome ? files : NO_FILES, all ? undefined : chosen.map((file) => file.path));

  // Fresh each time it opens.
  useEffect(() => {
    if (!open) return;
    setLeft(new Set());
    setOutcome(null);
    setMessage("");
    touched.current = false;
  }, [open]);

  // A suggested message for what's ticked, until the person writes their own.
  useEffect(() => {
    if (!open || outcome || chosen.length === 0 || touched.current) return;
    const controller = new AbortController();
    setSuggesting(true);
    const timer = setTimeout(() => {
      api("POST /api/sites/:siteId/publish/message", { params: { siteId }, body: all ? {} : { paths: chosen.map((file) => file.path) }, signal: controller.signal })
        .then(({ message: suggested }) => {
          if (!touched.current) setMessage(suggested.split("\n")[0] ?? "");
        })
        .catch(() => undefined)
        .finally(() => setSuggesting(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, siteId, chosenKey, outcome]);

  const publish = async () => {
    setBusy(true);
    const text = message.trim();
    try {
      const result = await api("POST /api/sites/:siteId/publish", {
        params: { siteId },
        body: { ...(text ? { message: text } : {}), ...(all ? {} : { paths: chosen.map((file) => file.path) }) },
      });
      setOutcome(publishOutcome(result, { message: text || "these changes", mode }));
      invalidate(["site", siteId, "history"]);
      invalidate(["site", siteId, "git"]);
      void useChanges.getState().refresh();
      void useSite.getState().refresh();
    } catch (error) {
      const shape = errorShape(error);
      setOutcome({ kind: "failed", tone: "danger", title: "Couldn’t publish", body: `${shape.message} Your changes are safe here.`, detail: shape.detail, canRetry: true });
    } finally {
      setBusy(false);
    }
  };

  // A new outcome replaces the form: move focus to its main button so keyboard users aren't left on the page behind.
  const doneButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (outcome) requestAnimationFrame(() => doneButton.current?.focus());
  }, [outcome]);

  // The code host has newer versions: bring them in (nothing here is overwritten), then the person publishes again.
  const [gettingLatest, setGettingLatest] = useState(false);
  const getLatest = async () => {
    setGettingLatest(true);
    try {
      await api("POST /api/sites/:siteId/pull", { params: { siteId } });
      invalidate(["site", siteId, "git"]);
      invalidate(["site", siteId, "history"]);
      void useSite.getState().refresh();
      void useChanges.getState().refresh();
      notify({ tone: "success", title: "Up to date", body: "This copy now has the newest published versions. Your edits are still here." });
      setOutcome(null);
    } catch (error) {
      const shape = errorShape(error);
      setOutcome({ kind: "failed", tone: "danger", title: "Couldn’t get the latest versions", body: `${shape.message} Your edits are safe.`, detail: shape.detail, canRetry: false });
    } finally {
      setGettingLatest(false);
    }
  };

  const sendAgain = async () => {
    setSending(true);
    try {
      setOutcome(await sendNow(siteId));
    } finally {
      setSending(false);
    }
  };

  const verb = mode === "pull-request" ? "Send for review" : `Publish ${count(chosen.length, "change")}`;
  const title = outcome ? outcome.title : mode === "pull-request" ? `Send ${count(chosen.length, "change")} for review?` : `Publish ${count(chosen.length, "change")}?`;

  let footer;
  if (!outcome) {
    footer = (
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Not yet
        </Button>
        <Button variant="primary" busy={busy} busyLabel={mode === "pull-request" ? "Sending…" : "Publishing…"} disabled={chosen.length === 0} onClick={() => void publish()}>
          {verb}
        </Button>
      </>
    );
  } else {
    const showHistory = outcome.kind === "published" || outcome.kind === "saved-local" || outcome.kind === "not-sent" || outcome.kind === "sent" || outcome.kind === "send-failed";
    footer = (
      <>
        {outcome.canSend ? (
          <Button variant="secondary" busy={sending} busyLabel="Sending…" onClick={() => void sendAgain()}>
            Try sending again
          </Button>
        ) : null}
        {outcome.canRetry ? (
          <Button variant="secondary" onClick={() => setOutcome(null)}>
            Try again
          </Button>
        ) : null}
        {outcome.canGetLatest ? (
          <Button variant="primary" icon="download" busy={gettingLatest} busyLabel="Getting the latest…" onClick={() => void getLatest()}>
            Get the latest
          </Button>
        ) : null}
        {outcome.reviewUrl ? (
          <a className={buttonClass("secondary", "md")} href={outcome.reviewUrl} target="_blank" rel="noopener noreferrer">
            View request
          </a>
        ) : null}
        {showHistory ? (
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              navigate(`/sites/${siteId}/history`);
            }}
          >
            See version history
          </Button>
        ) : null}
        <Button ref={doneButton} variant={outcome.canGetLatest ? "secondary" : "primary"} onClick={onClose} data-autofocus disabled={sending || gettingLatest}>
          {outcome.canGetLatest ? "Not now" : "Done"}
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} size="md" dismissible={!busy && !sending} footer={footer} hideTitle={Boolean(outcome)} initialFocus={outcome ? undefined : messageInput}>
      {outcome ? (
        <>
          <Outcome outcome={onlineOutcome(outcome, online)} />
          {outcome.kind === "published" || outcome.kind === "saved-local" || outcome.kind === "not-sent" ? <PublishDeployNote siteId={siteId} /> : null}
        </>
      ) : files.length === 0 ? (
        <p className="g-dialog__body">Nothing is waiting. Everything here already matches the live site.</p>
      ) : (
        <div className="publish-body">
          <p className="publish-mode">
            <ProofMark kind={mode === "pull-request" ? "send" : "reg"} />
            <span>{modeText}</span>
          </p>
          <Field label="Note for version history" hint="One line, in plain words. Shown in Version history.">
            {/* Always the same input, so focus stays put while a suggestion is on its way. */}
            <Input
              ref={messageInput}
              value={message}
              maxLength={120}
              placeholder={suggesting && !message ? "Suggesting a note…" : "What changed, in a few words"}
              aria-busy={suggesting && !message ? true : undefined}
              onChange={(event) => {
                touched.current = true;
                setMessage(event.target.value.replace(/[\r\n]+/g, " "));
              }}
            />
          </Field>
          {check.refusal || check.warnings.length > 0 ? <PluginWarnings check={check} /> : null}
          <fieldset className="app-fieldset">
            <legend className="g-label">{files.length === 1 ? "What goes" : `What goes · ${chosen.length} of ${files.length}`}</legend>
            <ul className="publish-list">
              {files.map((file) => (
                <li key={file.path}>
                  <Checkbox
                    checked={!left.has(file.path)}
                    onChange={(checked) =>
                      setLeft((current) => {
                        const next = new Set(current);
                        if (checked) next.delete(file.path);
                        else next.add(file.path);
                        return next;
                      })
                    }
                    label={nameOf(file)}
                    description={file.summary}
                  />
                  <span className="publish-list__meta">{file.status === "added" ? "New" : file.status === "deleted" ? "Deleted" : "Edited"}</span>
                </li>
              ))}
            </ul>
          </fieldset>
          {author ? <AuthorSmallPrint siteId={siteId} author={author} onNavigate={onClose} /> : null}
        </div>
      )}
    </Dialog>
  );
}
