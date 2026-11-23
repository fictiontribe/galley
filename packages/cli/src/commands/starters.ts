import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { listStarters } from "@galley/core/site";
import type { StarterInfo } from "@galley/core/types";
import { defaultStartersDir } from "@galley/server";
import { parse } from "../args";
import type { Io } from "../io";

export const STARTERS_HELP = `Usage: ${PRODUCT.slug} starters [--json]

List the starters \`${PRODUCT.slug} new\` can copy, with the looks each one ships.

Options
      --json   Print them as JSON
  -h, --help   Show this help`;

export function startersDir(env: NodeJS.ProcessEnv): string {
  return resolve(env.GALLEY_STARTERS_DIR?.trim() || defaultStartersDir());
}

/** "astro-starter — Galley astro starter (astro) · looks: harbour (default), dusk" */
export function starterLine(starter: StarterInfo): string {
  const looks = starter.looks?.length ? ` · looks: ${starter.looks.map((look, index) => `${look.id}${index === 0 ? " (default)" : ""}`).join(", ")}` : "";

  return `${starter.id} — ${starter.name} (${starter.framework})${looks}`;
}

export async function startersCommand(argv: string[], io: Io): Promise<number> {
  const { values } = parse("starters", argv, { json: { type: "boolean" } }, 0);

  if (values.help) {
    io.out(STARTERS_HELP);
    return 0;
  }
  const dir = startersDir(io.env);
  const starters = await listStarters(dir);

  if (values.json) {
    io.out(JSON.stringify(starters.map(({ previewUrl: _preview, looks, ...rest }) => ({ ...rest, ...(looks ? { looks: looks.map(({ previewUrl: _look, ...look }) => look) } : {}) })), null, 2));
    return 0;
  }
  if (starters.length === 0) {
    io.err(`No starters were found in ${dir}. Set GALLEY_STARTERS_DIR to the folder that holds them.`);
    return 1;
  }
  for (const starter of starters) {
    io.out(starterLine(starter));
    if (starter.description) io.out(`  ${starter.description}`);
  }
  return 0;
}
