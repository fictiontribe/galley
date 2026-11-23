/**
 * Every way a list of redirects goes wrong, found before a visitor finds it:
 * duplicates and conflicts, redirects to themselves, chains (a → b → c) and
 * loops (a → b → a), old addresses that are still live pages, new addresses
 * that lead nowhere, query strings hosts disagree about, and the chosen
 * host's limits. Pure: the site's pages come in as `SiteRoutes`.
 */
import { HOST_INFO } from "./info";
import { createMatcher } from "./match";
import { isAbsoluteUrl, isWildcard, lookupKey, pathOnly, queryOf, wildcardPrefix } from "./path";
import { hiddenPages, type SiteRoutes } from "./routes";
import type { Redirect, RedirectHostId, RedirectIssue, RedirectIssueCode, RedirectUsage } from "./types";

export interface CheckContext {
  routes: SiteRoutes;
  host: RedirectHostId | null;
  /** Only these checks (the import review asks for one kind at a time). Default: all. */
  only?: RedirectIssueCode[];
}

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** What the chosen host can take: exact and wildcard counts, and what it leaves out. */
export function hostUsage(list: Redirect[], host: RedirectHostId | null): RedirectUsage {
  const leftOut: RedirectUsage["leftOut"] = [];
  let exact = 0;
  let dynamic = 0;

  for (const redirect of list) {
    if (host === "cloudflare" && queryOf(redirect.from)) {
      leftOut.push({ from: redirect.from, reason: "Cloudflare can't match an old address by its query string." });
      continue;
    }
    if (isWildcard(redirect.from) || redirect.to.includes(":splat")) dynamic += 1;
    else exact += 1;
  }
  const limits = host ? HOST_INFO[host].limits : null;
  const over = Boolean(limits && ((limits.static !== null && exact > limits.static) || (limits.dynamic !== null && dynamic > limits.dynamic) || (limits.total !== null && exact + dynamic > limits.total)));

  return { static: exact, dynamic, total: exact + dynamic, leftOut, over };
}

export function checkRedirects(list: Redirect[], ctx: CheckContext): RedirectIssue[] {
  const all: RedirectIssue[] = [];
  const only = ctx.only ? new Set(ctx.only) : null;
  const want = (...codes: RedirectIssueCode[]) => !only || codes.some((code) => only.has(code));
  const issues = { push: (issue: RedirectIssue) => (!only || only.has(issue.code) ? all.push(issue) : 0) };
  const byFrom = new Map<string, number[]>();
  const byLower = new Map<string, Set<string>>();

  list.forEach((redirect, index) => {
    const indices = byFrom.get(redirect.from);

    if (indices) indices.push(index);
    else byFrom.set(redirect.from, [index]);
    const lower = redirect.from.toLowerCase();
    const twins = byLower.get(lower);

    if (twins) twins.add(redirect.from);
    else byLower.set(lower, new Set([redirect.from]));
  });

  // Duplicates and conflicts: hosts use the first and silently ignore the rest.
  for (const [from, indices] of want("duplicate", "conflict") ? byFrom : []) {
    if (indices.length < 2) continue;
    const first = list[indices[0]!]!;
    const conflicting = indices.slice(1).filter((index) => list[index]!.to !== first.to);
    const same = indices.slice(1).filter((index) => list[index]!.to === first.to);

    if (same.length) issues.push({ code: "duplicate", severity: "warning", indices: [indices[0]!, ...same], message: `${from} is listed ${plural(same.length + 1, "time")}. Only the first counts.` });
    if (conflicting.length) {
      issues.push({ code: "conflict", severity: "error", indices: [indices[0]!, ...conflicting], message: `${from} is sent to ${conflicting.length + 1} different places. Visitors only ever reach the first, ${first.to}.` });
    }
  }
  for (const twins of want("case-twin") ? byLower.values() : []) {
    if (twins.size < 2) continue;
    const names = [...twins];
    const indices = names.map((name) => byFrom.get(name)![0]!);

    issues.push({ code: "case-twin", severity: "info", indices, message: `${names.join(" and ")} differ only in capital letters. Most hosts treat them as different addresses, so both are kept.` });
  }

  // Chains, loops and broken targets need to know where each address goes; the other checks don't.
  const matcher = want("self", "loop", "chain", "live-page", "broken-target") ? createMatcher(list, { slashInsensitive: ctx.host === "netlify" }) : createMatcher([]);
  const inLoop = new Set<number>();

  (want("splat-without-wildcard", "self", "loop", "chain", "live-page") ? list : []).forEach((redirect, index) => {
    const target = redirect.to;

    if (redirect.to.includes(":splat") && !isWildcard(redirect.from)) {
      issues.push({ code: "splat-without-wildcard", severity: "error", indices: [index], message: `${redirect.to} uses what “*” matched, but ${redirect.from} has no “*”.` });
    }
    if (!isAbsoluteUrl(target) && !isWildcard(redirect.from) && (lookupKey(redirect.from) === lookupKey(target) && queryOf(redirect.from) === queryOf(target))) {
      issues.push({
        code: "self",
        severity: "error",
        indices: [index],
        message: redirect.from === target ? `${redirect.from} redirects to itself.` : `${redirect.from} and ${target} are the same page apart from capitals or the trailing slash, so it sends visitors round in a circle on some hosts.`,
      });
      return;
    }
    // Chains and loops: only where the new address is a concrete page on this site.
    if (isAbsoluteUrl(target) || target.includes(":splat") || inLoop.has(index)) return;
    const route = matcher.follow(target);

    if (route.loop) {
      const members = [index, ...route.hops.map((hop) => hop.index)].filter((member, at, all) => all.indexOf(member) === at);

      for (const member of members) inLoop.add(member);
      issues.push({ code: "loop", severity: "error", indices: members, message: `${loopPath(redirect.from, target, route.hops).join(" → ")} goes round in a circle. Visitors would never arrive anywhere.` });
      return;
    }
    if (route.hops.length > 0 && route.hops[0]!.index !== index) {
      issues.push({
        code: "chain",
        severity: "warning",
        indices: [index, ...route.hops.map((hop) => hop.index)],
        message: `${redirect.from} → ${[target, ...route.hops.map((hop) => hop.to)].join(" → ")} takes ${route.hops.length + 1} steps. Pointing it straight at ${route.final} is faster and keeps search rankings.`,
        detail: route.final,
        suggestion: route.final,
      });
    }
  });

  (want("live-page", "broken-target", "from-query", "host-unsupported", "host-limit") ? list : []).forEach((redirect, index) => {
    // An old address that is still a page: the page becomes unreachable.
    const hidden = want("live-page") ? hiddenPages(ctx.routes, redirect.from) : [];

    if (hidden.length && !inLoop.has(index)) {
      issues.push(
        isWildcard(redirect.from)
          ? {
              code: "live-page",
              severity: "warning",
              indices: [index],
              detail: hidden[0]!.title,
              message: `Everything under ${wildcardPrefix(redirect.from)} is redirected, which hides ${plural(hidden.length, "live page")} there, like “${hidden[0]!.title}”.`,
            }
          : { code: "live-page", severity: "warning", indices: [index], detail: hidden[0]!.title, message: `${redirect.from} is the live page “${hidden[0]!.title}”. Visitors would never see it again.` }
      );
    }
    const target = redirect.to;

    if (want("broken-target") && !isAbsoluteUrl(target) && !target.includes(":splat")) {
      const page = ctx.routes.page(target);
      const redirected = matcher.match(target);

      if (page && pathOnly(target) !== page.url && !redirected) {
        issues.push({ code: "broken-target", severity: "warning", indices: [index], detail: page.title, suggestion: page.url + queryOf(target), message: `${target} is written differently from the page's own address, ${page.url}. Hosts that tell capitals or the trailing slash apart would show a missing page.` });
      } else if (!page && !redirected && !ctx.routes.exists(target)) {
        issues.push({ code: "broken-target", severity: "warning", indices: [index], message: `Nothing on this site is at ${target}, so visitors would land on a missing page.` });
      }
    }
    if (queryOf(redirect.from)) {
      const message =
        ctx.host === "cloudflare"
          ? `${redirect.from} has a query string. Cloudflare can't match old addresses by query, so it's left out of Cloudflare's file.`
          : ctx.host === "netlify"
            ? `${redirect.from} has a query string. Netlify matches it only when a visitor's query is exactly this.`
            : ctx.host === "vercel"
              ? `${redirect.from} has a query string. Vercel matches it with a query condition.`
              : `${redirect.from} has a query string. Hosts differ on whether they can match one.`;

      issues.push({ code: "from-query", severity: ctx.host === "cloudflare" ? "warning" : "info", indices: [index], message });
    }
    if (ctx.host === "netlify" && (redirect.status === 307 || redirect.status === 308)) {
      issues.push({ code: "host-unsupported", severity: "warning", indices: [index], message: `Netlify's docs offer 301 and 302 only, so this ${redirect.status} is written as ${redirect.status === 308 ? 301 : 302} for Netlify.` });
    }
    const limit = ctx.host ? HOST_INFO[ctx.host].limits.lineLength : null;

    if (limit !== null && redirect.from.length + redirect.to.length + 5 > limit) {
      issues.push({ code: "host-limit", severity: "error", indices: [index], message: `This redirect is longer than the ${limit.toLocaleString("en-US")} characters ${HOST_INFO[ctx.host!].name} allows for one.` });
    }
  });

  // Order: a wildcard written before the exact addresses it covers would hide them on every host. Files are written specific-first, so this only reports.
  (want("shadowed") ? list : []).forEach((redirect, index) => {
    if (!isWildcard(redirect.from)) return;
    const prefix = wildcardPrefix(redirect.from);
    const hidden: number[] = [];

    for (let later = index + 1; later < list.length && hidden.length < 50; later += 1) {
      const other = list[later]!.from;

      if (other !== redirect.from && other.startsWith(prefix)) hidden.push(later);
    }
    if (hidden.length) {
      issues.push({ code: "shadowed", severity: "info", indices: [index, ...hidden], message: `${redirect.from} comes before ${plural(hidden.length, "address", "addresses")} it covers. They're written ahead of it in the host's file, so each still works.` });
    }
  });

  if (ctx.host && want("host-limit")) {
    const usage = hostUsage(list, ctx.host);
    const info = HOST_INFO[ctx.host];
    const { limits } = info;

    if (usage.over) {
      const parts: string[] = [];

      if (limits.static !== null && usage.static > limits.static) parts.push(`${plural(usage.static, "exact address", "exact addresses")} (the limit is ${limits.static.toLocaleString("en-US")})`);
      if (limits.dynamic !== null && usage.dynamic > limits.dynamic) parts.push(`${plural(usage.dynamic, "wildcard")} (the limit is ${limits.dynamic.toLocaleString("en-US")})`);
      if (!parts.length && limits.total !== null) parts.push(`${plural(usage.total, "redirect")} (the limit is ${limits.total.toLocaleString("en-US")})`);
      issues.push({
        code: "host-limit",
        severity: "error",
        indices: [],
        message: `${info.name}'s file takes fewer: this list has ${parts.join(" and ")}.${ctx.host === "cloudflare" ? " Set them on Cloudflare instead, which takes many more." : ""}`,
      });
    }
    if (ctx.host === "netlify" && list.length >= 10_000) {
      issues.push({ code: "host-limit", severity: "info", indices: [], message: "Netlify suggests wildcards for lists of 10,000 or more, and a deploy can fail when its redirects are too large." });
    }
  }
  return all;
}

/**
 * The circle as a visitor walks it, from the redirect's old address back to
 * the first address seen again: /a/ → /b/ → /a/. `follow` starts from the new
 * address, so the old one and the new one lead the list.
 */
function loopPath(from: string, to: string, hops: ReadonlyArray<{ to: string }>): string[] {
  const path = [from, to];
  const seen = new Set([lookupKey(from), lookupKey(to)]);

  if (lookupKey(from) === lookupKey(to)) return path;
  for (const hop of hops) {
    path.push(hop.to);
    if (seen.has(lookupKey(hop.to))) break;
    seen.add(lookupKey(hop.to));
  }
  return path;
}
