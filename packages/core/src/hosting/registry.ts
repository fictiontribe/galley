/**
 * The places an editor can be hosted that this process knows. Fly.io,
 * Cloudflare (in front of a computer of yours) and any server with Docker are
 * always there; a plugin can add one with `registerEditorHost` before the
 * hosting service is created (or pass `hosts` to it directly). Mirrors
 * deploy/registry.ts.
 */
import { PRODUCT } from "../brand";
import { createCloudflareEditorHost } from "./cloudflare";
import { createFlyHost } from "./fly";
import { createOwnServerHost } from "./own-server";
import type { EditorHost, EditorHostAbsent } from "./types";

export const BUILT_IN_EDITOR_HOSTS = ["fly", "cloudflare", "own-server"] as const;

const extra: EditorHost[] = [];

/** Adds a host. An id that is already registered is refused, so a plugin can't quietly replace a built-in. */
export function registerEditorHost(host: EditorHost): void {
  if ((BUILT_IN_EDITOR_HOSTS as readonly string[]).includes(host.id) || extra.some((known) => known.id === host.id)) {
    throw new Error(`An editor host called “${host.id}” is already registered.`);
  }
  extra.push(host);
}

/** Built-ins first (Fly.io, the one that does everything itself), then registered ones. */
export function builtInEditorHosts(): EditorHost[] {
  return [createFlyHost(), createCloudflareEditorHost(), createOwnServerHost(), ...extra];
}

/**
 * Hosts people may expect that can't run an editor today, each with the one
 * sentence that says why (from their own docs, read 2026-11-23).
 */
export const EDITOR_HOSTS_ABSENT: EditorHostAbsent[] = [
  {
    name: "Vercel",
    reason: `Vercel can't run the editor: it runs short functions that stop after a few minutes, on a disk that doesn't keep files, and ${PRODUCT.name} needs a computer that stays on with a disk that keeps your unpublished changes — put the site on Vercel, and the editor on Fly.io or a server of your own.`,
  },
  {
    name: "Netlify",
    reason: "Netlify can't run the editor: its functions stop after at most 15 minutes and its servers empty their disk whenever they stop, so unpublished changes would be lost — put the site on Netlify, and the editor on Fly.io or a server of your own.",
  },
  {
    name: "Cloudflare Containers",
    reason: "Cloudflare's containers can't hold the editor yet: they start again with a fresh disk after every sleep, restart or update, so unpublished changes would be lost — choose “Cloudflare, in front of a computer of yours” instead.",
  },
];
