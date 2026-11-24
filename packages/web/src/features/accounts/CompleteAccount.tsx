/**
 * The owner of an install set up before accounts existed has no name or
 * e-mail yet. Right after signing in they are asked, once, for both (and the
 * current password, which changing an e-mail needs). "Not now" lets them on;
 * the question comes back the next time the app is opened.
 */
import { useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { create } from "zustand";
import { api, errorShape } from "@/lib/api";
import { useAccount } from "@/lib/may";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { SETUP_PATH } from "@/lib/hosted";
import { Button, Dialog, Field, Input } from "@/ui";
import { Problem } from "@/features/install/parts";
import { emailProblem, linkKindAt, nameProblem } from "./logic";

/** "Not now", for as long as this page is open: in memory on purpose, so the question comes back next time. */
const useLater = create<{ later: boolean; setLater: (later: boolean) => void }>((set) => ({ later: false, setLater: (later) => set({ later }) }));

export const COMPLETE_TITLE = "Add your name and e-mail";

export function CompleteAccountPrompt() {
  const account = useAccount();
  const location = useLocation();
  const later = useLater((s) => s.later);
  const setLater = useLater((s) => s.setLater);
  // Null until typed in: what the account already has shows meanwhile.
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<{ name?: string; email?: string; password?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Not over first run, sign-in or a one-time link: those pages have their own question.
  const elsewhere = location.pathname === "/login" || location.pathname === SETUP_PATH || linkKindAt(location.pathname) !== null;
  const open = Boolean(account?.incomplete) && !later && !elsewhere;
  if (!account) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name ?? account.name;
    const nextEmail = email ?? account.email;
    const found = { name: nameProblem(nextName) ?? undefined, email: emailProblem(nextEmail) ?? undefined, password: password ? undefined : "Enter the password you signed in with." };
    setProblems(found);
    if (found.name || found.email || found.password) return;
    setBusy(true);
    setProblem(null);
    try {
      await api("PATCH /api/account", { body: { name: nextName.trim(), email: nextEmail.trim().toLowerCase(), password } });
      setPassword("");
      await useMeta.getState().load();
      notify({ tone: "success", title: "Saved", body: "From now on, sign in with your e-mail and password." });
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => setLater(true)}
      title={COMPLETE_TITLE}
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={() => setLater(true)} disabled={busy}>
            Not now
          </Button>
          <Button type="submit" form="complete-account-form" variant="primary" busy={busy} busyLabel="Saving…">
            Save
          </Button>
        </>
      }
    >
      <form id="complete-account-form" className="app-form-stack" onSubmit={(event) => void submit(event)} noValidate>
        <p className="install-note">
          People now sign in to this editor with their own e-mail and password, and each version they publish carries their own name. Add yours: you’ll sign in with this e-mail from now on, and you can invite others. Your password stays the same.
        </p>
        <div className="app-form-row">
          <Field label="Name" error={problems.name}>
            <Input value={name ?? account.name} autoComplete="name" onChange={(event) => setName(event.target.value)} data-autofocus />
          </Field>
          <Field label="E-mail" error={problems.email}>
            <Input type="email" value={email ?? account.email} autoComplete="email" spellCheck={false} onChange={(event) => setEmail(event.target.value)} />
          </Field>
        </div>
        <Field label="Current password" hint="The one you just signed in with" error={problems.password}>
          <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        {problem ? <Problem>{problem}</Problem> : null}
      </form>
    </Dialog>
  );
}
