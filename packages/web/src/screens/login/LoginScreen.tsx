import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, isApiFailure } from "@/lib/api";
import { exchangeToken } from "@/lib/auth";
import { hostedInstall } from "@/lib/hosted";
import { safeNext } from "@/lib/session";
import { useMeta } from "@/lib/stores/meta";
import { Button, buttonClass, Field, Input, Logo } from "@/ui";
import { loginBody, loginProblem, providerRefusal } from "@/features/accounts/logic";
import { ForgotPassword } from "@/features/accounts/ForgotPassword";

/**
 * Hosted mode: your e-mail and password (or, on an install from before
 * accounts, the password alone), and, where the install has an identity
 * provider, its button above them. Local mode: the session link printed when
 * the app started (or its token pasted here).
 */
export function LoginScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const meta = useMeta((s) => s.meta);
  const reload = useMeta((s) => s.load);
  const [secret, setSecret] = useState("");
  const [email, setEmail] = useState("");
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // First run not finished: the password may not exist yet. Someone who chose it already can still sign in.
  const [signInAnyway, setSignInAnyway] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const emailInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = meta ? `Sign in · ${meta.brand.productName}` : "";
    (emailInput.current ?? input.current)?.focus();
  }, [meta, signInAnyway, forgot]);

  if (!meta) return null;
  if (meta.authenticated) return <Navigate to={next} replace />;
  const hosted = meta.mode === "hosted";
  const install = hostedInstall(meta);
  const signInWith = install?.signInWith;
  // Signing in through the identity provider: a top-level navigation, never a fetch. A refusal comes back as ?signin=<why>.
  const provider = hosted ? install?.provider : undefined;
  const refused = provider ? providerRefusal(params.get("signin"), provider.name, params.get("at")) : null;
  const byEmail = hosted && signInWith === "email";
  const wrong = byEmail ? "That e-mail and password don’t match an account here. Try again." : "That password isn’t right. Try again.";
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
            No one can sign in until someone sets it up. Whoever runs the server has the setup link: it was printed when the editor started. Open that link to create the owner’s account and connect the site.
          </p>
          <p className="app-login__body g-hint">
            Already set it up?{" "}
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
    const missing = hosted ? loginProblem(signInWith, email, secret.trim() ? secret : "") : secret.trim() ? null : "Paste the session link.";
    if (missing) {
      setError(missing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (hosted) {
        await api("POST /api/auth/login", { body: loginBody(signInWith, email, secret) });
      } else {
        const token = secret.includes("token=") ? (new URL(secret, window.location.origin).searchParams.get("token") ?? "") : secret.trim();
        if (!(await exchangeToken(token))) throw new Error("rejected");
      }
      const fresh = await reload();
      if (fresh?.authenticated) navigate(next, { replace: true });
      else setError(hosted ? wrong : "That link has expired. Use the newest one the app printed when it started.");
    } catch (caught) {
      // A wrong e-mail and a wrong password get one and the same answer; anything else (offline, too many tries) is the server's own sentence.
      if (isApiFailure(caught) && (caught.offline || (hosted && caught.status !== 401 && caught.status !== 400))) setError(caught.shape.message);
      else setError(hosted ? wrong : "That link isn’t valid. Use the newest one the app printed when it started.");
    } finally {
      setBusy(false);
    }
  };

  if (forgot && byEmail) {
    return (
      <div className="app-login">
        <div className="g-sheet g-crop app-login__sheet">
          <div className="app-login__brand">
            <Logo />
            <span className="g-brand__name">{meta.brand.productName}</span>
          </div>
          <ForgotPassword emailAvailable={Boolean(install?.passwordEmail)} initialEmail={email} onBack={() => setForgot(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="app-login">
      <form className="g-sheet g-crop app-login__sheet" onSubmit={submit} noValidate>
        <div className="app-login__brand">
          <Logo />
          <span className="g-brand__name">{meta.brand.productName}</span>
        </div>
        <h1 className="app-login__title">{hosted ? "Sign in to edit." : "Open with your session link."}</h1>
        <p className="app-login__body">
          {provider
            ? `Sign in with your account at ${provider.name}. If an owner invited you instead, use the e-mail and password you chose.`
            : byEmail
            ? "Sign in with your e-mail and the password you chose. To get in, ask an owner of this editor for an invitation."
            : hosted
              ? "This app is protected by a password. Ask whoever set it up if you don’t have it."
              : "For safety, this app only opens from the link it printed when it started. Open that link, or paste it here."}
        </p>
        {unfinished ? <p className="app-login__body g-hint">Setting up this editor isn’t finished. It carries on where it was left once you sign in.</p> : null}
        {refused ? (
          <p className="app-login__body app-login__refused" role="alert">
            {refused}
          </p>
        ) : null}
        {provider ? (
          <>
            <a className={buttonClass("primary", "md", "g-btn--block")} href={`/api/auth/oidc/start?return=${encodeURIComponent(next)}`}>
              Sign in with {provider.name}
            </a>
            <p className="app-login__body g-hint">{byEmail ? "Or with your e-mail and password:" : "Or with the password:"}</p>
          </>
        ) : null}
        {byEmail ? (
          <Field label="E-mail">
            <Input ref={emailInput} type="email" autoComplete="username" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
        ) : null}
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
        <Button type="submit" variant={provider ? "secondary" : "primary"} block busy={busy} busyLabel={hosted ? "Signing in" : "Opening"}>
          {hosted ? "Sign in" : "Open"}
        </Button>
        {byEmail ? (
          <p className="app-login__body g-hint">
            <button type="button" className="app-link-button" onClick={() => setForgot(true)}>
              Forgot your password?
            </button>
          </p>
        ) : null}
      </form>
    </div>
  );
}
