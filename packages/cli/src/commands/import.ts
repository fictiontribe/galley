/**
 * `galley import <id> …` — one door for every importer. The id is looked up
 * in the plugin registry (the WordPress importer ships with the app; a plugin
 * can add others) and the rest of the arguments go to that importer's own
 * command, which owns its options and its help. `galley import` alone lists
 * what can be imported from.
 */
import { PRODUCT } from "@galley/core/brand";
import { createFileSecretStore, createSettingsService } from "@galley/core/ai";
import type { ImporterInfo } from "@galley/core/plugins";
import { createPluginSystem, defaultHome } from "@galley/server";
import type { Io } from "../io";

function listing(importers: ImporterInfo[]): string {
  const width = Math.max(8, ...importers.map((importer) => importer.id.length));
  const input = { url: "an address", file: "a file", "url-or-file": "an address or an export file" } as const;

  return [
    `Usage: ${PRODUCT.slug} import <from> <source> [path] [options]`,
    "",
    `Bring another site's content into this one. It arrives as pending changes: check it in Proof, then publish.`,
    "",
    importers.length ? "You can import from" : `Nothing to import from: no importer is turned on. \`${PRODUCT.slug} plugin list\` shows them.`,
    ...importers.flatMap((importer) => [
      `  ${importer.id.padEnd(width)}  ${importer.name}, from ${input[importer.input]}${importer.command ? "" : " (in the app only)"}`,
      `  ${" ".repeat(width)}  ${importer.description}`,
    ]),
    "",
    `Run \`${PRODUCT.slug} import <from> --help\` for its options, e.g. \`${PRODUCT.slug} import ${importers[0]?.id ?? "wordpress"} --help\`.`,
  ].join("\n");
}

export async function importCommand(argv: string[], io: Io): Promise<number> {
  const [id, ...rest] = argv;
  const home = defaultHome(io.env);
  const secrets = createFileSecretStore(home);
  const plugins = await createPluginSystem({ home, env: io.env, settings: createSettingsService({ home, env: io.env, secretStore: secrets }), secrets });

  try {
    const importers = plugins.importers(null);

    if (id === undefined || id === "--help" || id === "-h" || id === "help") {
      if (argv.includes("--json")) io.out(JSON.stringify({ importers }, null, 2));
      else io.out(listing(importers));
      return 0;
    }
    if (id === "--json") {
      io.out(JSON.stringify({ importers }, null, 2));
      return 0;
    }
    const importer = plugins.importer(id, null);

    if (!importer) {
      io.err(`There's no importer called “${id}” here.${importers.length ? ` You can import from: ${importers.map((entry) => entry.id).join(", ")}.` : ""} Run \`${PRODUCT.slug} import\` to see them.`);
      return 2;
    }
    if (!importer.command) {
      io.err(`${importer.name} can be imported from in the app, but not from the command line.`);
      return 1;
    }
    return await importer.command.run(rest, { out: io.out, err: io.err, cwd: io.cwd, env: io.env });
  } finally {
    await plugins.dispose();
  }
}
