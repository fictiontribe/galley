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

/** Replaces {repository}, {version} … placeholders that data files may use. */
export function fill(text: string): string {
  return text
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
