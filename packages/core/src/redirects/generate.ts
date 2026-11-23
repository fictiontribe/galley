/**
 * Writing the list out: the files hosts read (Cloudflare's and Netlify's
 * `_redirects`, Vercel's `redirects` in vercel.json) and the exports for
 * hosts this app can't write for (CSV, nginx, Apache, a Cloudflare Bulk
 * Redirects list). Every output is in the one canonical order (match.ts)
 * and states every status code explicitly: Cloudflare reads a missing code
 * as 302 and Netlify as 301, so leaving it out would mean different things
 * on different hosts.
 */
import { createHash } from "node:crypto";
import { PRODUCT } from "../brand";
import { serializeList } from "./file";
import { canonicalOrder } from "./match";
import { encodePath, isAbsoluteUrl, isWildcard, pathOnly, queryOf, wildcardPrefix } from "./path";
import type { Redirect, RedirectExportFormat, RedirectHostId, RedirectStatus } from "./types";

/** The line that marks a `_redirects` file as written by this app, with a checksum of everything below it. */
export const CHECKSUM_PREFIX = `# ${PRODUCT.slug}-redirects-checksum: `;

export function checksum(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function header(listFile: string, host: string): string[] {
  return [
    `# Redirects for ${host}, kept in step with ${listFile} by ${PRODUCT.name}.`,
    `# Change the list there (or on the app's Redirects screen), not this file: this file is rewritten from the list.`,
  ];
}

/** Splits a `_redirects` file this app wrote into its checksum and body. Null when it carries no checksum line. */
export function readGeneratedHeader(text: string): { checksum: string; body: string } | null {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith(CHECKSUM_PREFIX));

  if (at === -1) return null;
  return { checksum: lines[at]!.slice(CHECKSUM_PREFIX.length).trim(), body: lines.slice(at + 1).join("\n") };
}

/** A URL or a path, encoded for a host's file. */
function address(value: string): string {
  return isAbsoluteUrl(value) ? value.replace(/\s/g, "%20") : encodePath(value);
}

export interface RedirectsFileOptions {
  /** The list file's path, named in the header. */
  listFile: string;
  /** Netlify: old addresses that are live pages get "!" so the redirect wins over the page (Netlify's default is the page). */
  force?: (from: string) => boolean;
  /** A download, not the file kept in step: says where it came from, carries no checksum. */
  exported?: boolean;
}

function netlifyStatus(status: RedirectStatus): 301 | 302 {
  // Netlify's docs: 301 and 302 (307 "currently unsupported"; 308 not offered). Same meaning, older code.
  return status === 307 ? 302 : status === 308 ? 301 : status;
}

function aligned(rows: string[][]): string[] {
  const widths = [0, 0];

  for (const row of rows) for (const column of [0, 1]) widths[column] = Math.min(80, Math.max(widths[column]!, row[column]!.length));
  return rows.map((row) => row.map((cell, column) => (column < row.length - 1 ? cell.padEnd(widths[column] ?? 0) : cell)).join("  ").trimEnd());
}

/**
 * A `_redirects` file. `cloudflare`: Workers static assets syntax — `from
 * to code`, no query matching (those rules are left out, the panel lists
 * them). `netlify`: query conditions between the addresses, `!` to win
 * over a live page, 301/302 only.
 */
export function renderRedirectsFile(list: Redirect[], host: "cloudflare" | "netlify", options: RedirectsFileOptions): string {
  const rows: string[][] = [];

  for (const redirect of canonicalOrder(list)) {
    const query = queryOf(redirect.from);
    const from = address(pathOnly(redirect.from));

    if (host === "cloudflare") {
      if (query) continue;
      rows.push([from, address(redirect.to), String(redirect.status)]);
    } else {
      const conditions = query ? query.slice(1).split("&").filter(Boolean).map((pair) => encodePath(pair)) : [];
      const code = `${netlifyStatus(redirect.status)}${options.force?.(redirect.from) ? "!" : ""}`;

      rows.push(conditions.length ? [from, `${conditions.join(" ")}  ${address(redirect.to)}`, code] : [from, address(redirect.to), code]);
    }
  }
  const body = `${aligned(rows).join("\n")}${rows.length ? "\n" : ""}`;

  if (options.exported) return `# Redirects exported from ${options.listFile}. Every line: old address, new address, status.\n${body}`;
  return `${[...header(options.listFile, host === "cloudflare" ? "Cloudflare" : "Netlify"), `${CHECKSUM_PREFIX}${checksum(body)}`].join("\n")}\n${body}`;
}

/** path-to-regexp treats these as syntax in a Vercel `source`; literal ones are escaped. */
function vercelLiteral(path: string): string {
  return path.replace(/[:()*+?{}]/g, (char) => `\\${char}`);
}

export interface VercelRedirect {
  source: string;
  destination: string;
  statusCode?: 301 | 302;
  permanent?: boolean;
  has?: Array<{ type: "query"; key: string; value?: string }>;
}

/** The `redirects` array of vercel.json. 307/308 as `permanent`, 301/302 as `statusCode` (vercel.com/docs/project-configuration/vercel-json#redirects). */
export function renderVercelRedirects(list: Redirect[]): VercelRedirect[] {
  return canonicalOrder(list).map((redirect) => {
    const wildcard = isWildcard(redirect.from);
    const path = pathOnly(redirect.from);
    const source = wildcard ? `${vercelLiteral(encodePath(wildcardPrefix(path)))}:path*` : vercelLiteral(encodePath(path));
    const destination = wildcard && redirect.to.endsWith(":splat") ? `${address(redirect.to.slice(0, -":splat".length))}:path*` : address(redirect.to);
    const out: VercelRedirect = { source, destination };
    const query = queryOf(redirect.from);

    if (query) {
      out.has = query
        .slice(1)
        .split("&")
        .filter(Boolean)
        .map((pair) => {
          const [key, value] = pair.split("=");

          return value === undefined ? { type: "query" as const, key: decodeURIComponent(key!) } : { type: "query" as const, key: decodeURIComponent(key!), value: decodeURIComponent(value) };
        });
    }
    if (redirect.status === 301 || redirect.status === 302) out.statusCode = redirect.status;
    else out.permanent = redirect.status === 308;
    return out;
  });
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cloudflare Bulk Redirects' list form of one redirect (also used by the API sync). */
export function bulkItem(redirect: Redirect, hostname: string): { source: string; target: string; subpath: boolean; suffix: boolean } | { reason: string } {
  if (queryOf(redirect.from)) return { reason: "Bulk Redirects can't match an old address by its query string." };
  const wildcard = isWildcard(redirect.from);
  const target = isAbsoluteUrl(redirect.to) ? redirect.to : `https://${hostname}${redirect.to}`;

  if (!wildcard) return { source: `${hostname}${encodePath(redirect.from)}`, target: address(target), subpath: false, suffix: false };
  if (redirect.to.includes(":splat") && !redirect.to.endsWith(":splat")) return { reason: "Bulk Redirects can only add what “*” matched at the end of the new address." };
  return {
    source: `${hostname}${encodePath(wildcardPrefix(redirect.from))}`,
    target: address(redirect.to.endsWith(":splat") ? target.slice(0, -":splat".length) : target),
    subpath: true,
    suffix: redirect.to.endsWith(":splat"),
  };
}

export interface ExportOptions {
  listFile: string;
  /** The site's live hostname, for the Cloudflare list (its old addresses carry the host). */
  hostname?: string;
}

const EXPORT_NAMES: Record<RedirectExportFormat, { file: string; type: string; label: string }> = {
  csv: { file: "redirects.csv", type: "text/csv", label: "Spreadsheet (CSV)" },
  "redirects-file": { file: "_redirects", type: "text/plain", label: "_redirects file (Cloudflare, Netlify)" },
  "vercel-json": { file: "vercel-redirects.json", type: "application/json", label: "Vercel (vercel.json)" },
  "cloudflare-csv": { file: "cloudflare-bulk-redirects.csv", type: "text/csv", label: "Cloudflare Bulk Redirects list (CSV)" },
  nginx: { file: "redirects.nginx.conf", type: "text/plain", label: "nginx configuration" },
  apache: { file: "redirects.htaccess", type: "text/plain", label: "Apache (.htaccess)" },
  json: { file: "redirects.json", type: "application/json", label: "The list itself (JSON)" },
};

export function exportInfo(format: RedirectExportFormat): { file: string; type: string; label: string } {
  return EXPORT_NAMES[format];
}

export const EXPORT_FORMATS = Object.keys(EXPORT_NAMES) as RedirectExportFormat[];

export function renderExport(list: Redirect[], format: RedirectExportFormat, options: ExportOptions): string {
  const ordered = canonicalOrder(list);

  switch (format) {
    case "csv":
      return `${["from,to,status,note,source", ...ordered.map((redirect) => [redirect.from, redirect.to, String(redirect.status), redirect.note ?? "", redirect.source ?? ""].map(csvCell).join(","))].join("\n")}\n`;
    case "redirects-file":
      return renderRedirectsFile(ordered, "cloudflare", { listFile: options.listFile, exported: true });
    case "vercel-json":
      return `${JSON.stringify({ redirects: renderVercelRedirects(ordered) }, null, 2)}\n`;
    case "json":
      return serializeList(ordered);
    case "cloudflare-csv": {
      if (!options.hostname) throw new Error("A hostname is needed for a Cloudflare list.");
      const lines: string[] = [];

      for (const redirect of ordered) {
        const item = bulkItem(redirect, options.hostname);

        if ("reason" in item) continue;
        // SOURCE_URL,TARGET_URL,STATUS_CODE,PRESERVE_QUERY_STRING,INCLUDE_SUBDOMAINS,SUBPATH_MATCHING,PRESERVE_PATH_SUFFIX — no header row.
        lines.push([csvCell(item.source), csvCell(item.target), String(redirect.status), queryOf(item.target) ? "FALSE" : "TRUE", "FALSE", item.subpath ? "TRUE" : "FALSE", item.suffix ? "TRUE" : "FALSE"].join(","));
      }
      return `${lines.join("\n")}\n`;
    }
    case "nginx": {
      const lines = [`# Redirects from ${options.listFile}. Put these inside the site's server { } block.`];

      for (const redirect of ordered) {
        if (queryOf(redirect.from)) {
          lines.push(`# Left out (nginx locations don't match query strings): ${redirect.from} → ${redirect.to}`);
          continue;
        }
        const to = address(redirect.to);

        if (isWildcard(redirect.from)) lines.push(`location ~ ^${regexEscape(encodePath(wildcardPrefix(redirect.from)))}(.*)$ { return ${redirect.status} ${to.endsWith(":splat") ? `${to.slice(0, -6)}$1` : to}; }`);
        else lines.push(`location = ${encodePath(redirect.from)} { return ${redirect.status} ${to}; }`);
      }
      return `${lines.join("\n")}\n`;
    }
    case "apache": {
      const lines = [`# Redirects from ${options.listFile}. RedirectMatch, so each matches its own address only (a plain Redirect also catches everything below).`];

      for (const redirect of ordered) {
        if (queryOf(redirect.from)) {
          lines.push(`# Left out (needs a RewriteCond on the query string): ${redirect.from} → ${redirect.to}`);
          continue;
        }
        const to = address(redirect.to);

        if (isWildcard(redirect.from)) lines.push(`RedirectMatch ${redirect.status} ^${regexEscape(encodePath(wildcardPrefix(redirect.from)))}(.*)$ ${to.endsWith(":splat") ? `${to.slice(0, -6)}$1` : to}`);
        else lines.push(`RedirectMatch ${redirect.status} ^${regexEscape(encodePath(redirect.from))}$ ${to}`);
      }
      return `${lines.join("\n")}\n`;
    }
  }
}

export type { GeneratedHost } from "./locate";
