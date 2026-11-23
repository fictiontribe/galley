/**
 * Where publishing goes, from git reality rather than detection's guess.
 *
 * Detection reads `.git/HEAD` from the site folder and falls back to "main";
 * that guess is wrong for a site inside a monorepo, a worktree, or any branch
 * switched since. The workspace refuses to publish when the configured branch
 * differs from the checked-out one, so "use the current branch" must be the
 * current branch — only an explicit `publish.branch` in the config file may
 * name another one.
 */
import { git } from "../workspace/index";
import type { GalleyConfig, PublishConfig } from "../types";

export interface PublishFacts {
  config: PublishConfig;
  /** Checked-out branch; null when detached or not a repository. */
  branch: string | null;
  /** URL of the effective remote, credentials included — redact before showing. */
  remoteUrl: string | null;
}

export async function resolvePublishConfig(root: string, config: GalleyConfig | null, detected: PublishConfig): Promise<PublishFacts> {
  const configured = config?.publish ?? {};
  const repo = git(root);
  const info = await repo.info();
  const mode = configured.mode ?? detected.mode ?? "commit";

  if (!info) {
    return {
      config: { branch: configured.branch?.trim() || "", mode, remote: configured.remote ?? null, push: configured.push ?? false },
      branch: null,
      remoteUrl: null,
    };
  }
  const [branch, remotes] = await Promise.all([repo.currentBranch(), repo.remotes()]);
  const explicitRemote = configured.remote === undefined ? undefined : configured.remote;
  const remote = explicitRemote !== undefined ? explicitRemote : remotes.includes("origin") ? "origin" : (remotes[0] ?? null);
  const hasRemote = remote !== null && remotes.includes(remote);
  const remoteUrl = hasRemote ? await repo.remoteUrl(remote) : null;

  return {
    config: {
      // Detached HEAD: nothing to publish onto; keep the explicit value or "" so
      // the workspace reports the detached state in its own words.
      branch: configured.branch?.trim() || branch || "",
      mode,
      remote,
      push: configured.push ?? hasRemote,
    },
    branch,
    remoteUrl,
  };
}
