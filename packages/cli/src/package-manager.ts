/**
 * Which package manager to install a new site's dependencies with: the one
 * that ran us (`npm create galley`, `pnpm create galley`, `yarn create
 * galley`, `bun create galley` all say so in npm_config_user_agent), unless
 * `--use` names another.
 */
import type { PackageManager } from "@galley/core/types";

export const MANAGERS: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

export function isManager(value: string): value is PackageManager {
  return (MANAGERS as readonly string[]).includes(value);
}

/** "pnpm/10.15.0 npm/? node/v22.23.4 darwin arm64" → "pnpm". Null when nothing ran us, or something unknown did. */
export function invokingManager(env: NodeJS.ProcessEnv): PackageManager | null {
  const agent = env.npm_config_user_agent?.trim() ?? "";
  const name = /^([a-z]+)\//.exec(agent)?.[1] ?? "";

  return isManager(name) ? name : null;
}

/** How to run Galley again in a site's folder, with the manager that installed it. */
export function runCommandFor(manager: PackageManager | null): string {
  switch (manager) {
    case "pnpm":
      return "pnpm dlx galley-cms";
    case "bun":
      return "bunx galley-cms";
    default:
      // yarn 1 has no dlx; npx comes with Node, so it works whatever installed the site.
      return "npx galley-cms";
  }
}

/** `npm create galley@latest my-site -- --starter caddow`, in the form each manager takes. */
export function createCommandFor(manager: PackageManager | null, folder: string, starter: string): string {
  switch (manager) {
    case "pnpm":
      return `pnpm create galley ${folder} --starter ${starter}`;
    case "yarn":
      return `yarn create galley ${folder} --starter ${starter}`;
    case "bun":
      return `bun create galley ${folder} --starter ${starter}`;
    default:
      return `npm create galley@latest ${folder} -- --starter ${starter}`;
  }
}

/** Where to get a package manager that isn't installed. */
export const MANAGER_HOMES: Record<PackageManager, string> = {
  npm: "it comes with Node: https://nodejs.org",
  pnpm: "https://pnpm.io/installation",
  yarn: "https://yarnpkg.com/getting-started/install",
  bun: "https://bun.sh",
};
