/**
 * Every way `galley new` can stop, as one sentence on what happened and the
 * one thing to do next. Kept together so they read alike and can be tested.
 */
import type { PackageManager } from "@galley/core/types";
import { MANAGER_HOMES } from "./package-manager";

/** "22.23.4" vs "20.11.1": true when `version` is older. */
export function olderThan(version: string, minimum: string): boolean {
  const a = version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = minimum.split(".").map((part) => Number.parseInt(part, 10) || 0);

  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

export function nodeTooOld(starter: string, needed: string, current: string): string {
  return `${starter} needs Node ${needed} or newer, and this computer has Node ${current.replace(/^v/, "")}. Install the current LTS version from https://nodejs.org, then run the same command again.`;
}

export function gitMissing(platform: NodeJS.Platform = process.platform): string {
  const how =
    platform === "darwin"
      ? "Install it with `xcode-select --install` (or from https://git-scm.com/downloads)"
      : platform === "win32"
        ? "Install it from https://git-scm.com/downloads"
        : "Install it with your system's package manager (for example `sudo apt install git`) or from https://git-scm.com/downloads";

  return `A new site keeps its versions with git, and git isn't installed on this computer. ${how}, then run the same command again.`;
}

export function folderNotEmpty(shown: string, suggestion: string): string {
  return `${shown} already has files in it, and a new site needs an empty folder, so nothing was copied. Choose another name — for example ${suggestion} — or empty that folder first.`;
}

export function notAFolder(shown: string): string {
  return `${shown} is a file, not a folder. Choose another name for the site.`;
}

export function unknownStarter(query: string, names: string): string {
  return `There's no starter called “${query}”. Choose ${names}, or run \`galley starters\` to see what each one is.`;
}

export function managerMissing(manager: PackageManager): string {
  return `${manager} isn't installed on this computer, so the site's dependencies couldn't be installed. Install ${manager} (${MANAGER_HOMES[manager]}), or choose another with --use npm.`;
}

/** Output that means the registry couldn't be reached, from npm, pnpm, yarn and bun. */
const OFFLINE =
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|getaddrinfo|socket hang up|network (?:request|error|connectivity)|ERR_PNPM_META_FETCH_FAIL|ERR_SOCKET|Could not resolve host|ConnectionRefused|FailedToOpenSocket|There appears to be trouble with your network connection/i;

export function looksOffline(output: string): boolean {
  return OFFLINE.test(output);
}

/** Which registry the manager tried, for the offline sentence. */
export function registryHost(env: NodeJS.ProcessEnv): string {
  const configured = env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY;

  try {
    return configured ? new URL(configured).host : "registry.npmjs.org";
  } catch {
    return "registry.npmjs.org";
  }
}

export function installOffline(manager: PackageManager, host: string, shown: string, run: string): string {
  return `Couldn't download the site's dependencies: ${host} can't be reached, so this computer looks offline. The site is ready in ${shown}, with its first version recorded. When you're online again, run \`${manager} install\` in that folder, then \`${run}\`.`;
}

export function installFailed(manager: PackageManager, shown: string, run: string): string {
  return `Installing the site's dependencies didn't work (the last lines of ${manager}'s output are above). The site is ready in ${shown}, with its first version recorded. Run \`${manager} install\` in that folder to try again, then \`${run}\`.`;
}

export function installTimedOut(manager: PackageManager, shown: string, run: string): string {
  return `Installing the site's dependencies took longer than 15 minutes and was stopped. The site is ready in ${shown}, with its first version recorded. Check your connection, run \`${manager} install\` in that folder, then \`${run}\`.`;
}

export function cancelled(): string {
  return "Stopped. Nothing was created.";
}
