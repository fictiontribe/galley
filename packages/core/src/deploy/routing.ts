/**
 * The routing files a site's build can carry, as each host wants them.
 *
 * Cloudflare (Workers static assets): `_redirects` and `_headers` at the root
 * of the output folder are not served as files; their text travels in the
 * upload's metadata, `assets.config._redirects` / `assets.config._headers`,
 * beside `html_handling` and `not_found_handling`, and they are left out of
 * the asset manifest. That is what Wrangler does (workers-sdk @ 1edd2f45,
 * 2026-11-23: packages/workers-utils/src/config/assets.ts reads them,
 * packages/deploy-helpers/src/deploy/helpers/create-worker-upload-form.ts
 * puts them in the assets config, packages/workers-shared/utils/helpers.ts
 * `createAssetsIgnoreFunction` keeps `/_redirects`, `/_headers` and
 * `/.assetsignore` out of the manifest). Cloudflare's docs give the limits:
 * 2,000 static + 100 dynamic redirects, 1,000 characters per redirect; 100
 * header rules, 2,000 characters per line. Past them Cloudflare skips rules
 * silently, so they are refused here instead, before anything is uploaded.
 *
 * Vercel: redirects live in vercel.json, which Vercel reads from the root of
 * the deployment's files — for a file upload, the site's own vercel.json has to
 * be one of the uploaded files (see vercel.ts).
 */
import { DeployError } from "./errors";

export const CLOUDFLARE_ROUTING_FILES = ["_redirects", "_headers"] as const;

export const CLOUDFLARE_REDIRECT_LIMITS = { static: 2_000, dynamic: 100, lineLength: 1_000 };
export const CLOUDFLARE_HEADER_LIMITS = { rules: 100, lineLength: 2_000 };

const n = (value: number) => value.toLocaleString("en-US");
const FIX_REDIRECTS = "Nothing was uploaded. Trim the list on the Redirects screen, or use “Also set them on Cloudflare” there for the rest.";

/**
 * Throws a plain refusal when a `_redirects` text is over Cloudflare's
 * documented limits. Counted the way Wrangler's parser counts: blank and `#`
 * lines don't count; a source with `*` or a `:placeholder` is dynamic, and so
 * is every rule after the first dynamic one.
 */
export function checkCloudflareRedirects(text: string): void {
  let staticRules = 0;
  let dynamicRules = 0;
  let staticAllowed = true;
  const lines = text.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();

    if (!line || line.startsWith("#")) continue;
    if (line.length > CLOUDFLARE_REDIRECT_LIMITS.lineLength) {
      throw new DeployError(
        "too-large",
        `Line ${n(index + 1)} of the site's redirects is ${n(line.length)} characters long, and Cloudflare takes redirects up to ${n(CLOUDFLARE_REDIRECT_LIMITS.lineLength)} characters each. Nothing was uploaded. Shorten it on the Redirects screen.`,
        `_redirects line ${index + 1}: ${line.slice(0, 120)}…`
      );
    }
    const tokens = line.replace(/\s+#.*$/, "").split(/\s+/);

    if (tokens.length < 2 || tokens.length > 3) continue;
    const from = tokens[0]!;

    if (staticAllowed && !from.includes("*") && !/:[A-Za-z]\w*/.test(from)) staticRules += 1;
    else {
      staticAllowed = false;
      dynamicRules += 1;
    }
  }
  if (staticRules > CLOUDFLARE_REDIRECT_LIMITS.static) {
    throw new DeployError("too-large", `The site has ${n(staticRules)} exact redirects, and Cloudflare takes up to ${n(CLOUDFLARE_REDIRECT_LIMITS.static)} (plus ${n(CLOUDFLARE_REDIRECT_LIMITS.dynamic)} with wildcards). ${FIX_REDIRECTS}`, `_redirects: ${staticRules} static, ${dynamicRules} dynamic`);
  }
  if (dynamicRules > CLOUDFLARE_REDIRECT_LIMITS.dynamic) {
    throw new DeployError(
      "too-large",
      `The site has ${n(dynamicRules)} redirects with wildcards or placeholders (or after the first one), and Cloudflare takes up to ${n(CLOUDFLARE_REDIRECT_LIMITS.dynamic)} of those. ${FIX_REDIRECTS}`,
      `_redirects: ${staticRules} static, ${dynamicRules} dynamic`
    );
  }
}

/** Throws a plain refusal when a `_headers` text is over Cloudflare's documented limits. */
export function checkCloudflareHeaders(text: string): void {
  let rules = 0;
  const lines = text.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();

    if (!line || line.startsWith("#")) continue;
    if (line.length > CLOUDFLARE_HEADER_LIMITS.lineLength) {
      throw new DeployError(
        "too-large",
        `Line ${n(index + 1)} of the site's _headers file is ${n(line.length)} characters long, and Cloudflare takes up to ${n(CLOUDFLARE_HEADER_LIMITS.lineLength)}. Nothing was uploaded. Shorten it in the site's code.`,
        `_headers line ${index + 1}`
      );
    }
    // A rule starts at a line holding a path or a full address; the header lines under it are indented "Name: value".
    if (/^([^\s]+:\/\/|\/)/.test(line)) rules += 1;
  }
  if (rules > CLOUDFLARE_HEADER_LIMITS.rules) {
    throw new DeployError("too-large", `The site's _headers file has ${n(rules)} rules, and Cloudflare takes up to ${n(CLOUDFLARE_HEADER_LIMITS.rules)}. Nothing was uploaded. Combine rules in the site's code.`, `_headers: ${rules} rules`);
  }
}

/**
 * The members of a site's vercel.json that say how the uploaded files are
 * served. Members that shape a build (buildCommand, outputDirectory,
 * framework, installCommand…) are left out of the uploaded copy: the files
 * Galley uploads are already built, and an `outputDirectory: "dist"` would
 * send Vercel looking for a folder that isn't there.
 */
export const VERCEL_ROUTING_MEMBERS = ["$schema", "redirects", "rewrites", "headers", "cleanUrls", "trailingSlash", "routes"] as const;

/** vercel.json text → the routing-only copy to upload, or null when it has nothing for serving. */
export function vercelRoutingConfig(text: string): string | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    throw new DeployError("site-file", "The site's vercel.json has a formatting mistake, so its redirects can't go online. Fix the file (the Redirects screen says where), then try again. Nothing was uploaded.", error instanceof Error ? error.message : String(error));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DeployError("site-file", "The site's vercel.json doesn't hold a set of settings, so its redirects can't go online. Fix the file, then try again. Nothing was uploaded.");
  }
  const source = parsed as Record<string, unknown>;
  const kept: Record<string, unknown> = {};

  for (const member of VERCEL_ROUTING_MEMBERS) if (member in source) kept[member] = source[member];
  return Object.keys(kept).some((key) => key !== "$schema") ? `${JSON.stringify(kept, null, 2)}\n` : null;
}
