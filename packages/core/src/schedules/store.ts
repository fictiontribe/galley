/**
 * Atomic file-backed store for scheduled releases (`<galleyHome>/schedules/<siteId>.json`).
 * Uses temp file + rename with 0o600 permissions so partial writes never corrupt state.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScheduledRelease } from "./types";

const SAFE_SITE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface ScheduleStore {
  list(siteId: string): Promise<ScheduledRelease[]>;
  listAllSiteIds(): Promise<string[]>;
  get(siteId: string, scheduleId: string): Promise<ScheduledRelease | null>;
  save(siteId: string, schedules: ScheduledRelease[]): Promise<void>;
  upsert(siteId: string, schedule: ScheduledRelease): Promise<ScheduledRelease>;
}

interface StoredFile {
  version: 1;
  schedules: ScheduledRelease[];
}

export function createScheduleStore(home?: string): ScheduleStore {
  const memory = new Map<string, ScheduledRelease[]>();
  const dir = home ? join(home, "schedules") : null;

  const filePath = (siteId: string): string | null => {
    if (!dir || !SAFE_SITE_ID.test(siteId)) return null;
    return join(dir, `${siteId}.json`);
  };

  async function readSite(siteId: string): Promise<ScheduledRelease[]> {
    const path = filePath(siteId);

    if (!path) return [...(memory.get(siteId) ?? [])];
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<StoredFile>;

      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.schedules)) return [];
      return parsed.schedules;
    } catch {
      return [];
    }
  }

  async function writeSite(siteId: string, schedules: ScheduledRelease[]): Promise<void> {
    const ordered = [...schedules].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
    const path = filePath(siteId);

    if (!path) {
      memory.set(siteId, ordered);
      return;
    }
    await mkdir(dir!, { recursive: true, mode: 0o700 });
    const tmp = join(dir!, `.${siteId}-${randomUUID()}.tmp`);

    await writeFile(tmp, `${JSON.stringify({ version: 1, schedules: ordered } satisfies StoredFile, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
  }

  return {
    list: readSite,
    async listAllSiteIds() {
      if (!dir) return [...memory.keys()];
      try {
        const names = await readdir(dir);

        return names
          .filter((name) => name.endsWith(".json") && !name.startsWith("."))
          .map((name) => name.slice(0, -5))
          .filter((id) => SAFE_SITE_ID.test(id));
      } catch {
        return [];
      }
    },
    async get(siteId, scheduleId) {
      const list = await readSite(siteId);

      return list.find((item) => item.id === scheduleId) ?? null;
    },
    save: writeSite,
    async upsert(siteId, schedule) {
      const list = await readSite(siteId);
      const index = list.findIndex((item) => item.id === schedule.id);

      if (index === -1) list.push(schedule);
      else list[index] = schedule;
      await writeSite(siteId, list);
      return schedule;
    },
  };
}
