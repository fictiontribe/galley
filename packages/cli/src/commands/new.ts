import { execFile } from "node:child_process";
import { accessSync, constants, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { isGalleyError } from "@galley/core";
import { scaffoldSite } from "@galley/core/site";
import { detectPackageManager, installDependencies, packageName } from "@galley/core/workspace";
import { loadSiteModel } from "@galley/core/content";
import type { PackageManager } from "@galley/core/types";
import { parse, portOption, UsageError } from "../args";
import type { Io } from "../io";
import { invokingManager, isManager, runCommandFor } from "../package-manager";
import {
  cancelled,
  folderNotEmpty,
  gitMissing,
  installFailed,
  installOffline,
  installTimedOut,
  looksOffline,
  managerMissing,
  nodeTooOld,
  notAFolder,
  olderThan,
  registryHost,
  unknownStarter,
} from "../problems";
import { DEFAULT_STARTER, displayName, findStarter, loadStarterChoices, shortList, type StarterChoice } from "../starter-choices";
import { openCommand } from "./open";
import { starterBlock, startersDir } from "./starters";

export const NEW_HELP = `Usage: ${PRODUCT.slug} new [name] [options]

Start a new site from a starter: copy it into a new folder named after the
site, install its dependencies, record the first version, and open
${PRODUCT.name} on it in the browser. In a terminal it asks for the name and
the starter when they're missing.

Options
      --starter <name>  Which starter (default: ${DEFAULT_STARTER}); they're listed below
      --look <id>       One of the starter's looks (default: its first)
      --dir <folder>    Where to make the site's folder (default: this folder)
      --use <manager>   Install with npm, pnpm, yarn or bun (default: the one that ran this)
      --no-install      Don't install dependencies
      --no-open         Start ${PRODUCT.name}, but don't open the browser
      --no-start        Stop once the site is made
  -p, --port <port>     Port for ${PRODUCT.name} (default 4400, or the next free one)
  -h, --help            Show this help`;

/** What the default name is when none is given. */
export const DEFAULT_NAME = "my-site";

/** The real path of `path`, or of its nearest folder that exists, with the rest added back. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);

    return parent === path ? path : join(real(parent), basename(path));
  }
}

/**
 * How to name `target` from `cwd` in a hint: relative when it is inside, the
 * full path otherwise. Both are compared as real paths, so a folder reached
 * through a symlink (macOS's /tmp → /private/tmp) still reads as inside.
 */
export function shownPath(cwd: string, target: string): string {
  const rel = relative(real(cwd), real(target));

  if (rel === "") return ".";
  return rel.startsWith("..") || isAbsolute(rel) ? target : rel;
}

/** A path as it would be typed after `cd`, quoted when it has a space. */
function typed(path: string): string {
  return /\s/.test(path) ? JSON.stringify(path) : path;
}

/** "my-site" → "My site"; anything with capitals or spaces stays as typed. */
export function siteName(input: string): string {
  const text = input.trim();

  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(text)) return text;
  const words = text.replace(/[-_]+/g, " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Where a site goes and what it is called. A plain name ("Harbour Notes")
 * becomes a folder (harbour-notes) inside --dir; something that looks like
 * a path (".", "sites/shop", "~/shop") is the folder itself.
 */
export function placeSite(cwd: string, dir: string | undefined, input: string): { name: string; target: string } {
  const parent = resolve(cwd, dir ?? ".");
  const text = input.trim();

  if (text === "." || text === ".." || /[\\/]/.test(text) || text.startsWith("~")) {
    const expanded = text === "~" || text.startsWith("~/") ? join(homedir(), text.slice(1)) : text;
    const target = resolve(parent, expanded);

    return { name: siteName(basename(target)), target };
  }
  return { name: siteName(text), target: join(parent, packageName(text)) };
}

type FolderState = "free" | "empty" | "full" | "file";

export function folderState(path: string): FolderState {
  const info = statSync(path, { throwIfNoEntry: false });

  if (!info) return "free";
  if (!info.isDirectory()) return "file";
  return readdirSync(path).length === 0 ? "empty" : "full";
}

/** The first of my-site, my-site-2, my-site-3… that can be made in `parent`. */
export function freeName(parent: string, base: string): string {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const state = folderState(join(parent, candidate));

    if (state === "free" || state === "empty") return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** Is `name` a program on this PATH? */
export function onPath(name: string, env: NodeJS.ProcessEnv): boolean {
  const extensions = process.platform === "win32" ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").toLowerCase().split(";")] : [""];

  for (const folder of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (!folder) continue;
    for (const extension of extensions) {
      try {
        accessSync(join(folder, name + extension), constants.X_OK);
        return true;
      } catch {
        // Not here.
      }
    }
  }
  return false;
}

function hasGit(env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((done) => {
    execFile("git", ["--version"], { env, timeout: 15_000 }, (error) => done(!error));
  });
}

/** The folder problem for a target, or null when a site can be made there. */
function folderProblem(io: Io, target: string): string | null {
  const state = folderState(target);
  const shown = shownPath(io.cwd, target);

  if (state === "file") return notAFolder(shown);
  if (state === "full") return folderNotEmpty(shown, freeName(dirname(target), basename(target)));
  return null;
}

/**
 * The next-steps block every finished `new` ends with. `install` is the
 * install command still to run (with --no-install), or null.
 */
export function nextSteps(folder: string, run: string, running: boolean, install: string | null = null): string[] {
  const then = install ? `${install}, then ${run}` : run;

  return [
    "",
    "Next",
    "  1. Change something: edit a page in its form or on the page, or ask the assistant.",
    "  2. Check it in Proof, beside the live site.",
    "  3. Publish when it looks right.",
    "",
    running ? `To come back to it later: cd ${typed(folder)}, then ${run}` : `To start ${PRODUCT.name} on it: cd ${typed(folder)}, then ${then}`,
  ];
}

function seconds(ms: number): string {
  const s = Math.round(ms / 1000);

  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

interface InstallProblem {
  text: string;
  tail: string[];
}

async function install(io: Io, root: string, manager: PackageManager, environment: Record<string, string> | undefined, shown: string, run: string): Promise<InstallProblem | null> {
  const started = Date.now();
  const label = `Installing dependencies with ${manager}`;
  const tick = io.status ? setInterval(() => io.status?.(`${label}… ${seconds(Date.now() - started)}`), 1000) : null;

  if (io.status) io.status(`${label}…`);
  else io.out(`${label}. This usually takes a minute or two.`);
  try {
    await installDependencies(root, manager, undefined, environment);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = isGalleyError(error) && error.detail ? error.detail : message;
    const tail = detail.split("\n").map((line) => line.trimEnd()).filter(Boolean).slice(-12);

    if (/took too long/.test(message)) return { text: installTimedOut(manager, shown, run), tail };
    if (looksOffline(detail)) return { text: installOffline(manager, registryHost(io.env), shown, run), tail: [] };
    return { text: installFailed(manager, shown, run), tail };
  } finally {
    if (tick) clearInterval(tick);
    io.status?.(null);
  }
}

export async function newCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse("new", argv, {
    starter: { type: "string" },
    look: { type: "string" },
    dir: { type: "string" },
    use: { type: "string" },
    "no-start": { type: "boolean" },
    "no-open": { type: "boolean" },
    "no-install": { type: "boolean" },
    // The older spelling of --no-install.
    "skip-install": { type: "boolean" },
    port: { type: "string", short: "p" },
  });
  const startersFolder = startersDir(io.env);
  const choices = await loadStarterChoices(startersFolder);

  if (values.help) {
    io.out(NEW_HELP);
    if (choices.length) {
      io.out("");
      io.out("Starters");
      choices.forEach((choice, index) => {
        if (index > 0) io.out("");
        for (const line of starterBlock(choice, invokingManager(io.env))) io.out(`  ${line}`);
      });
    }
    return 0;
  }
  if (choices.length === 0) {
    io.err(`No starters were found in ${startersFolder}. Set GALLEY_STARTERS_DIR to the folder that holds them.`);
    return 1;
  }
  if (values.port !== undefined) portOption(values.port);
  if (values.use !== undefined && !isManager(values.use)) throw new UsageError(`--use takes npm, pnpm, yarn or bun, not “${values.use}”.`);
  const skipInstall = Boolean(values["no-install"] || values["skip-install"]);
  const manager: PackageManager | null = (values.use as PackageManager | undefined) ?? invokingManager(io.env);

  // Everything that can be checked before a question is asked or a file is copied is checked first.
  let choice: StarterChoice | null = null;

  if (values.starter !== undefined) {
    choice = findStarter(choices, values.starter);
    if (!choice) {
      io.err(unknownStarter(values.starter, shortList(choices)));
      return 1;
    }
  }
  if (manager && !skipInstall && !onPath(manager, io.env)) {
    io.err(managerMissing(manager));
    return 1;
  }
  if (!(await hasGit(io.env))) {
    io.err(gitMissing(io.platform ?? process.platform));
    return 1;
  }

  // The name, and from it the folder.
  const parent = resolve(io.cwd, values.dir ?? ".");
  let input = positionals[0]?.trim() ?? "";

  if (!input) {
    const fallback = freeName(parent, DEFAULT_NAME);

    if (io.ask) {
      for (;;) {
        const answer = await io.ask.text("What should the site be called?", fallback);

        if (answer === null) {
          io.err(cancelled());
          return 130;
        }
        const problem = folderProblem(io, placeSite(io.cwd, values.dir, answer).target);

        if (!problem) {
          input = answer;
          break;
        }
        io.err(problem);
      }
    } else {
      input = fallback;
      io.out(`No name given, so the site is called “${siteName(fallback)}”, in ${shownPath(io.cwd, join(parent, fallback))}.`);
    }
  }
  const { name, target } = placeSite(io.cwd, values.dir, input);
  const folderIssue = folderProblem(io, target);

  if (folderIssue) {
    io.err(folderIssue);
    return 1;
  }

  // The starter.
  if (!choice) {
    const fallback = findStarter(choices, DEFAULT_STARTER) ?? choices[0]!;

    if (io.ask) {
      const picked = await io.ask.choose(
        "Which starter?",
        choices.map((candidate) => ({ label: displayName(candidate), summary: candidate.summary, detail: candidate.inside })),
        choices.indexOf(fallback)
      );

      if (picked === null) {
        io.err(cancelled());
        return 130;
      }
      choice = choices[picked]!;
    } else {
      choice = fallback;
      const others = choices.filter((candidate) => candidate !== fallback);

      io.out(`No starter chosen, so this uses ${displayName(fallback)}: ${fallback.summary.charAt(0).toLowerCase()}${fallback.summary.slice(1)}.${others.length ? ` For another, add --starter ${shortList(others)}.` : ""}`);
    }
  }
  const looks = choice.info.looks ?? [];

  if (values.look !== undefined && !looks.some((look) => look.id === values.look)) {
    io.err(
      looks.length
        ? `${displayName(choice)} has no look called “${values.look}”. Choose ${looks.map((look) => look.id).join(", ")}.`
        : `${displayName(choice)} has only one look, so --look can't be used with it.`
    );
    return 1;
  }
  const nodeVersion = io.nodeVersion ?? process.versions.node;

  if (choice.node && olderThan(nodeVersion, choice.node)) {
    io.err(nodeTooOld(displayName(choice), choice.node, nodeVersion));
    return 1;
  }

  const shown = shownPath(io.cwd, target);
  let problem: InstallProblem | null = null;
  let installedWith: PackageManager | null = null;

  io.out(`Making “${name}” from ${displayName(choice)}${values.look ? ` (${values.look})` : ""} in ${shown}`);
  try {
    await scaffoldSite({
      starterDir: join(startersFolder, choice.id),
      targetDir: target,
      name,
      ...(values.look ? { look: values.look } : {}),
      // Installed before the first version is recorded, so the lock file is in it and the site starts with no changes.
      beforeFirstVersion: async (root) => {
        io.out(`✓ Copied the starter`);
        if (skipInstall) return;
        const model = await loadSiteModel(root).catch(() => null);
        const chosen = manager ?? model?.packageManager ?? detectPackageManager(root);
        const started = Date.now();

        problem = await install(io, root, chosen, model?.environment, shown, runCommandFor(chosen));
        if (!problem) {
          installedWith = chosen;
          io.out(`✓ Installed dependencies with ${chosen} (${seconds(Date.now() - started)})`);
        }
      },
    });
  } catch (error) {
    io.err(isGalleyError(error) ? error.message : `Couldn't make the site: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  io.out("✓ Recorded the first version");
  const failed = problem as InstallProblem | null;

  if (failed) {
    if (failed.tail.length) {
      io.err("");
      for (const line of failed.tail) io.err(`  ${line}`);
      io.err("");
    }
    io.err(failed.text);
    return 1;
  }
  const comeBack = runCommandFor(installedWith ?? manager);

  // Without its dependencies the preview can't run, so --no-install stops here too.
  if (values["no-start"] || skipInstall) {
    for (const line of nextSteps(shown, comeBack, false, skipInstall ? `${manager ?? "npm"} install` : null)) io.out(line);
    return 0;
  }
  return openCommand([target, ...(values.port ? ["--port", values.port] : []), ...(values["no-open"] ? ["--no-open"] : [])], io, {
    afterStart: () => {
      for (const line of nextSteps(shown, comeBack, true)) io.out(line);
      io.out("");
    },
  });
}
