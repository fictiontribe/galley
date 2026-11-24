/**
 * /join and /new-password — where a one-time link lands: an invitation, or a
 * link to choose a new password. Public, like /login. The code rides in the
 * address's fragment and leaves the address bar at once; the page checks it,
 * says what it is for, asks for a name (invitations) and a password, then
 * signs this browser in. A link that can't be used gets one calm page.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MIN_INSTALL_PASSWORD_LENGTH } from "@galley/core/install/types";
import type { AccountRole, LinkPreview } from "@galley/core/install/accounts";
import { roleMayCall } from "@galley/core/install/route-access";
import { api, errorShape, isApiFailure } from "@/lib/api";
import { disconnectEvents } from "@/lib/events";
import { ROLE_LINES, roleName } from "@/lib/may";
import { clearQueries } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { Button, ErrorState, Field, Input, Logo, Skeleton } from "@/ui";
import { passwordProblem } from "@/features/install/logic";
import { Problem } from "@/features/install/parts";
import { linkKindAt, nameProblem, takeLinkCode, timeLeft } from "./logic";
import "./accounts.css";

/** What the name is for, true to the role the invitation gives: only a role that publishes puts its name on versions. */
function nameHint(role: AccountRole | undefined): string {
  return role && !roleMayCall(role, "POST /api/sites/:siteId/publish") ? "The others who use this editor see it" : "It goes with everything you publish";
}

type Stage = { at: "checking" } | { at: "refused" } | { at: "wait" } | { at: "failed"; error: unknown } | { at: "ready"; preview: LinkPreview };

/**
 * A link that is used, taken back, run out or unknown: the server answers
 * 404 with one sentence for each, and this page says the same for each.
 * Nothing else means the link is bad — too many tries (429) means wait.
 */
export function isRefusal(error: unknown): boolean {
  return isApiFailure(error) && error.status === 404;
}

/** Too many tries from this address: the link may be fine, so the page says to wait rather than that the link is bad. */
export function isWait(error: unknown): boolean {
  return isApiFailure(error) && error.status === 429;
}

export const LINK_WAIT = "Too many tries from here. Wait a minute, then try again.";

function Sheet({ children }: { children: ReactNode }) {
  const brand = useMeta((s) => s.meta?.brand);
  return (
    <div className="app-login">
      <div className="g-sheet g-crop app-login__sheet">
        <div className="app-login__brand">
          <Logo />
          <span className="g-brand__name">{brand?.productName}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function LinkWait({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <h1 className="app-login__title">Wait a minute.</h1>
      <p className="app-login__body" role="status">
        {LINK_WAIT}
      </p>
      <Button variant="primary" block onClick={onRetry}>
        Try again
      </Button>
    </>
  );
}

export function LinkRefused() {
  return (
    <>
      <h1 className="app-login__title">This link can’t be used.</h1>
      <p className="app-login__body">It may have been used already, taken back, or run out of time. Ask whoever sent it for a new one.</p>
    </>
  );
}

function LinkForm({ code, preview, onRefused }: { code: string; preview: LinkPreview; onRefused: () => void }) {
  const navigate = useNavigate();
  const invitation = preview.kind === "invitation";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [problems, setProblems] = useState<{ name?: string; password?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = { name: invitation ? (nameProblem(name) ?? undefined) : undefined, password: passwordProblem(password, again) ?? undefined };
    setProblems(found);
    if (found.name || found.password) return;
    setBusy(true);
    setProblem(null);
    const wasSignedIn = Boolean(useMeta.getState().meta?.authenticated);
    try {
      await api("POST /api/auth/link", { body: { code, password, ...(invitation ? { name: name.trim() } : {}) } });
      setPassword("");
      setAgain("");
      if (wasSignedIn) {
        // This browser was someone else a moment ago: start clean, as them.
        window.location.assign("/");
        return;
      }
      disconnectEvents();
      clearQueries();
      await useMeta.getState().load();
      navigate("/", { replace: true });
    } catch (caught) {
      if (isRefusal(caught)) onRefused();
      else setProblem(isWait(caught) ? LINK_WAIT : errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  const role = preview.role;
  return (
    <form className="app-form-stack" onSubmit={(event) => void submit(event)} noValidate>
      <h1 className="app-login__title">{invitation ? "You’re invited." : "Choose a new password."}</h1>
      {invitation ? (
        <p className="app-login__body">
          {preview.invitedBy ? `${preview.invitedBy} invited ` : "This invitation is for "}
          <strong>{preview.email}</strong>
          {preview.invitedBy ? " to edit this site" : ""}
          {role ? (
            <>
              {" as "}
              <strong>{roleName(role)}</strong>
            </>
          ) : null}
          .
        </p>
      ) : (
        <p className="app-login__body">
          For <strong>{preview.email}</strong>. Your old password works until you choose this one.
        </p>
      )}
      {invitation && role ? <p className="app-login__body g-hint">{`${roleName(role)}: ${ROLE_LINES[role]}`}</p> : null}
      {invitation ? (
        <Field label="Your name" hint={nameHint(role)} error={problems.name}>
          <Input ref={first} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
      ) : null}
      <input type="email" autoComplete="username" value={preview.email} readOnly hidden />
      <Field label={invitation ? "Password" : "New password"} hint={`At least ${MIN_INSTALL_PASSWORD_LENGTH} characters`} error={problems.password}>
        <Input ref={invitation ? undefined : first} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </Field>
      <Field label="The same password again">
        <Input type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
      </Field>
      {problem ? <Problem>{problem}</Problem> : null}
      <Button type="submit" variant="primary" block busy={busy} busyLabel={invitation ? "Joining…" : "Saving…"}>
        {invitation ? "Join" : "Save password"}
      </Button>
      <p className="app-login__body g-hint">{`This link stops working ${timeLeft(preview.expiresAt)}, or once it’s used.`}</p>
    </form>
  );
}

export function LinkScreen() {
  const location = useLocation();
  const meta = useMeta((s) => s.meta);
  const kind = linkKindAt(location.pathname);
  const [code] = useState(() => takeLinkCode());
  const [stage, setStage] = useState<Stage>(() => (code ? { at: "checking" } : { at: "refused" }));

  const check = useCallback(async () => {
    if (!code) return;
    setStage({ at: "checking" });
    try {
      const preview = await api("POST /api/auth/link/check", { body: { code } });
      // A link opened at the other page's address is still the link it is.
      setStage({ at: "ready", preview });
    } catch (caught) {
      setStage(isRefusal(caught) ? { at: "refused" } : isWait(caught) ? { at: "wait" } : { at: "failed", error: caught });
    }
  }, [code]);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (meta) document.title = `${kind === "password" ? "New password" : "Join"} · ${meta.brand.productName}`;
  }, [meta, kind]);

  if (!meta) return null;
  let body: ReactNode;
  if (stage.at === "checking") {
    body = (
      <div aria-busy="true" className="app-form-stack">
        <Skeleton width={220} height={28} />
        <Skeleton lines={2} height={14} />
      </div>
    );
  } else if (stage.at === "refused") body = <LinkRefused />;
  else if (stage.at === "wait") body = <LinkWait onRetry={() => void check()} />;
  else if (stage.at === "failed") body = <ErrorState compact title="Couldn’t check this link" error={stage.error} onRetry={() => void check()} />;
  else body = <LinkForm code={code ?? ""} preview={stage.preview} onRefused={() => setStage({ at: "refused" })} />;
  return <Sheet>{body}</Sheet>;
}
