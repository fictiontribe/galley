/**
 * The deploy targets this process knows. Cloudflare and Vercel are always
 * there; a plugin can add one with `registerDeployTarget` before the deploy
 * service is created (or pass `targets` to it directly).
 */
import { createCloudflareTarget } from "./cloudflare";
import type { DeployTarget } from "./types";
import { createVercelTarget } from "./vercel";

const extra: DeployTarget[] = [];

/** Adds a host. An id that is already registered is refused, so a plugin can't quietly replace a built-in. */
export function registerDeployTarget(target: DeployTarget): void {
  if (target.id === "cloudflare" || target.id === "vercel" || extra.some((known) => known.id === target.id)) {
    throw new Error(`A deploy target called “${target.id}” is already registered.`);
  }
  extra.push(target);
}

/** Built-ins first (Cloudflare is the recommended one), then registered ones. */
export function builtInTargets(): DeployTarget[] {
  return [createCloudflareTarget(), createVercelTarget(), ...extra];
}
