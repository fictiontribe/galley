#!/usr/bin/env node
// Copies the site kit into a site as plain files, with no dependency on this
// package — how a site ships forms and managed scripts before the package is
// published (and how the starters do it):
//
//   node packages/astro/scripts/vendor.mjs <siteDir>
//
// writes <siteDir>/src/galley/… (components, browser runtime, schemas, CSS)
// and, once, src/galley/settings.json for the site's own settings. Running
// it again replaces the kit files and keeps settings.json. The output is
// byte-stable: the same kit gives the same files, each with a header naming
// the kit version it came from.
//
// The site then needs (docs/forms.md, "Without the integration"; docs/ai-first-output.md):
//   - in astro.config:  import galley from "./src/galley/integration.js";  integrations: [galley()]
//   - in src/content.config.ts:  import { formSchema } from "./galley/schema.js";
//       forms: defineCollection({ loader: glob({ pattern: "*.json", base: "./src/content/forms" }), schema: formSchema }),
//   - in its layout: <Scripts placement="head" /> in <head>,
//       <Scripts placement="body-start" /> after <body>, <Scripts placement="body-end" /> before </body>
//   - where a form goes: <Form id="contact" />
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(PACKAGE, "src");
const VERSION = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")).version;

/** Kit files a site needs, relative to src/. Everything else (the integration, the toolbar) stays in the package. */
const FILES = [
  "kit.d.ts",
  "catalog-data.js",
  "catalog.js",
  "schema.js",
  "components/Form.astro",
  "components/Scripts.astro",
  "components/ConsentBanner.astro",
  "components/index.js",
  "forms/forms.css",
  "forms/free-email-domains.js",
  "forms/logic.js",
  "forms/messages.js",
  "forms/render.js",
  "mailto/config.js",
  "mailto/runtime.gen.js",
  "shared/glob.js",
  "shared/markdown.js",
  "scripts/banner.js",
  "scripts/plan.js",
  "scripts/runtime.gen.js",
  "scripts/snippets.js",
  "client/attribution.js",
  "client/forms.js",
  "client/registry.js",
  "client/types.d.ts",
  ...readdirSync(join(SRC, "visibility"))
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => `visibility/${name}`),
  ...readdirSync(join(SRC, "client/providers"))
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => `client/providers/${name}`),
];

const header = (/** @type {string} */ file) => {
  const text = `Vendored from @galley/astro ${VERSION} by scripts/vendor.mjs. Don't edit: run the script again to update.`;

  if (file.endsWith(".css")) return `/* ${text} */\n`;
  return `// ${text}\n`;
};

/**
 * The vendored integration: the one part of the kit that needs Astro's build
 * hooks (the agent-readable output, docs/ai-first-output.md). Forms, scripts
 * and email links stay file-driven through the components, so this adds
 * nothing else. In astro.config: import galley from "./src/galley/integration.js";
 * and integrations: [galley()].
 */
const INTEGRATION = `// @ts-check
// The site kit's build step for a vendored kit: the agent-readable version of
// the site (markdown twins, llms.txt, llms-full.txt, agent.md, structured
// data, robots.txt and sitemap.xml when the site has none of its own), from
// src/data/visibility.json. In astro.config:
//
//   import galley from "./src/galley/integration.js";
//   export default defineConfig({ integrations: [galley()] });
//
// galley({ visibility: false }) turns it off; galley({ visibility: { file } })
// reads another data file.
import { visibilityHooks } from "./visibility/integration.js";

/**
 * @param {{ visibility?: { file?: string } | false }} [options]
 * @returns {import("astro").AstroIntegration}
 */
export default function galley(options = {}) {
  return { name: "galley-kit", hooks: /** @type {import("astro").AstroIntegration["hooks"]} */ (visibilityHooks(options.visibility)) };
}
`;

/** The one file that differs from the package: settings come from files, not the integration. */
const SITE_CONFIG = `// @ts-check
// The site's kit settings, read from files (a vendored kit has no
// integration to pass them): src/galley/settings.json for the forms,
// src/data/scripts.json for the managed scripts, src/content/forms/ for the
// site-wide UTM memory, and the email-link dialog's settings.
import settings from "../settings.json";
import { resolveMailto } from "../mailto/config.js";
import { describeIssues, scriptsSchema } from "../schema.js";
import { resolveEntries } from "../scripts/plan.js";

/** @typedef {import("../kit").ScriptsConfig} ScriptsConfig */

const scriptFiles = import.meta.glob("/src/data/scripts.json", { eager: true, import: "default" });
const formFiles = import.meta.glob("/src/content/forms/*.json", { eager: true, import: "default" });

export const scriptsFile = "src/data/scripts.json";

/** @returns {ScriptsConfig | null} */
function readScripts() {
  const raw = scriptFiles["/src/data/scripts.json"];

  if (raw === undefined) return null;
  const parsed = scriptsSchema.safeParse(raw);

  if (!parsed.success) throw new Error(\`src/data/scripts.json has problems:\\n\${describeIssues(parsed.error).map((line) => \`  - \${line}\`).join("\\n")}\`);
  const config = /** @type {ScriptsConfig} */ (parsed.data);

  resolveEntries(config);
  return config;
}

export const scripts = readScripts();

const forms = /** @type {Record<string, unknown>} */ (settings.forms ?? {});

export const options = {
  collection: typeof forms.collection === "string" ? forms.collection : "forms",
  endpoint: typeof forms.endpoint === "string" ? forms.endpoint : "",
  allowFormScripts: forms.allowFormScripts === true,
  messages: /** @type {Record<string, string>} */ (forms.messages ?? {}),
  freeEmailDomains: /** @type {string[]} */ (forms.freeEmailDomains ?? []),
};

/** The email-link dialog: on unless settings.json says "mailto": false. */
export const mailto = resolveMailto(/** @type {any} */ (settings).mailto);

export const utm = Object.values(formFiles).some(
  (form) => Array.isArray(/** @type {any} */ (form)?.fields) && /** @type {any} */ (form).fields.some((/** @type {any} */ field) => field?.autofill?.from === "utm"),
);
`;

const SETTINGS = `${JSON.stringify(
  {
    forms: {
      collection: "forms",
      endpoint: "",
      allowFormScripts: false,
      messages: {},
      freeEmailDomains: [],
    },
    mailto: {
      options: ["gmail", "outlook", "app", "copy"],
      strings: {},
    },
  },
  null,
  2,
)}\n`;

/**
 * The vendored files as { path under src/galley/: text }, in a fixed order.
 *
 * @returns {Record<string, string>}
 */
export function vendoredFiles() {
  /** @type {Record<string, string>} */
  const out = {};

  for (const file of FILES) {
    const text = readFileSync(join(SRC, file), "utf8");

    if (file.endsWith(".astro")) {
      if (!text.startsWith("---\n")) throw new Error(`${file} has no frontmatter.`);
      out[file] = `---\n${header(file)}${text.slice(4)}`;
    } else {
      out[file] = header(file) + text;
    }
  }
  out["runtime/site-config.js"] = header("runtime/site-config.js") + SITE_CONFIG;
  out["integration.js"] = header("integration.js") + INTEGRATION;
  return out;
}

/**
 * Everything `vendor()` writes, as data: the kit files and the first version
 * of settings.json, keyed by path under src/galley/. For tools that write a
 * site's files through their own guarded writes (Galley's "Set it up for
 * me" ships this inside the app bundle).
 *
 * @returns {{ version: string, files: Record<string, string>, settings: string }}
 */
export function kitBundle() {
  return { version: VERSION, files: vendoredFiles(), settings: SETTINGS };
}

/** @param {string} siteDir */
export function vendor(siteDir) {
  const site = resolve(siteDir);

  if (!existsSync(join(site, "package.json"))) throw new Error(`${site} has no package.json; give the site's folder.`);
  const target = join(site, "src", "galley");
  const settings = join(target, "settings.json");
  const keep = existsSync(settings) ? readFileSync(settings) : null;

  // Kit files are replaced wholesale so a file the kit no longer has doesn't linger.
  for (const name of existsSync(target) ? readdirSync(target) : []) {
    if (name !== "settings.json") rmSync(join(target, name), { recursive: true, force: true });
  }
  const files = vendoredFiles();

  for (const [file, text] of Object.entries(files)) {
    const path = join(target, file);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  if (keep) writeFileSync(settings, keep);
  else writeFileSync(settings, SETTINGS);
  return { target, files: Object.keys(files).length + 1, version: VERSION };
}

/** relative path → bytes, for tests. */
export function snapshot(/** @type {string} */ dir) {
  /** @type {Record<string, string>} */
  const out = {};
  const walk = (/** @type {string} */ at) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);

      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = readFileSync(path, "utf8");
    }
  };

  walk(dir);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const siteDir = process.argv[2];

  if (!siteDir) {
    console.error("Usage: node scripts/vendor.mjs <siteDir>");
    process.exit(1);
  }
  const { target, files, version } = vendor(siteDir);

  console.log(`Vendored @galley/astro ${version}: ${files} files in ${target}`);
}
