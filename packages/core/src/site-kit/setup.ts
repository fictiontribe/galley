/**
 * "Set it up for me": puts the site kit into an Astro site that doesn't have
 * it, as ordinary pending changes — so the result shows in Proof, can be
 * discarded file by file, and is published like any edit.
 *
 * What it does, each step only when it is still needed:
 *   1. the kit's files into src/galley/ (what `scripts/vendor.mjs` writes),
 *      with settings.json pointing forms at this app's inbox;
 *   2. a forms folder with a first form, "Contact";
 *   3. the scripts setup, src/data/scripts.json (asking for consent);
 *   4. the forms collection in the content config — only when the config
 *      has the standard `export const collections = { … }` shape;
 *   5. the three `<Scripts />` placements — only when the site has exactly
 *      one base layout with a literal <head> and <body>.
 * When 4 or 5 is ambiguous it does everything else and says what is left,
 * with a request the assistant can finish in build mode and the lines a
 * developer would add. It never guesses (Principle 4).
 *
 * `planSiteKit` reads; `runSiteKitSetup` writes, through SiteService's
 * guarded writes in build mode (the kit is code, so a site with build mode
 * turned off is refused before anything is written).
 */
import type { SiteKitStatus, SiteKitStep } from "../api";
import { CONTACT_FORM } from "../forms/shared";
import { applyEdits } from "../content/index";
import { GalleyError } from "../errors";
import type { SiteModel, SiteService } from "../types";
import { FORMS_DIR, KIT_DIR, KIT_SETTINGS, SCRIPTS_FILE, VENDOR_HEADER } from "./detect";
import { loadKitBundle, type KitBundle } from "./source";
import { FORMS_COLLECTION_LINE, isBaseLayout, kitImport, wireAstroConfig, wireContentConfig, wireLayout, type WiringResult } from "./wiring";
import { ASTRO_CONFIG_FILES } from "../adapters/astro/site-config";

const CONTENT_CONFIGS = ["src/content.config.ts", "src/content.config.mts", "src/content.config.mjs", "src/content.config.js", "src/content/config.ts", "src/content/config.mts", "src/content/config.mjs", "src/content/config.js"];
const LAYOUT_GLOB = "src/**/*.astro";
const CONTACT_PATH = `${FORMS_DIR}/contact.json`;
/** The data file the kit's build step reads (docs/ai-first-output.md). */
export const VISIBILITY_FILE = "src/data/visibility.json";

/** The scripts setup a site starts with: nothing loads, and the banner asks once a script needs consent. */
export const FIRST_SCRIPTS = { consent: { mode: "banner", googleConsentMode: true }, scripts: [] } as const;

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * An address the live site may be given: http(s), and not this computer or a
 * private network — a page on the internet can't reach those, and a file
 * that is published must never point at them.
 */
export function isPublicAddress(address: string): boolean {
  try {
    const url = new URL(address);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (host === "localhost" || host === "::1" || host === "0.0.0.0" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)) return false;
    if (/\.(local|localhost|internal|lan|home\.arpa)$/.test(host) || (!host.includes(".") && !host.includes(":"))) return false;
    return true;
  } catch {
    return false;
  }
}

/** Whether a form sends to the inbox with no address of its own. */
function needsInbox(form: unknown): boolean {
  const destinations = form && typeof form === "object" ? (form as { destinations?: unknown }).destinations : undefined;

  return Array.isArray(destinations) && destinations.some((destination) => destination && typeof destination === "object" && (destination as { provider?: unknown }).provider === "galley" && !((destination as { settings?: { endpoint?: unknown } }).settings?.endpoint));
}

/** The inbox address part of the status: whether forms use it, and what the kit's settings say (after `writes`, when given). */
async function inboxStatus(site: SiteService, inbox: SiteKitStatus["inbox"], writes: Map<string, string>): Promise<SiteKitStatus["inbox"]> {
  const forms = await site.listFiles({ glob: `${FORMS_DIR}/*.json`, limit: 500 }).catch(() => [] as string[]);
  const texts = [...new Set([...forms, ...[...writes.keys()].filter((path) => path.startsWith(`${FORMS_DIR}/`))])];
  let used = false;

  for (const path of texts) {
    const text = writes.get(path) ?? (await readText(site, path));

    try {
      if (text && needsInbox(JSON.parse(text))) used = true;
    } catch {
      // A form that can't be read is Proof's to report.
    }
  }
  let endpoint: string | null = null;
  const settings = writes.get(KIT_SETTINGS) ?? (await readText(site, KIT_SETTINGS));

  try {
    const value = settings ? (JSON.parse(settings) as { forms?: { endpoint?: unknown } }).forms?.endpoint : undefined;

    endpoint = typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  } catch {
    endpoint = null;
  }
  return { ...inbox, used, endpoint };
}

/**
 * Points the live site's forms at this app's inbox: `forms.endpoint` in the
 * kit's settings, changed in place (the rest of the file stays as it is), as
 * a pending change. Refuses an address visitors can't reach.
 */
export async function setInboxEndpoint(site: SiteService, address: string): Promise<void> {
  if (!isPublicAddress(address)) {
    throw new GalleyError("invalid", "Visitors' browsers can't reach this app's inbox at that address, so it isn't written into the site. Run the app on a server with a public address, or send the form to another destination.");
  }
  // One key set in the file as it is: when the file changed between reading it and writing it, it is read again.
  for (let attempt = 1; ; attempt += 1) {
    let file: { content: string; hash: string };

    try {
      file = await site.readFile(KIT_SETTINGS);
    } catch {
      throw new GalleyError("not-found", "The site kit's settings file (src/galley/settings.json) isn't there. Set up forms first.");
    }
    const edited = applyEdits(file.content, "json", [{ op: "set", path: ["forms", "endpoint"], value: address }]);

    if (edited.refused.length > 0) throw new GalleyError("invalid", `The site kit's settings couldn't be changed: ${edited.refused[0]!.reason}`);
    if (edited.content === file.content) return;
    try {
      await site.writeFile(KIT_SETTINGS, edited.content, { origin: "user", mode: "build", baseHash: file.hash });
      return;
    } catch (error) {
      if (!(error instanceof GalleyError && error.code === "conflict") || attempt >= 3) throw error;
    }
  }
}

export interface PlanOptions {
  /** The site's capture address (this app's inbox for the site). */
  captureAddress?: string | null;
  /**
   * Whether visitors' browsers can reach that address from the internet. Only
   * then is it written into the kit's settings, which are published; otherwise
   * the preview gets it at run time and the live site's choice is left to the person.
   */
  captureReachable?: boolean;
}

interface Planned {
  status: SiteKitStatus;
  /** What running the plan writes, by path. */
  writes: Map<string, string>;
  /** Which step each write belongs to. */
  owners: Map<string, SiteKitStep["id"]>;
}

async function readText(site: SiteService, path: string): Promise<string | null> {
  try {
    const file = await site.readFile(path);

    return file.content;
  } catch {
    return null;
  }
}

/** The kit files the site is missing or has from another version, and files under src/galley/ that aren't the kit's. */
async function kitFiles(site: SiteService, kit: KitBundle, options: PlanOptions): Promise<{ writes: Map<string, string>; foreign: string[]; current: boolean; present: boolean }> {
  const writes = new Map<string, string>();
  const existing = await site.listFiles({ glob: `${KIT_DIR}/**`, limit: 2000 }).catch(() => [] as string[]);
  const ours = new Set(Object.keys(kit.files).map((file) => `${KIT_DIR}/${file}`));
  const foreign: string[] = [];

  for (const path of existing) {
    if (ours.has(path) || path === KIT_SETTINGS) continue;
    const text = await readText(site, path);

    // A file an older kit had (it carries the header) may stay; anything else under src/galley/ isn't the kit's.
    if (!text || !VENDOR_HEADER.test(text)) foreign.push(path);
  }
  for (const [file, text] of Object.entries(kit.files)) {
    const path = `${KIT_DIR}/${file}`;

    if ((await readText(site, path)) !== text) writes.set(path, text);
  }
  if (!existing.includes(KIT_SETTINGS)) {
    const settings = JSON.parse(kit.settings) as { forms: { endpoint: string } };

    if (options.captureAddress && options.captureReachable && isPublicAddress(options.captureAddress)) settings.forms.endpoint = options.captureAddress;
    writes.set(KIT_SETTINGS, json(settings));
  }
  return { writes, foreign, current: writes.size === 0, present: existing.length > 0 };
}

function leftRequest(steps: SiteKitStep[]): string | undefined {
  const left = steps.filter((step) => step.state === "left");

  if (left.length === 0) return undefined;
  const parts = left.map((step) => `${step.label.charAt(0).toLowerCase()}${step.label.slice(1)}${step.snippet ? ` (${step.snippet.file}: ${step.snippet.code.replace(/\n/g, " ")})` : ""} — set-up left it because ${step.detail?.replace(/\.$/, "") ?? "it wasn't clear how"}`);

  return `Finish setting up the site kit on this site. Use build mode: ${parts.join("; and ")}. Change only what that needs, run the build to check it, then tell me what changed.`;
}

/** What the site has of the kit, and what setting it up would do. Reads only. */
export async function planSiteKit(site: SiteService, options: PlanOptions = {}): Promise<Planned> {
  const model = await site.model();
  const framework = { id: model.framework.id, name: model.framework.name };
  const inbox: SiteKitStatus["inbox"] = { used: false, endpoint: null, settable: model.kit?.source !== "package", address: options.captureAddress ?? null, reachable: options.captureReachable === true };
  const status: SiteKitStatus = { framework, supported: true, buildAllowed: model.ai.allowBuild, kit: model.kit ?? null, available: null, steps: [], ready: false, inbox };
  const writes = new Map<string, string>();
  const owners = new Map<string, SiteKitStep["id"]>();
  const put = (id: SiteKitStep["id"], path: string, text: string) => {
    writes.set(path, text);
    owners.set(path, id);
  };

  if (model.framework.id !== "astro") {
    status.supported = false;
    status.reason = `The site kit works with Astro sites today, and this site is built with ${framework.name}. An adapter guide explains how to bring forms and managed scripts to another framework.`;
    return { status, writes, owners };
  }
  if (model.routesDir && !model.routesDir.startsWith("src/")) {
    status.supported = false;
    status.reason = "The site keeps its pages outside src/, and the site kit expects the standard src/ folder.";
    return { status, writes, owners };
  }
  if (model.kit?.source === "package") {
    // A site using the published package needs no vendored copy; only the wiring can be missing.
    status.available = model.kit.version ?? null;
  }
  const kit = model.kit?.source === "package" ? null : await loadKitBundle();

  if (kit) status.available = kit.version;
  const steps: SiteKitStep[] = [];

  // 1. the kit's files
  if (kit) {
    const files = await kitFiles(site, kit, options);

    if (files.foreign.length > 0) {
      steps.push({
        id: "files",
        label: "Add the site kit’s files",
        state: "left",
        detail: `src/galley/ already holds files that aren't the kit’s (${files.foreign.slice(0, 3).join(", ")}${files.foreign.length > 3 ? "…" : ""}), so they are left as they are.`,
      });
    } else {
      steps.push({ id: "files", label: files.present && !files.current ? "Update the site kit’s files" : "Add the site kit’s files", state: files.current ? "done" : "ready" });
      for (const [path, text] of files.writes) put("files", path, text);
    }
  }

  // 2. the forms folder and a first form
  const formsCollection = model.collections.find((collection) => collection.kit === "forms");
  const otherForms = model.collections.find((collection) => collection.id === "forms" && collection.kit !== "forms");
  const formFiles = await site.listFiles({ glob: `${FORMS_DIR}/*.json`, limit: 10 }).catch(() => [] as string[]);

  if (formsCollection || formFiles.length > 0) steps.push({ id: "forms", label: "Add a forms folder and a first form", state: "done" });
  else if (otherForms) steps.push({ id: "forms", label: "Add a forms folder and a first form", state: "left", detail: `The site already has a collection called “forms” in ${otherForms.path}, which isn’t one of the kit’s.` });
  else {
    steps.push({ id: "forms", label: "Add a forms folder and a first form, “Contact”", state: "ready" });
    put("forms", CONTACT_PATH, json(CONTACT_FORM));
  }

  // 3. the scripts setup
  const scriptsFile = model.collections.find((collection) => collection.kit === "scripts");

  if (scriptsFile || (await readText(site, SCRIPTS_FILE)) !== null) steps.push({ id: "scripts", label: "Add the scripts setup", state: scriptsFile ? "done" : "left", ...(scriptsFile ? {} : { detail: `${SCRIPTS_FILE} already exists and isn’t a scripts setup.` }) });
  else {
    steps.push({ id: "scripts", label: "Add the scripts setup", state: "ready" });
    put("scripts", SCRIPTS_FILE, json(FIRST_SCRIPTS));
  }

  // 4. the forms collection in the content config
  let configPath: string | null = null;

  for (const candidate of CONTENT_CONFIGS) {
    if ((await readText(site, candidate)) !== null) {
      configPath = candidate;
      break;
    }
  }
  const collectionStep = (result: WiringResult, file: string): SiteKitStep => {
    const snippet = { file, code: `import { formSchema } from "${kitImport(file, "schema.js")}";\n// in export const collections = { … }:\nforms: ${FORMS_COLLECTION_LINE},` };

    if (result.state === "done") return { id: "collection", label: "Connect forms to the site’s content", state: "done" };
    if (result.state === "left") return { id: "collection", label: "Connect forms to the site’s content", state: "left", detail: result.reason, snippet };
    return { id: "collection", label: "Connect forms to the site’s content", state: "ready" };
  };

  if (!configPath) {
    steps.push({
      id: "collection",
      label: "Connect forms to the site’s content",
      state: "left",
      detail: "The site has no content config (src/content.config.ts) to add the forms collection to.",
      snippet: { file: "src/content.config.ts", code: `import { defineCollection } from "astro:content";\nimport { glob } from "astro/loaders";\nimport { formSchema } from "./galley/schema.js";\n\nexport const collections = {\n  forms: ${FORMS_COLLECTION_LINE},\n};` },
    });
  } else {
    const text = (await readText(site, configPath)) ?? "";
    const result = otherForms ? ({ state: "left", reason: `${configPath} already has a collection called “forms” that isn’t the site kit’s.` } as const) : wireContentConfig(text, configPath);

    steps.push(collectionStep(result, configPath));
    if (result.state === "edited") put("collection", configPath, result.text);
  }

  // 5. the scripts in the base layout
  const astroFiles = await site.listFiles({ glob: LAYOUT_GLOB, limit: 2000 }).catch(() => [] as string[]);
  const layouts: Array<{ path: string; text: string }> = [];

  for (const path of astroFiles) {
    if (path.startsWith(`${KIT_DIR}/`)) continue;
    const text = await readText(site, path);

    if (text && isBaseLayout(text)) layouts.push({ path, text });
  }
  const layoutSnippet = (file: string) => ({
    file,
    code: `import { Scripts } from "${kitImport(file, "components/index.js")}";\n<!-- after <meta charset>: --> <Scripts placement="head" />\n<!-- after <body>: --> <Scripts placement="body-start" />\n<!-- before </body>: --> <Scripts placement="body-end" />`,
  });

  if (layouts.length !== 1) {
    steps.push({
      id: "layout",
      label: "Add the scripts to the page layout",
      state: "left",
      detail:
        layouts.length === 0
          ? "No layout in src/ writes its own <html>, <head> and <body>, so where the scripts go isn’t clear."
          : `${layouts.length} files write their own <html>, <head> and <body> (${layouts
              .slice(0, 3)
              .map((layout) => layout.path)
              .join(", ")}${layouts.length > 3 ? "…" : ""}), so which one every page uses isn’t clear.`,
      snippet: layoutSnippet(layouts[0]?.path ?? "src/layouts/Base.astro"),
    });
  } else {
    const layout = layouts[0]!;
    const result = wireLayout(layout.text, layout.path);

    if (result.state === "done") steps.push({ id: "layout", label: "Add the scripts to the page layout", state: "done" });
    else if (result.state === "left") steps.push({ id: "layout", label: "Add the scripts to the page layout", state: "left", detail: result.reason, snippet: layoutSnippet(layout.path) });
    else {
      steps.push({ id: "layout", label: `Add the scripts to the page layout (${layout.path.split("/").pop()})`, state: "ready" });
      put("layout", layout.path, result.text);
    }
  }

  // 6. the version AI assistants can read: the kit's build step in astro.config, and its data file
  steps.push(await visibilityStep(site, model, put));

  status.steps = steps;
  status.ready = steps.every((step) => step.state === "done");
  status.inbox = await inboxStatus(site, inbox, writes);
  const request = leftRequest(steps);

  if (request) status.assistantRequest = request;
  return { status, writes, owners };
}

/**
 * The first src/data/visibility.json: the starters' defaults, with
 * structured data for articles only on the collections this site shows as
 * dated posts (a date field and pages of their own), and the policy pages it
 * actually has listed as secondary in llms.txt.
 */
export async function firstVisibility(site: SiteService, model: SiteModel): Promise<string> {
  const articles = model.collections.filter((collection) => collection.kind === "entries" && collection.url !== null && Boolean(collection.dateField) && !collection.kit).map((collection) => collection.id);
  const optional: string[] = [];

  for (const page of ["/privacy/", "/terms/"]) if (await site.entryForUrl(page).catch(() => null)) optional.push(page);
  return json({
    crawlers: {},
    robots: { disallow: [] },
    sitemap: { exclude: [], lastmod: "content" },
    structuredData: { website: true, organization: { sameAs: [] }, articles, breadcrumbs: true },
    agentReadable: { llmsTxt: true, llmsFullTxt: true, markdownTwins: true, agentPage: true, optional, exclude: [] },
  });
}

const VISIBILITY_LABEL = "Publish a version AI assistants can read";

async function visibilityStep(site: SiteService, model: SiteModel, put: (id: SiteKitStep["id"], path: string, text: string) => void): Promise<SiteKitStep> {
  let configPath: string | null = null;

  for (const candidate of ASTRO_CONFIG_FILES) {
    if ((await readText(site, candidate)) !== null) {
      configPath = candidate;
      break;
    }
  }
  const snippet = (file: string) => ({ file, code: `import galley from "${kitImport(file, "integration.js")}";
// in export default defineConfig({ … }):
integrations: [galley()],` });
  const data = (await readText(site, VISIBILITY_FILE)) === null ? await firstVisibility(site, model) : null;

  if (!configPath) {
    return { id: "visibility", label: VISIBILITY_LABEL, state: "left", detail: "The site has no astro.config file to turn the kit’s build step on in.", snippet: snippet("astro.config.mjs") };
  }
  const result = wireAstroConfig((await readText(site, configPath)) ?? "", configPath);

  if (data) put("visibility", VISIBILITY_FILE, data);
  if (result.state === "left") return { id: "visibility", label: VISIBILITY_LABEL, state: "left", detail: result.reason, snippet: snippet(configPath) };
  if (result.state === "edited") put("visibility", configPath, result.text);
  return { id: "visibility", label: VISIBILITY_LABEL, state: result.state === "done" && !data ? "done" : "ready" };
}

export interface SetupProgress {
  /** A step started: its plain label. */
  step(label: string, progress: number): void;
}

export interface SetupOutcome {
  status: SiteKitStatus;
  /** Every file written, in order. */
  written: string[];
  build: { ok: boolean; output: string } | null;
}

/**
 * Runs the plan. Writes in the order a site can take them — kit files, then
 * content, then the config and layout that point at them — and re-reads the
 * site at the end so the Forms and Scripts screens work straight away. When
 * the site can build, builds it once to check the result.
 */
export async function runSiteKitSetup(site: SiteService, options: PlanOptions & { progress?: SetupProgress; build?: boolean; only?: Array<SiteKitStep["id"]> } = {}): Promise<SetupOutcome> {
  const before = await planSiteKit(site, options);
  const model = await site.model();

  if (!before.status.supported) throw new GalleyError("invalid", before.status.reason ?? "This site can’t take the site kit.");
  if (!model.ai.allowBuild) {
    throw new GalleyError("forbidden", "Setting up forms and scripts changes the site’s code, and this site’s settings turn that off. Turn on “Allow build mode” in Site settings › Assistant, or have a developer add the kit.");
  }
  const order = (path: string) => (path.startsWith(`${KIT_DIR}/`) ? 0 : path.startsWith("src/content/") || path.startsWith("src/data/") ? 1 : 2);
  // `only`: just those steps (a kit site turning on the AI-readable version updates the kit's files with it).
  const wanted = (path: string) => !options.only || options.only.includes(before.owners.get(path) ?? "files");
  const paths = [...before.writes.keys()].filter(wanted).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const written: string[] = [];
  const labels = ["Adding the site kit’s files", "Adding a first form and the scripts setup", "Connecting them to the site’s code"];
  let stage = -1;

  for (const [index, path] of paths.entries()) {
    if (order(path) !== stage) {
      stage = order(path);
      options.progress?.step(labels[stage]!, index / Math.max(1, paths.length));
    }
    await site.writeFile(path, before.writes.get(path)!, { origin: "user", mode: "build" });
    written.push(path);
  }
  options.progress?.step("Reading the site again", 0.9);
  await site.refresh();
  let build: SetupOutcome["build"] = null;

  if (options.build !== false && written.length > 0 && model.build && model.installed) {
    options.progress?.step("Checking that the site still builds", 0.95);
    try {
      const result = await site.build();

      build = { ok: result.ok, output: result.output };
    } catch (error) {
      build = { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }
  const after = await planSiteKit(site, options);

  return { status: after.status, written, build };
}
