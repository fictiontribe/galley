// Builds the publishable @galleycms/plugin-kit into dist/, a package of its own:
//
//   dist/package.json   the published manifest (exports → compiled JS)
//   dist/lib/           index.js, vitest.js and shared chunks — the engine and
//                       adapter-kit code the kit needs is bundled in, so
//                       nothing private is depended on; only vitest stays outside
//   dist/types/         .d.ts for the kit and the parts of the engine it exposes
//   dist/fixtures/      the adapter kit's foreign fixtures, which its bundled
//                       conformance check reads (../fixtures from dist/lib)
//
// Why a manifest of its own: inside the monorepo the kit's `exports` point at
// its TypeScript source, so plugins and tests use it without a build. npm has
// no way to swap `exports` at publish time, so the published manifest is
// written here and `npm publish` runs in dist/. Same scheme as the adapter kit.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const dist = join(here, "dist");
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const core = JSON.parse(readFileSync(join(repo, "packages", "core", "package.json"), "utf8"));
const adapterKit = JSON.parse(readFileSync(join(repo, "packages", "adapter-kit", "package.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "lib"), { recursive: true });

await build({
  entryPoints: { index: join(here, "src", "index.ts"), vitest: join(here, "src", "vitest.ts") },
  outdir: join(dist, "lib"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node20",
  // vitest belongs to the plugin author's project (an optional peer).
  external: ["vitest"],
  banner: { js: 'import { createRequire as __kitCreateRequire } from "node:module";\nconst require = __kitCreateRequire(import.meta.url);' },
  legalComments: "none",
  logLevel: "warning",
});

const tsconfig = join(here, ".tsconfig.types.json");

writeFileSync(
  tsconfig,
  JSON.stringify({
    extends: "../../tsconfig.base.json",
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      outDir: "dist/types",
      rootDir: "..",
      types: ["node"],
      // Reached through node_modules, these would count as libraries and get no declarations of their own.
      paths: {
        "@galley/core": ["../core/src/index.ts"],
        "@galley/core/*": ["../core/src/*"],
        "@galleycms/adapter-kit": ["../adapter-kit/src/index.ts"],
      },
    },
    files: ["src/index.ts", "src/vitest.ts"],
  })
);
try {
  execFileSync(process.execPath, [join(repo, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfig], { cwd: here, stdio: "inherit" });
} finally {
  rmSync(tsconfig, { force: true });
}
const typesRoot = join(dist, "types");
const exportsOf = (manifest, name, dir) =>
  Object.entries(manifest.exports).map(([key, value]) => [key === "." ? name : `${name}/${key.slice(2)}`, join(dir, String(value).replace(/^\.\//, "").replace(/\.ts$/, ".js"))]);
const known = Object.fromEntries([...exportsOf(core, "@galley/core", "core"), ...exportsOf(adapterKit, "@galleycms/adapter-kit", "adapter-kit")]);

function declarations(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    return statSync(path).isDirectory() ? declarations(path) : path.endsWith(".d.ts") ? [path] : [];
  });
}

for (const file of declarations(typesRoot)) {
  const from = dirname(file);
  const text = readFileSync(file, "utf8").replace(/((?:from|import)\s*\(?\s*["'])([^"']+)(["'])/g, (whole, open, spec, close) => {
    let target = null;

    if (known[spec]) target = join(typesRoot, known[spec]);
    else if (spec.startsWith(".")) {
      const base = join(from, spec);

      if (existsSync(`${base}.d.ts`)) target = `${base}.js`;
      else if (existsSync(join(base, "index.d.ts"))) target = join(base, "index.js");
    }
    if (!target) return whole;
    const rel = relative(from, target).split("\\").join("/");

    return `${open}${rel.startsWith(".") ? rel : `./${rel}`}${close}`;
  });

  writeFileSync(file, text);
}
writeFileSync(join(dist, "index.d.ts"), 'export * from "./types/plugin-kit/src/index.js";\n');
writeFileSync(join(dist, "vitest.d.ts"), 'export * from "./types/plugin-kit/src/vitest.js";\n');
cpSync(join(repo, "packages", "adapter-kit", "fixtures"), join(dist, "fixtures"), { recursive: true });
for (const file of ["README.md"]) if (existsSync(join(here, file))) cpSync(join(here, file), join(dist, file));
for (const file of ["LICENSE", "NOTICE"]) cpSync(join(repo, file), join(dist, file));

const { scripts: _scripts, dependencies: _dependencies, devDependencies: _devDependencies, private: _private, ...published } = pkg;

writeFileSync(
  join(dist, "package.json"),
  `${JSON.stringify(
    {
      ...published,
      main: "./lib/index.js",
      types: "./index.d.ts",
      exports: {
        ".": { types: "./index.d.ts", default: "./lib/index.js" },
        "./vitest": { types: "./vitest.d.ts", default: "./lib/vitest.js" },
      },
      files: ["lib", "types", "index.d.ts", "vitest.d.ts", "fixtures", "README.md", "LICENSE", "NOTICE"],
      publishConfig: {
        access: "public",
        provenance: true,
      },
    },
    null,
    2
  )}\n`
);
console.log(`✓ dist/ — publish with \`npm publish\` from packages/plugin-kit/dist`);
