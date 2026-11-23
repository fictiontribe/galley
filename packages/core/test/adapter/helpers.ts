import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const made: string[] = [];

/** A scratch site: `files` maps repo-relative paths to their text. */
export function site(files: Record<string, string>, prefix = "adapter-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));

  made.push(root);
  writeFiles(root, files);
  return root;
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, ...path.split("/"));

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

export function cleanup(): void {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** Two markdown entries with front matter, so a folder counts as a collection. */
export function entries(dir: string, extra = ""): Record<string, string> {
  return {
    [`${dir}/first.md`]: `---\ntitle: First${extra}\n---\nOne.\n`,
    [`${dir}/second.md`]: `---\ntitle: Second${extra}\n---\nTwo.\n`,
  };
}
