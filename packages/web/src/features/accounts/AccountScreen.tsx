/**
 * /account — "Your account", for everyone on a hosted install with
 * accounts: your name and e-mail (what your publishes carry), your role in
 * words, your password, signing yourself out everywhere, and — for people
 * who don't look after the editor's settings — the theme, kept in this
 * browser.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { AccountSession } from "@galley/core/install/accounts";
import { useTopBar } from "@/app/chrome";
import { api, errorShape } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { disconnectEvents } from "@/lib/events";
import { ROLE_LINES, roleName, useAccount, useMay } from "@/lib/may";
import { clearQueries } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { useUi, type ThemeSetting } from "@/lib/stores/ui";
import { Badge, Button, ConfirmDialog, Field, Input, PageHeader, SegmentedControl } from "@/ui";
import { passwordProblem } from "@/features/install/logic";
import { Problem } from "@/features/install/parts";
import { NotYours } from "./NotYours";
import { emailProblem, nameProblem } from "./logic";
import { Section } from "./parts";
import "./accounts.css";

function You({ account }: { account: AccountSession }) {
  const mayPublish = useMay()("POST /api/sites/:siteId/publish");
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
  const emailChanged = email.trim().toLowerCase() !== account.email;
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
          <Field label="E-mail" error={problems.email}>
            <Input type="email" value={email} autoComplete="email" spellCheck={false} onChange={(event) => setEmail(event.target.value)} />
          </Field>
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

/** The theme for someone who doesn't look after the editor's settings: theirs, in this browser only. */
function Appearance() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  return (
    <Section id="appearance" title="Appearance">
      <Field label="Theme" group hint="Kept in this browser. System follows your computer’s light or dark setting">
        <SegmentedControl<ThemeSetting>
          label="Theme"
          value={theme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={setTheme}
        />
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
          <Password />
          <SignOutEverywhere />
          {may("PATCH /api/settings") ? null : <Appearance />}
        </div>
      </div>
    </div>
  );
}
