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

// ─────────────────────────────────────────────────────────────── status, looking & bringing in

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

/**
 * Where this copy's versions come from: the code host's branch it follows
 * (its upstream, else the same name on the remote pull would use) and the
 * ref here that remembers what was last seen of it. Null when there is no
 * branch or nothing to follow.
 */
interface Source {
  remote: string;
  branch: string;
  ref: string;
}

async function sourceOf(repo: Git, branch: string | null): Promise<Source | null> {
  if (!branch) return null;
  const read = async (key: string) => (await repo.run(["config", "--get", key], { allowFailure: true, readOnly: true })).text.trim();
  const [remote, merge] = await Promise.all([read(`branch.${branch}.remote`), read(`branch.${branch}.merge`)]);

  if (remote && remote !== "." && merge.startsWith("refs/heads/")) {
    const name = merge.slice("refs/heads/".length);

    return { remote, branch: name, ref: `refs/remotes/${remote}/${name}` };
  }
  const remotes = await repo.remotes();
  const fallback = remotes.includes("origin") ? "origin" : remotes[0];

  return fallback ? { remote: fallback, branch, ref: `refs/remotes/${fallback}/${branch}` } : null;
}

/** What `ahead` and `behind` count against: the upstream, else what was last seen of the source, when anything was. */
async function compareRef(repo: Git, branch: string | null, upstream: { ref: string } | null): Promise<string | null> {
  if (upstream) return "@{upstream}";
  const source = await sourceOf(repo, branch);

  if (!source) return null;
  const known = await repo.run(["rev-parse", "-q", "--verify", `${source.ref}^{commit}`], { allowFailure: true, readOnly: true });

  return known.code === 0 ? source.ref : null;
}

const SEPARATE_WAYS =
  "This copy and the repository have gone separate ways: each has published versions the other doesn't, so newer versions can't come in by themselves. Your edits are safe. Someone who knows the repository needs to bring the two together.";

function fileList(paths: string[]): string {
  const names = paths.slice(0, 3).map((p) => p.slice(p.lastIndexOf("/") + 1));

  return `${names.join(", ")}${paths.length > 3 ? ", …" : ""}`;
}

/** Plain words for unpublished changes to files the newer versions change too. */
function changesInTheWay(paths: string[]): string {
  return paths.length === 1
    ? `The newer versions change ${fileList(paths)}, which has unpublished changes here. Publish or discard the change to that file, then the newer versions can come in.`
    : `The newer versions change ${paths.length} files that have unpublished changes here (${fileList(paths)}). Publish or discard the changes to those files, then the newer versions can come in.`;
}

/**
 * Why newer versions can't simply move this copy forward, or undefined when
 * they can: published versions here the code host lacks, or unpublished
 * changes to files they change too (git would refuse to overwrite them).
 */
async function inTheWayOf(repo: Git, info: RepoInfo, compare: string, ahead: number, pending: Map<string, PendingStatus>): Promise<GitStatus["inTheWay"]> {
  if (ahead > 0) return { kind: "separate-ways", message: SEPARATE_WAYS, paths: [] };
  const changed = await repo.run(["diff", "--name-only", "-z", "--no-renames", "HEAD", compare], { allowFailure: true, readOnly: true });
  const blocked = splitNul(changed.text)
    .map((p) => sitePath(info, p))
    .filter((p): p is string => p !== null && pending.has(p))
    .sort();

  return blocked.length > 0 ? { kind: "changes", message: changesInTheWay(blocked), paths: blocked } : undefined;
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
  const compare = head ? await compareRef(repo, branch, upstream) : null;
  let ahead = 0;
  let behind = 0;
  let inTheWay: GitStatus["inTheWay"];

  if (compare && head) {
    const counts = await repo.run(["rev-list", "--left-right", "--count", `HEAD...${compare}`], {
      allowFailure: true,
      readOnly: true,
    });
    const [a, b] = counts.text.trim().split(/\s+/);

    ahead = Number(a) || 0;
    behind = Number(b) || 0;
    if (behind > 0) inTheWay = await inTheWayOf(repo, info, compare, ahead, statuses);
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
    ...(inTheWay ? { inTheWay } : {}),
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

/** Why a look at the code host didn't work, in the words Get latest uses (minus its own vocabulary). */
function classifyLookError(stderr: string, timedOut: boolean): string {
  if (/couldn't find remote ref|no such ref/i.test(stderr)) return "The repository doesn't have the versions this copy follows yet, so there's nothing newer to look for.";
  return classifyPullError(stderr, timedOut);
}

/** One look at the code host: null when there is nothing to look at (no repository, no remote, no branch). */
export type Look = { ok: true } | { ok: false; problem: string; detail: string };

/**
 * Asks the code host what is new: fetches the followed branch into the ref
 * that remembers it. Changes no file, the index or HEAD. Never throws for
 * the code host's reasons: a failed look says why.
 */
export async function look(host: RepoHost): Promise<Look | null> {
  const { repo } = host;

  if (!(await host.info())) return null;
  const source = await sourceOf(repo, await repo.currentBranch());

  if (!source) return null;
  const fetched = await repo.run(["fetch", "--quiet", "--no-tags", source.remote, `+refs/heads/${source.branch}:${source.ref}`], {
    allowFailure: true,
    timeoutMs: GIT_NETWORK_TIMEOUT_MS,
  });

  if (fetched.code === 0) return { ok: true };
  return { ok: false, problem: classifyLookError(fetched.stderr, fetched.timedOut), detail: redactRemoteUrl(fetched.stderr.trim()) };
}

/** What the workspace does around files changing: before the copy moves forward, and after (with the files that changed, none when it didn't). */
export interface AroundBringIn {
  before(): Promise<void>;
  after(paths: string[]): Promise<void>;
}

/** What bringing versions in did. */
export interface BringIn {
  brought: number;
  paths: string[];
}

type Forward = ({ ok: true } & BringIn) | { ok: false; stderr: string; timedOut: boolean };

/**
 * Moves this copy forward to `target`, never sideways: `merge --ff-only`
 * refuses rather than overwrite an unpublished change or rewrite anything.
 * Tells the workspace's listeners which files changed. `around` runs on
 * either side of the only moment files can change, and its `after` runs
 * whatever happens.
 */
async function fastForward(host: RepoHost, info: RepoInfo, target: string, around?: AroundBringIn): Promise<Forward> {
  const { repo } = host;
  const before = await repo.head();
  let outcome: Forward = { ok: false, stderr: "", timedOut: false };

  await around?.before();
  try {
    const merged = await repo.run(["merge", "--ff-only", "--no-edit", "--quiet", target], { allowFailure: true, timeoutMs: GIT_NETWORK_TIMEOUT_MS });

    if (merged.code !== 0) {
      outcome = { ok: false, stderr: merged.stderr, timedOut: merged.timedOut };
      return outcome;
    }
    const after = await repo.head();

    if (!after || after === before) {
      outcome = { ok: true, brought: 0, paths: [] };
      return outcome;
    }
    const names = before
      ? (await repo.run(["diff", "--name-only", "-z", "--no-renames", before, after], { readOnly: true })).text
      : (await repo.run(["ls-tree", "--full-tree", "-r", "-z", "--name-only", after], { readOnly: true })).text;
    const counted = await repo.run(["rev-list", "--count", before ? `${before}..${after}` : after], { allowFailure: true, readOnly: true });
    const paths = splitNul(names)
      .map((p) => sitePath(info, p))
      .filter((p): p is string => p !== null);

    outcome = { ok: true, brought: Number(counted.text.trim()) || 1, paths };
    await host.changed(paths, "external");
    return outcome;
  } finally {
    await around?.after(outcome.ok ? outcome.paths : []);
  }
}

/** What there is to bring in from, or why there is nothing (Get latest says these). */
async function bringInSource(host: RepoHost): Promise<{ info: RepoInfo; branch: string }> {
  const { repo } = host;
  const info = await host.info();

  if (!info) throw new GalleyError("invalid", "This folder isn't under version control, so there's nothing to fetch.");
  const branch = await repo.currentBranch();

  if (!branch) throw new GalleyError("invalid", DETACHED.replace("to publish", "to fetch into"));
  if (operationInProgress(info)) throw new GalleyError("busy", IN_PROGRESS);
  if ((await repo.remotes()).length === 0) throw new GalleyError("invalid", "This site isn't connected to a code host, so there's nothing to fetch.");
  return { info, branch };
}

/**
 * Get latest: look, then move forward to what the code host has. Throws, in
 * plain words, when it can't (offline, files in the way, separate ways).
 * `onLook` hears how the look went; `around` runs only when there is
 * something to bring in.
 */
export async function pull(host: RepoHost, options: { around?: AroundBringIn; onLook?: (look: Look) => void } = {}): Promise<BringIn & { status: GitStatus }> {
  const { repo } = host;
  const { info, branch } = await bringInSource(host);
  const looked = await look(host);

  if (looked) options.onLook?.(looked);
  if (looked && !looked.ok) throw new GalleyError("git", looked.problem, looked.detail);
  const target = await compareRef(repo, branch, await upstreamOf(repo));
  const behind = target && (await repo.head())
    ? Number((await repo.run(["rev-list", "--count", `HEAD..${target}`], { allowFailure: true, readOnly: true })).text.trim()) || 0
    : target ? 1 : 0;

  if (!target || behind === 0) return { brought: 0, paths: [], status: await gitStatus(host) };
  const ahead = await gitStatus(host);

  // Refused before anything (the preview included) is touched, when it's already clear git would refuse.
  if (ahead.inTheWay?.kind === "separate-ways") throw new GalleyError("git", classifyPullError("Not possible to fast-forward", false));
  if (ahead.inTheWay) throw new GalleyError("git", ahead.inTheWay.message, ahead.inTheWay.paths.join("\n"));
  const moved = await fastForward(host, info, target, options.around);

  if (!moved.ok) throw new GalleyError("git", classifyPullError(moved.stderr, moved.timedOut), redactRemoteUrl(moved.stderr.trim()));
  return { brought: moved.brought, paths: moved.paths, status: await gitStatus(host) };
}

/**
 * A hosted editor's own round: look, and bring newer versions in only when
 * nothing is in the way. Never throws for git's reasons — what stopped it is
 * in the status (`checkProblem`, `inTheWay`), and the next round tries again.
 */
export async function catchUp(host: RepoHost, options: { around?: AroundBringIn; onLook?: (look: Look) => void } = {}): Promise<BringIn & { status: GitStatus }> {
  const { repo } = host;
  const quiet = async () => ({ brought: 0, paths: [], status: await gitStatus(host) });
  const info = await host.info();
  const branch = info ? await repo.currentBranch() : null;

  if (!info || !branch || operationInProgress(info)) return quiet();
  const looked = await look(host);

  if (!looked) return quiet();
  options.onLook?.(looked);
  const status = await gitStatus(host);
  const target = await compareRef(repo, branch, await upstreamOf(repo));

  if (!looked.ok || !target || status.behind === 0 || status.inTheWay) return { brought: 0, paths: [], status };
  const moved = await fastForward(host, info, target, options.around);

  if (moved.ok) return { brought: moved.brought, paths: moved.paths, status: await gitStatus(host) };
  // Refused all the same (a file that changed in between): said like the ones seen ahead, and left for the next round.
  const after = await gitStatus(host);
  const separate = /Not possible to fast-forward|diverg|refusing to merge unrelated/i.test(moved.stderr);

  return {
    brought: 0,
    paths: [],
    status: { ...after, inTheWay: after.inTheWay ?? { kind: separate ? "separate-ways" : "changes", message: separate ? SEPARATE_WAYS : classifyPullError(moved.stderr, moved.timedOut), paths: [] } },
  };
}
