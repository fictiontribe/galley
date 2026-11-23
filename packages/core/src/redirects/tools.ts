/**
 * The assistant's (and MCP's) view of the redirects: one read-only tool that
 * checks the list and traces addresses through it. Changing the list needs
 * no tool of its own — it is a data file, edited with the existing entry
 * tools; the app keeps the host's redirect file in step after each edit.
 */
import { z } from "zod";
import { plural } from "../ai/tools/labels";
import { defineTool, ok, READ_ONLY, type AssistantTool } from "../ai/tools/types";
import { checkRedirects, hostUsage } from "./check";
import { readList } from "./file";
import { HOST_INFO } from "./info";
import { derivedPath, hostOf, isGeneratedHost, listFileOf, slashStyleOf } from "./locate";
import { siteRoutes } from "./routes";
import { traceAddress } from "./trace";

const checkRedirectsTool = defineTool({
  name: "check_redirects",
  title: "Check the redirects",
  description:
    "Check the site's redirects (old addresses sent to new ones): duplicates, conflicts, chains, loops, old addresses that are still live pages, new addresses with nothing there, and the host's limits. Optionally trace up to 20 addresses to say where a visitor ends up. The list is a data file (its path is in the result): to change it, read it with read_entry and edit its `redirects` list with update_entry — one object per redirect: `from` (a path, may end in `*`), `to` (a path or https:// address, may end in `:splat`), `status` (301 or 308 permanent, 302 or 307 temporary). The app regenerates the host's redirect file after each edit; never edit that file.",
  input: z.object({ addresses: z.array(z.string().max(2000)).max(20).optional() }),
  mode: "any",
  effect: READ_ONLY,
  label: (input) => (input.addresses?.length ? `Trying ${plural(input.addresses.length, "address", "addresses")}` : "Checking the redirects"),
  async run(input, ctx) {
    const model = await ctx.site.model();
    const file = listFileOf(model);
    const text = await ctx.site.readFile(file).catch(() => null);
    const read = text ? readList(text.content) : { ok: true as const, redirects: [] };
    const host = hostOf(model).id;
    const routes = await siteRoutes(ctx.site, model);
    const issues = checkRedirects(read.redirects, { routes, host });
    const traces = (input.addresses ?? []).map((address) => traceAddress(read.redirects, address, { siteHosts: [model.urls.production, model.urls.staging].filter((url): url is string => Boolean(url)).map((url) => new URL(url).hostname), trailingSlash: slashStyleOf(model), routes, host }));

    return ok(
      {
        file,
        exists: Boolean(text),
        ...(read.ok ? {} : { problem: read.problem }),
        count: read.redirects.length,
        host: host ? { id: host, name: HOST_INFO[host].name, file: isGeneratedHost(host) ? derivedPath(host, model) : null } : null,
        usage: host ? hostUsage(read.redirects, host) : null,
        issues: issues.slice(0, 50).map((issue) => ({ code: issue.code, severity: issue.severity, message: issue.message, redirects: issue.indices.slice(0, 5).map((index) => read.redirects[index]).filter(Boolean), ...(issue.suggestion ? { suggestion: issue.suggestion } : {}) })),
        ...(traces.length ? { traces: traces.map((trace) => ({ address: trace.input, final: trace.final, kind: trace.finalKind, ...(trace.finalTitle ? { title: trace.finalTitle } : {}), steps: trace.hops.map((hop) => `${hop.from} → ${hop.to} (${hop.status})`), loop: trace.loop, ...(trace.nearMiss ? { nearMiss: trace.nearMiss } : {}) })) } : {}),
      },
      issues.some((issue) => issue.severity === "error") ? `Checked ${plural(read.redirects.length, "redirect")} · found problems` : `Checked ${plural(read.redirects.length, "redirect")}`
    );
  },
});

export const REDIRECT_TOOLS: AssistantTool[] = [checkRedirectsTool];
