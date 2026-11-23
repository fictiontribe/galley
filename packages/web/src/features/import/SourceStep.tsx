/**
 * Step 1 — where is it? The address, checked as it is typed (is it
 * WordPress, can its content be read, how much is there), or an export file
 * dropped in. A problem comes with its way forward: an application password
 * for a site that hides its content, the export file for anything else.
 */
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { ImportInspection, ImportSource, ImportUpload } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { bytes } from "@/lib/format";
import { Button, Field, Icon, Input, ProofMark, Spinner, cx } from "@/ui";
import { uploadExport } from "./data";
import { addressReady, exportFileProblem, inspectionFacts, shortAddress } from "./logic";

interface SourceStepProps {
  siteId: string;
  /** The look that passed, with its source, or null while there is none. */
  onReady: (ready: { source: ImportSource; look: ImportInspection } | null) => void;
  initial: { source: ImportSource; look: ImportInspection } | null;
}

type Check = { state: "idle" } | { state: "checking"; address: string } | { state: "done"; look: ImportInspection; source: ImportSource } | { state: "failed"; message: string };

function Facts({ look }: { look: ImportInspection }) {
  return (
    <ul className="imp-facts" aria-label="What the site has">
      {inspectionFacts(look).map((fact) => (
        <li key={fact.label} className={cx("imp-fact", fact.muted && "imp-fact--muted")}>
          <span className="imp-fact__value">{fact.value}</span>
          <span className="imp-fact__label">{fact.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Found({ look }: { look: ImportInspection }) {
  return (
    <div className="imp-found" role="status">
      <div className="imp-found__head">
        <span className="imp-found__mark" aria-hidden="true">
          <Icon name="check" />
        </span>
        <div>
          <p className="imp-found__title">{look.title || shortAddress(look.siteUrl)}</p>
          <p className="imp-found__meta">
            {look.kind === "file" ? "A WordPress export file" : `A WordPress site at ${shortAddress(look.siteUrl)}`}
            {look.signedIn ? " · signed in, so drafts and private pages come too" : ""}
          </p>
        </div>
      </div>
      <Facts look={look} />
      {look.builderPages ? <p className="imp-found__note">{`${look.builderPages} ${look.builderPages === 1 ? "page was" : "pages were"} made with a page builder — you’ll see what that means next.`}</p> : null}
      {look.notes.map((note) => (
        <p key={note} className="imp-found__note">
          <Icon name="warning" />
          <span>{note}</span>
        </p>
      ))}
    </div>
  );
}

function ExportHowTo() {
  return (
    <ol className="imp-howto">
      <li>In WordPress, open <strong>Tools › Export</strong>.</li>
      <li>Choose <strong>All content</strong> and press <strong>Download Export File</strong>.</li>
      <li>Drop the file it saves (it ends in .xml) here.</li>
    </ol>
  );
}

export function SourceStep({ siteId, onReady, initial }: SourceStepProps) {
  const [mode, setMode] = useState<"address" | "file">(initial?.source.kind === "file" ? "file" : "address");
  const [address, setAddress] = useState(initial?.source.kind === "address" ? initial.source.address : "");
  const [signIn, setSignIn] = useState(Boolean(initial?.source.kind === "address" && initial.source.user));
  const [user, setUser] = useState(initial?.source.kind === "address" ? (initial.source.user ?? "") : "");
  const [password, setPassword] = useState(initial?.source.kind === "address" ? (initial.source.password ?? "") : "");
  const [check, setCheck] = useState<Check>(initial ? { state: "done", look: initial.look, source: initial.source } : { state: "idle" });
  const [upload, setUpload] = useState<{ name: string; size: number; fraction: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ticket = useRef(0);

  const look = async (source: ImportSource, label: string) => {
    const mine = ++ticket.current;
    setCheck({ state: "checking", address: label });
    onReady(null);
    try {
      const answer = await api("POST /api/sites/:siteId/import/inspect", { params: { siteId }, body: { source } });
      if (mine !== ticket.current) return;
      setCheck({ state: "done", look: answer, source });
      onReady(answer.ok ? { source, look: answer } : null);
    } catch (error) {
      if (mine !== ticket.current) return;
      setCheck({ state: "failed", message: errorShape(error).message });
    }
  };

  const addressSource = (): ImportSource => ({ kind: "address", address: address.trim(), ...(signIn && user.trim() && password ? { user: user.trim(), password } : {}) });

  // The address is looked at a moment after typing stops — never per keystroke.
  useEffect(() => {
    if (mode !== "address") return;
    if (initial && check.state === "done" && initial.source.kind === "address" && initial.source.address === address) return;
    if (!addressReady(address)) {
      ticket.current += 1;
      setCheck({ state: "idle" });
      onReady(null);
      return;
    }
    // Half-filled sign-in waits for the other half; both empty is an ordinary look.
    if (signIn && Boolean(user.trim()) !== Boolean(password)) return;
    const timer = setTimeout(() => void look(addressSource(), shortAddress(address)), 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, mode, signIn, user, password]);

  const takeFile = async (file: File) => {
    const problem = exportFileProblem(file);
    setMode("file");
    if (problem) {
      setUpload(null);
      setCheck({ state: "failed", message: problem });
      onReady(null);
      return;
    }
    setUpload({ name: file.name, size: file.size, fraction: 0 });
    setCheck({ state: "checking", address: file.name });
    onReady(null);
    try {
      const done: ImportUpload = await uploadExport(siteId, file, (fraction) => setUpload((current) => (current ? { ...current, fraction } : current)));
      await look({ kind: "file", uploadId: done.id }, file.name);
    } catch (error) {
      setCheck({ state: "failed", message: errorShape(error).message });
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void takeFile(file);
  };

  const problem = check.state === "done" && !check.look.ok ? check.look.problem : undefined;

  return (
    <div className="imp-source" onDragOver={(event) => (event.preventDefault(), setDragging(true))} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {mode === "address" ? (
        <>
          <Field label="The site’s address" hideLabel>
            <Input
              className="imp-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && addressReady(address)) {
                  event.preventDefault();
                  void look(addressSource(), shortAddress(address));
                }
              }}
              placeholder="example.com"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              aria-label="The site’s address"
              data-autofocus
            />
          </Field>
          {signIn ? (
            <div className="imp-signin">
              <div className="imp-signin__head">
                <p className="imp-signin__lede">
                  Make an <strong>application password</strong> in WordPress under <strong>Users › Profile › Application passwords</strong>. It’s used for this import only and never saved.
                </p>
                <Button size="sm" variant="quiet" onClick={() => (setSignIn(false), setUser(""), setPassword(""))}>
                  Don’t sign in
                </Button>
              </div>
              <div className="imp-signin__fields">
                <Field label="WordPress user name">
                  <Input value={user} onChange={(event) => setUser(event.target.value)} autoComplete="username" spellCheck={false} />
                </Field>
                <Field label="Application password">
                  <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="off" spellCheck={false} placeholder="abcd efgh ijkl mnop qrst uvwx" />
                </Field>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="imp-check" aria-live="polite">
        {check.state === "checking" ? (
          <p className="imp-check__busy">
            <Spinner label="Checking" />
            <span>{upload && upload.fraction < 1 ? `Uploading ${upload.name} — ${Math.round(upload.fraction * 100)}% of ${bytes(upload.size)}` : `Looking at ${check.address}…`}</span>
          </p>
        ) : check.state === "failed" ? (
          <div className="imp-problem" role="alert">
            <ProofMark kind="bang" />
            <p>{check.message}</p>
          </div>
        ) : check.state === "done" && check.look.ok ? (
          <Found look={check.look} />
        ) : problem ? (
          <div className="imp-problem" role="alert">
            <ProofMark kind="bang" />
            <div className="imp-problem__body">
              <p>{problem.message}</p>
              <div className="imp-problem__actions">
                {problem.offer.includes("password") && !signIn ? (
                  <Button size="sm" variant="secondary" icon="key" onClick={() => setSignIn(true)}>
                    Add an application password
                  </Button>
                ) : null}
                {problem.offer.includes("file") ? (
                  <Button size="sm" variant="quiet" icon="upload" onClick={() => setMode("file")}>
                    Use an export file instead
                  </Button>
                ) : null}
              </div>
              {problem.detail ? (
                <details className="app-details">
                  <summary>Technical details</summary>
                  <pre className="app-error__detail">{problem.detail}</pre>
                </details>
              ) : null}
            </div>
          </div>
        ) : mode === "address" ? (
          <p className="imp-check__idle">Paste the address of the site’s home page. It’s checked as you type.</p>
        ) : null}
      </div>

      <div className={cx("imp-drop", dragging && "imp-drop--over", mode === "file" && "imp-drop--open")}>
        {mode === "file" ? (
          <>
            <p className="imp-drop__title">{upload ? upload.name : "Drop your WordPress export file here"}</p>
            {upload ? <p className="imp-drop__meta">{bytes(upload.size)}</p> : <ExportHowTo />}
            <div className="imp-drop__actions">
              <Button size="sm" variant="secondary" icon="upload" onClick={() => fileInput.current?.click()}>
                {upload ? "Choose another file" : "Choose a file"}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => (setMode("address"), setUpload(null), setCheck({ state: "idle" }), onReady(null))}>
                Use the address instead
              </Button>
            </div>
          </>
        ) : (
          <p className="imp-drop__line">
            <Icon name="upload" />
            <span>
              Or drop an export file here —{" "}
              <button type="button" className="g-link imp-drop__link" onClick={() => setMode("file")}>
                here’s how to get one
              </button>
            </span>
          </p>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".xml,.wxr,text/xml,application/xml"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void takeFile(file);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
