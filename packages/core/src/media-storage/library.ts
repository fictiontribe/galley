/**
 * The site's record of what it keeps in its media stores:
 * `<home>/state/<siteId>/media/library.json`.
 *
 * It is what makes a store behave like the rest of the library without
 * asking the service every time: every upload with its size and pixel size
 * (so dimensions are known without downloading), whether a published version
 * uses it yet (what Proof shows as "In the bucket"), and the last listing of
 * each store, so the library still shows what it knew when a store can't be
 * reached for a moment.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GalleyError } from "../errors";
import { isSiteId } from "../site/scope";
import type { MediaStoreLocation } from "./contract";

export interface LibraryItem {
  location: MediaStoreLocation;
  key: string;
  url: string;
  name: string;
  size: number | null;
  type: string | null;
  width?: number;
  height?: number;
  uploadedAt: number;
  /** A published version uses it (or it was there before Galley looked). */
  published: boolean;
  /** Uploaded from this app (rather than found by listing the store). */
  uploaded?: boolean;
  /** Moved here from the repository: the path it came from (so a move run again finds it). */
  source?: string;
}

interface LibraryFile {
  version: 1;
  items: LibraryItem[];
  /** When each store was last listed in full, ms. */
  listedAt?: Partial<Record<MediaStoreLocation, number>>;
  /** Public addresses each store had before (pages may still use them). */
  earlier?: Partial<Record<MediaStoreLocation, string[]>>;
}

export interface MediaLibrary {
  all(siteId: string): Promise<LibraryItem[]>;
  listedAt(siteId: string, location: MediaStoreLocation): Promise<number | null>;
  earlierAddresses(siteId: string, location: MediaStoreLocation): Promise<string[]>;
  rememberAddress(siteId: string, location: MediaStoreLocation, address: string): Promise<void>;
  /** Applies a change to the record, written atomically. */
  update(siteId: string, change: (items: LibraryItem[], listedAt: Partial<Record<MediaStoreLocation, number>>) => LibraryItem[]): Promise<LibraryItem[]>;
}

export function createMediaLibrary(home: string): MediaLibrary {
  const queues = new Map<string, Promise<unknown>>();

  const fileOf = (siteId: string) => {
    if (!isSiteId(siteId)) throw new GalleyError("not-found", "That site isn't in the list.", siteId);
    return join(home, "state", siteId, "media", "library.json");
  };

  async function load(siteId: string): Promise<LibraryFile> {
    try {
      const parsed = JSON.parse(await readFile(fileOf(siteId), "utf8")) as Partial<LibraryFile>;

      return { version: 1, items: Array.isArray(parsed.items) ? parsed.items : [], listedAt: parsed.listedAt ?? {}, earlier: parsed.earlier ?? {} };
    } catch {
      return { version: 1, items: [], listedAt: {}, earlier: {} };
    }
  }

  async function save(siteId: string, data: LibraryFile): Promise<void> {
    const file = fileOf(siteId);
    const dir = join(file, "..");

    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `.library-${randomUUID()}.tmp`);

    await writeFile(temp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
    await rename(temp, file);
  }

  return {
    async all(siteId) {
      await queues.get(siteId);
      return (await load(siteId)).items;
    },
    async listedAt(siteId, location) {
      return (await load(siteId)).listedAt?.[location] ?? null;
    },
    async earlierAddresses(siteId, location) {
      return (await load(siteId)).earlier?.[location] ?? [];
    },
    rememberAddress(siteId, location, address) {
      const task = async () => {
        const data = await load(siteId);
        const list = data.earlier?.[location] ?? [];

        if (!list.includes(address)) await save(siteId, { ...data, earlier: { ...data.earlier, [location]: [...list, address].slice(-20) } });
      };
      const run = (queues.get(siteId) ?? Promise.resolve()).then(task, task);

      queues.set(
        siteId,
        run.catch(() => undefined)
      );
      return run;
    },
    update(siteId, change) {
      const task = async () => {
        const data = await load(siteId);
        const listedAt = { ...(data.listedAt ?? {}) };
        const items = change([...data.items], listedAt);

        await save(siteId, { version: 1, items, listedAt, earlier: data.earlier ?? {} });
        return items;
      };
      const run = (queues.get(siteId) ?? Promise.resolve()).then(task, task);

      queues.set(
        siteId,
        run.catch(() => undefined)
      );
      return run;
    },
  };
}
