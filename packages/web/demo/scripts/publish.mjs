// `pnpm --filter @galley/web demo:publish` — copies the built demo
// (packages/web/demo/dist, from `build:demo`) into the marketing site as
// apps/site/public/demo/, with a manifest: what was built, from which
// commit, when, how big, and a fingerprint of everything it was built from.
//
// `pnpm --filter @galley/web demo:check` (this script with --check) fails
// when the committed demo is stale: when the fingerprint of its inputs now
// differs from the one in the manifest. It needs only Node and git, so it
// runs anywhere the repository is checked out.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../..", import.meta.url));
const repo = join(web, "../..");
const dist = join(web, "demo/dist");
const target = join(repo, "apps/site/public/demo");
const manifestPath = join(target, "manifest.json");

/** What the demo is made from. A change in any of these files makes the committed demo stale. */
export const INPUTS = [
  "packages/web/src",
  "packages/web/mock",
  "packages/web/demo",
  "packages/web/public",
  "packages/web/vite.config.ts",
  "packages/web/vite.preset.mjs",
  "packages/web/vite.demo.config.ts",
  "packages/web/package.json",
  "packages/core/src",
  "packages/overlay/src",
  "packages/overlay/build.mjs",
  "starters/astro-editorial",
  "brand",
];

/** A fingerprint of the inputs as they are in the working tree: every file git tracks or would track, path and content. */
export function inputsFingerprint() {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...INPUTS], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
    .filter((path) => existsSync(join(repo, path)))
    .sort();
  const hash = createHash("sha256");
  for (const path of files) hash.update(`${path}\0${createHash("sha256").update(readFileSync(join(repo, path))).digest("hex")}\n`);
  return { sha256: hash.digest("hex"), files: files.length };
}

function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  visit(root);
  return out;
}

function commit() {
  try {
    const head = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", ...INPUTS], { cwd: repo, encoding: "utf8" }).trim() !== "";
    return { head, dirty };
  } catch {
    return { head: "unknown", dirty: true };
  }
}

if (process.argv.includes("--check")) {
  if (!existsSync(manifestPath)) {
    console.error("✗ apps/site/public/demo has no manifest.json: build and publish the demo (pnpm --filter @galley/web build:demo && pnpm --filter @galley/web demo:publish).");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const now = inputsFingerprint();
  if (manifest.inputs?.sha256 !== now.sha256) {
    console.error(`✗ The committed demo is stale: it was built from commit ${manifest.commit} (${manifest.builtAt}), and its inputs have changed since.`);
    console.error("  Rebuild it: pnpm --filter @galley/web build:demo && pnpm --filter @galley/web demo:publish");
    process.exit(1);
  }
  console.log(`✓ The committed demo matches its inputs (${now.files} files, built ${manifest.builtAt}).`);
  process.exit(0);
}

if (!existsSync(join(dist, "index.html"))) {
  console.error("✗ There's no built demo in packages/web/demo/dist. Run pnpm --filter @galley/web build:demo first.");
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(dist, target, { recursive: true });
const files = walk(target);
const bytes = files.reduce((sum, path) => sum + statSync(join(target, path)).size, 0);
const site = files.filter((path) => path.startsWith("site/")).reduce((sum, path) => sum + statSync(join(target, path)).size, 0);
const { head, dirty } = commit();
const manifest = {
  what: "The Galley demo: the web app built with packages/web/vite.demo.config.ts, and the sample site (starters/astro-editorial) it previews. Generated; don't edit by hand.",
  builtAt: new Date().toISOString(),
  commit: dirty ? `${head}+changes` : head,
  inputs: { ...inputsFingerprint(), paths: INPUTS },
  files: files.length + 1,
  bytes,
  sampleSiteBytes: site,
  rebuild: "pnpm --filter @galley/web build:demo && pnpm --filter @galley/web demo:publish",
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`✓ apps/site/public/demo: ${manifest.files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB (sample site ${(site / 1024 / 1024).toFixed(2)} MB), from ${manifest.commit}`);
