/**
 * The host's redirects file (`_redirects` in the public folder, or vercel.json)
 * is made by the redirects code from the list. While that code writes it, this
 * mark says so, and the content guard admits the file for that write alone
 * (site/content-code.ts): a Redirects save below build-mode level then lands
 * whole, while a write of the same file by hand still answers to the writer's
 * level — its text could be anything (rules the list never allows, or other
 * settings in vercel.json). Only engine code can set the mark; no request can.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { normalizePath } from "../content/entries/paths";
import type { SiteModel } from "../types";
import { derivedPath, hostOf, isGeneratedHost } from "./locate";

const writing = new AsyncLocalStorage<string>();

/** Runs the redirects code's own write of the host file at `path`, marked as such. */
export function asGeneratedRedirects<T>(path: string, run: () => Promise<T>): Promise<T> {
  return writing.run(normalizePath(path), run);
}

/** Whether `path` (normalised) is the host's redirects file and the redirects code itself is writing it now. */
export function isGeneratedRedirectsWrite(path: string, model: Pick<SiteModel, "media" | "deploy" | "redirects">): boolean {
  if (writing.getStore() !== path) return false;
  const host = hostOf(model).id;

  return isGeneratedHost(host) && normalizePath(derivedPath(host, model)) === path;
}
