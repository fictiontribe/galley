/**
 * Getting a site onto the machine: cloning a repository, or copying a starter
 * into a fresh repository.
 */
import { copyFile, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import { applyJsonOp } from "../content/edit/json";
import { runCommand } from "./exec";
import { gitEnv, runGit, git as createGit } from "./git";
import { NEUTRAL_AUTHOR } from "./workspace";

/** Never copied out of a starter: installed packages, history, build output, OS litter. */
const STARTER_SKIP = new Set(["node_modules", ".git", "dist", ".astro", ".DS_Store"]);
const CLONE_TIMEOUT_MS = 30 * 60_000;

export async function isGitRepository(root: string): Promise<boolean> {
  try {
    return await createGit(root).isRepository();
  } catch {
    return false;
  }
}

async function isEmptyOrMissing(directory: string): Promise<boolean> {
  try {
    const stat = await lstat(directory);

    if (!stat.isDirectory()) return false;
    return (await readdir(directory)).length === 0;
  } catch {
    return true;
  }
}

/** Progress phases git reports, mapped onto one 0–1 bar. */
const PHASES: Array<{ pattern: RegExp; from: number; to: number; label: string }> = [
  { pattern: /^remote: (?:Enumerating|Counting) objects:\s+(\d+)%/, from: 0, to: 0.05, label: "Looking at the repository" },
  { pattern: /^remote: Compressing objects:\s+(\d+)%/, from: 0.05, to: 0.1, label: "Preparing the download" },
  { pattern: /^Receiving objects:\s+(\d+)%/, from: 0.1, to: 0.8, label: "Downloading" },
  { pattern: /^Resolving deltas:\s+(\d+)%/, from: 0.8, to: 0.95, label: "Unpacking" },
  { pattern: /^(?:Updating files|Checking out files):\s+(\d+)%/, from: 0.95, to: 1, label: "Writing files" },
];

export function parseCloneProgress(line: string): { detail: string; progress: number } | null {
  for (const phase of PHASES) {
    const match = phase.pattern.exec(line.trim());

    if (match) {
      const percent = Math.min(100, Number(match[1])) / 100;

      return { detail: phase.label, progress: Math.round((phase.from + (phase.to - phase.from) * percent) * 1000) / 1000 };
    }
  }
  return null;
}

function classifyCloneError(stderr: string, timedOut: boolean): string {
  if (timedOut) return "Downloading the site took too long and was stopped. Check your connection and try again.";
  if (/repository .* not found|not found|does not exist|does not appear to be a git repository/i.test(stderr)) {
    return "That repository wasn't found. Check the address — and that you have access to it.";
  }
  if (/Authentication failed|could not read Username|terminal prompts disabled|Permission denied|publickey|returned error: 40[13]/i.test(stderr)) {
    return "The code host didn't accept your sign-in for that repository. Sign in to it on this computer, then try again.";
  }
  if (/Remote branch .* not found/i.test(stderr)) return "That branch doesn't exist in the repository.";
  if (/Could not resolve host|unable to access|Connection refused|timed out|Network is unreachable/i.test(stderr)) {
    return "Couldn't reach the code host. Check your internet connection and try again.";
  }
  return "The site couldn't be downloaded.";
}

export async function cloneRepository(
  input: { url: string; directory: string; branch?: string },
  onProgress?: (detail: string, progress?: number) => void
): Promise<void> {
  const url = input.url.trim();

  // A URL starting with "-" would be read as an option; ext:: runs a command.
  if (!url || url.startsWith("-") || /^ext::/i.test(url) || /[\0\n\r]/.test(url)) {
    throw new GalleyError("invalid", "That doesn't look like a repository address.", url);
  }
  if (input.branch !== undefined && (!input.branch || input.branch.startsWith("-") || /[\0\s]/.test(input.branch))) {
    throw new GalleyError("invalid", "That branch name isn't valid.", input.branch);
  }
  if (!(await isEmptyOrMissing(input.directory))) {
    throw new GalleyError("conflict", "That folder already has files in it. Choose an empty folder or a new name.", input.directory);
  }
  const existed = await lstat(input.directory).then(() => true, () => false);

  await mkdir(input.directory, { recursive: true });
  onProgress?.("Connecting", 0);
  const args = [
    "-c", "protocol.ext.allow=never", "-c", "core.fsmonitor=false",
    "clone", "--progress", ...(input.branch ? ["--branch", input.branch] : []), "--", url, input.directory,
  ];
  let lastProgress = -1;
  const result = await runCommand("git", args, {
    cwd: input.directory,
    // The target folder's registered access (a hosted install's key) applies to the download too.
    env: gitEnv(undefined, false, input.directory),
    timeoutMs: CLONE_TIMEOUT_MS,
    onLine: (line, stream) => {
      if (stream !== "stderr") return;
      const parsed = parseCloneProgress(line);

      // Throttle to whole percents — git rewrites its progress line constantly.
      if (parsed && Math.floor(parsed.progress * 100) !== lastProgress) {
        lastProgress = Math.floor(parsed.progress * 100);
        onProgress?.(parsed.detail, parsed.progress);
      }
    },
  });

  if (result.spawnError) {
    if (!existed) await rm(input.directory, { recursive: true, force: true });
    throw new GalleyError("unconfigured", "Git isn't installed on this computer. Install it from git-scm.com, then try again.", result.spawnError.message);
  }
  if (result.code !== 0 || result.timedOut) {
    // Leave nothing half-downloaded behind; only remove what we created.
    if (existed) {
      for (const entry of await readdir(input.directory).catch(() => [] as string[])) {
        await rm(join(input.directory, entry), { recursive: true, force: true });
      }
    } else {
      await rm(input.directory, { recursive: true, force: true });
    }
    throw new GalleyError("git", classifyCloneError(result.stderr, result.timedOut), result.stderr.trim().replace(/(https?:\/\/)[^@/\s]+@/gi, "$1"));
  }
  onProgress?.("Done", 1);
}

/**
 * npm never packs a file called `.gitignore`, so a starter shipped inside an
 * npm package keeps it as `gitignore`; the copy gets its dot back (unless the
 * starter has both). Losing it would put node_modules in the first version.
 */
const PACKED_GITIGNORE = "gitignore";

async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  const hasDotted = entries.some((entry) => entry.name === ".gitignore");

  for (const entry of entries) {
    if (STARTER_SKIP.has(entry.name)) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name === PACKED_GITIGNORE && entry.isFile() && !hasDotted ? ".gitignore" : entry.name);

    if (entry.isSymbolicLink()) await symlink(await readlink(source), target);
    else if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isFile()) await copyFile(source, target);
  }
}

/** npm package names: lowercase, URL-safe, no leading dot or underscore. */
export function packageName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 214) || "site"
  );
}

export async function scaffoldFromStarter(input: {
  starterDir: string;
  targetDir: string;
  name: string;
  /** Author of the first commit; defaults to git config, then a neutral name. */
  author?: { name: string; email: string } | null;
  /**
   * Runs on the copy before its first version is recorded, so whatever it
   * changes (the site's name, a chosen look, installed dependencies' lock
   * file) is part of that version and the new site starts with no changes.
   */
  prepare?: (root: string) => Promise<void>;
}): Promise<void> {
  const starter = await lstat(input.starterDir).catch(() => null);

  if (!starter?.isDirectory()) throw new GalleyError("not-found", "That starter couldn't be found.", input.starterDir);
  if (!(await isEmptyOrMissing(input.targetDir))) {
    throw new GalleyError("conflict", "That folder already has files in it. Choose an empty folder or a new name.", input.targetDir);
  }
  await copyTree(input.starterDir, input.targetDir);

  const manifestPath = join(input.targetDir, "package.json");
  const manifest = await readFile(manifestPath, "utf8").catch(() => null);

  if (manifest !== null) {
    // Only the name's value changes: every other line of the starter's package.json stays as written.
    const renamed = applyJsonOp(manifest, { op: "set", path: ["name"], value: packageName(input.name) }, false);

    // A starter with an unparseable package.json is still copied; the name stays as it was.
    if (renamed.ok && renamed.changed) await writeFile(manifestPath, renamed.text);
  }

  const root = input.targetDir;

  await input.prepare?.(root);

  await runGit(root, ["init", "-q"]);
  // `git init -b` needs git 2.28; setting HEAD directly works everywhere.
  await runGit(root, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  await runGit(root, ["add", "-A", "--", "."]);
  let author = input.author?.name && input.author.email ? input.author : null;

  if (!author) {
    const name = (await runGit(root, ["config", "--get", "user.name"], { allowFailure: true })).text.trim();
    const email = (await runGit(root, ["config", "--get", "user.email"], { allowFailure: true })).text.trim();

    author = name && email ? { name, email } : { ...NEUTRAL_AUTHOR };
  }
  const clean = (value: string) => value.replace(/[<>\r\n\0]/g, "").trim();

  await runGit(
    root,
    ["commit", "-q", "--no-verify", "-m", `Start ${input.name.trim() || "the site"} from a starter\n\n${PRODUCT.commitTrailer}: 1`, `--author=${clean(author.name)} <${clean(author.email)}>`],
    { config: [`user.name=${clean(author.name)}`, `user.email=${clean(author.email)}`] }
  );
}
