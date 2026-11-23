/**
 * Order and matching. Every host applies the first rule that matches, top to
 * bottom (Netlify, Cloudflare), or needs exact rules ahead of wildcards
 * (Cloudflare: "static redirects should appear before dynamic redirects").
 * So there is one order, used for the list file and every host's file:
 * exact addresses first, alphabetically (stable, readable diffs), then
 * wildcards, the longest — most specific — first, so "/blog/2020/*" is
 * never hidden behind "/blog/*". With wildcards that only ever end a path,
 * that order is always right, which is why the list is never reordered by
 * hand.
 *
 * `createMatcher` is the one implementation of "where does this address
 * go": chains, loops and "try an address" all use it.
 */
import { decodePath, isAbsoluteUrl, isWildcard, pathOnly, queryOf, wildcardPrefix } from "./path";
import type { Redirect, RedirectHop } from "./types";

const codepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function compareRedirects(a: Redirect, b: Redirect): number {
  const wa = isWildcard(a.from);
  const wb = isWildcard(b.from);

  if (wa !== wb) return wa ? 1 : -1;
  if (wa) return wildcardPrefix(b.from).length - wildcardPrefix(a.from).length || codepoint(a.from, b.from);
  return codepoint(a.from, b.from);
}

/** The list in its one order. Stable: equal old addresses keep the order they came in. */
export function canonicalOrder<T extends Redirect>(list: T[]): T[] {
  return list
    .map((redirect, index) => ({ redirect, index }))
    .sort((a, b) => compareRedirects(a.redirect, b.redirect) || a.index - b.index)
    .map((entry) => entry.redirect);
}

export interface Match {
  index: number;
  redirect: Redirect;
  /** The new address, with what `*` matched put in for `:splat`. */
  to: string;
}

export interface Matcher {
  /** The rule a request for `address` (a path, maybe with a query) meets first. */
  match(address: string): Match | null;
  /** Follows hops from `address` until it leaves the list, loops, or reaches `limit`. */
  follow(address: string, limit?: number): { hops: RedirectHop[]; final: string; loop: boolean };
}

export interface MatcherOptions {
  /** Netlify matches "/a" and "/a/" alike. */
  slashInsensitive?: boolean;
}

const slashTwin = (path: string) => (path === "/" ? path : path.endsWith("/") ? path.slice(0, -1) : `${path}/`);

/**
 * `list` in any order: the matcher applies first-match over the canonical
 * order, which is the order every generated file uses. Duplicated old
 * addresses resolve to the first.
 */
export function createMatcher(list: Redirect[], options: MatcherOptions = {}): Matcher {
  const exact = new Map<string, number>();
  const wildcards: Array<{ prefix: string; index: number }> = [];
  const order = list.map((redirect, index) => ({ redirect, index })).sort((a, b) => compareRedirects(a.redirect, b.redirect) || a.index - b.index);

  for (const { redirect, index } of order) {
    if (isWildcard(redirect.from)) wildcards.push({ prefix: wildcardPrefix(redirect.from), index });
    else {
      const key = decodePath(redirect.from);

      if (!exact.has(key)) exact.set(key, index);
      if (options.slashInsensitive && !exact.has(slashTwin(pathOnly(key)) + queryOf(key))) exact.set(slashTwin(pathOnly(key)) + queryOf(key), index);
    }
  }

  function match(address: string): Match | null {
    const decoded = decodePath(address);
    const path = pathOnly(decoded);
    // An old address with a query matches only that query; one without matches whatever query the visitor brings.
    const hit = exact.get(decoded) ?? exact.get(path);

    if (hit !== undefined) return { index: hit, redirect: list[hit]!, to: list[hit]!.to };
    for (const { prefix, index } of wildcards) {
      const bare = prefix.replace(/\/$/, "");

      // "/blog/*" covers "/blog/" and below; only a host that ignores the trailing slash also sends "/blog".
      if (path.startsWith(prefix) || (options.slashInsensitive && path === bare)) {
        const rest = path.startsWith(prefix) ? path.slice(prefix.length) : "";
        const redirect = list[index]!;

        return { index, redirect, to: redirect.to.replace(":splat", rest) };
      }
    }
    return null;
  }

  return {
    match,
    follow(address, limit = 12) {
      const hops: RedirectHop[] = [];
      const seen = new Set<string>([decodePath(address)]);
      let current = address;

      for (let step = 0; step < limit; step += 1) {
        if (isAbsoluteUrl(current)) break;
        const next = match(current);

        if (!next) break;
        hops.push({ from: current, to: next.to, status: next.redirect.status, index: next.index, rule: next.redirect.from });
        const key = decodePath(next.to);

        if (seen.has(key) || (!isAbsoluteUrl(next.to) && seen.has(pathOnly(key)))) return { hops, final: next.to, loop: true };
        seen.add(key);
        current = next.to;
      }
      return { hops, final: current, loop: false };
    },
  };
}
