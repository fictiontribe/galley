/**
 * Making a new site from a starter, the one way both `SiteRegistry.create`
 * and `galley new` do it: copy, give the copy the chosen name and look, let
 * the caller install its dependencies, and record all of that as the first
 * version — so the new site opens with its own name and no pending changes.
 */
import { copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCT } from "../brand";
import { applyEdits, formatForPath, updateConfigText } from "../content/index";
import { GalleyError } from "../errors";
import type { GalleyConfig } from "../types";
import { scaffoldFromStarter } from "../workspace/index";
import { readStarterManifest, STARTER_MANIFEST, type StarterManifest } from "./starters";

/**
 * Where a starter keeps the site's own name, most likely first. The first
 * that exists and has a top-level `name` is changed; a starter with none of
 * them keeps its own wording.
 */
export const SITE_NAME_FILES = ["src/data/site.json", "src/data/site.yaml", "src/data/site.yml", "src/_data/site.json", "_data/site.json", "data/site.json", "data/site.yaml"];

async function readIfExists(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch(() => null);
}

/** A look the starter ships, or a plain refusal. The first look (or none) is the default. */
export function lookFor(manifest: StarterManifest, look: string | undefined): StarterManifest["looks"][number] | null {
  if (look === undefined || look === "") return null;
  const found = manifest.looks.find((candidate) => candidate.id === look);

  if (!found) {
    throw new GalleyError(
      "invalid",
      manifest.looks.length
        ? `That starter has no look called “${look}”. Choose one of: ${manifest.looks.map((candidate) => candidate.id).join(", ")}.`
        : `That starter has only one look, so “${look}” can't be chosen.`,
      look
    );
  }
  return found === manifest.looks[0] ? null : found;
}

/** Puts `name` where the product and the starter read the site's name, changing only those values. */
export async function nameSite(root: string, name: string): Promise<string[]> {
  const changed: string[] = [];
  const configPath = join(root, PRODUCT.configFile);
  const config = await readIfExists(configPath);
  let current: GalleyConfig = {};

  try {
    current = config ? (JSON.parse(config) as GalleyConfig) : {};
  } catch {
    // An unreadable config stays as it was; the name still goes in the site's own settings.
    current = {};
  }
  if (config === null || current.name !== name) {
    const next = updateConfigText(config, { ...current, name });

    if (next !== config) {
      await writeFile(configPath, next);
      changed.push(PRODUCT.configFile);
    }
  }
  for (const file of SITE_NAME_FILES) {
    const text = await readIfExists(join(root, ...file.split("/")));
    const format = formatForPath(file);

    if (text === null || !format) continue;
    const result = applyEdits(text, format, [{ op: "set", path: ["name"], value: name }]);
    let hadName = false;

    try {
      hadName = /\.json$/.test(file) ? typeof (JSON.parse(text) as { name?: unknown }).name === "string" : /^name\s*:/m.test(text);
    } catch {
      hadName = false;
    }
    if (!hadName) continue;
    if (result.applied > 0 && result.content !== text) {
      await writeFile(join(root, ...file.split("/")), result.content);
      changed.push(file);
    }
    break;
  }
  return changed;
}

export interface ScaffoldSiteInput {
  starterDir: string;
  targetDir: string;
  name: string;
  /** One of the starter's looks; absent or the first one keeps the starter as it is. */
  look?: string;
  author?: { name: string; email: string } | null;
  /** Runs on the named copy before its first version is recorded — dependency installation goes here. */
  beforeFirstVersion?: (root: string) => Promise<void>;
}

/** Checks the look before anything is copied, so a mistyped look never leaves a half-made folder. */
export async function checkLook(starterDir: string, look: string | undefined): Promise<void> {
  lookFor(await readStarterManifest(starterDir), look);
}

export async function scaffoldSite(input: ScaffoldSiteInput): Promise<void> {
  const manifest = await readStarterManifest(input.starterDir);
  const look = lookFor(manifest, input.look);

  if (look && (!look.file || !manifest.tokens)) {
    throw new GalleyError("invalid", `The look “${look.label}” can't be applied: the starter doesn't say which file holds its colours.`, look.id);
  }
  await scaffoldFromStarter({
    starterDir: input.starterDir,
    targetDir: input.targetDir,
    name: input.name,
    ...(input.author !== undefined ? { author: input.author } : {}),
    prepare: async (root) => {
      // The wizard's description of the starter is not part of the site.
      await rm(join(root, STARTER_MANIFEST), { force: true });
      if (look?.file && manifest.tokens) {
        const source = join(root, ...look.file.split("/"));

        if (!(await stat(source).then((info) => info.isFile(), () => false))) {
          throw new GalleyError("invalid", `The look “${look.label}” is missing its colours file, so it can't be applied.`, look.file);
        }
        await copyFile(source, join(root, ...manifest.tokens.split("/")));
      }
      await nameSite(root, input.name.trim());
      await input.beforeFirstVersion?.(root);
    },
  });
}
