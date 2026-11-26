/**
 * /account — "Your account", for everyone on a hosted install with
 * accounts: your name and e-mail (what your publishes carry), your role in
 * words, your password, signing yourself out everywhere, and — for people
 * who don't look after the editor's settings — the theme, kept in this
 * browser.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { AccountSession } from "@galley/core/install/accounts";
import { useTopBar } from "@/app/chrome";
import { api, errorShape } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { disconnectEvents } from "@/lib/events";
import { ROLE_LINES, roleName, useAccount, useMay } from "@/lib/may";
import { clearQueries } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { useUi } from "@/lib/stores/ui";
import { THEME_OPTIONS, type ThemeSetting } from "@/lib/theme";
import { chooseTheme } from "@/app/theme";
import { Badge, Button, ConfirmDialog, Field, Input, PageHeader, SegmentedControl } from "@/ui";
import { passwordProblem } from "@/features/install/logic";
import { Problem } from "@/features/install/parts";
import { NotYours } from "./NotYours";
import { ThemeField } from "@/features/themes/ThemeField";
import { emailProblem, nameProblem, providerRefusal } from "./logic";
import { hostedInstall } from "@/lib/hosted";
import { Section } from "./parts";
import "./accounts.css";

/** Under someone's own e-mail when it isn't theirs to change. */
export const EMAIL_BY_OWNER = "An owner of this editor can change it";
/** Under the e-mail of someone who signs in through the identity provider. */
export const EMAIL_BY_PROVIDER = "It comes from where you sign in, with each sign-in";

function You({ account }: { account: AccountSession }) {
  const may = useMay();
  const mayPublish = may("POST /api/sites/:siteId/publish");
  // Your own e-mail is where a new-password link goes: an owner changes it (in People, or here for themselves); an account with none yet adds it here.
  // Someone who signs in through the identity provider has their e-mail from it, and no password to confirm a change with.
  const ownEmail = !account.viaProvider && (may("PATCH /api/people/:accountId") || !account.email);
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email);
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<{ name?: string; email?: string; password?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(account.name);
    setEmail(account.email);
  }, [account.name, account.email]);
  const emailChanged = ownEmail && email.trim().toLowerCase() !== account.email;
  const dirty = name.trim() !== account.name || emailChanged;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const found = {
      name: nameProblem(name) ?? undefined,
      email: emailChanged ? (emailProblem(email) ?? undefined) : undefined,
      password: emailChanged && !password ? "Enter your current password to change your e-mail." : undefined,
    };
    setProblems(found);
    if (found.name || found.email || found.password) return;
    setBusy(true);
    setProblem(null);
    try {
      await api("PATCH /api/account", { body: { name: name.trim(), ...(emailChanged ? { email: email.trim().toLowerCase(), password } : {}) } });
      setPassword("");
      await useMeta.getState().load();
      notify({ tone: "success", title: "Saved", body: mayPublish ? "What you publish from now on carries this name and e-mail." : "The others who use this editor see your new name from now on." });
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="you" title="You" description={mayPublish ? "Your name and e-mail go with every version you publish, in Version history. You sign in with this e-mail." : "Your name is how the others who use this editor know you. You sign in with this e-mail."}>
      <form className="app-form-stack" onSubmit={(event) => void save(event)} noValidate>
        <div className="app-form-row">
          <Field label="Name" error={problems.name}>
            <Input value={name} autoComplete="name" onChange={(event) => setName(event.target.value)} />
          </Field>
          {ownEmail ? (
            <Field label="E-mail" error={problems.email}>
              <Input type="email" value={email} autoComplete="email" spellCheck={false} onChange={(event) => setEmail(event.target.value)} />
            </Field>
          ) : (
            <Field label="E-mail" hint={account.viaProvider ? EMAIL_BY_PROVIDER : EMAIL_BY_OWNER}>
              <Input type="email" value={account.email} readOnly spellCheck={false} />
            </Field>
          )}
        </div>
        {emailChanged ? (
          <Field label="Current password" hint="Needed to change the e-mail: it’s where a new-password link is sent" error={problems.password}>
            <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
        ) : null}
        {problem ? <Problem>{problem}</Problem> : null}
        <div>
          <Button type="submit" variant="primary" size="sm" disabled={!dirty} busy={busy} busyLabel="Saving…">
            Save
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Role({ account }: { account: AccountSession }) {
  return (
    <Section id="role" title="Role" description="An owner of this editor chooses each person’s role.">
      <p className="accounts-role">
        <Badge mark={null}>{roleName(account.role)}</Badge>
        <span>{ROLE_LINES[account.role]}</span>
      </p>
    </Section>
  );
}

function Password() {
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
      await api("POST /api/account/password", { body: { current, next } });
      setCurrent("");
      setNext("");
      setAgain("");
      notify({ tone: "success", title: "Password changed", body: "Your other browsers were signed out. This one stays signed in." });
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="password" title="Password">
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
        <p className="g-hint">Changing it signs you out of your other browsers. This one stays signed in.</p>
        {problem ? <Problem>{problem}</Problem> : null}
        <div>
          <Button type="submit" variant="primary" size="sm" busy={busy} busyLabel="Changing…">
            Change password
          </Button>
        </div>
      </form>
    </Section>
  );
}

/**
 * Sign in through the identity provider instead of a password: confirmed with
 * the current password, then a fresh sign-in at the provider, then a page to
 * confirm whom it signed in. Nothing changes until then.
 */
function ConnectProvider({ provider }: { provider: string }) {
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(() => providerRefusal(params.get("link"), provider));
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) {
      setProblem("Enter the password you sign in with now.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { url } = await api("POST /api/auth/oidc/link", { body: { password } });
      // A top-level navigation to the provider, never a fetch or a frame.
      window.location.assign(url);
    } catch (caught) {
      setProblem(errorShape(caught).message);
      setBusy(false);
    }
  };

  return (
    <Section id="provider" title={`Sign in with ${provider}`}>
      <form className="app-form-stack" onSubmit={(event) => void submit(event)} noValidate>
        <p className="g-hint">{`Use your account at ${provider} to sign in here, instead of a password. You’ll sign in there, then confirm who it signed in. After that your password here stops working, and you’re signed out everywhere else.`}</p>
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        {problem ? <Problem>{problem}</Problem> : null}
        <div>
          <Button type="submit" variant="primary" size="sm" busy={busy} busyLabel="Going there…">
            {`Connect with ${provider}`}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** From the link `serve --reset-password` made: stop signing in through the provider (a wrong link put right) and choose a password. */
function RemoveProvider({ provider }: { provider: string }) {
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const issue = passwordProblem(next, again);
    if (issue) {
      setProblem(issue);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api("POST /api/account/identity/remove", { body: { password: next } });
      await useMeta.getState().load();
      notify({ tone: "success", title: `${provider} taken off`, body: "You sign in with this password now. Your other browsers were signed out." });
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="provider" title={`Stop signing in with ${provider}`}>
      <form className="app-form-stack" onSubmit={(event) => void submit(event)} noValidate>
        <p className="g-hint">{`You came in with the link whoever runs the server made. If this account was connected to the wrong person at ${provider}, take ${provider} off it and choose a password: you’ll sign in with it from now on.`}</p>
        <div className="app-form-row">
          <Field label="New password">
            <Input type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
          </Field>
          <Field label="New password again">
            <Input type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
          </Field>
        </div>
        {problem ? <Problem>{problem}</Problem> : null}
        <div>
          <Button type="submit" variant="danger" size="sm" busy={busy} busyLabel="Taking it off…">
            {`Take ${provider} off`}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function SignOutEverywhere() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  return (
    <Section id="sessions" title="Sign out everywhere" description="For a lost laptop, or a browser you signed in on and can’t reach now.">
      <div>
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Sign out everywhere…
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Sign out everywhere?"
        body="Every browser signed in as you is signed out, this one included. Other people stay signed in. Unpublished changes stay as they are."
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

/** The theme and the appearance for someone who doesn't look after the editor's settings: theirs, in this browser only. */
function Appearance() {
  const theme = useUi((s) => s.theme);
  return (
    <Section id="appearance" title="Theme and appearance">
      <ThemeField hint="Yours, kept in this browser" />
      <Field label="Appearance" group hint="Kept in this browser. Match my system follows your computer’s light or dark setting">
        <SegmentedControl<ThemeSetting> label="Appearance" value={theme} options={[...THEME_OPTIONS]} onChange={chooseTheme} />
      </Field>
    </Section>
  );
}

export function AccountScreen() {
  useTopBar({ crumbs: [{ label: "Your account" }] });
  const account = useAccount();
  const may = useMay();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const install = hostedInstall(useMeta((s) => s.meta));
  const provider = install?.provider?.name ?? null;
  // With passwords off, linking and choosing a password are done on the server.
  const passwordsOn = install?.signInWith !== "provider";
  if (!account) return <NotYours />;
  return (
    <div className="app-screen">
      <div className="app-screen__inner app-settings">
        <PageHeader
          title="Your account"
          description={`Signed in as ${account.email || account.name || roleName(account.role)}.`}
          actions={
            <Button
              variant="secondary"
              busy={signingOut}
              busyLabel="Signing out"
              onClick={() => {
                setSigningOut(true);
                signOut()
                  .then(() => navigate("/login", { replace: true }))
                  .catch((caught: unknown) => notify({ tone: "danger", title: "Couldn’t sign out", body: errorShape(caught).message }))
                  .finally(() => setSigningOut(false));
              }}
            >
              Sign out
            </Button>
          }
        />
        <div className="app-settings__sections">
          <You account={account} />
          <Role account={account} />
          {account.viaProvider ? null : <Password />}
          {provider && passwordsOn && !account.viaProvider ? <ConnectProvider provider={provider} /> : null}
          {provider && passwordsOn && account.viaProvider && account.sessionKind === "recovery" ? <RemoveProvider provider={provider} /> : null}
          <SignOutEverywhere />
          {may("PATCH /api/settings") ? null : <Appearance />}
        </div>
      </div>
    </div>
  );
}
