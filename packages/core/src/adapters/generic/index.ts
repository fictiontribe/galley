/**
 * The fallback: a folder of markdown with no framework Galley recognises.
 * It always matches, weakly, so any other adapter that recognises the site
 * wins. Content folders are found by looking; they get no URLs, because
 * without a framework there is no telling where (or whether) they are served.
 */
import { ADAPTER_API_VERSION, defineAdapter } from "../../adapter/define";

export const GENERIC_ID = "generic";

export const genericAdapter = defineAdapter({
  id: GENERIC_ID,
  name: "Static site",
  apiVersion: ADAPTER_API_VERSION,
  detect: () => ({ confidence: 0.05 }),
  conventions: () => ({
    dev: { port: null },
    build: { outDir: "dist" },
    publicDir: "public",
    contentDirs: ["content", "src/content", "."],
    pageDirs: ["content", "src/content", "."],
    dataDirs: ["data", "_data", "src/data"],
    contentUrls: "none" as const,
  }),
});
