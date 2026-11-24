/**
 * People, on the Install page (owners): who can sign in and as what, open
 * invitations, and what an owner does about each person — change their role,
 * switch them off or on, make a new-password link, sign them out, remove
 * them. One-time links are shown once, at the moment they are made. The
 * server is the judge of what is allowed (the last owner, your own account);
 * its refusals are shown in its own words.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ACCOUNT_ROLES, type Account, type AccountRole, type Invitation, type OneTimeLink } from "@galley/core/install/accounts";
import { api, errorShape } from "@/lib/api";
import { disconnectEvents } from "@/lib/events";
import { relativeTime } from "@/lib/format";
import { ROLE_LINES, roleName, useAccount } from "@/lib/may";
import { clearQueries, useQuery } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, ConfirmDialog, Dialog, ErrorState, Field, IconButton, Input, Menu, Select, Skeleton, buttonClass, cx } from "@/ui";
import { Problem } from "@/features/install/parts";
import { emailProblem, personLabel, timeLeft } from "./logic";
import { LinkOnce, Section } from "./parts";
import "./accounts.css";

export const peopleKey = () => ["people"] as const;

export const NO_EMAIL_LINE = "This server has no outgoing e-mail, so links aren’t e-mailed: copy each one and send it yourself. Whoever runs the server can set up e-mail — the guide to running this editor says how.";

const ROLE_OPTIONS = ACCOUNT_ROLES.map((role) => ({ value: role, label: roleName(role) }));

/** A one-time link that has just been made, to show once. */
interface Shown {
  title: string;
  who: string;
  link: OneTimeLink;
  again: string;
}

function LinkDialog({ shown, onClose }: { shown: Shown | null; onClose: () => void }) {
  return (
    <Dialog
      open={shown !== null}
      onClose={onClose}
      title={shown?.title ?? ""}
      footer={
        <Button variant="primary" onClick={onClose} data-autofocus>
          Done
        </Button>
      }
    >
      {shown ? <LinkOnce link={shown.link} who={shown.who} again={shown.again} /> : null}
    </Dialog>
  );
}

function InviteForm({ onInvited }: { onInvited: (invitation: Invitation, link: OneTimeLink) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccountRole>("editor");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const made = await api("POST /api/people/invitations", { body: { email: email.trim().toLowerCase(), role } });
      setEmail("");
      onInvited(made.invitation, made.link);
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="app-form-stack accounts-invite" onSubmit={(event) => void submit(event)} noValidate aria-label="Invite someone">
      <Field label="E-mail of the person to invite">
        <Input type="email" autoComplete="off" spellCheck={false} value={email} placeholder="name@example.com" onChange={(event) => setEmail(event.target.value)} />
      </Field>
      <fieldset className="app-fieldset">
        <legend className="g-label">Role</legend>
        <div className="accounts-roles">
          {ACCOUNT_ROLES.map((candidate) => (
            <label key={candidate} className={cx("app-model", role === candidate && "app-model--checked")}>
              <input type="radio" name="invite-role" value={candidate} className="app-model__radio" checked={role === candidate} onChange={() => setRole(candidate)} />
              <span className="app-model__text">
                <span className="app-model__name">{roleName(candidate)}</span>
                <span className="app-model__blurb">{ROLE_LINES[candidate]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {problem ? <Problem>{problem}</Problem> : null}
      <div>
        <Button type="submit" variant="primary" size="sm" icon="plus" busy={busy} busyLabel="Inviting…">
          Invite
        </Button>
      </div>
    </form>
  );
}

interface RowProps {
  person: Account;
  me: boolean;
  onChanged: () => void;
  onProblem: (message: string | null) => void;
  onLink: (shown: Shown) => void;
  onRemove: (person: Account) => void;
}

function PersonRow({ person, me, onChanged, onProblem, onLink, onRemove }: RowProps) {
  const [busy, setBusy] = useState(false);
  const name = personLabel(person);

  /** Run an action; the server's refusal is shown in its words, and the list is read again either way. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    onProblem(null);
    try {
      await action();
    } catch (caught) {
      onProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const changeRole = (role: AccountRole) =>
    run(async () => {
      await api("PATCH /api/people/:accountId", { params: { accountId: person.id }, body: { role } });
      notify({ tone: "success", title: `${name}’s role is ${roleName(role)} now` });
    });

  return (
    <tr className={cx(person.disabled && "accounts-row--off")}>
      <th scope="row">
        <span className="accounts-person">
          <span className="accounts-person__name">
            {person.name || <span className="g-faint">No name yet</span>}
            {me ? <Badge mark={null}>You</Badge> : null}
            {person.disabled ? <Badge tone="warning" mark={null}>Switched off</Badge> : null}
          </span>
          <span className="accounts-person__email">{person.email || "No e-mail yet"}</span>
        </span>
      </th>
      <td>
        {me ? (
          // Your own role, switching yourself off and removing yourself are another owner's to do: the server refuses them from you.
          <span className="accounts-own-role" title="Another owner can change your role">
            {roleName(person.role)}
          </span>
        ) : (
          <Select aria-label={`Role of ${name}`} value={person.role} options={ROLE_OPTIONS} disabled={busy} onChange={(value) => void changeRole(value as AccountRole)} />
        )}
      </td>
      <td className="accounts-when">{person.lastSeenAt ? relativeTime(person.lastSeenAt) : "Not yet"}</td>
      <td className="accounts-actions">
        {me ? (
          <Link className={buttonClass("quiet", "sm")} to="/account">
            Your account
          </Link>
        ) : (
          <Menu
            label={`What to do about ${name}`}
            placement="bottom-end"
            items={[
              {
                id: "password-link",
                label: "New-password link",
                icon: "key",
                onSelect: () =>
                  void run(async () => {
                    const link = await api("POST /api/people/:accountId/password-link", { params: { accountId: person.id } });
                    onLink({ title: `A new-password link for ${name}`, who: name, link, again: "to get another, make a new one here." });
                  }),
              },
              {
                id: "sign-out",
                label: "Sign out",
                icon: "undo",
                onSelect: () =>
                  void run(async () => {
                    await api("POST /api/people/:accountId/sign-out", { params: { accountId: person.id } });
                    notify({ tone: "neutral", title: `${name} is signed out`, body: "Every browser signed in as them is signed out. They can sign in again." });
                  }),
              },
              {
                id: "switch",
                label: person.disabled ? "Switch on" : "Switch off",
                icon: person.disabled ? "check" : "stop",
                onSelect: () =>
                  void run(async () => {
                    await api("PATCH /api/people/:accountId", { params: { accountId: person.id }, body: { disabled: !person.disabled } });
                    notify({ tone: "neutral", title: person.disabled ? `${name} can sign in again` : `${name} is switched off`, body: person.disabled ? undefined : "They can’t sign in until an owner switches them on. What they published keeps their name." });
                  }),
              },
              { kind: "separator", id: "sep" },
              { id: "remove", label: "Remove…", icon: "trash", tone: "danger", onSelect: () => onRemove(person) },
            ]}
            trigger={(props) => <IconButton {...props} icon="more" label={`What to do about ${name}`} size="sm" variant="quiet" disabled={busy} />}
          />
        )}
      </td>
    </tr>
  );
}

function InvitationRow({ invitation, onChanged, onProblem }: { invitation: Invitation; onChanged: () => void; onProblem: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="accounts-invitation">
      <span className="accounts-person">
        <span className="accounts-person__name">{invitation.email}</span>
        <span className="accounts-person__email">{`${roleName(invitation.role)} · invited by ${invitation.invitedBy} ${relativeTime(invitation.createdAt)} · ${invitation.emailed ? "e-mailed" : "sent by hand"} · stops working ${timeLeft(invitation.expiresAt)}`}</span>
      </span>
      <Button
        size="sm"
        variant="secondary"
        busy={busy}
        busyLabel="Taking back…"
        onClick={() => {
          setBusy(true);
          onProblem(null);
          api("DELETE /api/people/invitations/:invitationId", { params: { invitationId: invitation.id } })
            .then(() => notify({ tone: "neutral", title: "Invitation taken back", body: `The link sent to ${invitation.email} doesn’t work any more.` }))
            .catch((caught: unknown) => onProblem(errorShape(caught).message))
            .finally(() => {
              setBusy(false);
              onChanged();
            });
        }}
      >
        Take back
      </Button>
    </li>
  );
}

function SignEveryoneOut() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <div>
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Sign everyone out…
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Sign everyone out?"
        body="Every browser signed in to this editor is signed out, yours included. Everyone can sign in again with their own e-mail and password. Unpublished changes stay as they are."
        confirmLabel="Sign everyone out"
        cancelLabel="Keep everyone signed in"
        busyLabel="Signing out…"
        errorTitle="Couldn’t sign everyone out"
        onConfirm={async () => {
          await api("POST /api/people/sign-out");
          disconnectEvents();
          clearQueries();
          await useMeta.getState().load();
          navigate("/login", { replace: true });
        }}
      />
    </>
  );
}

export function PeopleSection() {
  const me = useAccount();
  const people = useQuery(peopleKey(), () => api("GET /api/people"));
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);
  const refresh = () => void people.refetch();
  const data = people.data;

  return (
    <Section id="people" title="People" description="Everyone who can sign in to this editor. Each person signs in with their own e-mail and password, and what they publish carries their name.">
      {people.loading ? (
        <Skeleton lines={4} height={14} />
      ) : people.status === "error" && !data ? (
        <ErrorState compact title="Couldn’t load the people" error={people.error} onRetry={refresh} />
      ) : data ? (
        <>
          {data.emailAvailable ? null : <p className="install-note">{NO_EMAIL_LINE}</p>}
          <table className="app-table accounts-table">
            <caption className="g-sr">People who can sign in</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Last signed in</th>
                <th scope="col">
                  <span className="g-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((person) => (
                <PersonRow key={person.id} person={person} me={person.id === me?.id} onChanged={refresh} onProblem={setProblem} onLink={setShown} onRemove={setRemoving} />
              ))}
            </tbody>
          </table>
          {problem ? <Problem>{problem}</Problem> : null}

          <h3 className="accounts-subtitle">Invite someone</h3>
          <InviteForm
            onInvited={(invitation, link) => {
              refresh();
              setShown({ title: `An invitation for ${invitation.email}`, who: invitation.email, link, again: "to send a new one, take this invitation back and invite them again." });
            }}
          />

          {data.invitations.length > 0 ? (
            <>
              <h3 className="accounts-subtitle">Open invitations</h3>
              <ul className="accounts-invitations">
                {data.invitations.map((invitation) => (
                  <InvitationRow key={invitation.id} invitation={invitation} onChanged={refresh} onProblem={setProblem} />
                ))}
              </ul>
            </>
          ) : null}

          <h3 className="accounts-subtitle">Sign everyone out</h3>
          <p className="install-note">For a lost laptop or a password that was shared too widely. Everyone signs in again with their own e-mail and password.</p>
          <SignEveryoneOut />
        </>
      ) : null}
      <LinkDialog shown={shown} onClose={() => setShown(null)} />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing ? personLabel(removing) : ""}?`}
        body="They can’t sign in any more, and any browser signed in as them is signed out. What they published keeps their name, in Version history and in the repository."
        confirmLabel={`Remove ${removing ? personLabel(removing) : ""}`}
        cancelLabel="Keep them"
        busyLabel="Removing…"
        errorTitle="Couldn’t remove them"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await api("DELETE /api/people/:accountId", { params: { accountId: removing.id } });
            notify({ tone: "neutral", title: `${personLabel(removing)} is removed` });
          } finally {
            refresh();
          }
        }}
      />
    </Section>
  );
}
