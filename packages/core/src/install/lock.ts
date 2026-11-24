/**
 * A server's hold on a data folder: `<home>/server.lock`, taken by a hosted
 * server before it reads or changes anything in the folder, refreshed while
 * it runs and removed when it stops.
 *
 * One folder, one server. Two servers on one folder would each keep the
 * install's state and the site's working copy in their own memory and write
 * over each other, so a start that finds the folder held by a server that is
 * still running is refused. The command line's `backup create` and `backup
 * restore` work on the folder directly and refuse for the same reason.
 *
 * Whether the holder is still running:
 * - A hold whose process is gone here is left over from a server that
 *   didn't stop cleanly, and is taken over at once. "Here" is the same
 *   hostname and the same set of process ids: on Linux every container has
 *   its own, so a pid written in one container says nothing in another, even
 *   when both were given one hostname.
 * - Anything else is watched, not guessed at. The holder rewrites its file
 *   every few seconds with a counter (its beat). A start that finds such a
 *   hold waits two beats and reads again: a file that changed belongs to a
 *   running server; one that didn't is taken over. No clocks are compared,
 *   so two machines sharing a volume needn't agree on the time. A process id
 *   that answers isn't enough on its own either: after a restart another
 *   program can have the id the server had.
 * - A hold with no beat was written by an older version, which never
 *   refreshes it. Here with its process alive it counts as running; from
 *   anywhere else it is taken over after the watch, as it always was.
 *
 * `serverHolding` is what the command line asks. It can't wait, so a hold
 * written on another machine counts until the server removes it or the
 * operator says it is stale.
 */
import { randomUUID } from "node:crypto";
import { readlinkSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { GalleyError } from "../errors";
import { SERVER_LOCK_FILE } from "./backup";

export interface ServerLock {
  pid: number;
  hostname: string;
  port: number | null;
  startedAt: string;
  /** Which hold this is: a new one each time a server takes the folder. Absent in a hold an older version wrote. */
  id?: string;
  /** Counts up while the holder runs. Absent in a hold an older version wrote. */
  beat?: number;
  /** The set of process ids the holder's pid belongs to (Linux: its pid namespace), or null where there is only one. Absent in a hold an older version wrote. */
  space?: string | null;
}

/** How often a running server refreshes its hold. Two of these, and a little, is how long a start watches someone else's. */
export const HOLD_BEAT_MS = 10_000;

export interface HoldOptions {
  /** Ms between beats (tests shorten it). */
  beatMs?: number;
  /** Ms a start watches another server's hold before deciding. Default: two beats and a second (a third beat, when beats are shorter than that). */
  watchMs?: number;
  /** One plain line for whoever runs the server. */
  log?: (line: string) => void;
  /**
   * Called once, when a refresh finds the hold is another server's (`by`: as
   * that server wrote it, in words). The folder is no longer this server's
   * to write to: whoever holds it stops, so the two never write over each other.
   */
  onLost?: (by: string) => void;
}

export interface DataFolderHold {
  /** Records the port once the server listens on one. */
  setPort(port: number): Promise<void>;
  /** Lets go: no more beats, and the file is removed if it is still this hold's. */
  release(): Promise<void>;
}

export function lockFile(home: string): string {
  return join(home, SERVER_LOCK_FILE);
}

/** Data folders this process holds. Two servers in one process share a pid, so the file alone can't tell them apart. */
const heldHere = new Set<string>();

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Which set of process ids this process lives in. Linux gives each container its own; elsewhere a machine has one. */
function pidSpace(): string | null {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return null;
  }
}

function parse(raw: string): ServerLock | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ServerLock>;

    return typeof parsed.pid === "number" && typeof parsed.hostname === "string"
      ? {
          pid: parsed.pid,
          hostname: parsed.hostname,
          port: typeof parsed.port === "number" ? parsed.port : null,
          startedAt: String(parsed.startedAt ?? ""),
          ...(typeof parsed.id === "string" ? { id: parsed.id } : {}),
          ...(typeof parsed.beat === "number" ? { beat: parsed.beat } : {}),
          ...(typeof parsed.space === "string" || parsed.space === null ? { space: parsed.space } : {}),
        }
      : null;
  } catch {
    return null;
  }
}

/** The file as it is: its text (null when there is none) and the hold it describes (null when it can't be read as one). */
async function look(home: string): Promise<{ raw: string | null; lock: ServerLock | null }> {
  try {
    const raw = await readFile(lockFile(home), "utf8");

    return { raw, lock: parse(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: null, lock: null };
    throw error;
  }
}

async function readLock(home: string): Promise<ServerLock | null> {
  const first = await look(home).catch(() => ({ raw: null, lock: null }));

  if (first.lock || first.raw === null) return first.lock;
  // A file that is there but can't be read as a hold may be half-way through a beat: the holder writes it in place.
  await pause(25);
  return (await look(home).catch(() => ({ raw: null, lock: null }))).lock;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function describe(lock: ServerLock | null): string {
  if (!lock) return "";
  const port = lock.port ? `, port ${lock.port}` : "";

  return ` (process ${lock.pid} on ${lock.hostname}${port})`;
}

function refusal(home: string, lock: ServerLock | null, unchecked = false): GalleyError {
  const way = `Stop it first, or give this one a data folder of its own (GALLEY_HOME).`;
  // An older version's hold can't be watched: say how to carry on when the process named isn't an editor any more.
  const stale = unchecked ? ` If nothing is running there, delete ${lockFile(home)} and start again.` : "";

  return new GalleyError("busy", `Another editor is running on this data folder${describe(lock)}. ${way}${stale}`, home);
}

function unwritable(home: string, error: unknown): GalleyError {
  const reason = error instanceof Error ? error.message : String(error);

  return new GalleyError(
    "unconfigured",
    `This server can't take its hold on the data folder ${home}, so it won't start: ${reason.replace(/\.?$/, ".")} Check that the folder is there and that the server may write to it.`,
    reason
  );
}

/**
 * Takes `home` for this process, or refuses in one plain sentence when a
 * running server holds it or the hold can't be written. Resolves once the
 * folder is this server's: after at most the watch when another hold is found.
 */
export async function holdDataFolder(home: string, port: number | null, options: HoldOptions = {}): Promise<DataFolderHold> {
  const beatMs = options.beatMs ?? HOLD_BEAT_MS;
  const watchMs = options.watchMs ?? beatMs * 2 + Math.min(1000, beatMs);
  const log = options.log ?? (() => undefined);
  const key = resolve(home);
  const mine: Required<ServerLock> = { pid: process.pid, hostname: hostname(), port, startedAt: new Date().toISOString(), id: randomUUID(), beat: 0, space: pidSpace() };
  const text = () => `${JSON.stringify(mine)}\n`;

  if (heldHere.has(key)) throw refusal(home, { pid: process.pid, hostname: mine.hostname, port: null, startedAt: "" });
  heldHere.add(key);
  try {
    await take();
  } catch (error) {
    heldHere.delete(key);
    throw error instanceof GalleyError ? error : unwritable(home, error);
  }

  /** Writes the hold where there is none. False when someone else got there first. */
  async function create(): Promise<boolean> {
    try {
      await writeFile(lockFile(home), text(), { mode: 0o600, flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  }

  /** Puts this hold in place of a stale one — unless the file changed since `seen`, or someone else replaced it at the same moment. */
  async function replace(seen: string): Promise<boolean> {
    if ((await look(home)).raw !== seen) return false;
    await writeFile(lockFile(home), text(), { mode: 0o600 });
    // Two servers that both found the same stale hold: the later write stands, and the earlier one sees it here.
    await pause(Math.min(250, Math.max(10, Math.round(beatMs / 10))));
    return (await look(home)).lock?.id === mine.id;
  }

  async function take(): Promise<void> {
    // A few rounds at most: each one either ends here or follows someone else's change to the file.
    for (let round = 0; round < 4; round += 1) {
      const found = await look(home);

      if (found.raw === null) {
        if (await create()) return;
        continue;
      }
      const other = found.lock;
      // An older version's hold names no set of process ids: its hostname is all there is to go by, as it was.
      const here = other !== null && other.hostname === mine.hostname && (other.space === undefined || other.space === mine.space);

      // Left by a server that is gone: its process doesn't answer, or it ran under the id this process has now.
      if (here && (other.pid === process.pid || !alive(other.pid))) {
        if (await replace(found.raw)) {
          if (other.pid !== process.pid) log(`The server that last used this data folder${describe(other)} didn't stop cleanly and is gone. This server has taken the folder.`);
          return;
        }
        continue;
      }
      if (here && other.beat === undefined) throw refusal(home, other, true);
      const seconds = Math.max(1, Math.round(watchMs / 1000));

      log(`Another server's hold is on this data folder${describe(other)}. Checking whether it is still running: about ${seconds} second${seconds === 1 ? "" : "s"}.`);
      await pause(watchMs);
      const again = await look(home);

      // Removed meanwhile: it stopped cleanly. Start over, as on an empty folder.
      if (again.raw === null) continue;
      if (again.raw !== found.raw) throw refusal(home, again.lock ?? other);
      if (await replace(found.raw)) {
        log(`That server isn't running any more: its hold didn't change. This server has taken the data folder.`);
        return;
      }
    }
    throw refusal(home, (await look(home)).lock);
  }

  let stopped = false;
  let lost = false;
  let saidUnwritable = false;
  /** One write at a time: a beat and the port can't land half over each other. */
  let writing: Promise<void> = Promise.resolve();
  const inTurn = (work: () => Promise<void>) => (writing = writing.then(work, work));

  async function refresh(next: () => void): Promise<void> {
    if (stopped || lost) return;
    try {
      const current = await look(home);

      if (current.raw === null) {
        // Removed by hand while this server runs: nobody else holds the folder, so the hold goes back.
        next();
        if (await create()) return;
      } else if (current.lock?.id === mine.id) {
        next();
        await writeFile(lockFile(home), text(), { mode: 0o600 });
        saidUnwritable = false;
        return;
      }
      lost = true;
      clearInterval(timer);
      const by = describe((await look(home).catch(() => null))?.lock ?? null);

      log(`Another server has taken this data folder${by} while this one was running.`);
      options.onLost?.(by);
    } catch (error) {
      // Said once, tried again at the next beat: a hold that stops changing looks abandoned to another server.
      if (!saidUnwritable) log(`This server couldn't refresh its hold on the data folder: ${error instanceof Error ? error.message : String(error)}`);
      saidUnwritable = true;
    }
  }

  const timer = setInterval(() => void inTurn(() => refresh(() => (mine.beat += 1))), beatMs);

  timer.unref?.();
  return {
    setPort(listening) {
      return inTurn(() => refresh(() => (mine.port = listening)));
    },
    async release() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await writing.catch(() => undefined);
      heldHere.delete(key);
      // Only our own hold: a server that took the folder over keeps its.
      if ((await look(home).catch(() => null))?.lock?.id === mine.id) await rm(lockFile(home), { force: true });
    },
  };
}

/** The server holding `home`, or null. A lock left by a process that is gone (here: this hostname and this set of process ids) doesn't count. */
export async function serverHolding(home: string): Promise<ServerLock | null> {
  const lock = await readLock(home);

  if (!lock) return null;
  const here = lock.hostname === hostname() && (lock.space === undefined || lock.space === pidSpace());

  if (here && (lock.pid === process.pid || !alive(lock.pid))) return null;
  return lock;
}
