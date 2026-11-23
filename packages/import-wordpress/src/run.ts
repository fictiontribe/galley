/**
 * runImport: carry out a plan through SiteService, and nothing else.
 *
 * Every write is an ordinary engine call — createEntry, updateEntry,
 * saveMedia — so imported content lands in the working tree as pending
 * changes, validated and named by the engine's own rules, and shows up in
 * Proof like any other edit. Nothing is published.
 *
 * Running again is safe. The import record (manifest.ts) maps each
 * WordPress item to the entry it became and the hash of what was planned:
 * an unchanged item is left alone, a changed one is updated in place, and
 * one that a person has edited since the import is never overwritten.
 */
import { createHash } from "node:crypto";
import type { EditOp, JsonValue, MediaItem, SiteService } from "@galley/core/types";
import { ImportError } from "./errors";
import { loadManifest, manifestKey, saveManifest, IMPORT_DIR, type Manifest } from "./manifest";
import { datedFolder, extensionOf, fileNameFor, mediaFor, originalCandidates, SAVABLE, sizeIndex } from "./media";
import { netlifySnippet } from "./redirects";
import { buildReport, type MediaTally, type Outcome } from "./report";
import { createFetcher } from "./source/http";
import type { ImportPlan, ImportReport, PlannedItem, RunOptions, WordPressSite } from "./types";

const DEFAULT_MAX_FILE = 25 * 1024 * 1024;
const DEFAULT_MAX_TOTAL = 1024 * 1024 * 1024;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces every string equal to `from` inside entry data. */
function replaceDeep(value: JsonValue, map: Map<string, string>): JsonValue {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => replaceDeep(entry, map));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceDeep(entry, map)]));
  return value;
}

function setPath(data: Record<string, JsonValue>, path: string, value: JsonValue | undefined): void {
  const keys = path.split(".");
  let target: Record<string, JsonValue> = data;

  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== "object") target[key] = {};
    target = target[key] as Record<string, JsonValue>;
  }
  const last = keys[keys.length - 1]!;

  if (value === undefined) delete target[last];
  else target[last] = value;
}

/** In Markdown: the new address for every saved file; a visible-in-Proof note where an image couldn't come across. */
function rewriteBody(body: string, saved: Map<string, string>, failed: Map<string, string>): string {
  let text = body;

  for (const [from, to] of [...saved.entries()].sort((a, b) => b[0].length - a[0].length)) text = text.split(from).join(to);
  for (const [url, reason] of failed) {
    const image = new RegExp(`!\\[([^\\]]*)\\]\\(<?${escapeRegExp(url)}>?(?:\\s+"[^"]*")?\\)`, "g");

    text = text.replace(image, (_match, alt: string) => `<!-- An image${alt ? ` (“${alt.replace(/--/g, "–")}”)` : ""} couldn't be brought across: ${reason.replace(/--/g, "–")} It was at ${url} -->`);
  }
  return text;
}

export async function runImport(site: SiteService, wp: WordPressSite, plan: ImportPlan, options: RunOptions = {}): Promise<ImportReport> {
  const dryRun = Boolean(options.dryRun);
  const progress = options.onProgress ?? (() => undefined);
  const check = () => {
    if (options.signal?.aborted) throw new ImportError("aborted", "The import was stopped. What was already imported is kept as pending changes; run it again to finish.");
  };
  const isAbort = (error: unknown) => error instanceof ImportError && error.reason === "aborted";
  /**
   * Stopping part-way keeps what already arrived: downloads that finished,
   * entries already written and the import record for both, so running again
   * picks up where this one stopped and never duplicates anything.
   */
  let stopped = false;

  if (plan.questions.length && !dryRun) {
    throw new ImportError("question", `The import needs an answer first: ${plan.questions[0]!.question}`, plan.questions.map((question) => question.id).join(", "));
  }
  const model = await site.model();
  const { manifest, text: manifestBefore } = await loadManifest(site, wp.siteUrl);
  const outcomes: Outcome[] = [];
  const files: string[] = [];

  // 1. Decide what each item needs, before downloading anything for it.
  const decisions: Array<{ item: PlannedItem; action: "create" | "update" | "unchanged" | "skip"; path: string; baseHash?: string; reason?: string }> = [];

  for (const item of plan.items) {
    check();
    const key = manifestKey(item.sourceType, item.sourceId);
    const record = manifest.items[key];
    const collection = model.collections.find((candidate) => candidate.id === item.collection);

    if (!collection) {
      decisions.push({ item, action: "skip", path: item.path, reason: `The site no longer has a “${item.collection}” collection.` });
      continue;
    }
    if (record) {
      const existing = await site.readEntry(record.path).catch(() => null);

      if (!existing) decisions.push({ item, action: "skip", path: record.path, reason: "It was imported before and has since been deleted here, so it wasn't imported again." });
      else if (record.hash === item.hash) decisions.push({ item, action: "unchanged", path: record.path });
      else if (existing.hash !== record.entryHash) decisions.push({ item, action: "skip", path: record.path, reason: "It changed on WordPress since the last import, but it has also been edited here, so it was left as it is." });
      else decisions.push({ item, action: "update", path: record.path, baseHash: existing.hash });
      continue;
    }
    const existing = await site.readEntry(item.path).catch(() => null);

    if (existing) {
      decisions.push({ item, action: "skip", path: item.path, reason: `A ${collection.singular} already lives at ${item.newUrl ?? item.path}. It was kept; rename or delete it and run the import again to bring this one in.` });
      continue;
    }
    decisions.push({ item, action: "create", path: item.path });
  }

  // 2. Media: what the content being written uses, plus the library when asked for.
  const writing = decisions.filter((decision) => decision.action === "create" || decision.action === "update");
  const users = new Map<string, string[]>();
  const wanted: Array<{ url: string; role: string }> = [];

  for (const decision of writing) {
    for (const ref of decision.item.media) {
      if (!users.has(ref.url)) wanted.push({ url: ref.url, role: ref.role });
      users.set(ref.url, [...(users.get(ref.url) ?? []), decision.item.title]);
    }
  }
  for (const ref of plan.library) if (!users.has(ref.url)) (users.set(ref.url, []), wanted.push({ url: ref.url, role: ref.role }));
  const saved = new Map<string, string>();
  const failed = new Map<string, string>();
  const tally: MediaTally = { saved: 0, reused: 0, failed: [], skipped: [], planned: wanted.length };
  const existingMedia = new Set((await site.listMedia()).map((item) => item.path));
  const byHash = new Map(Object.values(manifest.media).map((entry) => [entry.sha256, entry]));
  const index = sizeIndex(wp.media);
  const fetcher = createFetcher({
    ...(options.concurrency ? { concurrency: options.concurrency } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const maxFile = Math.min(options.maxFileBytes ?? DEFAULT_MAX_FILE, DEFAULT_MAX_FILE);
  const maxTotal = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL;
  let total = 0;
  let done = 0;
  // saveMedia picks collision-free names; run saves one at a time so two downloads never race for a name.
  let saving: Promise<unknown> = Promise.resolve();

  type Fetched = { kind: "saved"; entry: { path: string; url: string; sha256: string }; fresh: boolean } | { kind: "failed" | "skipped"; reason: string; shown: string };
  /** Downloads are shared by original: a thumbnail and its full-size file are fetched and saved once. */
  const inflight = new Map<string, Promise<Fetched>>();

  const fetchOriginal = async (url: string, candidates: string[]): Promise<Fetched> => {
    let result: Awaited<ReturnType<typeof fetcher.bytes>> | null = null;
    let from = url;

    for (const candidate of candidates) {
      result = await fetcher.bytes(candidate, { maxBytes: maxFile }).catch((error: unknown) => {
        if (error instanceof ImportError && error.reason === "aborted") throw error;
        return null;
      });
      from = candidate;
      if (result && (result.bytes || result.tooLarge)) break;
    }
    if (!result || (!result.bytes && !result.tooLarge)) {
      const reason = result ? `the old site answered ${result.status}` : "the old site didn't answer";

      return { kind: "failed", reason, shown: `Couldn't download it — ${reason}.` };
    }
    if (result.tooLarge) {
      const reason = `it's larger than ${Math.round(maxFile / 1024 / 1024)} MB, the most one file may be`;

      return { kind: "skipped", reason, shown: `Not downloaded: ${reason}.` };
    }
    const bytes = result.bytes!;

    if (total + bytes.length > maxTotal) {
      const reason = `the import reached its media limit (${Math.round(maxTotal / 1024 / 1024)} MB); raise it with --max-total-mb to bring the rest`;

      return { kind: "skipped", reason, shown: `Not downloaded: ${reason}.` };
    }
    total += bytes.length;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const folder = plan.datedMediaFolders ? datedFolder(from) : null;
    const directory = folder ? `${plan.mediaDirectory}/${folder}` : plan.mediaDirectory;
    const filename = fileNameFor(mediaFor(url, index)?.url ?? from, result.contentType);
    // Saves run one at a time: saveMedia picks a free name, and the same picture under two names is saved once.
    const write = saving.then(async (): Promise<Fetched> => {
      const twin = byHash.get(sha256);

      if (twin && existingMedia.has(twin.path)) return { kind: "saved", entry: twin, fresh: false };
      const item: MediaItem = await site.saveMedia({ filename, directory, data: bytes }, { origin: "user" });
      const entry = { path: item.path, url: item.url, sha256 };

      byHash.set(sha256, entry);
      existingMedia.add(item.path);
      return { kind: "saved", entry, fresh: true };
    });

    saving = write.catch(() => undefined);
    try {
      return await write;
    } catch (error) {
      const reason = error instanceof Error ? error.message.replace(/\.$/, "") : String(error);

      return { kind: "failed", reason, shown: `${reason}.` };
    }
  };

  const one = async (url: string) => {
    check();
    const recorded = manifest.media[url];

    if (recorded && existingMedia.has(recorded.path)) {
      saved.set(url, recorded.url);
      tally.reused += 1;
      return;
    }
    const candidates = originalCandidates(url, index);
    const ext = extensionOf(candidates[0]!) || extensionOf(url);

    if (ext && !SAVABLE.has(ext)) {
      tally.skipped.push({ url, reason: `.${ext} files can't be added to this site's media library (it takes images, PDFs and MP4 video), so the link still points at the old site. Move the file somewhere permanent before the old site goes away.` });
      return;
    }
    if (dryRun) return;
    const key = candidates[0]!;
    const shared = inflight.has(key);

    if (!shared) inflight.set(key, fetchOriginal(url, candidates));
    const outcome = await inflight.get(key)!;

    if (outcome.kind === "saved") {
      manifest.media[url] = outcome.entry;
      saved.set(url, outcome.entry.url);
      if (outcome.fresh && !shared) tally.saved += 1;
      else tally.reused += 1;
      return;
    }
    failed.set(url, outcome.reason);
    (outcome.kind === "failed" ? tally.failed : tally.skipped).push({ url, reason: outcome.shown });
  };
  const queue = [...wanted.map((entry) => entry.url)];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length && !stopped) {
      const url = queue.shift()!;

      try {
        await one(url);
      } catch (error) {
        if (!isAbort(error)) throw error;
        stopped = true;
        return;
      }
      done += 1;
      progress({ phase: "media", label: dryRun ? "Checking images and files" : "Downloading images and files", done, total: wanted.length });
    }
  });

  await Promise.all(workers);
  if (options.signal?.aborted) stopped = true;

  // 3. Entries. Nothing is started once the run is stopped; what was written stays.
  const kindTotals = { posts: writing.filter((d) => d.item.kind === "post").length, pages: writing.filter((d) => d.item.kind === "page").length };
  const kindDone = { posts: 0, pages: 0 };

  for (const decision of stopped ? [] : decisions) {
    if (options.signal?.aborted) {
      stopped = true;
      break;
    }
    const { item } = decision;

    if (decision.action === "skip") {
      outcomes.push({ item, action: "skipped", path: decision.path, ...(decision.reason ? { reason: decision.reason } : {}), notes: [] });
      continue;
    }
    if (decision.action === "unchanged") {
      outcomes.push({ item, action: "unchanged", path: decision.path, notes: [] });
      continue;
    }
    const notes = [...item.notes];
    let data = replaceDeep(item.data, saved) as Record<string, JsonValue>;
    // The featured image: the first candidate that came across; without one, a required image holds the item back.
    let held: string | null = null;

    for (const field of item.imageFields) {
      const chosen = field.candidates.find((url) => saved.has(url));

      if (chosen) {
        setPath(data, field.field, saved.get(chosen)!);
        if (chosen !== field.candidates[0]) notes.push("Its featured image couldn't be downloaded, so the first image in the text is used instead.");
      } else if (!dryRun) {
        if (field.required) {
          const collection = model.collections.find((c) => c.id === item.collection);

          held = `Its featured image couldn't be brought across (${failed.get(field.candidates[0]!) ?? "it couldn't be downloaded"}), and every ${collection?.singular ?? "entry"} in ${collection?.label ?? "this collection"} needs one.`;
        }
        else {
          setPath(data, field.field, undefined);
          if (field.altField) setPath(data, field.altField, undefined);
          notes.push("Its featured image couldn't be downloaded, so it has none here.");
        }
      }
    }
    if (held) {
      outcomes.push({ item, action: "held-back", reason: held, notes });
      continue;
    }
    for (const [url, reason] of failed) {
      if (item.media.some((ref) => ref.url === url && ref.role === "body")) notes.push(`An image couldn't be brought across (${reason}); its place is marked in the text.`);
    }
    const body = rewriteBody(item.body, saved, failed);

    data = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Record<string, JsonValue>;
    if (dryRun) {
      outcomes.push({ item, action: decision.action === "create" ? "would-create" : "would-update", path: decision.path, notes });
      continue;
    }
    try {
      const key = manifestKey(item.sourceType, item.sourceId);

      if (decision.action === "create") {
        const entry = await site.createEntry({ collection: item.collection, slug: item.slug, data, ...(body ? { body } : {}) }, { origin: "user" });

        manifest.items[key] = { path: entry.path, hash: item.hash, entryHash: entry.hash };
        outcomes.push({ item, action: "created", path: entry.path, notes });
      } else {
        const ops: EditOp[] = Object.entries(data).map(([field, value]) => ({ op: "set", path: [field], value }));

        if (item.body || body) ops.push({ op: "body", value: body });
        const result = await site.updateEntry(decision.path, ops, { origin: "user", ...(decision.baseHash ? { baseHash: decision.baseHash } : {}) });

        for (const refusal of result.refused) notes.push(`One change wasn't made: ${refusal.reason}`);
        manifest.items[key] = { path: result.entry.path, hash: item.hash, entryHash: result.entry.hash };
        outcomes.push({ item, action: "updated", path: result.entry.path, notes });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      outcomes.push({ item, action: "skipped", path: decision.path, reason: `It couldn't be saved: ${reason}`, notes });
    }
    const kind = item.kind === "page" ? "pages" : "posts";

    kindDone[kind] += 1;
    progress({ phase: "entries", label: kind === "posts" ? "Bringing over posts" : "Bringing over pages", done: kindDone[kind], total: kindTotals[kind], kind });
  }

  // 4. Rebuild briefs point at the new media and the entries as written.
  const rebuildMap = new Map(saved);

  const rebuilds = plan.rebuilds.map((rebuild) => {
    const outcome = outcomes.find((entry) => entry.item.path === rebuild.path);
    let text = JSON.stringify({ ...rebuild, path: outcome?.path ?? rebuild.path });

    for (const [from, to] of [...rebuildMap.entries()].sort((a, b) => b[0].length - a[0].length)) text = text.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
    return JSON.parse(text) as typeof rebuild;
  });

  // 5. The import record, and redirect files when asked for.
  if (!dryRun) {
    if (await saveManifest(site, manifest as Manifest, manifestBefore)) files.push(`${IMPORT_DIR}/manifest.json`);
    if (options.writeRedirects) files.push(...(await writeRedirectFiles(site, plan, outcomes, options.redirectFiles ?? "site")));
  }
  progress({ phase: "finish", label: dryRun ? "Plan ready" : stopped ? "Import stopped" : "Import finished" });
  return buildReport({ ...plan, rebuilds }, outcomes, tally, { dryRun, files, mediaUsers: users, stopped });
}

async function writeRedirectFiles(site: SiteService, plan: ImportPlan, outcomes: Outcome[], where: "site" | "import-folder"): Promise<string[]> {
  const imported = new Set(outcomes.filter((outcome) => outcome.action !== "skipped" && outcome.action !== "held-back").map((outcome) => outcome.item.newUrl));
  const redirects = plan.redirects.filter((redirect) => imported.has(redirect.to));

  if (redirects.length === 0) return [];
  const model = await site.model();
  const written: string[] = [];
  const write = async (path: string, text: string) => {
    const current = await site.readFile(path).catch(() => null);

    if (current?.content === text) return;
    await site.writeFile(path, text, { origin: "user", mode: "build" });
    written.push(path);
  };
  const astro = `// Redirects from the WordPress import. Use them in astro.config.*:\n//   import { redirects } from "./${IMPORT_DIR}/redirects.mjs";\n//   export default defineConfig({ redirects, … });\nexport const redirects = ${JSON.stringify(Object.fromEntries(redirects.map((redirect) => [redirect.from, redirect.to])), null, 2)};\n`;

  await write(`${IMPORT_DIR}/redirects.mjs`, astro);
  const publicRoot = model.media.roots.find((root) => root.publicPath === "/")?.dir;
  const netlify = netlifySnippet(redirects);

  if (where === "import-folder") {
    await write(`${IMPORT_DIR}/_redirects`, netlify);
  } else if (publicRoot) {
    const target = `${publicRoot}/_redirects`;
    const existing = await site.readFile(target).catch(() => null);

    // An existing _redirects file is the site's own; ours goes beside the record for a person to merge.
    if (!existing || existing.content.startsWith("# Old WordPress addresses")) await write(target, netlify);
    else await write(`${IMPORT_DIR}/_redirects`, netlify);
  } else {
    await write(`${IMPORT_DIR}/_redirects`, netlify);
  }
  return written;
}
