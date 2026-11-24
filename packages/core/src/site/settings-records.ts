/**
 * The engine's own bookkeeping in the site's settings file: the few keys it
 * records inside actions that people below SITE_SETTINGS_LEVEL may start
 * (install/route-access.ts SITE_SETTINGS_RECORDS). Each kind of record
 * carries only its own keys, and is applied to the file as it is now — so
 * nothing a caller sends can reach any other key (the commands this server
 * runs, the publish branch, build mode, the writable files), and every other
 * line of the file stays byte for byte as it was.
 *
 * The path in is a symbol on the open site, not a method of SiteService:
 * it is what the deploy and redirects services call, not something a route,
 * the assistant or a plugin's tool is offered.
 */
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import { defaultListFile } from "../redirects/locate";
import type { GalleyConfig, RedirectsConfig, SiteModel, SiteService } from "../types";

export type SettingsRecord =
  /** Saving the redirects list for the first time: the list gets its default place (only when the file names none). */
  | { kind: "redirects-list" }
  /** The redirects screen: which host applies them, and Cloudflare's ids (absent: removed). The list keeps its place, or gets the default one. */
  | { kind: "redirects-host"; host?: RedirectsConfig["host"]; cloudflare?: RedirectsConfig["cloudflare"] }
  /** A production deploy: the host's own address, and (when no custom one is kept) the live address. */
  | { kind: "deploy-address"; defaultUrl: string; productionUrl?: string };

export const RECORD_SETTINGS: unique symbol = Symbol("site settings record");

type Recorder = (record: SettingsRecord) => Promise<SiteModel>;

/** The file with one record applied: only that record's keys change; everything else is the file as it is. */
export function applyRecord(current: GalleyConfig, record: SettingsRecord, model: Pick<SiteModel, "collections">): GalleyConfig {
  switch (record.kind) {
    case "redirects-list": {
      if (current.redirects?.file) return current;
      return { ...current, redirects: { ...current.redirects, file: defaultListFile(model) } };
    }
    case "redirects-host": {
      const { host: _host, cloudflare: _cloudflare, ...rest } = current.redirects ?? {};
      const cloudflare = record.cloudflare
        ? { ...(record.cloudflare.account ? { account: String(record.cloudflare.account) } : {}), ...(record.cloudflare.hostnames ? { hostnames: record.cloudflare.hostnames.map(String) } : {}) }
        : null;

      return { ...current, redirects: { ...rest, file: rest.file ?? defaultListFile(model), ...(record.host ? { host: record.host } : {}), ...(cloudflare && Object.keys(cloudflare).length ? { cloudflare } : {}) } };
    }
    case "deploy-address": {
      if (!current.deploy) throw new GalleyError("conflict", "The site's settings no longer say where it is put online, so the new address wasn't recorded.");
      return { ...current, deploy: { ...current.deploy, defaultUrl: String(record.defaultUrl), ...(record.productionUrl ? { productionUrl: String(record.productionUrl) } : {}) } };
    }
    default:
      throw new GalleyError("invalid", "That isn't something the engine records in the site's settings.");
  }
}

/**
 * Records one piece of bookkeeping in the site's settings file. A site
 * without the internal path (a stand-in in tests) is saved the ordinary way.
 */
export async function recordSettings(site: SiteService, record: SettingsRecord): Promise<SiteModel> {
  const recorder = (site as unknown as Record<symbol, Recorder | undefined>)[RECORD_SETTINGS];

  if (recorder) return recorder(record);
  const model = await site.model();

  return (await changeSettings(site, (current) => applyRecord(current, record, model))) ?? model;
}

/**
 * The site's settings with the version of the file they were read from
 * (null: there is no file). The version is read first, so it is never newer
 * than the settings: a save made with the two can be refused when it needn't
 * have been (the file changed between the two reads), never let through when
 * it shouldn't be.
 */
export async function readSettings(site: SiteService): Promise<{ config: GalleyConfig | null; hash: string | null }> {
  const hash = (await site.readFile(PRODUCT.configFile).catch(() => null))?.hash ?? null;

  return { config: await site.readConfig(), hash };
}

/**
 * Changes some of the site's settings on top of the file as it is: reads it
 * with its version, lets `change` make the new settings from that (null:
 * nothing to change), and saves only over that version. When the file
 * changed in between it is read and changed again, so a key somebody else
 * set meanwhile is never set back from an older read.
 */
export async function changeSettings(site: SiteService, change: (current: GalleyConfig) => GalleyConfig | null): Promise<SiteModel | null> {
  for (let attempt = 1; ; attempt += 1) {
    const { config, hash } = await readSettings(site);
    const next = change(config ?? {});

    if (!next) return null;
    try {
      return await site.saveConfig(next, hash ? { baseHash: hash } : {});
    } catch (error) {
      if (!(error instanceof GalleyError && error.code === "conflict") || attempt >= 3) throw error;
    }
  }
}
