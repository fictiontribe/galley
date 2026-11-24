import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, isApiFailure } from "@/lib/api";
import { exchangeToken } from "@/lib/auth";
import { hostedInstall } from "@/lib/hosted";
import { safeNext } from "@/lib/session";
import { useMeta } from "@/lib/stores/meta";
import { Button, Field, Input, Logo } from "@/ui";

/**
 * Hosted mode: the deployment's password. Local mode: the session link
 * printed when the app started (or its token pasted here).
 */
export function LoginScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const meta = useMeta((s) => s.meta);
  const reload = useMeta((s) => s.load);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // First run not finished: the password may not exist yet. Someone who chose it already can still sign in.
  const [signInAnyway, setSignInAnyway] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = meta ? `Sign in · ${meta.brand.productName}` : "";
    input.current?.focus();
  }, [meta, signInAnyway]);

  if (!meta) return null;
  if (meta.authenticated) return <Navigate to={next} replace />;
  const hosted = meta.mode === "hosted";
  const install = hostedInstall(meta);
  // First run left half-way: the password exists, so this is the ordinary sign-in, and first run carries on after it.
  const unfinished = Boolean(install?.setupNeeded && install.passwordSet === true);
  const notSetUp = Boolean(install?.setupNeeded) && !unfinished && !signInAnyway;
  if (notSetUp) {
    return (
      <div className="app-login">
        <div className="g-sheet g-crop app-login__sheet">
          <div className="app-login__brand">
            <Logo />
            <span className="g-brand__name">{meta.brand.productName}</span>
          </div>
          <h1 className="app-login__title">This editor isn’t set up yet.</h1>
          <p className="app-login__body">
            There’s no password to sign in with until someone sets it up. Whoever runs the server has the setup link: it was printed when the editor started. Open that link to choose the password and connect the site.
          </p>
          <p className="app-login__body g-hint">
            Already chose the password?{" "}
            <button type="button" className="app-link-button" onClick={() => setSignInAnyway(true)}>
              Sign in
            </button>
          </p>
        </div>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!secret.trim()) {
      setError(hosted ? "Enter the password." : "Paste the session link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (hosted) {
        await api("POST /api/auth/login", { body: { password: secret } });
      } else {
        const token = secret.includes("token=") ? (new URL(secret, window.location.origin).searchParams.get("token") ?? "") : secret.trim();
        if (!(await exchangeToken(token))) throw new Error("rejected");
      }
      const fresh = await reload();
      if (fresh?.authenticated) navigate(next, { replace: true });
      else setError(hosted ? "That password isn’t right. Try again." : "That link has expired. Use the newest one the app printed when it started.");
    } catch (caught) {
      if (isApiFailure(caught) && caught.offline) setError(caught.shape.message);
      else setError(hosted ? "That password isn’t right. Try again." : "That link isn’t valid. Use the newest one the app printed when it started.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-login">
      <form className="g-sheet g-crop app-login__sheet" onSubmit={submit} noValidate>
        <div className="app-login__brand">
          <Logo />
          <span className="g-brand__name">{meta.brand.productName}</span>
        </div>
        <h1 className="app-login__title">{hosted ? "Sign in to edit." : "Open with your session link."}</h1>
        <p className="app-login__body">
          {hosted
            ? "This app is protected by a password. Ask whoever set it up if you don’t have it."
            : "For safety, this app only opens from the link it printed when it started. Open that link, or paste it here."}
        </p>
        {unfinished ? <p className="app-login__body g-hint">Setting up this editor isn’t finished. It carries on where it was left once you sign in.</p> : null}
        <Field label={hosted ? "Password" : "Session link"} hint={hosted ? undefined : "The code at the end of the link works too"} error={error ?? undefined}>
          <Input
            ref={input}
            type={hosted ? "password" : "text"}
            autoComplete={hosted ? "current-password" : "off"}
            spellCheck={false}
            mono={!hosted}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" block busy={busy} busyLabel={hosted ? "Signing in" : "Opening"}>
          {hosted ? "Sign in" : "Open"}
        </Button>
      </form>
    </div>
  );
}
