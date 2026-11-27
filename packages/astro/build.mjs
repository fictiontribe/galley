// Builds the publishable @galleycms/astro package into dist/, a standalone
// package directory ready for `npm pack` / `npm publish`:
//
//   dist/package.json        the published manifest (`private` omitted)
//   dist/src/                runtime JS, Astro components, CSS and `.d.ts` files
//   dist/types/              public subpath `.d.ts` files (with explicit `.js` specifiers)
//   dist/scripts/vendor.mjs  the vendoring helper
//   dist/README.md           registry-ready README (monorepo "Not published yet" banner stripped)
//   dist/LICENSE, NOTICE     Apache-2.0 licence files
//
// Inside the monorepo packages/astro/package.json stays `"private": true` so it
// is never published from the raw source directory by accident.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const dist = join(here, "dist");
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const DOCS_BASE = "https://github.com/fictiontribe/galley/blob/main/docs/";

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const keepFile = (source) => {
  const name = basename(source);

  return name !== ".DS_Store" && !name.endsWith(".map") && !name.endsWith(".tsbuildinfo");
};

cpSync(join(here, "src"), join(dist, "src"), { recursive: true, filter: keepFile });
cpSync(join(here, "types"), join(dist, "types"), { recursive: true, filter: keepFile });
mkdirSync(join(dist, "scripts"), { recursive: true });
cpSync(join(here, "scripts", "vendor.mjs"), join(dist, "scripts", "vendor.mjs"));

for (const file of ["LICENSE", "NOTICE"]) {
  const source = existsSync(join(here, file)) ? join(here, file) : join(repo, file);

  cpSync(source, join(dist, file));
}

// Make relative `.d.ts` imports explicit `.js` so strict NodeNext ESM consumers
// resolve every type declaration cleanly.
function declarations(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    return statSync(path).isDirectory() ? declarations(path) : path.endsWith(".d.ts") ? [path] : [];
  });
}

for (const file of [...declarations(join(dist, "src")), ...declarations(join(dist, "types"))]) {
  const from = dirname(file);
  const text = readFileSync(file, "utf8").replace(/((?:from|import)\s*\(?\s*["'])([^"']+)(["'])/g, (whole, open, spec, close) => {
    if (!spec.startsWith(".") || /\.[cm]?js$/i.test(spec)) return whole;
    const base = join(from, spec);
    let target = null;

    if (existsSync(`${base}.d.ts`)) target = `${base}.js`;
    else if (existsSync(join(base, "index.d.ts"))) target = join(base, "index.js");
    if (!target) return whole;
    const rel = relative(from, target).split("\\").join("/");

    return `${open}${rel.startsWith(".") ? rel : `./${rel}`}${close}`;
  });

  writeFileSync(file, text);
}

// Prepare README.md for registry consumption: strip the monorepo-only
// "Not published yet" banner and turn repo-relative docs links into absolute URLs.
if (existsSync(join(here, "README.md"))) {
  const readme = readFileSync(join(here, "README.md"), "utf8")
    .replace(/\n> \*\*Not published yet\.\*\*[\s\S]*?(?=\n\n)/, "")
    .replace(/\]\(\.\.\/\.\.\/docs\//g, `](${DOCS_BASE}`);

  writeFileSync(join(dist, "README.md"), readme);
}

const { scripts: _scripts, dependencies: _dependencies, devDependencies: _devDependencies, private: _private, ...published } = pkg;

writeFileSync(
  join(dist, "package.json"),
  `${JSON.stringify(
    {
      ...published,
      publishConfig: {
        access: "public",
        provenance: true,
      },
    },
    null,
    2
  )}\n`
);

console.log(`✓ dist/ — publish with \`npm publish\` from packages/astro/dist`);
