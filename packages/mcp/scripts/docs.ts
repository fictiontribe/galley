/**
 * Rewrites the generated parts of docs/mcp.md — the tool reference and the
 * client setup snippets — from the code. Run: pnpm --filter @galley/mcp docs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOCS_FILE, renderDocs } from "../src/docs";

const file = fileURLToPath(new URL(`../../../${DOCS_FILE}`, import.meta.url));
const before = readFileSync(file, "utf8");
const after = renderDocs(before);

if (after === before) process.stderr.write(`${DOCS_FILE} is up to date.\n`);
else {
  writeFileSync(file, after);
  process.stderr.write(`Updated ${DOCS_FILE}.\n`);
}
