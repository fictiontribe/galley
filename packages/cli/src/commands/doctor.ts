import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { loadSiteModel } from "@galley/core/content";
import type { SecretStatus, Settings, SiteModel } from "@galley/core/types";
import { defaultHome } from "@galley/server";
import { parse, plural } from "../args";
import type { Io } from "../io";
import { collectionDetail, collectionsLine, frameworkLine, mediaLine } from "../summary";

export const DOCTOR_HELP = `Usage: ${PRODUCT.slug} doctor [path] [options]

Check that the site in [path] (default: this folder) and this computer are
ready: what detection finds, Node, git, dependencies, and the assistant's key.
Exits with 1 when something would stop ${PRODUCT.name} from working.

Options
      --json   Print the checks as JSON
  -h, --help   Show this help`;

export const MIN_NODE = [20, 11] as const;

export interface Check {
  /** "ok" ✓, "warn" ! (works, with a caveat), "fail" ! (stops the app working), "info" (indented note). */
  level: "ok" | "warn" | "fail" | "info";
  text: string;
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

async function gitChecks(root: string, env: NodeJS.ProcessEnv): Promise<Check[]> {
  const git = (args: string[]) => run("git", args, root, env);

  const version = await git(["--version"]);

  if (version.missing || !version.ok) return [{ level: "fail", text: "git isn't installed — install it from git-scm.com; publishing and change tracking need it" }];
  const inside = await git(["rev-parse", "--is-inside-work-tree"]);

  if (!inside.ok || inside.stdout.trim() !== "true") {
    return [{ level: "warn", text: `${version.stdout.trim()} · this folder isn't a git repository — editing works, publishing needs it: run git init` }];
  }
  const branch = (await git(["symbolic-ref", "--short", "-q", "HEAD"])).stdout.trim() || "a detached version";
  const status = await git(["status", "--porcelain"]);
  const pending = status.stdout.split("\n").filter(Boolean).length;
  const hasCommits = (await git(["rev-parse", "-q", "--verify", "HEAD"])).ok;
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

function siteChecks(root: string, model: SiteModel): Check[] {
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
  checks.push(
    existsSync(join(root, PRODUCT.configFile))
      ? { level: "ok", text: `${PRODUCT.configFile} found` }
      : { level: "info", text: `No ${PRODUCT.configFile} (optional; ${PRODUCT.slug} init writes one)` }
  );
  for (const note of model.notes) checks.push({ level: "info", text: note });
  if (existsSync(join(root, "package.json"))) {
    checks.push(
      model.installed
        ? { level: "ok", text: "dependencies installed" }
        : { level: "warn", text: `Dependencies aren't installed — run ${model.packageManager ?? "npm"} install (the preview also installs them on first start)` }
    );
  }
  return checks;
}

export async function doctorChecks(root: string, io: Io): Promise<Check[]> {
  const checks: Check[] = [nodeCheck()];

  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    checks.push({ level: "fail", text: `There's no folder at ${root}` });
    return checks;
  }
  try {
    checks.push(...siteChecks(root, await loadSiteModel(root)));
  } catch (error) {
    checks.push({ level: "fail", text: `Couldn't read the site: ${error instanceof Error ? error.message : String(error)}` });
  }
  checks.push(...(await gitChecks(root, io.env)));
  checks.push(...(await keyChecks(io)));
  return checks;
}

export function formatCheck(check: Check): string {
  return check.level === "info" ? `  ${check.text}` : `${check.level === "ok" ? "✓" : "!"} ${check.text}`;
}

export async function doctorCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse("doctor", argv, { json: { type: "boolean" } });

  if (values.help) {
    io.out(DOCTOR_HELP);
    return 0;
  }
  const root = resolve(io.cwd, positionals[0] ?? ".");
  const checks = await doctorChecks(root, io);
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
