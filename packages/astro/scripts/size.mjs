#!/usr/bin/env node
// What the kit costs a visitor: the forms runtime (one module for every form
// on a page) and each provider chunk it loads only when a form uses it, plus
// the inline scripts runtime and email-link dialog — minified and gzipped.
//
//   node scripts/size.mjs
//
// Bundled the way Vite bundles them in a site (esm, split at the dynamic
// imports), with esbuild from Astro's own dependencies.
// @ts-check
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = (/** @type {string} */ path) => fileURLToPath(new URL(path, import.meta.url));
const esbuild = createRequire(createRequire(import.meta.url).resolve("astro/package.json"))("esbuild");
const out = mkdtempSync(join(tmpdir(), "galley-size-"));
const gz = (/** @type {string | Buffer} */ text) => gzipSync(text, { level: 9 }).length;
const kb = (/** @type {number} */ bytes) => `${(bytes / 1024).toFixed(1)} KB`;

try {
  await esbuild.build({
    entryPoints: { forms: here("../src/client/forms.js") },
    bundle: true,
    splitting: true,
    format: "esm",
    minify: true,
    target: "es2020",
    outdir: out,
    logLevel: "silent",
  });
  /** @type {Array<[string, number, number]>} */
  const rows = [];

  for (const name of readdirSync(out).sort()) {
    const text = readFileSync(join(out, name));

    rows.push([name.replace(/-[A-Z0-9]{8}\.js$/, ".js"), text.length, gz(text)]);
  }
  const { RUNTIME } = await import("../src/scripts/runtime.gen.js");
  const { mailtoTag, resolveMailto } = await import("../src/mailto/config.js");
  const css = readFileSync(here("../src/forms/forms.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{};,>])\s*/g, "$1");
  const tag = mailtoTag(/** @type {any} */ (resolveMailto(undefined)));

  rows.push(["forms.css (inline, once per page with a form)", css.length, gz(css)]);
  rows.push(["scripts runtime (inline in <head>)", RUNTIME.length, gz(RUNTIME)]);
  rows.push(["email-link dialog (inline, pages with an email link)", tag.length, gz(tag)]);
  const width = Math.max(...rows.map(([name]) => name.length));

  console.log(`${"file".padEnd(width)}  ${"min".padStart(8)}  ${"gzip".padStart(8)}`);
  for (const [name, min, zipped] of rows) console.log(`${name.padEnd(width)}  ${kb(min).padStart(8)}  ${kb(zipped).padStart(8)}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
