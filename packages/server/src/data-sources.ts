/**
 * Plugin data sources over HTTP: the one route a field's picker calls to
 * search a source ("products in the store") or to look up the value a file
 * already holds. Behind the session guard like every API route; it only
 * reads, and the plugin gets the site read-only.
 */
import { z } from "zod";
import type { Context } from "hono";
import type { DataSourceAnswer } from "@galley/core/api";
import { GalleyError } from "@galley/core";
import { ensureSitePlugins, type DataSourceItem } from "@galley/core/plugins";
import { notFound } from "./errors";
import type { RouteContext, RouteTable } from "./routes";
import * as v from "./validate";

/** What `GET /api/sites/:siteId/data-sources/:sourceId` answers (the contract's `DataSourceAnswer`). */
export type DataSourceResponse = DataSourceAnswer;

export const DATA_SOURCE_ROUTE = "GET /api/sites/:siteId/data-sources/:sourceId";
const TIMEOUT_MS = 15_000;

export const dataSourceQuery = z
  .object({
    /** Search: what the person typed. */
    q: z.string().max(200).optional(),
    /** Look-up: the value a file holds. */
    value: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict()
  .refine((query) => !(query.q !== undefined && query.value !== undefined), "ask for a search (q) or a look-up (value), not both");

/** Only what the picker shows leaves the server, trimmed to sensible sizes. */
function clean(item: unknown): DataSourceItem | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;

  if (typeof record.value !== "string" || !record.value || typeof record.title !== "string") return null;
  const out: DataSourceItem = { value: record.value.slice(0, 500), title: record.title.slice(0, 200) };

  if (typeof record.image === "string" && /^(https:\/\/|\/)/.test(record.image)) out.image = record.image.slice(0, 2000);
  if (typeof record.detail === "string" && record.detail) out.detail = record.detail.slice(0, 200);
  return out;
}

async function handle(c: Context, ctx: RouteContext): Promise<DataSourceResponse> {
  const plugins = ctx.services.plugins;
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  if (!plugins) throw notFound("Plugins aren't available on this server.");
  await ensureSitePlugins(plugins, site);
  const id = c.req.param("sourceId") ?? "";
  const info = plugins.dataSources(site.root).find((source) => source.id === id);
  const found = info ? plugins.dataSource(id, site) : null;

  if (!info || !found) throw notFound(`Nothing called “${id.slice(0, 60)}” offers values here. Check that its plugin is switched on.`);
  const query = v.query(c, dataSourceQuery);
  const limit = query.limit ?? 12;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  timer.unref?.();
  try {
    const context = await found.context(controller.signal, limit);
    const timeout = new Promise<never>((_resolve, reject) =>
      controller.signal.addEventListener("abort", () => reject(new GalleyError("ai", `${info.label} took too long to answer. Try again in a moment.`)), { once: true })
    );

    if (query.value !== undefined) {
      const item = await Promise.race([Promise.resolve(found.contribution.get(query.value, context)), timeout]);

      return { source: info, item: clean(item) };
    }
    const items = await Promise.race([Promise.resolve(found.contribution.search(query.q ?? "", context)), timeout]);

    return { source: info, items: (Array.isArray(items) ? items : []).map(clean).filter((item): item is DataSourceItem => item !== null).slice(0, limit) };
  } catch (error) {
    if (error instanceof GalleyError) throw error;
    // The plugin's own words are kept only when it threw a plain sentence; the logger already scrubbed secrets from its log.
    throw new GalleyError("ai", `${info.label} couldn't be searched just now. ${error instanceof Error && error.message.length < 300 ? error.message : "Try again in a moment."}`);
  } finally {
    clearTimeout(timer);
  }
}

export const dataSourceRoutes: Pick<RouteTable, typeof DATA_SOURCE_ROUTE> = {
  [DATA_SOURCE_ROUTE]: handle,
};
