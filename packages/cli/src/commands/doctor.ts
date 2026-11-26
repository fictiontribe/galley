import { execFile } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { loadSiteModel, readConfig } from "@galley/core/content";
import type { PackageManager, SecretStatus, Settings, SiteModel } from "@galley/core/types";
import { defaultHome } from "@galley/server";
import { parse, plural } from "../args";
import type { Io } from "../io";
import { collectionDetail, collectionsLine, frameworkLine, mediaLine } from "../summary";

export const DOCTOR_HELP = `Usage: ${PRODUCT.slug} doctor [path] [options]

Check that the site in [path] (default: this folder) and this computer are
ready: what detection finds, Node, git, dependencies, config, deploy limits,
and the assistant's key.
Exits with 1 when something would stop ${PRODUCT.name} from working.

Options
      --cloud  Check readiness for cloud deploys (Cloudflare 25 MiB limit, local dependencies, config)
      --json   Print the checks as JSON
  -h, --help   Show this help`;

export const MIN_NODE = [20, 11] as const;
export const CLOUDFLARE_MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface DoctorOptions {
  cloud?: boolean;
}

export interface Check {
  /** "ok" ✓, "warn" ! (works, with a caveat), "fail" ! (stops the app working), "info" (indented note). */
  level: "ok" | "warn" | "fail" | "info";
  text: string;
}

const LOCKFILES: ReadonlyArray<{ manager: PackageManager; file: string }> = [
  { manager: "pnpm", file: "pnpm-lock.yaml" },
  { manager: "npm", file: "package-lock.json" },
  { manager: "npm", file: "npm-shrinkwrap.json" },
  { manager: "yarn", file: "yarn.lock" },
  { manager: "bun", file: "bun.lock" },
  { manager: "bun", file: "bun.lockb" },
];

interface GitContext {
  installed: boolean;
  insideRepo: boolean;
  topLevel: string | null;
  hasTrackedFiles: boolean;
  checks: Check[];
}

function run(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; stdout: string; missing: boolean }> {
  return new Promise((done) => {
    execFile(file, args, { cwd, timeout: 15_000, env: { ...env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } }, (error, stdout) => {
      done({ ok: !error, stdout: String(stdout ?? ""), missing: (error as NodeJS.ErrnoException | null)?.code === "ENOENT" });
    });
  });
}

export function nodeCheck(version = process.versions.node): Check {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const ok = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);

  return ok
    ? { level: "ok", text: `Node ${version}` }
    : { level: "fail", text: `Node ${version} is too old — ${PRODUCT.name} needs ${MIN_NODE.join(".")} or newer (nodejs.org)` };
}

/** "git@github.com:a/b.git" / "https://user:pw@host/x" → "github.com" — never credentials. */
export function remoteHost(url: string): string {
  const scp = /^[\w.-]+@([\w.-]+):/.exec(url);

  if (scp) return scp[1]!;
  try {
    return new URL(url).hostname || "a local folder";
  } catch {
    return "a local folder";
  }
}

async function gitChecks(root: string, env: NodeJS.ProcessEnv): Promise<GitContext> {
  const git = (args: string[]) => run("git", args, root, env);

  const version = await git(["--version"]);

  if (version.missing || !version.ok) {
    return {
      installed: false,
      insideRepo: false,
      topLevel: null,
      hasTrackedFiles: false,
      checks: [{ level: "fail", text: "git isn't installed — install it from git-scm.com; publishing and change tracking need it" }],
    };
  }
  const inside = await git(["rev-parse", "--is-inside-work-tree"]);

  if (!inside.ok || inside.stdout.trim() !== "true") {
    return {
      installed: true,
      insideRepo: false,
      topLevel: null,
      hasTrackedFiles: false,
      checks: [{ level: "warn", text: `${version.stdout.trim()} · this folder isn't a git repository — editing works, publishing needs it: run git init` }],
    };
  }
  const topLevel = (await git(["rev-parse", "--show-toplevel"])).stdout.trim() || root;
  const branch = (await git(["symbolic-ref", "--short", "-q", "HEAD"])).stdout.trim() || "a detached version";
  const status = await git(["status", "--porcelain"]);
  const pending = status.stdout.split("\n").filter(Boolean).length;
  const hasCommits = (await git(["rev-parse", "-q", "--verify", "HEAD"])).ok;
  const trackedSample = hasCommits ? true : (await git(["ls-files"])).stdout.trim().length > 0;
  const remotes = (await git(["remote"])).stdout.split("\n").filter(Boolean);
  const remoteName = remotes.includes("origin") ? "origin" : remotes[0];
  let remote = "no remote (publishing commits here only)";

  if (remoteName) {
    const url = (await git(["remote", "get-url", remoteName])).stdout.trim();

    remote = `remote ${remoteName} (${remoteHost(url)})`;
  }
  const tree = pending === 0 ? "clean working tree" : `${plural(pending, "pending change")}`;
  const checks: Check[] = [{ level: "ok", text: `git: ${tree} on ${branch} · ${remote}` }];

  if (!hasCommits) checks.push({ level: "info", text: "No commits yet — the first publish will create one" });
  return { installed: true, insideRepo: true, topLevel, hasTrackedFiles: trackedSample, checks };
}

function collectExportTargets(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    if (value && !value.includes("*")) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExportTargets(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === "types") continue;
      collectExportTargets(nested, out);
    }
  }
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

async function checkTrackedOrIgnored(absPath: string, root: string, gitCtx: GitContext, env: NodeJS.ProcessEnv): Promise<"ok" | "gitignored" | "untracked"> {
  if (!gitCtx.insideRepo || !gitCtx.topLevel) return "ok";
  const relFromGit = toPosix(relative(gitCtx.topLevel, absPath));

  if (!relFromGit || relFromGit.startsWith("..") || isAbsolute(relFromGit)) return "ok";
  const tracked = await run("git", ["ls-files", "--error-unmatch", "--", relFromGit], gitCtx.topLevel, env);

  if (tracked.ok) return "ok";
  const ignored = await run("git", ["check-ignore", "--", relFromGit], gitCtx.topLevel, env);

  if (ignored.ok) return "gitignored";
  if (gitCtx.hasTrackedFiles) return "untracked";
  // Even with no commits yet, check whether the file lives inside root (avoid false positives on brand-new unadded repos)
  void root;
  return "ok";
}

export async function localDependencyChecks(root: string, gitCtx: GitContext, env: NodeJS.ProcessEnv): Promise<Check[]> {
  const pkgPath = join(root, "package.json");

  if (!existsSync(pkgPath)) return [];
  let pkg: Record<string, unknown>;

  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return [];
  }
  const localDeps: Array<{ name: string; spec: string }> = [];

  for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const section = pkg[field];

    if (!section || typeof section !== "object") continue;
    for (const [name, raw] of Object.entries(section as Record<string, unknown>)) {
      if (typeof raw === "string" && (raw.startsWith("file:") || raw.startsWith("link:"))) {
        localDeps.push({ name, spec: raw });
      }
    }
  }
  if (!localDeps.length) return [];

  const checks: Check[] = [];
  let broken = 0;

  for (const { name, spec } of localDeps) {
    const rawTarget = spec.replace(/^(?:file|link):/, "");
    const targetPath = resolve(root, rawTarget);
    const displayTarget = toPosix(relative(root, targetPath)) || rawTarget;
    const stat = statSync(targetPath, { throwIfNoEntry: false });

    if (!stat) {
      broken += 1;
      checks.push({ level: "fail", text: `Local dependency “${name}” (${spec}) points to ${displayTarget}, which doesn't exist` });
      continue;
    }
    if (stat.isFile()) {
      const gitState = await checkTrackedOrIgnored(targetPath, root, gitCtx, env);

      if (gitState === "gitignored") {
        broken += 1;
        checks.push({
          level: "fail",
          text: `Local dependency “${name}” (${spec}) file ${displayTarget} is excluded by .gitignore — fresh clones and cloud builds won't have it`,
        });
      } else if (gitState === "untracked") {
        broken += 1;
        checks.push({
          level: "fail",
          text: `Local dependency “${name}” (${spec}) file ${displayTarget} isn't tracked by git — commit it so fresh clones and cloud builds can resolve “${name}”`,
        });
      }
      continue;
    }
    if (!stat.isDirectory()) {
      broken += 1;
      checks.push({ level: "fail", text: `Local dependency “${name}” (${spec}) target ${displayTarget} is not a folder or file` });
      continue;
    }

    const depPkgPath = join(targetPath, "package.json");
    const entryTargets = new Set<string>();

    if (existsSync(depPkgPath)) {
      const depPkgGit = await checkTrackedOrIgnored(depPkgPath, root, gitCtx, env);

      if (depPkgGit === "gitignored" || depPkgGit === "untracked") {
        broken += 1;
        const relPkg = toPosix(relative(root, depPkgPath));

        checks.push({
          level: "fail",
          text:
            depPkgGit === "gitignored"
              ? `Local dependency “${name}” (${spec}) has gitignored package.json at ${relPkg} — fresh clones and cloud builds won't have it`
              : `Local dependency “${name}” (${spec}) has untracked package.json at ${relPkg} — commit it so cloud builds can resolve “${name}”`,
        });
      }
      let depPkg: Record<string, unknown>;

      try {
        depPkg = JSON.parse(readFileSync(depPkgPath, "utf8")) as Record<string, unknown>;
      } catch (error) {
        broken += 1;
        checks.push({
          level: "fail",
          text: `Local dependency “${name}” (${spec}) has unreadable package.json (${error instanceof Error ? error.message : String(error)})`,
        });
        continue;
      }
      if (typeof depPkg.main === "string" && depPkg.main.trim()) entryTargets.add(depPkg.main.trim());
      if (typeof depPkg.module === "string" && depPkg.module.trim()) entryTargets.add(depPkg.module.trim());
      if (depPkg.exports !== undefined) collectExportTargets(depPkg.exports, entryTargets);
    } else {
      const fallback = ["index.js", "index.mjs", "index.cjs"].find((candidate) => existsSync(join(targetPath, candidate)));

      if (fallback) {
        entryTargets.add(fallback);
      } else {
        broken += 1;
        checks.push({ level: "fail", text: `Local dependency “${name}” (${spec}) is missing package.json (and index.js) in ${displayTarget}` });
        continue;
      }
    }

    const checkedPaths = new Set<string>();

    for (const entry of entryTargets) {
      const absEntry = resolve(targetPath, entry);

      if (checkedPaths.has(absEntry)) continue;
      checkedPaths.add(absEntry);
      const displayEntry = toPosix(relative(root, absEntry));

      if (!existsSync(absEntry)) {
        broken += 1;
        checks.push({
          level: "fail",
          text: `Local dependency “${name}” (${spec}) is missing entrypoint ${displayEntry} — build or restore it so the preview and deploys can resolve “${name}”`,
        });
        continue;
      }
      const gitState = await checkTrackedOrIgnored(absEntry, root, gitCtx, env);

      if (gitState === "gitignored") {
        broken += 1;
        checks.push({
          level: "fail",
          text: `Local dependency “${name}” (${spec}) has gitignored entrypoint ${displayEntry} — cloud builds and fresh clones will fail to resolve “${name}” (allow it in .gitignore or force-add it with git add -f ${displayEntry})`,
        });
      } else if (gitState === "untracked") {
        broken += 1;
        checks.push({
          level: "fail",
          text: `Local dependency “${name}” (${spec}) has untracked entrypoint ${displayEntry} — commit it so cloud builds and fresh clones can resolve “${name}”`,
        });
      }
    }
  }

  if (broken === 0) {
    checks.push({ level: "ok", text: `local dependencies: ${plural(localDeps.length, "package")} verified` });
  }
  return checks;
}

function scanLargeFiles(dir: string, root: string, limitBytes: number, oversized: Array<{ path: string; size: number }>): void {
  let entries;

  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);

    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      scanLargeFiles(full, root, limitBytes, oversized);
    } else if (entry.isFile()) {
      const stat = lstatSync(full, { throwIfNoEntry: false });

      if (stat && stat.size > limitBytes) {
        oversized.push({ path: toPosix(relative(root, full)), size: stat.size });
      }
    }
  }
}

export function cloudflareFileSizeChecks(root: string, model: SiteModel | null, options: DoctorOptions = {}): Check[] {
  const dirs = new Set<string>(["public", "dist"]);

  if (model?.build?.outDir) dirs.add(model.build.outDir);
  const visited = new Set<string>();
  const oversized: Array<{ path: string; size: number }> = [];

  for (const dir of dirs) {
    const abs = resolve(root, dir);
    const rel = relative(root, abs);

    if (rel.startsWith("..") || isAbsolute(rel) || visited.has(abs)) continue;
    visited.add(abs);
    if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) continue;
    scanLargeFiles(abs, root, CLOUDFLARE_MAX_FILE_BYTES, oversized);
  }
  if (oversized.length > 0) {
    oversized.sort((a, b) => b.size - a.size);
    const formatted = oversized.slice(0, 5).map((item) => `${item.path} (${(item.size / (1024 * 1024)).toFixed(1)} MiB)`);
    const extra = oversized.length > 5 ? ` and ${oversized.length - 5} more` : "";

    return [
      {
        level: options.cloud ? "fail" : "warn",
        text: `Cloudflare 25 MiB per-file deploy limit exceeded: ${formatted.join(", ")}${extra} — compress large assets or move them to object storage (R2/S3) before deploying`,
      },
    ];
  }
  if (options.cloud) {
    return [{ level: "ok", text: "deploy file sizes: no files over Cloudflare's 25 MiB limit" }];
  }
  return [];
}

export async function configValidationCheck(root: string): Promise<{ check: Check; invalid: boolean }> {
  const configPath = join(root, PRODUCT.configFile);

  if (!existsSync(configPath)) {
    return {
      check: { level: "info", text: `No ${PRODUCT.configFile} (optional; ${PRODUCT.slug} init writes one)` },
      invalid: false,
    };
  }
  try {
    await readConfig(root);
    return { check: { level: "ok", text: `${PRODUCT.configFile} valid` }, invalid: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = typeof (error as { detail?: unknown })?.detail === "string" ? (error as { detail: string }).detail : "";
    const text = detail && !message.includes(detail) ? `${message} (${detail})` : message;

    return { check: { level: "fail", text }, invalid: true };
  }
}

export async function lockfileChecks(root: string, env: NodeJS.ProcessEnv, options: DoctorOptions = {}): Promise<Check[]> {
  if (!existsSync(join(root, "package.json"))) return [];
  const present = LOCKFILES.filter(({ file }) => existsSync(join(root, file)));
  const managers = [...new Set(present.map((entry) => entry.manager))];
  const checks: Check[] = [];

  if (managers.length > 1) {
    checks.push({
      level: "warn",
      text: `Multiple conflicting lockfiles found (${present.map((entry) => entry.file).join(", ")}) — keep only one so installs and cloud deploys stay consistent`,
    });
  } else if (managers.length === 1) {
    const manager = managers[0]!;
    const file = present[0]!.file;
    let declared: string | null = null;

    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { packageManager?: unknown };

      if (typeof pkg.packageManager === "string") declared = pkg.packageManager.split("@")[0]?.trim() || null;
    } catch {
      // Unreadable package.json is handled elsewhere.
    }
    if (declared && declared !== manager) {
      checks.push({
        level: "warn",
        text: `Lockfile ${file} (${manager}) doesn't match packageManager “${declared}” in package.json`,
      });
    }
    const checkBin = await run(manager, ["--version"], root, env);

    if (checkBin.missing) {
      checks.push({
        level: "warn",
        text: `Found ${file}, but ${manager} isn't installed in PATH — install ${manager} or switch lockfiles`,
      });
    }
  } else if (options.cloud) {
    checks.push({
      level: "warn",
      text: "No lockfile found — commit a lockfile (pnpm-lock.yaml, package-lock.json, yarn.lock or bun.lock) for reproducible cloud deploys",
    });
  }
  return checks;
}

async function keyChecks(io: Io): Promise<Check[]> {
  const env = io.env;
  const checks: Check[] = [];
  let stored: SecretStatus[] = [];
  let images: { provider: string | null; providers: Array<{ id: string; label: string }> } | null = null;

  try {
    const ai = (await import("@galley/core/ai")) as Record<string, unknown>;

    if (typeof ai.createSettingsService === "function") {
      const create = ai.createSettingsService as (options: { home: string; env?: NodeJS.ProcessEnv }) => { get(): Promise<Pick<Settings, "secrets" | "images">> };
      const settings = await create({ home: defaultHome(env), env }).get();

      stored = settings.secrets;
      images = settings.images;
    }
  } catch {
    // Settings can't be read (first run, or the engine isn't built yet); the environment still counts.
  }
  const configured = (name: string, variable: string) => Boolean(env[variable]?.trim()) || stored.some((secret) => secret.name === name && secret.configured);
  const source = (variable: string) => (env[variable]?.trim() ? `${variable} (environment)` : "stored in settings");

  checks.push(
    configured("anthropic", "ANTHROPIC_API_KEY")
      ? { level: "ok", text: `assistant key: ${source("ANTHROPIC_API_KEY")}` }
      : { level: "warn", text: "No assistant key — set ANTHROPIC_API_KEY or add one in Settings; everything but chat works without it" }
  );
  // Exactly what Settings shows and generation uses: the chosen service while its key is there, else placeholder artwork.
  const chosen = images?.provider ? images.providers.find((provider) => provider.id === images!.provider) : undefined;
  const keys = [configured("openai", "OPENAI_API_KEY") ? "OpenAI" : null, configured("google", "GEMINI_API_KEY") || configured("google", "GOOGLE_API_KEY") ? "Google" : null].filter(Boolean);

  checks.push({
    level: "info",
    text: chosen
      ? `Image generation: ${chosen.label} (chosen in Settings)`
      : `Image generation: placeholder artwork — no image service is chosen in Settings${keys.length ? ` (keys found for ${keys.join(" and ")}; choose one there)` : " (add an OpenAI or Google key, then choose it there)"}`,
  });
  return checks;
}

function siteChecks(root: string, model: SiteModel, configCheck: { check: Check; invalid: boolean }): Check[] {
  const checks: Check[] = [{ level: "ok", text: frameworkLine(model) }];

  if (!model.dev) checks.push({ level: "warn", text: `No dev command found — the preview needs one: add a "dev" script to package.json or dev.command to ${PRODUCT.configFile}` });
  checks.push(
    model.build
      ? { level: "ok", text: `build: ${model.build.command} → ${model.build.outDir}` }
      : { level: "info", text: "No build command found (only needed for build mode's checks)" }
  );
  if (model.collections.length) {
    checks.push({ level: "ok", text: collectionsLine(model) });
    for (const collection of model.collections) checks.push({ level: "info", text: collectionDetail(collection) });
  } else {
    checks.push({ level: "warn", text: `No content collections found — run ${PRODUCT.slug} init and list them in ${PRODUCT.configFile}` });
  }
  checks.push({ level: "ok", text: mediaLine(model) });
  checks.push(configCheck.check);
  for (const note of model.notes) {
    if (configCheck.invalid && note.includes(PRODUCT.configFile) && note.includes("The file was ignored")) continue;
    checks.push({ level: "info", text: note });
  }
  if (existsSync(join(root, "package.json"))) {
    checks.push(
      model.installed
        ? { level: "ok", text: "dependencies installed" }
        : { level: "warn", text: `Dependencies aren't installed — run ${model.packageManager ?? "npm"} install (the preview also installs them on first start)` }
    );
  }
  return checks;
}

export async function doctorChecks(root: string, io: Io, options: DoctorOptions = {}): Promise<Check[]> {
  const checks: Check[] = [nodeCheck()];

  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    checks.push({ level: "fail", text: `There's no folder at ${root}` });
    return checks;
  }
  const configCheck = await configValidationCheck(root);
  let model: SiteModel | null = null;

  try {
    model = await loadSiteModel(root);
    checks.push(...siteChecks(root, model, configCheck));
  } catch (error) {
    checks.push(configCheck.check);
    checks.push({ level: "fail", text: `Couldn't read the site: ${error instanceof Error ? error.message : String(error)}` });
  }
  const gitCtx = await gitChecks(root, io.env);

  checks.push(...gitCtx.checks);
  checks.push(...(await localDependencyChecks(root, gitCtx, io.env)));
  checks.push(...cloudflareFileSizeChecks(root, model, options));
  checks.push(...(await lockfileChecks(root, io.env, options)));
  checks.push(...(await keyChecks(io)));
  return checks;
}

export function formatCheck(check: Check): string {
  return check.level === "info" ? `  ${check.text}` : `${check.level === "ok" ? "✓" : "!"} ${check.text}`;
}

export async function doctorCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse("doctor", argv, { json: { type: "boolean" }, cloud: { type: "boolean" } });

  if (values.help) {
    io.out(DOCTOR_HELP);
    return 0;
  }
  const root = resolve(io.cwd, positionals[0] ?? ".");
  const checks = await doctorChecks(root, io, { cloud: Boolean(values.cloud) });
  const failed = checks.some((check) => check.level === "fail");

  if (values.json) io.out(JSON.stringify({ path: root, ok: !failed, checks }, null, 2));
  else {
    for (const check of checks) io.out(formatCheck(check));
    if (failed) {
      io.out("");
      io.out(`${PRODUCT.name} can't work here until ${checks.filter((check) => check.level === "fail").length === 1 ? "this is" : "these are"} fixed:`);
      for (const check of checks) if (check.level === "fail") io.out(formatCheck(check));
    }
  }
  return failed ? 1 : 0;
}
