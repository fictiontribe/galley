import { existsSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { detectSite, serializeConfig } from "@galley/core/content";
import type { GalleyConfig, SiteModel } from "@galley/core/types";
import { parse } from "../args";
import type { Io } from "../io";
import { collectionsLine, frameworkLine } from "../summary";

export const INIT_HELP = `Usage: ${PRODUCT.slug} init [path] [options]

Write ${PRODUCT.configFile} in [path] (default: this folder) from what detection
finds: the site's name, its live addresses, and each collection's id, label
and URL pattern. Everything else keeps coming from detection.

Options
      --force   Replace an existing ${PRODUCT.configFile}
      --json    Print the result as JSON
  -h, --help    Show this help`;

/** Only what a person might want to adjust; the rest stays with detection. */
export function starterConfig(model: SiteModel): GalleyConfig {
  const config: GalleyConfig = { name: model.name };
  const urls = Object.fromEntries(Object.entries(model.urls).filter(([, value]) => value));

  if (Object.keys(urls).length) config.urls = urls;
  config.collections = model.collections.map((collection) => ({ id: collection.id, label: collection.label, url: collection.url }));
  return config;
}

export async function initCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse("init", argv, { force: { type: "boolean" }, json: { type: "boolean" } });

  if (values.help) {
    io.out(INIT_HELP);
    return 0;
  }
  const root = resolve(io.cwd, positionals[0] ?? ".");

  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    io.err(`There's no folder at ${root}.`);
    return 1;
  }
  const file = join(root, PRODUCT.configFile);

  if (existsSync(file) && !values.force) {
    io.err(`${PRODUCT.configFile} already exists in ${root}. Run again with --force to replace it.`);
    return 1;
  }
  const model = await detectSite(root);
  const config = starterConfig(model);

  await writeFile(file, serializeConfig(config));
  if (values.json) {
    io.out(JSON.stringify({ path: file, config }, null, 2));
    return 0;
  }
  io.out(`✓ ${frameworkLine(model)}`);
  io.out(`${model.collections.length ? "✓" : "!"} ${model.collections.length ? collectionsLine(model) : "No collections found — add them to the file by hand"}`);
  if (!config.urls) io.out("! No live site address found — add urls.production to compare previews with the live site");
  io.out(`✓ Wrote ${file}`);
  return 0;
}
