/**
 * Reading galley.config.json and laying it over detection. Collections and
 * fields merge by id/key, so a config can fix one label without restating
 * anything else. Precedence: config > schema > inferred.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { PRODUCT } from "../../brand";
import { GalleyError } from "../../errors";
import type { BlockType, Collection, CollectionConfig, Field, FieldConfig, GalleyConfig, SiteModel } from "../../types";
import { siteExtensions } from "../../plugins/site";
import { adapterName, runDetection } from "../detect/detect";
import { inspectCollection } from "../detect/inspect";
import { formatForPath } from "../document/parse";
import { absolute, listCollectionFiles } from "../entries/files";
import { collectionForPath, normalizePath } from "../entries/paths";
import { collectionNames, labelForKey } from "../util/text";
import { redirectPaths } from "../../redirects/locate";
import { CONFIG_SCHEMA_URL, validateConfig } from "./schema";

export async function readConfig(root: string): Promise<GalleyConfig | null> {
  let text: string;

  try {
    text = await readFile(absolute(root, PRODUCT.configFile), "utf8");
  } catch {
    return null;
  }
  let value: unknown;

  try {
    value = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    throw new GalleyError("invalid", `${PRODUCT.configFile} is not valid JSON. Check for a missing comma or quote.`, error instanceof Error ? error.message : String(error));
  }
  const result = validateConfig(value);

  if (!result.ok) {
    throw new GalleyError("invalid", `${PRODUCT.configFile} has ${result.errors.length === 1 ? "a problem" : `${result.errors.length} problems`}: ${result.errors.join(" ")}`, result.errors.join("\n"));
  }
  return result.config;
}

/** Pretty JSON, `$schema` first, ending in a newline. */
export function serializeConfig(config: GalleyConfig): string {
  const { $schema, ...rest } = config;

  return `${JSON.stringify({ $schema: $schema ?? CONFIG_SCHEMA_URL, ...rest }, null, 2)}\n`;
}

function applyBlockConfig(blocks: BlockType[] | undefined, configs: NonNullable<FieldConfig["blocks"]>): BlockType[] {
  const out = [...(blocks ?? [])];

  for (const config of configs) {
    const at = out.findIndex((block) => block.type === config.type);
    const base: BlockType = at === -1 ? { type: config.type, label: config.label ?? labelForKey(config.type.split("/").pop() ?? config.type), fields: [], count: 0 } : out[at]!;
    const merged: BlockType = {
      ...base,
      ...(config.label !== undefined ? { label: config.label } : {}),
      ...(config.description !== undefined ? { description: config.description } : {}),
      ...(config.example !== undefined ? { example: config.example, exampleDeclared: true } : {}),
      ...(config.thumbnail !== undefined ? { thumbnail: normalizePath(config.thumbnail) } : {}),
      fields: applyFieldConfigs(base.fields, config.fields ?? []),
    };

    if (at === -1) out.push(merged);
    else out[at] = merged;
  }
  return out;
}

function applyFieldConfig(field: Field | undefined, config: FieldConfig): Field {
  const base: Field = field ?? { key: config.key, label: labelForKey(config.key), type: config.type ?? "string", required: false, source: "config" };
  const out: Field = { ...base, source: "config" };

  for (const key of ["label", "type", "required", "description", "options", "discriminator", "collection", "default", "examples", "hidden", "dataSource"] as const) {
    if (config[key] !== undefined) (out as unknown as Record<string, unknown>)[key] = config[key];
  }
  if (config.examples !== undefined) out.examplesDeclared = true;
  if (config.of) out.of = applyFieldConfig(base.of, { ...config.of, key: config.of.key ?? "item" });
  if (config.fields) out.fields = applyFieldConfigs(base.fields ?? [], config.fields);
  if (config.blocks) out.blocks = applyBlockConfig(base.blocks, config.blocks);
  return out;
}

/** Overrides fields by key; config-only fields are appended. */
export function applyFieldConfigs(fields: Field[], configs: FieldConfig[]): Field[] {
  const out = [...fields];

  for (const config of configs) {
    const at = out.findIndex((field) => field.key === config.key);

    if (at === -1) out.push(applyFieldConfig(undefined, config));
    else out[at] = applyFieldConfig(out[at], config);
  }
  return out;
}

const SIMPLE_KEYS = ["label", "singular", "description", "kind", "path", "pattern", "format", "body", "url", "titleField", "dateField", "imageField", "draftField", "create", "hidden"] as const;

function applyCollectionConfig(collection: Collection | undefined, config: CollectionConfig): Collection | null {
  if (!collection && !config.path) return null;
  const path = config.path ? normalizePath(config.path) || "." : collection!.path;
  const kind = config.kind ?? collection?.kind ?? (formatForPath(path) ? "data" : "entries");
  const format = config.format ?? collection?.format ?? formatForPath(path) ?? "markdown";
  const names = collectionNames(config.id);
  const base: Collection = collection ?? {
    id: config.id,
    label: names.label,
    singular: names.singular,
    kind,
    path,
    format,
    body: format === "markdown" || format === "mdx",
    url: null,
    fields: [],
    create: kind === "entries",
    count: 0,
    source: "config",
  };
  const out: Collection = { ...base, source: "config" };

  for (const key of SIMPLE_KEYS) {
    if (config[key] !== undefined) (out as unknown as Record<string, unknown>)[key] = config[key];
  }
  out.path = path;
  if (config.fields) out.fields = applyFieldConfigs(base.fields, config.fields);
  return out;
}

/** Whether a config entry changes which files a collection owns (so it must be re-read). */
export function changesFiles(collection: Collection | undefined, config: CollectionConfig): boolean {
  if (!collection) return true;
  return (
    (config.path !== undefined && normalizePath(config.path) !== normalizePath(collection.path)) ||
    (config.pattern !== undefined && config.pattern !== collection.pattern) ||
    (config.format !== undefined && config.format !== collection.format) ||
    (config.kind !== undefined && config.kind !== collection.kind)
  );
}

export function mergeConfig(detected: SiteModel, config: GalleyConfig | null): SiteModel {
  if (!config) return detected;
  const notes = [...detected.notes];
  const collections = [...detected.collections];

  for (const entry of config.collections ?? []) {
    const at = collections.findIndex((collection) => collection.id === entry.id);
    const merged = applyCollectionConfig(at === -1 ? undefined : collections[at], entry);

    if (!merged) {
      notes.push(`The “${entry.id}” collection in ${PRODUCT.configFile} needs a path; it was skipped.`);
      continue;
    }
    if (at === -1) collections.push(merged);
    else collections[at] = merged;
  }
  const framework = config.framework && config.framework !== detected.framework.id ? { id: config.framework, name: adapterName(config.framework) ?? config.framework } : detected.framework;
  // A custom command may not take the adapter's port flag, so it only travels with the detected command.
  const dev: SiteModel["dev"] =
    config.dev?.command || detected.dev
      ? {
          command: config.dev?.command ?? detected.dev!.command,
          port: config.dev?.port ?? detected.dev?.port ?? null,
          ...(!config.dev?.command && detected.dev?.portArgs ? { portArgs: detected.dev.portArgs } : {}),
        }
      : null;
  const build = config.build?.command || detected.build ? { command: config.build?.command ?? detected.build!.command, outDir: config.build?.outDir ?? detected.build?.outDir ?? "dist" } : null;
  const mediaDir = config.media?.dir ? normalizePath(config.media.dir) : detected.media.dir;
  const publicPath = config.media?.publicPath ?? (config.media?.dir ? `/${mediaDir.split("/").slice(1).join("/")}` : detected.media.publicPath);
  const roots = config.media?.roots ?? detected.media.roots;
  const media = {
    dir: mediaDir,
    publicPath,
    roots: roots.some((root) => normalizePath(root.dir) === mediaDir) ? roots : [{ dir: mediaDir, publicPath }, ...roots],
    ...(config.media?.storage ? { storage: config.media.storage } : {}),
    ...(config.media?.images ? { images: config.media.images } : {}),
  };
  const added = collections
    .filter((collection) => !detected.collections.some((existing) => existing.id === collection.id && existing.path === collection.path))
    .map((collection) => (collection.kind === "data" ? collection.path : `${collection.path === "." ? "" : `${collection.path}/`}**`));
  // The redirects list is content, and the host's redirect file is derived from it: both editable in content mode.
  const redirectGlobs = redirectPaths(config, { collections, media });
  const contentGlobs = config.writable?.content ?? [...detected.writable.content, ...added, ...(config.media?.dir ? [`${mediaDir}/**`] : []), ...redirectGlobs];
  const listFile = redirectGlobs[0];
  const configured = new Set((config.collections ?? []).filter((entry) => entry.hidden !== undefined).map((entry) => entry.id));

  // The list has its own screen; the generic data editor for it would be a second, worse one.
  for (let index = 0; index < collections.length; index += 1) {
    const collection = collections[index]!;

    if (collection.kind === "data" && collection.path === listFile && !configured.has(collection.id)) collections[index] = { ...collection, hidden: true };
  }

  if (config.framework && config.framework !== detected.framework.id) notes.push(`${PRODUCT.configFile} sets the framework to ${framework.name}.`);
  notes.push(`Applied ${PRODUCT.configFile}.`);
  return {
    ...detected,
    name: config.name ?? detected.name,
    framework,
    dev,
    build,
    urls: { ...detected.urls, ...config.urls },
    media,
    publish: { ...detected.publish, ...config.publish },
    ai: { ...detected.ai, ...config.ai },
    writable: { content: [...new Set(contentGlobs)], build: config.writable?.build ?? detected.writable.build },
    collections,
    ...(config.templates?.length ? { templates: config.templates.map((template) => ({ ...template, file: normalizePath(template.file), ...(template.thumbnail ? { thumbnail: normalizePath(template.thumbnail) } : {}) })) } : {}),
    ...(config.deploy ? { deploy: config.deploy } : {}),
    ...(config.redirects ? { redirects: config.redirects } : {}),
    notes,
  };
}

/**
 * Templates and section pictures name files; a missing one is reported in
 * the notes and never stops the site from opening. A template for a
 * collection the site doesn't have can't be used, so it is left out.
 */
async function checkDeclaredFiles(root: string, model: SiteModel): Promise<SiteModel> {
  const notes = [...model.notes];
  const missing = (path: string) => !existsSync(absolute(root, path));
  const templates = (model.templates ?? []).filter((template) => {
    if (!model.collections.some((collection) => collection.id === template.collection)) {
      notes.push(`The template “${template.label}” is for a “${template.collection}” collection, which this site doesn't have, so it was left out.`);
      return false;
    }
    if (missing(template.file)) notes.push(`The template “${template.label}” points at ${template.file}, which doesn't exist; it can't be used until that file is there.`);
    if (template.thumbnail && missing(template.thumbnail)) notes.push(`The picture of the template “${template.label}” (${template.thumbnail}) doesn't exist.`);
    return true;
  });
  const visit = (fields: Field[]) => {
    for (const field of fields) {
      for (const block of field.blocks ?? []) {
        if (block.thumbnail && missing(block.thumbnail)) notes.push(`The picture of the “${block.label}” section (${block.thumbnail}) doesn't exist.`);
        visit(block.fields);
      }
      visit(field.fields ?? []);
      if (field.of) visit([field.of]);
    }
  };

  for (const collection of model.collections) visit(collection.fields);
  // A template file kept inside a collection's folder is not one of its entries.
  const inside = templates.length > 0 ? model.collections.filter((collection) => templates.some((template) => collectionForPath({ ...model, templates: [] }, template.file)?.id === collection.id)) : [];
  const collections = await Promise.all(
    model.collections.map(async (collection) =>
      inside.includes(collection) ? { ...collection, count: (await listCollectionFiles(root, { collections: model.collections, templates }, collection)).length } : collection
    )
  );
  const { templates: _dropped, ...rest } = model;

  return { ...rest, collections, ...(templates.length ? { templates } : {}), notes };
}

/**
 * What detection finds before galley.config.json is laid over it — the values
 * an override in the config replaces. The adapters the config names are still
 * loaded (they describe the framework, they don't override anything), but a
 * `framework` in the config is not: picking the adapter is an override too.
 */
export async function detectSiteModel(root: string): Promise<SiteModel> {
  let config: GalleyConfig | null = null;

  try {
    config = await readConfig(root);
  } catch {
    config = null;
  }
  const loaded = await siteExtensions(root, config);

  return (await runDetection(root, { adapters: loaded.adapters, notes: loaded.notes })).model;
}

/**
 * Detection merged with galley.config.json. This is where a site's own
 * adapters come in: the ones its config names are loaded (from inside the
 * site only) and considered before the built-in ones, and a `framework` in
 * the config picks the adapter outright.
 */
export async function loadSiteModel(root: string): Promise<SiteModel> {
  let config: GalleyConfig | null = null;
  let configProblem: string | null = null;

  try {
    config = await readConfig(root);
  } catch (error) {
    configProblem = error instanceof GalleyError ? error.message : String(error);
  }
  if (configProblem !== null) {
    // A config that can't be read names no adapters to trust; the built-ins describe the site.
    const { model } = await runDetection(root);

    return { ...model, notes: [...model.notes, `${configProblem} The file was ignored until it is fixed.`] };
  }
  const loaded = await siteExtensions(root, config);
  const { model: detected, adapter } = await runDetection(root, { adapters: loaded.adapters, ...(config?.framework ? { framework: config.framework } : {}), notes: loaded.notes });
  // When the named framework has no adapter, report what was actually used rather than relabelling it.
  const effective = config?.framework && config.framework !== adapter.id ? { ...config, framework: undefined } : config;
  const merged = await checkDeclaredFiles(root, mergeConfig(detected, effective));

  if (!config?.collections) return merged;
  // Collections the config adds or points elsewhere: count and infer them from their files.
  const collections = [...merged.collections];
  let moved = false;

  for (const entry of config.collections) {
    const before = detected.collections.find((collection) => collection.id === entry.id);
    const at = collections.findIndex((collection) => collection.id === entry.id);

    if (at === -1 || !changesFiles(before, entry)) continue;
    const inspected = await inspectCollection(root, { collections }, { ...collections[at]!, fields: [] }, null, merged.media);

    collections[at] = { ...inspected, fields: applyFieldConfigs(inspected.fields, entry.fields ?? []), source: "config" };
    moved = true;
  }
  if (moved) {
    // A collection that now claims a subfolder takes those files from its parent.
    for (let index = 0; index < collections.length; index += 1) {
      const collection = collections[index]!;

      if (collection.kind === "entries") collections[index] = { ...collection, count: (await listCollectionFiles(root, { collections, ...(merged.templates ? { templates: merged.templates } : {}) }, collection)).length };
    }
  }
  return { ...merged, collections };
}
