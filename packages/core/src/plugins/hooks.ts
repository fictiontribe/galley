/**
 * Plugin hooks around the site facade. The composer wraps its SiteRegistry
 * once; every site it hands out — to the server's routes, the assistant, the
 * MCP endpoint — publishes through `beforePublish` / `afterPublish`, and
 * loads the plugins its own config names. Nothing below SiteService changes.
 */
import type { PublishCheck, PublishRequest, PublishResult, SiteRegistry, SiteService } from "../types";
import type { PluginRegistry } from "./registry";
import { ensureSitePlugins } from "./site";

/** The changes a publish would include: everything pending, or the paths asked for. */
async function pendingFor(site: SiteService, request: PublishRequest) {
  const changes = await site.changes();

  if (!request.paths) return changes;
  const wanted = new Set(request.paths);
  const files = changes.files.filter((file) => wanted.has(file.path));

  return {
    ...changes,
    files,
    totals: { files: files.length, additions: files.reduce((sum, file) => sum + file.additions, 0), deletions: files.reduce((sum, file) => sum + file.deletions, 0) },
  };
}

export interface HookOptions {
  env?: NodeJS.ProcessEnv;
  /** Where a failure to load a site's plugins is noted. */
  log?: (line: string) => void;
  /** Runs after the registry's own dispose (stop the plugins with the sites). */
  onDispose?: () => Promise<void>;
}

/** What the plugins' publish checks say about publishing these changes now: warnings, and whether one would stop it. Changes nothing. */
export async function checkPublish(site: SiteService, plugins: PluginRegistry, request: PublishRequest = {}, env?: NodeJS.ProcessEnv): Promise<PublishCheck> {
  await ensureSitePlugins(plugins, site, env);
  const changes = await pendingFor(site, request);

  if (changes.files.length === 0) return { warnings: [], refusal: null };
  return plugins.checkPublish(site, changes);
}

/** One site, publishing through the plugins' hooks. Wrapping twice returns the same object. */
export function withSiteHooks(site: SiteService, plugins: PluginRegistry, options: HookOptions = {}): SiteService {
  const load = () => ensureSitePlugins(plugins, site, options.env).catch((error: unknown) => options.log?.(`A site's plugins couldn't be loaded: ${String(error)}`));

  void load();
  return new Proxy(site, {
    get(target, property, receiver) {
      if (property === "publish") {
        return async (request: PublishRequest = {}): Promise<PublishResult> => {
          await load();
          const { refusal, warnings } = await plugins.checkPublish(target, await pendingFor(target, request), { stopAtRefusal: true });

          if (refusal) {
            return { ok: false, files: [], pushed: false, error: `${refusal.plugin} stopped this publish: ${refusal.message}`, detail: `beforePublish refused (${refusal.plugin})` };
          }
          const result = await target.publish(request);

          // After hooks run in the background, one after another: a slow webhook never holds the publish up.
          if (result.ok) void plugins.afterPublish(target, result);
          // Warnings never stop a publish; they travel with the result so the person reads them in the outcome too.
          return warnings.length ? { ...result, warnings } : result;
        };
      }
      if (property === "refresh") {
        return async () => {
          const model = await target.refresh();

          await load();
          return model;
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;

      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** The registry, handing out sites that publish through the plugins' hooks. */
export function withPluginHooks<R extends SiteRegistry>(registry: R, plugins: PluginRegistry, options: HookOptions = {}): R {
  const wrapped = new WeakMap<SiteService, SiteService>();
  const wrap = (site: SiteService | null) => {
    if (!site) return site;
    let out = wrapped.get(site);

    if (!out) wrapped.set(site, (out = withSiteHooks(site, plugins, options)));
    return out;
  };

  return new Proxy(registry, {
    get(target, property, receiver) {
      if (property === "get") return async (id: string) => wrap(await target.get(id));
      if (property === "open") return async (request: Parameters<SiteRegistry["open"]>[0]) => wrap(await target.open(request)) as SiteService;
      if (property === "dispose") {
        return async () => {
          await target.dispose();
          await options.onDispose?.();
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;

      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
