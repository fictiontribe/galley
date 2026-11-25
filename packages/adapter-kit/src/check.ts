/**
 * The conformance check: what "a correct adapter" means, as a list of checks
 * run against a fixture site the author supplies. Each failure says what to
 * change. The adapter is run through the real engine, exactly as Galley runs
 * it, alongside the built-in adapters.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { detectWithAdapters, outsideBuiltFrom, validateAdapter, type DetectionRun, type GalleyAdapter } from "@galley/core/adapter";
import { applyEdits, findFrontMatter, listEntries, parseDocument } from "@galley/core/content";
import type { EditOp, FieldPath, JsonValue, SiteModel } from "@galley/core/types";

export interface AdapterExpectations {
  /** Collections the fixture must yield. `url: null` means "no pages"; leave `url` out to not check it. */
  collections?: Array<{ id: string; minEntries?: number; url?: string | null; fields?: string[] }>;
  dev?: { command?: string; port?: number };
}

export type CheckStatus = "pass" | "fail" | "warn";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail?: string;
}

export interface AdapterReport {
  /** True when no check failed (warnings are allowed). */
  ok: boolean;
  checks: CheckResult[];
  /** The site model Galley builds from the fixture with this adapter installed. */
  model: SiteModel;
}

/** Every check, in the order they run and are reported. */
export const CHECKS = [
  { id: "shape", title: "Is a well-formed adapter object" },
  { id: "detect-own", title: "Recognises its own fixture" },
  { id: "selected", title: "Wins its fixture against the built-in adapters" },
  { id: "detect-foreign", title: "Does not claim sites that are not its own" },
  { id: "detect-empty", title: "Copes with an empty folder" },
  { id: "detect-fast", title: "Decides quickly" },
  { id: "hooks", title: "Every hook runs without failing" },
  { id: "collections", title: "Finds collections in its fixture" },
  { id: "ids", title: "Collection ids are unique and stable" },
  { id: "paths", title: "Every collection path exists and holds files" },
  { id: "parse", title: "Every entry in the fixture parses" },
  { id: "round-trip", title: "Entries survive an edit and its undo, byte for byte" },
  { id: "urls", title: "URL patterns are well formed and give every entry its own address" },
  { id: "stable", title: "Two runs describe the site the same way" },
  { id: "read-only", title: "Nothing was written to the fixture" },
  { id: "commands", title: "Says how to run and build the site" },
  { id: "built-from", title: "What it says the site is built from holds the site's content" },
  { id: "expectations", title: "Matches the expectations given" },
] as const;

export type CheckId = (typeof CHECKS)[number]["id"];

/** The checks that run for these expectations (the last one only when there are some). */
export function checksFor(expectations?: AdapterExpectations): Array<{ id: CheckId; title: string }> {
  return CHECKS.filter((check) => check.id !== "expectations" || hasExpectations(expectations));
}

function hasExpectations(expectations?: AdapterExpectations): boolean {
  return !!expectations && ((expectations.collections?.length ?? 0) > 0 || expectations.dev !== undefined);
}

/** The foreign fixtures shipped with the kit: sites no adapter should claim. */
export const FOREIGN_FIXTURES: Array<{ name: string; description: string; dir: string }> = [
  { name: "plain-markdown", description: "a plain folder of markdown notes", dir: fileURLToPath(new URL("../fixtures/foreign/plain-markdown", import.meta.url)) },
  { name: "node-app", description: "a Node web service with a package.json", dir: fileURLToPath(new URL("../fixtures/foreign/node-app", import.meta.url)) },
];

const FAST_WARN_MS = 100;
const FAST_FAIL_MS = 1000;
/** Claims at or below this are the "weak fallback" kind and do not count as claiming a site. */
const WEAK = 0.1;
const MAX_ROUND_TRIPS_PER_COLLECTION = 50;
const LIST_LIMIT = 5;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const listed = (items: string[]) => (items.length <= LIST_LIMIT ? items.join("; ") : `${items.slice(0, LIST_LIMIT).join("; ")}; and ${items.length - LIST_LIMIT} more`);

/** path → size, mtime and content hash, for every file under the folder. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== ".git") walk(path);
      } else if (entry.isFile()) {
        const info = statSync(path);

        out.set(relative(dir, path), `${info.size}:${info.mtimeMs}:${createHash("sha1").update(readFileSync(path)).digest("hex")}`);
      }
    }
  };

  walk(dir);
  return out;
}

/** The first top-level scalar of a document's data, with a path to it. */
function firstScalar(data: { [key: string]: JsonValue }): { path: FieldPath; value: string | number | boolean } | null {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && value !== "" && !value.includes("\n")) return { path: [key], value };
    if (typeof value === "number" || typeof value === "boolean") return { path: [key], value };
  }
  const items = data.items;

  if (Array.isArray(items) && items[0] && typeof items[0] === "object" && !Array.isArray(items[0])) {
    const inner = firstScalar(items[0] as { [key: string]: JsonValue });

    return inner ? { path: ["items", 0, ...inner.path], value: inner.value } : null;
  }
  return null;
}

function changed(value: string | number | boolean): string | number | boolean {
  if (typeof value === "string") return `${value} (changed by the check)`;
  if (typeof value === "number") return value + 1;
  return !value;
}

/** Wraps detect to time it, without changing what it does. */
function timed(adapter: GalleyAdapter, durations: number[]): GalleyAdapter {
  return {
    ...adapter,
    detect: async (ctx) => {
      const start = performance.now();

      try {
        return await adapter.detect(ctx);
      } finally {
        durations.push(performance.now() - start);
      }
    },
  };
}

function firstDifference(a: unknown, b: unknown, path = ""): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path ? `${path}.${key}` : key);

      if (found) return found;
    }
  }
  return path || "the whole model";
}

/**
 * Runs every check against `fixtureDir` (a small site of the adapter's own
 * framework). The fixture is only read.
 */
export async function checkAdapter(adapter: GalleyAdapter, fixtureDir: string, expectations?: AdapterExpectations): Promise<AdapterReport> {
  const root = resolve(fixtureDir);
  const results = new Map<CheckId, CheckResult>();
  const titles = new Map<string, string>(CHECKS.map((check) => [check.id, check.title]));
  const set = (id: CheckId, status: CheckStatus, detail?: string) => results.set(id, { id, title: titles.get(id)!, status, ...(detail ? { detail } : {}) });
  const finish = (model: SiteModel): AdapterReport => {
    const checks = checksFor(expectations).map((check) => results.get(check.id) ?? { id: check.id, title: check.title, status: "fail" as const, detail: "Not run, because an earlier check could not complete." });

    return { ok: checks.every((check) => check.status !== "fail"), checks, model };
  };
  const shape = validateAdapter(adapter, `The “${(adapter as { id?: unknown })?.id ?? "unnamed"}” adapter`);
  const before = snapshot(root);

  if (!shape.ok) {
    set("shape", "fail", `${shape.problem} Nothing else can be checked until it is.`);
    return finish((await detectWithAdapters(root)).model);
  }
  set("shape", shape.warnings.length > 0 ? "warn" : "pass", shape.warnings[0] ?? `id “${adapter.id}”, name “${adapter.name}”.`);
  const durations: number[] = [];
  const subject = timed(adapter, durations);
  const name = `The ${adapter.name} adapter`;
  let run: DetectionRun;

  try {
    run = await detectWithAdapters(root, { adapters: [subject] });
  } catch (error) {
    set("detect-own", "fail", `Detection stopped with an error (${error instanceof Error ? error.message : String(error)}). This is a bug in the engine; please report it with the fixture.`);
    return finish((await detectWithAdapters(root)).model);
  }
  const model = run.model;

  // ── detect-own, selected
  const own = run.candidates.find((candidate) => candidate.id === adapter.id && candidate.name === adapter.name);

  if (!own || own.error) set("detect-own", "fail", `${name} could not check its own fixture: ${own?.error ?? "it never ran"}. detect() must return a match or null, and never throw.`);
  else if (!own.match) set("detect-own", "fail", `${name}'s detect() returned null for its own fixture (${root}). Check what it looks for — a dependency in package.json, a config file — and that the fixture has it.`);
  else if (own.match.confidence <= WEAK) set("detect-own", "fail", `${name} claimed its own fixture with confidence ${own.match.confidence}, which counts as a weak fallback. Return 0.8 or more for a site you recognise.`);
  else set("detect-own", "pass", `confidence ${own.match.confidence}${own.match.version ? `, version ${own.match.version}` : ""}.`);
  if (run.adapter === subject) set("selected", "pass", `chosen over ${plural(run.candidates.length - 1, "other adapter")}.`);
  else {
    const winner = run.candidates.find((candidate) => candidate.id === run.adapter.id);

    set("selected", "fail", `The built-in ${run.adapter.name} adapter was chosen for the fixture (confidence ${winner?.match?.confidence ?? "?"}) instead of the ${adapter.name} adapter (${own?.match?.confidence ?? "no match"}). Return a higher confidence when the site is certainly yours — 0.95 for a dependency plus a config file.`);
  }

  // ── detect-foreign, detect-empty
  const foreign: string[] = [];
  const foreignWeak: string[] = [];

  for (const fixture of FOREIGN_FIXTURES) {
    const other = await detectWithAdapters(fixture.dir, { adapters: [subject], builtins: false });
    const bid = other.candidates[0];

    if (bid?.error) foreign.push(`on ${fixture.description} (${fixture.name}) ${bid.error}`);
    else if (bid?.match && bid.match.confidence > WEAK) foreign.push(`it claimed ${fixture.description} (${fixture.name}) with confidence ${bid.match.confidence}`);
    else if (bid?.match) foreignWeak.push(fixture.name);
  }
  if (foreign.length > 0) set("detect-foreign", "fail", `${listed(foreign)}. Return null unless the site shows something only your framework leaves behind, such as its package in package.json or its config file.`);
  else if (foreignWeak.length > 0) set("detect-foreign", "warn", `It answers weakly (≤ ${WEAK}) for ${foreignWeak.join(", ")}. That is harmless, but null is clearer.`);
  else set("detect-foreign", "pass", `said no to ${FOREIGN_FIXTURES.map((fixture) => fixture.name).join(" and ")}.`);
  const empty = mkdtempSync(join(tmpdir(), "galley-adapter-empty-"));

  try {
    const emptyRun = await detectWithAdapters(empty, { adapters: [subject], builtins: false });
    const bid = emptyRun.candidates[0];

    if (bid?.error) set("detect-empty", "fail", `On an empty folder ${bid.error}. Treat every file as possibly missing: ctx.readText and ctx.readJson return null, and package.json may be absent.`);
    else if (bid?.match && bid.match.confidence > WEAK) set("detect-empty", "fail", `It claimed an empty folder with confidence ${bid.match.confidence}. Return null when there is nothing of your framework's to see.`);
    else if (emptyRun.problems.length > 0) set("detect-empty", "fail", `Its hooks failed on an empty folder: ${listed(emptyRun.problems)}`);
    else set("detect-empty", "pass");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  // ── collections, ids, paths, parse, round-trip, urls
  set("hooks", run.problems.length === 0 ? "pass" : "fail", run.problems.length === 0 ? undefined : `${listed(run.problems)} A hook must not throw for an unusual site: return what you can and say the rest with ctx.note().`);
  if (model.collections.length === 0) set("collections", "fail", "No collections were found in the fixture. Return them from collections(), or put content where conventions().contentDirs says it is.");
  else set("collections", "pass", model.collections.map((collection) => `${collection.id} (${collection.kind === "data" ? collection.path : plural(collection.count, "entry", "entries")})`).join(", "));
  const draftIds = (run.drafts ?? []).map((draft) => draft.id);
  const duplicates = [...new Set(draftIds.filter((id, index) => draftIds.indexOf(id) !== index))];
  const renamed = model.collections.filter((collection) => /-\d+$/.test(collection.id) && !draftIds.includes(collection.id)).map((collection) => collection.id);

  const pathProblems: string[] = [];
  const parseProblems: string[] = [];
  const tripProblems: string[] = [];
  const tripSkips: string[] = [];
  const urlProblems: string[] = [];
  const seenUrls = new Map<string, string>();
  let tripped = 0;
  let read = 0;

  for (const collection of model.collections) {
    const where = `“${collection.label}” (${collection.id})`;
    let info: ReturnType<typeof statSync> | null = null;

    try {
      info = statSync(join(root, collection.path));
    } catch {
      info = null;
    }
    if (!info) pathProblems.push(`${where} points at ${collection.path}, which does not exist`);
    else if (collection.kind === "entries" && !info.isDirectory()) pathProblems.push(`${where} is a folder collection, but ${collection.path} is a file — use kind "data" for a single file`);
    else if (collection.kind === "data" && !info.isFile()) pathProblems.push(`${where} is a data collection, but ${collection.path} is a folder — use kind "entries"`);
    else if (collection.count === 0) pathProblems.push(`${where} matches no files in ${collection.path}${collection.pattern ? ` with the pattern ${collection.pattern}` : ""}`);
    if (collection.url !== null) {
      const pattern = collection.url;
      const problems = [
        !pattern.startsWith("/") && "does not start with /",
        /\s/.test(pattern) && "contains a space",
        /\/\//.test(pattern) && "contains //",
        /[?#]/.test(pattern) && "contains ? or #",
        collection.kind === "entries" && (pattern.match(/\{slug\}/g) ?? []).length !== 1 && "should contain {slug} exactly once",
        /\{(?!slug\})[^}]*\}/.test(pattern) && "has a placeholder other than {slug}",
      ].filter((item): item is string => typeof item === "string");

      if (problems.length > 0) urlProblems.push(`${where} has the URL pattern “${pattern}”, which ${problems.join(" and ")}`);
    }
    if (collection.count === 0) continue;
    const files = (await listEntries(root, model, collection.id, { limit: 100_000 })).items;
    let trips = 0;

    for (const item of files) {
      let raw: string;

      try {
        raw = readFileSync(join(root, item.path), "utf8");
      } catch (error) {
        parseProblems.push(`${item.path} could not be read (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
      const parsed = parseDocument(raw, collection.format);

      read += 1;

      if (parsed.errors.length > 0) {
        parseProblems.push(`${item.path}: ${parsed.errors[0]}`);
        continue;
      }
      if (item.url !== null && collection.kind === "entries") {
        const other = seenUrls.get(item.url);

        if (other) urlProblems.push(`${item.path} and ${other} both get the address ${item.url}`);
        else seenUrls.set(item.url, item.path);
      }
      if (trips >= MAX_ROUND_TRIPS_PER_COLLECTION) continue;
      trips += 1;
      const same = applyEdits(raw, collection.format, []);

      if (same.content !== raw) {
        tripProblems.push(`${item.path} changes when no edit is applied`);
        continue;
      }
      if (collection.format === "toml" || findFrontMatter(raw)?.syntax === "toml") {
        tripSkips.push(item.path);
        continue;
      }
      const scalar = firstScalar(parsed.data);

      if (!scalar) continue;
      const ops = (value: JsonValue): EditOp[] => [{ op: "set", path: scalar.path, value }];
      const there = applyEdits(raw, collection.format, ops(changed(scalar.value)));
      const back = there.refused.length === 0 ? applyEdits(there.content, collection.format, ops(scalar.value)) : null;

      if (there.refused.length > 0) tripProblems.push(`${item.path}: changing “${scalar.path.join(".")}” was refused (${there.refused[0]!.reason}), so an editor could not change it from the form either`);
      else if (there.content === raw) tripProblems.push(`${item.path}: changing “${scalar.path.join(".")}” left the file as it was — check the collection's format matches its files`);
      else if (back && back.content !== raw) tripProblems.push(`${item.path}: changing “${scalar.path.join(".")}” and changing it back did not restore the file byte for byte — check the collection's format matches its files`);
      else tripped += 1;
    }
  }

  if (duplicates.length > 0) set("ids", "fail", `${duplicates.map((id) => `“${id}”`).join(", ")} ${duplicates.length === 1 ? "is" : "are"} used by more than one collection, so the engine renamed the later ones (${renamed.join(", ") || "with a number"}). Give every collection its own id.`);
  if (pathProblems.length > 0) set("paths", "fail", `${listed(pathProblems)}. Collection paths are relative to the site root.`);
  else set("paths", "pass");
  if (parseProblems.length > 0) set("parse", "fail", `${listed(parseProblems)}. Check the collection's format and pattern, or fix the fixture.`);
  else set("parse", "pass", `${plural(read, "file")} read.`);
  if (tripProblems.length > 0) set("round-trip", "fail", `${listed(tripProblems)}.`);
  else if (tripped === 0 && tripSkips.length > 0) set("round-trip", "warn", `${plural(tripSkips.length, "file")} keep${tripSkips.length === 1 ? "s" : ""} its fields in TOML, which the form can only read, so no edit was tried.`);
  else if (tripped === 0) set("round-trip", "warn", "No entry had a plain value to try an edit on.");
  else set("round-trip", "pass", `${plural(tripped, "entry", "entries")} edited and restored${tripSkips.length > 0 ? `; ${plural(tripSkips.length, "TOML file")} skipped` : ""}.`);
  if (urlProblems.length > 0) set("urls", "fail", `${listed(urlProblems)}. A pattern is a path with one {slug}, like "/blog/{slug}/"; return null from routes() for a collection with no pages.`);
  else set("urls", "pass", seenUrls.size > 0 ? `${plural(seenUrls.size, "address", "addresses")}, all different.` : "no collection has pages.");

  // ── stable
  const again = await detectWithAdapters(root, { adapters: [subject] });
  const difference = firstDifference(model, again.model);
  const sameIds = JSON.stringify(model.collections.map((collection) => collection.id)) === JSON.stringify(again.model.collections.map((collection) => collection.id));

  if (!results.has("ids")) set("ids", sameIds ? "pass" : "fail", sameIds ? (run.drafts === null ? "found by conventional discovery." : undefined) : "The collection ids changed between two runs. Derive ids from names in the site, never from the clock, randomness or file order on disk.");
  set("stable", difference === null ? "pass" : "fail", difference === null ? undefined : `The second run differed at ${difference}. Hooks must give the same answer for the same files.`);

  // ── read-only
  const after = snapshot(root);
  const touched = [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path));

  set("read-only", touched.length === 0 ? "pass" : "fail", touched.length === 0 ? undefined : `${listed(touched)} ${touched.length === 1 ? "was" : "were"} created, changed or removed. An adapter only reads; use ctx.readText and friends, never node:fs writes.`);

  // ── commands
  const missing = [!model.dev && "no dev command", !model.build && "no build command"].filter(Boolean) as string[];

  if (missing.length === 0) set("commands", "pass", `dev “${model.dev!.command}”${model.dev!.port ? ` on port ${model.dev!.port}` : ""}, build “${model.build!.command}” into ${model.build!.outDir}.`);
  else {
    set(
      "commands",
      "warn",
      `The fixture yields ${missing.join(" and ")}, so ${!model.dev ? "previews will be unavailable" : "the build check will be unavailable"} for sites like it unless their package.json has the script. Set conventions().${!model.dev ? "dev" : "build"}.command to the framework's own command.`
    );
  }

  // ── what the site is built from
  const outside = outsideBuiltFrom(model);

  if (!model.builtFrom) set("built-from", "pass", "Not said (conventions().builtFrom), so every file in a site counts as what it is built from.");
  else if (outside.length === 0) set("built-from", "pass", model.builtFrom.join(", "));
  else {
    set(
      "built-from",
      "fail",
      `conventions().builtFrom is ${model.builtFrom.join(", ")}, which leaves out ${listed(outside)}: ${outside.length === 1 ? "that is" : "those are"} content, media or routes the built site reads. A file outside the list is treated as beside the site (moving media to a bucket would remove a picture only such a file names), so include every folder the build reads.`
    );
  }

  // ── expectations
  if (hasExpectations(expectations)) {
    const misses: string[] = [];

    for (const expected of expectations!.collections ?? []) {
      const found = model.collections.find((collection) => collection.id === expected.id);

      if (!found) {
        misses.push(`no collection “${expected.id}” (found ${model.collections.map((collection) => collection.id).join(", ") || "none"})`);
        continue;
      }
      if (expected.minEntries !== undefined && found.count < expected.minEntries) misses.push(`“${expected.id}” has ${plural(found.count, "entry", "entries")}, expected at least ${expected.minEntries}`);
      if (expected.url !== undefined && found.url !== expected.url) misses.push(`“${expected.id}” has the URL pattern ${JSON.stringify(found.url)}, expected ${JSON.stringify(expected.url)}`);
      for (const key of expected.fields ?? []) {
        if (!found.fields.some((field) => field.key === key)) misses.push(`“${expected.id}” has no field “${key}” (it has ${found.fields.map((field) => field.key).join(", ") || "none"})`);
      }
    }
    if (expectations!.dev?.command !== undefined && model.dev?.command !== expectations!.dev.command) misses.push(`the dev command is ${JSON.stringify(model.dev?.command ?? null)}, expected ${JSON.stringify(expectations!.dev.command)}`);
    if (expectations!.dev?.port !== undefined && model.dev?.port !== expectations!.dev.port) misses.push(`the dev port is ${JSON.stringify(model.dev?.port ?? null)}, expected ${expectations!.dev.port}`);
    set("expectations", misses.length === 0 ? "pass" : "fail", misses.length === 0 ? undefined : `${listed(misses)}.`);
  }

  const slowest = Math.max(...durations, 0);

  if (slowest > FAST_FAIL_MS) set("detect-fast", "fail", `detect() took ${Math.round(slowest)} ms. It runs for every site Galley opens: look for a file or two, never read whole folders.`);
  else if (slowest > FAST_WARN_MS) set("detect-fast", "warn", `detect() took ${Math.round(slowest)} ms; under ${FAST_WARN_MS} ms is the aim. Do the heavy reading in conventions() or collections().`);
  else set("detect-fast", "pass", `${slowest < 1 ? "under 1" : Math.round(slowest)} ms at most.`);
  return finish(model);
}

const MARK: Record<CheckStatus, string> = { pass: "ok  ", warn: "warn", fail: "FAIL" };

/** The report as plain text, one line per check, details indented. */
export function formatReport(report: AdapterReport, heading?: string): string {
  const lines = heading ? [heading, ""] : [];

  for (const check of report.checks) {
    lines.push(`${MARK[check.status]}  ${check.title}`);
    if (check.detail) lines.push(`      ${check.detail}`);
  }
  const failed = report.checks.filter((check) => check.status === "fail").length;
  const warned = report.checks.filter((check) => check.status === "warn").length;

  lines.push("", report.ok ? `All ${report.checks.length} checks passed${warned > 0 ? `, ${plural(warned, "warning")}` : ""}.` : `${plural(failed, "check")} failed${warned > 0 ? `, ${plural(warned, "warning")}` : ""}.`);
  return lines.join("\n");
}
