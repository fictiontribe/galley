/**
 * Moving a site's media between the repository and a store, and changing a
 * store's public address — always safe to run again:
 *
 *   to a store     copy each file (a name already there with the same bytes
 *                  counts as done; different bytes is a problem, never an
 *                  overwrite), then rewrite the pages' references to the full
 *                  addresses, then — unless the copies are kept — delete the
 *                  repository's files nothing can still reach. A file used by
 *                  a page Galley can't rewrite (a source template in content
 *                  mode) stays where it is, and the plan says so.
 *   to the repo    download each file into the media folder (same rule for
 *                  names), rewrite references back to site addresses. The
 *                  store's files stay where they are: removing them is a
 *                  separate, deliberate step.
 *   address        check the new address serves the store's files, rewrite
 *                  every reference, then save the new address.
 *
 * Every change to a page is an ordinary pending change: Proof shows it, and
 * it goes live when the person publishes.
 */
import { GalleyError } from "../errors";
import type { MediaItem, SiteService } from "../types";
import { checkUpload, mediaExtension } from "../workspace/media";
import type { MediaMovePlan, MediaMoveRequest, MediaStoreLocation } from "./contract";
import { addressProblem, normalizePrefix, publicUrlOf } from "./info";
import { ADDRESS_TAIL, escapePattern, refusal, StoreNameTaken, trimFound, type MediaStore } from "./store";

export interface MoveContext {
  site: SiteService;
  stores: MediaStore[];
  /** Records a file now kept in a store (the site's media record). */
  recordStored(item: { location: MediaStoreLocation; key: string; url: string; name: string; size: number; type: string; width?: number; height?: number; source?: string }): Promise<void>;
  /** All files the site's record knows in a store. */
  storedItems(location: MediaStoreLocation): Promise<Array<{ key: string; url: string; name: string; size: number | null; source?: string }>>;
  /** Saves a new public address for the bucket. */
  saveAddress(location: MediaStoreLocation, publicUrl: string): Promise<void>;
  fetch: typeof fetch;
  onProgress?: (detail: string, progress: number) => void;
}

interface Reference {
  path: string;
  /** The text found, exactly. */
  match: string;
}

/** One file to move and where it goes. */
interface Move {
  /** Where it is now: a repository path, or a store key. */
  from: string;
  /** The address pages use now. */
  oldUrl: string;
  /** Where it goes: a store key, or a repository path. */
  to: string;
  /** The address pages will use. */
  newUrl: string;
  size: number;
  name: string;
}

const decodeSafe = (url: string) => {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
};

function storeOf(context: MoveContext, location: MediaStoreLocation): MediaStore {
  const store = context.stores.find((candidate) => candidate.location === location);

  if (!store) throw new GalleyError("unconfigured", location === "bucket" ? "The site isn't connected to a bucket." : "The site isn't connected to Cloudflare Images.");
  return store;
}

/** Repository addresses ("/images/team/ana.webp") of the site's media, found in pages. */
async function repositoryReferences(site: SiteService, items: MediaItem[]): Promise<Map<string, Reference[]>> {
  const media = (await site.model()).media;
  const byUrl = new Map(items.map((item) => [decodeSafe(item.url), item.url]));
  const found = new Map<string, Reference[]>();

  if (!site.grepText) return found;
  const prefixes = [...new Set(media.roots.map((root) => root.publicPath.replace(/\/+$/, "")))];
  // One search for all the roots, so an address under two of them ("/" and "/images") is found once.
  // A root at the top ("/") already covers every other: ERE has no empty alternative.
  const pattern = prefixes.includes("") ? `/${ADDRESS_TAIL}` : `(${prefixes.map((prefix) => escapePattern(prefix)).join("|")})/${ADDRESS_TAIL}`;

  for (const hit of await site.grepText(pattern, { rev: "working" })) {
    const url = byUrl.get(decodeSafe(trimFound(hit.match).split(/[?#]/)[0] ?? ""));

    if (!url) continue;
    found.set(url, [...(found.get(url) ?? []), hit]);
  }
  return found;
}

/** A store's addresses found in pages, by key. */
async function storeReferences(site: SiteService, store: MediaStore): Promise<Map<string, Reference[]>> {
  const found = new Map<string, Reference[]>();

  if (!site.grepText) return found;
  for (const hit of await site.grepText(store.addressPattern(), { rev: "working" })) {
    const key = store.keyOf(trimFound(hit.match));

    if (key !== null) found.set(key, [...(found.get(key) ?? []), hit]);
  }
  return found;
}

/** The rewrite of every reference, file by file: old address → new, keeping whatever followed it (?query, #hash, punctuation). */
async function rewrite(site: SiteService, replacements: Map<string, Array<{ match: string; next: string }>>, onFile?: (done: number) => void): Promise<{ rewritten: Set<string>; refused: Map<string, string> }> {
  const rewritten = new Set<string>();
  const refused = new Map<string, string>();
  let done = 0;

  for (const [path, swaps] of replacements) {
    try {
      const file = await site.readFile(path);
      let text = file.content;

      // Longest first, so a shorter address never cuts into a longer one.
      for (const swap of [...swaps].sort((a, b) => b.match.length - a.match.length)) text = text.split(swap.match).join(swap.next);
      if (text !== file.content) await site.writeFile(path, text, { origin: "user", mode: "content", baseHash: file.hash });
      rewritten.add(path);
    } catch (error) {
      refused.set(path, error instanceof GalleyError && error.code === "forbidden" ? "it is part of the site's code or templates, not its content, so Galley leaves it as it is" : error instanceof Error ? error.message : String(error));
    }
    onFile?.((done += 1));
  }
  return { rewritten, refused };
}

/** `match` with its address part swapped, keeping a ?query or #hash and trailing punctuation. */
function swapped(match: string, oldUrl: string, newUrl: string, decoded = false): string {
  const trimmed = trimFound(match);
  const tail = match.slice(trimmed.length);
  const at = trimmed.search(/[?#]/);
  const address = at === -1 ? trimmed : trimmed.slice(0, at);
  const rest = at === -1 ? "" : trimmed.slice(at);

  if (address !== oldUrl && !(decoded && decodeSafe(address) === decodeSafe(oldUrl))) return match;
  return `${newUrl}${rest}${tail}`;
}

/**
 * A store address found in a page, pointed back at the repository: any form
 * of it (another variant, a resizing option) becomes the plain site address;
 * a bucket address keeps its ?query or #hash.
 */
function fromStore(store: MediaStore, match: string, newUrl: string): string {
  const trimmed = trimFound(match);
  const tail = match.slice(trimmed.length);
  const at = trimmed.search(/[?#]/);
  const rest = store.abilities.address === "key" && at !== -1 ? trimmed.slice(at) : "";

  return `${newUrl}${rest}${tail}`;
}

/** The plan and the moves for a request, read-only. */
async function prepare(context: MoveContext, request: Extract<MediaMoveRequest, { kind: "move" }>) {
  const { site } = context;
  const problems: MediaMovePlan["problems"] = [];
  const moves: Move[] = [];
  let references: Map<string, Reference[]>;
  let done = 0;
  let staying: MediaMovePlan["staying"];

  if (request.from === request.to) throw new GalleyError("invalid", "The files are already there.");
  if (request.from === "repository") {
    const store = storeOf(context, request.to as MediaStoreLocation);
    const media = (await site.model()).media;
    const items = (await site.listMedia()).filter((item) => !item.location && item.status !== "deleted");
    let refused = 0;
    let reason = "";

    references = await repositoryReferences(site, items);
    for (const item of items) {
      const root = media.roots.find((candidate) => item.path === candidate.dir || item.path.startsWith(`${candidate.dir.replace(/\/+$/, "")}/`));
      const relative = root ? item.path.slice(root.dir.replace(/\/+$/, "").length + 1) : item.name;
      const why = refusal(store, { type: item.type, size: item.size, ...(item.width && item.height ? { width: item.width, height: item.height } : {}) });

      if (why) {
        refused += 1;
        reason = why;
        continue;
      }
      const key = store.keyFor(relative);

      moves.push({ from: item.path, oldUrl: item.url, to: key, newUrl: store.urlOf(key), size: item.size, name: item.name });
    }
    if (refused) staying = { files: refused, reason: `${reason} Those stay in the repository.` };
  } else {
    const store = storeOf(context, request.from);

    if (request.to !== "repository") throw new GalleyError("invalid", "Move files to the repository first, then to the other store.");
    const media = (await site.model()).media;
    const prefix = store.location === "bucket" ? normalizePrefix(media.storage?.prefix) : "";

    references = await storeReferences(site, store);
    for (const item of await context.storedItems(store.location)) {
      // Back where it came from, when it was moved from the repository; else into the media folder,
      // under its key — or, for a store that names things itself (Cloudflare Images), under the file's own name.
      const root = item.source ? media.roots.find((candidate) => item.source!.startsWith(`${candidate.dir.replace(/\/+$/, "")}/`)) : undefined;

      if (item.source && root) {
        const within = item.source.slice(root.dir.replace(/\/+$/, "").length + 1);

        moves.push({ from: item.key, oldUrl: item.url, to: item.source, newUrl: publicUrlOf(root.publicPath, within), size: item.size ?? 0, name: item.name });
        continue;
      }
      const relative = store.abilities.naming === "service" ? item.name : prefix && item.key.startsWith(prefix) ? item.key.slice(prefix.length) : item.key;
      const path = `${media.dir.replace(/\/+$/, "")}/${relative}`;

      if (!mediaExtension(path)) {
        problems.push({ path: `${store.location}:${item.key}`, reason: "It has no file type in its name, so it can't be kept in the repository as it is." });
        continue;
      }
      moves.push({ from: item.key, oldUrl: item.url, to: path, newUrl: publicUrlOf(media.publicPath, relative), size: item.size ?? 0, name: item.name });
    }
  }
  return { moves, references, problems, done, staying };
}

export async function planMove(context: MoveContext, request: MediaMoveRequest): Promise<MediaMovePlan> {
  if (request.kind === "address") return planAddress(context, request);
  const { moves, references, problems, staying } = await prepare(context, request);
  let done = 0;

  // Already there from an earlier run.
  if (request.from === "repository") {
    const store = storeOf(context, request.to as MediaStoreLocation);
    const stored = await context.storedItems(store.location);
    const known = new Set(store.abilities.naming === "service" ? stored.map((item) => item.source ?? "") : stored.map((item) => item.key));

    done = moves.filter((move) => known.has(store.abilities.naming === "service" ? move.from : move.to)).length;
  } else {
    for (const move of moves) if ((await context.site.listFiles({ glob: move.to, limit: 1 })).length) done += 1;
  }
  const pages = new Set<string>();
  let count = 0;

  for (const move of moves) {
    for (const reference of references.get(request.from === "repository" ? move.oldUrl : move.from) ?? []) {
      pages.add(reference.path);
      count += 1;
    }
  }
  return {
    kind: "move",
    from: request.from,
    to: request.to,
    files: moves.length,
    bytes: moves.reduce((sum, move) => sum + move.size, 0),
    references: count,
    pages: pages.size,
    done,
    problems,
    ...(staying ? { staying } : {}),
    keepCopies: request.from === "repository" ? Boolean(request.keepCopies) : true,
  };
}

async function planAddress(context: MoveContext, request: Extract<MediaMoveRequest, { kind: "address" }>): Promise<MediaMovePlan> {
  const store = storeOf(context, request.store);
  const problem = addressProblem(request.publicUrl, "new public address");

  if (problem) throw new GalleyError("invalid", problem);
  if (!store.rebase) throw new GalleyError("invalid", `${store.name}'s addresses can't be changed here.`);
  const references = await storeReferences(context.site, store);
  const pages = new Set<string>();
  let count = 0;

  for (const list of references.values()) {
    for (const reference of list) {
      pages.add(reference.path);
      count += 1;
    }
  }
  return { kind: "address", store: request.store, files: 0, bytes: 0, references: count, pages: pages.size, done: 0, problems: [], keepCopies: true, publicUrl: request.publicUrl.replace(/\/+$/, "") };
}

export interface MoveOutcome {
  plan: MediaMovePlan;
  copied: number;
  skipped: number;
  rewrittenPages: number;
  removed: number;
  problems: MediaMovePlan["problems"];
  summary: string;
}

export async function runMove(context: MoveContext, request: MediaMoveRequest): Promise<MoveOutcome> {
  if (request.kind === "address") return runAddress(context, request);
  const plan = await planMove(context, request);
  const { moves, references, problems } = await prepare(context, request);
  const progress = context.onProgress ?? (() => undefined);
  const copiedMoves: Move[] = [];
  let copied = 0;
  let skipped = 0;

  // 1. Copy.
  for (const [index, move] of moves.entries()) {
    progress(`Copying ${index + 1} of ${moves.length}: ${move.name}`, 0.05 + 0.6 * (index / Math.max(1, moves.length)));
    try {
      if (request.from === "repository") {
        const store = storeOf(context, request.to as MediaStoreLocation);
        const bytes = new Uint8Array(Buffer.from(await readRepoBytes(context.site, move.from)));
        const checked = checkUpload({ filename: move.name, data: bytes });

        if (store.abilities.naming === "service") {
          // The store names it: an earlier run's copy is found by where it came from.
          const earlier = (await context.storedItems(store.location)).find((item) => item.source === move.from);

          if (earlier) {
            move.to = earlier.key;
            move.newUrl = earlier.url;
            skipped += 1;
          } else {
            const stored = await store.put({ name: move.name, data: bytes, type: checked.type, ...(checked.width && checked.height ? { width: checked.width, height: checked.height } : {}) });

            move.to = stored.key;
            move.newUrl = stored.url;
            copied += 1;
          }
          await context.recordStored({ location: store.location, key: move.to, url: move.newUrl, name: move.name, size: bytes.byteLength, type: checked.type, source: move.from, ...(checked.width && checked.height ? { width: checked.width, height: checked.height } : {}) });
          copiedMoves.push(move);
          continue;
        }
        const existing = await store.head(move.to);

        if (existing) {
          if (existing.size !== bytes.byteLength) {
            problems.push({ path: move.from, reason: `A different file is already in ${store.name} as “${move.to}”, so this one stays in the repository.` });
            continue;
          }
          skipped += 1;
        } else {
          try {
            await store.put({ name: move.to, data: bytes, type: checked.type, ...(checked.width && checked.height ? { width: checked.width, height: checked.height } : {}) });
            copied += 1;
          } catch (error) {
            if (!(error instanceof StoreNameTaken)) throw error;
            skipped += 1;
          }
        }
        await context.recordStored({ location: store.location, key: move.to, url: move.newUrl, name: move.name, size: bytes.byteLength, type: checked.type, source: move.from, ...(checked.width && checked.height ? { width: checked.width, height: checked.height } : {}) });
      } else {
        const store = storeOf(context, request.from);
        const bytes = await store.get(move.from);

        if (!bytes) {
          problems.push({ path: `${store.location}:${move.from}`, reason: "It isn't in the store any more." });
          continue;
        }
        const there = await readRepoBytes(context.site, move.to).catch(() => null);

        if (there) {
          if (!Buffer.from(there).equals(Buffer.from(bytes))) {
            problems.push({ path: move.to, reason: "A different file already has that name in the repository, so this one stays where it is." });
            continue;
          }
          skipped += 1;
        } else {
          await context.site.writeFile(move.to, bytes, { origin: "user", mode: "content" });
          copied += 1;
        }
      }
      copiedMoves.push(move);
    } catch (error) {
      problems.push({ path: move.from, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  // 2. Rewrite the references of what was copied.
  const swaps = new Map<string, Array<{ match: string; next: string }>>();
  const referencedFrom = new Map<string, Set<string>>();

  for (const move of copiedMoves) {
    const list = references.get(request.from === "repository" ? move.oldUrl : move.from) ?? [];

    referencedFrom.set(move.from, new Set(list.map((reference) => reference.path)));
    for (const reference of list) {
      const next = request.from === "repository" ? swapped(reference.match, move.oldUrl, move.newUrl, true) : fromStore(storeOf(context, request.from), reference.match, move.newUrl);

      swaps.set(reference.path, [...(swaps.get(reference.path) ?? []), { match: reference.match, next }]);
    }
  }
  const pages = swaps.size;
  const { rewritten, refused } = await rewrite(context.site, swaps, (count) => progress(`Updating pages: ${count} of ${pages}`, 0.65 + 0.25 * (count / Math.max(1, pages))));

  for (const [path, reason] of refused) problems.push({ path, reason: `Couldn't update it, so the files it uses stay where they are: ${reason}` });

  // 3. Remove the repository's copies nothing can still reach (moving to a store, unless copies are kept).
  let removed = 0;

  if (request.from === "repository" && !request.keepCopies) {
    for (const move of copiedMoves) {
      const from = referencedFrom.get(move.from) ?? new Set<string>();

      if ([...from].some((path) => !rewritten.has(path))) continue;
      try {
        await context.site.deleteFile(move.from, { origin: "user", mode: "content" });
        removed += 1;
      } catch (error) {
        problems.push({ path: move.from, reason: `Copied, but not removed from the repository: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
  progress("Done", 1);
  const where = request.to === "repository" ? "the repository" : storeOf(context, request.to as MediaStoreLocation).name;
  const summary =
    `${copied} ${copied === 1 ? "file" : "files"} copied to ${where}${skipped ? ` (${skipped} already there)` : ""}, ${rewritten.size} ${rewritten.size === 1 ? "page" : "pages"} updated` +
    (removed ? `, ${removed} removed from the repository` : "") +
    (request.from !== "repository" ? `. The files are still in ${storeOf(context, request.from).name}; remove them there once the pages are published` : "") +
    (plan.staying ? `. ${plan.staying.files} stayed where they were: ${plan.staying.reason}` : "") +
    (problems.length ? `. ${problems.length} ${problems.length === 1 ? "problem" : "problems"} — see the list` : "") +
    ". Publish to make it live.";

  return { plan, copied, skipped, rewrittenPages: rewritten.size, removed, problems, summary };
}

async function readRepoBytes(site: SiteService, path: string): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");

  return new Uint8Array(await readFile(site.resolvePath(path)));
}

async function runAddress(context: MoveContext, request: Extract<MediaMoveRequest, { kind: "address" }>): Promise<MoveOutcome> {
  const plan = await planAddress(context, request);
  const store = storeOf(context, request.store);
  const publicUrl = plan.publicUrl!;
  const progress = context.onProgress ?? (() => undefined);
  const sample = (await context.storedItems(store.location))[0];

  // The new address has to serve the store's files before any page points at it.
  if (sample) {
    const url = store.rebase!(sample.url, publicUrl);
    let ok = false;

    progress("Checking the new address serves the files…", 0.1);
    try {
      const response = await context.fetch(url ?? "", { method: "GET", redirect: "follow", signal: AbortSignal.timeout(20_000) });

      ok = response.ok;
      await response.arrayBuffer().catch(() => undefined);
    } catch {
      ok = false;
    }
    if (!ok) throw new GalleyError("invalid", `${new URL(publicUrl).host} doesn't serve this ${store.location === "bucket" ? "bucket's" : "store's"} files yet (tried ${sample.name}). Nothing was changed.`);
  }
  const references = await storeReferences(context.site, store);
  const swaps = new Map<string, Array<{ match: string; next: string }>>();

  for (const list of references.values()) {
    for (const reference of list) {
      const trimmed = trimFound(reference.match);
      const next = store.rebase!(trimmed, publicUrl);

      if (next) swaps.set(reference.path, [...(swaps.get(reference.path) ?? []), { match: reference.match, next: `${next}${reference.match.slice(trimmed.length)}` }]);
    }
  }
  const { rewritten, refused } = await rewrite(context.site, swaps, (count) => progress(`Updating pages: ${count} of ${swaps.size}`, 0.2 + 0.7 * (count / Math.max(1, swaps.size))));
  const problems = [...refused].map(([path, reason]) => ({ path, reason: `Couldn't update it: ${reason}` }));

  if (!problems.length) await context.saveAddress(store.location, publicUrl);
  progress("Done", 1);
  return {
    plan,
    copied: 0,
    skipped: 0,
    rewrittenPages: rewritten.size,
    removed: 0,
    problems,
    summary: problems.length
      ? `${rewritten.size} pages updated, ${problems.length} couldn't be: the address in use stays the old one until they are. Run it again after fixing them.`
      : `${rewritten.size} ${rewritten.size === 1 ? "page" : "pages"} updated; new files are loaded from ${publicUrl}. Publish to make it live.`,
  };
}
