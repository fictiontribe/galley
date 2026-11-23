import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import type { PackageManager } from "@galley/core/types";
import { defaultStartersDir } from "@galley/server";
import { parse } from "../args";
import type { Io } from "../io";
import { createCommandFor, invokingManager, runCommandFor } from "../package-manager";
import { DEFAULT_STARTER, loadStarterChoices, type StarterChoice } from "../starter-choices";

export const STARTERS_HELP = `Usage: ${PRODUCT.slug} starters [--json]

List the starters \`${PRODUCT.slug} new\` can copy: what each one is, what is
inside, and the command that makes a site from it.

Options
      --json   Print them as JSON
  -h, --help   Show this help`;

export function startersDir(env: NodeJS.ProcessEnv): string {
  return resolve(env.GALLEY_STARTERS_DIR?.trim() || defaultStartersDir());
}

function looksLine(choice: StarterChoice): string {
  const looks = choice.info.looks ?? [];

  return looks.length ? ` · looks: ${looks.map((look, index) => `${look.id}${index === 0 ? " (default)" : ""}`).join(", ")}` : "";
}

/**
 *   caddow: Caddow — fashion editorial
 *     A photography-led site for a small fashion label
 *     20 sections · 6 page templates · looks: chalk (default), paper, night
 *     npm create galley@latest my-site -- --starter caddow
 */
export function starterBlock(choice: StarterChoice, manager: PackageManager | null): string[] {
  const looks = looksLine(choice);
  // The looks are named, so their count goes.
  const inside = [looks ? choice.inside.replace(/(?: · )?\d+ looks?$/, "") : choice.inside, looks.replace(/^ · /, "")].filter(Boolean).join(" · ");

  return [
    `${choice.short}: ${choice.name}${choice.short === DEFAULT_STARTER ? " (the default)" : ""}`,
    `  ${choice.summary}`,
    ...(inside ? [`  ${inside}`] : []),
    `  ${createCommandFor(manager, "my-site", choice.short)}`,
  ];
}

export async function startersCommand(argv: string[], io: Io): Promise<number> {
  const { values } = parse("starters", argv, { json: { type: "boolean" } }, 0);

  if (values.help) {
    io.out(STARTERS_HELP);
    return 0;
  }
  const dir = startersDir(io.env);
  const choices = await loadStarterChoices(dir);
  const manager = invokingManager(io.env);

  if (values.json) {
    io.out(
      JSON.stringify(
        choices.map(({ info: { previewUrl: _preview, looks, ...info }, short, summary, inside }) => ({
          ...info,
          short,
          summary,
          inside,
          command: createCommandFor(manager, "my-site", short),
          ...(looks ? { looks: looks.map(({ previewUrl: _look, ...look }) => look) } : {}),
        })),
        null,
        2
      )
    );
    return 0;
  }
  if (choices.length === 0) {
    io.err(`No starters were found in ${dir}. Set GALLEY_STARTERS_DIR to the folder that holds them.`);
    return 1;
  }
  choices.forEach((choice, index) => {
    if (index > 0) io.out("");
    for (const line of starterBlock(choice, manager)) io.out(line);
  });
  io.out("");
  io.out(`To open a site you made before, run \`${runCommandFor(manager)}\` in its folder.`);
  return 0;
}
