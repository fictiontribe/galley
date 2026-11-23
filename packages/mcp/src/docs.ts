/** The generated regions of docs/mcp.md, rendered from the code (see reference.ts). */
import { PRODUCT } from "@galley/core/brand";
import { replaceBetween, setupReference, toolReference } from "./reference";

export const DOCS_FILE = "docs/mcp.md";

export function renderDocs(document: string): string {
  const setup = setupReference({ serverName: PRODUCT.slug, productName: PRODUCT.name, cliName: PRODUCT.slug, tokenEnv: `${PRODUCT.slug.toUpperCase()}_MCP_TOKEN` });

  return replaceBetween(replaceBetween(document, "setup", setup), "tools", toolReference());
}
