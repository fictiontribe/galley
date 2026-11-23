/**
 * detectSite: everything Galley can learn about a site by reading it —
 * framework, package manager, commands, media folders, deployed URLs and
 * content collections with inferred fields.
 *
 * Framework knowledge lives in adapters (`src/adapters/`, or the site's own,
 * loaded by loadSiteModel). This file is the engine around them: it lets
 * every adapter's `detect` bid, runs the winner's hooks, and fills in
 * whatever the adapter left out — package manager, commands from
 * package.json, media folders, conventional collection discovery, field
 * inference, notes. Detection never throws because a file looked unusual or
 * an adapter misbehaved; what could not be read becomes a note.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import { PRODUCT } from "../../brand";
import { createAdapterContext, createShared, readPackageJson, setContextConventions } from "../../adapter/context";
import { validateAdapter } from "../../adapter/load";
import type { AdapterContext, AdapterConventions, AdapterMatch, CollectionDraft, GalleyAdapter, PackageJsonLike } from "../../adapter/types";
import { BUILTIN_ADAPTERS, GENERIC_ID, genericAdapter } from "../../adapters/index";
import type { Collection, EntryFormat, Field, FrameworkInfo, MediaConfig, PackageManager, SiteModel } from "../../types";
import { formatForPath } from "../document/parse";
import { absolute } from "../entries/files";
import { normalizePath } from "../entries/paths";
import { collectionNames } from "../util/text";
import { applySiteKit } from "../../site-kit/detect";
import { inspectCollection } from "./inspect";

/** No adapter hook may hold detection up longer than this. */
const HOOK_TIMEOUT_MS = 10_000;

export interface DetectOptions {
  /** Adapters considered before the built-in ones (a site's configured adapters), in order. */
  adapters?: GalleyAdapter[];
  /** Include the built-in adapters after `adapters`. [true] */
  builtins?: boolean;
  /** Use the adapter with this id whatever the others say (galley.config.json `framework`). */
  framework?: string;
  /** Notes to start with (from loading the adapters). */
  notes?: string[];
}

export interface DetectionCandidate {
  id: string;
  name: string;
  match: AdapterMatch | null;
  /** Set when its detect threw or returned something unusable. */
  error?: string;
}

export interface DetectionRun {
  model: SiteModel;
  /** The adapter that described the site. */
  adapter: GalleyAdapter;
  match: AdapterMatch;
  /** What the adapter's `collections` hook returned (null when it has none, returned null, or failed). */
  drafts: CollectionDraft[] | null;
  /** Every adapter that bid, in registration order. */
  candidates: DetectionCandidate[];
  /** Adapter hooks that failed, in plain words (also in the model's notes). */
  problems: string[];
}

function isDir(root: string, path: string): boolean {
  try {
    return statSync(absolute(root, path)).isDirectory();
  } catch {
    return false;
  }
}

function readText(root: string, path: string): string | null {
  try {
    return readFileSync(absolute(root, path), "utf8");
  } catch {
    return null;
  }
}

function detectPackageManager(root: string, pkg: PackageJsonLike | null): PackageManager | null {
  const declared = pkg?.packageManager?.split("@")[0];

  if (declared === "npm" || declared === "pnpm" || declared === "yarn" || declared === "bun") return declared;
  if (existsSync(absolute(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(absolute(root, "yarn.lock"))) return "yarn";
  if (existsSync(absolute(root, "bun.lockb")) || existsSync(absolute(root, "bun.lock"))) return "bun";
  if (existsSync(absolute(root, "package-lock.json"))) return "npm";
  return pkg ? "npm" : null;
}

function runScript(pm: PackageManager, script: string): string {
  return pm === "npm" ? `npm run ${script}` : `${pm} run ${script}`;
}

function portFromScript(script: string | undefined): number | null {
  const match = script ? /(?:--port|-p)[ =](\d{2,5})/.exec(script) : null;

  return match ? Number(match[1]) : null;
}

function gitInfo(root: string): { branch: string; remote: string | null } {
  let gitDir = ".git";
  const pointer = readText(root, ".git");

  // Worktrees and submodules keep a ".git" file pointing at the real directory.
  if (pointer && pointer.startsWith("gitdir:")) gitDir = pointer.slice("gitdir:".length).trim();
  const read = (file: string): string | null => {
    try {
      return readFileSync(gitDir.startsWith("/") ? `${gitDir}/${file}` : absolute(root, `${gitDir}/${file}`), "utf8");
    } catch {
      return null;
    }
  };
  const head = read("HEAD");
  const branch = head && /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim();
  // A worktree's config lives in the main repository's git directory.
  const config = read("config") ?? (gitDir.includes("/worktrees/") ? read("../../config") : null);
  const remotes = config ? [...config.matchAll(/^\[remote "([^"]+)"\]/gm)].map((match) => match[1]!) : [];

  return { branch: branch || "main", remote: remotes.includes("origin") ? "origin" : (remotes[0] ?? null) };
}

/** An images folder under the public folder, plus the public folder itself served at "/". */
function detectMedia(root: string, declaredPublicDir: string, override: AdapterConventions["media"]): MediaConfig {
  const publicDir = isDir(root, declaredPublicDir) ? declaredPublicDir : isDir(root, "public") ? "public" : declaredPublicDir;
  const prefix = publicDir === "." ? "" : `${publicDir}/`;
  const candidates = ["images", "img", "assets/images", "assets/img", "assets", "media", "uploads"];
  const found = candidates.find((dir) => isDir(root, `${prefix}${dir}`)) ?? (publicDir === "." ? "assets/images" : "images");
  const dir = `${prefix}${found}`;
  const roots = [{ dir, publicPath: `/${found}` }];

  if (publicDir !== "." && isDir(root, publicDir)) roots.push({ dir: publicDir, publicPath: "/" });
  const detected: MediaConfig = { dir, publicPath: `/${found}`, roots };

  if (!override) return detected;
  const mediaDir = override.dir ? normalizePath(override.dir) : detected.dir;
  const publicPath = override.publicPath ?? (override.dir ? `/${mediaDir.split("/").slice(publicDir === "." ? 0 : 1).join("/")}` : detected.publicPath);
  const mediaRoots = override.roots ?? (override.dir ? [{ dir: mediaDir, publicPath }, ...detected.roots.filter((item) => item.dir !== detected.dir)] : detected.roots);

  return { dir: mediaDir, publicPath, roots: mediaRoots.some((item) => normalizePath(item.dir) === mediaDir) ? mediaRoots : [{ dir: mediaDir, publicPath }, ...mediaRoots] };
}

function httpUrl(value: unknown): string | undefined {
  return typeof value === "string" && /^https?:\/\/[^\s]+$/.test(value) ? value.replace(/\/$/, "") : undefined;
}

function detectProductionUrl(root: string, publicDir: string, pkg: PackageJsonLike | null, declared: string | undefined): string | undefined {
  if (httpUrl(declared)) return httpUrl(declared);
  for (const file of ["CNAME", `${publicDir}/CNAME`, "public/CNAME", "static/CNAME"]) {
    const text = readText(root, file)?.trim();

    if (text && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text)) return `https://${text}`;
  }
  return httpUrl(pkg?.homepage);
}

function formatFromPattern(pattern: string | undefined): EntryFormat | null {
  if (!pattern) return null;
  if (/\bmdx\b/.test(pattern) && !/\bmd\b|markdown/.test(pattern)) return "mdx";
  if (/\bmd\b|markdown|mdx/.test(pattern)) return "markdown";
  if (/json/.test(pattern)) return "json";
  if (/ya?ml/.test(pattern)) return "yaml";
  if (/toml/.test(pattern)) return "toml";
  return null;
}

interface Draft {
  collection: Collection;
  declared: Field[] | null;
}

const OPTIONAL_KEYS = ["description", "pattern", "titleField", "dateField", "imageField", "draftField", "hidden", "kit"] as const;

/** A full Collection from what an adapter declared; null (with the reason) when the draft is unusable. */
function materialize(root: string, draft: CollectionDraft): Draft | string {
  if (draft === null || typeof draft !== "object") return "a collection was not an object";
  if (typeof draft.id !== "string" || draft.id.trim() === "") return "a collection has no id";
  if (typeof draft.path !== "string") return `the “${draft.id}” collection has no path`;
  const path = normalizePath(draft.path) || ".";
  const kind = draft.kind ?? (formatForPath(path) !== null && !isDir(root, path) ? "data" : "entries");
  const format = draft.format ?? (kind === "data" ? (formatForPath(path) ?? "json") : (formatFromPattern(draft.pattern) ?? "markdown"));
  const names = collectionNames(draft.id);
  const collection: Collection = {
    id: draft.id,
    label: draft.label ?? names.label,
    singular: draft.singular ?? names.singular,
    kind,
    path,
    format,
    body: draft.body ?? (format === "markdown" || format === "mdx"),
    url: draft.url === undefined ? null : draft.url,
    fields: [],
    create: draft.create ?? kind === "entries",
    count: 0,
    source: draft.source ?? (Array.isArray(draft.fields) ? "schema" : "inferred"),
  };

  for (const key of OPTIONAL_KEYS) {
    if (draft[key] !== undefined) (collection as unknown as Record<string, unknown>)[key] = draft[key];
  }
  return { collection, declared: Array.isArray(draft.fields) ? draft.fields : null };
}

function uniqueIds(drafts: Draft[]): Draft[] {
  const seen = new Map<string, number>();

  return drafts.map((draft) => {
    const count = seen.get(draft.collection.id) ?? 0;

    seen.set(draft.collection.id, count + 1);
    return count === 0 ? draft : { ...draft, collection: { ...draft.collection, id: `${draft.collection.id}-${count + 1}` } };
  });
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0]!.trim() || "no reason given";
}

async function withTimeout<T>(run: () => T | Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`it took longer than ${HOOK_TIMEOUT_MS / 1000} seconds`)), HOOK_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A detect result the engine can use, or null. Anything else is the adapter's mistake. */
function asMatch(value: unknown): AdapterMatch | null | "invalid" {
  if (value === null || value === undefined || value === false) return null;
  if (typeof value !== "object") return "invalid";
  const { confidence, version } = value as { confidence?: unknown; version?: unknown };

  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return "invalid";
  const match: AdapterMatch = { confidence: Math.min(1, Math.max(0, confidence)) };

  if (typeof version === "string" && version.trim() !== "") match.version = version.trim();
  return match;
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

/** Keeps the conventions whose values have the right shape; reports the rest. */
function sanitizeConventions(value: unknown, report: (what: string) => void): AdapterConventions {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    report("its conventions were not an object");
    return {};
  }
  const input = value as Record<string, unknown>;
  const out: AdapterConventions = {};
  const object = (key: string): Record<string, unknown> | undefined => {
    const inner = input[key];

    if (inner === undefined) return undefined;
    if (inner === null || typeof inner !== "object" || Array.isArray(inner)) {
      report(`“${key}” was not an object`);
      return undefined;
    }
    return inner as Record<string, unknown>;
  };
  const dev = object("dev");

  if (dev) {
    out.dev = {};
    if (typeof dev.command === "string" && dev.command.trim() !== "") out.dev.command = dev.command;
    if (dev.port === null) out.dev.port = null;
    else if (typeof dev.port === "number" && Number.isInteger(dev.port) && dev.port > 0 && dev.port < 65536) out.dev.port = dev.port;
    else if (dev.port !== undefined) report("“dev.port” was not a port number");
    const portArgs = stringList(dev.portArgs);

    if (portArgs && portArgs.length > 0 && portArgs.some((arg) => arg.includes("{port}"))) out.dev.portArgs = portArgs;
    else if (dev.portArgs !== undefined) report("“dev.portArgs” was not a list of arguments with {port} in it");
  }
  const build = object("build");

  if (build) {
    out.build = {};
    if (typeof build.command === "string" && build.command.trim() !== "") out.build.command = build.command;
    if (typeof build.outDir === "string" && build.outDir.trim() !== "") out.build.outDir = build.outDir;
  }
  if (typeof input.publicDir === "string" && input.publicDir.trim() !== "") out.publicDir = normalizePath(input.publicDir) || ".";
  const media = object("media");

  if (media) {
    out.media = {};
    if (typeof media.dir === "string") out.media.dir = media.dir;
    if (typeof media.publicPath === "string") out.media.publicPath = media.publicPath;
    if (Array.isArray(media.roots)) {
      out.media.roots = media.roots.filter((item): item is { dir: string; publicPath: string } => !!item && typeof item === "object" && typeof (item as { dir?: unknown }).dir === "string" && typeof (item as { publicPath?: unknown }).publicPath === "string");
    }
  }
  const urls = object("urls");

  if (urls) {
    out.urls = {};
    if (httpUrl(urls.production)) out.urls.production = httpUrl(urls.production)!;
    else if (urls.production !== undefined) report("“urls.production” was not a web address");
    if (httpUrl(urls.staging)) out.urls.staging = httpUrl(urls.staging)!;
  }
  if (typeof input.trailingSlash === "boolean") out.trailingSlash = input.trailingSlash;
  if (typeof input.routesDir === "string" && input.routesDir.trim() !== "") out.routesDir = normalizePath(input.routesDir) || ".";
  for (const key of ["contentDirs", "pageDirs", "dataDirs"] as const) {
    if (input[key] === undefined) continue;
    const list = stringList(input[key]);

    if (list) out[key] = list;
    else report(`“${key}” was not a list of folders`);
  }
  if (input.contentUrls === "folders" || input.contentUrls === "none") out.contentUrls = input.contentUrls;
  return out;
}

/**
 * Runs detection with the given adapters and reports which one won and how
 * every hook went — the engine behind detectSite, exported for the adapter
 * conformance kit.
 */
export async function runDetection(root: string, options: DetectOptions = {}): Promise<DetectionRun> {
  const notes: string[] = [...(options.notes ?? [])];
  const problems: string[] = [];
  const pkg = readPackageJson(root, notes);
  const shared = createShared(root, pkg);
  const registry: GalleyAdapter[] = [];

  for (const candidate of options.adapters ?? []) {
    const check = validateAdapter(candidate);

    if (!check.ok) {
      notes.push(`${check.problem} It was skipped.`);
      continue;
    }
    if (!registry.some((adapter) => adapter === check.adapter)) registry.push(check.adapter);
  }
  if (options.builtins !== false) registry.push(...BUILTIN_ADAPTERS);

  // ── selection: every adapter bids; the most confident wins, ties go to the earlier one.
  const contexts = new Map<GalleyAdapter, { ctx: AdapterContext; sink: string[] }>();
  const candidates: DetectionCandidate[] = [];
  const contextFor = (adapter: GalleyAdapter) => {
    let entry = contexts.get(adapter);

    if (!entry) {
      const sink: string[] = [];

      entry = { ctx: createAdapterContext(shared, sink), sink };
      contexts.set(adapter, entry);
    }
    return entry;
  };
  let best: { adapter: GalleyAdapter; match: AdapterMatch } | null = null;

  for (const adapter of registry) {
    const { ctx } = contextFor(adapter);
    let match: AdapterMatch | null = null;
    let error: string | undefined;

    try {
      const result = asMatch(await withTimeout(() => adapter.detect(ctx)));

      if (result === "invalid") error = "its detect step returned something other than a match or null";
      else match = result;
    } catch (caught) {
      error = `its detect step failed (${message(caught)})`;
    }
    if (error && !BUILTIN_ADAPTERS.includes(adapter)) notes.push(`The ${adapter.name} adapter could not check this site — ${error} — so it was skipped.`);
    candidates.push({ id: adapter.id, name: adapter.name, match, ...(error ? { error } : {}) });
    if (match && match.confidence > 0 && (!best || match.confidence > best.match.confidence)) best = { adapter, match };
  }
  let chosen: { adapter: GalleyAdapter; match: AdapterMatch } = best ?? { adapter: genericAdapter, match: { confidence: 0.05 } };

  if (options.framework) {
    const forced = registry.find((adapter) => adapter.id === options.framework);

    if (forced && forced !== chosen.adapter) {
      const bid = candidates.find((candidate) => candidate.id === forced.id)?.match;

      chosen = { adapter: forced, match: bid ?? { confidence: 0 } };
      notes.push(`${PRODUCT.configFile} sets the framework to ${forced.name}.`);
    } else if (!forced) {
      notes.push(`${PRODUCT.configFile} sets the framework to “${options.framework}”, but no adapter with that id is available, so ${chosen.adapter.name} was used. Name the adapter in “adapters” to load it.`);
    }
  }
  const { adapter, match } = chosen;
  const { ctx, sink } = contextFor(adapter);
  /** Moves the adapter's notes into the site's notes, keeping them in order with the engine's own. */
  const flush = () => {
    notes.push(...sink);
    sink.length = 0;
  };
  const generic = adapter.id === GENERIC_ID && adapter === genericAdapter;
  const info: FrameworkInfo = { id: adapter.id, name: adapter.name };

  if (match.version) info.version = match.version;
  const hook = async <T>(name: string, consequence: string, run: () => T | Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    try {
      const value = await withTimeout(run);

      flush();
      return { ok: true, value };
    } catch (caught) {
      flush();
      const problem = `The ${adapter.name} adapter's ${name} step failed (${message(caught)}), so ${consequence}.`;

      problems.push(problem);
      notes.push(problem);
      return { ok: false };
    }
  };

  if (!pkg) notes.push(generic ? "No package.json: treating the folder as plain content." : `No package.json: using ${info.name}'s own commands.`);
  notes.push(generic ? "No site framework recognised; markdown folders were scanned." : `Recognised ${info.name}${info.version ? ` ${info.version}` : ""}.`);
  flush();

  // ── conventions
  let conventions: AdapterConventions = {};

  if (adapter.conventions) {
    const result = await hook("conventions", "the usual defaults were used", () => adapter.conventions!(ctx));

    if (result.ok) {
      conventions = sanitizeConventions(result.value, (what) => notes.push(`The ${adapter.name} adapter's conventions were partly unusable (${what}); the default was used instead.`));
    }
  }
  setContextConventions(ctx, conventions);

  const packageManager = detectPackageManager(root, pkg);
  const scripts = pkg?.scripts ?? {};
  const devScript = ["dev", "start", "serve"].find((name) => scripts[name] !== undefined);
  const scriptPort = portFromScript(devScript ? scripts[devScript] : undefined);
  const devPort = scriptPort ?? conventions.dev?.port ?? null;
  // A script that already names its port would get the flag twice, which some CLIs refuse.
  const portArgs = scriptPort === null ? conventions.dev?.portArgs : undefined;
  const dev: SiteModel["dev"] =
    devScript && packageManager
      ? { command: devScript === "start" ? `${packageManager} start` : runScript(packageManager, devScript), port: devPort }
      : conventions.dev?.command
        ? { command: conventions.dev.command, port: devPort }
        : null;

  if (dev && portArgs) dev.portArgs = portArgs;
  const outDir = normalizePath(conventions.build?.outDir ?? "dist") || ".";
  const build = scripts.build && packageManager ? { command: runScript(packageManager, "build"), outDir } : conventions.build?.command ? { command: conventions.build.command, outDir } : null;
  const publicDir = conventions.publicDir ?? "public";
  const media = detectMedia(root, publicDir, conventions.media);

  // ── collections: the adapter's own, else conventional discovery
  let declared: CollectionDraft[] | null = null;

  if (adapter.collections) {
    const result = await hook("collections", "content folders were scanned instead", () => adapter.collections!(ctx));

    if (result.ok && result.value !== null && result.value !== undefined) {
      if (Array.isArray(result.value)) declared = result.value;
      else notes.push(`The ${adapter.name} adapter's collections were not a list, so content folders were scanned instead.`);
    }
  }
  let drafts: Draft[] = [];

  if (declared) {
    for (const draft of declared) {
      const made = materialize(root, draft);

      if (typeof made === "string") notes.push(`The ${adapter.name} adapter described a collection ${PRODUCT.name} can't use (${made}); it was left out.`);
      else drafts.push(made);
    }
  } else {
    const found = ctx.helpers.markdownCollections();

    flush();
    for (const draft of found) {
      const made = materialize(root, draft);

      if (typeof made !== "string") drafts.push(made);
    }
    if (drafts.length > 0) notes.push(`Found ${drafts.length} content folder${drafts.length === 1 ? "" : "s"} by scanning.`);
  }
  const taken = drafts.filter((draft) => draft.collection.kind === "data").map((draft) => draft.collection.path);
  const dataDirs = (conventions.dataDirs ?? []).filter((dir) => isDir(root, dir));

  for (const draft of ctx.helpers.dataCollections(dataDirs, { claimed: taken })) {
    const made = materialize(root, draft);

    if (typeof made !== "string") drafts.push(made);
  }
  flush();
  drafts = uniqueIds(drafts);

  // ── fill in each collection from its files
  const collections = drafts.map((draft) => draft.collection);
  const model = { collections };
  let inspected: Collection[] = [];

  for (let index = 0; index < collections.length; index += 1) {
    const collection = collections[index]!;

    try {
      inspected.push(await inspectCollection(root, model, collection, drafts[index]!.declared, media));
    } catch (error) {
      // An unreadable folder costs that collection its fields, not the whole detection.
      notes.push(`The files of “${collection.label}” could not be read (${message(error)}).`);
      inspected.push({ ...collection, fields: drafts[index]!.declared ?? [] });
    }
  }

  // ── URLs: the adapter's routes override what the drafts said
  if (adapter.routes && inspected.length > 0) {
    const result = await hook("routes", "page addresses were left as they were", () => adapter.routes!(ctx, inspected.map((collection) => ({ ...collection }))));

    if (result.ok && result.value && typeof result.value === "object") {
      inspected = inspected.map((collection) => {
        if (!Object.hasOwn(result.value, collection.id)) return collection;
        const url = (result.value as Record<string, unknown>)[collection.id];

        if (url === null) return { ...collection, url: null };
        if (typeof url === "string" && url.startsWith("/")) return { ...collection, url };
        if (url !== undefined) notes.push(`The ${adapter.name} adapter gave “${collection.label}” the address ${JSON.stringify(url)}, which does not start with "/"; it was ignored.`);
        return collection;
      });
    }
  }
  if (inspected.length === 0) notes.push(`No content collections were found. Add a ${PRODUCT.configFile} to point at your content.`);

  // ── the site kit: forms and the scripts setup are described by the kit's schema, not by inference
  const siteKit = await applySiteKit(root, inspected, { text: (path) => readText(root, path), packageJson: pkg });

  inspected = siteKit.collections;

  // ── environment for the site's own commands
  let environment: Record<string, string> | undefined;

  if (adapter.environment) {
    const result = await hook("environment", "the site's commands run with the usual environment", () => adapter.environment!(ctx));

    if (result.ok && result.value && typeof result.value === "object") {
      const entries = Object.entries(result.value).filter((entry): entry is [string, string] => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0]) && typeof entry[1] === "string");

      if (entries.length > 0) environment = Object.fromEntries(entries);
    }
  }

  const git = gitInfo(root);
  const production = detectProductionUrl(root, publicDir, pkg, conventions.urls?.production);
  const contentGlobs = [
    ...inspected.map((collection) => (collection.kind === "data" ? normalizePath(collection.path) : `${collection.path === "." ? "" : `${normalizePath(collection.path)}/`}**`)),
    `${media.dir}/**`,
    ...media.roots.filter((rootDir) => rootDir.dir !== media.dir).map((rootDir) => `${rootDir.dir}/**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico,mp4,webm,pdf}`),
  ];
  const instructions = ["STYLE.md", "STYLEGUIDE.md", "STYLE_GUIDE.md", "style-guide.md", "docs/style-guide.md", "brand/voice.md", "VOICE.md", "BRAND.md"].filter((file) => existsSync(absolute(root, file)));
  const urls: SiteModel["urls"] = {};

  if (production) urls.production = production;
  if (conventions.urls?.staging) urls.staging = conventions.urls.staging;
  flush();

  const result: SiteModel = {
    name: (pkg?.name && !/^(my-|astro-|example|starter|site$|website$)/.test(pkg.name) ? pkg.name.replace(/^@[^/]+\//, "") : basename(root)) || basename(root),
    framework: info,
    packageManager,
    installed: existsSync(absolute(root, "node_modules")),
    dev,
    build,
    collections: inspected,
    media,
    urls,
    publish: { branch: git.branch, mode: "commit", remote: git.remote, push: git.remote !== null },
    ai: { instructions, allowBuild: true },
    writable: { content: [...new Set(contentGlobs)], build: ["**/*"] },
    notes,
  };

  if (environment) result.environment = environment;
  if (siteKit.kit) result.kit = siteKit.kit;
  if (conventions.routesDir && isDir(root, conventions.routesDir)) result.routesDir = conventions.routesDir;
  return { model: result, adapter, match, drafts: declared, candidates, problems };
}

/**
 * Everything Galley can learn about a site by reading it. With no options,
 * only the built-in adapters are used and galley.config.json is not read —
 * loadSiteModel is where a site's own adapters and config come in.
 */
export async function detectSite(root: string, options?: DetectOptions): Promise<SiteModel> {
  return (await runDetection(root, options)).model;
}

/** The display name of an adapter id among the given adapters and the built-ins. */
export function adapterName(id: string, adapters: GalleyAdapter[] = []): string | null {
  return [...adapters, ...BUILTIN_ADAPTERS].find((adapter) => adapter.id === id)?.name ?? null;
}
