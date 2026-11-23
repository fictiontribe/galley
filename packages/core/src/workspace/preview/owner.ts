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
import { readlink } from "node:fs/promises";
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
  const pids = await listeningPids(port, timeoutMs);

  if (!pids || pids.length === 0) return "unknown";
  const siteRoot = real(root);
  const dirs = await Promise.all(pids.map((pid) => cwdOf(pid, timeoutMs)));

  if (dirs.some((dir) => dir !== null && !within(siteRoot, real(dir)))) return "foreign";
  if (dirs.some((dir) => dir === null)) return "unknown";
  return "own";
}
