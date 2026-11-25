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
import { writeRefusal } from "../workspace/policy";
import type { MediaMovePlan, MediaMoveRequest, MediaStoreLocation } from "./contract";
import { addressProblem, normalizePrefix, publicUrlOf } from "./info";
import { md5Hex } from "./s3";
import { getFollowing } from "./net";
import { ADDRESS_TAIL, escapePattern, refusal, StoreNameTaken, trimFound, type MediaStore } from "./store";

export interface MoveContext {
  site: SiteService;
  stores: MediaStore[];
  /** Records a file now kept in a store (the site's media record). */
  recordStored(item: { location: MediaStoreLocation; key: string; url: string; name: string; size: number; type: string; width?: number; height?: number; source?: string; draft?: boolean }): Promise<void>;
  /** All files the site's record knows in a store. */
  storedItems(location: MediaStoreLocation): Promise<Array<{ key: string; url: string; name: string; size: number | null; source?: string }>>;
  /** Saves a new public address for the bucket. */
  saveAddress(location: MediaStoreLocation, publicUrl: string): Promise<void>;
  fetch: typeof fetch;
  /** A hosted install: addresses must be https. */
  hosted?: boolean;
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
  /** Not published yet (new or changed in the working copy). */
  draft?: boolean;
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

/** What may come right before a reference: the start of a line, white space, a quote, a bracket, "=", ">", "|" or a comma. */
const BEFORE_REFERENCE = /[\s"'`([{=>,|]/;
/** An HTML-escaped quote right before a reference (src=&quot;/images/a.png&quot;). */
const ESCAPED_QUOTE_BEFORE = /&(?:quot|#34|#39|apos);$/;

interface Found {
  /** The address as a page means it (JSON's "\/" read as "/"). */
  match: string;
  /** Where it starts in the text, and how long it is there. */
  index: number;
  length: number;
  /** Written with JSON's escaped slashes ("\/images\/a.png"): a replacement is escaped the same way. */
  escapedSlashes: boolean;
}

/** The same pattern with every "/" written as JSON writes it, "\/" (valid as ERE and as JS). */
function escapedSlashPattern(pattern: string): string {
  return pattern.replace(/\//g, "[\\\\]/");
}

/**
 * The references in a text, left to right, each with where it is. A match
 * must start a word — after the start of a line, white space, a quote (or an
 * HTML-escaped one), a bracket, "=", ">", "|" or a comma — otherwise it is part
 * of something longer ("https://partner.com/images/a.png", "/blog/a.png").
 * Also read: a Markdown destination in angle brackets (which may hold spaces)
 * and JSON's escaped slashes.
 */
function referencesIn(text: string, pattern: string): Found[] {
  const out: Found[] = [];
  const plain = new RegExp(pattern, "g");
  const escaped = new RegExp(escapedSlashPattern(pattern), "g");
  const angled = pattern.endsWith(ADDRESS_TAIL) ? new RegExp(`<(${pattern.slice(0, -ADDRESS_TAIL.length)}[^<>]+)>`, "g") : null;
  const starts = (line: string, at: number) => at === 0 || BEFORE_REFERENCE.test(line[at - 1]!) || ESCAPED_QUOTE_BEFORE.test(line.slice(Math.max(0, at - 6), at));
  const clean = (raw: string) => raw.replace(/[\r\t].*$/, "").replace(/&(?:quot|#34|#39|apos);.*$/, "");
  let start = 0;

  // Line by line, as git grep reads: a reference never runs on past the end of its line.
  for (const line of text.split("\n")) {
    const found: Found[] = [];

    for (const hit of line.matchAll(plain)) {
      const at = hit.index ?? 0;
      const match = clean(hit[0]);

      if (match && starts(line, at)) found.push({ match, index: start + at, length: match.length, escapedSlashes: false });
    }
    for (const hit of line.matchAll(escaped)) {
      const at = hit.index ?? 0;
      const raw = clean(hit[0]);

      if (raw && starts(line, at)) found.push({ match: raw.replace(/\\\//g, "/"), index: start + at, length: raw.length, escapedSlashes: true });
    }
    if (angled) {
      for (const hit of line.matchAll(angled)) {
        const at = (hit.index ?? 0) + 1;

        found.push({ match: hit[1]!, index: start + at, length: hit[1]!.length, escapedSlashes: false });
      }
    }
    // Overlaps can't both be references: the earliest, then the longest, wins.
    found.sort((a, b) => a.index - b.index || b.length - a.length);
    let end = -1;

    for (const item of found) {
      if (item.index < end) continue;
      out.push(item);
      end = item.index + item.length;
    }
    start += line.length + 1;
  }
  return out;
}

/** Files that might hold references: the plain pattern and its JSON-escaped form, searched by git grep. */
async function candidateFiles(site: SiteService, pattern: string): Promise<string[]> {
  if (!site.grepText) throw new GalleyError("internal", "This site's files can't be searched, so nothing was moved.");
  const hits = [...(await site.grepText(pattern, { rev: "working" })), ...(await site.grepText(escapedSlashPattern(pattern), { rev: "working" }))];

  return [...new Set(hits.map((hit) => hit.path))].sort();
}

/**
 * What a move to a store would leave in the repository, worked out without
 * changing anything: the same steps the move takes, on the files' text in
 * memory. A file stays when something that uses it won't be updated (the
 * site's code and templates are never changed by a move), and when its
 * address would still appear somewhere after the pages were updated (a form
 * the move doesn't read, a file it doesn't touch). Each comes with every
 * file that would still mention it, so the plan and the result name the same.
 */
async function foresee(site: SiteService, moves: Move[], references: Map<string, Reference[]>): Promise<{ stillMentioned: Array<{ path: string; pages: string[] }>; leftAlone: string[] }> {
  const writable = (await site.model()).writable;
  const pattern = await repositoryPattern(site);
  const byOld = new Map(moves.map((move) => [decodeSafe(move.oldUrl), move]));
  const replace = repositoryReplace(byOld);
  const files = new Set<string>();

  for (const move of moves) for (const reference of references.get(move.oldUrl) ?? []) files.add(reference.path);
  /** Each file the move would update, as it would read afterwards. */
  const after = new Map<string, string>();
  const leftAlone: string[] = [];

  for (const path of files) {
    if (writeRefusal(path, writable, "content")) {
      leftAlone.push(path);
      continue;
    }
    try {
      after.set(path, rewrittenText((await site.readFile(path)).content, pattern, replace));
    } catch {
      // Can't be read now, so it wouldn't be updated: what it uses stays.
    }
  }
  const stillMentioned: Array<{ path: string; pages: string[] }> = [];

  for (const move of moves) {
    const forms = plainForms(move.oldUrl);
    const unchanged = (references.get(move.oldUrl) ?? []).map((reference) => reference.path).filter((path) => !after.has(path));
    // A file the move doesn't update keeps every mention it has; one it updates is read as it would be afterwards.
    const left = [...(await plainMentions(site, move.oldUrl)).keys()].filter((path) => {
      const text = after.get(path);

      return text === undefined || forms.some((form) => text.includes(form));
    });
    const pages = [...new Set([...unchanged, ...left])].sort();

    if (pages.length) stillMentioned.push({ path: move.from, pages });
  }
  return { stillMentioned, leftAlone: leftAlone.sort() };
}

/** For a move out of the repository: the new text for a reference to a file being moved, or null for any other. */
function repositoryReplace(byOld: Map<string, Move>): (match: string) => string | null {
  return (match) => {
    const move = byOld.get(decodeSafe(trimFound(match).split(/[?#]/)[0] ?? ""));

    return move ? swapped(match, move.oldUrl, move.newUrl, true) : null;
  };
}

/** The ways an address may be written in a file: as it is, decoded, and each with JSON's escaped slashes. */
function plainForms(url: string): string[] {
  return [...new Set([url, decodeSafe(url), url.replace(/\//g, "\\/"), decodeSafe(url).replace(/\//g, "\\/")])];
}

async function plainMentions(site: SiteService, url: string): Promise<Map<string, number>> {
  if (!site.grepText) throw new GalleyError("internal", "This site's files can't be searched, so nothing was moved.");
  const counts = new Map<string, number>();

  for (const hit of await site.grepText(plainForms(url).map((form) => escapePattern(form)).join("|"), { rev: "working" })) counts.set(hit.path, (counts.get(hit.path) ?? 0) + 1);
  return counts;
}

/** Every reference `accept` names a file for, by that name: git grep narrows the files, the scan above decides. */
async function scanReferences(site: SiteService, pattern: string, accept: (match: string) => string | null): Promise<Map<string, Reference[]>> {
  const found = new Map<string, Reference[]>();

  for (const path of await candidateFiles(site, pattern)) {
    let text: string;

    try {
      text = (await site.readFile(path)).content;
    } catch {
      continue;
    }
    for (const { match } of referencesIn(text, pattern)) {
      const name = accept(match);

      if (name !== null) found.set(name, [...(found.get(name) ?? []), { path, match }]);
    }
  }
  return found;
}

/** The pattern for the site's own media addresses ("/images/team/ana.webp"), over all its media roots at once. */
async function repositoryPattern(site: SiteService): Promise<string> {
  const media = (await site.model()).media;
  const prefixes = [...new Set(media.roots.map((root) => root.publicPath.replace(/\/+$/, "")))];

  // A root at the top ("/") already covers every other: ERE has no empty alternative.
  return prefixes.includes("") ? `/${ADDRESS_TAIL}` : `(${prefixes.map((prefix) => escapePattern(prefix)).join("|")})/${ADDRESS_TAIL}`;
}

/** Repository addresses of the site's media, found in pages, by the address. */
async function repositoryReferences(site: SiteService, items: MediaItem[]): Promise<Map<string, Reference[]>> {
  const byUrl = new Map(items.map((item) => [decodeSafe(item.url), item.url]));

  return scanReferences(site, await repositoryPattern(site), (match) => byUrl.get(decodeSafe(trimFound(match).split(/[?#]/)[0] ?? "")) ?? null);
}

/** A store's addresses found in pages, by key. */
async function storeReferences(site: SiteService, store: MediaStore): Promise<Map<string, Reference[]>> {
  return scanReferences(site, store.addressPattern(), (match) => store.keyOf(trimFound(match)));
}

/** A file's text with each reference `replace` gives a new text for changed, and nothing else touched. */
function rewrittenText(content: string, pattern: string, replace: (match: string) => string | null): string {
  let text = "";
  let at = 0;

  for (const { match, index, length, escapedSlashes } of referencesIn(content, pattern)) {
    const replaced = replace(match);

    if (replaced === null || replaced === match) continue;
    // Written back the way it was written: JSON's escaped slashes stay escaped.
    const next = escapedSlashes ? replaced.replace(/\//g, "\\/") : replaced;

    text += content.slice(at, index) + next;
    at = index + length;
  }
  return text + content.slice(at);
}

/**
 * Rewrites references file by file: each reference the scan finds is passed to
 * `replace`, and only those it returns a new text for change. Nothing else in
 * the file is touched.
 */
async function rewrite(site: SiteService, paths: Iterable<string>, pattern: string, replace: (match: string) => string | null, onFile?: (done: number) => void): Promise<{ rewritten: Set<string>; leftAlone: Set<string>; failed: Map<string, string> }> {
  const rewritten = new Set<string>();
  const leftAlone = new Set<string>();
  const failed = new Map<string, string>();
  let done = 0;

  for (const path of paths) {
    try {
      const file = await site.readFile(path);
      const text = rewrittenText(file.content, pattern, replace);

      if (text !== file.content) await site.writeFile(path, text, { origin: "user", mode: "content", baseHash: file.hash });
      rewritten.add(path);
    } catch (error) {
      // The site's code and templates are never changed by a move. That is by design, so it isn't a failure.
      if (error instanceof GalleyError && error.code === "forbidden") leftAlone.add(path);
      else failed.set(path, error instanceof Error ? error.message : String(error));
    }
    onFile?.((done += 1));
  }
  return { rewritten, leftAlone, failed };
}

/** Why a file of the site's code or templates keeps the addresses it had. */
const LEFT_ALONE = "it is part of the site's code or templates, not its content, so Galley leaves it as it is";

/** "a, b, c and 2 more". */
function someOf(paths: string[], most = 5): string {
  return paths.length > most ? `${paths.slice(0, most).join(", ")} and ${paths.length - most} more` : paths.join(", ");
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

      moves.push({ from: item.path, oldUrl: item.url, to: key, newUrl: store.urlOf(key), size: item.size, name: item.name, draft: item.status !== "clean" });
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
    // Compared as names, never as patterns: a "*", "?" or "[" in one is just a character.
    const present = new Set(await context.site.listFiles());

    for (const move of moves) if (present.has(move.to)) done += 1;
  }
  const pages = new Set<string>();
  let count = 0;

  for (const move of moves) {
    for (const reference of references.get(request.from === "repository" ? move.oldUrl : move.from) ?? []) {
      pages.add(reference.path);
      count += 1;
    }
  }
  // The move's own steps, without changing anything: what the plan says stays is what will.
  const { stillMentioned, leftAlone } = request.from === "repository" && !request.keepCopies ? await foresee(context.site, moves, references) : { stillMentioned: [], leftAlone: [] };
  return {
    kind: "move",
    from: request.from,
    to: request.to,
    files: moves.length,
    bytes: moves.reduce((sum, move) => sum + move.size, 0),
    ...(request.from === "repository" && moves.some((move) => move.draft) ? { unpublished: moves.filter((move) => move.draft).length } : {}),
    ...(stillMentioned.length ? { stillMentioned } : {}),
    ...(leftAlone.length ? { leftAlone } : {}),
    removes: request.from === "repository" && !request.keepCopies ? moves.length - stillMentioned.length : 0,
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
  const problem = addressProblem(request.publicUrl, "new public address", Boolean(context.hosted));

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
  return { kind: "address", store: request.store, files: 0, bytes: 0, removes: 0, references: count, pages: pages.size, done: 0, problems: [], keepCopies: true, publicUrl: request.publicUrl.replace(/\/+$/, "") };
}

export interface MoveOutcome {
  plan: MediaMovePlan;
  copied: number;
  skipped: number;
  rewrittenPages: number;
  removed: number;
  /** What went wrong: a file that couldn't be copied, a page that couldn't be updated, a copy that couldn't be removed. Empty when the move worked. */
  problems: MediaMovePlan["problems"];
  /** What happened, in a few sentences. */
  summary: string;
  /** Repository files kept although copies weren't, each with the files that still mention it. By design: not a problem. */
  stillMentioned?: Array<{ path: string; pages: string[] }>;
  /** Files of the site's code or templates that use a moved file. Galley leaves them as they are, so they keep the address they had. By design: not a problem. */
  leftAlone?: string[];
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
          await context.recordStored({ location: store.location, key: move.to, url: move.newUrl, name: move.name, size: bytes.byteLength, type: checked.type, source: move.from, draft: Boolean(move.draft), ...(checked.width && checked.height ? { width: checked.width, height: checked.height } : {}) });
          copiedMoves.push(move);
          continue;
        }
        const existing = await store.head(move.to);

        if (existing) {
          // The same name is only "already moved" when it holds the same bytes (the ETag of a single upload is their MD5).
          if (existing.size !== bytes.byteLength || (existing.etag && /^[0-9a-f]{32}$/.test(existing.etag) && existing.etag !== md5Hex(bytes))) {
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
        await context.recordStored({ location: store.location, key: move.to, url: move.newUrl, name: move.name, size: bytes.byteLength, type: checked.type, source: move.from, draft: Boolean(move.draft), ...(checked.width && checked.height ? { width: checked.width, height: checked.height } : {}) });
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

  // 2. Rewrite the references of what was copied — only those, where they are.
  const referencedFrom = new Map<string, Set<string>>();
  const files = new Set<string>();
  const byOld = new Map<string, Move>();

  for (const move of copiedMoves) {
    const list = references.get(request.from === "repository" ? move.oldUrl : move.from) ?? [];

    referencedFrom.set(move.from, new Set(list.map((reference) => reference.path)));
    for (const reference of list) files.add(reference.path);
    byOld.set(request.from === "repository" ? decodeSafe(move.oldUrl) : move.from, move);
  }
  const source = request.from === "repository" ? null : storeOf(context, request.from);
  const pattern = source ? source.addressPattern() : await repositoryPattern(context.site);
  const fromRepository = repositoryReplace(byOld);
  const replace = (match: string): string | null => {
    if (!source) return fromRepository(match);
    const key = source.keyOf(trimFound(match));
    const move = key === null ? undefined : byOld.get(key);

    return move ? fromStore(source, match, move.newUrl) : null;
  };
  const pages = files.size;
  const { rewritten, leftAlone, failed } = await rewrite(context.site, files, pattern, replace, (count) => progress(`Updating pages: ${count} of ${pages}`, 0.65 + 0.25 * (count / Math.max(1, pages))));

  for (const [path, reason] of failed) problems.push({ path, reason: `Couldn't update it, so the files it uses stay where they are: ${reason}` });

  // 3. Remove the repository's copies nothing can still reach (moving to a store, unless copies are kept).
  let removed = 0;
  const stillMentioned: Array<{ path: string; pages: string[] }> = [];

  if (request.from === "repository" && !request.keepCopies) {
    for (const move of copiedMoves) {
      const from = referencedFrom.get(move.from) ?? new Set<string>();
      const unchanged = [...from].filter((path) => !rewritten.has(path));

      // After the rewrite, the old address must appear nowhere: a file Galley didn't update (code or a template it
      // leaves alone, a page that couldn't be saved) or one that mentions it in a form the move doesn't read keeps
      // the file. Every file that still mentions it is named, as the plan named them.
      const left = [...(await plainMentions(context.site, move.oldUrl)).keys()];
      const pages = [...new Set([...unchanged, ...left])].sort();

      if (pages.length) {
        stillMentioned.push({ path: move.from, pages });
        continue;
      }
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
  const mentioning = [...new Set(stillMentioned.flatMap((item) => item.pages))].sort();
  const alone = [...leftAlone].sort();
  const summary =
    `${copied} ${copied === 1 ? "file" : "files"} copied to ${where}${skipped ? ` (${skipped} already there)` : ""}, ${rewritten.size} ${rewritten.size === 1 ? "page" : "pages"} updated` +
    (removed ? `, ${removed} removed from the repository` : "") +
    (stillMentioned.length ? `. ${stillMentioned.length} left in the repository: still mentioned in ${someOf(mentioning)}` : "") +
    (stillMentioned.length && mentioning.some((path) => leftAlone.has(path)) ? ". Galley doesn't change the site's code or templates, so the files they use stay where they are" : "") +
    (request.from !== "repository" && alone.length ? `. ${someOf(alone)} still ${alone.length === 1 ? "points" : "point"} at ${storeOf(context, request.from).name}: Galley doesn't change the site's code or templates, so change ${alone.length === 1 ? "it" : "them"} by hand` : "") +
    (request.from !== "repository" ? `. The files are still in ${storeOf(context, request.from).name}; remove them there once the pages are published` : "") +
    (plan.staying ? `. ${plan.staying.files} ${plan.staying.files === 1 ? "stayed where it was" : "stayed where they were"}: ${plan.staying.reason.replace(/\.$/, "")}` : "") +
    (problems.length ? `. ${problems.length} ${problems.length === 1 ? "problem" : "problems"} — see the list` : "") +
    ". Publish to make it live.";

  return { plan, copied, skipped, rewrittenPages: rewritten.size, removed, problems, summary, ...(stillMentioned.length ? { stillMentioned } : {}), ...(alone.length ? { leftAlone: alone } : {}) };
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
      const response = await getFollowing(context.fetch, url ?? "", { method: "GET", signal: AbortSignal.timeout(20_000) });

      ok = response.ok;
      await response.arrayBuffer().catch(() => undefined);
    } catch {
      ok = false;
    }
    if (!ok) throw new GalleyError("invalid", `${new URL(publicUrl).host} doesn't serve this ${store.location === "bucket" ? "bucket's" : "store's"} files yet (tried ${sample.name}). Nothing was changed.`);
  }
  const references = await storeReferences(context.site, store);
  const files = new Set([...references.values()].flat().map((reference) => reference.path));
  const replace = (match: string): string | null => {
    const trimmed = trimFound(match);
    const next = store.rebase!(trimmed, publicUrl);

    return next ? `${next}${match.slice(trimmed.length)}` : null;
  };
  const { rewritten, leftAlone, failed } = await rewrite(context.site, files, store.addressPattern(), replace, (count) => progress(`Updating pages: ${count} of ${files.size}`, 0.2 + 0.7 * (count / Math.max(1, files.size))));
  // Here a file left alone does stop the change: the new address is saved only once nothing uses the old one.
  const problems = [...[...leftAlone].map((path) => [path, LEFT_ALONE] as const), ...failed].map(([path, reason]) => ({ path, reason: `Couldn't update it: ${reason}` }));

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
