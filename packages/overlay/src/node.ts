/**
 * Node entry of @galley/overlay: hands the server the script that the preview
 * proxies serve at OVERLAY_SCRIPT_PATH on the previewed site's origin.
 *
 * Returns dist/overlay.js, building it first when it is missing or older than
 * the sources — so development needs no separate build step. The bundled CLI
 * embeds the result of this function at build time and never builds.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(packageRoot, "src");
const buildScript = join(packageRoot, "build.mjs");
const outFile = join(packageRoot, "dist", "overlay.js");

interface BuildModule {
  buildOverlay(): Promise<string>;
}

let building: Promise<string> | null = null;

async function mtime(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

async function isStale(): Promise<boolean> {
  const built = await mtime(outFile);
  if (built === 0) return true;
  const sources = (await readdir(sourceDir)).filter((name) => name.endsWith(".ts") && name !== "node.ts").map((name) => join(sourceDir, name));
  const newest = Math.max(await mtime(buildScript), ...(await Promise.all(sources.map(mtime))));
  return newest > built;
}

async function build(): Promise<string> {
  const module = (await import(pathToFileURL(buildScript).href)) as BuildModule;
  return module.buildOverlay();
}

export async function overlaySource(): Promise<string> {
  if (await isStale()) {
    building ??= build().finally(() => {
      building = null;
    });
    await building;
  }
  return readFile(outFile, "utf8");
}
