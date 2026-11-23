/**
 * Installed packages for a build of the published version.
 *
 * The published version is checked out as a git worktree of the whole
 * repository, so a site in a monorepo sub-folder builds from its own folder
 * with the published versions of every file it reaches by relative path
 * (shared code, brand files, docs). Dependencies aren't in git, so every
 * `node_modules` the working tree has — the site's, the repository root's,
 * each workspace package's — is made available at the same place in the
 * worktree, because Node looks for packages in every ancestor folder.
 *
 * A `node_modules` is linked whole when nothing in it points back into the
 * repository. When it does — pnpm and npm link workspace packages into
 * `node_modules` (`@acme/ui -> ../../packages/ui`) — it is rebuilt entry by
 * entry: links to workspace packages point at the worktree's copy (the
 * published one), everything else at the installed package as it is.
 */
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readlink, realpath, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Folders never searched for `node_modules`: version history, build caches, build output. */
const SKIP = new Set([".git", "node_modules", "dist", "build", ".astro", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".vite", ".output"]);
const MAX_DEPTH = 8;

async function findModuleFolders(top: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (entry.name === "node_modules") {
        found.push(relative(top, join(dir, entry.name)));
        continue;
      }
      if (depth >= MAX_DEPTH || SKIP.has(entry.name) || entry.name.startsWith(".") || !entry.isDirectory()) continue;
      await walk(join(dir, entry.name), depth + 1);
    }
  }

  await walk(top, 0);
  return found;
}

/** Where a link in the working tree's `node_modules` really leads, or null for an ordinary folder or file. */
async function linkTarget(path: string): Promise<string | null> {
  const info = await lstat(path).catch(() => null);

  if (!info?.isSymbolicLink()) return null;
  const raw = await readlink(path);

  return resolve(dirname(path), raw);
}

/** A path inside the repository that isn't installed code: a workspace package. */
function workspacePath(top: string, target: string): string | null {
  const rel = relative(top, target);

  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).includes("node_modules") ? null : rel;
}

/** The entries of a `node_modules` (and of its `@scope` folders) that link to workspace packages. */
async function hasWorkspaceLinks(top: string, modules: string): Promise<boolean> {
  for (const name of await readdir(modules).catch(() => [] as string[])) {
    const path = join(modules, name);

    if (name.startsWith("@")) {
      for (const child of await readdir(path).catch(() => [] as string[])) {
        const target = await linkTarget(join(path, child));

        if (target && workspacePath(top, target)) return true;
      }
      continue;
    }
    const target = await linkTarget(path);

    if (target && workspacePath(top, target)) return true;
  }
  return false;
}

async function linkEntry(top: string, worktree: string, from: string, to: string): Promise<void> {
  const target = await linkTarget(from);
  const inside = target ? workspacePath(top, target) : null;
  // A workspace package: the worktree's (published) copy. Anything else: the installed package itself.
  const destination = inside !== null ? join(worktree, inside) : await realpath(from).catch(() => from);

  await symlink(destination, to, (await lstat(destination).catch(() => null))?.isDirectory() ? "dir" : "file");
}

async function mirror(top: string, worktree: string, modules: string, into: string): Promise<void> {
  await mkdir(into, { recursive: true });
  for (const name of await readdir(modules)) {
    const from = join(modules, name);
    const to = join(into, name);

    if (name.startsWith("@") && (await lstat(from)).isDirectory()) {
      await mkdir(to, { recursive: true });
      for (const child of await readdir(from)) await linkEntry(top, worktree, join(from, child), join(to, child));
      continue;
    }
    await linkEntry(top, worktree, from, to);
  }
}

/**
 * Makes the working tree's installed packages available in `worktree` (a
 * checkout of the repository whose top level is `top`). Returns how many
 * `node_modules` folders it provided; 0 when the working tree has none.
 */
export async function linkInstalledPackages(top: string, worktree: string): Promise<number> {
  let linked = 0;

  for (const rel of await findModuleFolders(top)) {
    const modules = join(top, rel);
    const into = join(worktree, rel);

    // A folder that isn't in the published version has nothing to build; a node_modules the checkout already has (a committed link) stays.
    if (!existsSync(dirname(into)) || existsSync(into)) continue;
    if (await hasWorkspaceLinks(top, modules)) await mirror(top, worktree, modules, into);
    else await symlink(await realpath(modules), into, "dir");
    linked += 1;
  }
  return linked;
}
