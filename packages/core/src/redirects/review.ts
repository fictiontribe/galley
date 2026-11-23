/**
 * "Add many": what a pasted list would do to the site's redirects, before
 * anything is written. The parsed lines are merged with the list (or replace
 * it), each kind of problem is settled by the resolution in force, and the
 * review says — in groups, in plain words — what was understood, what was
 * left out and why, and what would change. The same function with the same
 * input gives the same list, so confirming writes exactly what was reviewed.
 *
 * Loops are refused: they block confirming until the person chooses to leave
 * them out.
 */
import { checkRedirects, hostUsage } from "./check";
import { HOST_INFO } from "./info";
import { canonicalOrder } from "./match";
import type { SiteRoutes } from "./routes";
import type { ImportMode, ImportProblem, ImportResolutions, ImportReview, ParsedRedirect, ParseResult, Redirect, RedirectHostId, RedirectIssue } from "./types";

export interface ReviewOptions {
  mode: ImportMode;
  resolutions?: ImportResolutions;
  routes: SiteRoutes;
  host: RedirectHostId | null;
}

export type FullResolutions = Required<ImportResolutions>;

export const DEFAULT_RESOLUTIONS: FullResolutions = {
  duplicates: "keep-first",
  conflicts: "keep-first",
  chains: "flatten",
  livePages: "leave-out",
  missingStatus: 301,
  brokenTargets: "keep",
  loops: "refuse",
};

const n = (count: number) => count.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const MAX_EXAMPLES = 20;
const MAX_PREVIEW = 500;

type Item = Redirect & { line?: number; imported: boolean };

const same = (a: Redirect, b: Redirect) => a.to === b.to && a.status === b.status;

export interface ReviewOutcome {
  review: ImportReview;
  /** The whole list as it would be saved. */
  result: Redirect[];
}

function example(item: { from: string; to?: string; line?: number }, detail?: string) {
  return { from: item.from, ...(item.to !== undefined ? { to: item.to } : {}), ...(item.line !== undefined ? { line: item.line } : {}), ...(detail ? { detail } : {}) };
}

export function reviewImport(existing: Redirect[], parsed: ParseResult, options: ReviewOptions): ReviewOutcome {
  const resolutions: FullResolutions = { ...DEFAULT_RESOLUTIONS, ...stripUndefined(options.resolutions ?? {}) };
  const problems: ImportProblem[] = [];
  const add = (problem: ImportProblem) => {
    if (problem.count > 0) problems.push({ ...problem, examples: problem.examples.slice(0, MAX_EXAMPLES) });
  };

  // 1. Lines without a kind take the chosen one.
  const missing = parsed.redirects.filter((redirect) => redirect.statusMissing);
  const incoming: ParsedRedirect[] = parsed.redirects.map((redirect) => (redirect.statusMissing ? { ...redirect, status: resolutions.missingStatus } : redirect));

  add({
    code: "missing-status",
    severity: "warning",
    count: missing.length,
    title: `${plural(missing.length, "line")} didn't say permanent or temporary`,
    body: "Hosts disagree here: Cloudflare reads a missing kind as temporary, Netlify as permanent, Apache as temporary. Choose what these are.",
    resolution: { key: "missingStatus", value: String(resolutions.missingStatus), options: [{ value: "301", label: "Permanent (301)" }, { value: "302", label: "Temporary (302)" }] },
    examples: missing.map((redirect) => example(redirect)),
  });

  // 2. Within the import: the same old address twice.
  const firstByFrom = new Map<string, ParsedRedirect>();
  const duplicates: ParsedRedirect[] = [];
  const conflicts: Array<{ kept: Redirect & { line?: number }; other: Redirect & { line?: number } }> = [];

  for (const redirect of incoming) {
    const first = firstByFrom.get(redirect.from);

    if (!first) {
      firstByFrom.set(redirect.from, redirect);
      continue;
    }
    if (same(first, redirect)) duplicates.push(redirect);
    else {
      conflicts.push({ kept: first, other: redirect });
      if (resolutions.conflicts === "keep-last") firstByFrom.set(redirect.from, redirect);
    }
  }
  add({
    code: "duplicate",
    severity: "info",
    count: duplicates.length,
    title: `${plural(duplicates.length, "duplicate")}`,
    body: "The same old address with the same new address appears more than once. Only one is kept.",
    resolution: { key: "duplicates", value: "keep-first", options: [{ value: "keep-first", label: "Keep the first" }] },
    examples: duplicates.map((redirect) => example(redirect, `line ${redirect.line}`)),
  });

  // 3. Against the list already there.
  const items = new Map<string, Item>();

  if (options.mode === "add") for (const redirect of existing) if (!items.has(redirect.from)) items.set(redirect.from, { ...redirect, imported: false });
  let unchanged = 0;

  for (const redirect of firstByFrom.values()) {
    const current = items.get(redirect.from);
    const item: Item = { from: redirect.from, to: redirect.to, status: redirect.status, ...(redirect.note ? { note: redirect.note } : {}), ...(redirect.source ? { source: redirect.source } : {}), line: redirect.line, imported: true };

    if (!current) {
      items.set(redirect.from, item);
      continue;
    }
    if (same(current, redirect)) {
      unchanged += 1;
      continue;
    }
    conflicts.push({ kept: current, other: item });
    // "first" is the list's own redirect, which came before the import.
    if (resolutions.conflicts === "keep-last") items.set(redirect.from, item);
  }
  add({
    code: "conflict",
    severity: "warning",
    count: conflicts.length,
    title: `${plural(conflicts.length, "old address", "old addresses")} sent to two places`,
    body: "Each old address can go to one place only. Choose which one stays.",
    resolution: {
      key: "conflicts",
      value: resolutions.conflicts === "keep-last" ? "keep-last" : "keep-first",
      options: [
        { value: "keep-first", label: options.mode === "add" ? "Keep the first (the list's own wins)" : "Keep the first" },
        { value: "keep-last", label: "Use the last" },
      ],
    },
    examples: conflicts.map(({ kept, other }) => example({ from: kept.from, to: resolutions.conflicts === "keep-last" ? other.to : kept.to, ...(other.line !== undefined ? { line: other.line } : {}) }, `also ${resolutions.conflicts === "keep-last" ? kept.to : other.to}`)),
  });

  // 4. Redirects to themselves are never kept.
  let list = [...items.values()];
  const selfIssues = checkRedirects(list, { routes: options.routes, host: options.host, only: ["self"] });
  const selfSet = new Set(selfIssues.flatMap((issue) => issue.indices).filter((index) => list[index]!.imported));

  add({
    code: "self",
    severity: "info",
    count: selfSet.size,
    title: `${plural(selfSet.size, "redirect")} to the same address`,
    body: "These point at themselves, so they're left out.",
    examples: [...selfSet].map((index) => example(list[index]!)),
  });
  list = list.filter((_, index) => !selfSet.has(index));

  // 5. Old addresses that are live pages.
  const live = checkRedirects(list, { routes: options.routes, host: options.host, only: ["live-page"] }).filter((issue) => list[issue.indices[0]!]!.imported);

  add({
    code: "live-page",
    severity: "warning",
    count: live.length,
    title: `${plural(live.length, "would hide a live page", "would hide live pages")}`,
    body: "These old addresses are pages the site still has. Redirecting them means visitors never see those pages again.",
    resolution: { key: "livePages", value: resolutions.livePages, options: [{ value: "leave-out", label: "Leave them out" }, { value: "keep", label: "Redirect anyway" }] },
    examples: live.map((issue) => example(list[issue.indices[0]!]!, issue.detail ? `“${issue.detail}”` : undefined)),
  });
  if (resolutions.livePages === "leave-out") {
    const drop = new Set(live.map((issue) => issue.indices[0]!));

    list = list.filter((_, index) => !drop.has(index));
  }

  // 6. Loops: refused until left out.
  const loops = checkRedirects(list, { routes: options.routes, host: options.host, only: ["loop"] });
  const loopMembers = new Set(loops.flatMap((issue) => issue.indices));
  const loopImported = [...loopMembers].filter((index) => list[index]!.imported);

  add({
    code: "loop",
    severity: resolutions.loops === "leave-out" ? "info" : "error",
    count: loops.length,
    title: `${plural(loops.length, "loop")}`,
    body: "These send visitors round in a circle, so they can't be added. Leave them out, or fix the addresses and paste again.",
    resolution: { key: "loops", value: resolutions.loops, options: [{ value: "leave-out", label: "Leave them out" }] },
    examples: loops.map((issue) => example({ from: list[issue.indices[0]!]!.from, to: list[issue.indices[0]!]!.to, ...(list[issue.indices[0]!]!.line !== undefined ? { line: list[issue.indices[0]!]!.line! } : {}) }, issue.message)),
  });
  if (resolutions.loops === "leave-out" && loopImported.length) {
    // The import's side of each loop goes; when a loop is only the list's own, it is left for the list's checks to show.
    const drop = new Set(loopImported);

    list = list.filter((_, index) => !drop.has(index));
  }

  // 7. Chains: point straight at the final address.
  const chains = checkRedirects(list, { routes: options.routes, host: options.host, only: ["chain"] });

  add({
    code: "chain",
    severity: "warning",
    count: chains.length,
    title: `${plural(chains.length, "chain")}`,
    body: "These go through more than one redirect before arriving. Pointing each straight at the final address is faster for visitors and keeps search rankings.",
    resolution: { key: "chains", value: resolutions.chains, options: [{ value: "flatten", label: "Point straight to the final address" }, { value: "keep", label: "Keep the steps" }] },
    examples: chains.map((issue) => example(list[issue.indices[0]!]!, `→ ${issue.suggestion}`)),
  });
  if (resolutions.chains === "flatten") {
    list = list.map((item, index) => {
      const chain = chains.find((issue) => issue.indices[0] === index);

      if (!chain?.suggestion) return item;
      return { ...item, to: chain.suggestion };
    });
  }

  // 8. New addresses that lead nowhere.
  const broken = checkRedirects(list, { routes: options.routes, host: options.host, only: ["broken-target"] }).filter((issue) => list[issue.indices[0]!]!.imported);
  const fixable = broken.filter((issue) => issue.suggestion);

  add({
    code: "broken-target",
    severity: "warning",
    count: broken.length,
    title: `${plural(broken.length, "new address", "new addresses")} not found on this site`,
    body: fixable.length ? "Nothing is at these addresses on the site yet. Some are a page written slightly differently, which can be used instead." : "Nothing is at these addresses on the site yet. Keep them if the pages are still to come.",
    resolution: {
      key: "brokenTargets",
      value: resolutions.brokenTargets,
      options: [{ value: "keep", label: "Keep them" }, ...(fixable.length ? [{ value: "use-suggestion", label: "Use the page that matches" }] : []), { value: "leave-out", label: "Leave them out" }],
    },
    examples: broken.map((issue) => example(list[issue.indices[0]!]!, issue.suggestion ? `the page is ${issue.suggestion}` : undefined)),
  });
  if (resolutions.brokenTargets === "leave-out") {
    const drop = new Set(broken.map((issue) => issue.indices[0]!));

    list = list.filter((_, index) => !drop.has(index));
  } else if (resolutions.brokenTargets === "use-suggestion") {
    const fix = new Map(fixable.map((issue) => [issue.indices[0]!, issue.suggestion!]));

    list = list.map((item, index) => (fix.has(index) ? { ...item, to: fix.get(index)! } : item));
  }

  // 9. Informational: query strings, adjustments made while reading.
  const final = canonicalOrder(list);
  const finalIssues = checkRedirects(final, { routes: options.routes, host: options.host, only: ["from-query", "host-limit"] });
  const queries = finalIssues.filter((issue) => issue.code === "from-query" && (final[issue.indices[0]!] as Item).imported);

  add({
    code: "from-query",
    severity: options.host === "cloudflare" ? "warning" : "info",
    count: queries.length,
    title: `${plural(queries.length, "old address", "old addresses")} with a query string`,
    body: options.host ? HOST_INFO[options.host].queryStrings : "Hosts differ on whether an old address can be matched by its query string (the part after “?”).",
    examples: queries.map((issue) => example(final[issue.indices[0]!]!)),
  });
  const notes = new Map<string, ParsedRedirect[]>();

  for (const redirect of parsed.redirects) {
    for (const note of redirect.notes) {
      const lines = notes.get(note);

      if (lines) lines.push(redirect);
      else notes.set(note, [redirect]);
    }
  }
  for (const [note, lines] of notes) {
    add({ code: "note", severity: "info", count: lines.length, title: `${plural(lines.length, "line")}: ${note.replace(/\.$/, "").replace(/^./, (char) => char.toLowerCase())}`, body: note, examples: lines.map((redirect) => example(redirect)) });
  }

  // 10. Lines not read.
  const rejectedBy = (kind: "malformed" | "needs-person" | "other-domain") => parsed.rejected.filter((line) => line.kind === kind);

  add({
    code: "malformed",
    severity: "warning",
    count: rejectedBy("malformed").length,
    title: `${plural(rejectedBy("malformed").length, "line")} not understood`,
    body: "These lines weren't read as redirects and won't be added. Each says why.",
    examples: rejectedBy("malformed").map((line) => ({ from: line.text, line: line.line, detail: line.reason })),
  });
  add({
    code: "needs-person",
    severity: "warning",
    count: rejectedBy("needs-person").length,
    title: `${plural(rejectedBy("needs-person").length, "line needs", "lines need")} a person`,
    body: "These are real rules, but more than a plain redirect from one address to another. They won't be added; a developer can carry them over by hand.",
    examples: rejectedBy("needs-person").map((line) => ({ from: line.text, line: line.line, detail: line.reason })),
  });
  add({
    code: "other-domain",
    severity: "warning",
    count: rejectedBy("other-domain").length,
    title: `${plural(rejectedBy("other-domain").length, "old address", "old addresses")} on another domain`,
    body: parsed.unknownHosts.length ? `These start with ${parsed.unknownHosts.map((host) => host.host).slice(0, 3).join(", ")}. If that is this site's address, say so and they're read as this site's.` : "These are on another domain, which this site's redirects can't answer for.",
    examples: rejectedBy("other-domain").map((line) => ({ from: line.text, line: line.line, detail: line.reason })),
  });

  if (options.host) {
    const usage = hostUsage(final, options.host);

    if (usage.over) {
      const limit = finalIssues.find((issue) => issue.code === "host-limit" && issue.indices.length === 0);

      add({ code: "host-limit", severity: "warning", count: 1, title: `Over ${HOST_INFO[options.host].name}'s limits`, body: limit?.message ?? "", examples: [] });
    }
  }

  const before = new Map(existing.map((redirect) => [redirect.from, redirect]));
  let addCount = 0;
  let change = 0;
  const preview: ImportReview["preview"] = [];

  for (const item of final as Item[]) {
    const was = options.mode === "add" ? before.get(item.from) : undefined;
    const state: "new" | "changed" | "same" = !was ? "new" : same(was, item) ? "same" : "changed";

    if (!item.imported && state === "same") continue;
    if (state === "new") addCount += 1;
    if (state === "changed") change += 1;
    if (preview.length < MAX_PREVIEW) preview.push({ from: item.from, to: item.to, status: item.status, ...(item.note ? { note: item.note } : {}), ...(item.source ? { source: item.source } : {}), ...(item.line !== undefined ? { line: item.line } : {}), state });
  }
  // Lines that were read but aren't in the result: duplicates and unchanged ones aren't "left out", they're already there.
  const leftOut = parsed.redirects.length - (final as Item[]).filter((item) => item.imported).length - unchanged - duplicates.length;
  const blocking = resolutions.loops === "refuse" ? loops.length : 0;
  const result = final.map(({ line: _line, imported: _imported, ...redirect }) => redirect as Redirect);

  return {
    result,
    review: {
      format: parsed.format,
      formatLabel: parsed.formatLabel,
      understood: parsed.redirects.length,
      rejected: parsed.rejected,
      ignored: parsed.ignored,
      unknownHosts: parsed.unknownHosts,
      preview,
      counts: { add: addCount, change, same: unchanged, leftOut: Math.max(0, leftOut) + parsed.rejected.length, total: result.length },
      problems: problems.sort((a, b) => rank(a) - rank(b)),
      resolutions,
      blocking,
      mode: options.mode,
    },
  };
}

function rank(problem: ImportProblem): number {
  return problem.severity === "error" ? 0 : problem.severity === "warning" ? 1 : 2;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/** Issues the list has, for showing in the list (not the review). */
export function listIssues(list: Redirect[], routes: SiteRoutes, host: RedirectHostId | null): RedirectIssue[] {
  return checkRedirects(list, { routes, host });
}
