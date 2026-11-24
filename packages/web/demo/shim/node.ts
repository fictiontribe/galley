/**
 * The Node built-ins the mock imports, for the demo build only (vite.demo.config.ts
 * points `node:crypto`, `node:fs` and `node:url` here). The mock itself is
 * unchanged: on Node it gets the real modules.
 *
 * - crypto: ids and random bytes from the browser's own `crypto`.
 * - fs: the one read left after the fixtures are snapshotted (a sample video
 *   in plugins.ts) finds no file, which the mock already handles.
 * - url: `fileURLToPath` for the same code path; nothing is read with it.
 */
import { DemoBuffer } from "./buffer";

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export function randomBytes(size: number): DemoBuffer {
  const out = new DemoBuffer(size);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function existsSync(): boolean {
  return false;
}

export function readFileSync(path: string): never {
  throw new Error(`The demo has no files on disk (${path}).`);
}

export function fileURLToPath(url: string | URL): string {
  return new URL(String(url), "file:///").pathname;
}
