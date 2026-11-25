/**
 * SiteService: one open site, with content and workspace composed behind the
 * single surface the server and the assistant's tools use.
 *
 * The model and the content index are cached. Every change the workspace
 * reports — our own writes, the watcher's external edits, publish, discard,
 * undo, pull — goes through one serial pipeline that patches the index file by
 * file, recounts the collections it touched, re-detects only when a
 * model-shaping file changed, and then emits `changes.updated`. Reads that
 * depend on the index wait for that pipeline, so a search right after an edit
 * sees the edit.
 */
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT } from "../brand";
import {
  applyEdits,
  buildContentIndex,
  buildEntry,
  collectionForPath,
  detectSiteModel,
  findFrontMatter,
  formatForPath,
  hashContent,
  listEntries,
  loadSiteModel,
  normalizeSlug,
  parseDocument,
  pathForSlug,
  primeCache,
  readConfig,
  serializeEntry,
  updateConfigText,
  validateConfig,
} from "../content/index";
import { listCollectionFiles } from "../content/entries/files";
import type { ContentIndex, ValidationContext } from "../content/index";
import { GalleyError } from "../errors";
import type {
  CatchUpResult,
  ChangeOrigin,
  ChangeSet,
  Checkpoint,
  Collection,
  CreateEntryInput,
  EditOp,
  EditRefusal,
  EditResult,
  Entry,
  EntrySummary,
  EventBus,
  GalleyConfig,
  GitStatus,
  PreviewController,
  PreviewStatus,
  PublishResult,
  SiteDetail,
  SiteModel,
  SiteService,
  SiteSummary,
  ValidationIssue,
} from "../types";
import {
  CHANGED_SINCE_OPENED,
  createPreviewController,
  createWorkspace,
  forgetPreviewSaves,
  isBinary,
  isMediaFile,
  listMedia,
  normalizeRepoPath,
  redactRemoteUrl,
  runBuild,
  runGit,
  saveMedia,
  sanitizeMediaName,
  type PreviewControllerHandle,
  type Workspace,
} from "../workspace/index";
import type { PortPool } from "../workspace/preview/ports";
import type { PreviewGateway } from "../workspace/preview/proxy";
import type { AuthorLayers } from "../workspace/author";
import type { AroundBringIn } from "../workspace/publish";
import { formCodeRefusal, isScriptsFile, scriptCodeRefusal } from "../site-kit/guard";
import { brandLocation, DEFAULT_BRAND_DIR } from "../sitebrand/files";
import { astroMarkdownRefusal, contentWriteRefusal, heldBelowBuild, isAgentInstructionName, isMarkdownPath, renderedAsPageRefusal, showsBuildTool, type ContentWrite, type GuardContext } from "./content-code";
import { ASSISTANT_INSTRUCTION_FILES } from "../content/detect/detect";
import { isSiteSettingsPath, outsideAnyPerson, requireBuildMode, requireLevel, requireName, requireSiteSettings } from "../install/caller";
import { levelFor, SITE_METHOD_ACCESS, SITE_SETTINGS_RECORDS, siteMethodLevel, type GuardedSiteMethod } from "../install/route-access";
import { applyRecord, RECORD_SETTINGS, type SettingsRecord } from "./settings-records";
import { readOnly } from "./read-only";
import { createEnricher, describeChanges, sortChanges } from "./enrich";
import { shapesModel } from "./model-files";
import { resolvePublishConfig, type PublishFacts } from "./publish-config";
import { createKeyedLock, folderName, prettifyName } from "./util";
import { isStoreAddress, type SiteMediaRouter } from "../media-storage/router";
import { mayBeShown } from "../workspace/policy";

type Author = { name: string; email: string } | null;

export interface SiteDeps {
  id: string;
  events: EventBus;
  overlayScript: () => string | Promise<string>;
  /** Commit author; null falls back to git config. */
  author: () => Promise<Author> | Author;
  /**
   * The site's own author and the app's, as saved (never filled in from the
   * computer). When given, publishing chooses the author in the order
   * workspace/author.ts describes — the repository's own git settings
   * between the two — and `author` is not used.
   */
  authorLayers?: () => Promise<AuthorLayers> | AuthorLayers;
  /** Interface preview proxies bind (default 127.0.0.1). */
  host?: string;
  /** Hostname browsers use to reach them. */
  publicHost?: string;
  /** The operator's port range for the preview proxies, shared by every site of the process. */
  previewPorts?: PortPool;
  /** Mount the preview proxies on the server's one address instead of giving them ports (a hosted install). */
  previewGateway?: PreviewGateway;
  /** Scheme browsers reach the preview proxies with ("https" behind a TLS-terminating proxy). */
  publicProtocol?: "http" | "https";
  /** Watch the tree for edits made outside the app. Default true. */
  watch?: boolean;
  /**
   * Called after a publish (or an undo of one) recorded a new version — how
   * "put it live after publishing" hooks in. It runs after the result is
   * settled and anything it throws is swallowed: it can never fail the publish.
   */
  onPublished?: (result: PublishResult) => void;
  /** A request reached this site's preview proxy (the multi-site preview policy counts use with it). */
  onPreviewActivity?: () => void;
  /**
   * Where new media goes when the site keeps it outside the repository (a
   * bucket, Cloudflare Images): the media storage service. Absent: media
   * lives in the repository, as it always has.
   */
  media?: SiteMediaRouter;
  /**
   * This app's capture address for the site's forms, handed to the previewed
   * pages at run time (`<html data-galley-endpoint>`) so a form in the
   * preview reaches the inbox with no setting in the site's files.
   */
  captureAddress?: () => string | null;
  /**
   * A live address kept outside the site's files (a hosted install keeps the
   * one given in first run in its own state). The model uses it when the
   * site's own settings file names no live address (`urls.production`); the
   * file always wins. Read whenever the model is (re)loaded: call refresh()
   * after it changes.
   */
  liveUrl?: () => string | null;
  /**
   * False (a hosted install): the preview's package install never adds a
   * lockfile the site doesn't have, so it can't show up as an unpublished
   * change. Default true: on a computer of one's own it is installed as the
   * package manager does by itself.
   */
  addLockfile?: boolean;
}

/** What the registry reads without awaiting anything, so listing sites stays instant. */
export interface SiteSnapshot {
  name: string;
  framework: SiteModel["framework"];
  branch?: string;
  remoteUrl?: string;
  pendingChanges: number;
}

/** SiteService plus what the registry needs. */
export interface OpenSite extends SiteService {
  snapshot(): SiteSnapshot;
  /** The preview's controller when one was ever made — without making one (the preview policy reads and pauses it). */
  previewHandle(): PreviewControllerHandle | null;
  /** The live address the site's settings name, for the list. */
  liveUrl(): string | undefined;
}

/** External bursts (a terminal `git pull`) are gathered this long into one refresh. */
const EXTERNAL_COALESCE_MS = 120;
/** …but never held back longer than this while events keep arriving. */
const EXTERNAL_MAX_WAIT_MS = 1_000;
/** Files at the site's top that, when newer versions change them, mean its dependencies must be installed again before the preview runs. */
/** A file was rewritten between the read an edit was worked out from and its write: the edit is worked out again (see `editing`). */
class ChangedSinceRead extends Error {
  constructor(readonly conflict: GalleyError) {
    super(conflict.message);
  }
}

const DEPENDENCY_FILES = new Set(["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]);
/** Text files above this size are not indexed (matches the index's own source limit). */
const MAX_INDEX_BYTES = 6 * 1024 * 1024;

const NOT_CONTENT = "This file isn't part of any collection, so it can't be opened as content.";
const BUILD_OFF = "Build mode is turned off for this site, so only its content can be changed. The site's settings (ai.allowBuild) control it.";
const GONE = "This item no longer exists. It may have been moved or deleted.";

function siteName(root: string, detected: SiteModel, config: GalleyConfig | null): string {
  if (config?.name?.trim()) return config.name.trim();
  // Detection uses the package name when it looks deliberate, else the folder.
  return detected.name === folderName(root) ? detected.name : prettifyName(detected.name);
}

/** The name a folder would show as a site, read without opening or registering it. */
export async function siteNameAt(root: string): Promise<string> {
  const [model, config] = await Promise.all([loadSiteModel(root), readConfigQuietly(root)]);

  return siteName(root, model, config);
}

async function readConfigQuietly(root: string): Promise<GalleyConfig | null> {
  try {
    return await readConfig(root);
  } catch {
    // An unreadable config is reported by loadSiteModel's notes; here it simply sets nothing.
    return null;
  }
}

/**
 * A whole-file replacement must still be a file that parses: refuse it with
 * the parser's own plain words rather than write something the site can't read.
 */
function rawRefusal(value: string, format: Entry["format"]): string | null {
  const parsed = parseDocument(value, format);

  if (parsed.errors.length > 0) return `${parsed.errors[0]} Nothing was changed.`;
  if ((format === "markdown" || format === "mdx") && !findFrontMatter(value) && /^﻿?(---|\+\+\+)[ \t]*\r?\n/.test(value)) {
    return "The fields at the top of the page start but never end (the closing --- line is missing). Nothing was changed.";
  }
  return null;
}

export async function openSiteService(rootInput: string, deps: SiteDeps): Promise<OpenSite> {
  let author: Author = null;
  let layers: AuthorLayers | null = null;
  /** The one model of the site, read-only all the way down (read-only.ts): everyone who asks is handed this same object. */
  let model: SiteModel;
  let facts: PublishFacts;
  let hasConfig = false;
  // Where the brand's files are kept (siteBrand.dir, not part of the model): they go into the assistant's instructions,
  // so a write held below build level may not touch them (content-code.ts).
  let brandDir = DEFAULT_BRAND_DIR;
  // What else the guard knows (content-code.ts GuardContext): whether the folder shows a build tool's own files, and the
  // links named like a coding assistant's instructions (AGENTS.md → docs/guide.md), whose targets are instructions too.
  let buildTools = true;
  let agentLinks: string[] = [];
  let disposed = false;
  const openedAt = Date.now();

  const refreshAuthor = async () => {
    try {
      author = (await deps.author()) ?? null;
    } catch {
      author = null;
    }
    try {
      layers = deps.authorLayers ? await deps.authorLayers() : null;
    } catch {
      layers = null;
    }
  };

  const workspace: Workspace = await createWorkspace(rootInput, {
    writable: () => model.writable,
    author: () => author,
    ...(deps.authorLayers ? { authorLayers: () => layers } : {}),
    watch: deps.watch !== false,
  });
  const root = workspace.root;

  /** The files named like a coding assistant's instructions that are links: where they lead is an instruction file too. */
  async function agentInstructionLinks(): Promise<string[]> {
    try {
      const named = (await workspace.listFiles({ glob: "**/*.md" })).filter(isAgentInstructionName);

      return named.filter((path) => lstatSync(join(root, ...path.split("/")), { throwIfNoEntry: false })?.isSymbolicLink() === true);
    } catch {
      return [];
    }
  }

  /** Whether the site's folder shows a build tool's own files (content-code.ts showsBuildTool); unreadable counts as yes. */
  function readBuildTools(): boolean {
    try {
      const pkg = join(root, "package.json");

      return showsBuildTool((path) => existsSync(join(root, ...path.split("/"))), existsSync(pkg) ? readFileSync(pkg, "utf8") : null);
    } catch {
      return true;
    }
  }

  async function loadModel(): Promise<SiteModel> {
    const [detected, config, links] = await Promise.all([loadSiteModel(root), readConfigQuietly(root), agentInstructionLinks()]);

    brandDir = brandLocation(config).dir;
    agentLinks = links;
    buildTools = readBuildTools();
    facts = await resolvePublishConfig(root, config, detected.publish);
    hasConfig = existsSync(join(root, PRODUCT.configFile));
    const given = config?.urls?.production ? null : (deps.liveUrl?.() ?? null);
    // Every reader of the live address (Proof's side by side, the preview's baseline, the inbox's allowed origins) reads it from here.
    const urls = given ? { ...detected.urls, production: given } : detected.urls;

    // Read-only from the moment it is made: every way a model comes to be (opening, a reload) passes through here.
    return readOnly({ ...detected, urls, name: siteName(root, detected, config), publish: facts.config });
  }

  try {
    [model] = await Promise.all([loadModel(), refreshAuthor()]);
  } catch (error) {
    await workspace.dispose();
    throw error;
  }

  // ── the content index, built on first need and patched per file afterwards

  let index: ContentIndex | null = null;
  let indexBuild: Promise<ContentIndex> | null = null;
  /** Bumped whenever the model is re-detected; an index built for an older model is thrown away. */
  let modelVersion = 0;
  /** Files that changed while a build was reading the tree: re-read once it finishes. */
  const changedDuringBuild = new Set<string>();

  async function buildIndex(version: number): Promise<ContentIndex> {
    const built = await buildContentIndex(root, model);

    while (changedDuringBuild.size > 0) {
      const paths = [...changedDuringBuild];

      changedDuringBuild.clear();
      for (const path of paths) built.update(path, (await workspace.exists(path)) ? await readIfText(path) : null);
    }
    // No await between the last catch-up and publishing the index, so no change slips between them.
    if (version === modelVersion) index = built;
    return built;
  }

  async function ensureIndex(): Promise<ContentIndex> {
    for (;;) {
      if (index) return index;
      if (!indexBuild) {
        indexBuild = buildIndex(modelVersion).finally(() => {
          indexBuild = null;
        });
      }
      const built = await indexBuild;

      if (index === built) return built;
    }
  }

  const statusOf = (path: string) => workspace.statusOf(path);

  async function readIfText(path: string): Promise<string | null> {
    const info = await workspace.stat(path).catch(() => null);

    if (!info || info.size > MAX_INDEX_BYTES) return null;
    const bytes = await workspace.readBytes(path).catch(() => null);

    return bytes && !isBinary(bytes) ? Buffer.from(bytes).toString("utf8") : null;
  }

  // ── the change pipeline

  let queue: Promise<void> = Promise.resolve();
  let externalPaths = new Set<string>();
  let externalTimer: NodeJS.Timeout | null = null;
  let externalSince = 0;

  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch(() => undefined);
    return queue;
  };

  /** Resolves once every change reported so far has reached the caches. */
  const settled = () => queue;

  async function remodel(): Promise<void> {
    model = await loadModel();
    modelVersion += 1;
    index = null;
    changedDuringBuild.clear();
  }

  async function processChange(paths: string[], origin: ChangeOrigin): Promise<void> {
    if (disposed) return;
    const existing = new Map<string, boolean>();

    for (const path of paths) existing.set(path, await workspace.exists(path).catch(() => false));
    let siteChanged = false;

    try {
      if (paths.some((path) => shapesModel(model, path, existing.get(path) ?? false))) {
        await remodel();
        siteChanged = true;
      } else {
        const live = index;

        if (live) {
          for (const path of paths) {
            if (isMediaFile(path)) continue;
            live.update(path, existing.get(path) ? await readIfText(path) : null);
          }
        } else if (indexBuild) {
          for (const path of paths) if (!isMediaFile(path)) changedDuringBuild.add(path);
        }
        siteChanged = await recount(paths);
        // Publishing, pulling or a terminal checkout can move the branch or add a remote.
        if (origin === "external" || origin === "publish") siteChanged = (await refreshPublish()) || siteChanged;
      }
    } catch {
      // A transient failure (a file vanishing mid-read, a busy git lock): drop the
      // index so the next read rebuilds it rather than serving a half-applied update.
      index = null;
    }
    if (disposed) return;
    if (siteChanged) deps.events.emit({ type: "site.updated", siteId: deps.id });
    deps.events.emit({ type: "changes.updated", siteId: deps.id, paths, origin });
  }

  /** Recounts only the collections these paths belong to — one listing each, no parsing. */
  async function recount(paths: string[]): Promise<boolean> {
    const touched = new Set<Collection>();

    for (const path of paths) {
      const collection = collectionForPath(model, path);

      if (collection) touched.add(collection);
    }
    if (touched.size === 0) return false;
    let changed = false;
    const collections = await Promise.all(
      model.collections.map(async (collection) => {
        if (!touched.has(collection)) return collection;
        const count = (await listCollectionFiles(root, model, collection)).length;

        if (count === collection.count) return collection;
        changed = true;
        return { ...collection, count };
      })
    );

    if (changed) model = readOnly({ ...model, collections });
    return changed;
  }

  async function refreshPublish(): Promise<boolean> {
    const before = JSON.stringify([facts.config, facts.branch, facts.remoteUrl]);

    facts = await resolvePublishConfig(root, await readConfigQuietly(root), model.publish);
    model = readOnly({ ...model, publish: facts.config });
    return JSON.stringify([facts.config, facts.branch, facts.remoteUrl]) !== before;
  }

  function flushExternal() {
    if (externalTimer) clearTimeout(externalTimer);
    externalTimer = null;
    const paths = [...externalPaths].sort();

    externalPaths = new Set();
    if (paths.length > 0) void enqueue(() => processChange(paths, "external"));
  }

  const unsubscribe = workspace.onChange((paths, origin) => {
    if (origin !== "external") {
      void enqueue(() => processChange(paths, origin));
      return;
    }
    if (externalPaths.size === 0) externalSince = Date.now();
    for (const path of paths) externalPaths.add(path);
    if (externalTimer) clearTimeout(externalTimer);
    const wait = Math.max(0, Math.min(EXTERNAL_COALESCE_MS, externalSince + EXTERNAL_MAX_WAIT_MS - Date.now()));

    // As nobody: what follows an outside change (a pull, the hosted editor's own round under the engine's mark) must not carry whoever's work it came from to the event listeners.
    externalTimer = outsideAnyPerson(() => setTimeout(flushExternal, wait));
    externalTimer.unref?.();
  });

  // ── helpers shared by the content methods

  async function validationContext(): Promise<ValidationContext> {
    const live = await ensureIndex();

    return {
      mediaExists(siteUrl) {
        let path = siteUrl.split(/[?#]/)[0] ?? "";

        try {
          path = decodeURI(path);
        } catch {
          // Keep the raw path when it is not valid percent-encoding.
        }
        if (path.split("/").includes("..")) return false;
        // A file kept in the site's bucket: its full public address.
        if (isStoreAddress(model.media, siteUrl)) return true;
        for (const mediaRoot of model.media.roots) {
          const prefix = mediaRoot.publicPath.replace(/\/+$/, "");

          if (prefix !== "" && !path.startsWith(`${prefix}/`)) continue;
          const rest = path.slice(prefix.length).replace(/^\/+/, "");

          if (rest !== "" && existsSync(join(root, ...`${mediaRoot.dir}/${rest}`.split("/").filter(Boolean)))) return true;
        }
        return false;
      },
      routeExists: (urlPath) => live.routeExists(urlPath),
    };
  }

  function requireCollection(path: string): { path: string; collection: Collection } {
    const normalized = normalizeRepoPath(path);
    const collection = collectionForPath(model, normalized);

    if (!collection || formatForPath(normalized) === null) throw new GalleyError("not-found", NOT_CONTENT, normalized);
    return { path: normalized, collection };
  }

  async function entryFromText(path: string, raw: string): Promise<Entry> {
    const info = await workspace.stat(path);

    // The parse cache keys on mtime and size; recording what we just wrote
    // makes the next listing skip a re-parse and never serve the old text.
    if (info) {
      const collection = collectionForPath(model, path);

      if (collection) primeCache(root, path, raw, formatForPath(path) ?? collection.format, info.mtimeMs, info.size);
    }
    const context = await validationContext();
    const live = await ensureIndex();

    return buildEntry(model, path, raw, info ?? { mtimeMs: Date.now() }, statusOf(path), context, (id, slug) => live.titleOf(id, slug));
  }

  async function readEntryBytes(path: string): Promise<Uint8Array> {
    try {
      return await workspace.readBytes(path);
    } catch (error) {
      if (error instanceof GalleyError && error.code === "not-found") throw new GalleyError("not-found", GONE, path);
      throw error;
    }
  }

  async function readEntryText(path: string): Promise<string> {
    return Buffer.from(await readEntryBytes(path)).toString("utf8");
  }

  /**
   * A new entry's text from a template: the template file as it is written,
   * with the given values edited into it in place and the given body put in
   * — so it reads as if made by hand, in the template's own key order and
   * style. Only when an edit can't be made in place (a TOML template) is it
   * written out afresh.
   */
  async function fromTemplate(collection: Collection, path: string, input: CreateEntryInput): Promise<string> {
    const template = (model.templates ?? []).find((candidate) => candidate.id === input.template);

    if (!template) throw new GalleyError("invalid", "That template isn't one of this site's templates.", String(input.template));
    if (template.collection !== collection.id) {
      throw new GalleyError("invalid", `The template “${template.label}” is for a different kind of entry, not a ${collection.singular}.`, template.id);
    }
    const format = formatForPath(path) ?? collection.format;

    if ((formatForPath(template.file) ?? collection.format) !== format) {
      throw new GalleyError("invalid", `The template “${template.label}” is in a different file format from this collection's entries, so it can't be used.`, template.file);
    }
    let raw: string;

    // The settings name the file, and what it holds becomes the new entry: never a secrets file or one of the version history's own.
    if (!mayBeShown(template.file)) throw new GalleyError("forbidden", `The template “${template.label}” names a file that can't be used as a template.`, template.file);
    try {
      raw = await workspace.readText(template.file);
    } catch (error) {
      if (error instanceof GalleyError && error.code === "not-found") {
        throw new GalleyError("not-found", `The template “${template.label}” is missing its file (${template.file}).`, template.file);
      }
      throw error;
    }
    const parsed = parseDocument(raw, format);

    if (parsed.errors.length > 0) throw new GalleyError("invalid", `The template “${template.label}” can't be read: ${parsed.errors[0]}`, template.file);
    const ops: EditOp[] = Object.entries(input.data ?? {})
      .filter(([key, value]) => JSON.stringify(parsed.data[key]) !== JSON.stringify(value))
      .map(([key, value]) => ({ op: "set", path: [key], value }));

    if (input.body !== undefined && collection.body) ops.push({ op: "body", value: input.body });
    const edited = ops.length ? applyEdits(raw, format, ops) : { content: raw, refused: [] };

    if (edited.refused.length === 0 && parseDocument(edited.content, format).errors.length === 0) return edited.content;
    return serializeEntry(collection, { ...parsed.data, ...input.data }, input.body ?? parsed.body ?? undefined);
  }

  const pathLock = createKeyedLock();

  /**
   * One edit at a time per file, each worked out from the file as it is.
   *
   * Three locks sequence everything that changes a site, always taken in
   * this order and never the other way: the workspace's turn (the code host
   * and moves between versions), this per-file lock, then the workspace's
   * save lock. An edit takes the last two; a publish, an undone publish, Get
   * latest and a hosted editor's round take the first and the last; a
   * discard and an assistant's undo take the last alone. Nothing that holds
   * a later one ever asks for an earlier one, so none can wait on another in
   * a ring.
   *
   * The per-file lock keeps two edits to one file from working out their
   * text from the same read. It can't keep the file still: a discard, newer
   * versions coming in, an undone publish and an edit made outside the app
   * all rewrite files without it. So an edit doesn't rely on it for that.
   * Its write carries the hash of the text it was worked out from
   * (`writeAsRead`), and the workspace checks that hash under the save lock,
   * which every one of those takes. When the file is no longer that text,
   * the edit is worked out again from what is there now, a few times at
   * most, and is never written blind.
   */
  const EDIT_ATTEMPTS = 3;

  function editing<T>(path: string, task: () => Promise<T>): Promise<T> {
    return pathLock(path, async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await task();
        } catch (error) {
          if (!(error instanceof ChangedSinceRead)) throw error;
          if (attempt >= EDIT_ATTEMPTS) throw error.conflict;
        }
      }
    });
  }

  /**
   * Writes an entry's new text only over the text it was worked out from
   * (`read`). A caller that said what it had opened is told to reopen when
   * that isn't what was read: its edit is never worked out again for it,
   * and never written because the file happens to match again by the time
   * of the write.
   */
  /** The repo-relative path the bytes of a write to `path` reach, through any link; the name itself when the workspace refuses it (it says why at the write). */
  function realOf(path: string): string {
    try {
      return workspace.realPathOf(path);
    } catch {
      return path;
    }
  }

  /**
   * What the content guard knows beyond the model, for a held write: the brand
   * folder, where each instruction file's name really leads (a link named
   * STYLE.md or AGENTS.md makes its target an instruction file too), and
   * whether the folder shows a build tool.
   */
  function guardContext(): GuardContext {
    const names = [...ASSISTANT_INSTRUCTION_FILES, ...(model.ai?.instructions ?? []), brandDir, ...agentLinks];
    const instructionTargets = names.flatMap((name) => {
      try {
        const normal = normalizeRepoPath(name);
        const real = realOf(normal);

        return real !== normal ? [real] : [];
      } catch {
        return [];
      }
    });

    return { brandDir, instructionTargets, buildTools };
  }

  /** Whether `path` names a file that is in the site, through any link (a picture a page names from the site's root). */
  function inSite(path: string): boolean {
    try {
      return statSync(workspace.resolvePath(path)).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Every rule a write or a delete answers to when it is held below build-mode
   * level (content-code.ts; a form's code and the scripts file in
   * site-kit/guard.ts), judged on the name it was given and on the real path its
   * bytes reach — each with its own collection — so a link in the site can't
   * carry a write where the name wouldn't be allowed. `after` is null for a
   * delete, which may remove only what it could write; for a write no rule
   * reads whole (`readsText`) it is the start of the new text. The settings
   * file is left to the workspace's settings-level check for a person (its own
   * refusal says more); a save from the page, or the assistant in a content
   * conversation, is refused here.
   */
  function heldWriteRefusal(input: { path: string; collection: Collection | null; before: string | null; after: string | null; write: ContentWrite }): string | null {
    const named = input.path;
    const real = realOf(named);
    const held = heldBelowBuild(input.write);

    if ((isSiteSettingsPath(named) || isSiteSettingsPath(real)) && held !== "page" && held !== "assistant") return null;
    const context = held ? guardContext() : undefined;
    const paths = [...new Set([named, real])];

    for (const path of paths) {
      const refusal = contentWriteRefusal(path, model, input.write, context);

      if (refusal) return refusal;
    }
    if (input.after === null) return null;
    for (const path of paths) {
      const refusal = renderedAsPageRefusal(path, input.after.slice(0, 512), model, input.write);

      if (refusal) return refusal;
    }
    const realCollection = real === named ? input.collection : collectionForPath(model, real);
    const who = { origin: input.write.origin ?? "user", ...(input.write.mode ? { mode: input.write.mode } : {}), allowBuild: model.ai.allowBuild };

    if (input.collection?.kit === "forms" || realCollection?.kit === "forms") return formCodeRefusal(input.before, input.after, who);
    if (isScriptsFile(named, input.collection) || isScriptsFile(real, realCollection)) return scriptCodeRefusal(input.before, input.after, who);
    if (model.framework.id !== "astro") return null;
    const pages: Array<[string, Collection | null]> = real === named ? [[named, input.collection]] : [[named, input.collection], [real, realCollection]];

    for (const [path, collection] of pages) {
      if (!isMarkdownPath(path)) continue;
      const refusal = astroMarkdownRefusal(path, input.before, input.after, collection, input.write, model, inSite);

      if (refusal) return refusal;
    }
    return null;
  }

  /** Whether a write of `path` answers to a rule that reads its whole text: a form, the scripts file, an Astro Markdown page — by its name or its real path. */
  function readsText(path: string, collection: Collection | null): boolean {
    const real = realOf(path);
    const realCollection = real === path ? collection : collectionForPath(model, real);

    return (
      collection?.kit === "forms" ||
      realCollection?.kit === "forms" ||
      isScriptsFile(path, collection) ||
      isScriptsFile(real, realCollection) ||
      (model.framework.id === "astro" && (isMarkdownPath(path) || isMarkdownPath(real)))
    );
  }

  async function writeAsRead(path: string, content: string, read: Uint8Array, options: { origin?: ChangeOrigin; baseHash?: string }): Promise<void> {
    const readHash = hashContent(read);

    if (options.baseHash && options.baseHash !== readHash) throw new GalleyError("conflict", CHANGED_SINCE_OPENED, path);
    try {
      await workspace.writeFile(path, content, { origin: options.origin ?? "user", mode: "content", baseHash: readHash });
    } catch (error) {
      if (error instanceof GalleyError && error.code === "conflict") throw new ChangedSinceRead(error);
      throw error;
    }
  }

  const SETTINGS_CHANGED = "The site's settings changed since they were opened, so nothing was saved. Open them again, then make the change again.";

  /** The settings file as it is, or null when the site has none yet. */
  async function readSettingsFile(): Promise<Uint8Array | null> {
    return (await workspace.exists(PRODUCT.configFile)) ? workspace.readBytes(PRODUCT.configFile) : null;
  }

  /**
   * Writes the settings file only over the text its new text was worked out
   * from (`previous`; null: there was none, and none may have appeared). The
   * file belongs to the site owner and sits outside every content glob, so
   * it goes through the workspace's system write: containment and atomic
   * replace, without the mode's glob check. Inside `editing`.
   */
  async function writeSettingsFile(previous: Uint8Array | null, text: string, origin: ChangeOrigin): Promise<void> {
    try {
      await workspace.writeFile(PRODUCT.configFile, text, { origin, mode: "content", system: true, ...(previous ? { baseHash: hashContent(previous) } : { createOnly: true }) });
    } catch (error) {
      if (error instanceof GalleyError && error.code === "conflict") throw new ChangedSinceRead(error);
      throw error;
    }
  }

  let preview: PreviewControllerHandle | null = null;

  function afterPublish(result: PublishResult): PublishResult {
    if (result.ok && result.commit && deps.onPublished) {
      try {
        deps.onPublished(result);
      } catch {
        // Whatever happens after a publish is reported on its own; the publish already happened.
      }
    }
    return result;
  }

  /** Newer versions changed the site's dependencies: the next start installs them, as a first start does. Cleared once an install got through. */
  let reinstall = false;
  let installing = false;
  /** The version the preview last started on (undefined: it hasn't started since the site was opened). */
  let startedOn: string | null | undefined;

  const headNow = async (): Promise<string | null> => {
    const result = await runGit(root, ["rev-parse", "-q", "--verify", "HEAD"], { allowFailure: true, readOnly: true }).catch(() => null);

    return result?.code === 0 ? result.text.trim() || null : null;
  };

  const forgetSaves = () => forgetPreviewSaves(root, model.previewSaves ?? []).catch(() => []);

  /**
   * Every start, the app's own "Restart preview" included: when the copy is
   * on another version than the preview last started on (versions came in by
   * any route), what the dev server saved under the old one is forgotten
   * first. On a large site that costs the framework's first-start work again
   * (Astro re-checks every entry), only when the version moved.
   */
  async function beforePreviewStart(): Promise<void> {
    const head = await headNow();

    if (startedOn !== undefined && head !== startedOn) await forgetSaves();
    startedOn = head;
  }

  /**
   * A preview that is installing is left alone by newer versions. Stopping
   * it waits for the whole install, and a bring-in would do that waiting
   * with the save lock held, so every save would wait minutes with it; and
   * what was installed would be the older versions' packages. The versions
   * wait for the install instead: a round is skipped, Get latest says so.
   */
  const previewInstalling = () => preview?.status().state === "installing";
  const INSTALLING = "The preview is still installing the site's dependencies. Get the latest versions once it has finished.";

  /** Set while newer versions are changing the files: a start asked for meanwhile waits for it (the preview's holdStart). */
  let bringingIn: { done: Promise<void>; finish: () => void } | null = null;

  /**
   * Around bringing newer versions in — Get latest and a hosted editor's own
   * round alike. The order is the fix, not a detail: a running dev server
   * that sees a page and its collection's schema change together re-checks
   * the page with the schema it still has loaded and saves the result under
   * the new file's digest, and every later start trusts that saved copy, so a
   * plain restart keeps showing the old entry (found with Astro's content
   * store). So the preview stops before any file changes, what it saved is
   * forgotten once something changed, and only then does it start again; if
   * bringing in fails or changes nothing, it starts again as it was. A start
   * a person asks for in between waits until the files are still, and a
   * preview that is installing is left to finish: the versions wait.
   */
  function aroundBringIn(): AroundBringIn {
    let wasRunning = false;

    return {
      async before() {
        const state = preview?.status().state;

        // Checked here too, under the save lock, for an install that began after pull and catchUp looked.
        if (state === "installing") throw new GalleyError("busy", INSTALLING);
        let finish = () => undefined as void;
        const done = new Promise<void>((resolve) => (finish = resolve));

        // From here until `after`, no start reads the settings, installs or runs anything.
        bringingIn = { done, finish };
        wasRunning = state === "ready" || state === "starting";
        // As nobody, like the start below: the preview's status events must not carry the caller's access (or the engine's).
        if (wasRunning && preview) await outsideAnyPerson(() => preview!.stop());
      },
      async after(paths) {
        try {
          if (paths.length > 0) {
            await forgetSaves();
            if (paths.some((path) => DEPENDENCY_FILES.has(path))) reinstall = true;
          }
        } finally {
          bringingIn?.finish();
          bringingIn = null;
        }
        // Started as nobody, and not waited for: the dev server can take a while, and its status reaches the app as events.
        // A start that was waiting for the files is this same start.
        if (wasRunning && preview) void outsideAnyPerson(() => preview!.start()).catch(() => undefined);
      },
    };
  }

  /** The last look's outcome as the app shows it: a different one is announced, the same one isn't. */
  let lastLook = "";

  /** Tells open browsers a look found something new, or `brought` versions came in — as nobody, so no listener carries this request's access (or the engine's). */
  function announce(status: GitStatus, brought: number): void {
    const mark = JSON.stringify([status.ahead, status.behind, status.inTheWay?.message ?? null, status.checkProblem ?? null, status.lastCommit?.commit ?? null]);

    if (brought === 0 && mark === lastLook) return;
    lastLook = mark;
    if (!disposed) outsideAnyPerson(() => deps.events.emit({ type: "repository.checked", siteId: deps.id, brought }));
  }

  /** Files a bring-in reported go through the pipeline now, as nobody, instead of after the coalescing window. */
  async function settleBroughtIn(): Promise<void> {
    outsideAnyPerson(() => flushExternal());
    await settled();
  }

  const service: OpenSite = {
    id: deps.id,
    root,

    previewHandle() {
      return preview;
    },

    liveUrl() {
      return model.deploy?.productionUrl ?? model.urls.production;
    },

    snapshot() {
      return {
        name: model.name,
        framework: model.framework,
        ...(facts.branch ? { branch: facts.branch } : {}),
        ...(facts.remoteUrl ? { remoteUrl: redactRemoteUrl(facts.remoteUrl) } : {}),
        pendingChanges: workspace.pendingPaths().length,
      };
    },

    async summary(): Promise<SiteSummary> {
      await settled();
      const snap = service.snapshot();

      return {
        id: deps.id,
        name: snap.name,
        root,
        framework: snap.framework,
        ...(snap.branch ? { branch: snap.branch } : {}),
        ...(snap.remoteUrl ? { remoteUrl: snap.remoteUrl } : {}),
        lastOpenedAt: openedAt,
        pendingChanges: snap.pendingChanges,
      };
    },

    async detail(): Promise<SiteDetail> {
      const [summary, git] = await Promise.all([service.summary(), workspace.gitStatus()]);

      return {
        ...summary,
        // gitStatus refreshed the status cache; count from it.
        pendingChanges: workspace.pendingPaths().length,
        model,
        git,
        hasConfig,
        preview: preview?.status() ?? { state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] },
      };
    },

    async model() {
      await settled();
      return model;
    },

    async refresh() {
      await enqueue(async () => {
        await remodel();
        deps.events.emit({ type: "site.updated", siteId: deps.id });
      });
      return model;
    },

    async detected() {
      const detected = await detectSiteModel(root);
      const publish = await resolvePublishConfig(root, null, detected.publish);

      return { ...detected, name: siteName(root, detected, null), publish: publish.config };
    },

    readConfig() {
      return readConfig(root);
    },

    async saveConfig(config, options = {}) {
      // An assistant or AI tool changing the site's settings is a build-mode change.
      if (options.mode === "content") {
        throw new GalleyError("forbidden", "Changing the site's settings needs build mode. Content mode can change pages, posts, data files and images only.");
      }
      if (options.mode === "build") requireBuildMode();
      if (options.mode === "build" && !model.ai.allowBuild) throw new GalleyError("forbidden", BUILD_OFF);
      // Whatever it changes: the engine's own bookkeeping goes through RECORD_SETTINGS, never through here.
      requireSiteSettings();
      const result = validateConfig(config);

      if (!result.ok) {
        throw new GalleyError(
          "invalid",
          `The site settings have ${result.errors.length === 1 ? "a problem" : `${result.errors.length} problems`}: ${result.errors.join(" ")}`,
          result.errors.join("\n")
        );
      }
      await editing(PRODUCT.configFile, async () => {
        const previous = await readSettingsFile();

        // Said which version the new settings were made from, and that is no longer the file: nothing is saved.
        if (options.baseHash && (previous ? hashContent(previous) : null) !== options.baseHash) throw new GalleyError("conflict", SETTINGS_CHANGED, PRODUCT.configFile);
        await writeSettingsFile(previous, updateConfigText(previous ? Buffer.from(previous).toString("utf8") : null, result.config), options.mode ? "agent" : "user");
      });
      // The pipeline re-detects (the config shapes the model) and emits site.updated.
      await settled();
      return model;
    },

    // ── content

    async listEntries(collectionId, query) {
      await settled();
      // Author references are resolved by listEntries itself, from the parse cache: listing never waits for the full index.
      return listEntries(root, model, collectionId, query, statusOf);
    },

    async readEntry(path) {
      const target = requireCollection(path);

      return entryFromText(target.path, await readEntryText(target.path));
    },

    async updateEntry(path, ops, options = {}) {
      if (options.mode === "build") requireBuildMode();
      const target = requireCollection(path);

      if (!Array.isArray(ops)) throw new GalleyError("invalid", "The edit didn't say what to change.");
      return editing(target.path, async () => {
        const read = await readEntryBytes(target.path);
        const raw = Buffer.from(read).toString("utf8");
        const format = formatForPath(target.path) ?? target.collection.format;
        const refused: EditRefusal[] = [];
        const kept: Array<{ index: number; op: EditOp }> = [];

        ops.forEach((op, index) => {
          const reason = op?.op === "raw" && typeof op.value === "string" ? rawRefusal(op.value, format) : null;

          if (reason) refused.push({ index, op, reason });
          else kept.push({ index, op });
        });
        const result = applyEdits(raw, format, kept.map((item) => item.op));

        for (const refusal of result.refused) refused.push({ ...refusal, index: kept[refusal.index]!.index });
        refused.sort((a, b) => a.index - b.index);
        if (result.applied === 0 || result.content === raw) {
          return { entry: await entryFromText(target.path, raw), applied: 0, refused };
        }
        // Every rule a write answers to when it is held below build level, on the name and the real path (heldWriteRefusal).
        const reason = heldWriteRefusal({ path: target.path, collection: target.collection, before: raw, after: result.content, write: { origin: options.origin ?? "user", ...(options.mode ? { mode: options.mode } : {}) } });

        if (reason) {
          return { entry: await entryFromText(target.path, raw), applied: 0, refused: [...refused, ...kept.filter((item) => !refused.some((r) => r.index === item.index)).map((item) => ({ ...item, reason }))].sort((a, b) => a.index - b.index) };
        }
        // A structural edit that leaves a readable file unreadable is a bug
        // somewhere below us; never let it reach the disk.
        if (parseDocument(raw, format).errors.length === 0 && parseDocument(result.content, format).errors.length > 0) {
          const reason = "This change would have left the page unreadable, so nothing was changed.";

          return {
            entry: await entryFromText(target.path, raw),
            applied: 0,
            refused: [...refused, ...kept.filter((item) => !refused.some((r) => r.index === item.index)).map((item) => ({ ...item, reason }))].sort(
              (a, b) => a.index - b.index
            ),
          };
        }
        await writeAsRead(target.path, result.content, read, options);
        const edit: EditResult = { entry: await entryFromText(target.path, result.content), applied: result.applied, refused };

        return edit;
      });
    },

    async createEntry(input, options = {}) {
      if (options.mode === "build") requireBuildMode();
      const collection = model.collections.find((candidate) => candidate.id === input?.collection);

      if (!collection) throw new GalleyError("not-found", "That collection doesn't exist on this site.", String(input?.collection));
      if (collection.kind === "data" || !collection.create) {
        throw new GalleyError("forbidden", `New items can't be added to ${collection.label} from here.`, collection.id);
      }
      const slug = normalizeSlug(String(input.slug ?? ""));
      const path = pathForSlug(collection, slug);

      // A slug the collection's pattern doesn't cover (a nested slug in a flat
      // folder) would write a file the site never shows.
      if (collectionForPath(model, path)?.id !== collection.id) {
        throw new GalleyError("invalid", `That address can't be used for a ${collection.singular}. Use plain words without slashes.`, path);
      }
      const text = input.template !== undefined ? await fromTemplate(collection, path, input) : serializeEntry(collection, input.data ?? {}, input.body);
      const codeRefusal = heldWriteRefusal({ path, collection, before: null, after: text, write: { origin: options.origin ?? "user", ...(options.mode ? { mode: options.mode } : {}) } });

      if (codeRefusal) throw new GalleyError("forbidden", codeRefusal, path);
      const taken = new GalleyError("conflict", `A ${collection.singular} with that address already exists. Choose a different name.`, path);

      return pathLock(path, async () => {
        if (await workspace.exists(path)) throw taken;
        try {
          await workspace.writeFile(path, text, { origin: options.origin ?? "user", mode: "content", createOnly: true });
        } catch (error) {
          if (error instanceof GalleyError && error.code === "conflict") throw taken;
          throw error;
        }
        return entryFromText(path, text);
      });
    },

    async deleteEntry(path, options = {}) {
      const target = requireCollection(path);

      if (target.collection.kind === "data") {
        throw new GalleyError("forbidden", `${target.collection.label} can be edited but not deleted.`, target.path);
      }
      // A delete held below build level may remove only what it could write.
      const held = heldWriteRefusal({ path: target.path, collection: target.collection, before: null, after: null, write: { origin: options.origin ?? "user", ...(options.mode ? { mode: options.mode } : {}) } });

      if (held) throw new GalleyError("forbidden", held, target.path);
      await pathLock(target.path, async () => {
        if (!(await workspace.exists(target.path))) throw new GalleyError("not-found", GONE, target.path);
        await workspace.deleteFile(target.path, { origin: options.origin ?? "user", mode: "content", ...(options.baseHash ? { baseHash: options.baseHash } : {}) });
      });
    },

    async search(query, options) {
      await settled();
      return (await ensureIndex()).search(String(query ?? ""), options);
    },

    async resolveText(request, options = {}) {
      await settled();
      return (await ensureIndex()).resolve(request, { mode: options.mode ?? "content" });
    },

    async entryForUrl(urlPath): Promise<EntrySummary | null> {
      await settled();
      const hit = (await ensureIndex()).entryForUrl(urlPath);

      if (!hit) return null;
      const info = await workspace.stat(hit.path);

      // The index records summaries as "clean"; the status and mtime are live facts.
      return { ...hit, status: statusOf(hit.path), ...(info ? { modifiedAt: info.mtimeMs } : {}) };
    },

    async validate(paths) {
      await settled();
      const targets = (paths ?? workspace.pendingPaths()).map((path) => normalizeRepoPath(path));
      const issues: ValidationIssue[] = [];

      for (const path of [...new Set(targets)]) {
        if (!collectionForPath(model, path) || formatForPath(path) === null) continue;
        let raw: string;

        try {
          raw = await workspace.readText(path);
        } catch {
          continue; // Deleted entries have nothing left to check.
        }
        issues.push(...(await entryFromText(path, raw)).issues);
      }
      return issues;
    },

    // ── files

    listFiles(options) {
      return workspace.listFiles(options);
    },

    async readFile(path) {
      const normalized = normalizeRepoPath(path);
      const bytes = await workspace.readBytes(normalized);

      if (isBinary(bytes)) {
        throw new GalleyError("invalid", "This file isn't text (it may be an image or another kind of file), so it can't be opened here.", normalized);
      }
      return { path: normalized, content: Buffer.from(bytes).toString("utf8"), hash: hashContent(bytes), binary: false };
    },

    async writeFile(path, content, options) {
      const normalized = normalizeRepoPath(path);

      // Asked for, not assumed: a request for build mode is refused, never quietly made a content-mode one.
      if (options.mode === "build") requireBuildMode();
      if (options.mode === "build" && !model.ai.allowBuild) throw new GalleyError("forbidden", BUILD_OFF, normalized);
      // Held below build level (the account, a save from the page, the assistant in a content conversation), a write
      // answers to the allowlist and the rules that read its text, on its name and on the real path its bytes reach
      // (heldWriteRefusal) — unlike a glob, that covers a path outside every collection too. Otherwise the ordinary
      // content-mode surface below decides.
      const collection = collectionForPath(model, normalized);
      const textRules = readsText(normalized, collection);
      // A rule that reads the text gets it whole; otherwise the start is enough (does it begin like a page's settings?).
      const after = typeof content === "string" ? (textRules ? content : content.slice(0, 512)) : Buffer.from(textRules ? content : content.subarray(0, 512)).toString("utf8");
      const before = textRules && (await workspace.exists(normalized)) ? await workspace.readText(normalized).catch(() => null) : null;
      const refusal = heldWriteRefusal({ path: normalized, collection, before, after, write: { origin: options.origin, mode: options.mode } });

      if (refusal) throw new GalleyError("forbidden", refusal, normalized);
      // Only the public options pass through: engine-internal flags (system,
      // createOnly) must not be reachable from a request body.
      await pathLock(normalized, () =>
        workspace.writeFile(normalized, content, {
          origin: options.origin,
          mode: options.mode,
          ...(options.baseHash ? { baseHash: options.baseHash } : {}),
        })
      );
    },

    async deleteFile(path, options) {
      const normalized = normalizeRepoPath(path);

      if (options.mode === "build") requireBuildMode();
      if (options.mode === "build" && !model.ai.allowBuild) throw new GalleyError("forbidden", BUILD_OFF, normalized);
      // A delete held below build level may remove only what it could write, judged on the name and the real path.
      const held = heldWriteRefusal({ path: normalized, collection: collectionForPath(model, normalized), before: null, after: null, write: { origin: options.origin, mode: options.mode } });

      if (held) throw new GalleyError("forbidden", held, normalized);
      await pathLock(normalized, () =>
        workspace.deleteFile(normalized, {
          origin: options.origin,
          mode: options.mode,
          ...(options.baseHash ? { baseHash: options.baseHash } : {}),
        })
      );
    },

    // ── media

    async listMedia() {
      const repository = await listMedia(workspace, model.media);

      return deps.media ? deps.media.list(service, repository) : repository;
    },

    saveMedia(input, options) {
      const toRepository = () => {
        // An upload kept in the repository lands where a held write could put it (a media root that isn't the repository's
        // root, or beside an Astro collection's entries), judged on its name and its real place, like any other write.
        const directory = normalizeRepoPath(input.directory ?? model.media.dir);
        const { base, ext } = sanitizeMediaName(input.filename);
        const path = directory ? `${directory}/${base}.${ext}` : `${base}.${ext}`;
        const head = Buffer.from(input.data.subarray(0, 512)).toString("utf8");
        const refusal = heldWriteRefusal({ path, collection: null, before: null, after: head, write: { origin: options?.origin ?? "user" } });

        return refusal ? Promise.reject(new GalleyError("forbidden", refusal, path)) : saveMedia(workspace, model.media, input, options);
      };

      return deps.media ? deps.media.save(service, input, toRepository) : toRepository();
    },

    grepText(pattern, options) {
      return workspace.grepText(pattern, options);
    },

    resolvePath(path) {
      return workspace.resolvePath(path);
    },

    // ── proof & publish

    async changes(): Promise<ChangeSet> {
      const changes = sortChanges(await workspace.changes(createEnricher(() => model)));
      // Uploads to a media store since the last publish: never in a commit, but part of what is pending.
      let problem: string | null = null;
      const storeUploads = deps.media
        ? await deps.media.pending(service).catch((error: unknown) => {
            // Said plainly in Proof rather than shown as nothing.
            problem = `The uploads in the site's media storage couldn't be looked up just now: ${error instanceof Error ? error.message : String(error)}`;
            return [];
          })
        : [];

      return { ...changes, ...(storeUploads.length ? { storeUploads } : {}), ...(problem ? { storeUploadsProblem: problem } : {}) };
    },

    pendingPaths() {
      return workspace.pendingPaths();
    },

    diff(path) {
      return workspace.diff(path);
    },

    readBase(path) {
      return workspace.readBase(path);
    },

    async discard(paths) {
      await workspace.discard(paths);
      await settled();
      return service.changes();
    },

    async publish(request = {}) {
      await refreshAuthor();
      // Resolved now, not at open: the branch may have been switched since.
      await enqueue(async () => {
        await refreshPublish();
      });
      const describe = async (files: string[]) => {
        const wanted = new Set(files);
        const set = await service.changes();

        return describeChanges(set.files.filter((file) => wanted.has(file.path)));
      };

      return afterPublish(await workspace.publish(request, model.publish, describe));
    },

    history(limit) {
      return workspace.history(limit);
    },

    async send() {
      await enqueue(async () => {
        await refreshPublish();
      });
      return workspace.send(model.publish);
    },

    async revert(commit) {
      await refreshAuthor();
      await enqueue(async () => {
        await refreshPublish();
      });
      return afterPublish(await workspace.revert(commit, model.publish));
    },

    async gitStatus() {
      // Read afresh, as publish does: the name may have been set since the site was opened (a hosted install's first run sets it after).
      await refreshAuthor();
      return workspace.gitStatus();
    },

    async checkGit() {
      await refreshAuthor();
      const status = await workspace.check();

      announce(status, 0);
      return status;
    },

    async pull() {
      if (previewInstalling()) throw new GalleyError("busy", INSTALLING);
      const result = await workspace.getLatest(aroundBringIn());

      // A pull reports its files as external; don't make the caller wait out the coalescing window.
      await settleBroughtIn();
      announce(result.status, 0);
      return result.status;
    },

    async catchUp(): Promise<CatchUpResult | null> {
      // Busy, like a save in progress: the next round tries again. An install can take minutes, though, and
      // looking changes no file: the round still looks, so what the app says is waiting stays true meanwhile.
      if (previewInstalling()) {
        announce(await workspace.check(), 0);
        return null;
      }
      const result = await workspace.catchUp(aroundBringIn()).catch((error: unknown) => {
        if (error instanceof GalleyError && error.code === "busy" && error.message === INSTALLING) return null;
        throw error;
      });

      if (!result) return null;
      if (result.brought > 0) await settleBroughtIn();
      announce(result.status, result.brought);
      return result;
    },

    checkpoint(label): Checkpoint {
      return workspace.checkpoint(label);
    },

    // ── preview & build

    preview(): PreviewController {
      // Made once and shared by everyone who opens the site: made as nobody, so its timers and processes carry no one's access.
      preview ??= outsideAnyPerson(() => createPreviewController({
        root,
        // Read at start time so a changed dev command or port applies on restart.
        settings: () => ({
          dev: model.dev,
          packageManager: model.packageManager,
          installed: existsSync(join(root, "node_modules")) && !reinstall,
          urls: model.urls,
          ...(model.environment ? { environment: model.environment } : {}),
        }),
        overlayScript: deps.overlayScript,
        // Every previewed page is marked as the preview (the site kit keeps its third-party scripts inert)
        // and told where its forms reach this app's inbox.
        pageAttributes: () => {
          const address = deps.captureAddress?.() ?? null;

          return { "data-galley-preview": "", ...(address ? { "data-galley-endpoint": address } : {}) };
        },
        ...(deps.host ? { host: deps.host } : {}),
        ...(deps.publicHost ? { publicHost: deps.publicHost } : {}),
        ...(deps.previewPorts ? { ports: deps.previewPorts } : {}),
        ...(deps.previewGateway ? { gateway: deps.previewGateway } : {}),
        ...(deps.publicProtocol ? { publicProtocol: deps.publicProtocol } : {}),
        ...(deps.onPreviewActivity ? { onActivity: deps.onPreviewActivity } : {}),
        ...(deps.addLockfile === false ? { addLockfile: false } : {}),
        beforeStart: beforePreviewStart,
        holdStart: () => bringingIn?.done ?? null,
        onStatus: (status: PreviewStatus) => {
          // An install that got as far as starting the dev server has done what newer dependencies needed.
          // One that ended any other way (the preview was stopped meanwhile, or it failed) isn't known to have got through,
          // and a packages folder it left half-filled would pass for installed: the next start installs again.
          if (status.state === "installing") installing = true;
          else if (installing && status.state === "starting") reinstall = installing = false;
          else if (status.state !== "starting") {
            if (installing) reinstall = true;
            installing = false;
          }
          if (!disposed) deps.events.emit({ type: "preview.status", siteId: deps.id, status });
        },
      }));
      return preview;
    },

    async build(options = {}) {
      if (options.mode === "build") requireBuildMode();
      if (options.mode === "build" && !model.ai.allowBuild) throw new GalleyError("forbidden", BUILD_OFF);
      if (!model.build) {
        throw new GalleyError("unconfigured", "This site has no build command yet. Add one in the site settings (for example “npm run build”).");
      }
      return runBuild(root, model.build.command, model.environment ? { env: model.environment } : {});
    },

    async dispose() {
      if (disposed) return;
      // The preview goes first so its final "stopped" status still reaches the UI.
      await preview?.dispose();
      disposed = true;
      unsubscribe();
      if (externalTimer) clearTimeout(externalTimer);
      externalTimer = null;
      await workspace.dispose();
      await queue;
    },
  };

  /**
   * The engine's own bookkeeping (settings-records.ts): one record's keys,
   * applied to the file as it is now, at the level of the route whose action
   * records it. The rest of the file is never touched.
   */
  async function record(entry: SettingsRecord): Promise<SiteModel> {
    const kind = entry?.kind as keyof typeof SITE_SETTINGS_RECORDS;
    const route = Object.hasOwn(SITE_SETTINGS_RECORDS, kind) ? SITE_SETTINGS_RECORDS[kind] : null;

    if (!route) throw new GalleyError("invalid", "That isn't something the engine records in the site's settings.");
    requireLevel(levelFor(route) ?? "edit");
    // The record's keys, applied to the file as it is; when the file changed between reading it and writing it, applied again.
    await editing(PRODUCT.configFile, async () => {
      const previous = await readSettingsFile();
      const current = previous === null ? {} : ((await readConfig(root)) ?? {});
      const result = validateConfig(applyRecord(current, entry, model));

      if (!result.ok) throw new GalleyError("invalid", `The site settings have ${result.errors.length === 1 ? "a problem" : `${result.errors.length} problems`}: ${result.errors.join(" ")}`, result.errors.join("\n"));
      await writeSettingsFile(previous, updateConfigText(previous ? Buffer.from(previous).toString("utf8") : null, result.config), "user");
    });
    await settled();
    return model;
  }

  // Configurable and writable: the wrappers sites are handed out in (plugin hooks, a plugin's scoped site) are proxies, which may only bind it then.
  Object.defineProperty(service, RECORD_SETTINGS, { value: record, enumerable: false, configurable: true, writable: true });

  // Publishing and the rest of SITE_METHOD_ACCESS: checked here, once, for every caller of the site.
  for (const method of Object.keys(SITE_METHOD_ACCESS) as GuardedSiteMethod[]) {
    const unguarded = service[method] as (...args: unknown[]) => Promise<unknown>;

    (service as unknown as Record<GuardedSiteMethod, (...args: unknown[]) => Promise<unknown>>)[method] = async (...args: unknown[]) => {
      requireLevel(siteMethodLevel(method));
      // These record or move versions, and a version is read by the name of whoever published it.
      requireName();
      return unguarded.apply(service, args);
    };
  }
  return service;
}

export async function createSiteService(root: string, deps: SiteDeps): Promise<SiteService> {
  return openSiteService(root, deps);
}
