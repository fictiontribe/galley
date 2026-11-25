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
 * may look into (another user's). Null when it can't be read at all, or the
 * scan of the process table didn't finish within `budgetMs` (a busy host): a
 * part answer could miss a listener, which must not be taken for "none".
 */
export async function listenersFromProc(port: number, proc = "/proc", budgetMs = LOOKUP_TIMEOUT_MS): Promise<Listeners | null> {
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
  const deadline = Date.now() + budgetMs;

  for (const entry of await readdir(proc).catch(() => [] as string[])) {
    if (!/^\d+$/.test(entry)) continue;
    if (held.size < sockets.size && Date.now() > deadline) return null;
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
  // Linux first from /proc: cheaper than lsof, and it says when a listener is held by nobody this process may see.
  if (process.platform === "linux") {
    const viaProc = await listenersFromProc(port, "/proc", timeoutMs);

    if (viaProc) return viaProc;
  }
  const pids = await listeningPids(port, timeoutMs);

  return pids === null ? null : { pids, unseen: false };
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
  // Adopting a server already running on a site's configured port: by folder, through lsof, as before. It is a
  // convenience (someone already ran the dev server), not a guard, so it stays "unknown" where lsof can't say —
  // Linux's /proc is for the port-taken check below, which decides whether a preview trusts what it finds.
  if (process.platform !== "darwin" && process.platform !== "linux") return "unknown";
  const pids = await listeningPids(port, timeoutMs);

  if (!pids || pids.length === 0) return "unknown";
  const siteRoot = real(root);
  const dirs = await Promise.all(pids.map((pid) => cwdOf(pid, timeoutMs)));

  if (dirs.some((dir) => dir !== null && !within(siteRoot, real(dir)))) return "foreign";
  if (dirs.some((dir) => dir === null)) return "unknown";
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
 * How a port number stands to a preview whose dev server was told to use it:
 *
 *   own      every listener on it, on whichever address, is this preview's
 *            dev server (in `group`, the process group the controller started
 *            it in, or a process running in the site's own folder — a dev
 *            command may hand its server to a tool that regroups it, and a
 *            server running in the site's folder is still this site's);
 *   shared   this preview's dev server listens on it, and so does something
 *            else — on another address of the same number, say. Which a
 *            connection reaches is the system's to decide, so it is not used;
 *   foreign  something listens on it and none of it is this preview's. Its
 *            dev server hasn't taken the port (yet, or at all);
 *   unknown  nothing here can say whose the listeners are (Windows; a Mac
 *            without lsof or ps; a lookup that took too long). Linux needs
 *            neither tool: /proc says the same.
 *
 * Both loopback addresses were free when the port was chosen, so any listener
 * on it that isn't this preview's arrived since. A listener this process may
 * see exists but can't attribute (another user's, on a hosted server) counts
 * as not this preview's: it is refused, not trusted.
 *
 * Asked when a port the controller chose answers before the dev server has
 * said it listens there: between choosing a free port and the dev server
 * asking for it, another program can take it.
 */
export type PortStanding = "own" | "shared" | "foreign" | "unknown";

export async function listenerStartedHere(port: number, group: number, root: string, self: number, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<PortStanding> {
  if (process.platform !== "darwin" && process.platform !== "linux") return "unknown";
  const found = await listening(port, timeoutMs);

  if (!found) return "unknown";
  if (found.pids.length === 0 && !found.unseen) return "unknown";
  const siteRoot = real(root);
  let own = false;
  // A listener not this preview's: one provably elsewhere, one this process may not look into (another user's), or
  // one of this process's own (a sibling preview's proxy, which can be handed the chosen port by the kernel).
  let other = found.unseen;

  for (const pid of found.pids) {
    if (pid === self) other = true;
    else if (pid === group || (await groupOf(pid, timeoutMs)) === group) own = true;
    else {
      const dir = await cwdOf(pid, timeoutMs);

      if (dir !== null && within(siteRoot, real(dir))) own = true;
      else other = true;
    }
  }
  if (own && other) return "shared";
  if (other) return "foreign";
  return own ? "own" : "unknown";
}
