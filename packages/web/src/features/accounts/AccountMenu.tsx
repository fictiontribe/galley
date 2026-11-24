/**
 * Who is signed in, at the end of the top bar on a hosted install with
 * accounts: their initials and name, opening a menu with Your account and
 * Sign out. Nothing at all where there are no accounts.
 */
import { useNavigate } from "react-router-dom";
import { errorShape } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { roleName, useAccount } from "@/lib/may";
import { notify } from "@/lib/stores/toasts";
import { Menu } from "@/ui";
import { initials, personLabel } from "./logic";
import "./accounts.css";

export function AccountMenu() {
  const account = useAccount();
  const navigate = useNavigate();
  if (!account) return null;
  const who = personLabel(account);
  return (
    <Menu
      label="Your account"
      placement="bottom-end"
      items={[
        { kind: "heading", id: "who", label: `${who} · ${roleName(account.role)}` },
        { id: "account", label: "Your account", icon: "person", onSelect: () => navigate("/account") },
        { kind: "separator", id: "sep" },
        {
          id: "sign-out",
          label: "Sign out",
          onSelect: () =>
            void signOut()
              .then(() => navigate("/login", { replace: true }))
              .catch((caught: unknown) => notify({ tone: "danger", title: "Couldn’t sign out", body: errorShape(caught).message })),
        },
      ]}
      trigger={(props) => (
        <button type="button" className="accounts-menu" title={`Signed in as ${who}`} aria-label={`Signed in as ${who}. Your account`} {...props}>
          <span className="accounts-menu__initials" aria-hidden="true">
            {initials(account)}
          </span>
          <span className="accounts-menu__name app-hide-narrow">{who}</span>
        </button>
      )}
    />
  );
}
