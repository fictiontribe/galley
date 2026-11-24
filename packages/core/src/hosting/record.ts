/**
 * What this computer remembers about the install it created for a site, in
 * the app's state folder — never in the site:
 *   <home>/state/<siteId>/editor.json         the HostedEditorRecord (no secret)
 *   <home>/state/<siteId>/editor-setup-code   the one-time setup code, until
 *                                             the install says first run is done
 * Both readable by this user only, written whole (a temporary file, then a
 * rename) so a crash never leaves half a record.
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { HostedEditorRecord } from "./types";

function folder(home: string, siteId: string): string {
  return join(home, "state", siteId);
}

export function recordPath(home: string, siteId: string): string {
  return join(folder(home, siteId), "editor.json");
}

export function setupCodePath(home: string, siteId: string): string {
  return join(folder(home, siteId), "editor-setup-code");
}

async function writePrivate(path: string, text: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;

  await writeFile(temporary, text, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function readRecord(home: string, siteId: string): Promise<HostedEditorRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(recordPath(home, siteId), "utf8")) as HostedEditorRecord;

    return parsed && typeof parsed === "object" && Array.isArray(parsed.resources) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function writeRecord(home: string, siteId: string, record: HostedEditorRecord): Promise<void> {
  return writePrivate(recordPath(home, siteId), `${JSON.stringify(record, null, 2)}\n`);
}

export async function deleteRecord(home: string, siteId: string): Promise<void> {
  await rm(recordPath(home, siteId), { force: true });
  await rm(setupCodePath(home, siteId), { force: true });
}

export async function readSetupCode(home: string, siteId: string): Promise<string | null> {
  try {
    return (await readFile(setupCodePath(home, siteId), "utf8")).trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function writeSetupCode(home: string, siteId: string, code: string): Promise<void> {
  return writePrivate(setupCodePath(home, siteId), `${code}\n`);
}

export async function forgetSetupCode(home: string, siteId: string): Promise<void> {
  await rm(setupCodePath(home, siteId), { force: true });
}
