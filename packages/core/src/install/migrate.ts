/**
 * Upgrading a data folder to the layout this version knows. Run at start-up
 * before anything else reads the folder, so a new image on an old data
 * folder upgrades itself — and a folder a newer version wrote is refused
 * rather than misread.
 *
 * MIGRATIONS[n] takes a folder at layout n to layout n + 1. Layout 0 is a
 * data folder from before installs had a state file: a hosted server that
 * kept any number of sites in `<home>/sites.json`.
 */
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import { runGit } from "../workspace/git";
import { redactAddress } from "./address";
import { INSTALL_SCHEMA_VERSION } from "./types";
import type { InstallStateFile } from "./state";

export interface MigrationContext {
  home: string;
  /** GALLEY_SITE_DIR: which of several old sites to keep (a folder, absolute or relative to the data folder). */
  keepSite?: string | null;
  now: Date;
}

export type Migration = (state: unknown, context: MigrationContext) => Promise<unknown>;

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);

  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

interface OldSite {
  root: string;
  name: string;
  branch: string | null;
  remoteUrl: string | null;
}

async function oldSites(home: string): Promise<OldSite[]> {
  let text: string;

  try {
    text = await readFile(join(home, "sites.json"), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GalleyError(
      "conflict",
      `The list of sites in ${join(home, "sites.json")} can't be read, so it isn't clear which site this install should look after. Fix or remove that file, then start again.`
    );
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { sites?: unknown }).sites;

  if (!Array.isArray(list)) return [];
  return list.flatMap((record: unknown) => {
    const r = record as Record<string, unknown>;

    return r && typeof r.root === "string"
      ? [{ root: r.root, name: typeof r.name === "string" ? r.name : r.root, branch: typeof r.branch === "string" ? r.branch : null, remoteUrl: typeof r.remoteUrl === "string" ? r.remoteUrl : null }]
      : [];
  });
}

async function originOf(root: string): Promise<string | null> {
  const result = await runGit(root, ["remote", "get-url", "--", "origin"], { allowFailure: true, readOnly: true }).catch(() => null);
  const url = result?.code === 0 ? result.text.trim() : "";

  return url ? redactAddress(url) : null;
}

/** 0 → 1: give the folder its state file, adopting the one site it had (in place) when there was exactly one. */
const toVersion1: Migration = async (_state, { home, keepSite, now }) => {
  const homeReal = realOrResolved(home);
  const sites = await oldSites(home);
  let chosen: OldSite | null = null;

  if (sites.length > 1) {
    const wanted = keepSite?.trim();

    if (!wanted) {
      const names = sites.map((site) => relative(homeReal, realOrResolved(site.root)) || site.root);

      throw new GalleyError(
        "conflict",
        `This data folder holds ${sites.length} sites (${names.join(", ")}), and a hosted ${PRODUCT.name} now looks after one site. ` +
          `Set GALLEY_SITE_DIR to the folder of the one this install should keep — for example GALLEY_SITE_DIR=${names[0]} — and start again. ` +
          "The other folders are left on disk untouched; each can have an install of its own."
      );
    }
    const target = realOrResolved(isAbsolute(wanted) ? wanted : join(home, wanted));

    chosen = sites.find((site) => realOrResolved(site.root) === target) ?? null;
    if (!chosen) {
      throw new GalleyError("conflict", `GALLEY_SITE_DIR names ${target}, which isn't one of the sites this data folder holds. Name one of them and start again.`);
    }
  } else {
    chosen = sites[0] ?? null;
  }

  let site: InstallStateFile["site"] = null;

  if (chosen) {
    const root = realOrResolved(chosen.root);

    if (!inside(homeReal, root)) {
      throw new GalleyError(
        "conflict",
        `The site in ${root} is outside this install's data folder (${homeReal}), and an install keeps everything in its data folder. ` +
          `Move the site's folder into it (for example to ${join(homeReal, "site")}) and start again.`
      );
    }
    site = {
      root: relative(homeReal, root).split(sep).join("/"),
      folder: null,
      repository: (await originOf(root)) ?? (chosen.remoteUrl ? redactAddress(chosen.remoteUrl) : null),
      branch: chosen.branch,
      // It reached its repository however the server's own git was set up; that keeps working.
      access: "none",
      connectedAt: now.toISOString(),
      starter: null,
    };
  }
  const state: InstallStateFile = {
    schema: 1,
    createdAt: now.toISOString(),
    password: null,
    setup: { tokenSha256: null, finishedAt: site ? now.toISOString() : null },
    sessions: { validAfter: 0, revoked: [] },
    site,
    liveUrl: null,
    pendingLiveUrl: null,
    lastBackupAt: null,
    seeded: [],
  };

  return state;
};

export const MIGRATIONS: Migration[] = [toVersion1];

/** Runs every migration from `from` up to this version's layout. */
export async function migrate(state: unknown, from: number, context: MigrationContext): Promise<unknown> {
  if (from > INSTALL_SCHEMA_VERSION) {
    throw new GalleyError(
      "conflict",
      `This data folder was last used by a newer version of ${PRODUCT.name} (data layout ${from}; this version knows up to ${INSTALL_SCHEMA_VERSION}). ` +
        "Start the newer version again — an older one can't use the folder safely."
    );
  }
  let current = state;

  for (let version = from; version < INSTALL_SCHEMA_VERSION; version += 1) {
    const step = MIGRATIONS[version];

    if (!step) throw new GalleyError("internal", `There's no way to upgrade a data folder from layout ${version}.`);
    current = await step(current, context);
  }
  return current;
}
