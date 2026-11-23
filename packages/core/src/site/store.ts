/**
 * The list of known sites, persisted as `<home>/sites.json`. Written
 * atomically (temp file + rename) so a crash never leaves half a list; a
 * missing or unreadable file starts an empty list, and an unreadable one is
 * kept as `sites.json.bak` so nothing the user had is silently destroyed.
 *
 * Version 2 adds what an agency organises its sites with — groups, pins and a
 * note per site — and the facts the Sites screen shows for a closed site
 * (pending changes, versions not sent, the live address…), so listing never
 * has to open a site to show them. Version 1 files (and the bare array an
 * early build wrote) load unchanged: every new field is optional, and the
 * file is rewritten as version 2 the next time anything is saved.
 */
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FrameworkInfo, SiteFacts, SiteGroup, SiteGroupColor } from "../types";

export interface SiteRecord {
  id: string;
  /** Absolute real path of the site folder. */
  root: string;
  name: string;
  framework: FrameworkInfo;
  lastOpenedAt: number;
  /** Last known branch and (credential-free) remote, shown while the site is closed. */
  branch?: string;
  remoteUrl?: string;
  /** The group (client) this site is filed under. */
  group?: string;
  pinned?: boolean;
  note?: string;
  /** When the site was added to the list (bulk adds have never been opened). */
  addedAt?: number;
  /** What the list shows while the site is closed, refreshed in the background. */
  facts?: SiteFacts;
  /** Repo-relative path of the site's own share image, when one was found. */
  thumbnail?: string;
  /** The live address the site's settings named the last time it was open. */
  liveUrl?: string;
}

export const GROUP_COLORS: SiteGroupColor[] = ["ink", "pencil", "green", "ochre", "rose", "sky", "plum"];

interface StoreFile {
  version: 2;
  sites: SiteRecord[];
  groups: SiteGroup[];
}

const MAX_NOTE = 500;
const MAX_GROUP_NAME = 80;

function isRecord(value: unknown): value is SiteRecord {
  const record = value as SiteRecord;

  return (
    typeof record === "object" &&
    record !== null &&
    typeof record.id === "string" &&
    typeof record.root === "string" &&
    typeof record.name === "string" &&
    typeof record.framework === "object" &&
    record.framework !== null &&
    typeof record.framework.id === "string" &&
    typeof record.lastOpenedAt === "number"
  );
}

function isFacts(value: unknown): value is SiteFacts {
  const facts = value as SiteFacts;

  return typeof facts === "object" && facts !== null && typeof facts.checkedAt === "number" && typeof facts.pendingChanges === "number";
}

/** Keeps only the fields this version understands, with their types checked: a hand-edited file can't smuggle anything in. */
function cleanRecord(raw: SiteRecord): SiteRecord {
  const record: SiteRecord = {
    id: raw.id,
    root: raw.root,
    name: raw.name,
    framework: { id: raw.framework.id, name: typeof raw.framework.name === "string" ? raw.framework.name : raw.framework.id, ...(typeof raw.framework.version === "string" ? { version: raw.framework.version } : {}) },
    lastOpenedAt: raw.lastOpenedAt,
  };

  if (typeof raw.branch === "string") record.branch = raw.branch;
  if (typeof raw.remoteUrl === "string") record.remoteUrl = raw.remoteUrl;
  if (typeof raw.group === "string" && raw.group) record.group = raw.group;
  if (raw.pinned === true) record.pinned = true;
  if (typeof raw.note === "string" && raw.note.trim()) record.note = raw.note.slice(0, MAX_NOTE);
  if (typeof raw.addedAt === "number") record.addedAt = raw.addedAt;
  if (isFacts(raw.facts)) record.facts = raw.facts;
  if (typeof raw.thumbnail === "string" && raw.thumbnail) record.thumbnail = raw.thumbnail;
  if (typeof raw.liveUrl === "string" && /^https?:\/\//.test(raw.liveUrl)) record.liveUrl = raw.liveUrl;
  return record;
}

function isGroup(value: unknown): value is SiteGroup {
  const group = value as SiteGroup;

  return typeof group === "object" && group !== null && typeof group.id === "string" && typeof group.name === "string";
}

function cleanGroup(raw: SiteGroup): SiteGroup {
  return {
    id: raw.id,
    name: raw.name.slice(0, MAX_GROUP_NAME),
    color: GROUP_COLORS.includes(raw.color) ? raw.color : "ink",
    collapsed: raw.collapsed === true,
  };
}

export type SiteStore = Awaited<ReturnType<typeof createSiteStore>>;

export async function createSiteStore(home: string) {
  const file = join(home, "sites.json");
  const records = new Map<string, SiteRecord>();
  /** In the order the person arranged them. */
  let groups: SiteGroup[] = [];
  let writing: Promise<void> = Promise.resolve();
  /** The version the file on disk had when it was read (0: none). Tests and the migration note read it. */
  let loadedVersion = 0;

  await mkdir(home, { recursive: true });
  let text: string | null = null;

  try {
    text = await readFile(file, "utf8");
  } catch {
    text = null;
  }
  if (text !== null) {
    try {
      const parsed = JSON.parse(text) as Partial<StoreFile> | SiteRecord[];
      const list = Array.isArray(parsed) ? parsed : parsed.sites;

      if (!Array.isArray(list)) throw new Error("no sites list");
      for (const record of list) if (isRecord(record)) records.set(record.id, cleanRecord(record));
      if (!Array.isArray(parsed) && Array.isArray(parsed.groups)) {
        const seen = new Set<string>();

        groups = parsed.groups.filter(isGroup).map(cleanGroup).filter((group) => !seen.has(group.id) && Boolean(seen.add(group.id)));
      }
      loadedVersion = Array.isArray(parsed) ? 1 : typeof parsed.version === "number" ? parsed.version : 1;
      // A site filed under a group that no longer exists is simply ungrouped.
      const known = new Set(groups.map((group) => group.id));

      for (const record of records.values()) if (record.group && !known.has(record.group)) delete record.group;
    } catch {
      await copyFile(file, `${file}.bak`).catch(() => undefined);
    }
  }

  async function save(): Promise<void> {
    const body: StoreFile = { version: 2, sites: [...records.values()].sort((a, b) => a.root.localeCompare(b.root)), groups };
    const temp = join(home, `.sites.json.${randomBytes(6).toString("hex")}.tmp`);

    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    try {
      await rename(temp, file);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  /** Serialised so two quick updates can't land out of order. */
  const persist = (): Promise<void> => {
    writing = writing.then(save, save);
    return writing;
  };

  return {
    all: () => [...records.values()],
    get: (id: string) => records.get(id) ?? null,
    byRoot: (root: string) => [...records.values()].find((record) => record.root === root) ?? null,
    loadedVersion: () => loadedVersion,
    put(record: SiteRecord): Promise<void> {
      records.set(record.id, record);
      return persist();
    },
    /** Several records in one write — a bulk add of forty sites is one file write, not forty. */
    putMany(list: SiteRecord[]): Promise<void> {
      for (const record of list) records.set(record.id, record);
      return persist();
    },
    remove(id: string): Promise<void> {
      records.delete(id);
      return persist();
    },
    groups: () => groups.map((group) => ({ ...group })),
    /** Replaces the groups (order included); sites filed under a removed group become ungrouped. */
    setGroups(next: SiteGroup[]): Promise<void> {
      groups = next.map(cleanGroup);
      const known = new Set(groups.map((group) => group.id));

      for (const record of records.values()) if (record.group && !known.has(record.group)) delete record.group;
      return persist();
    },
    flush: () => writing.catch(() => undefined),
  };
}

export { MAX_GROUP_NAME, MAX_NOTE };
