/**
 * readWordPress: either way in, one `WordPressSite` out.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ReadOptions, WordPressSite, WordPressSource } from "../types";
import { readRest, restCacheDir } from "./rest";
import { readWxr } from "./wxr";

export async function readWordPress(source: WordPressSource, options: ReadOptions = {}): Promise<WordPressSite> {
  if ("file" in source) return readWxr(source.file, options);
  return readRest(source.url, { ...options, ...(source.auth ? { auth: source.auth } : {}) });
}

/**
 * What the person typed → a source. An existing file is an export; anything
 * that looks like an address is a live site ("example.com" included).
 */
export function sourceFromArgument(argument: string, cwd: string): WordPressSource {
  const asPath = resolve(cwd, argument);

  if (!/^https?:\/\//i.test(argument) && existsSync(asPath)) return { file: asPath };
  if (/\.(xml|wxr)$/i.test(argument) && !/^https?:\/\//i.test(argument)) return { file: asPath };
  return { url: argument };
}

/** Where a live import keeps its fetched JSON (cleared after a finished import). */
export function cacheDirFor(source: WordPressSource, options: Pick<ReadOptions, "cacheDir"> = {}): string | null {
  if ("file" in source) return null;
  return options.cacheDir ?? restCacheDir(source.url);
}

export { discoverApi, endpoint, normalizeSiteInput } from "./rest";
export { createFetcher, USER_AGENT } from "./http";
