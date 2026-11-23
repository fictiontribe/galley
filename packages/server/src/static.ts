/**
 * Hosting the built web UI: hashed assets cached for a year, index.html never
 * cached, unknown paths fall back to index.html (client-side routing), and a
 * plain page explaining how to build the UI when it isn't there.
 */
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { BrandConfig } from "@galley/core/types";
import { isInside } from "./fs-list";
import { contentTypeFor } from "./mime";

export const IMMUTABLE = "public, max-age=31536000, immutable";

export interface StaticFile {
  absolute: string;
  size: number;
  contentType: string;
  cacheControl: string;
}

/** Vite puts content-hashed files under /assets/. */
function isHashedAsset(urlPath: string): boolean {
  return urlPath.startsWith("/assets/");
}

async function fileAt(root: string, relativePath: string): Promise<{ absolute: string; size: number } | null> {
  const candidate = join(root, relativePath);
  const real = await realpath(candidate).catch(() => null);

  if (!real || !isInside(root, real)) return null;
  const info = await stat(real).catch(() => null);

  return info?.isFile() ? { absolute: real, size: info.size } : null;
}

export async function resolveStatic(webDir: string | null, urlPath: string): Promise<StaticFile | "not-built" | "missing"> {
  if (!webDir) return "not-built";
  const root = await realpath(webDir).catch(() => null);

  if (!root) return "not-built";
  const index = await fileAt(root, "index.html");

  if (!index) return "not-built";
  let decoded: string;

  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return "missing";
  }
  const segments = decoded.split("/").filter(Boolean);

  if (segments.some((segment) => segment === ".." || segment.includes("\\") || segment.includes("\0"))) return "missing";
  const relativePath = segments.join("/");

  if (relativePath && relativePath !== "index.html") {
    const file = await fileAt(root, relativePath);

    if (file) {
      return {
        ...file,
        contentType: contentTypeFor(relativePath),
        cacheControl: isHashedAsset(urlPath) ? IMMUTABLE : "no-cache",
      };
    }
    // A missing hashed asset is a stale page asking for an old build: say so, don't serve HTML as JS.
    if (isHashedAsset(urlPath)) return "missing";
  }
  return { ...index, contentType: "text/html; charset=utf-8", cacheControl: "no-cache" };
}

export function fileResponse(file: StaticFile, headers: Record<string, string>, head = false): Response {
  const body = head ? null : (Readable.toWeb(createReadStream(file.absolute)) as ReadableStream<Uint8Array>);

  return new Response(body, {
    status: 200,
    headers: { ...headers, "content-type": file.contentType, "content-length": String(file.size), "cache-control": file.cacheControl },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Shown when the server runs but packages/web hasn't been built. */
export function notBuiltPage(brand: BrandConfig): string {
  const name = escapeHtml(brand.productName);
  const accent = brand.accent && /^#[0-9a-f]{3,8}$/i.test(brand.accent) ? brand.accent : "#1f1d1a";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — interface not built</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText;
         font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 34rem; padding: 2.5rem 2rem; }
  .eyebrow { font: 12px/1 ui-monospace, "SF Mono", Menlo, monospace; text-transform: uppercase; letter-spacing: .08em; opacity: .65; }
  h1 { font: 500 1.9rem/1.2 ui-serif, Georgia, serif; margin: .6rem 0 1rem; }
  code { font: 14px ui-monospace, "SF Mono", Menlo, monospace; padding: .15rem .4rem; border-radius: 4px; background: color-mix(in srgb, CanvasText 8%, transparent); }
  .rule { height: 3px; width: 3rem; background: ${accent}; margin-bottom: 1.5rem; }
</style>
</head>
<body>
<main>
  <div class="rule"></div>
  <div class="eyebrow">${name}</div>
  <h1>The interface hasn't been built yet.</h1>
  <p>The server is running, but there's no web interface to show. Build it, then reload this page:</p>
  <p><code>pnpm --filter @galley/web build</code></p>
  <p>Your sites and files are untouched.</p>
</main>
</body>
</html>
`;
}
