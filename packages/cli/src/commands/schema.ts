import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONFIG_SCHEMA_URL, PRODUCT } from "@galley/core/brand";
import { configJsonSchema } from "@galley/core/content";
import { BRAND_SCHEMA_URL, brandJsonSchema } from "@galley/core/sitebrand";
import { THEME_SCHEMA_URL, themeJsonSchema } from "@galley/core/themes";
import { parse } from "../args";
import type { Io } from "../io";

/** Every JSON Schema the app's files name in `$schema`, with the address each must be served at. */
export const SCHEMAS = [
  { url: CONFIG_SCHEMA_URL, describe: `${PRODUCT.configFile} — a site's configuration`, make: configJsonSchema },
  { url: BRAND_SCHEMA_URL, describe: "brand.json — a site's brand (galley/brand/brand.json)", make: brandJsonSchema },
  { url: THEME_SCHEMA_URL, describe: "a theme for the editing app (brand/themes/theme.schema.json)", make: themeJsonSchema },
] as const;

/** The file name a schema is written as: the last part of its address ("galley.config.json", "brand.json"). */
export function schemaFileName(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).pop() ?? "schema.json";
}

export const SCHEMA_HELP = `Usage: ${PRODUCT.slug} schema [--out <folder>]

Print the JSON Schema of ${PRODUCT.configFile} — the file editors fetch from
${CONFIG_SCHEMA_URL} to check and autocomplete the config.

With --out, write every schema the app's files name instead, one file each,
and list the address each must be served at:
${SCHEMAS.map((schema) => `  ${schemaFileName(schema.url).padEnd(20)} ${schema.url}`).join("\n")}

Options
  -o, --out <folder>   Write the schemas into this folder (it is created)
  -h, --help           Show this help`;

export async function schemaCommand(argv: string[], io: Io): Promise<number> {
  const { values } = parse("schema", argv, { out: { type: "string", short: "o" } }, 0);

  if (values.help) {
    io.out(SCHEMA_HELP);
    return 0;
  }
  if (typeof values.out !== "string") {
    io.out(JSON.stringify(configJsonSchema(), null, 2));
    return 0;
  }
  const folder = resolve(io.cwd, values.out);

  await mkdir(folder, { recursive: true });
  io.out(`Wrote ${SCHEMAS.length} schemas. Serve each file at its address, as application/json (or application/schema+json):`);
  for (const schema of SCHEMAS) {
    const file = join(folder, schemaFileName(schema.url));

    await writeFile(file, `${JSON.stringify(schema.make(), null, 2)}\n`);
    io.out(`  ✓ ${file}`);
    io.out(`    → ${schema.url}   (${schema.describe})`);
  }
  return 0;
}
