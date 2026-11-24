/**
 * People on a hosted install, decided without a browser: what sign-in sends,
 * what a one-time link's address carries, what a name or e-mail needs, and
 * how long a link stays good, in plain words.
 */
import type { InstallMeta } from "@galley/core/install/types";
import { LINK_PATHS, type LinkPreview } from "@galley/core/install/accounts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The body of POST /api/auth/login: the e-mail goes along only when the install signs in with one. */
export function loginBody(signInWith: InstallMeta["signInWith"], email: string, password: string): { password: string; email?: string } {
  return signInWith === "email" ? { email: email.trim().toLowerCase(), password } : { password };
}

/** What still stops sign-in, or null. */
export function loginProblem(signInWith: InstallMeta["signInWith"], email: string, password: string): string | null {
  if (signInWith === "email" && !email.trim()) return "Enter your e-mail and password.";
  if (!password) return signInWith === "email" ? "Enter your e-mail and password." : "Enter the password.";
  return null;
}

export function emailProblem(email: string): string | null {
  if (!email.trim()) return "Enter an e-mail address.";
  if (!EMAIL.test(email.trim())) return "That e-mail address is missing something. It should look like name@example.com.";
  return null;
}

export function nameProblem(name: string): string | null {
  return name.trim() ? null : "Enter a name. It goes with everything published under it.";
}

/** Which one-time link page an address is, or null. */
export function linkKindAt(pathname: string): LinkPreview["kind"] | null {
  if (pathname === LINK_PATHS.invitation) return "invitation";
  if (pathname === LINK_PATHS.password) return "password";
  return null;
}

/** The code a one-time link carries in its fragment (`/join#<code>`), or null. */
export function codeFromHash(hash: string): string | null {
  const code = decodeURIComponent(hash.replace(/^#/, "")).trim();
  return code ? code : null;
}

/** "in 7 days", "in 45 minutes": how long a link has left, for a sentence. */
export function timeLeft(expiresAt: string, now: number = Date.now()): string {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes <= 1 ? "1 minute" : `${minutes} minutes`}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours === 1 ? "1 hour" : `${hours} hours`}`;
  const days = Math.round(hours / 24);
  return `in ${days} days`;
}

/** Who someone is, for a line of text: their name, else their e-mail. */
export function personLabel(person: { name: string; email: string }): string {
  return person.name || person.email || "The first owner";
}

/** Two letters for the account button. */
export function initials(person: { name: string; email: string }): string {
  const words = person.name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words[words.length - 1]?.[0] ?? ""}`.toUpperCase();
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return (person.email[0] ?? "?").toUpperCase();
}

interface AddressBar {
  pathname: string;
  search: string;
  hash: string;
}

interface PageHistory {
  state: unknown;
  replaceState(state: unknown, unused: string, url: string): void;
}

let taken: { path: string; code: string | null } | null = null;

/**
 * Take a one-time link's code out of the address bar, once, and remember it
 * for the page that uses it. Replacing the address (rather than navigating)
 * keeps the code out of the browser's history too; asking again on the same
 * page — React may render a screen twice — gives the same code.
 */
export function takeLinkCode(address?: AddressBar, past?: PageHistory): string | null {
  // Written against the parts it uses, so the same code runs (and is checked) without a browser.
  const browser = globalThis as unknown as { location: AddressBar; history: PageHistory };
  const location = address ?? browser.location;
  const history = past ?? browser.history;
  if (location.hash) {
    const code = codeFromHash(location.hash);
    const path = location.pathname;
    history.replaceState(history.state, "", path + location.search);
    taken = { path, code };
    return code;
  }
  return taken && taken.path === location.pathname ? taken.code : null;
}

/**
 * What an account that isn't complete is asked for: both details (the owner
 * of an install from before accounts, who has neither), or only a name
 * (someone who has an e-mail: they accepted an invitation with a name
 * someone here already has, or their name held nothing a reader can see).
 */
export function completeKind(account: { name: string; email: string }): "details" | "name" {
  return account.email && !account.name ? "name" : "details";
}

