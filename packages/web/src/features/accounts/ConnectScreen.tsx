/**
 * /account/connect — where linking your account to the identity provider
 * comes back to: whom the provider signed in (the e-mail only when it
 * confirmed it; otherwise its name for the person and their subject), and
 * Connect or Cancel. Nothing is bound until Connect; two accounts are never
 * merged.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PendingLinkView } from "@galley/core/install/accounts";
import { useTopBar } from "@/app/chrome";
import { api, errorShape } from "@/lib/api";
import { disconnectEvents } from "@/lib/events";
import { clearQueries } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { Button, PageHeader } from "@/ui";
import { Problem } from "@/features/install/parts";

export function ConnectScreen() {
  useTopBar({ crumbs: [{ label: "Your account", to: "/account" }, { label: "Connect" }] });
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingLinkView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"connect" | "cancel" | null>(null);

  useEffect(() => {
    api("GET /api/auth/oidc/link/pending")
      .then(setPending)
      .catch((caught: unknown) => setProblem(errorShape(caught).message));
  }, []);

  const answer = async (connect: boolean) => {
    setBusy(connect ? "connect" : "cancel");
    setProblem(null);
    try {
      await api("POST /api/auth/oidc/link/confirm", { body: { connect } });
      if (connect) {
        // Every session of the account ended; this browser has a new one, through the provider.
        disconnectEvents();
        clearQueries();
        await useMeta.getState().load();
        notify({ tone: "success", title: `Connected with ${pending?.provider ?? "the provider"}`, body: "You sign in there from now on. Your password here no longer works, and your other browsers were signed out." });
      }
      navigate("/account", { replace: true });
    } catch (caught) {
      setProblem(errorShape(caught).message);
      setBusy(null);
    }
  };

  return (
    <div className="app-screen">
      <div className="app-screen__inner app-settings">
        <PageHeader title={pending ? `Connect with ${pending.provider}?` : "Connect"} />
        {problem ? <Problem>{problem}</Problem> : null}
        {pending ? (
          <div className="app-form-stack">
            {pending.email ? (
              <p className="app-login__body">
                {pending.provider} signed in <strong>{pending.email}</strong>.
              </p>
            ) : (
              <p className="app-login__body">
                {pending.provider} signed in {pending.name ? <strong>{pending.name}</strong> : "someone"} (subject <code>{pending.subject}</code>). {pending.provider} hasn’t confirmed an e-mail for this account.
              </p>
            )}
            <p className="g-hint">Connect only if that is you. From then on you sign in with it, your password here stops working, and you’re signed out everywhere else.</p>
            <div className="app-form-row">
              <Button variant="primary" busy={busy === "connect"} busyLabel="Connecting…" disabled={busy !== null} onClick={() => void answer(true)}>
                Connect
              </Button>
              <Button variant="secondary" busy={busy === "cancel"} busyLabel="Cancelling…" disabled={busy !== null} onClick={() => void answer(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
