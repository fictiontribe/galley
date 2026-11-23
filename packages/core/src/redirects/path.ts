/**
 * Addresses, normalised one way everywhere: what an old address is (a path
 * on this site, or a page on another domain), the site's trailing-slash
 * style, percent-encoding, query strings and fragments. Pure functions.
 */

/** How the site writes its page addresses: "/about/" or "/about". */
export type SlashStyle = "always" | "never";

export interface AddressContext {
  /** Hostnames that are this site (lowercase, no port). The www. twin of each counts too. */
  siteHosts: string[];
  trailingSlash: SlashStyle;
}

export type OldAddress =
  | { kind: "path"; path: string; notes: string[] }
  | { kind: "other-domain"; host: string; path: string }
  | { kind: "invalid"; reason: string; needsPerson?: boolean };

export type NewAddress = { kind: "path"; path: string; notes: string[] } | { kind: "url"; url: string; notes: string[] } | { kind: "invalid"; reason: string; needsPerson?: boolean };

/** File extensions that make a last path segment a file, never a page (so no trailing slash is added). */
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
/** Endings that read like a file name, not a top-level domain, in a bare "x.html" address. */
const FILE_TLDS = new Set(["html", "htm", "php", "asp", "aspx", "jsp", "cfm", "pdf", "jpg", "jpeg", "png", "gif", "webp", "svg", "xml", "json", "txt", "css", "js", "zip", "doc", "docx", "xls", "xlsx", "mp4", "mp3", "md"]);

export function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** "www.example.com" and "example.com" are the same site for this purpose. */
export function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

export function hostSet(hosts: string[]): Set<string> {
  return new Set(hosts.filter(Boolean).map(bareHost));
}

/** The hostname of an absolute URL, or null. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * "example.com/old-page" — a host without a scheme, as Cloudflare's list
 * exports write it. "about.html" is a file, not a host.
 */
export function looksLikeBareHost(value: string): boolean {
  const match = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=\/|$)/i.exec(value);

  if (!match) return false;
  const tld = match[1]!.split(".").pop()!.toLowerCase();

  return !FILE_TLDS.has(tld) && /^[a-z]{2,24}$/.test(tld);
}

/** Decodes what percent-encoding can safely be decoded (reserved characters like %2F stay encoded). */
export function decodePath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/**
 * Encodes a stored path for a host's file: spaces, non-ASCII letters and
 * other unsafe characters become %XX; existing %XX sequences, `*` and `:`
 * are kept, so a path is never encoded twice.
 */
export function encodePath(path: string): string {
  let out = "";

  for (let index = 0; index < path.length; index += 1) {
    const char = path[index]!;

    if (char === "%") {
      out += /^[0-9A-Fa-f]{2}$/.test(path.slice(index + 1, index + 3)) ? "%" : "%25";
      continue;
    }
    if (/[A-Za-z0-9\-._~!$&'()*+,;=:@/?#[\]]/.test(char)) {
      out += char;
      continue;
    }
    const code = path.codePointAt(index)!;
    const whole = String.fromCodePoint(code);

    out += encodeURIComponent(whole);
    if (whole.length === 2) index += 1;
  }
  return out;
}

export function isWildcard(from: string): boolean {
  return from.endsWith("*");
}

/** "/blog/*" → "/blog/". */
export function wildcardPrefix(from: string): string {
  return from.slice(0, -1);
}

function splitQuery(value: string): { path: string; query: string; fragment: string } {
  const hashAt = value.indexOf("#");
  const fragment = hashAt === -1 ? "" : value.slice(hashAt);
  const beforeHash = hashAt === -1 ? value : value.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");

  return { path: queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt), query: queryAt === -1 ? "" : beforeHash.slice(queryAt), fragment };
}

/** Applies the site's trailing-slash style to a page path (never to files, wildcards or the home page). */
export function withSlashStyle(path: string, style: SlashStyle): string {
  if (path === "/" || path.endsWith("*") || path.endsWith(":splat")) return path;
  const last = path.split("/").filter(Boolean).pop() ?? "";

  if (FILE_EXTENSION.test(last)) return path.replace(/\/+$/, "");
  return style === "always" ? `${path.replace(/\/+$/, "")}/` : path.replace(/\/+$/, "") || "/";
}

function cleanPath(raw: string, notes: string[]): string {
  let path = raw.trim();

  if (!path.startsWith("/")) {
    path = `/${path}`;
    notes.push("Added the leading slash.");
  }
  if (/\/{2,}/.test(path)) {
    path = path.replace(/\/{2,}/g, "/");
    notes.push("Joined doubled slashes.");
  }
  const decoded = decodePath(path);

  if (decoded !== path) notes.push("Wrote encoded characters as plain letters.");
  return decoded;
}

/** An old address: a path on this site, a page on another domain, or something that can't be one. */
export function readOldAddress(input: string, ctx: AddressContext, options: { bareHosts?: boolean } = {}): OldAddress {
  let value = input.trim();
  const notes: string[] = [];

  if (value === "") return { kind: "invalid", reason: "The old address is empty." };
  if (/\s/.test(value)) return { kind: "invalid", reason: "The old address has a space in it. Write spaces as %20." };
  if (options.bareHosts && !value.startsWith("/") && !isAbsoluteUrl(value) && looksLikeBareHost(value)) value = `https://${value}`;
  if (value.startsWith("//")) value = `https:${value}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !isAbsoluteUrl(value)) return { kind: "invalid", reason: "The old address isn't a web address." };
  if (isAbsoluteUrl(value)) {
    let url: URL;

    try {
      url = new URL(value.replace(/\*$/, "__galley_wildcard__"));
    } catch {
      return { kind: "invalid", reason: "The old address isn't a complete web address." };
    }
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace("__galley_wildcard__", "*") + url.search.replace("__galley_wildcard__", "*");

    if (!hostSet(ctx.siteHosts).has(bareHost(host))) return { kind: "other-domain", host, path };
    notes.push("Removed the site's own address from the start.");
    value = path + (url.hash ? url.hash : "");
  }
  const parts = splitQuery(value);

  if (parts.fragment) notes.push("Dropped the part after “#”: browsers never send it, so no host can match it.");
  const path = cleanPath(parts.path, notes);

  if (path.includes("*") && (path.indexOf("*") !== path.length - 1 || !path.endsWith("/*"))) {
    if (path.indexOf("*") === path.length - 1 && !path.endsWith("/*")) {
      // "/blog*" also matches "/blogroll": say so rather than quietly widening or narrowing it.
      return { kind: "invalid", needsPerson: true, reason: "A wildcard that isn't a whole folder (like “/blog*”) also catches addresses that only start the same way. Write it as “/blog/*”." };
    }
    return { kind: "invalid", needsPerson: true, reason: "A wildcard in the middle of an address isn't something every host supports." };
  }
  if (/(^|\/):[A-Za-z]\w*/.test(path)) return { kind: "invalid", needsPerson: true, reason: "This uses a placeholder (like “:slug”), which isn't a one-to-one redirect." };
  // The old address keeps its own trailing slash: it is the old site's address, and hosts that tell
  // "/a" from "/a/" would never match a redirect whose old address was "corrected" to the new site's style.
  return { kind: "path", path: path + parts.query, notes };
}

/** A new address: a path on this site (a full address of this site is shortened to its path), or an absolute URL elsewhere. */
export function readNewAddress(input: string, ctx: AddressContext, options: { wildcard: boolean }): NewAddress {
  let value = input.trim();
  const notes: string[] = [];

  if (value === "") return { kind: "invalid", reason: "The new address is empty." };
  if (/\s/.test(value)) return { kind: "invalid", reason: "The new address has a space in it. Write spaces as %20." };
  if (value.startsWith("//")) value = `https:${value}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !isAbsoluteUrl(value)) return { kind: "invalid", reason: "The new address isn't a web address." };
  if (/:splat/.test(value) && !options.wildcard) return { kind: "invalid", needsPerson: true, reason: "The new address uses “:splat”, but the old one has no “*” for it to come from." };
  const placeholder = /(^|[/=&])(:(?!splat\b)[A-Za-z]\w*)/.exec(value.replace(/^https?:\/\/[^/]+/i, ""));

  if (placeholder) return { kind: "invalid", needsPerson: true, reason: `The new address uses the placeholder “${placeholder[2]}”, which isn't a one-to-one redirect.` };
  if (isAbsoluteUrl(value)) {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      return { kind: "invalid", reason: "The new address isn't a complete web address." };
    }
    if (!hostSet(ctx.siteHosts).has(bareHost(url.hostname))) return { kind: "url", url: value, notes };
    notes.push("Shortened the site's own address to its path.");
    value = url.pathname + url.search + url.hash;
  }
  const parts = splitQuery(value);
  let path = cleanPath(parts.path, notes);
  const styled = path.endsWith(":splat") ? path : withSlashStyle(path, ctx.trailingSlash);

  if (styled !== path && path !== "/") notes.push(ctx.trailingSlash === "always" ? "Added a trailing slash, as this site's addresses have one." : "Removed the trailing slash, as this site's addresses have none.");
  path = styled;
  return { kind: "path", path: path + parts.query + parts.fragment, notes };
}

/** The path part of a stored address (no query or fragment). */
export function pathOnly(address: string): string {
  return splitQuery(address).path;
}

export function queryOf(address: string): string {
  return splitQuery(address).query;
}

/** "/About/" and "/about" both → "/about": how the site's own pages are looked up. */
export function lookupKey(path: string): string {
  const only = decodePath(pathOnly(path));

  return `/${only.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/index\.html?$/i, "").replace(/\.html?$/i, "")}`.toLowerCase();
}
