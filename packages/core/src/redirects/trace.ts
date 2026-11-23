/**
 * "Try an address": where a visitor who types an old address ends up, and
 * through which rules. The same matcher the checks use, so what this says is
 * what the generated files do.
 */
import { createMatcher } from "./match";
import { bareHost, hostSet, isAbsoluteUrl, lookupKey, pathOnly, decodePath, type AddressContext } from "./path";
import type { SiteRoutes } from "./routes";
import type { Redirect, RedirectHostId, RedirectTrace } from "./types";

export interface TraceContext extends AddressContext {
  routes: SiteRoutes;
  host: RedirectHostId | null;
}

/** Reads what was typed: a path, or a full address of this site. */
function readInput(input: string, ctx: AddressContext): { path: string } | { otherDomain: string } {
  let value = input.trim();

  if (value === "") return { path: "/" };
  if (!value.startsWith("/") && !isAbsoluteUrl(value) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(value)) value = `https://${value}`;
  if (isAbsoluteUrl(value)) {
    try {
      const url = new URL(value);

      if (ctx.siteHosts.length && !hostSet(ctx.siteHosts).has(bareHost(url.hostname))) return { otherDomain: url.hostname };
      return { path: decodePath(url.pathname) + url.search };
    } catch {
      return { path: value };
    }
  }
  const withoutHash = value.split("#")[0]!;

  return { path: decodePath(withoutHash.startsWith("/") ? withoutHash : `/${withoutHash}`) };
}

export function traceAddress(list: Redirect[], input: string, ctx: TraceContext): RedirectTrace {
  const read = readInput(input, ctx);

  if ("otherDomain" in read) return { input, path: input, hops: [], final: input, finalKind: "external", loop: false, otherDomain: read.otherDomain };
  const matcher = createMatcher(list, { slashInsensitive: ctx.host === "netlify" });
  const route = matcher.follow(read.path);
  const final = route.final;
  let finalKind: RedirectTrace["finalKind"];
  let finalTitle: string | undefined;

  if (isAbsoluteUrl(final)) finalKind = "external";
  else {
    const page = ctx.routes.page(final);

    finalTitle = page?.title;
    // No redirect and nothing there: the visitor sees the site's missing-page page, unchanged by the list.
    finalKind = page ? "page" : ctx.routes.exists(final) ? "file" : route.hops.length === 0 ? "unchanged" : "missing";
  }
  const trace: RedirectTrace = { input, path: read.path, hops: route.hops, final, finalKind, loop: route.loop, ...(finalTitle ? { finalTitle } : {}) };

  if (route.hops.length === 0) {
    // Nothing matched: say so plainly, and point out a rule for an address that differs only by the slash or capitals.
    const key = lookupKey(read.path);
    const near = list.find((redirect) => !redirect.from.endsWith("*") && lookupKey(redirect.from) === key && pathOnly(redirect.from) !== pathOnly(read.path));

    if (near) trace.nearMiss = near.from;
  }
  return trace;
}
