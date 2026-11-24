/**
 * "Forgot your password?" on the sign-in page. With outgoing e-mail the
 * person asks for a link themselves, and the page always ends on the same
 * sentence, sent or not — so it can't be used to find out who has an
 * account. Without it, an owner makes the link.
 */
import { useState, type FormEvent } from "react";
import { PASSWORD_LINK_MINUTES } from "@galley/core/install/accounts";
import { api, errorShape } from "@/lib/api";
import { Button, Field, Input } from "@/ui";
import { emailProblem } from "./logic";

export const FORGOT_SENT = "If that address has an account here, a link is on its way.";
export const FORGOT_ASK_OWNER = "Ask an owner of this editor for a new-password link. It lets you choose a new password once.";

export function ForgotPassword({ emailAvailable, initialEmail, onBack }: { emailAvailable: boolean; initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // The server has the last word: one without outgoing e-mail says so, even if the page thought otherwise.
  const [canEmail, setCanEmail] = useState(emailAvailable);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const issue = emailProblem(email);
    if (issue) {
      setProblem(issue);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const answer = await api("POST /api/auth/forgot", { body: { email: email.trim().toLowerCase() } });
      if (answer.emailAvailable) setSent(true);
      else setCanEmail(false);
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <p className="app-login__body g-hint">
      <button type="button" className="app-link-button" onClick={onBack}>
        Back to sign in
      </button>
    </p>
  );

  if (!canEmail) {
    return (
      <>
        <h1 className="app-login__title">Forgot your password?</h1>
        <p className="app-login__body">{FORGOT_ASK_OWNER}</p>
        {back}
      </>
    );
  }
  if (sent) {
    return (
      <>
        <h1 className="app-login__title">Check your e-mail.</h1>
        <p className="app-login__body" role="status">
          {FORGOT_SENT}
        </p>
        <p className="app-login__body g-hint">{`The link works once, within ${PASSWORD_LINK_MINUTES} minutes. If nothing arrives, ask an owner of this editor for one.`}</p>
        {back}
      </>
    );
  }
  return (
    <form className="app-form-stack" onSubmit={(event) => void submit(event)} noValidate>
      <h1 className="app-login__title">Forgot your password?</h1>
      <p className="app-login__body">Give the e-mail you sign in with. A link to choose a new password is sent there.</p>
      <Field label="E-mail" error={problem ?? undefined}>
        <Input type="email" autoComplete="username" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} data-autofocus autoFocus />
      </Field>
      <Button type="submit" variant="primary" block busy={busy} busyLabel="Sending">
        Send the link
      </Button>
      {back}
    </form>
  );
}
