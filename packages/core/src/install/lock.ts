/**
 * Whether a server holds a data folder: `<home>/server.lock`, written by a
 * hosted server when it starts and removed when it stops. The command line's
 * `backup create` and `backup restore` work on the folder directly and
 * refuse while a server holds it — a server that writes its state while the
 * folder is copied or replaced would leave both halves wrong.
 *
 * A lock counts while the process it names is alive on this machine (same
 * hostname, the pid answers signal 0). One written on another machine (a
 * container sharing the volume) can't be checked from here, so it counts
 * too, until the server removes it or the operator says it is stale.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { SERVER_LOCK_FILE } from "./backup";

export interface ServerLock {
  pid: number;
  hostname: string;
  port: number | null;
  startedAt: string;
}

export function lockFile(home: string): string {
  return join(home, SERVER_LOCK_FILE);
}

/** Records that this process holds `home`. Returns how to let go of it. */
export async function holdDataFolder(home: string, port: number | null): Promise<() => Promise<void>> {
  const lock: ServerLock = { pid: process.pid, hostname: hostname(), port, startedAt: new Date().toISOString() };

  await writeFile(lockFile(home), `${JSON.stringify(lock)}\n`, { mode: 0o600 });
  return async () => {
    const current = await readLock(home);

    // Only our own lock: a second server that took over the folder keeps its.
    if (current && current.pid === lock.pid && current.hostname === lock.hostname) await rm(lockFile(home), { force: true });
  };
}

async function readLock(home: string): Promise<ServerLock | null> {
  try {
    const parsed = JSON.parse(await readFile(lockFile(home), "utf8")) as Partial<ServerLock>;

    return typeof parsed.pid === "number" && typeof parsed.hostname === "string"
      ? { pid: parsed.pid, hostname: parsed.hostname, port: typeof parsed.port === "number" ? parsed.port : null, startedAt: String(parsed.startedAt ?? "") }
      : null;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The server holding `home`, or null. A lock left by a process that is gone (on this machine) doesn't count. */
export async function serverHolding(home: string): Promise<ServerLock | null> {
  const lock = await readLock(home);

  if (!lock) return null;
  if (lock.hostname === hostname() && (lock.pid === process.pid || !alive(lock.pid))) return null;
  return lock;
}
