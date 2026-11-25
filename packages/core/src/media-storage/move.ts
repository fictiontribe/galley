/**
 * Moving a site's media between the repository and a store, and changing a
 * store's public address — always safe to run again:
 *
 *   to a store     copy each file (a name already there with the same bytes
 *                  counts as done; different bytes is a problem, never an
 *                  overwrite), then rewrite the pages' references to the full
 *                  addresses, then — unless the copies are kept — delete the
 *                  repository's files the site no longer uses. A file stays
 *                  only while something the site is built from, and that the
 *                  move can't update, still uses it (see `standingsOf`), and
 *                  the plan says so before anything happens.
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
import { posix } from "node:path";
import picomatch from "picomatch";
import { builtFromMatcher } from "../content/detect/built-from";
import { GalleyError } from "../errors";
import { callerMay } from "../install/caller";
import { BUILD_MODE_LEVEL } from "../install/route-access";
import type { AgentMode, MediaItem, SiteService } from "../types";
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

/**
 * How a file that names one of the site's pictures stands to a move:
 *
 *   content   the move updates it, as a content write (a page, a data file
 *             content mode may write).
 *   template  one of Galley's own page templates, named in the site's
 *             settings. A page made from it later would carry the address
 *             it holds, so the move updates it too: as a build-mode write,
 *             made only when the site allows build mode and the person
 *             whose move this is may use it. Otherwise it is left, and
 *             keeps what it uses.
 *   built     something the site is built from that the move doesn't
 *             update: its code, a data file content mode may not write.
 *             It keeps what it uses.
 *   beside    anything else: a README, a record, a script outside the
 *             site's source. The built site doesn't read it, so it keeps
 *             nothing and isn't changed; the plan lists it.
 *
 * What a site is built from is the adapter's to say (and the settings'
 * `build.sources`); with no word from the adapter every file counts. A file
 * outside that list still counts as built when a file inside it reads it
 * (see `readersOf`): a page that imports a data file kept beside the source
 * folder is built from that file too, whatever the list says.
 */
type Standing = "content" | "template" | "built" | "beside";

interface Standings {
  /** How the file stands. For a file outside the list this looks for a file inside it that reads it, once. */
  of(path: string): Promise<Standing>;
  /** The mode a write to this file takes, or null when the move doesn't change it. */
  writes(path: string): AgentMode | null;
  /** The files that make `path`, a file outside the list, count as built: those that read it. Known once `of` has answered. */
  readBy(path: string): string[];
}

async function standingsOf(site: SiteService): Promise<Standings> {
  const model = await site.model();
  const templates = new Set((model.templates ?? []).map((template) => template.file));
  const built = builtFromMatcher(model);
  const mayBuild = model.ai.allowBuild && callerMay(BUILD_MODE_LEVEL);
  const written = (path: string): "content" | "template" | null => (!writeRefusal(path, model.writable, "content") ? "content" : templates.has(path) ? "template" : null);
  const readers = new Map<string, string[]>();
  let reads: Promise<(path: string) => string[]> | null = null;

  async function readersOf(path: string): Promise<string[]> {
    const known = readers.get(path);

    if (known) return known;
    // Looked for once, and only when a file outside the list names something being moved.
    const found = (await (reads ??= readsFromInside(site, built)))(path);

    readers.set(path, found);
    return found;
  }

  return {
    async of(path) {
      return written(path) ?? (built(path) || (await readersOf(path)).length ? "built" : "beside");
    },
    writes(path) {
      const standing = written(path);

      if (standing === "content") return "content";
      return standing === "template" && mayBuild && !writeRefusal(path, model.writable, "build") ? "build" : null;
    },
    readBy: (path) => readers.get(path) ?? [],
  };
}

/** Without its last extension: "data/team.json" → "data/team". */
const extensionless = (path: string) => path.replace(/\.[^./]+$/, "");
/** The extensions a module can be asked for by, whichever it has (a .ts file as .js). */
const MODULE_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"];

/**
 * Which files inside what the site is built from read a file outside it:
 * each holds a quoted relative path that leads to it. That is how an import,
 * `new URL("…", import.meta.url)`, a file the code opens and
 * `import.meta.glob` are written, so each is found; so is a path in a
 * comment, which only keeps more. The path may leave off the extension, name
 * a module by another module extension, name the folder of an index file,
 * or be a glob; what follows a "?" or "#" says how to load the file, not
 * which.
 *
 * One step only, and only a path written out from the file it is in. Not
 * followed: an alias ("@/data/…", a tsconfig path), a path from the site
 * root or put together at run time, and a file reached through another file
 * outside the list. A site that builds from one of those says so in
 * `build.sources`.
 *
 * One search of the site's files for quoted paths that start "./" or "../";
 * the answer for a file is then a lookup.
 */
async function readsFromInside(site: SiteService, built: (path: string) => boolean): Promise<(path: string) => string[]> {
  if (!site.grepText) throw new GalleyError("internal", "This site's files can't be searched, so nothing was moved.");
  /** Where the paths written inside the list lead, outside it: each with the files that hold it. */
  const led = new Map<string, Set<string>>();
  const globs: Array<{ matches: (path: string) => boolean; reader: string }> = [];

  for (const hit of await site.grepText("[\"'`]\\.\\.?/[^\"'`]+[\"'`]", { rev: "working" })) {
    if (!built(hit.path)) continue;
    const written = hit.match.slice(1, -1);
    const glob = written.includes("*");
    // From the site root; a path that leaves the site, or is the site, names no file of it.
    const to = posix.normalize(posix.join(posix.dirname(hit.path), glob ? written : written.replace(/[?#].*$/, ""))).replace(/\/+$/, "");

    if (to === "." || to === ".." || to.startsWith("../")) continue;
    if (glob) globs.push({ matches: picomatch(to, { dot: true }), reader: hit.path });
    else if (!built(to)) led.set(to, (led.get(to) ?? new Set()).add(hit.path));
  }
  return (path) => {
    const stem = extensionless(path);
    const module = MODULE_EXTENSIONS.some((extension) => path.endsWith(extension));
    const names = [path, stem, ...(module ? MODULE_EXTENSIONS.map((extension) => `${stem}${extension}`) : []), ...(posix.basename(stem) === "index" && posix.dirname(path) !== "." ? [posix.dirname(path)] : [])];
    const found = new Set<string>();

    for (const name of names) for (const reader of led.get(name) ?? []) found.add(reader);
    for (const glob of globs) if (glob.matches(path)) found.add(glob.reader);
    return [...found].sort();
  };
}

/** Files that might hold references: the plain pattern and its JSON-escaped form, searched by git grep. */
async function candidateFiles(site: SiteService, pattern: string): Promise<string[]> {
  if (!site.grepText) throw new GalleyError("internal", "This site's files can't be searched, so nothing was moved.");
  const hits = [...(await site.grepText(pattern, { rev: "working" })), ...(await site.grepText(escapedSlashPattern(pattern), { rev: "working" }))];

  return [...new Set(hits.map((hit) => hit.path))].sort();
}

/**
 * What a move to a store would do to the files that name what it moves,
 * worked out without changing anything: the same steps the move takes, on
 * the files' text in memory. A repository file stays when something that
 * counts (see `standingsOf`) would still name it afterwards: a file the move
 * doesn't update, or one it updates that holds the address in a form the
 * move doesn't read. Each comes with every such file, so the plan and the
 * result name the same.
 */
async function foresee(site: SiteService, moves: Move[], references: Map<string, Reference[]>): Promise<Foreseen> {
  const standings = await standingsOf(site);
  const pattern = await repositoryPattern(site);
  const byOld = new Map(moves.map((move) => [decodeSafe(move.oldUrl), move]));
  const replace = repositoryReplace(byOld);
  const files = new Set<string>();

  for (const move of moves) for (const reference of references.get(move.oldUrl) ?? []) files.add(reference.path);
  /** Each file the move would update, as it would read afterwards. */
  const after = new Map<string, string>();
  const leftAlone = new Set<string>();
  const alsoMentioned = new Set<string>();
  const updated = { pages: new Set<string>(), templates: new Set<string>(), places: 0 };

  for (const path of files) {
    const mode = standings.writes(path);

    if (!mode) {
      ((await standings.of(path)) === "beside" ? alsoMentioned : leftAlone).add(path);
      continue;
    }
    try {
      const before = (await site.readFile(path)).content;

      after.set(path, rewrittenText(before, pattern, replace));
      (mode === "build" ? updated.templates : updated.pages).add(path);
      updated.places += referencesIn(before, pattern).filter(({ match }) => replace(match) !== null).length;
    } catch {
      // Can't be read now, so it wouldn't be updated: what it uses stays.
      leftAlone.add(path);
    }
  }
  const stillMentioned: Array<{ path: string; pages: string[] }> = [];

  for (const move of moves) {
    const forms = plainForms(move.oldUrl);
    const keeping = new Set<string>();

    for (const { path } of references.get(move.oldUrl) ?? []) if (!after.has(path) && (await standings.of(path)) !== "beside") keeping.add(path);
    // A file the move doesn't update keeps every mention it has; one it updates is read as it would be afterwards.
    for (const path of (await plainMentions(site, move.oldUrl)).keys()) {
      const text = after.get(path);

      if (text !== undefined) {
        if (forms.some((form) => text.includes(form))) keeping.add(path);
      } else if ((await standings.of(path)) !== "beside") keeping.add(path);
      else alsoMentioned.add(path);
    }
    if (keeping.size) stillMentioned.push({ path: move.from, pages: [...keeping].sort() });
  }
  return {
    stillMentioned,
    leftAlone: [...leftAlone].sort(),
    alsoMentioned: [...alsoMentioned].sort(),
    readBy: readersAmong(standings, stillMentioned),
    pages: updated.pages.size,
    templates: updated.templates.size,
    places: updated.places,
  };
}

/** For each file that keeps a copy and is outside what the site says it is built from: the files that read it. */
function readersAmong(standings: Standings, stillMentioned: Array<{ path: string; pages: string[] }>): Record<string, string[]> {
  const readBy: Record<string, string[]> = {};

  for (const path of new Set(stillMentioned.flatMap((item) => item.pages))) {
    const readers = standings.readBy(path);

    if (readers.length) readBy[path] = readers;
  }
  return readBy;
}

interface Foreseen {
  stillMentioned: Array<{ path: string; pages: string[] }>;
  /** Files that count and that the move doesn't change: they keep what they use. */
  leftAlone: string[];
  /** Files beside the site as built that name something being moved: not changed, and they keep nothing. */
  alsoMentioned: string[];
  /** Of the files that keep a copy, those outside what the site says it is built from, each with the files that read it. */
  readBy: Record<string, string[]>;
  /** What the move updates: pages, Galley's page templates, and the places in both. */
  pages: number;
  templates: number;
  places: number;
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
 * the file is touched. A page is a content write; one of Galley's page
 * templates is a build-mode write, made only when `standingsOf` allows it;
 * no other file is written.
 */
async function rewrite(
  site: SiteService,
  standings: Standings,
  paths: Iterable<string>,
  pattern: string,
  replace: (match: string) => string | null,
  onFile?: (done: number) => void
): Promise<{ rewritten: Set<string>; templates: Set<string>; leftAlone: Set<string>; beside: Set<string>; failed: Map<string, string> }> {
  const rewritten = new Set<string>();
  const templates = new Set<string>();
  const leftAlone = new Set<string>();
  const beside = new Set<string>();
  const failed = new Map<string, string>();
  let done = 0;

  for (const path of paths) {
    const mode = standings.writes(path);

    if (!mode) ((await standings.of(path)) === "beside" ? beside : leftAlone).add(path);
    else {
      try {
        const file = await site.readFile(path);
        const text = rewrittenText(file.content, pattern, replace);

        if (text !== file.content) await site.writeFile(path, text, { origin: "user", mode, baseHash: file.hash });
        rewritten.add(path);
        if (mode === "build") templates.add(path);
      } catch (error) {
        // Refused where the bytes go (the settings file, a level this person hasn't): left as it is. By design, so not a failure.
        if (error instanceof GalleyError && error.code === "forbidden") leftAlone.add(path);
        else failed.set(path, error instanceof Error ? error.message : String(error));
      }
    }
    onFile?.((done += 1));
  }
  return { rewritten, templates, leftAlone, beside, failed };
}

/** Why a file the site is built from keeps the addresses it had. */
const LEFT_ALONE = "the site is built from it and a move doesn't change the site's code, so Galley leaves it as it is";

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
  // The move's own steps, without changing anything: what the plan says is updated, and what it says stays, is what will.
  const foreseen = request.from === "repository" ? await foresee(context.site, moves, references) : null;
  const stillMentioned = foreseen && !request.keepCopies ? foreseen.stillMentioned : [];
  const leftAlone = foreseen && !request.keepCopies ? foreseen.leftAlone : [];
  const alsoMentioned = foreseen && !request.keepCopies ? foreseen.alsoMentioned : [];
  const readBy = foreseen && !request.keepCopies ? foreseen.readBy : {};
  let pages = foreseen?.pages ?? 0;
  let templates = foreseen?.templates ?? 0;
  let count = foreseen?.places ?? 0;

  if (!foreseen) {
    // Back to the repository: every file that points at the store and that the move updates.
    const standings = await standingsOf(context.site);
    const updated = { pages: new Set<string>(), templates: new Set<string>() };

    for (const move of moves) {
      for (const reference of references.get(move.from) ?? []) {
        const mode = standings.writes(reference.path);

        if (!mode) continue;
        (mode === "build" ? updated.templates : updated.pages).add(reference.path);
        count += 1;
      }
    }
    pages = updated.pages.size;
    templates = updated.templates.size;
  }
  return {
    kind: "move",
    from: request.from,
    to: request.to,
    files: moves.length,
    bytes: moves.reduce((sum, move) => sum + move.size, 0),
    ...(request.from === "repository" && moves.some((move) => move.draft) ? { unpublished: moves.filter((move) => move.draft).length } : {}),
    ...(stillMentioned.length ? { stillMentioned } : {}),
    ...(leftAlone.length ? { leftAlone } : {}),
    ...(alsoMentioned.length ? { alsoMentioned } : {}),
    ...(Object.keys(readBy).length ? { readBy } : {}),
    removes: request.from === "repository" && !request.keepCopies ? moves.length - stillMentioned.length : 0,
    references: count,
    pages,
    ...(templates ? { templates } : {}),
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
  /** Files the site is built from that use a moved file and that a move doesn't change (its code; a page template when build mode isn't allowed). They keep the address they had. By design: not a problem. */
  leftAlone?: string[];
  /** Galley's page templates the move updated, as build-mode writes. */
  rewrittenTemplates?: number;
  /** Files beside the site as built that name a moved file: not changed, and they kept nothing. */
  alsoMentioned?: string[];
  /** For a file that kept one and is outside what the site says it is built from: the files that read it. */
  readBy?: Record<string, string[]>;
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
  const standings = await standingsOf(context.site);
  const { rewritten, templates, leftAlone, beside, failed } = await rewrite(context.site, standings, files, pattern, replace, (count) => progress(`Updating pages: ${count} of ${pages}`, 0.65 + 0.25 * (count / Math.max(1, pages))));

  for (const [path, reason] of failed) problems.push({ path, reason: `Couldn't update it, so the files it uses stay where they are: ${reason}` });

  // 3. Remove the repository's copies nothing can still reach (moving to a store, unless copies are kept).
  let removed = 0;
  const stillMentioned: Array<{ path: string; pages: string[] }> = [];

  if (request.from === "repository" && !request.keepCopies) {
    for (const move of copiedMoves) {
      const from = referencedFrom.get(move.from) ?? new Set<string>();
      const keeping = new Set([...from].filter((path) => !rewritten.has(path) && !beside.has(path)));

      // After the rewrite, nothing that counts may still name the old address: a file the site is built from that
      // Galley didn't update (its code, a template it left alone, a page that couldn't be saved), or one it did
      // update that holds the address in a form the move doesn't read, keeps the file. A file beside the site as
      // built (a README, a record, a script outside its source) keeps nothing. Every file that keeps one is named,
      // as the plan named them.
      for (const path of (await plainMentions(context.site, move.oldUrl)).keys()) {
        if (rewritten.has(path) || (await standings.of(path)) !== "beside") keeping.add(path);
        else beside.add(path);
      }
      if (keeping.size) {
        stillMentioned.push({ path: move.from, pages: [...keeping].sort() });
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
  const also = request.from === "repository" && !request.keepCopies ? [...beside].sort() : [];
  const readBy = readersAmong(standings, stillMentioned);
  /** A file that keeps a copy, with what reads it when that is why it counts. */
  const named = (path: string) => (readBy[path] ? `${path} (read by ${someOf(readBy[path], 2)})` : path);
  const pagesUpdated = rewritten.size - templates.size;
  /** Of the files that keep a copy, how many a move doesn't change. */
  const unchanging = mentioning.filter((path) => leftAlone.has(path)).length;
  const count = (many: number, one: string, more = `${one}s`) => `${many} ${many === 1 ? one : more}`;
  const summary =
    `${count(copied, "file")} copied to ${where}${skipped ? ` (${skipped} already there)` : ""}, ${count(pagesUpdated, "page")}${templates.size ? ` and ${count(templates.size, "page template")}` : ""} updated` +
    (removed ? `, ${removed} removed from the repository` : "") +
    (stillMentioned.length ? `. ${stillMentioned.length} left in the repository: still used by ${someOf(mentioning.map(named))}` : "") +
    (unchanging === 1
      ? ". The site is built from that file and a move doesn't change it, so what it uses stays where it is"
      : unchanging > 1
        ? ". The site is built from those files and a move doesn't change them, so what they use stays where it is"
        : "") +
    (also.length ? `. Also mentioned in ${someOf(also)}: not part of the site as built, so not changed` : "") +
    (request.from !== "repository" && alone.length ? `. ${someOf(alone)} still ${alone.length === 1 ? "points" : "point"} at ${storeOf(context, request.from).name}: a move doesn't change the site's code, so change ${alone.length === 1 ? "it" : "them"} by hand` : "") +
    (request.from !== "repository" ? `. The files are still in ${storeOf(context, request.from).name}; remove them there once the pages are published` : "") +
    (plan.staying ? `. ${plan.staying.files} ${plan.staying.files === 1 ? "stayed where it was" : "stayed where they were"}: ${plan.staying.reason.replace(/\.$/, "")}` : "") +
    (problems.length ? `. ${problems.length} ${problems.length === 1 ? "problem" : "problems"} — see the list` : "") +
    ". Publish to make it live.";

  return {
    plan,
    copied,
    skipped,
    rewrittenPages: pagesUpdated,
    ...(templates.size ? { rewrittenTemplates: templates.size } : {}),
    removed,
    problems,
    summary,
    ...(stillMentioned.length ? { stillMentioned } : {}),
    ...(alone.length ? { leftAlone: alone } : {}),
    ...(also.length ? { alsoMentioned: also } : {}),
    ...(Object.keys(readBy).length ? { readBy } : {}),
  };
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
  const { rewritten, leftAlone, failed } = await rewrite(context.site, await standingsOf(context.site), files, store.addressPattern(), replace, (count) => progress(`Updating pages: ${count} of ${files.size}`, 0.2 + 0.7 * (count / Math.max(1, files.size))));
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
