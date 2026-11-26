/**
 * Plain-English classifier for preview install, startup, timeout, and runtime failures.
 *
 * Pure: inspects captured dev-server/installer logs and exit metadata and returns a
 * calm, actionable explanation when a known failure pattern matches, or null so the
 * controller falls back to its generic status message while keeping the raw log in
 * technical details.
 */
import { stripAnsi } from "../exec";

export interface PreviewFailureContext {
  exitCode?: number | null;
  signal?: string | null;
  phase?: "install" | "start" | "running" | "timeout";
}

function cleanLog(log: string[]): string {
  return log.map((line) => stripAnsi(line)).join("\n");
}

function isRelativeImport(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

/**
 * Classifies common preview/dev-server/install failures into plain English.
 * Returns null when no known failure pattern is recognized.
 */
export function diagnosePreviewFailure(log: string[], options: PreviewFailureContext = {}): string | null {
  const text = cleanLog(log);

  // 1. Vite failed to resolve package entry (e.g. vendored file: dependency missing dist/)
  const viteEntry = /Failed to resolve entry for package ["'`]([^"'`]+)["'`]/i.exec(text);
  if (viteEntry) {
    const pkg = viteEntry[1]!;
    return `The preview couldn't load the package “${pkg}” because its entry files are missing. If it's a local file: dependency, its dist/ folder may be excluded by .gitignore or not built yet — commit or build those files, or reinstall dependencies.`;
  }
  if (/\bpackageEntryFailure\b/i.test(text)) {
    const nearby = /package ["'`]([^"'`]+)["'`]/i.exec(text)?.[1];
    return nearby
      ? `The preview couldn't load the package “${nearby}” because its entry files are missing. If it's a local file: dependency, its dist/ folder may be excluded by .gitignore or not built yet — commit or build those files, or reinstall dependencies.`
      : "The preview couldn't resolve a package's entry files. A local file: dependency's dist/ folder may be excluded by .gitignore, or dependencies may need to be reinstalled.";
  }

  // 2. Package manager install errors (pnpm / npm / yarn / bun)
  if (/ERR_PNPM_OUTDATED_LOCKFILE|Cannot install with ["']?frozen-lockfile["']?|lockfile is out of date|Your lockfile needs to be updated/i.test(text)) {
    return "Dependency install failed because the lockfile is out of date with package.json. Run your package manager's install locally and commit the updated lockfile.";
  }
  if (
    /\b(?:E401|E403|ERR_PNPM_FETCH_401|ERR_PNPM_FETCH_403)\b/i.test(text) ||
    ((options.phase === "install" || /npm (?:ERR!|error)|ERR_PNPM/i.test(text)) && /\b(?:401 Unauthorized|403 Forbidden)\b/i.test(text))
  ) {
    return "Dependency install was rejected by the package registry (authentication or permission error). Check that any private registry tokens are configured for this environment.";
  }
  if (
    /\b(?:E404|ERR_PNPM_FETCH_404)\b/i.test(text) ||
    ((options.phase === "install" || /npm (?:ERR!|error)|ERR_PNPM/i.test(text)) && /\b404 Not Found\b/i.test(text))
  ) {
    return "Dependency install couldn't find a package in the registry (404). Check the package names and versions in package.json, or whether a private package requires registry authentication.";
  }
  const installNet = /\b(ENOTFOUND|EAI_AGAIN)\b/i.exec(text) ?? /\b(ERR_PNPM_META_FETCH_FAIL)\b/i.exec(text);
  if (installNet && (options.phase === "install" || /npm (?:ERR!|error)|ERR_PNPM|registry|yarn|bun/i.test(text))) {
    return `Dependency install couldn't reach the package registry (${installNet[1]!.toUpperCase()}). Check the network connection or registry configuration and try again.`;
  }

  // 3. Out of memory / SIGKILL
  if (
    /JavaScript heap out of memory|FATAL ERROR:[^\n]*Allocation failed|\bENOMEM\b|Out of memory/i.test(text) ||
    options.signal === "SIGKILL" ||
    options.exitCode === 137 ||
    /exited \(SIGKILL\)/i.test(text)
  ) {
    return "The preview ran out of memory and was stopped. Close other running previews or increase the memory limit for this server, then restart the preview.";
  }

  // 4. Port conflict (EADDRINUSE)
  const portConflict = /\bEADDRINUSE\b|address already in use|Port (\d{2,5}) is already in use/i.exec(text);
  if (portConflict) {
    const port = portConflict[1] ?? /(?:address already in use|EADDRINUSE)[^\n]*?:(\d{2,5})\b/i.exec(text)?.[1];
    return port
      ? `Port ${port} is already in use by another program, so the preview couldn't start on it. Stop the other program or choose a different preview port in site settings.`
      : "The preview's port is already in use by another program. Stop the other program or choose a different preview port in site settings.";
  }

  // 5. Astro content collection schema errors
  if (/\b(?:InvalidContentEntryDataError|ContentCollectionConfigError|ContentEntryDataError)\b/.test(text)) {
    const fileMatch = /\b(src\/content(?:\.config\.(?:ts|mts|js|mjs)|\/[^\s:'",)]+))/.exec(text);
    const where = fileMatch ? ` (${fileMatch[1]})` : "";
    return `The site's content doesn't match its content collection schema${where}. Check the front matter or content schema in src/content.config.ts and fix the invalid field.`;
  }

  // 6. Missing environment variable errors
  const missingEnvMatch =
    /Missing (?:required )?env(?:ironment)? var(?:iable)?s?:?\s*["'`]?([A-Z][A-Z0-9_]{1,})["'`]?/i.exec(text) ??
    /Environment variable\s+["'`]?([A-Z][A-Z0-9_]{1,})["'`]?\s+(?:is not set|is required|is missing|must be set)/i.exec(text) ??
    /(?:import\.meta\.env|process\.env)\.([A-Z][A-Z0-9_]+)\s+(?:is not defined|is undefined|is missing|must be set)/i.exec(text) ??
    /ReferenceError:\s*([A-Z][A-Z0-9]*_[A-Z0-9_]+)\s+is not defined/.exec(text);
  if (missingEnvMatch) {
    const name = missingEnvMatch[1]!;
    return `The site requires the environment variable ${name}, which isn't set. Add ${name} to your .env file or hosting environment, then restart the preview.`;
  }
  if (/Missing (?:required )?env(?:ironment)? variable/i.test(text)) {
    return "The site is missing a required environment variable. Add the missing variable to your .env file or hosting environment, then restart the preview.";
  }

  // 7. Missing module / package (ERR_MODULE_NOT_FOUND / Cannot find package / Cannot find module)
  const missingModule =
    /Cannot find package ['"]([^'"]+)['"]/i.exec(text) ??
    /Cannot find module ['"]([^'"]+)['"]/i.exec(text) ??
    /ERR_MODULE_NOT_FOUND[^\n'"]*['"]([^'"]+)['"]/i.exec(text);
  if (missingModule) {
    const spec = missingModule[1]!;
    if (isRelativeImport(spec)) {
      return `The preview couldn't find the file “${spec}”. Check that the file exists and its import path is spelled correctly, then restart the preview.`;
    }
    return `The preview couldn't find the package “${spec}”. Install it or check package.json and reinstall dependencies, then restart the preview.`;
  }

  // 8. Astro / Vite config syntax or load errors
  const configFileMatch = /\b((?:astro|vite)\.config\.(?:mjs|mts|ts|js|cjs))\b/i.exec(text);
  if (configFileMatch && /(?:SyntaxError|TypeError|ReferenceError|Error|failed to load config|Unexpected token|Could not load)/i.test(text)) {
    const configFile = configFileMatch[1]!;
    return `There's a syntax or configuration error in ${configFile}. Fix the error shown in the technical details for ${configFile}, then restart the preview.`;
  }

  // 9. Network failure outside explicit install markers
  if (installNet) {
    return `The preview hit a network lookup error (${installNet[1]!.toUpperCase()}). Check the network connection and try restarting the preview.`;
  }

  return null;
}
