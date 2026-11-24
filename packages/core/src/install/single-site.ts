/**
 * The site registry of a hosted install: exactly one site, or none yet.
 *
 * The rule is kept here, in the engine, not only at the HTTP layer: whatever
 * reaches the registry — a route, the assistant, a plugin — sees at most the
 * one site, and every way of adding, removing, scanning for or filing sites
 * refuses. The install's own connect path (`admit`) is the only way a site
 * gets in.
 */
import { GalleyError } from "../errors";
import { siteIdFor } from "../site/util";
import type { Job, SiteRegistry, SiteService, SiteSummary } from "../types";

/** The one sentence every multi-site action is refused with on a hosted install. */
export const ONE_SITE_MESSAGE = "This editor looks after one site. Each site gets an editor of its own.";

export function oneSiteOnly(): GalleyError {
  return new GalleyError("forbidden", ONE_SITE_MESSAGE);
}

export interface SingleSiteRegistry extends SiteRegistry {
  readonly singleSite: true;
  /** The one site's id, when a site is connected. */
  siteId(): string | null;
  /** Opens `root` as the one site. The install's connect path, and nothing else, calls this. */
  admit(root: string): Promise<SiteService>;
  /** Closes the one site (before a restore puts another folder in its place). Its files stay. */
  release(): Promise<void>;
}

export interface SingleSiteOptions {
  /** The connected site's folder, or null while nothing is connected. Read on every call. */
  root: () => string | null;
  /** Jobs the install runs itself (connecting the site), so GET /api/jobs/:id finds them. */
  jobs?: (id: string) => Job | null;
}

export function isSingleSiteRegistry(registry: SiteRegistry): registry is SingleSiteRegistry {
  return (registry as Partial<SingleSiteRegistry>).singleSite === true;
}

export function createSingleSiteRegistry(inner: SiteRegistry, options: SingleSiteOptions): SingleSiteRegistry {
  const oneId = (): string | null => {
    const root = options.root();

    return root ? siteIdFor(root) : null;
  };
  const refuse = async (): Promise<never> => {
    throw oneSiteOnly();
  };

  return {
    singleSite: true,
    siteId: oneId,

    async admit(root) {
      return inner.open({ path: root });
    },

    async release() {
      const id = oneId();

      if (id) await inner.remove(id);
    },

    async list(): Promise<SiteSummary[]> {
      const id = oneId();

      if (!id) return [];
      return (await inner.list()).filter((site) => site.id === id);
    },

    async get(id) {
      const mine = oneId();

      if (!mine || id !== mine) return null;
      const site = await inner.get(id);

      if (site) return site;
      // The list of sites lost its record (a restore, a hand-edited file): the folder is still the site.
      const root = options.root();

      return root ? inner.open({ path: root }).catch(() => null) : null;
    },

    open: refuse,
    clone: refuse,
    create: refuse,
    remove: refuse,
    update: refuse,
    createGroup: refuse,
    updateGroup: refuse,
    removeGroup: refuse,
    orderGroups: refuse,
    scan: refuse,
    addMany: refuse,
    async groups() {
      return [];
    },

    starters: () => inner.starters(),
    starterPreview: (starterId, lookId) => inner.starterPreview(starterId, lookId),
    job: (id) => inner.job(id) ?? options.jobs?.(id) ?? null,

    async thumbnail(id) {
      return id === oneId() && inner.thumbnail ? inner.thumbnail(id) : null;
    },
    touch(id) {
      if (id === oneId()) inner.touch?.(id);
    },

    dispose: () => inner.dispose(),
  };
}
