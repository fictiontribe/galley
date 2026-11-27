// @ts-check
// `@galleycms/astro` — the Galley site kit for Astro. Three parts, each one
// switchable:
//
//   toolbar  In `astro dev` only: a Dev Toolbar app that says whether Galley
//            is running and opens the current page in it, plus the status
//            route it asks. Nothing in `astro build`.
//   forms    <Form id="…" /> renders src/content/forms/<id>.json; this part
//            gives the components the site-wide settings (capture address,
//            wording, whether `script` actions may run).
//   scripts  Reads src/data/scripts.json and puts the managed third-party
//            scripts (and the consent banner) into every page, with no
//            template change. Logs what loads; answers /__galley/scripts.json
//            in `astro dev`.
//   mailto   Every email link offers Gmail, Outlook, the visitor's mail app
//            or copying the address (docs/mailto.md). On by default; added
//            only to pages that have an email link.
//   visibility  The agent-readable version of the site (docs/ai-first-output.md):
//            a markdown twin of every page, llms.txt, llms-full.txt,
//            agent.md, structured data, and robots.txt / sitemap.xml when the
//            site has none of its own — from src/data/visibility.json, after
//            the build and live in `astro dev`. Adds no JavaScript.
//
// A site that uses no forms, no scripts file, `mailto: false` and
// `visibility: false` gets byte-identical build output with or without the
// integration.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID, DEFAULT_URL, ICON, INTEGRATION_NAME, PRODUCT_NAME, SCRIPTS_MANIFEST_PATH, URL_ENV } from "./constants.js";
import { resolveMailto } from "./mailto/config.js";
import { summarize, manifest } from "./scripts/plan.js";
import { formsUseUtm, readScripts } from "./site-files.js";
import { createStatusMiddleware } from "./status.js";
import { visibilityHooks } from "./visibility/integration.js";

export { APP_ID, DEFAULT_URL, INTEGRATION_NAME, PRODUCT_NAME, SCRIPTS_MANIFEST_PATH, STATUS_PATH, URL_ENV } from "./constants.js";

/**
 * @typedef {object} FormsOptions
 * @property {string} [collection]  Content collection the forms live in. Default "forms".
 * @property {string} [dir]  Its folder, for the site-wide scan. Default "src/content/forms".
 * @property {string} [endpoint]  The capture address for "galley" destinations.
 * @property {boolean} [allowFormScripts]  Let `script` after-submit actions run. Default false.
 * @property {Record<string, string>} [messages]  Site-wide wording (docs/forms.md).
 * @property {string[]} [freeEmailDomains]  Extra domains `businessEmailOnly` refuses.
 */

/**
 * @typedef {object} ScriptsOptions
 * @property {string} [file]  The scripts file. Default "src/data/scripts.json".
 * @property {boolean} [inject]  Put scripts into every page automatically. Default true.
 */

/**
 * @typedef {object} GalleyOptions
 * @property {string} [url] Address of the Galley server to look for. Default:
 *   the `GALLEY_URL` environment variable, else `http://127.0.0.1:4400`.
 * @property {boolean} [toolbar] The Dev Toolbar app. Default true.
 * @property {FormsOptions | false} [forms]
 * @property {ScriptsOptions | false} [scripts]
 * @property {import("./mailto/config.js").MailtoOptions | false} [mailto]  The email-link dialog. On by default.
 * @property {import("./visibility/integration.js").VisibilityOptions | false} [visibility]  The agent-readable output. On by default.
 */

/**
 * The Galley address: the option, else `GALLEY_URL`, else the default — as an
 * origin-plus-path with no trailing slash.
 *
 * @param {GalleyOptions} [options]
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveGalleyUrl(options = {}, env = process.env) {
  const raw = options.url?.trim() || env[URL_ENV]?.trim() || DEFAULT_URL;
  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${INTEGRATION_NAME}: “${raw}” isn't a web address. Set \`url\` (or ${URL_ENV}) to where ${PRODUCT_NAME} runs, such as ${DEFAULT_URL}.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${INTEGRATION_NAME}: “${raw}” must start with http:// or https://.`);
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

/** The toolbar app's module, as a file path Vite can serve. */
export const TOOLBAR_ENTRYPOINT = fileURLToPath(new URL("./toolbar-app.js", import.meta.url));
/** The middleware that injects managed scripts. */
export const SCRIPTS_MIDDLEWARE = fileURLToPath(new URL("./scripts/middleware.js", import.meta.url));

const VIRTUAL_ID = "virtual:galley-kit/config";

/**
 * The forms options with defaults applied.
 *
 * @param {FormsOptions | false | undefined} forms
 */
export function formsSettings(forms) {
  const given = forms || {};

  return {
    collection: given.collection ?? "forms",
    dir: given.dir ?? "src/content/forms",
    endpoint: given.endpoint ?? "",
    allowFormScripts: given.allowFormScripts === true,
    messages: given.messages ?? {},
    freeEmailDomains: given.freeEmailDomains ?? [],
  };
}

/**
 * @param {GalleyOptions} [options]
 * @returns {import("astro").AstroIntegration}
 */
export default function galley(options = {}) {
  const url = resolveGalleyUrl(options);
  const forms = formsSettings(options.forms);
  const scriptsFile = (options.scripts && options.scripts.file) || "src/data/scripts.json";
  const mailto = resolveMailto(options.mailto);
  let root = "";
  let base = "/";
  const visibility = /** @type {Record<string, (options: any) => any>} */ (visibilityHooks(options.visibility));

  return {
    name: INTEGRATION_NAME,
    hooks: {
      "astro:config:setup": (setup) => {
        const { command, config, addDevToolbarApp, updateConfig, addMiddleware, addWatchFile, logger } = setup;

        if (command === "dev" && options.toolbar !== false) addDevToolbarApp({ id: APP_ID, name: PRODUCT_NAME, icon: ICON, entrypoint: TOOLBAR_ENTRYPOINT });
        visibility["astro:config:setup"]?.(setup);
        if (!config || (options.forms === false && options.scripts === false && !mailto)) return;
        const siteRoot = fileURLToPath(config.root).replace(/[\\/]+$/, "");
        const scripts = options.scripts === false ? null : readScripts(siteRoot, scriptsFile);
        const utm = options.forms !== false && formsUseUtm(siteRoot, forms.dir);
        const source = [
          `export const options = ${JSON.stringify({ collection: forms.collection, endpoint: forms.endpoint, allowFormScripts: forms.allowFormScripts, messages: forms.messages, freeEmailDomains: forms.freeEmailDomains })};`,
          `export const scripts = ${JSON.stringify(scripts)};`,
          `export const scriptsFile = ${JSON.stringify(scriptsFile)};`,
          `export const utm = ${JSON.stringify(utm)};`,
          `export const mailto = ${JSON.stringify(mailto)};`,
        ].join("\n");

        // The components read the site's settings from this module. It only
        // exists for them: a site that imports none of them builds as before.
        updateConfig({
          vite: {
            plugins: [
              {
                name: "galley-kit-config",
                resolveId: (id) => (id === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : undefined),
                load: (id) => (id === `\0${VIRTUAL_ID}` ? source : undefined),
              },
            ],
          },
        });
        const inject = options.scripts !== false && options.scripts?.inject !== false;

        if (options.scripts !== false) addWatchFile(join(siteRoot, scriptsFile));
        if ((inject && (scripts || utm)) || mailto) addMiddleware({ order: "pre", entrypoint: SCRIPTS_MIDDLEWARE });
        if (scripts && command === "build") for (const line of summarize(scripts)) logger.info(line);
      },
      "astro:config:done": (done) => {
        const { config } = done;

        root = fileURLToPath(config.root).replace(/[\\/]+$/, "");
        base = config.base || "/";
        visibility["astro:config:done"]?.(done);
      },
      // Only `astro dev` runs this hook.
      "astro:server:setup": (serverSetup) => {
        const { server } = serverSetup;
        const status = createStatusMiddleware({ url, root, base });
        const manifestPath = `${base.replace(/\/+$/, "")}${SCRIPTS_MANIFEST_PATH}`;

        server.middlewares.use((req, res, next) => {
          const [pathname, query = ""] = (req.url ?? "").split("?");

          if (options.scripts === false || pathname !== manifestPath || req.method !== "GET") return status(req, res, next);
          let body;

          try {
            body = manifest(readScripts(root, scriptsFile), new URLSearchParams(query).get("path") || "/", scriptsFile);
          } catch (error) {
            body = { file: scriptsFile, exists: true, error: error instanceof Error ? error.message : String(error), scripts: [] };
          }
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(JSON.stringify(body));
        });
        // After the status route, so /__galley/… stays the toolbar's.
        visibility["astro:server:setup"]?.(serverSetup);
      },
      ...(visibility["astro:routes:resolved"] ? { "astro:routes:resolved": visibility["astro:routes:resolved"] } : {}),
      ...(visibility["astro:build:done"] ? { "astro:build:done": visibility["astro:build:done"] } : {}),
    },
  };
}
