/**
 * Whose server is listening on a port. A dev server already answering on a
 * site's configured port is only adopted when it is provably that site's:
 * two sites made from the same starter share a configured port, and adopting
 * the other one would show one site's pages in the other's editor.
 *
 * The proof is the listening process's working directory, which a dev server
 * started from a site (`npm run dev`, `astro dev`) has at the site's root.
 * macOS and Linux only; anywhere the answer can't be had quickly, the answer
 * is "unknown", and unknown is never adopted.
 */
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { readdir, readFile, readlink } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

const LOOKUP_TIMEOUT_MS = 2000;

function run(file: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string } | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }, (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") resolve(null);
      else if (error && (error as { killed?: boolean }).killed) resolve(null);
      else resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout: String(stdout ?? "") });
    });
  });
}

/**
 * Linux, with nothing but /proc (a slim container has neither lsof nor ps):
 * the processes that hold the sockets listening on a TCP port, on any
 * address, and whether one of those sockets is held by nobody this process
 * may look into (another user's). Null when it can't be read at all.
 */
export async function listenersFromProc(port: number, proc = "/proc"): Promise<Listeners | null> {
  const wanted = `:${port.toString(16).toUpperCase().padStart(4, "0")}`;
  const sockets = new Set<string>();
  let read = false;

  for (const table of ["net/tcp", "net/tcp6"]) {
    const text = await readFile(`${proc}/${table}`, "utf8").catch(() => null);

    if (text === null) continue;
    read = true;
    for (const line of text.split("\n").slice(1)) {
      // sl, local address, remote address, state, …, inode (the tenth). State 0A is "listening".
      const fields = line.trim().split(/\s+/);

      if (fields[3] === "0A" && fields[1]?.endsWith(wanted) && fields[9]) sockets.add(fields[9]);
    }
  }
  if (!read) return null;
  if (sockets.size === 0) return { pids: [], unseen: false };
  const holders = new Set<number>();
  const held = new Set<string>();

  for (const entry of await readdir(proc).catch(() => [] as string[])) {
    if (!/^\d+$/.test(entry)) continue;
    for (const fd of await readdir(`${proc}/${entry}/fd`).catch(() => [] as string[])) {
      const link = await readlink(`${proc}/${entry}/fd/${fd}`).catch(() => "");
      const socket = /^socket:\[(\d+)\]$/.exec(link)?.[1];

      if (socket && sockets.has(socket)) {
        holders.add(Number(entry));
        held.add(socket);
      }
    }
  }
  return { pids: [...holders], unseen: held.size < sockets.size };
}

/** Linux: the process group a process is in, read from /proc; null when it can't be read. */
export async function groupFromProc(pid: number, proc = "/proc"): Promise<number | null> {
  const stat = await readFile(`${proc}/${pid}/stat`, "utf8").catch(() => null);
  // "pid (name) state parent group …": the name may hold spaces and brackets, so count from its last bracket.
  const group = Number(stat?.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[2]);

  return Number.isInteger(group) && group > 0 ? group : null;
}

/** The processes listening on a TCP port number, on whichever addresses. */
export interface Listeners {
  pids: number[];
  /** A listener is there that this process may not look into (another user's). Known on Linux; elsewhere such a listener simply isn't seen. */
  unseen: boolean;
}

async function listening(port: number, timeoutMs: number): Promise<Listeners | null> {
  const pids = await listeningPids(port, timeoutMs);

  if (pids !== null) return { pids, unseen: false };
  // No lsof here: on Linux /proc says the same.
  return process.platform === "linux" ? listenersFromProc(port) : null;
}

/** pids listening on a TCP port (any address), or null when that can't be found out. */
async function listeningPids(port: number, timeoutMs: number): Promise<number[] | null> {
  const result = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], timeoutMs);

  if (!result) return null;
  // lsof exits 1 when nothing matched.
  if (result.code !== 0 && result.stdout.trim() === "") return [];
  return [...new Set(result.stdout.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))];
}

async function cwdOf(pid: number, timeoutMs: number): Promise<string | null> {
  if (process.platform === "linux") {
    const viaProc = await readlink(`/proc/${pid}/cwd`).catch(() => null);

    if (viaProc) return viaProc;
  }
  const result = await run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], timeoutMs);
  const line = result?.stdout.split("\n").find((entry) => entry.startsWith("n/"));

  return line ? line.slice(1) : null;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);

  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export type Ownership = "own" | "foreign" | "unknown";

/**
 * "own" when every process listening on `port` runs in `root` (or a folder
 * inside it); "foreign" when one provably runs elsewhere; "unknown" when the
 * listeners can't be identified (another user's process, no lsof, Windows,
 * a lookup that took too long).
 */
export async function portOwnership(port: number, root: string, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<Ownership> {
  if (process.platform !== "darwin" && process.platform !== "linux") return "unknown";
  const found = await listening(port, timeoutMs);

  if (!found || found.pids.length === 0) return "unknown";
  const siteRoot = real(root);
  const dirs = await Promise.all(found.pids.map((pid) => cwdOf(pid, timeoutMs)));

  if (dirs.some((dir) => dir !== null && !within(siteRoot, real(dir)))) return "foreign";
  if (found.unseen || dirs.some((dir) => dir === null)) return "unknown";
  return "own";
}

/** The process group a process is in, or null when that can't be found out. */
async function groupOf(pid: number, timeoutMs: number): Promise<number | null> {
  if (process.platform === "linux") {
    const viaProc = await groupFromProc(pid);

    if (viaProc !== null) return viaProc;
  }
  const result = await run("ps", ["-o", "pgid=", "-p", String(pid)], timeoutMs);
  const group = Number(result?.stdout.trim());

  return result && result.code === 0 && Number.isInteger(group) && group > 0 ? group : null;
}

/**
 * Whether a port number is this preview's own: every listener on it, on
 * whichever address, is a dev server this preview started. By process, not
 * by folder alone: the controller starts each dev server in a process group
 * of its own, so its server, and whatever that started, is in `group`.
 *
 *   own      every listener is in that group, or runs in the site's folder
 *            (a dev command may hand its server to a tool that regroups it;
 *            a server running in the site's folder is still this site's);
 *   foreign  a listener is neither; or one of ours shares the number with a
 *            listener that can't be identified;
 *   unknown  none of the listeners can be identified (Windows; a Mac without
 *            lsof or ps; another user's process; a lookup that took too
 *            long). Linux needs neither tool: /proc says the same.
 *
 * Every listener, not any: one port number can have several listeners at
 * once (one on 127.0.0.1 and one on ::1, one on every address, two sharing
 * the port), and which of them a connection reaches is the system's to say.
 * Both loopback addresses were free when the port was chosen, so a listener
 * there that isn't this preview's arrived since: the port is not this
 * preview's alone, and it moves to one that is.
 *
 * Asked when a port the controller chose answers before the dev server has
 * said it listens there: between choosing a free port and the dev server
 * asking for it, another program can take it.
 */
export async function listenerStartedHere(port: number, group: number, root: string, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<Ownership> {
  if (process.platform !== "darwin" && process.platform !== "linux") return "unknown";
  const found = await listening(port, timeoutMs);

  if (!found || (found.pids.length === 0 && !found.unseen)) return "unknown";
  const siteRoot = real(root);
  let own = 0;
  let foreign = 0;
  let unknown = found.unseen ? 1 : 0;

  for (const pid of found.pids) {
    if (pid === group || (await groupOf(pid, timeoutMs)) === group) {
      own += 1;
      continue;
    }
    const dir = await cwdOf(pid, timeoutMs);

    if (dir === null) unknown += 1;
    else if (within(siteRoot, real(dir))) own += 1;
    else foreign += 1;
  }
  if (foreign > 0 || (own > 0 && unknown > 0)) return "foreign";
  return own > 0 ? "own" : "unknown";
}
