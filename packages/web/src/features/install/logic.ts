/**
 * The hosted install's screens, decided without a browser: what first run
 * shows next, what a repository check means in plain words, what a
 * password needs. Copy follows brand/voice.md — "the repository", "key",
 * "version", "the server"; never commit, branch, deploy or container.
 */
import { MIN_INSTALL_PASSWORD_LENGTH, type InstallFixed, type SetupStatus, type SiteAccess, type SiteAccessCheck, type SiteConnectRequest } from "@galley/core/install/types";

// ─────────────────────────────────────────────────────────────── first run

/** The numbered steps of first run, as the step list shows them. */
export const SETUP_STEPS = [
  { id: "password", label: "Your account" },
  { id: "site", label: "Site" },
  { id: "details", label: "Details" },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]["id"];

/** Why /setup can't go on, when the server refused to say where first run is. */
export type SetupBlock =
  /** Opened without the setup link and without being signed in. */
  | "no-link"
  /** The link's code was refused: used up, or not this install's. */
  | "bad-link";

/** A refusal of GET /api/setup, read as what the person should do. */
export function setupBlock(status: number, hadCode: boolean): SetupBlock | null {
  if (status !== 401 && status !== 403) return null;
  return hadCode ? "bad-link" : "no-link";
}

/** A new password's problem, or null when it will do. Typed twice: see SetupScreen's PasswordStep. */
export function passwordProblem(password: string, again: string): string | null {
  if (password.length < MIN_INSTALL_PASSWORD_LENGTH) return `Use at least ${MIN_INSTALL_PASSWORD_LENGTH} characters.`;
  if (again !== password) return "The two passwords don’t match. Type the same one twice.";
  return null;
}

/** A backup passphrase's problem, or null. It seals stored keys, so it is held to the password's length. */
export function passphraseProblem(passphrase: string, again: string): string | null {
  if (passphrase.length < MIN_INSTALL_PASSWORD_LENGTH) return `Use at least ${MIN_INSTALL_PASSWORD_LENGTH} characters.`;
  if (again !== passphrase) return "The two passphrases don’t match. Type the same one twice.";
  return null;
}

export type SiteSource = "existing" | "starter";

/** What the "Connect the site" form holds. The access token is kept apart: it never goes into storage. */
export interface SiteDraft {
  source: SiteSource;
  repository: string;
  /** The folder inside the repository that holds the site; empty: the top. */
  folder: string;
  access: "deploy-key" | "token";
  starter: string | null;
  look: string | null;
  name: string;
}

export function emptySiteDraft(): SiteDraft {
  return { source: "existing", repository: "", folder: "", access: "deploy-key", starter: null, look: null, name: "" };
}

/** The request body for check and connect. */
export function connectRequest(draft: SiteDraft, token: string): SiteConnectRequest {
  const request: SiteConnectRequest = { repository: draft.repository.trim(), access: draft.access };
  // A starter always goes to the top of an empty repository. Otherwise the folder is said every time — empty for the top — so it can't be dropped on the way.
  if (draft.source === "existing") request.folder = draft.folder.trim();
  if (draft.access === "token") request.token = token.trim();
  if (draft.source === "starter" && draft.starter) {
    request.starter = { id: draft.starter, ...(draft.look ? { look: draft.look } : {}), ...(draft.name.trim() ? { name: draft.name.trim() } : {}) };
  }
  return request;
}

/** What still stops the form from being checked or connected, or null. */
export function siteDraftProblem(draft: SiteDraft, token: string, looksLikeRepository: (address: string) => boolean): string | null {
  if (!draft.repository.trim()) return "Paste the repository’s address.";
  if (!looksLikeRepository(draft.repository)) return "That doesn’t look like a repository address. It should look like git@github.com:you/site.git or https://github.com/you/site.";
  if (draft.source === "starter" && !draft.starter) return "Choose a starter.";
  if (draft.access === "token" && !token.trim()) return "Paste the access token.";
  return null;
}

export type CheckTone = "success" | "warning" | "danger";

/** A repository check in plain words, with how far it lets the person go. */
export function describeCheck(check: SiteAccessCheck, source: SiteSource, access: SiteAccess): { tone: CheckTone; text: string; canConnect: boolean } {
  if (!check.reachable) {
    const fallback =
      access === "deploy-key"
        ? "The repository didn’t answer this editor’s key. Add the key to the repository with write access, then check again."
        : "The repository didn’t accept the access token. Check the address, and that the token can read and write this repository.";
    return { tone: "danger", text: check.message ?? fallback, canConnect: false };
  }
  if (check.writable === false) {
    return {
      tone: "danger",
      text: check.message ?? (access === "deploy-key" ? "The repository can be read, but it won’t accept changes from this editor. Allow write access for the key, then check again." : "The repository can be read, but the access token can’t send changes to it. Give it write access, then check again."),
      canConnect: false,
    };
  }
  if (source === "starter" && !check.empty) {
    return { tone: "danger", text: "This repository already holds a site. A starter needs an empty repository — make a new one, or connect this one as it is.", canConnect: false };
  }
  if (source === "existing" && check.empty) {
    return { tone: "warning", text: "This repository is empty, so there’s no site in it to edit. To begin one, choose Start from a starter.", canConnect: false };
  }
  const writable = check.writable === null ? " Whether it accepts changes shows the first time you publish." : " It will accept changes from this editor.";
  return { tone: check.message ? "warning" : "success", text: check.message ?? `The repository answered.${writable}`, canConnect: true };
}

/** How the install reaches its repository, as a person reads it. */
export function accessWords(access: SiteAccess): string {
  if (access === "deploy-key") return "This editor’s own key";
  if (access === "token") return "An access token from the code host";
  return "Not connected yet";
}

/** Whether something was set by whoever runs the server (and so can't be changed in the app). */
export function isFixed(fixed: InstallFixed[] | undefined, what: InstallFixed): boolean {
  return Boolean(fixed?.includes(what));
}

/** The body of PUT /api/setup/details: only what isn't fixed, only what changed (an emptied address is cleared). */
export function detailsRequest(status: Pick<SetupStatus, "fixed" | "liveUrl">, form: { name: string; email: string; liveUrl: string }): { author?: { name: string; email: string }; liveUrl?: string | null } {
  const body: { author?: { name: string; email: string }; liveUrl?: string | null } = {};
  if (!isFixed(status.fixed, "author")) body.author = { name: form.name.trim(), email: form.email.trim() };
  if (!isFixed(status.fixed, "liveUrl")) {
    const next = form.liveUrl.trim() || null;
    if (next !== (status.liveUrl ?? null)) body.liveUrl = next;
  }
  return body;
}

/** What's wrong with the details form, field by field. */
export function detailsProblems(status: Pick<SetupStatus, "fixed">, form: { name: string; email: string; liveUrl: string }): { name?: string; email?: string; liveUrl?: string } {
  const problems: { name?: string; email?: string; liveUrl?: string } = {};
  if (!isFixed(status.fixed, "author")) {
    if (!form.name.trim()) problems.name = "Enter the name to publish under.";
    if (!form.email.trim()) problems.email = "Enter the email to publish under.";
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) problems.email = "That email address is missing something. It should look like name@example.com.";
  }
  const live = form.liveUrl.trim();
  if (live && !isFixed(status.fixed, "liveUrl") && !/^https?:\/\/[^\s/]+/.test(live)) problems.liveUrl = "Start the address with https://, like https://www.example.com.";
  return problems;
}

// ─────────────────────────────────────────────────────────────── the Install page

/** "site-backup-2026-11-23.bin" when the server doesn't name the file. */
export function backupFileName(disposition: string | null, slug: string, now: Date = new Date()): string {
  const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null;
  if (match?.[1]) return decodeURIComponent(match[1]);
  const day = now.toISOString().slice(0, 10);
  return `${slug}-backup-${day}.bin`;
}
