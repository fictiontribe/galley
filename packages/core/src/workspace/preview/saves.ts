/**
 * Forgetting what a site's dev server saved between runs (the adapter's
 * `forgetPreviewSaves`, recorded as SiteModel.previewSaves).
 */
import { lstat, realpath, unlink } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";

/**
 * Removes exactly these site-relative files. Only regular files go — never a
 * folder, never a link — and only where the folder holding them really is
 * inside the site: a `node_modules` that links elsewhere is someone else's.
 * Missing files are skipped. Returns the paths removed.
 */
export async function forgetPreviewSaves(root: string, paths: readonly string[]): Promise<string[]> {
  const removed: string[] = [];
  let top: string;

  try {
    top = await realpath(root);
  } catch {
    return removed;
  }
  for (const path of paths) {
    const parts = path.split(/[\\/]/);

    if (path === "" || isAbsolute(path) || /^[A-Za-z]:/.test(path) || parts.some((part) => part === "" || part === "." || part === "..")) continue;
    const file = join(root, ...parts);
    const kind = await lstat(file).catch(() => null);

    if (!kind?.isFile()) continue;
    const folder = await realpath(dirname(file)).catch(() => null);
    const inside = folder === null ? "" : relative(top, folder);

    if (folder === null || inside.startsWith("..") || isAbsolute(inside)) continue;
    await unlink(file).then(
      () => removed.push(path),
      () => undefined
    );
  }
  return removed;
}
