/**
 * Repository addresses as a hosted install takes them: one cleaned address
 * that never carries a credential, in the form its access needs (a deploy
 * key talks SSH, an access key talks HTTPS).
 */
import { isAbsolute } from "node:path";
import { GalleyError } from "../errors";
import { parseRemoteUrl, type HostKind } from "../workspace/remote";

export type AddressKind = "ssh" | "https" | "local";

export interface RepositoryAddress {
  /** The address to hand git, with any user:password@ removed (an SSH user such as `git@` stays). */
  url: string;
  kind: AddressKind;
  /** github / gitlab / bitbucket when the host is one of them. */
  host: HostKind | null;
  /** A credential that was pasted inside an https:// address, cut out of `url`. Never stored as part of the address. */
  embeddedSecret: string | null;
}

const KNOWN_HOSTS: Record<HostKind, string> = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" };

/** Removes credentials from anything that looks like an address, for showing it. */
export function redactAddress(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/i, (whole, scheme: string) => {
    // ssh://git@host keeps its user name: it isn't a secret, and the address doesn't work without it.
    const user = whole.slice(scheme.length, -1);

    return /^ssh/i.test(scheme) && !user.includes(":") ? whole : scheme;
  });
}

function classify(raw: string): { kind: AddressKind; url: string; embeddedSecret: string | null } | null {
  if (/^file:\/\//i.test(raw) || isAbsolute(raw)) return { kind: "local", url: raw, embeddedSecret: null };
  if (/^https?:\/\//i.test(raw)) {
    let parsed: URL;

    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    const secret = parsed.password ? decodeURIComponent(parsed.password) : parsed.username && !parsed.password ? decodeURIComponent(parsed.username) : null;

    parsed.username = "";
    parsed.password = "";
    return { kind: "https", url: parsed.toString(), embeddedSecret: secret };
  }
  if (/^ssh:\/\//i.test(raw)) return { kind: "ssh", url: raw, embeddedSecret: null };
  // scp-like: git@github.com:owner/name.git (a one-letter "host" is a Windows drive).
  if (/^(?:[^@/\s:]+@)?[^:/\s]{2,}:(?!\/\/)\S+$/.test(raw)) return { kind: "ssh", url: raw, embeddedSecret: null };
  return null;
}

/**
 * The address in the form `access` needs. A deploy key needs SSH and an
 * access key HTTPS; for GitHub, GitLab and Bitbucket the other form is
 * converted, for any other host the person is told which address to copy.
 * Local folders and file:// addresses are refused unless `allowLocal`
 * (they would let the editor read any repository on the server's disk).
 */
export function normalizeRepository(input: unknown, access: "deploy-key" | "token" | "none", options: { allowLocal?: boolean } = {}): RepositoryAddress {
  const raw = typeof input === "string" ? input.trim() : "";

  if (!raw) throw new GalleyError("invalid", "Paste the repository's address, for example git@github.com:you/site.git.");
  // A value starting with "-" would be read by git as an option; ext:: runs a command.
  if (raw.startsWith("-") || /^ext::/i.test(raw) || /[\0\r\n]/.test(raw) || raw.length > 2048) {
    throw new GalleyError("invalid", "That doesn't look like a repository address.");
  }
  const found = classify(raw);

  if (!found) throw new GalleyError("invalid", "That doesn't look like a repository address. Copy it from the code host: it starts with git@ or https://.");
  if (found.kind === "local") {
    if (!options.allowLocal) {
      throw new GalleyError("invalid", "Use the repository's address on the code host (it starts with git@ or https://). Folders on this server can't be used.");
    }
    return { url: found.url, kind: "local", host: null, embeddedSecret: null };
  }
  const location = parseRemoteUrl(found.url);
  const host = location?.kind ?? null;
  const path = location?.path ?? null;

  if (access === "deploy-key" && found.kind === "https") {
    if (host && path && location?.host === KNOWN_HOSTS[host]) {
      return { url: `git@${KNOWN_HOSTS[host]}:${path}.git`, kind: "ssh", host, embeddedSecret: found.embeddedSecret };
    }
    throw new GalleyError("invalid", "This editor's own key works with the repository's SSH address, which starts with git@. Copy that address from the code host, or connect with an access key instead.");
  }
  if (access === "token" && found.kind === "ssh") {
    if (host && path && location?.host === KNOWN_HOSTS[host]) {
      return { url: `https://${KNOWN_HOSTS[host]}/${path}.git`, kind: "https", host, embeddedSecret: null };
    }
    throw new GalleyError("invalid", "An access key works with the repository's https:// address. Copy that address from the code host, or connect with this editor's own key instead.");
  }
  return { url: found.url, kind: found.kind, host, embeddedSecret: found.embeddedSecret };
}

/** The code host's page for adding a deploy key to this repository, when the address makes it plain. */
export function deployKeyPage(url: string | null): string | undefined {
  if (!url) return undefined;
  const location = parseRemoteUrl(url);

  if (!location?.kind || location.host !== KNOWN_HOSTS[location.kind]) return undefined;
  const base = `https://${location.host}/${location.path}`;

  switch (location.kind) {
    case "github":
      return `${base}/settings/keys/new`;
    case "gitlab":
      return `${base}/-/settings/repository#js-deploy-keys-settings`;
    case "bitbucket":
      return `${base}/admin/access-keys/`;
  }
}

/** The user name each code host expects beside an access key over HTTPS. */
export function tokenUserName(host: HostKind | null): string {
  if (host === "gitlab") return "oauth2";
  if (host === "bitbucket") return "x-token-auth";
  return "x-access-token";
}
