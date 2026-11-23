// Regenerates the documentation pages that are rendered from repository files
// (see docs-sources.mjs), and the JSON Schemas in public/schema (galley schema --out). check-docs fails until this has been run after the
// source changes.
import { mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GENERATED, relativeTarget, render, renderSchemas, SCHEMA_DIR, siteRoot, targetPath } from "./docs-sources.mjs";

for (const entry of GENERATED) {
  const next = render(entry);
  const file = targetPath(entry);
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;

  if (current === next) {
    console.log(`up to date: ${relativeTarget(entry)}`);
    continue;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
  console.log(`wrote ${relativeTarget(entry)} from ${entry.source}`);
}

// The JSON Schemas this site serves at /schema/…, from the CLI.
const schemas = renderSchemas();
const dir = join(siteRoot, SCHEMA_DIR);
mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(schemas)) {
  const file = join(dir, name);
  if (existsSync(file) && readFileSync(file, "utf8") === text) {
    console.log(`up to date: apps/site/${SCHEMA_DIR}/${name}`);
    continue;
  }
  writeFileSync(file, text);
  console.log(`wrote apps/site/${SCHEMA_DIR}/${name} from galley schema --out`);
}
for (const name of readdirSync(dir)) {
  if (name in schemas) continue;
  rmSync(join(dir, name));
  console.log(`removed apps/site/${SCHEMA_DIR}/${name} (the CLI no longer writes it)`);
}
