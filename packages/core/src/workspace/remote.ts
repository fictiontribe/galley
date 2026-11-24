/**
 * Everything about the code host on the other end of a remote: credential-free
 * display URLs, compare/pull-request URLs, and plain-language push errors.
 */
import { runCommand } from "./exec";

export type HostKind = "github" | "gitlab" | "bitbucket";

export interface RemoteLocation {
  host: string;
  /** "owner/repo" (GitLab: may include subgroups). */
  path: string;
  kind: HostKind | null;
}

/** A query value that signs in: `?access_token=…`, `&private_token=…`, `X-Amz-Signature=…`. The name is kept, the value goes. */
const SIGNING_VALUE = /([?&](?:[\w.-]*[_.-])?(?:token|secret|password|passwd|pwd|key|apikey|signature|sig|auth|credentials?)(?:[_.-][\w.-]*)?=)[^&\s'"#]+/gi;
/** Access keys of shapes that can be told apart from anything else, wherever they sit (a folder in an address, say). */
const KNOWN_KEYS = [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g, /\bglpat-[A-Za-z0-9_-]{16,}/g];

/**
 * Removes what signs in from the addresses in a text before it is shown or
 * returned anywhere: an address on its own, or every address inside a longer
 * message (git quotes the address it was using in the middle of what it
 * reports, and a failed command's details quote its arguments). Tokens
 * embedded in remote URLs are common.
 *
 * - `https://user:password@host`, `https://token@host`: everything before
 *   the host goes, up to the last `@` in front of it, so a password with an
 *   `@` of its own goes whole;
 * - `ssh://user:password@host` and other schemes: the password goes and the
 *   user stays (`ssh://git@host` is an address, not a secret);
 * - a query value whose name says it signs in;
 * - GitHub's and GitLab's own key formats, anywhere.
 *
 * A key of no known shape in the path of an address can't be told from a
 * folder name, and is left.
 */
export function redactRemoteUrl(text: string): string {
  let out = text
    .replace(/(\bhttps?:\/\/)[^\s/'"]*@/gi, "$1")
    .replace(/(\b(?!https?:)[a-z][a-z0-9+.-]*:\/\/[^\s/'":@]*):[^\s/'"]*@/gi, "$1@")
    .replace(SIGNING_VALUE, "$1");

  for (const key of KNOWN_KEYS) out = out.replace(key, "");
  return out;
}

export function parseRemoteUrl(url: string): RemoteLocation | null {
  let host: string | undefined;
  let path: string | undefined;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(url);

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);

      if (parsed.protocol === "file:") return null;
      host = parsed.hostname;
      path = decodeURIComponent(parsed.pathname);
    } catch {
      return null;
    }
  } else if (scp && !/^[a-zA-Z]$/.test(scp[1] ?? "")) {
    // scp-like ssh syntax: git@github.com:owner/repo.git (a single letter is a Windows drive).
    host = scp[1];
    path = scp[2];
  }
  if (!host || !path) return null;
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  if (!path.includes("/")) return null;
  const lower = host.toLowerCase();
  const kind: HostKind | null = lower.includes("github")
    ? "github"
    : lower.includes("gitlab")
      ? "gitlab"
      : lower.includes("bitbucket")
        ? "bitbucket"
        : null;

  return { host: lower.replace(/^ssh\./, ""), path, kind };
}

/** The host's "open a pull request" page for `head` into `base`, when the host is recognised. */
export function compareUrl(remoteUrl: string, base: string, head: string): string | undefined {
  const location = parseRemoteUrl(remoteUrl);

  if (!location?.kind) return undefined;
  const origin = `https://${location.host}/${location.path}`;
  const b = encodeURIComponent(base);
  const h = encodeURIComponent(head);

  switch (location.kind) {
    case "github":
      return `${origin}/compare/${b}...${h}?expand=1`;
    case "gitlab":
      return `${origin}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${h}&merge_request%5Btarget_branch%5D=${b}`;
    case "bitbucket":
      return `${origin}/pull-requests/new?source=${h}&dest=${b}`;
  }
}

/**
 * Opens a pull request with the GitHub CLI when it is installed and signed in
 * for that host. Returns the PR URL, or undefined so the caller falls back to
 * the compare URL. Never throws.
 */
export async function createPullRequestWithGh(input: {
  cwd: string;
  remoteUrl: string;
  base: string;
  head: string;
  title: string;
  body: string;
}): Promise<string | undefined> {
  const location = parseRemoteUrl(input.remoteUrl);

  if (location?.kind !== "github") return undefined;
  const env = { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" };
  const auth = await runCommand("gh", ["auth", "status", "--hostname", location.host], {
    cwd: input.cwd,
    env,
    timeoutMs: 15_000,
  });

  if (auth.spawnError || auth.code !== 0) return undefined;
  const created = await runCommand(
    "gh",
    [
      "pr", "create",
      "--repo", `${location.host}/${location.path}`,
      "--head", input.head,
      "--base", input.base,
      "--title", input.title,
      "--body", input.body,
    ],
    { cwd: input.cwd, env, timeoutMs: 60_000 }
  );

  if (created.code !== 0) return undefined;
  const url = /https?:\/\/\S+/.exec(created.stdout.toString("utf8"))?.[0];

  return url?.trim();
}

/** Plain words for why a push did not go through. */
export function classifyPushError(stderr: string, timedOut: boolean): string {
  if (timedOut) {
    return "Couldn't reach the code host in time. Your change is saved on this computer — check your connection and publish again.";
  }
  if (/\[rejected\]|non-fast-forward|fetch first|\(stale info\)|Updates were rejected/i.test(stderr)) {
    return "Someone else published at the same moment, so this version didn't reach the site's host. It's saved here, and your work is safe. A developer needs to combine the two versions before it can be sent.";
  }
  if (/protected branch|GH006|pre-receive hook declined|not allowed to push|push declined/i.test(stderr)) {
    return "The code host doesn't allow publishing straight to the live site here. Choose “Send for review” in the site's publishing settings instead.";
  }
  if (
    /Authentication failed|could not read Username|could not read Password|terminal prompts disabled|Permission denied|access denied|denied to|returned error: 40[13]|HTTP 40[13]|Invalid username or password|publickey/i.test(
      stderr
    )
  ) {
    return "The code host didn't accept your sign-in. Make sure you're signed in to it on this computer, then publish again.";
  }
  if (
    /Could not resolve host|unable to access|Connection refused|Connection timed out|Operation timed out|Network is unreachable|Could not read from remote repository|Connection reset|SSL|TLS/i.test(
      stderr
    )
  ) {
    return "Couldn't reach the code host. Your change is saved on this computer — check your connection and publish again.";
  }
  if (/does not appear to be a git repository|repository not found|not found/i.test(stderr)) {
    return "The site's code host address doesn't point at a repository you can publish to. Check the site's connection settings.";
  }
  return "Your change is saved on this computer, but sending it to the code host didn't work. Try publishing again in a moment.";
}
