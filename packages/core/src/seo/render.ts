/**
 * Where rendered pages come from, without side effects: the running preview
 * (through its proxy, which reflects the working tree) or, failing that, the
 * last build's output folder. The audit never starts a preview or runs a
 * build to get them; when neither exists the rendered checks are skipped and
 * the report says so.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { OVERLAY_SCRIPT_PATH } from "../api";
import { stripBase } from "./html";
import type { SiteModel, SiteService } from "../types";

export interface Fetched {
  status: number;
  body: string;
  type: string;
  /** The address it ended at, after redirects. */
  finalPath: string;
}

export interface RenderSource {
  kind: "preview" | "build";
  /** The site's base path ("" or "/docs"). Every address the source takes and gives is without it. */
  base: string;
  detail: string;
  stale: boolean;
  /** Every page address the source knows of (the build's HTML files); null when it can't list them (the preview). */
  pages(): Promise<string[] | null>;
  /**
   * A page as the site serves it; null when it didn't answer. `patient`
   * waits longer and asks again rather than reusing an earlier failure: a
   * preview compiles each page the first time it is asked for.
   */
  get(urlPath: string, options?: { patient?: boolean }): Promise<Fetched | null>;
  /** Bytes of a file the site serves (images), when it can be read. */
  size(urlPath: string): Promise<number | null>;
}

const FETCH_TIMEOUT_MS = 6_000;
/** A dev server's first request can wait on its dependency pass and first compile; well past the usual timeout. */
const PATIENT_TIMEOUT_MS = 30_000;

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000);

  if (minutes < 2) return "just now";
  if (minutes < 90) return `${minutes} minutes old`;
  const hours = Math.round(minutes / 60);

  return hours < 36 ? `${hours} hours old` : `${Math.round(hours / 24)} days old`;
}

/** The overlay script the preview proxy injects isn't part of the site. */
function stripOverlay(html: string): string {
  return html.replace(new RegExp(`<script[^>]*${OVERLAY_SCRIPT_PATH.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[^>]*>\\s*</script>`, "g"), "");
}

function previewSource(origin: string, base: string): RenderSource {
  const cache = new Map<string, Promise<Fetched | null>>();

  async function get(input: string, options: { patient?: boolean } = {}): Promise<Fetched | null> {
    const urlPath = stripBase(input, base);
    let hit = cache.get(urlPath);

    if (hit && options.patient) {
      const earlier = await hit;

      // A page that didn't answer (or failed while compiling) is asked again; one that answered is kept.
      if (!earlier || earlier.status >= 500) hit = undefined;
    }
    if (!hit) {
      const timeout = options.patient ? PATIENT_TIMEOUT_MS : FETCH_TIMEOUT_MS;

      hit = (async () => {
        try {
          const response = await fetch(new URL(`${base}${urlPath}`, origin), { signal: AbortSignal.timeout(timeout), redirect: "follow", headers: { accept: "text/html,text/plain,*/*" } });
          const type = response.headers.get("content-type") ?? "";
          const body = /text|xml|json|markdown/.test(type) ? await response.text() : "";

          return { status: response.status, body: /html/.test(type) ? stripOverlay(body) : body, type, finalPath: stripBase(new URL(response.url).pathname, base) };
        } catch {
          return null;
        }
      })();
      cache.set(urlPath, hit);
    }
    return hit;
  }
  return {
    kind: "preview",
    base,
    detail: "the running preview (your unpublished changes included)",
    stale: false,
    pages: async () => null,
    get,
    async size(urlPath) {
      try {
        const response = await fetch(new URL(`${base}${stripBase(urlPath, base)}`, origin), { method: "HEAD", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        const length = Number(response.headers.get("content-length"));

        return response.ok && Number.isFinite(length) && length > 0 ? length : null;
      } catch {
        return null;
      }
    },
  };
}

const TYPES: Record<string, string> = { html: "text/html", xml: "application/xml", txt: "text/plain", md: "text/markdown", json: "application/json" };

/**
 * A build's output folder holds the site without its base path: a page
 * served at /docs/about/ is dist/about/index.html. Addresses read from the
 * pages (links, twins, canonicals) carry the base, so it is taken off first.
 */
function buildSource(dir: string, builtAt: number, newestContent: number, base: string): RenderSource {
  const fileFor = (urlPath: string): string[] => {
    let path = stripBase(urlPath.split(/[?#]/)[0] ?? "/", base);

    try {
      path = decodeURI(path);
    } catch {
      // Keep it as written.
    }
    if (path.split("/").includes("..")) return [];
    const rel = path.replace(/^\/+/, "");

    if (rel === "") return ["index.html"];
    if (path.endsWith("/")) return [`${rel}index.html`];
    if (/\.[a-z0-9]+$/i.test(rel)) return [rel];
    return [`${rel}/index.html`, `${rel}.html`];
  };
  const stale = newestContent > builtAt + 1000;

  return {
    kind: "build",
    base,
    detail: `the last build (${ago(Date.now() - builtAt)}${stale ? "; content has changed since" : ""})`,
    stale,
    async pages() {
      const files = await glob("**/*.html", { cwd: dir, onlyFiles: true });

      return files.map((file) => (file === "index.html" ? "/" : file.endsWith("/index.html") ? `/${file.slice(0, -"index.html".length)}` : `/${file.replace(/\.html$/, "")}`));
    },
    async get(urlPath) {
      for (const candidate of fileFor(urlPath)) {
        const absolute = join(dir, ...candidate.split("/"));

        if (!absolute.startsWith(dir)) continue;
        try {
          const body = await readFile(absolute, "utf8");
          const ext = candidate.split(".").pop()?.toLowerCase() ?? "";

          return { status: 200, body, type: TYPES[ext] ?? "application/octet-stream", finalPath: stripBase(urlPath, base) };
        } catch {
          // Try the next shape.
        }
      }
      return { status: 404, body: "", type: "", finalPath: stripBase(urlPath, base) };
    },
    async size(urlPath) {
      const [candidate] = fileFor(urlPath);

      if (!candidate) return null;
      const info = await stat(join(dir, ...candidate.split("/"))).catch(() => null);

      return info?.isFile() ? info.size : null;
    },
  };
}

const CONFIGS = ["astro.config.ts", "astro.config.mjs", "astro.config.js", "astro.config.mts"];

/** A base path the site's own config states (`base: "/docs"`), or "". */
async function configBase(site: SiteService): Promise<string> {
  for (const name of CONFIGS) {
    const text = (await site.readFile(name).catch(() => null))?.content;
    const base = text ? /\bbase\s*:\s*["'](\/[^"']*)["']/.exec(text)?.[1] : undefined;

    if (base) return base.replace(/\/+$/, "");
    if (text) return "";
  }
  return "";
}

/**
 * The base path a build was made with, from its home page: a base given on
 * the command line (`astro build --base /repo`) is in no config file, but the
 * page's own addresses carry it — its markdown version (/repo/index.md),
 * its preferred address, or its bundled files (/repo/_astro/…).
 */
export function baseFromHome(html: string): string {
  const twin = /<link[^>]*type=["']text\/markdown["'][^>]*href=["'](\/[^"']*?)\/index\.md["']|<link[^>]*href=["'](\/[^"']*?)\/index\.md["'][^>]*type=["']text\/markdown["']/i.exec(html);

  if (twin) return twin[1] ?? twin[2] ?? "";
  const asset = /(?:src|href)=["'](\/[^"'\s]+?)\/_astro\//i.exec(html);

  if (asset) return asset[1]!;
  const canonical = /<link[^>]*rel=["']canonical["'][^>]*href=["']https?:\/\/[^/"']+(\/[^"']*)["']/i.exec(html)?.[1];

  return canonical && canonical !== "/" ? canonical.replace(/\/+$/, "") : "";
}

/** The preview when it is running, else the build output when there is one, else null. Never starts anything. */
export async function findRenderSource(site: SiteService, model: SiteModel, newestContent: number): Promise<RenderSource | null> {
  const status = site.preview().status();

  if (status.state === "ready" && status.url) return previewSource(status.url, await configBase(site));
  if (!model.build?.outDir) return null;
  let dir: string;

  try {
    dir = site.resolvePath(model.build.outDir);
  } catch {
    return null;
  }
  if (!existsSync(join(dir, "index.html"))) return null;
  const info = await stat(join(dir, "index.html")).catch(() => null);

  if (!info) return null;
  const stated = await configBase(site);
  const home = stated ? "" : await readFile(join(dir, "index.html"), "utf8").catch(() => "");

  return buildSource(dir, info.mtimeMs, newestContent, stated || baseFromHome(home));
}
