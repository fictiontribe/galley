/**
 * A hosted install manages exactly one site (`meta.install`). These are the
 * decisions that follow from that, kept pure so they can be tested without a
 * browser: where the address opens, and which routes a hosted screen must
 * never call. Local mode and the desktop app have no `meta.install` and keep
 * every multi-site screen exactly as before.
 */
import type { MetaInfo } from "@galley/core/types";
import type { InstallMeta } from "@galley/core/install/types";
import { loginUrl } from "./session";

/** The install this server is, when it is a hosted one. */
export function hostedInstall(meta: MetaInfo | null | undefined): InstallMeta | null {
  return meta?.mode === "hosted" && meta.install ? meta.install : null;
}

export function isHostedInstall(meta: MetaInfo | null | undefined): boolean {
  return hostedInstall(meta) !== null;
}

/** Where first run lives. */
export const SETUP_PATH = "/setup";

/**
 * First run was left half-way: the password is chosen, the rest isn't
 * finished, and nobody is signed in. Signing in — not the setup link, which
 * choosing the password used up — is the way on, and it leads back to
 * first run. False when the server doesn't say a password exists.
 */
export function resumesAfterSignIn(meta: MetaInfo | null | undefined): boolean {
  const install = hostedInstall(meta);
  return Boolean(install?.setupNeeded && install.passwordSet === true && !meta?.authenticated);
}

/**
 * Where `/` leads on a hosted install: first run while it isn't finished
 * (by way of sign-in when a password exists and nobody is signed in),
 * otherwise the site. Null on a local app (the Sites screen is home) and
 * when a signed-in hosted install has no site to show yet.
 */
export function hostedHome(meta: MetaInfo | null | undefined): string | null {
  const install = hostedInstall(meta);
  if (!install) return null;
  if (install.setupNeeded) return resumesAfterSignIn(meta) ? loginUrl(SETUP_PATH) : SETUP_PATH;
  if (!meta?.authenticated) return "/login";
  return install.siteId ? `/sites/${encodeURIComponent(install.siteId)}` : null;
}

/**
 * Routes that add, remove, scan, file or switch sites. A hosted server
 * refuses every one of them, so no hosted screen may call them.
 */
const MULTI_SITE: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "*", path: /^\/api\/groups(\/|$)/ },
  { method: "*", path: /^\/api\/sites\/(scan|add|open|clone|create)(\/|$)/ },
  { method: "*", path: /^\/api\/fs\/list$/ },
  { method: "*", path: /^\/api\/open$/ },
  { method: "PATCH", path: /^\/api\/sites\/[^/]+\/listing$/ },
  { method: "DELETE", path: /^\/api\/sites\/[^/]+$/ },
];

/** Whether a request (method + path, query ignored) is one a hosted install refuses. */
export function isMultiSiteRequest(method: string, url: string): boolean {
  const path = url.split("?")[0] ?? url;
  const verb = method.toUpperCase();
  return MULTI_SITE.some((rule) => (rule.method === "*" || rule.method === verb) && rule.path.test(path));
}

/**
 * Routes the one-time setup code is sent to: first run, starting an install
 * from a backup, and following that restore's job (before a password exists
 * there is no session to follow it with).
 */
export function carriesSetupCode(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return path === "/api/setup" || path.startsWith("/api/setup/") || path === "/api/install/restore" || path === "/api/install/restore/upload" || /^\/api\/jobs\/[^/]+$/.test(path);
}

/**
 * The code host's page where a key is added to the repository, worked out
 * from its address — the fallback for when the server hasn't said
 * (`DeployKeyInfo.addUrl` is only known once the repository is).
 */
export function keyPageFor(repository: string): string | null {
  const address = repository.trim();
  const match = /^(?:git@([^:]+):|ssh:\/\/git@([^/]+)\/|https?:\/\/(?:[^@/]+@)?([^/]+)\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(address);
  if (!match) return null;
  const host = (match[1] ?? match[2] ?? match[3] ?? "").toLowerCase();
  const owner = match[4];
  const name = match[5];
  if (!owner || !name) return null;
  if (host === "github.com") return `https://github.com/${owner}/${name}/settings/keys/new`;
  if (host === "gitlab.com") return `https://gitlab.com/${owner}/${name}/-/settings/repository`;
  if (host === "bitbucket.org") return `https://bitbucket.org/${owner}/${name}/admin/access-keys/`;
  return null;
}

/** The code host's name for an address, for "Open GitHub’s page". */
export function codeHostName(repository: string): string | null {
  const text = repository.toLowerCase();
  if (text.includes("github.com")) return "GitHub";
  if (text.includes("gitlab.com")) return "GitLab";
  if (text.includes("bitbucket.org")) return "Bitbucket";
  return null;
}

/**
 * Whether an address could be a repository address at all. Only what can
 * never be one is stopped here — whitespace inside, or a bare word with no
 * slash or colon. Everything else goes to the server, which is the judge of
 * what it can reach: a server started for a trial may allow a folder on its
 * own disk (/repos/site.git, file://…), and it says in its own words when it
 * doesn't.
 */
export function looksLikeRepository(repository: string): boolean {
  const address = repository.trim();
  return address.length > 0 && !/\s/.test(address) && /[/:]/.test(address);
}
