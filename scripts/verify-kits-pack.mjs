#!/usr/bin/env node
// Builds @galleycms/astro, @galleycms/adapter-kit and @galleycms/plugin-kit into their
// standalone dist/ directories, packs each dist/ with `npm pack` into a clean
// temporary directory (or --pack-destination <dir>), verifies every tarball's manifest,
// files and size, then installs the three tarballs into an isolated consumer
// project outside the monorepo and verifies runtime imports, CLI binary
// execution, subpath resolution and strict TypeScript typechecking.
//
// Usage:
//   node scripts/verify-kits-pack.mjs [--pack-destination <dir>]
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KB = 1024;
const MB = 1024 * KB;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND_PATH = join(REPO, "packages", "core", "src", "brand.ts");
const EXPECTED_VERSION = /VERSION = "([^"]+)"/.exec(readFileSync(BRAND_PATH, "utf8"))?.[1];

if (!EXPECTED_VERSION) {
  console.error(`✗ Could not read VERSION from ${BRAND_PATH}`);
  process.exit(1);
}

const KITS = [
  {
    name: "@galleycms/astro",
    dir: join(REPO, "packages", "astro"),
    limitBytes: 256 * KB,
    requiredFiles: [
      "package.json",
      "LICENSE",
      "NOTICE",
      "README.md",
      "src/index.js",
      "src/index.d.ts",
      "src/schema.js",
      "types/schema.d.ts",
      "src/catalog.js",
      "types/catalog.d.ts",
      "src/components/index.js",
      "src/components/index.d.ts",
      "src/components/Form.astro",
      "src/components/Scripts.astro",
      "src/components/ConsentBanner.astro",
      "src/forms/forms.css",
      "src/client/forms.js",
      "types/client.d.ts",
      "src/kit.d.ts",
      "src/toolbar-app.js",
      "scripts/vendor.mjs",
    ],
  },
  {
    name: "@galleycms/adapter-kit",
    dir: join(REPO, "packages", "adapter-kit"),
    limitBytes: 1 * MB,
    requiredFiles: [
      "package.json",
      "LICENSE",
      "NOTICE",
      "README.md",
      "lib/index.js",
      "lib/vitest.js",
      "lib/bin.js",
      "index.d.ts",
      "vitest.d.ts",
      "bin/galley-adapter-check.js",
      "fixtures/foreign/plain-markdown/README.md",
      "fixtures/foreign/node-app/package.json",
    ],
  },
  {
    name: "@galleycms/plugin-kit",
    dir: join(REPO, "packages", "plugin-kit"),
    limitBytes: 1 * MB,
    requiredFiles: [
      "package.json",
      "LICENSE",
      "NOTICE",
      "README.md",
      "lib/index.js",
      "lib/vitest.js",
      "index.d.ts",
      "vitest.d.ts",
      "fixtures/foreign/plain-markdown/README.md",
      "fixtures/foreign/node-app/package.json",
    ],
  },
];

const FORBIDDEN_FILES = [
  [/(^|\/)(test|tests|__tests__)\//, "a test folder"],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, "a test file"],
  [/\.map$/, "a source map"],
  [/(^|\/)\.env(\..*)?$/, "an .env file"],
  [/(^|\/)node_modules\//, "installed packages"],
  [/(^|\/)\.git\//, "git history"],
  [/(^|\/)\.DS_Store$/, "macOS litter"],
  [/\.log$/, "a log"],
  [/\.tsbuildinfo$/, "TypeScript build state"],
  [/\.node$|(^|\/)binding\.gyp$/, "a native module"],
  [/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/, "a lockfile"],
];

const SECRETS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic key"],
  [/sk-[A-Za-z0-9]{32,}/, "an API key"],
  [/AKIA[0-9A-Z]{16}/, "an AWS key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/gh[pousr]_[A-Za-z0-9]{36}/, "a GitHub token"],
  [/npm_[A-Za-z0-9]{36}/, "an npm token"],
  [/xox[abposr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
];

const LOCAL_PATHS = [
  [new RegExp(REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "this checkout's path"],
  [new RegExp(homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\\\/]"), "the builder's home folder"],
  [/\/Users\/[A-Za-z0-9._-]+\/(?:Desktop|Documents|Projects|Library|Developer|src|code|dev|work|repos|git)\//, "a macOS home folder"],
  [/\/home\/(?!runner\/work\b)[a-z][a-z0-9._-]*\/(?:Desktop|Projects|src|work|code|dev)\//, "a Linux home folder"],
  [/\/home\/runner\/work\//, "a CI runner's folder"],
  [/[A-Z]:\\\\Users\\\\[A-Za-z0-9._-]+\\\\/, "a Windows home folder"],
  [/\/private\/var\/folders\//, "a macOS temporary folder"],
];

const BINARY = /\.(png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip|gz|wasm)$/i;
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) walk(path, base, out);
    else out.push(relative(base, path).split("\\").join("/"));
  }
  return out;
}

function formatSize(bytes) {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${(bytes / KB).toFixed(1)} kB`;
}

function checkManifest(pkg, expectedName, problems) {
  if (pkg.name !== expectedName) problems.push(`package.json name is “${pkg.name}”, expected “${expectedName}”`);
  if (pkg.version !== EXPECTED_VERSION) problems.push(`package.json version is “${pkg.version}”, expected “${EXPECTED_VERSION}” (brand.ts VERSION)`);
  if (pkg.private) problems.push("package.json says private: true");
  for (const field of ["name", "version", "description", "license", "repository", "homepage", "engines", "files", "exports"]) {
    if (pkg[field] === undefined) problems.push(`package.json has no ${field}`);
  }
  if (pkg.publishConfig?.provenance !== true) problems.push("package.json publishConfig doesn't ask for provenance");
  if (pkg.publishConfig?.access !== "public") problems.push("package.json publishConfig isn't access: public");
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (String(range).startsWith("workspace:") || String(range).startsWith("file:") || String(range).startsWith("link:")) {
        problems.push(`${field}.${name} is “${range}”, which only works inside the repository`);
      }
      if (name.startsWith("@galley/")) problems.push(`${field}.${name} references an unpublished workspace package`);
      if (name.startsWith("@galleycms/")) problems.push(`${field}.${name} references another @galleycms/* kit instead of being standalone`);
    }
  }
  for (const script of INSTALL_SCRIPTS) {
    if (pkg.scripts?.[script]) problems.push(`package.json has an install script (${script})`);
  }
}

function inspectTarball(kit, tarball) {
  const problems = [];
  const notes = [];
  const work = mkdtempSync(join(tmpdir(), "galley-kit-inspect-"));

  try {
    execFileSync("tar", ["-xzf", tarball, "-C", work]);
    const root = join(work, "package");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const files = walk(root);
    const packed = statSync(tarball).size;
    const unpacked = files.reduce((sum, file) => sum + statSync(join(root, file)).size, 0);

    checkManifest(pkg, kit.name, problems);
    notes.push(`${files.length} files, ${formatSize(packed)} packed (${packed} B), ${formatSize(unpacked)} unpacked`);
    if (packed > kit.limitBytes) problems.push(`tarball is ${formatSize(packed)}, over its ${formatSize(kit.limitBytes)} limit`);

    for (const req of kit.requiredFiles) {
      if (!files.includes(req)) problems.push(`${req} is missing`);
    }

    if (kit.name === "@galleycms/astro" && files.includes("README.md")) {
      const readme = readFileSync(join(root, "README.md"), "utf8");

      if (/Not published yet/i.test(readme)) problems.push('README.md still contains the "Not published yet" banner');
    }

    for (const file of files) {
      for (const [pattern, what] of FORBIDDEN_FILES) {
        if (pattern.test(file)) problems.push(`${file} is ${what}`);
      }
      if (BINARY.test(file)) continue;
      const text = readFileSync(join(root, file), "utf8");

      for (const [pattern, what] of [...SECRETS, ...LOCAL_PATHS]) {
        const match = pattern.exec(text);

        if (match) {
          problems.push(`${file} contains ${what}: “${text.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30).replace(/\s+/g, " ")}”`);
        }
      }
      if (file.endsWith(".d.ts") && /(?:from|import)\s*\(?\s*["'](?:@galley\/|@galleycms\/)/.test(text)) {
        problems.push(`${file} still imports a workspace @galley/* or cross-kit @galleycms/* specifier`);
      }
    }

    return { name: `${pkg.name}@${pkg.version}`, packed, unpacked, fileCount: files.length, problems, notes };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function verifyIsolatedConsumer(tarballs) {
  const consumer = mkdtempSync(join(tmpdir(), "galley-kits-consumer-"));

  try {
    writeFileSync(
      join(consumer, "package.json"),
      `${JSON.stringify({ name: "galley-kits-consumer", version: "0.0.0", private: true, type: "module" }, null, 2)}\n`
    );

    // Install only the three local tarballs with npm (no registry access needed; peer dependencies provided below).
    execFileSync(
      "npm",
      ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--legacy-peer-deps", ...tarballs],
      { cwd: consumer, stdio: ["ignore", "pipe", "pipe"] }
    );

    // Confirm each installed kit is a real unpacked package (never a symlink into the monorepo).
    for (const kit of KITS) {
      const installed = join(consumer, "node_modules", ...kit.name.split("/"));

      if (!existsSync(join(installed, "package.json"))) throw new Error(`${kit.name} was not installed into consumer node_modules`);
      if (lstatSync(installed).isSymbolicLink()) throw new Error(`${kit.name} is a symlink instead of an installed tarball`);
    }

    // Provide the consumer's peer dependency `astro` from the workspace install so schema imports and tsc work offline.
    const astroSource = join(REPO, "packages", "astro", "node_modules", "astro");

    if (!existsSync(astroSource)) throw new Error(`Could not find astro peer dependency at ${astroSource}`);
    symlinkSync(astroSource, join(consumer, "node_modules", "astro"), "dir");

    // Provide @types/node for strict TypeScript compilation of Node types in the isolated consumer.
    const typesNodeSource = join(REPO, "node_modules", "@types", "node");

    if (existsSync(typesNodeSource)) {
      mkdirSync(join(consumer, "node_modules", "@types"), { recursive: true });
      symlinkSync(typesNodeSource, join(consumer, "node_modules", "@types", "node"), "dir");
    }

    // Create a tiny fixture site and adapter module that imports from the installed @galleycms/adapter-kit tarball.
    const fixtureDir = join(consumer, "fixture-site");

    mkdirSync(join(fixtureDir, "posts"), { recursive: true });
    writeFileSync(join(fixtureDir, "smoke.config.js"), "export default { site: true };\n");
    writeFileSync(join(fixtureDir, "posts", "hello.md"), "---\ntitle: Hello\ndate: 2026-11-26\n---\n\nFirst post.\n");
    writeFileSync(join(fixtureDir, "posts", "second.md"), "---\ntitle: Second\ndate: 2026-11-26\n---\n\nSecond post.\n");

    const adapterFile = join(consumer, "sample-adapter.mjs");

    writeFileSync(
      adapterFile,
      `import { conventionAdapter } from "@galleycms/adapter-kit";

export default conventionAdapter({
  id: "smoke",
  name: "Smoke SSG",
  files: ["smoke.config.js"],
  collections: () => [{ id: "posts", label: "Posts", path: "posts", url: "/posts/{slug}/" }],
  dev: { command: "npm run dev", port: 4321 },
  build: { command: "npm run build", outDir: "dist" },
  builtFrom: ["smoke.config.js", "posts/**", "public/**"],
});
`
    );

    // 1. Runtime verification script executed from the isolated consumer directory.
    const runtimeScript = join(consumer, "verify-runtime.mjs");

    writeFileSync(
      runtimeScript,
      `import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { checkAdapter, conventionAdapter, defineAdapter } from "@galleycms/adapter-kit";
import { checkPlugin, definePlugin, isProviderError, PLUGIN_API_VERSION, ProviderError } from "@galleycms/plugin-kit";
import galley, { resolveGalleyUrl } from "@galleycms/astro";
import { formSchema, scriptsSchema } from "@galleycms/astro/schema";
import { aiCrawlers, formProviders, scriptIntegrations } from "@galleycms/astro/catalog";

// @galleycms/adapter-kit runtime
assert.equal(typeof defineAdapter, "function");
assert.equal(typeof conventionAdapter, "function");
assert.equal(typeof checkAdapter, "function");

const customAdapter = defineAdapter({
  id: "inline-smoke",
  name: "Inline Smoke",
  detect(ctx) {
    return ctx.exists("smoke.config.js") ? { confidence: 0.9 } : null;
  },
  conventions() {
    return {
      dev: { command: "npm run dev", port: 4321 },
      build: { command: "npm run build", outDir: "dist" },
      builtFrom: ["smoke.config.js", "posts/**", "public/**"],
    };
  },
  collections() {
    return [{ id: "posts", path: "posts", label: "Posts", url: "/posts/{slug}/" }];
  },
});

const adapterReport = await checkAdapter(customAdapter, "./fixture-site", {
  collections: [{ id: "posts", minEntries: 2, url: "/posts/{slug}/" }],
});
assert.equal(adapterReport.ok, true, "defineAdapter conformance check failed: " + JSON.stringify(adapterReport.checks.filter((c) => c.status === "fail")));

const convAdapter = (await import("./sample-adapter.mjs")).default;
const convReport = await checkAdapter(convAdapter, "./fixture-site", {
  collections: [{ id: "posts", minEntries: 2, url: "/posts/{slug}/" }],
});
assert.equal(convReport.ok, true, "conventionAdapter conformance check failed: " + JSON.stringify(convReport.checks.filter((c) => c.status === "fail")));

// @galleycms/plugin-kit runtime
assert.equal(typeof definePlugin, "function");
assert.equal(typeof ProviderError, "function");
assert.equal(typeof checkPlugin, "function");

const err = new ProviderError("auth", "Invalid API key.", "401 Unauthorized");
assert.equal(err instanceof Error, true);
assert.equal(isProviderError(err), true);
assert.equal(err.kind, "auth");

const plugin = definePlugin({
  name: "galley-plugin-smoke",
  apiVersion: PLUGIN_API_VERSION,
  tools: [
    {
      name: "ping",
      title: "Ping",
      description: "Returns pong.",
      mode: "content",
      effect: { readOnly: true },
      input: { type: "object", properties: {} },
      async run() {
        return "pong";
      },
    },
  ],
});
const pluginReport = await checkPlugin(plugin);
assert.equal(pluginReport.ok, true, "checkPlugin failed: " + JSON.stringify(pluginReport.checks.filter((c) => c.status === "fail")));

// @galleycms/astro runtime + subpath resolution
const integration = galley({ url: "http://127.0.0.1:4400" });
assert.equal(integration.name, "@galleycms/astro");
assert.equal(typeof integration.hooks["astro:config:setup"], "function");
assert.equal(resolveGalleyUrl({ url: "http://127.0.0.1:4400/" }), "http://127.0.0.1:4400");

const validForm = formSchema.safeParse({
  name: "Contact",
  fields: [{ id: "email", type: "email", label: "Email", required: true }],
  submitLabel: "Send",
  destinations: [{ provider: "galley", settings: {} }],
  afterSubmit: [{ type: "message", text: "Thanks!" }],
});
assert.equal(validForm.success, true, "formSchema failed on valid form");
assert.equal(scriptsSchema.safeParse({ scripts: [] }).success, true, "scriptsSchema failed on valid scripts config");

assert.ok(Array.isArray(scriptIntegrations) && scriptIntegrations.length > 0, "scriptIntegrations empty");
assert.ok(Array.isArray(formProviders) && formProviders.length > 0, "formProviders empty");
assert.ok(Array.isArray(aiCrawlers) && aiCrawlers.length > 0, "aiCrawlers empty");

const req = createRequire(import.meta.url);
const componentsPath = fileURLToPath(import.meta.resolve("@galleycms/astro/components"));
const formsCssPath = req.resolve("@galleycms/astro/forms.css");
assert.ok(existsSync(componentsPath) && componentsPath.includes("node_modules"), "components subpath did not resolve to installed package: " + componentsPath);
assert.ok(existsSync(formsCssPath) && formsCssPath.includes("node_modules"), "forms.css subpath did not resolve to installed package: " + formsCssPath);
assert.ok(readFileSync(formsCssPath, "utf8").includes(".galley-form"), "forms.css missing expected styles");

console.log("✓ Isolated runtime imports and subpath resolution passed");
`
    );

    execFileSync(process.execPath, [runtimeScript], {
      cwd: consumer,
      stdio: "inherit",
      env: { PATH: process.env.PATH ?? "", HOME: consumer },
    });

    // 2. CLI binary check (`galley-adapter-check` from the installed tarball).
    const cliBin = join(consumer, "node_modules", ".bin", "galley-adapter-check");

    if (!existsSync(cliBin)) throw new Error("galley-adapter-check binary missing from consumer node_modules/.bin");
    const cliOut = execFileSync(cliBin, ["./sample-adapter.mjs", "./fixture-site"], {
      cwd: consumer,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: consumer },
    });

    if (!/All \d+ checks passed\./.test(cliOut)) {
      throw new Error(`galley-adapter-check did not report all checks passed:\n${cliOut}`);
    }
    console.log("✓ Isolated galley-adapter-check CLI binary passed");

    // 3. Strict TypeScript consumer check against all three packed tarballs' `.d.ts` files.
    writeFileSync(
      join(consumer, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2023",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: ["node"],
          },
          include: ["check.ts"],
        },
        null,
        2
      )}\n`
    );

    writeFileSync(
      join(consumer, "check.ts"),
      `import {
  ADAPTER_API_VERSION,
  checkAdapter,
  conventionAdapter,
  defineAdapter,
  type AdapterReport,
  type GalleyAdapter,
} from "@galleycms/adapter-kit";
import { describeAdapter } from "@galleycms/adapter-kit/vitest";
import {
  PLUGIN_API_VERSION,
  ProviderError,
  checkPlugin,
  definePlugin,
  type GalleyPlugin,
  type PluginReport,
} from "@galleycms/plugin-kit";
import { describePlugin } from "@galleycms/plugin-kit/vitest";
import galley, { resolveGalleyUrl, type GalleyOptions } from "@galleycms/astro";
import { describeIssues, formSchema, scriptsSchema } from "@galleycms/astro/schema";
import { aiCrawlers, formProviders, scriptIntegrations, type AiCrawler } from "@galleycms/astro/catalog";
import { ConsentBanner, Form, Scripts, type FormProps } from "@galleycms/astro/components";
import { initForms, registerFormProvider, type Submitter } from "@galleycms/astro/client";
import type { FormDefinition, ScriptsConfig } from "@galleycms/astro/kit";

export const apiVersions: [number, number] = [ADAPTER_API_VERSION, PLUGIN_API_VERSION];
export const adapter: GalleyAdapter = conventionAdapter({
  id: "typed",
  name: "Typed",
  files: ["typed.config.js"],
  collections: () => [{ id: "posts", label: "Posts", path: "posts", url: "/posts/{slug}/" }],
});
export const definedAdapter: GalleyAdapter = defineAdapter(adapter);
export const runAdapterCheck = (dir: string): Promise<AdapterReport> => checkAdapter(definedAdapter, dir);
export const useAdapterVitest = describeAdapter;

export const plugin: GalleyPlugin = definePlugin({ name: "galley-plugin-typed", apiVersion: PLUGIN_API_VERSION });
export const err: ProviderError = new ProviderError("auth", "Bad key");
export const runPluginCheck = (): Promise<PluginReport> => checkPlugin(plugin);
export const usePluginVitest = describePlugin;

export const astroOptions: GalleyOptions = { url: resolveGalleyUrl(), toolbar: true };
export const integration = galley(astroOptions);
export const schemas = { formSchema, scriptsSchema, describeIssues };
export const catalog: { crawlers: readonly AiCrawler[]; providers: typeof formProviders; scripts: typeof scriptIntegrations } = {
  crawlers: aiCrawlers,
  providers: formProviders,
  scripts: scriptIntegrations,
};
export const components = { Form, Scripts, ConsentBanner };
export type CheckedFormProps = FormProps;
export type CheckedFormDefinition = FormDefinition;
export type CheckedScriptsConfig = ScriptsConfig;
export const client = { initForms, registerFormProvider };
export type CheckedSubmitter = Submitter;
`
    );

    const tscBin = join(REPO, "node_modules", "typescript", "bin", "tsc");

    execFileSync(process.execPath, [tscBin, "-p", join(consumer, "tsconfig.json")], {
      cwd: consumer,
      stdio: "inherit",
    });
    console.log("✓ Isolated TypeScript (NodeNext + strict) typecheck passed");
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
let packDestination = null;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];

  if (arg === "--pack-destination") {
    packDestination = args[i + 1] ?? null;
    if (!packDestination || packDestination.startsWith("-")) {
      console.error("Usage: node scripts/verify-kits-pack.mjs [--pack-destination <dir>]");
      process.exit(2);
    }
    i += 1;
  } else if (arg.startsWith("--pack-destination=")) {
    packDestination = arg.slice("--pack-destination=".length) || null;
    if (!packDestination) {
      console.error("Usage: node scripts/verify-kits-pack.mjs [--pack-destination <dir>]");
      process.exit(2);
    }
  } else {
    console.error(`Unknown argument: ${arg}\nUsage: node scripts/verify-kits-pack.mjs [--pack-destination <dir>]`);
    process.exit(2);
  }
}

const keepPackDir = packDestination !== null;
const packDir = keepPackDir ? resolve(packDestination) : mkdtempSync(join(tmpdir(), "galley-kits-pack-"));

if (keepPackDir) mkdirSync(packDir, { recursive: true });
let failed = false;

try {
  const tarballs = [];

  for (const kit of KITS) {
    execFileSync(process.execPath, [join(kit.dir, "build.mjs")], { cwd: kit.dir, stdio: "inherit" });
    const distDir = join(kit.dir, "dist");
    const packedName = execFileSync("npm", ["pack", "--pack-destination", packDir, "--silent"], {
      cwd: distDir,
      encoding: "utf8",
    })
      .trim()
      .split(/\r?\n/)
      .pop();

    if (!packedName) throw new Error(`npm pack in ${distDir} produced no tarball name`);
    const tarball = join(packDir, packedName);

    tarballs.push(tarball);
    const result = inspectTarball(kit, tarball);

    console.log(`${result.problems.length ? "✗" : "✓"} ${result.name} (${basename(tarball)})`);
    for (const note of result.notes) console.log(`  ${note}`);
    for (const problem of result.problems) console.log(`  ! ${problem}`);
    failed ||= result.problems.length > 0;
  }

  if (!failed) {
    verifyIsolatedConsumer(tarballs);
  }
} finally {
  if (!keepPackDir) rmSync(packDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
