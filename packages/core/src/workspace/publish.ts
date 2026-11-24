/**
 * Publish, version history, undoing a publish, and pulling the latest.
 *
 * Publish never force-pushes and never rewrites history. A failed push keeps
 * the commit and says why in plain words. Pull-request mode builds its commit
 * in a temporary index and never checks anything out, so the user's other
 * pending changes are never touched, stashed or put at risk.
 */
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import { isSiteSettingsPath, requireSiteSettings } from "../install/caller";
import type { ChangeOrigin, GitStatus, HistoryEntry, PublishConfig, PublishRequest, PublishResult } from "../types";
import type { PendingStatus } from "./changes";
import { GIT_NETWORK_TIMEOUT_MS, splitNul, type Git, type RepoInfo } from "./git";
import { normalizeRepoPath } from "./paths";
import { deniedReason } from "./policy";
import { classifyPushError, compareUrl, createPullRequestWithGh, redactRemoteUrl } from "./remote";
import type { AuthorSource } from "./author";

export interface Identity {
  name: string;
  email: string;
}

/** What publish needs from the workspace around it. */
export interface RepoHost {
  root: string;
  repo: Git;
  info(): Promise<RepoInfo | null>;
  /** Fresh pending statuses (full refresh of the cache). */
  statuses(): Promise<Map<string, PendingStatus>>;
  /** Who a publish is recorded as, and which setting said so (workspace/author.ts). */
  identity(): Promise<Identity & { from?: AuthorSource }>;
  /** Refresh the status cache for these paths and tell listeners. */
  changed(paths: string[], origin: ChangeOrigin): Promise<void>;
  /** Put paths back to their HEAD version (deleting ones HEAD lacks), without emitting. */
  restoreToHead(paths: string[]): Promise<string[]>;
}

const TRAILER = `${PRODUCT.commitTrailer}: 1`;
const TRAILER_LINE = new RegExp(`^${PRODUCT.commitTrailer}:\\s*\\S+\\s*$`, "m");
const HOOK_TIMEOUT_MS = 5 * 60_000;
const CHUNK = 200;

export const NOT_A_REPO =
  "This folder isn't set up for publishing yet, so there's nowhere to publish to. Nothing was changed, and you can still edit and preview. A developer can connect it to a code host.";
const DETACHED =
  "The site is showing an older version right now, so there's nowhere to publish. Your edits are safe. Ask a developer to switch it back to the latest version, then try again.";
const BEHIND =
  "The live site has newer changes than this copy, so publishing is paused and nothing was overwritten. Your edits are safe. Get the latest versions, then publish again.";

/** "Publishing goes to one line of work, the site is on another" — the names are for whoever fixes it. */
function wrongLine(configured: string, current: string): PublishResult {
  return failure(
    [],
    "The site is set to publish from a different copy of its history than the one open now, so nothing was published. Your edits are safe. Ask a developer to switch it back, or change where publishing goes in the site settings.",
    `publish.branch is “${configured}”; the checkout is on “${current}”.`
  );
}

function failure(files: string[], error: string, detail?: string): PublishResult {
  return { ok: false, files, pushed: false, error, ...(detail ? { detail } : {}) };
}

/** Paths never committed by the app, whatever the user selects: secrets and installed packages. */
function neverPublish(path: string): boolean {
  const lower = path.toLowerCase().split("/");
  const name = lower[lower.length - 1] ?? "";

  return lower.includes(".git") || lower.includes("node_modules") || name === ".env" || name.startsWith(".env.");
}

function cleanIdentityPart(value: string): string {
  return value.replace(/[<>\r\n\0]/g, "").trim();
}

function identityConfig(identity: Identity): string[] {
  return [`user.name=${cleanIdentityPart(identity.name)}`, `user.email=${cleanIdentityPart(identity.email)}`];
}

function authorArg(identity: Identity): string {
  return `--author=${cleanIdentityPart(identity.name)} <${cleanIdentityPart(identity.email)}>`;
}

function withTrailer(message: string): string {
  const body = message.trim();

  return TRAILER_LINE.test(body) ? body : `${body}\n\n${TRAILER}`;
}

function defaultMessage(files: string[]): string {
  if (files.length === 1) {
    const path = files[0] ?? "";

    return `Update ${path.slice(path.lastIndexOf("/") + 1)}`;
  }
  return `Update ${files.length} files`;
}

async function composeMessage(
  requested: string | undefined,
  describe: ((files: string[]) => Promise<string> | string) | undefined,
  files: string[]
): Promise<string> {
  const explicit = requested?.trim();

  if (explicit) return explicit;
  if (describe) {
    try {
      const described = (await describe(files))?.trim();

      if (described) return described;
    } catch {
      // A failing describer must not block publishing; the default is fine.
    }
  }
  return defaultMessage(files);
}

/** Run a path-taking git command in chunks so a big selection cannot exceed the argument limit. */
async function runChunked(
  repo: Git,
  args: string[],
  paths: string[],
  options: { env?: Record<string, string>; allowFailure?: boolean } = {}
): Promise<void> {
  for (let i = 0; i < paths.length; i += CHUNK) {
    await repo.run([...args, "--", ...paths.slice(i, i + CHUNK)], options);
  }
}

/**
 * Stage exactly these paths, deletions included. Files still on disk go
 * through `add -A`; files gone from disk are removed from the index with
 * `rm --cached --ignore-unmatch`, which also copes with a deletion the user
 * already staged (where `add` would fail with "did not match").
 */
async function stagePaths(repo: Git, root: string, paths: string[], env?: Record<string, string>): Promise<void> {
  // lstat, not exists: a symlink is staged as a link even when its target is missing.
  const onDisk = (p: string) => {
    try {
      lstatSync(join(root, ...p.split("/")));
      return true;
    } catch {
      return false;
    }
  };
  const present = paths.filter(onDisk);
  const gone = paths.filter((p) => !present.includes(p));

  await runChunked(repo, ["add", "-A"], present, { env });
  await runChunked(repo, ["rm", "--cached", "-r", "-q", "--ignore-unmatch"], gone, { env });
}

function operationInProgress(info: RepoInfo): boolean {
  return ["MERGE_HEAD", "REVERT_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply"].some((name) =>
    existsSync(join(info.gitDir, name))
  );
}

const IN_PROGRESS =
  "The site's version history is in the middle of another operation that was started outside the app. Finish or cancel it there, then try again.";

function sitePath(info: RepoInfo, repoPath: string): string | null {
  if (!info.prefix) return repoPath;
  return repoPath.startsWith(info.prefix) ? repoPath.slice(info.prefix.length) || null : null;
}

function kebab(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

async function remoteFor(repo: Git, config: PublishConfig): Promise<string | null> {
  if (!config.remote) return null;
  const remotes = await repo.remotes();

  return remotes.includes(config.remote) ? config.remote : null;
}

interface PushOutcome {
  pushed: boolean;
  pushError?: string;
  detail?: string;
}

async function push(repo: Git, remote: string, source: string, target: string): Promise<PushOutcome> {
  const result = await repo.run(["push", remote, `${source}:refs/heads/${target}`], {
    allowFailure: true,
    timeoutMs: GIT_NETWORK_TIMEOUT_MS,
  });

  if (result.code === 0) return { pushed: true };
  return {
    pushed: false,
    pushError: classifyPushError(result.stderr, result.timedOut),
    detail: redactRemoteUrl(result.stderr.trim()),
  };
}

/**
 * How many versions the code host has on the branch that this copy doesn't.
 * 0 when it can't tell (offline, the branch isn't there yet): the push then
 * reports whatever is wrong.
 */
async function behindRemote(repo: Git, remote: string, branch: string): Promise<number> {
  const fetched = await repo.run(["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], {
    allowFailure: true,
    timeoutMs: GIT_NETWORK_TIMEOUT_MS,
  });

  if (fetched.code !== 0) return 0;
  const count = await repo.run(["rev-list", "--count", `HEAD..refs/remotes/${remote}/${branch}`], { allowFailure: true, readOnly: true });

  return count.code === 0 ? Number(count.text.trim()) || 0 : 0;
}

function hookFailureDetail(stdout: string, stderr: string): string {
  return [stderr.trim(), stdout.trim()].filter(Boolean).join("\n").slice(-8000);
}

// ─────────────────────────────────────────────────────────────── publish

export async function publish(
  host: RepoHost,
  request: PublishRequest,
  config: PublishConfig,
  describe?: (files: string[]) => Promise<string> | string
): Promise<PublishResult> {
  const { repo } = host;
  const info = await host.info();

  if (!info) return failure([], NOT_A_REPO);
  const branch = await repo.currentBranch();

  if (!branch) return failure([], DETACHED);
  if (operationInProgress(info)) return failure([], IN_PROGRESS);

  const statuses = await host.statuses();
  let files: string[];

  if (request.paths && request.paths.length > 0) {
    const wanted = [...new Set(request.paths.map((p) => normalizeRepoPath(p)))];

    files = wanted.filter((p) => statuses.has(p));
    if (files.length === 0) return failure([], "None of those files have changes to publish.");
  } else {
    files = [...statuses.keys()];
  }
  files = files.filter((p) => !neverPublish(p)).sort();
  if (files.length === 0) return failure([], "There's nothing to publish.");

  const message = withTrailer(await composeMessage(request.message, describe, files));
  const identity = await host.identity();
  const mode = request.mode ?? config.mode;

  if (mode === "pull-request") return publishPullRequest(host, info, branch, files, message, identity, config);

  if (config.branch && config.branch !== branch) return { ...wrongLine(config.branch, branch), files };
  const head = await repo.head();
  const sendTo = config.push ? await remoteFor(repo, config) : null;

  // Publishing on top of an old copy makes a version the code host refuses, which then needs a developer to
  // combine with the newer one. Pausing first, while nothing is committed, keeps "Get the latest" a working way out.
  if (sendTo && head && (await behindRemote(repo, sendTo, branch)) > 0) return { ...failure(files, BEHIND), behind: true };

  await stagePaths(repo, host.root, files);
  const commit = await repo.run(
    [
      "commit", "--only", "--cleanup=whitespace", "-m", message, authorArg(identity),
      "--pathspec-from-file=-", "--pathspec-file-nul",
    ],
    { config: identityConfig(identity), input: `${files.join("\0")}\0`, allowFailure: true, timeoutMs: HOOK_TIMEOUT_MS }
  );

  if (commit.code !== 0) {
    // Leave the index the way we found it: our paths are unstaged again, the
    // files themselves are untouched.
    if (head) await runChunked(repo, ["reset", "-q", "HEAD"], files, { allowFailure: true });
    else await runChunked(repo, ["rm", "--cached", "-r", "-q", "--ignore-unmatch"], files, { allowFailure: true });
    const output = `${commit.text}\n${commit.stderr}`;

    if (/nothing to commit|no changes added to commit|nothing added to commit/i.test(output)) {
      return failure(files, "There's nothing to publish — these files match the last published version.");
    }
    if (commit.timedOut) {
      return failure(files, "The site's own checks took too long, so nothing was published. Try again.", hookFailureDetail(commit.text, commit.stderr));
    }
    return failure(
      files,
      "The site's own checks stopped the publish, so nothing was published. Fix what they report, then try again.",
      hookFailureDetail(commit.text, commit.stderr)
    );
  }
  const sha = (await repo.head()) ?? undefined;

  await host.changed(files, "publish");
  const remote = await remoteFor(repo, config);

  if (!config.push || !remote) return { ok: true, commit: sha, branch, files, pushed: false };
  const pushed = await push(repo, remote, "HEAD", branch);

  return { ok: true, commit: sha, branch, files, ...pushed };
}

async function publishPullRequest(
  host: RepoHost,
  info: RepoInfo,
  currentBranch: string,
  files: string[],
  message: string,
  identity: Identity,
  config: PublishConfig
): Promise<PublishResult> {
  const { repo } = host;
  const head = await repo.head();

  if (!head) {
    return failure(files, "The very first version of a site can't be sent for review. Publish it directly once; after that, sending for review works.");
  }
  const remote = await remoteFor(repo, config);

  if (!remote) {
    return failure(files, "Sending for review needs the site to be connected to a code host, and this one isn't. Publish directly instead, or ask a developer to connect it.");
  }
  const base = config.branch || currentBranch;
  const indexFile = join(tmpdir(), `${PRODUCT.slug}-index-${randomBytes(6).toString("hex")}`);
  const indexEnv = { GIT_INDEX_FILE: indexFile };
  let commit: string;

  try {
    await repo.run(["read-tree", "HEAD"], { env: indexEnv });
    await stagePaths(repo, host.root, files, indexEnv);
    const tree = (await repo.run(["write-tree"], { env: indexEnv })).text.trim();
    const name = cleanIdentityPart(identity.name);
    const email = cleanIdentityPart(identity.email);

    commit = (
      await repo.run(["commit-tree", tree, "-p", head, "-m", message], {
        env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email },
      })
    ).text.trim();
  } finally {
    await rm(indexFile, { force: true });
    await rm(`${indexFile}.lock`, { force: true });
  }
  const subject = message.split("\n")[0] ?? "";
  let branchName = `${PRODUCT.slug}/${kebab(subject) || "update"}-${commit.slice(0, 7)}`;
  const valid = await repo.run(["check-ref-format", "--branch", branchName], { allowFailure: true, readOnly: true });

  if (valid.code !== 0) branchName = `${PRODUCT.slug}/update-${commit.slice(0, 7)}`;
  await repo.run(["branch", branchName, commit]);

  const pushed = await push(repo, remote, `refs/heads/${branchName}`, branchName);

  if (!pushed.pushed) {
    // The changes stay in the working tree, so nothing is lost; the local
    // branch is kept so a developer can push it by hand.
    return { ok: true, commit, branch: branchName, files, ...pushed };
  }
  // The changes now live on the pull-request branch; take them out of this
  // checkout so the working tree matches the branch it is on.
  await host.restoreToHead(files);
  await host.changed(files, "publish");
  const remoteUrl = (await repo.remoteUrl(remote)) ?? "";
  const pullRequestUrl =
    (await createPullRequestWithGh({
      cwd: host.root,
      remoteUrl,
      base,
      head: branchName,
      title: subject,
      body: message.split("\n").slice(1).join("\n").trim(),
    })) ?? compareUrl(remoteUrl, base, branchName);

  return { ok: true, commit, branch: branchName, files, pushed: true, ...(pullRequestUrl ? { pullRequestUrl } : {}) };
}

// ─────────────────────────────────────────────────────────────── send

const NO_REMOTE_TO_SEND =
  "This site isn't connected to a code host, so there's nowhere to send its versions. They're saved on this computer.";

/**
 * Sends versions that were published here but never reached the remote (a
 * publish whose push failed, or one made while pushing was off). Only the
 * push is retried: nothing is committed and the working tree is not touched.
 * "Ahead" is measured against what this computer last knew of the remote, so
 * nothing has to be fetched to find out there is nothing to send.
 */
export async function send(host: RepoHost, config: PublishConfig): Promise<PublishResult> {
  const { repo } = host;
  const info = await host.info();

  if (!info) return failure([], NOT_A_REPO);
  const branch = await repo.currentBranch();

  if (!branch) return failure([], DETACHED);
  const remote = await remoteFor(repo, config);

  if (!remote) return failure([], NO_REMOTE_TO_SEND);
  if (config.branch && config.branch !== branch) return wrongLine(config.branch, branch);
  const head = await repo.head();

  if (!head) return { ok: true, branch, files: [], pushed: true };
  // Commits on this branch that no branch of that remote has, as this computer last saw it.
  const ahead = await repo.run(["log", "-z", "--name-only", "--no-renames", "--format=%x1e", "HEAD", "--not", `--remotes=${remote}`, "--", "."], {
    readOnly: true,
    timeoutMs: 60_000,
  });
  const commits = ahead.text.split("\x1e").slice(1);

  if (commits.length === 0) return { ok: true, commit: head, branch, files: [], pushed: true };
  const files = [
    ...new Set(
      commits
        .flatMap((record) => splitNul(record.replace(/^[\0\n]+/, "")))
        .map((name) => name.replace(/^\n/, ""))
        .filter(Boolean)
        .map((name) => sitePath(info, name))
        .filter((name): name is string => name !== null)
    ),
  ].sort();

  return { ok: true, commit: head, branch, files, ...(await push(repo, remote, "HEAD", branch)) };
}

// ─────────────────────────────────────────────────────────────── history

export async function history(host: RepoHost, limit = 50): Promise<HistoryEntry[]> {
  const { repo } = host;
  const info = await host.info();

  if (!info || !(await repo.head())) return [];
  const result = await repo.run(
    [
      "log", `-n${Math.max(1, Math.min(Math.floor(limit), 1000))}`, "-z", "--name-only", "--no-renames",
      "--format=%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%B%x1f", "--", ".",
    ],
    { readOnly: true, timeoutMs: 60_000 }
  );
  const entries: HistoryEntry[] = [];

  for (const record of result.text.split("\x1e")) {
    if (!record.trim()) continue;
    const fields = record.split("\x1f");

    if (fields.length < 7) continue;
    const [commit = "", shortCommit = "", author = "", email = "", date = "", body = ""] = fields;
    const names = fields.slice(6).join("\x1f");
    const viaGalley = TRAILER_LINE.test(body);
    const message = body.replace(new RegExp(`^${PRODUCT.commitTrailer}:.*$`, "gm"), "").trim();

    entries.push({
      commit,
      shortCommit,
      message,
      author,
      email,
      date,
      files: splitNul(names.replace(/^[\0\n]+/, ""))
        .map((name) => name.replace(/^\n/, ""))
        .filter(Boolean)
        .map((name) => sitePath(info, name))
        .filter((name): name is string => name !== null),
      viaGalley,
    });
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────── revert

export async function revert(host: RepoHost, commit: string, config: PublishConfig): Promise<PublishResult> {
  const { repo } = host;
  const info = await host.info();

  if (!info) return failure([], NOT_A_REPO);
  if (typeof commit !== "string" || !/^[0-9a-f]{4,64}$/i.test(commit)) {
    throw new GalleyError("invalid", "That version couldn't be found.", `bad commit id: ${String(commit)}`);
  }
  const branch = await repo.currentBranch();

  if (!branch) return failure([], DETACHED);
  if (operationInProgress(info)) return failure([], IN_PROGRESS);
  if (config.branch && config.branch !== branch) {
    return wrongLine(config.branch, branch);
  }
  const resolved = await repo.run(["rev-parse", "-q", "--verify", `${commit}^{commit}`], { allowFailure: true, readOnly: true });

  if (resolved.code !== 0) throw new GalleyError("not-found", "That version couldn't be found in the site's history.", commit);
  const full = resolved.text.trim();
  const parents = (await repo.run(["rev-list", "--parents", "-n", "1", full], { readOnly: true })).text.trim().split(" ");

  if (parents.length > 2) {
    return failure([], "That version combined two lines of work, so it can't be undone automatically. Ask a developer to undo it.");
  }
  const touched = splitNul(
    (await repo.run(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", "--no-renames", full], { readOnly: true })).text
  )
    .map((p) => sitePath(info, p))
    .filter((p): p is string => p !== null);

  // Undoing a version that changed the settings file changes it again.
  if (touched.some(isSiteSettingsPath)) requireSiteSettings();
  const statuses = await host.statuses();
  const overlapping = touched.filter((p) => statuses.has(p));

  if (overlapping.length > 0) {
    const names = overlapping.slice(0, 3).map((p) => p.slice(p.lastIndexOf("/") + 1)).join(", ");

    return failure(
      overlapping,
      `Some files this would undo have unpublished changes (${names}${overlapping.length > 3 ? ", …" : ""}). Publish or discard those changes first, then try again.`
    );
  }
  const staged = await repo.run(["diff", "--cached", "--quiet"], { allowFailure: true, readOnly: true });

  if (staged.code !== 0) {
    return failure([], "Some changes were prepared for publishing outside the app. Publish or discard them first, then try again.");
  }
  const subject = (await repo.run(["log", "-1", "--format=%s", full], { readOnly: true })).text.trim();
  const applied = await repo.run(["revert", "--no-commit", full], { allowFailure: true });

  if (applied.code !== 0) {
    await repo.run(["revert", "--abort"], { allowFailure: true });
    return failure(
      touched,
      "That version can't be undone automatically, because later changes edited the same lines. Nothing was changed. Edit the content back by hand instead.",
      applied.stderr.trim()
    );
  }
  const identity = await host.identity();
  const message = withTrailer(`Undo “${subject}”\n\nThis reverts commit ${full}.`);
  const committed = await repo.run(["commit", "--cleanup=whitespace", "-m", message, authorArg(identity)], {
    config: identityConfig(identity),
    allowFailure: true,
    timeoutMs: HOOK_TIMEOUT_MS,
  });

  if (committed.code !== 0) {
    await repo.run(["revert", "--abort"], { allowFailure: true });
    return failure(
      touched,
      "The site's own checks stopped the undo, so nothing was changed. Fix what they report, then try again.",
      hookFailureDetail(committed.text, committed.stderr)
    );
  }
  const sha = (await repo.head()) ?? undefined;

  await host.changed(touched, "publish");
  const remote = await remoteFor(repo, config);

  if (!config.push || !remote) return { ok: true, commit: sha, branch, files: touched, pushed: false };
  return { ok: true, commit: sha, branch, files: touched, ...(await push(repo, remote, "HEAD", branch)) };
}

// ─────────────────────────────────────────────────────────────── status & pull

async function upstreamOf(repo: Git): Promise<{ remote: string; ref: string } | null> {
  const result = await repo.run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], {
    allowFailure: true,
    readOnly: true,
  });

  if (result.code !== 0) return null;
  const ref = result.text.trim();
  const branch = await repo.currentBranch();
  const remote = branch
    ? (await repo.run(["config", "--get", `branch.${branch}.remote`], { allowFailure: true, readOnly: true })).text.trim()
    : "";

  return ref ? { remote: remote || ref.split("/")[0] || "", ref } : null;
}

export async function gitStatus(host: RepoHost): Promise<GitStatus> {
  const { repo } = host;
  const info = await host.info();

  if (!info) return { branch: "", detached: false, hasRemote: false, ahead: 0, behind: 0, clean: true };
  const [branch, head, remotes, upstream, statuses] = await Promise.all([
    repo.currentBranch(),
    repo.head(),
    repo.remotes(),
    upstreamOf(repo),
    host.statuses(),
  ]);
  const remote = upstream?.remote || (remotes.includes("origin") ? "origin" : remotes[0]);
  const remoteUrl = remote ? await repo.remoteUrl(remote) : null;
  let ahead = 0;
  let behind = 0;

  if (upstream && head) {
    const counts = await repo.run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], {
      allowFailure: true,
      readOnly: true,
    });
    const [a, b] = counts.text.trim().split(/\s+/);

    ahead = Number(a) || 0;
    behind = Number(b) || 0;
  }
  let lastCommit: GitStatus["lastCommit"];

  if (head) {
    const log = await repo.run(["log", "-1", "--format=%H%x1f%s%x1f%aI%x1f%an"], { readOnly: true });
    const [commit = "", message = "", date = "", author = ""] = log.text.trim().split("\x1f");

    lastCommit = { commit, message, date, author };
  }
  return {
    branch: branch ?? (head ? "HEAD" : ""),
    detached: branch === null,
    hasRemote: remotes.length > 0,
    ...(remote ? { remote } : {}),
    ...(remoteUrl ? { remoteUrl: redactRemoteUrl(remoteUrl) } : {}),
    ahead,
    behind,
    clean: statuses.size === 0,
    ...(lastCommit ? { lastCommit } : {}),
    author: await authorOf(host),
  };
}

/** The author the next publish will record, with where it comes from (for the Publish dialog's small print). */
async function authorOf(host: RepoHost): Promise<NonNullable<GitStatus["author"]>> {
  const identity = await host.identity();

  return { name: identity.name, email: identity.email, from: identity.from ?? "default" };
}

function classifyPullError(stderr: string, timedOut: boolean): string {
  if (/would be overwritten|untracked working tree files would be/i.test(stderr)) {
    return "Some files you've changed here were also changed in the latest version. Publish or discard your changes to those files, then try again.";
  }
  if (/Not possible to fast-forward|diverg|refusing to merge unrelated/i.test(stderr)) {
    return "This copy has versions that aren't on the code host yet, and the code host has newer ones, so they can't be combined automatically. Ask a developer to combine them.";
  }
  if (/couldn't find remote ref|no such ref/i.test(stderr)) {
    return "The code host doesn't have this branch yet, so there's nothing to fetch.";
  }
  return classifyPushError(stderr, timedOut)
    .replace("Your change is saved on this computer — check your connection and publish again.", "Check your connection and try again.")
    .replace("then publish again.", "then try again.");
}

export async function pull(host: RepoHost): Promise<GitStatus> {
  const { repo } = host;
  const info = await host.info();

  if (!info) throw new GalleyError("invalid", "This folder isn't under version control, so there's nothing to fetch.");
  const branch = await repo.currentBranch();

  if (!branch) throw new GalleyError("invalid", DETACHED.replace("to publish", "to fetch into"));
  if (operationInProgress(info)) throw new GalleyError("busy", IN_PROGRESS);
  const upstream = await upstreamOf(repo);
  const remotes = await repo.remotes();
  let args: string[];

  if (upstream) args = ["pull", "--no-rebase", "--ff-only", "--no-edit"];
  else if (remotes.includes("origin") || remotes.length > 0) {
    args = ["pull", "--no-rebase", "--ff-only", "--no-edit", remotes.includes("origin") ? "origin" : (remotes[0] ?? ""), branch];
  } else {
    throw new GalleyError("invalid", "This site isn't connected to a code host, so there's nothing to fetch.");
  }
  const before = await repo.head();
  const result = await repo.run(args, { allowFailure: true, timeoutMs: GIT_NETWORK_TIMEOUT_MS });

  if (result.code !== 0) {
    throw new GalleyError("git", classifyPullError(result.stderr, result.timedOut), redactRemoteUrl(result.stderr.trim()));
  }
  const after = await repo.head();

  if (after && after !== before) {
    const range = before ? [before, after] : [after];
    const names = before
      ? (await repo.run(["diff", "--name-only", "-z", "--no-renames", ...range], { readOnly: true })).text
      : (await repo.run(["ls-tree", "--full-tree", "-r", "-z", "--name-only", after], { readOnly: true })).text;
    const paths = splitNul(names)
      .map((p) => sitePath(info, p))
      .filter((p): p is string => p !== null);

    await host.changed(paths, "external");
  }
  return gitStatus(host);
}
