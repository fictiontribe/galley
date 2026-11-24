// Vendored from @galley/astro 0.2.0 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The site kit's build step for a vendored kit: the agent-readable version of
// the site (markdown twins, llms.txt, llms-full.txt, agent.md, structured
// data, robots.txt and sitemap.xml when the site has none of its own), from
// src/data/visibility.json. In astro.config:
//
//   import galley from "./src/galley/integration.js";
//   export default defineConfig({ integrations: [galley()] });
//
// galley({ visibility: false }) turns it off; galley({ visibility: { file } })
// reads another data file.
import { visibilityHooks } from "./visibility/integration.js";

/**
 * @param {{ visibility?: { file?: string } | false }} [options]
 * @returns {import("astro").AstroIntegration}
 */
export default function galley(options = {}) {
  return { name: "galley-kit", hooks: /** @type {import("astro").AstroIntegration["hooks"]} */ (visibilityHooks(options.visibility)) };
}
