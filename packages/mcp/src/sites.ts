/**
 * Which site a call is about. Over stdio there is exactly one; over HTTP the
 * server may have several open, and a call names one by id or by name.
 */
import { GalleyError } from "@galley/core";
import type { SiteRegistry, SiteService, SiteSummary } from "@galley/core/types";

export interface SiteResolver {
  /**
   * "single": one site for the life of the connection — tools take no `site`
   * argument and there is no list_sites. "many": every tool takes an optional
   * `site`, required only while more than one site is open.
   */
  readonly kind: "single" | "many";
  list(): Promise<SiteSummary[]>;
  /** The site named by id or name; with none named, the only site. Throws a plain GalleyError otherwise. */
  resolve(site?: string): Promise<SiteService>;
}

export function singleSite(site: SiteService): SiteResolver {
  return {
    kind: "single",
    async list() {
      return [await site.summary()];
    },
    async resolve() {
      return site;
    },
  };
}

function describe(list: SiteSummary[]): string {
  return list.map((s) => `“${s.name}” (${s.id})`).join(", ");
}

/** Every site the server knows and can still find on disk. */
export function registrySites(registry: SiteRegistry): SiteResolver {
  const available = async () => (await registry.list()).filter((s) => !s.missing);

  return {
    kind: "many",
    list: available,
    async resolve(wanted) {
      const list = await available();
      let match: SiteSummary | undefined;

      if (wanted === undefined || wanted.trim() === "") {
        if (list.length === 0) throw new GalleyError("not-found", "No site is open here yet. Open one in the app first.");
        if (list.length > 1) {
          throw new GalleyError("invalid", `More than one site is open here, so say which one with the \`site\` argument: ${describe(list)}.`);
        }
        match = list[0];
      } else {
        const needle = wanted.trim();
        const byName = list.filter((s) => s.name.toLowerCase() === needle.toLowerCase());

        match = list.find((s) => s.id === needle);
        if (!match && byName.length > 1) {
          throw new GalleyError("invalid", `More than one open site is called “${needle}”. Use its id instead: ${describe(byName)}.`);
        }
        match ??= byName[0];
        if (!match) throw new GalleyError("not-found", `There's no open site called “${needle}”. The open sites are: ${describe(list) || "none"}.`);
      }
      const site = await registry.get(match!.id);

      if (!site) throw new GalleyError("not-found", `The site “${match!.name}” isn't available any more.`);
      return site;
    },
  };
}
