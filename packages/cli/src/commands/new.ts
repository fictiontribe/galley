import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { isGalleyError } from "@galley/core";
import { listStarters, scaffoldSite } from "@galley/core/site";
import { detectPackageManager, installDependencies, packageName } from "@galley/core/workspace";
import { loadSiteModel } from "@galley/core/content";
import { parse, UsageError } from "../args";
import type { Io } from "../io";
import { openCommand } from "./open";
import { starterLine, startersDir } from "./starters";

export const NEW_HELP = `Usage: ${PRODUCT.slug} new <name> [options]

Start a new site from a starter: copy it into a new folder with your site's
name, install its dependencies, record a first version with git, then open it
as \`${PRODUCT.slug} <folder>\` would.

Options
      --starter <id>    Starter to copy (default: astro-starter)
      --look <id>       One of the starter's looks (default: its first)
      --dir <folder>    Where to create the site's folder (default: this folder)
      --no-start        Stop after creating it
      --skip-install    Don't install dependencies
  -p, --port <port>     Port for the server when it starts
  -h, --help            Show this help

Run \`${PRODUCT.slug} starters\` to see the starters and their looks.`;

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
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

export async function newCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse("new", argv, {
    starter: { type: "string" },
    look: { type: "string" },
    dir: { type: "string" },
    "no-start": { type: "boolean" },
    "skip-install": { type: "boolean" },
    port: { type: "string", short: "p" },
  });

  if (values.help) {
    const starters = await listStarters(startersDir(io.env));

    io.out(NEW_HELP);
    if (starters.length) {
      io.out("");
      io.out("Starters");
      for (const starter of starters) io.out(`  ${starterLine(starter)}`);
    }
    return 0;
  }
  const name = positionals[0]?.trim();

  if (!name) throw new UsageError(`Name the new site, e.g. ${PRODUCT.slug} new my-site`);
  const dir = startersDir(io.env);
  const starters = await listStarters(dir);
  const ids = starters.map((starter) => starter.id);
  const starter = values.starter ?? (ids.includes("astro-starter") ? "astro-starter" : ids[0]);

  if (!starter || !ids.includes(starter)) {
    io.err(starters.length ? `There's no starter called “${starter}”. Available: ${ids.join(", ")}.` : `No starters were found in ${dir}. Set GALLEY_STARTERS_DIR to the folder that holds them.`);
    return 1;
  }
  const looks = starters.find((candidate) => candidate.id === starter)?.looks ?? [];

  if (values.look !== undefined && !looks.some((look) => look.id === values.look)) {
    io.err(
      looks.length
        ? `${starter} has no look called “${values.look}”. Available: ${looks.map((look) => look.id).join(", ")}.`
        : `${starter} has only one look, so --look can't be used with it.`
    );
    return 1;
  }
  const parent = resolve(io.cwd, values.dir ?? ".");
  const target = join(parent, packageName(name));

  if (statSync(target, { throwIfNoEntry: false })) {
    io.err(`${target} already exists. Choose another name, or another folder with --dir.`);
    return 1;
  }
  io.out(`Creating “${name}” in ${target} from ${starter}${values.look ? ` (${values.look})` : ""}…`);
  let installProblem: { message: string; detail?: string; manager: string } | null = null;

  try {
    await scaffoldSite({
      starterDir: join(dir, starter),
      targetDir: target,
      name,
      ...(values.look ? { look: values.look } : {}),
      // Installed before the first version is recorded, so its lock file is in it and the site starts with no changes.
      beforeFirstVersion: async (root) => {
        if (values["skip-install"]) return;
        const model = await loadSiteModel(root).catch(() => null);
        const manager = model?.packageManager ?? detectPackageManager(root);

        io.out(`Installing dependencies with ${manager} (this can take a minute)…`);
        try {
          await installDependencies(root, manager, undefined, model?.environment);
          io.out("✓ Dependencies installed");
        } catch (error) {
          installProblem = { message: isGalleyError(error) ? error.message : String(error), ...(isGalleyError(error) && error.detail ? { detail: error.detail } : {}), manager };
        }
      },
    });
  } catch (error) {
    io.err(isGalleyError(error) ? error.message : `Couldn't create the site: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  io.out("✓ Copied the starter and recorded the first version");
  const shown = shownPath(io.cwd, target);
  const quoted = shown.includes(" ") ? JSON.stringify(shown) : shown;
  const problem = installProblem as { message: string; detail?: string; manager: string } | null;

  if (problem) {
    io.err(`! ${problem.message}`);
    if (problem.detail) io.err(problem.detail);
    io.err(`The site is in ${target}. Install its dependencies with ${problem.manager} install, then run ${PRODUCT.slug} ${quoted}.`);
    return 1;
  }
  if (values["no-start"]) {
    io.out(`Next: ${PRODUCT.slug} ${quoted}`);
    return 0;
  }
  return openCommand([target, ...(values.port ? ["--port", values.port] : [])], io);
}
