/**
 * What gets built for a deploy.
 *
 * Production puts online what has been *published* — the newest version on
 * the publish branch — never the working tree with its pending changes. It is
 * built in a temporary git worktree checked out at that version, beside the
 * site, so an unpublished edit can't slip onto the live site and the person's
 * folder isn't touched. The worktree is of the whole repository, so a site in
 * a monorepo sub-folder sees the published versions of everything it reaches
 * by relative path; installed packages are linked in (modules.ts) rather than
 * installed again.
 *
 * A preview is the opposite: the working tree exactly as it is, pending
 * changes included, built by the site's own build command where it lives.
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeployKind, SiteModel, SiteService } from "../types";
import { git, installDependencies, runBuild, runGit } from "../workspace/index";
import { DeployError } from "./errors";
import { linkInstalledPackages } from "./modules";
import { normalizeRepoPath } from "../workspace/paths";
import { mayBeShown } from "../workspace/policy";

export interface BuiltSite {
  /** Absolute path of the output folder. */
  dir: string;
  /** The output folder as the settings name it ("dist"). */
  outDir: string;
  /** The folder the site was built in: the site itself (preview) or the published version's worktree (production). */
  root: string;
  /** The version it was built from (production), or the version the pending changes sit on (preview). */
  commit: string | null;
  /** Removes anything temporary. Safe to call twice. */
  cleanup(): Promise<void>;
}

/** The newest published version: the publish branch's tip, else HEAD. null in a repository with no versions. */
export async function publishedCommit(root: string, model: SiteModel): Promise<string | null> {
  const repo = git(root);

  if (!(await repo.isRepository())) return null;
  const branch = model.publish.branch;

  if (branch) {
    const tip = await repo.run(["rev-parse", "-q", "--verify", `refs/heads/${branch}^{commit}`], { allowFailure: true, readOnly: true });

    if (tip.code === 0 && tip.text.trim()) return tip.text.trim();
  }
  return repo.head();
}

/** How many published versions come after `from` up to `to`; null when either isn't in this history. */
export async function versionsBetween(root: string, from: string, to: string): Promise<number | null> {
  if (from === to) return 0;
  const result = await runGit(root, ["rev-list", "--count", `${from}..${to}`], { allowFailure: true, readOnly: true });
  const value = Number(result.text.trim());

  return result.code === 0 && Number.isInteger(value) ? value : null;
}

function buildFailed(output: string): DeployError {
  const tail = output.split("\n").filter((line) => line.trim()).slice(-25).join("\n");

  return new DeployError(
    "build",
    "The site's own build stopped with a problem, so nothing was uploaded and the live site is as it was. The last lines it printed are below; fixing it usually needs whoever looks after the site's code.",
    tail || "The build printed nothing."
  );
}

function requireBuild(model: SiteModel): { command: string; outDir: string } {
  if (!model.build) {
    throw new DeployError("not-set-up", "This site has no build command, so there's nothing to put online yet. Add one in the site settings (for example “npm run build”).");
  }
  // Everything in the output folder goes to the host, and the settings (or the framework's own configuration) name
  // the folder. It is a folder of this site, and never the version history's own or one that holds secrets: the
  // names inside a folder are looked at one by one as it is walked, the folder's own name here.
  let inside: string | null;

  try {
    inside = normalizeRepoPath(model.build.outDir);
  } catch {
    inside = null;
  }
  if (inside === null || inside === "" || !mayBeShown(inside)) {
    throw new DeployError("not-set-up", `The output folder in the site settings (“${model.build.outDir}”) can't be put online: it has to be a folder inside the site that the build writes, like “dist”. If the build writes somewhere else, set it to write inside the site.`, model.build.outDir);
  }
  return model.build;
}

async function buildWorkingTree(site: SiteService, model: SiteModel): Promise<BuiltSite> {
  const build = requireBuild(model);
  const result = await site.build();

  if (!result.ok) throw buildFailed(result.output);
  const status = await site.gitStatus().catch(() => null);

  return { dir: join(site.root, build.outDir), outDir: build.outDir, root: site.root, commit: status?.lastCommit?.commit ?? null, cleanup: async () => undefined };
}

async function buildPublished(site: SiteService, model: SiteModel, onDetail: (detail: string) => void): Promise<BuiltSite> {
  const build = requireBuild(model);
  const repo = git(site.root);
  const info = await repo.info();
  const commit = info ? await publishedCommit(site.root, model) : null;

  if (!info || !commit) {
    throw new DeployError("unpublished", "Nothing has been published yet, so there's nothing to put live. Publish your changes first — what's live is what you've published.");
  }
  const holder = await mkdtemp(join(tmpdir(), "galley-live-"));
  const worktree = join(holder, "site");
  let registered = false;
  const cleanup = async () => {
    if (registered) {
      registered = false;
      await runGit(site.root, ["worktree", "remove", "--force", worktree], { allowFailure: true });
    }
    await rm(holder, { recursive: true, force: true });
    await runGit(site.root, ["worktree", "prune"], { allowFailure: true });
  };

  try {
    await runGit(site.root, ["worktree", "add", "--detach", "--quiet", worktree, commit]);
    registered = true;
    const siteDir = info.prefix ? join(worktree, ...info.prefix.replace(/\/+$/, "").split("/")) : worktree;
    // Every node_modules the working tree has (the site's, the repository root's, workspace packages'), at the same places.
    const linked = await linkInstalledPackages(info.topLevel, worktree);

    if (linked === 0 && !existsSync(join(siteDir, "node_modules")) && existsSync(join(siteDir, "package.json"))) {
      onDetail("Installing the site's dependencies…");
      await installDependencies(siteDir, model.packageManager, undefined, model.environment);
    }
    onDetail("Building the published version…");
    const result = await runBuild(siteDir, build.command, model.environment ? { env: model.environment } : {});

    if (!result.ok) throw buildFailed(result.output);
    return { dir: join(siteDir, build.outDir), outDir: build.outDir, root: siteDir, commit, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function buildForDeploy(site: SiteService, kind: DeployKind, onDetail: (detail: string) => void): Promise<BuiltSite> {
  const model = await site.model();

  if (kind === "preview") {
    onDetail("Building the site with your changes…");
    return buildWorkingTree(site, model);
  }
  return buildPublished(site, model, onDetail);
}
