/**
 * Redirects: the shapes every layer speaks — the list file in the site, what
 * an import understood, the checks, an address traced through the list, the
 * host's own file kept in step, and the Cloudflare Bulk Redirects sync.
 *
 * Types only, no runtime code, so the web app and its fixture backend can
 * import them (through `@galley/core/redirects-info`) without pulling in the
 * engine.
 */

/** 301 and 308 are permanent; 302 and 307 temporary. 307/308 keep the request's method. */
export type RedirectStatus = 301 | 302 | 307 | 308;

/**
 * One redirect as it is kept in the list file. `from` is a path on this site,
 * optionally ending in `*` (everything under it); `to` is a path on this
 * site or an absolute URL, and may end in `:splat` to carry over what `*`
 * matched.
 */
export interface Redirect {
  from: string;
  to: string;
  status: RedirectStatus;
  note?: string;
  /** Where it came from: "import:wordpress", "import:apache", "manual". */
  source?: string;
}

/** The list file: `{ "redirects": [...] }`. */
export interface RedirectsFile {
  redirects: Redirect[];
}

/** Where the site is served from, as far as redirects are concerned. */
export type RedirectHostId = "cloudflare" | "netlify" | "vercel" | "other";

// ─────────────────────────────────────────────────────────────── import

/** What a pasted list or uploaded file turned out to be. */
export type RedirectInputFormat =
  | "columns" // two or three columns: comma, tab, semicolon or spaces
  | "redirects-file" // Netlify / Cloudflare `_redirects`
  | "apache" // Redirect, RedirectMatch, RewriteRule
  | "nginx" // rewrite … permanent; / location = … { return 301 …; }
  | "cloudflare-csv" // a Cloudflare Bulk Redirects list export
  | "json" // our own `{ redirects: [...] }`, or a bare list of { from, to }
  | "vercel-json" // vercel.json `redirects`
  | "wordpress"; // the WordPress importer's list (report JSON or redirects.mjs)

/** A line that became a redirect. */
export interface ParsedRedirect extends Redirect {
  /** 1-based line in the input. */
  line: number;
  /** What was adjusted while understanding the line, in plain words. */
  notes: string[];
  /** The line gave no kind (permanent/temporary); `status` is the review's choice. */
  statusMissing?: boolean;
}

export type RejectionKind =
  /** Not a redirect line at all, or two addresses could not be found. */
  | "malformed"
  /** A real rule, but cleverer than a one-to-one redirect: a person should look. */
  | "needs-person"
  /** The old address is on another domain, which this site's host can't answer for. */
  | "other-domain";

export interface RejectedLine {
  line: number;
  text: string;
  kind: RejectionKind;
  reason: string;
}

export interface ParseResult {
  format: RedirectInputFormat;
  /** "Comma-separated columns with a header row", "An Apache configuration". */
  formatLabel: string;
  redirects: ParsedRedirect[];
  rejected: RejectedLine[];
  /** Lines that were blank or comments. */
  ignored: number;
  /** Domains seen in full old addresses that are not known to be this site's, with counts. */
  unknownHosts: Array<{ host: string; count: number }>;
}

// ─────────────────────────────────────────────────────────────── checks

export type RedirectIssueCode =
  | "duplicate" // same old address, same new address, twice
  | "conflict" // same old address, different new addresses
  | "self" // the old and new address are the same
  | "chain" // a → b → c
  | "loop" // a → b → a
  | "live-page" // the old address is a page the site still has
  | "broken-target" // the new address is on this site but nothing is there
  | "shadowed" // a wildcard listed before the exact addresses it would hide (order is fixed automatically)
  | "from-query" // the old address has a query string
  | "case-twin" // two old addresses that differ only in capital letters
  | "splat-without-wildcard" // the new address uses what `*` matched, but the old one has no `*`
  | "host-limit" // over the host's documented limits
  | "host-unsupported"; // the host can't express this redirect

export interface RedirectIssue {
  code: RedirectIssueCode;
  severity: "error" | "warning" | "info";
  /** One plain sentence. */
  message: string;
  /** Positions in the list the issue is about (the first is the one to show it on). */
  indices: number[];
  /** For live-page: the page's title. For chain: the final address. For broken-target: a page that looks meant. */
  detail?: string;
  /** A replacement for `to` that resolves the issue (chains: the final address; broken targets: the page's exact address). */
  suggestion?: string;
}

/** How to settle each kind of problem when an import lands. */
export interface ImportResolutions {
  /** The same old address twice with the same new one: always keep one. */
  duplicates?: "keep-first";
  /** The same old address with different new ones. "keep-existing": the list's own wins over the import. */
  conflicts?: "keep-first" | "keep-last" | "keep-existing" | "use-new";
  /** a → b → c: point a straight at c, or keep the hop. */
  chains?: "flatten" | "keep";
  /** An old address that is still a live page. */
  livePages?: "leave-out" | "keep";
  /** Lines that said nothing about permanent or temporary. */
  missingStatus?: RedirectStatus;
  /** A new address on this site that leads nowhere. */
  brokenTargets?: "keep" | "leave-out" | "use-suggestion";
  /** a → b → a can't be added: "refuse" blocks confirming until the person leaves them out. */
  loops?: "refuse" | "leave-out";
}

export type ImportMode = "add" | "replace";

/** One group of problems in an import, as the review shows it. */
export interface ImportProblem {
  /** "note": something adjusted while reading the lines ("Added the leading slash"). */
  code: RedirectIssueCode | "missing-status" | "note" | RejectionKind;
  severity: "error" | "warning" | "info";
  count: number;
  /** "12 duplicates", "2 would hide live pages". */
  title: string;
  /** What it means, in one or two sentences. */
  body: string;
  /** The resolution in force and the others on offer. */
  resolution?: { key: keyof ImportResolutions; value: string; options: Array<{ value: string; label: string }> };
  /** Up to 20 examples: the old address, the new address, the line, a detail. */
  examples: Array<{ from: string; to?: string; line?: number; detail?: string }>;
}

export interface ImportReview {
  format: RedirectInputFormat;
  formatLabel: string;
  /** Lines understood as redirects. */
  understood: number;
  rejected: RejectedLine[];
  ignored: number;
  unknownHosts: Array<{ host: string; count: number }>;
  /** What would be added, after the resolutions (first 500, in list order). */
  preview: Array<Redirect & { line?: number; state: "new" | "changed" | "same" }>;
  counts: { add: number; change: number; same: number; leftOut: number; total: number };
  problems: ImportProblem[];
  resolutions: Required<ImportResolutions>;
  /** Problems that block confirming (loops). */
  blocking: number;
  mode: ImportMode;
}

// ─────────────────────────────────────────────────────────────── try an address

export interface RedirectHop {
  from: string;
  to: string;
  status: RedirectStatus;
  /** The rule in the list that matched (its position). */
  index: number;
  /** The rule as written ("/blog/*"). */
  rule: string;
}

export interface RedirectTrace {
  /** What was typed, and the path it was read as. */
  input: string;
  path: string;
  hops: RedirectHop[];
  /** Where the visitor ends up (a path or an absolute URL). */
  final: string;
  finalKind: "page" | "file" | "external" | "missing" | "unchanged";
  finalTitle?: string;
  loop: boolean;
  /** A rule for a nearly identical address (the other trailing-slash form, other capitals), when nothing matched. */
  nearMiss?: string;
  /** An address on another domain was typed. */
  otherDomain?: string;
}

// ─────────────────────────────────────────────────────────────── hosts

export interface RedirectHostLimits {
  /** Exact redirects allowed, or null when the host states no number. */
  static: number | null;
  /** Wildcard redirects allowed, or null. */
  dynamic: number | null;
  /** All together, or null. */
  total: number | null;
  /** Characters per rule, or null. */
  lineLength: number | null;
}

export interface RedirectHostInfo {
  id: RedirectHostId;
  name: string;
  /** The file the host reads, relative to the site (null: none Galley writes). */
  file: string | null;
  /** One sentence: how redirects take effect there. */
  howItWorks: string;
  limits: RedirectHostLimits;
  /** One sentence each on query strings, trailing slashes and capitals, from the host's docs. */
  queryStrings: string;
  trailingSlash: string;
  caseSensitivity: string;
  statuses: RedirectStatus[];
  /** The host's own pages, with the date they were read. */
  docs: Array<{ title: string; url: string; read: string }>;
}

export interface RedirectUsage {
  static: number;
  dynamic: number;
  total: number;
  /** The host can't take these (query strings on Cloudflare, …): left out of its file, listed. */
  leftOut: Array<{ from: string; reason: string }>;
  over: boolean;
}

// ─────────────────────────────────────────────────────────────── derived file

export type DerivedState =
  /** The host's file says exactly what the list says. */
  | "in-step"
  /** Written by this app and untouched since, but the list has changed: safe to bring up to date. */
  | "stale"
  /** Written by this app, then changed by hand: never replaced without asking. */
  | "hand-edited"
  /** The site has its own file this app didn't write: never replaced without asking. */
  | "foreign"
  /** Not there yet. */
  | "missing";

export interface DerivedStatus {
  path: string;
  state: DerivedState;
  /** For hand-edited and foreign: the file now, and what the list would make it. */
  current?: string;
  proposed?: string;
  /** Redirects the file holds that the list does not (foreign / hand-edited). */
  extra?: number;
}

/** A host file of another host this app wrote earlier and that is no longer read. */
export interface DerivedLeftover {
  path: string;
  host: RedirectHostId;
}

export type RedirectExportFormat = "csv" | "redirects-file" | "vercel-json" | "cloudflare-csv" | "nginx" | "apache" | "json";

// ─────────────────────────────────────────────────────────────── Cloudflare

/** One item of a Cloudflare Bulk Redirect list (its API shape). */
export interface CloudflareRedirectItem {
  source_url: string;
  target_url: string;
  status_code: RedirectStatus;
  preserve_query_string: boolean;
  include_subdomains: boolean;
  subpath_matching: boolean;
  preserve_path_suffix: boolean;
}

export interface CloudflarePlan {
  /** Changes whenever the list or Cloudflare's side changes; apply refuses a stale plan. */
  id: string;
  account: string;
  hostnames: string[];
  listName: string;
  list: "create" | "update" | "none";
  rule: "create" | "update" | "none";
  add: number;
  change: number;
  remove: number;
  unchanged: number;
  total: number;
  examples: {
    add: CloudflareRedirectItem[];
    change: Array<{ before: CloudflareRedirectItem; after: CloudflareRedirectItem }>;
    remove: CloudflareRedirectItem[];
  };
  /** Redirects Bulk Redirects can't express, with why. */
  skipped: Array<{ from: string; reason: string }>;
  /** Plan limits and other cautions, in plain sentences. */
  notes: string[];
}

export interface CloudflareRecord {
  account: string;
  hostnames: string[];
  listId: string;
  listName: string;
  rulesetId: string;
  ruleId: string;
  items: number;
  /** Hash of the items applied, to say whether the list has changed since. */
  itemsHash: string;
  appliedAt: string;
  who?: string;
}

export interface CloudflareCheck {
  matches: boolean;
  /** Plain sentences: what differs. Empty when it matches. */
  differences: string[];
  checkedAt: string;
  plan: CloudflarePlan;
}

export interface CloudflareSummary {
  /** The site is served by Cloudflare (from its deploy settings or the redirects setting). */
  relevant: boolean;
  /** A Cloudflare access key is stored or in the environment (status only). */
  keyConfigured: boolean;
  account: string | null;
  /** Where the account id came from. */
  accountFrom: "deploy" | "config" | null;
  hostnames: string[];
  /** Why setting them on Cloudflare is (or isn't) suggested for this list. */
  recommended: boolean;
  reason: string;
  /** The permissions the key needs, in Cloudflare's own words. */
  permissions: string[];
  last: CloudflareRecord | null;
  /** The list has changed since it was last set on Cloudflare. */
  outOfDate: boolean;
  /** The running (or last) apply job's id. */
  jobId: string | null;
}

// ─────────────────────────────────────────────────────────────── overview

export interface RedirectsHostChoice {
  id: RedirectHostId | null;
  /** deploy: from the site's deploy settings. config: chosen in the app. */
  from: "deploy" | "config" | null;
  /** A guess from the site's own files, offered when nothing is chosen yet. */
  suggestion?: { id: RedirectHostId; reason: string };
}

/** A redirects list someone else made that can be brought in (the WordPress import's). */
export interface RedirectImportSource {
  path: string;
  label: string;
  count: number;
  /** How many of its old addresses aren't in the list yet; 0 once they all are. Absent where not worked out. */
  waiting?: number;
}

export interface RedirectsOverview {
  /** The list file, repo-relative. */
  file: string;
  exists: boolean;
  /** Content hash of the file, for `baseHash`. */
  hash: string | null;
  /** The file couldn't be read as a list: what is wrong. The list is shown empty and saving is refused. */
  problem?: string;
  redirects: Redirect[];
  issues: RedirectIssue[];
  host: RedirectsHostChoice;
  hostInfo: RedirectHostInfo | null;
  usage: RedirectUsage | null;
  derived: DerivedStatus | null;
  leftovers: DerivedLeftover[];
  imports: RedirectImportSource[];
  cloudflare: CloudflareSummary | null;
  /** Hostnames known to be this site's (its live and staging addresses). */
  siteHosts: string[];
  trailingSlash: "always" | "never";
}

export interface RedirectHealth {
  /** Redirects whose new address on this site no longer exists. */
  brokenTargets: Array<{ index: number; from: string; to: string; suggestion?: string }>;
  /** Old addresses still linked from the site's own pages. */
  linkedOldAddresses: Array<{ from: string; to: string; pages: Array<{ path: string; title: string; url: string | null }> }>;
}
