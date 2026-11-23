import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import site from "../data/site.json";
import navigation from "../data/navigation.json";

export { site, navigation };

/** The monorepo root: the nearest folder above the site holding pnpm-workspace.yaml. */
function findRepoRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export const repoRoot = findRepoRoot();

/** Reads a file at a repository-relative path, or null when it is not there. */
export function readRepoFile(path: string): string | null {
  if (!repoRoot) return null;
  const full = resolve(repoRoot, path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

/**
 * The product version, read at build time from the one place the product
 * declares it (packages/core/src/brand.ts), so the site can never advertise a
 * different number from the code.
 */
export const version: string = (() => {
  const source = readRepoFile(site.versionFile);
  const match = source?.match(/export const VERSION\s*=\s*["']([^"']+)["']/);
  return match?.[1] ?? "0.0.0";
})();

/** The install commands, from src/data/site.json → install (the one place they live). */
type InstallValue = string | boolean | string[];
const install = ((site as unknown as { install?: Record<string, InstallValue> }).install ?? {}) as Record<string, InstallValue>;

/**
 * The install placeholders, for the docs:
 *   {install.create}                                    a value of site.json → install
 *   {install.createStarter folder=my-site starter=caddow}  …with its own {folder} and {starter} filled in
 *   {install.fromClone take=5}                          the first 5 commands of a list
 *   <!-- if install.published --> … <!-- else --> … <!-- end -->   text for before and after the first npm release
 * A list (several commands) is written one per line. An unknown key is left as it is
 * (scripts/check-docs.mjs reports it).
 */
export function fillInstall(text: string): string {
  const branches = text.replace(
    /<!-- if (!?)install\.published -->\n?([\s\S]*?)(?:<!-- else -->\n?([\s\S]*?))?<!-- end -->\n?/g,
    (_match, not: string, yes: string, no = "") => ((install.published === true) !== (not === "!") ? yes : no)
  );
  return branches.replace(/\{install\.([a-zA-Z]+)((?: [a-z][a-zA-Z]*=[^\s}]+)*)\}/g, (match, key: string, args: string, offset: number, whole: string) => {
    // A list keeps the indentation of the line it starts on (a code block inside a list item).
    const indent = /^[ \t]*/.exec(whole.slice(whole.lastIndexOf("\n", offset - 1) + 1))![0];
    const value = install[key];
    if (value === undefined || typeof value === "boolean") return match;
    const take = /(?:^| )take=(\d+)/.exec(args);
    let out = Array.isArray(value) ? (take ? value.slice(0, Number(take[1])) : value).join(`\n${indent}`) : value;
    for (const [, name, arg] of args.matchAll(/ ([a-z][a-zA-Z]*)=([^\s}]+)/g)) if (name !== "take") out = out.replaceAll(`{${name}}`, arg!);
    // The repository's owner/name, for commands that fetch from it.
    return out.replaceAll("{repoSlug}", site.repository.replace(/^https:\/\/github\.com\//, ""));
  });
}

/** Replaces {repository}, {version} … placeholders that data files may use. */
export function fill(text: string): string {
  return fillInstall(text)
    .replaceAll("{clone}", site.cloneCommand)
    .replaceAll("{makerContact}", site.maker.contact)
    .replaceAll("{cloudEmail}", site.cloud.email)
    .replaceAll("{cloudSubject}", encodeURIComponent(site.cloud.subject))
    .replaceAll("{discussion}", site.cloud.discussion)
    .replaceAll("{repository}", site.repository)
    .replaceAll("{version}", version)
    .replaceAll("{install}", site.installCommand)
    .replaceAll("{package}", site.npmPackage)
    .replaceAll("{maker}", site.maker.url)
    .replaceAll("{license}", site.licenseUrl)
    .replaceAll("{site}", site.url);
}

export function absoluteUrl(path: string): string {
  return new URL(path, site.url).href;
}

export function pageTitle(title: string, bare = false): string {
  return bare ? title : site.titleTemplate.replace("{title}", title);
}

/** Link to edit a file of this site on the repository host. */
export function editUrl(siteRelativePath: string): string {
  return `${site.repository}/edit/${site.repositoryBranch}/${site.sitePath}/${siteRelativePath}`;
}

export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}
