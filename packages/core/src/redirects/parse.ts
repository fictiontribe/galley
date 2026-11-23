/**
 * Reading a list of redirects in whatever form people actually have one:
 * pasted columns (comma, tab, semicolon or spaces, with or without a header
 * row), a `_redirects` file, Apache and nginx configuration, a Cloudflare
 * Bulk Redirects export, JSON (ours, Vercel's), and the WordPress importer's
 * list. Each line is read on its own, so a paste that mixes separators still
 * reads; the format reported is the one most lines were in.
 *
 * Never guess (Principle 4): a line that isn't plainly a one-to-one
 * redirect comes back rejected with its line number and a reason, never
 * approximated.
 */
import { readNewAddress, readOldAddress, type AddressContext } from "./path";
import type { ParsedRedirect, ParseResult, RedirectInputFormat, RedirectStatus, RejectedLine } from "./types";

export interface ParseOptions extends AddressContext {
  /** The uploaded file's name, when there was one: "_redirects", ".htaccess", "nginx.conf" decide the format outright. */
  filename?: string;
  /** Stamped on every redirect as `source`; default "import:<format>". */
  source?: string;
}

const FORMAT_LABELS: Record<RedirectInputFormat, string> = {
  columns: "A list of old and new addresses",
  "redirects-file": "A _redirects file (Netlify or Cloudflare)",
  apache: "Apache configuration (.htaccess)",
  nginx: "nginx configuration",
  "cloudflare-csv": "A Cloudflare Bulk Redirects list",
  json: "A redirects list in JSON",
  "vercel-json": "Vercel redirects (vercel.json)",
  wordpress: "The WordPress import's redirects",
};

export function formatLabel(format: RedirectInputFormat): string {
  return FORMAT_LABELS[format];
}

type LineKind = "columns" | "redirects-file" | "apache" | "nginx" | "cloudflare-csv";

interface Candidate {
  from: string;
  to: string;
  status: RedirectStatus | null;
  note?: string;
  notes: string[];
  /** Whether a bare "example.com/x" old address is a host (Cloudflare's lists write them so). */
  bareHosts?: boolean;
}

type LineOutcome = { kind: LineKind; candidate: Candidate } | { kind: LineKind; reject: { kind: RejectedLine["kind"]; reason: string } } | { kind: LineKind | "ignored"; ignore: true };

const STATUS_WORDS: Record<string, RedirectStatus> = {
  "301": 301,
  "302": 302,
  "307": 307,
  "308": 308,
  permanent: 301,
  moved: 301,
  temporary: 302,
  temp: 302,
  found: 302,
};

/** A status column: a known code or word; anything else is a reason. */
function readStatus(raw: string): { status: RedirectStatus; forced: boolean } | { reason: string; needsPerson: boolean } {
  const value = raw.trim().toLowerCase();
  const forced = value.endsWith("!");
  const bare = forced ? value.slice(0, -1) : value;

  if (STATUS_WORDS[bare]) return { status: STATUS_WORDS[bare]!, forced };
  if (bare === "200") return { reason: "Status 200 shows another page at the same address. That isn't a redirect, so it was left for a person to set up.", needsPerson: true };
  if (bare === "404" || bare === "410" || bare === "gone") return { reason: `Status ${bare === "gone" ? "410" : bare} says the page is gone rather than moved, which isn't a redirect.`, needsPerson: true };
  if (bare === "303") return { reason: "Status 303 isn't offered here. Choose permanent (301) or temporary (302).", needsPerson: true };
  if (/^\d{3}$/.test(bare)) return { reason: `“${raw.trim()}” isn't a redirect status. Use 301, 302, 307 or 308.`, needsPerson: false };
  return { reason: `“${raw.trim()}” isn't a status this app knows. Use 301 (permanent) or 302 (temporary).`, needsPerson: false };
}

// ─────────────────────────────────────────────────────────────── columns

/** Splits a CSV line, honouring double quotes ("a,b"). */
function splitCsv(line: string, separator: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;

    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (char === separator) {
      out.push(field.trim());
      field = "";
    } else field += char;
  }
  out.push(field.trim());
  return out;
}

const ADDRESSY = /^(\/|https?:\/\/|\/\/|[a-z0-9-]+(\.[a-z0-9-]+)+\/)/i;

function fieldsOf(line: string): { fields: string[]; separator: "tab" | "semicolon" | "comma" | "space" } {
  if (line.includes("\t")) return { fields: line.split("\t").map((field) => field.trim()).filter((field, index, all) => field !== "" || index < all.length - 1), separator: "tab" };
  // A separator only counts when it sits between two addresses: URLs may contain commas and semicolons.
  for (const [char, name] of [[";", "semicolon"], [",", "comma"]] as const) {
    if (!line.includes(char)) continue;
    const fields = splitCsv(line, char);

    if (fields.length >= 2 && (ADDRESSY.test(fields[0]!) || /^["']?(from|old|source|redirect)/i.test(fields[0]!)) && fields[1] !== undefined) return { fields, separator: name };
  }
  return { fields: line.trim().split(/\s+/), separator: "space" };
}

const HEADER_WORDS = /^(from|to|old|new|source|target|destination|redirect|status|code|type|url|path|old url|new url|source url|target url|old address|new address|note|notes|comment)s?$/i;

function isHeader(fields: string[]): boolean {
  const words = fields.filter((field) => field !== "");

  return words.length >= 2 && words.every((field) => HEADER_WORDS.test(field.replace(/[_-]/g, " ").replace(/["']/g, "").trim()));
}

const BOOL = /^(true|false)?$/i;

/**
 * In typed lists both addresses must look like addresses ("/old", "https://…"):
 * "hello world" is two words, not a redirect from /hello to /world.
 */
function addressProblem(from: string, to: string, bareHosts: boolean): string | null {
  const ok = (value: string) => value.startsWith("/") || /^https?:\/\//i.test(value) || (bareHosts && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(value));

  if (!ok(from)) return `The old address “${from.slice(0, 80)}” should start with “/” or “https://”.`;
  if (!ok(to) && !/^https?:\/\//i.test(to)) return `The new address “${to.slice(0, 80)}” should start with “/” or “https://”.`;
  return null;
}

function readColumns(line: string, bareHosts: boolean): LineOutcome {
  const { fields, separator } = fieldsOf(line);

  if (isHeader(fields)) return { kind: "columns", ignore: true };
  // Cloudflare's list format: SOURCE,TARGET[,STATUS[,PRESERVE_QUERY,INCLUDE_SUBDOMAINS,SUBPATH_MATCHING,PRESERVE_PATH_SUFFIX]]
  const cloudflare = separator === "comma" && (bareHosts || (fields.length >= 4 && fields.slice(3).every((field) => BOOL.test(field))));
  const kind: LineKind = cloudflare ? "cloudflare-csv" : separator === "space" ? "redirects-file" : "columns";

  if (separator === "space") return readRedirectsLine(fields);
  if (fields.length < 2 || !fields[0] || !fields[1]) return { kind, reject: { kind: "malformed", reason: "Two addresses — the old one and the new one — weren't found on this line." } };
  const problem = addressProblem(fields[0], fields[1], cloudflare);

  if (problem) return { kind, reject: { kind: "malformed", reason: problem } };
  const candidate: Candidate = { from: fields[0], to: fields[1], status: null, notes: [], bareHosts: cloudflare };

  if (fields[2]) {
    const status = readStatus(fields[2]);

    if ("reason" in status) {
      // A third column that is text, not a code, is a note ("old,new,Moved in 2024").
      if (!status.needsPerson && !/^\d+!?$/.test(fields[2]) && !cloudflare) candidate.note = fields.slice(2).join(", ");
      else return { kind, reject: { kind: status.needsPerson ? "needs-person" : "malformed", reason: status.reason } };
    } else candidate.status = status.status;
  }
  if (cloudflare) {
    const [preserveQuery, includeSubdomains, subpath, suffix] = fields.slice(3).map((field) => field.toLowerCase() === "true");

    if (includeSubdomains) return { kind, reject: { kind: "needs-person", reason: "This redirect also covers every subdomain, which a site's own redirects can't do." } };
    if (subpath) {
      candidate.from = `${candidate.from.replace(/\/?$/, "/")}*`;
      // Every boolean column defaults to FALSE in Cloudflare's CSV format, so an omitted PRESERVE_PATH_SUFFIX drops the rest of the path.
      if (suffix === true) candidate.to = `${candidate.to.replace(/\/?$/, "/")}:splat`;
      candidate.notes.push("Read “subpath matching” as everything under the old address.");
    }
    if (preserveQuery === false && fields[3] !== undefined && fields[3] !== "") candidate.notes.push("Cloudflare was set to drop the query string; hosts differ on this, see the docs.");
  } else if (fields.length > 3 && candidate.note === undefined) {
    candidate.note = fields.slice(3).filter(Boolean).join(", ") || undefined;
  }
  return { kind, candidate };
}

// ─────────────────────────────────────────────────────────────── _redirects

function readRedirectsLine(fields: string[]): LineOutcome {
  // Two plain columns split by spaces read the same either way; only _redirects' own syntax names the format.
  const kind: LineKind = fields.some((field, index) => (index > 0 && /!$|^(\w+)=/.test(field)) || /\*$|:splat/.test(field)) ? "redirects-file" : "columns";

  if (isHeader(fields)) return { kind: "columns", ignore: true };
  if (fields.length < 2) return { kind, reject: { kind: "malformed", reason: "Two addresses — the old one and the new one — weren't found on this line." } };
  const [from, ...rest] = fields as [string, ...string[]];
  // Netlify query conditions sit between the two addresses: "/store id=:id /blog/:id 301".
  const conditions = rest.filter((field) => /^[^/:]+=/.test(field) && !/^https?:/.test(field));
  const others = rest.filter((field) => !conditions.includes(field));
  const to = others[0];
  const tail = others.slice(1);

  if (!to) return { kind, reject: { kind: "malformed", reason: "The new address is missing." } };
  const problem = addressProblem(from, to, false);

  if (problem) return { kind, reject: { kind: "malformed", reason: problem } };
  if (conditions.some((condition) => /^(country|language|role|cookie)=/i.test(condition)) || tail.some((field) => /^(country|language|role|cookie)=/i.test(field))) {
    return { kind, reject: { kind: "needs-person", reason: "This redirect only applies to some visitors (by country, language, role or cookie), which isn't a plain redirect." } };
  }
  let query = "";

  if (conditions.length) {
    if (conditions.some((condition) => /=:/.test(condition))) return { kind, reject: { kind: "needs-person", reason: "This matches a query parameter with a placeholder, which isn't a one-to-one redirect." } };
    query = `?${conditions.join("&")}`;
  }
  const candidate: Candidate = { from: from + query, to, status: null, notes: [] };

  if (tail[0]) {
    const status = readStatus(tail[0]);

    if ("reason" in status) return { kind, reject: { kind: status.needsPerson ? "needs-person" : "malformed", reason: status.reason } };
    candidate.status = status.status;
    if (status.forced) candidate.notes.push("Dropped the “!” (force): redirects here always apply.");
  }
  if (tail.length > 1) return { kind, reject: { kind: "malformed", reason: `There's more on this line than an old address, a new address and a status: “${tail.slice(1).join(" ")}”.` } };
  return { kind, candidate };
}

// ─────────────────────────────────────────────────────────────── Apache

/**
 * The literal path a simple anchored pattern matches: "^old-page/?$" →
 * "/old-page" (+ the optional slash), "^blog/(.*)$" → "/blog/*". Anything
 * with real pattern syntax left in it is not simple: null.
 */
function literalPattern(pattern: string): { path: string; wildcard: boolean; optionalSlash: boolean } | null {
  let body = pattern.trim();

  if (!body.startsWith("^")) return null;
  body = body.slice(1);
  let wildcard = false;
  let optionalSlash = false;

  if (body.endsWith("$")) body = body.slice(0, -1);
  else if (!/\(\.\*\)$/.test(body)) return null;
  if (/\(\.\*\)$/.test(body)) {
    wildcard = true;
    body = body.slice(0, -4);
  } else if (/\.\*$/.test(body)) {
    wildcard = true;
    body = body.slice(0, -2);
  }
  if (body.endsWith("/?")) {
    optionalSlash = true;
    body = body.slice(0, -2);
  }
  const unescaped = body.replace(/\\([./\-_~])/g, "$1");

  if (/[\\[\](){}|+*?^$]/.test(unescaped)) return null;
  const path = `/${unescaped.replace(/^\//, "")}`;

  return { path: wildcard ? `${path.replace(/\/?$/, "/")}*` : path, wildcard, optionalSlash };
}

function substitution(target: string, wildcard: boolean): string | null {
  const refs = target.match(/\$\d/g) ?? [];

  if (!wildcard) return refs.length ? null : target;
  if (refs.length === 0) return target;
  if (refs.length === 1 && target.endsWith("$1")) return `${target.slice(0, -2)}:splat`;
  return null;
}

const APACHE_IGNORED = /^(RewriteEngine|RewriteBase|Options|<IfModule|<\/IfModule|<Directory|<\/Directory|<VirtualHost|<\/VirtualHost|ServerName|ServerAlias|DocumentRoot)\b/i;

function readApache(line: string, afterCondition: boolean): LineOutcome {
  const kind: LineKind = "apache";
  const trimmed = line.trim();

  if (APACHE_IGNORED.test(trimmed)) return { kind, ignore: true };
  if (/^RewriteCond\b/i.test(trimmed)) return { kind, reject: { kind: "needs-person", reason: "A RewriteCond makes the next rule depend on a condition, so that rule isn't a plain redirect." } };
  const parts = trimmed.split(/\s+/);
  const directive = parts[0]!.toLowerCase();

  if (directive === "redirect" || directive === "redirectpermanent" || directive === "redirecttemp") {
    let rest = parts.slice(1);
    let status: RedirectStatus | null = directive === "redirectpermanent" ? 301 : directive === "redirecttemp" ? 302 : null;
    const notes: string[] = ["Apache's Redirect also sends every address below the old one; only the exact address was kept."];

    if (/^(gone|410)$/i.test(rest[0] ?? "")) return { kind, reject: { kind: "needs-person", reason: "“gone” says the page was removed, not moved, so there's no new address." } };
    if (directive === "redirect" && rest.length === 3) {
      const read = readStatus(rest[0]!.replace(/^seeother$/i, "303"));

      if ("reason" in read) return { kind, reject: { kind: read.needsPerson ? "needs-person" : "malformed", reason: read.reason } };
      status = read.status;
      rest = rest.slice(1);
    }
    if (rest.length !== 2) return { kind, reject: { kind: "malformed", reason: "An Apache Redirect needs an old path and a new address." } };
    if (directive === "redirect" && status === null) notes.push("Apache treats a Redirect without a status as temporary.");
    return { kind, candidate: { from: rest[0]!, to: rest[1]!, status: status ?? 302, notes } };
  }
  if (directive === "redirectmatch") {
    let rest = parts.slice(1);
    let status: RedirectStatus = 302;

    if (rest.length === 3) {
      const read = readStatus(rest[0]!);

      if ("reason" in read) return { kind, reject: { kind: read.needsPerson ? "needs-person" : "malformed", reason: read.reason } };
      status = read.status;
      rest = rest.slice(1);
    }
    if (rest.length !== 2) return { kind, reject: { kind: "malformed", reason: "An Apache RedirectMatch needs a pattern and a new address." } };
    const literal = literalPattern(rest[0]!);
    const target = literal ? substitution(rest[1]!, literal.wildcard) : null;

    if (!literal || target === null) return { kind, reject: { kind: "needs-person", reason: "This pattern matches more than one plain address (or rearranges it), so a person should check how to carry it over." } };
    return { kind, candidate: { from: literal.path, to: target, status, notes: literal.optionalSlash ? ["The pattern allowed the address with or without a trailing slash; one form was kept."] : [] } };
  }
  if (directive === "rewriterule") {
    if (afterCondition) return { kind, reject: { kind: "needs-person", reason: "This rule only applies when the RewriteCond above it holds, so it isn't a plain redirect." } };
    const flags = /\[([^\]]*)\]\s*$/.exec(trimmed)?.[1] ?? "";
    const args = trimmed.replace(/\[[^\]]*\]\s*$/, "").trim().split(/\s+/).slice(1);

    if (args.length !== 2) return { kind, reject: { kind: "malformed", reason: "A RewriteRule needs a pattern and a new address." } };
    const redirect = /(^|,)\s*R(=(\d{3}))?\s*(,|$)/i.exec(flags);

    if (!redirect) return { kind, reject: { kind: "needs-person", reason: "This RewriteRule changes what page is shown without sending the visitor anywhere (it has no R flag), so it isn't a redirect." } };
    const read = readStatus(redirect[3] ?? "302");

    if ("reason" in read) return { kind, reject: { kind: read.needsPerson ? "needs-person" : "malformed", reason: read.reason } };
    const literal = literalPattern(args[0]!);
    const target = literal ? substitution(args[1]!, literal.wildcard) : null;

    if (!literal || target === null || target === "-") return { kind, reject: { kind: "needs-person", reason: "This pattern matches more than one plain address (or rearranges it), so a person should check how to carry it over." } };
    const notes = redirect[3] ? [] : ["A RewriteRule with R and no number is temporary."];

    if (literal.optionalSlash) notes.push("The pattern allowed the address with or without a trailing slash; one form was kept.");
    return { kind, candidate: { from: literal.path, to: target, status: read.status, notes } };
  }
  return { kind, reject: { kind: "malformed", reason: "This Apache line isn't a redirect." } };
}

// ─────────────────────────────────────────────────────────────── nginx

const NGINX_IGNORED = /^(server\s*\{|\}|listen\s|server_name\s|root\s|index\s|#)/;

function readNginx(line: string, location: string | null): LineOutcome {
  const kind: LineKind = "nginx";
  const trimmed = line.trim().replace(/;\s*\}?\s*$/, ";");

  if (NGINX_IGNORED.test(trimmed)) return { kind, ignore: true };
  const rewrite = /^rewrite\s+(\S+)\s+(\S+)(?:\s+(\w+))?\s*;$/.exec(trimmed);

  if (rewrite) {
    const flag = rewrite[3]?.toLowerCase();

    if (flag !== "permanent" && flag !== "redirect") return { kind, reject: { kind: "needs-person", reason: "This rewrite changes what page is shown without sending the visitor anywhere (no “permanent” or “redirect”), so it isn't a redirect." } };
    const literal = literalPattern(rewrite[1]!);
    const target = literal ? substitution(rewrite[2]!, literal.wildcard) : null;

    if (!literal || target === null) return { kind, reject: { kind: "needs-person", reason: "This pattern matches more than one plain address (or rearranges it), so a person should check how to carry it over." } };
    return { kind, candidate: { from: literal.path, to: target.replace(/\?$/, ""), status: flag === "permanent" ? 301 : 302, notes: literal.optionalSlash ? ["The pattern allowed the address with or without a trailing slash; one form was kept."] : [] } };
  }
  const returned = /^return\s+(\d{3})\s+(\S+?)\s*;$/.exec(trimmed);

  if (returned) {
    if (!location) return { kind, reject: { kind: "needs-person", reason: "A return outside a “location = …” block sends a whole server somewhere, which isn't one redirect." } };
    const read = readStatus(returned[1]!);

    if ("reason" in read) return { kind, reject: { kind: read.needsPerson ? "needs-person" : "malformed", reason: read.reason } };
    const target = returned[2]!.replace(/\$request_uri$/, "");

    if (/\$/.test(target)) return { kind, reject: { kind: "needs-person", reason: "The new address is built from variables, so it isn't a plain redirect." } };
    return { kind, candidate: { from: location, to: target, status: read.status, notes: [] } };
  }
  if (/^location\s/.test(trimmed)) return { kind, reject: { kind: "needs-person", reason: "Only exact locations (“location = /old { return 301 /new; }”) are plain redirects." } };
  if (/^if\s*\(/.test(trimmed)) return { kind, reject: { kind: "needs-person", reason: "An “if” makes what follows conditional, so it isn't a plain redirect." } };
  return { kind, reject: { kind: "malformed", reason: "This nginx line isn't a redirect." } };
}

// ─────────────────────────────────────────────────────────────── JSON

function statusFromJson(item: Record<string, unknown>): RedirectStatus | null {
  const raw = item.status ?? item.statusCode ?? item.status_code ?? item.code ?? item.type;

  if (typeof raw === "number" || typeof raw === "string") {
    const read = readStatus(String(raw));

    return "status" in read ? read.status : null;
  }
  if (typeof item.permanent === "boolean") return item.permanent ? 308 : 307;
  return null;
}

/** Vercel source patterns: "/blog/:path*" → "/blog/*"; anything with regex groups needs a person. */
function vercelPath(source: string, destination: string): { from: string; to: string } | null {
  const wildcard = /^(.*\/):(\w+)\*$/.exec(source);

  if (wildcard) {
    const param = `:${wildcard[2]}*`;

    if (destination.includes(":") && !destination.endsWith(param)) return null;
    return { from: `${wildcard[1]}*`, to: destination.endsWith(param) ? `${destination.slice(0, -param.length)}:splat` : destination };
  }
  if (/[:()*+?]/.test(source.replace(/\\[:()*+?]/g, ""))) return null;
  return { from: source.replace(/\\([:()*+?])/g, "$1"), to: destination };
}

function parseJson(text: string, ctx: ParseOptions): ParseResult | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const record = value as Record<string, unknown>;
  const list = Array.isArray(value) ? value : Array.isArray(record?.redirects) ? (record.redirects as unknown[]) : null;

  if (!list) return null;
  const first = (list.find((item) => item && typeof item === "object") ?? {}) as Record<string, unknown>;
  const vercel = "source" in first && "destination" in first;
  const wordpress = !vercel && "title" in first && ("snippets" in record || "plan" in record || "items" in record || "nextSteps" in record);
  const format: RedirectInputFormat = vercel ? "vercel-json" : wordpress ? "wordpress" : "json";
  const lines = text.split("\n");
  const lineOf = (index: number, from: string): number => {
    const needle = JSON.stringify(from);
    const at = lines.findIndex((line) => line.includes(needle));

    return at === -1 ? index + 1 : at + 1;
  };
  const outcomes: Array<{ line: number; text: string; outcome: LineOutcome }> = list.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const fromRaw = String(item.from ?? item.source ?? item.old ?? "");
    const toRaw = String(item.to ?? item.destination ?? item.target ?? item.new ?? "");
    const line = lineOf(index, fromRaw);
    const shown = JSON.stringify(raw);

    if (!fromRaw || !toRaw) return { line, text: shown, outcome: { kind: "columns", reject: { kind: "malformed", reason: "This item doesn't have both an old and a new address." } } };
    if (vercel && (item.has || item.missing)) return { line, text: shown, outcome: { kind: "columns", reject: { kind: "needs-person", reason: "This redirect only applies when a header, cookie or query is present, which isn't a plain redirect." } } };
    const paths = vercel ? vercelPath(fromRaw, toRaw) : { from: fromRaw, to: toRaw };

    if (!paths) return { line, text: shown, outcome: { kind: "columns", reject: { kind: "needs-person", reason: "This uses a pattern (placeholders or a regular expression), which isn't a one-to-one redirect." } } };
    // Vercel's documented default is `permanent: true`, a 308; the WordPress importer's lists are 301s (its own snippets say so).
    const status = statusFromJson(item) ?? (vercel ? 308 : wordpress ? 301 : null);
    const note = typeof item.note === "string" ? item.note : wordpress && typeof item.title === "string" ? item.title : undefined;

    return { line, text: shown, outcome: { kind: "columns", candidate: { from: paths.from, to: paths.to, status, ...(note ? { note } : {}), notes: [] } } };
  });

  return finish(outcomes, format, ctx, 0);
}

/** The WordPress importer's `redirects.mjs`: `export const redirects = { "/old/": "/new/", … };`. */
function parseWordPressModule(text: string, ctx: ParseOptions): ParseResult | null {
  const at = text.indexOf("export const redirects");

  if (at === -1) return null;
  const start = text.indexOf("{", at);
  const end = text.lastIndexOf("}");

  if (start === -1 || end <= start) return null;
  let map: Record<string, unknown>;

  try {
    map = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const lines = text.split("\n");
  const outcomes = Object.entries(map).map(([from, to], index) => {
    const needle = JSON.stringify(from);
    const line = lines.findIndex((candidate) => candidate.includes(needle));

    return {
      line: line === -1 ? index + 1 : line + 1,
      text: `${from} → ${String(to)}`,
      outcome: (typeof to === "string" ? { kind: "columns", candidate: { from, to, status: 301, notes: [] } } : { kind: "columns", reject: { kind: "malformed", reason: "The new address isn't text." } }) as LineOutcome,
    };
  });

  return finish(outcomes, "wordpress", ctx, 0);
}

// ─────────────────────────────────────────────────────────────── driver

function lineKind(line: string): "apache" | "nginx" | "other" {
  const trimmed = line.trim();

  if (/^(Redirect(Match|Permanent|Temp)?|RewriteRule|RewriteCond|RewriteEngine|RewriteBase|Options|<\/?IfModule|<\/?Directory|<\/?VirtualHost)\b/i.test(trimmed)) return "apache";
  if (/^(rewrite\s|return\s+\d{3}\s|location\s|server\s*\{|server_name\s|listen\s|if\s*\()/.test(trimmed) || /^\}$/.test(trimmed)) return "nginx";
  return "other";
}

function finish(outcomes: Array<{ line: number; text: string; outcome: LineOutcome }>, format: RedirectInputFormat, ctx: ParseOptions, ignored: number): ParseResult {
  const redirects: ParsedRedirect[] = [];
  const rejected: RejectedLine[] = [];
  const unknown = new Map<string, number>();
  const source = ctx.source ?? `import:${format === "columns" || format === "json" ? "list" : format}`;
  let skipped = ignored;

  for (const { line, text, outcome } of outcomes) {
    if ("ignore" in outcome) {
      skipped += 1;
      continue;
    }
    if ("reject" in outcome) {
      rejected.push({ line, text: text.trim().slice(0, 500), kind: outcome.reject.kind, reason: outcome.reject.reason });
      continue;
    }
    const { candidate } = outcome;
    const from = readOldAddress(candidate.from, ctx, { bareHosts: candidate.bareHosts ?? false });

    if (from.kind === "invalid") {
      rejected.push({ line, text: text.trim().slice(0, 500), kind: from.needsPerson ? "needs-person" : "malformed", reason: from.reason });
      continue;
    }
    if (from.kind === "other-domain") {
      unknown.set(from.host, (unknown.get(from.host) ?? 0) + 1);
      rejected.push({ line, text: text.trim().slice(0, 500), kind: "other-domain", reason: `The old address is on ${from.host}, which isn't this site's address. This site's redirects only see its own addresses.` });
      continue;
    }
    const to = readNewAddress(candidate.to, ctx, { wildcard: from.path.endsWith("*") });

    if (to.kind === "invalid") {
      rejected.push({ line, text: text.trim().slice(0, 500), kind: to.needsPerson ? "needs-person" : "malformed", reason: to.reason });
      continue;
    }
    const status = candidate.status;
    const parsed: ParsedRedirect = {
      line,
      from: from.path,
      to: to.kind === "url" ? to.url : to.path,
      status: status ?? 301,
      source,
      notes: [...new Set([...candidate.notes, ...from.notes, ...to.notes])],
      ...(candidate.note ? { note: candidate.note.slice(0, 500) } : {}),
      ...(status === null ? { statusMissing: true } : {}),
    };

    redirects.push(parsed);
  }
  return {
    format,
    formatLabel: FORMAT_LABELS[format],
    redirects,
    rejected,
    ignored: skipped,
    unknownHosts: [...unknown.entries()].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count || a.host.localeCompare(b.host)),
  };
}

/** Reads `text` as a list of redirects, detecting its format. */
export function parseRedirects(text: string, options: ParseOptions): ParseResult {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const trimmed = clean.trim();
  const name = (options.filename ?? "").toLowerCase().split(/[\\/]/).pop() ?? "";

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const json = parseJson(trimmed, options);

    if (json) return json;
  }
  if (/export\s+const\s+redirects\s*=/.test(clean)) {
    const module = parseWordPressModule(clean, options);

    if (module) return module;
  }
  const lines = clean.split("\n");
  // A Cloudflare list writes old addresses as "example.com/path": decided over the whole input, not per line.
  const commaLines = lines.filter((line) => line.includes(",") && !line.trim().startsWith("#"));
  const bareHosts = name.endsWith(".csv") || commaLines.length > 0 ? commaLines.length > 0 && commaLines.filter((line) => /^"?[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(line.trim())).length >= Math.ceil(commaLines.length / 2) : false;
  const outcomes: Array<{ line: number; text: string; outcome: LineOutcome }> = [];
  let ignored = 0;
  let afterCondition = false;
  let location: string | null = null;

  lines.forEach((raw, index) => {
    // A trailing "# comment" goes; a "#" inside an address (no space before it) stays.
    const line = raw.replace(/\s+#(\s.*)?$/, "");
    const trimmedLine = line.trim();

    if (trimmedLine === "" || trimmedLine.startsWith("#") || trimmedLine.startsWith("//")) {
      if (trimmedLine !== "") ignored += 1;
      return;
    }
    const kind = lineKind(trimmedLine);
    let outcome: LineOutcome;

    if (kind === "apache") {
      outcome = readApache(trimmedLine, afterCondition);
      afterCondition = /^RewriteCond\b/i.test(trimmedLine) || (afterCondition && !/^RewriteRule\b/i.test(trimmedLine));
    } else if (kind === "nginx") {
      const opened = /^location\s+=\s+(\S+)\s*\{\s*(.*?)\s*\}?\s*$/.exec(trimmedLine);

      if (opened) {
        location = opened[1]!;
        // One-line form: "location = /old { return 301 /new; }".
        outcome = opened[2] ? readNginx(opened[2], location) : { kind: "nginx", ignore: true };
        if (/\}\s*$/.test(trimmedLine)) location = null;
      } else {
        outcome = readNginx(trimmedLine, location);
        if (/\}\s*$/.test(trimmedLine)) location = null;
      }
    } else {
      afterCondition = false;
      outcome = readColumns(trimmedLine, bareHosts);
    }
    outcomes.push({ line: index + 1, text: raw, outcome });
  });
  const tally = new Map<LineKind, number>();

  for (const { outcome } of outcomes) if (!("ignore" in outcome)) tally.set(outcome.kind as LineKind, (tally.get(outcome.kind as LineKind) ?? 0) + 1);
  let format: RedirectInputFormat = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "columns";

  // Plain "old new" lines read the same in a _redirects file: one line of its own syntax names the whole file.
  if (format === "columns" && (tally.get("redirects-file") ?? 0) > 0 && !lines.some((line) => /[\t,;]/.test(line) && !line.trim().startsWith("#"))) format = "redirects-file";

  if (name === "_redirects") format = "redirects-file";
  else if (name === ".htaccess") format = "apache";
  return finish(outcomes, format, options, ignored);
}
