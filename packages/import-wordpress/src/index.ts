/**
 * @galley/import-wordpress — bring a WordPress site into a Galley site.
 *
 *   readWordPress   fetch or parse only; no site needed
 *   planImport      pure: what would be created where, and what can't be mapped
 *   runImport       write the plan through SiteService as pending changes
 *   importCommand   `galley import wordpress <url|file>`, ready to mount in the CLI
 */
export { readWordPress, sourceFromArgument, cacheDirFor } from "./source/index";
export { discoverApi, endpoint, normalizeSiteInput } from "./source/rest";
export { readWxr } from "./source/wxr";
export { createFetcher, USER_AGENT, defaultCacheDir } from "./source/http";
export { planImport, proseBlock, toSlug } from "./plan";
export { runImport } from "./run";
export { renderReport, buildReport, answerFlag } from "./report";
export { importCommand, IMPORT_HELP, planContext, defaultsFromAnswers, type ImportIo } from "./command";
export { convertHtml, summarize } from "./convert/html";
export { convertItem } from "./convert/index";
export { processShortcodes, parseAttributes } from "./convert/shortcodes";
export { wpautop, prepareRaw } from "./convert/raw";
export { elementorOutlineFromData, elementorOutlineFromHtml, isElementorHtml } from "./convert/builders/elementor";
export { builderOfHtml, builderOutlineFromHtml } from "./convert/builders/generic";
export { classifySection, suggestSection, buildRebuildBrief, rebuildRequest } from "./rebuild";
export { inspectWordPress, type Inspection, type InspectOptions } from "./inspect";
export { createGuardedFetch, type GuardedFetchOptions } from "./source/guarded";
export { readRest } from "./source/rest";
export { mapRoles } from "./fields";
export { astroSnippet, netlifySnippet, oldPath } from "./redirects";
export { MANIFEST_PATH, IMPORT_DIR, loadManifest } from "./manifest";
export { ImportError, EXPORT_FILE_ROUTE } from "./errors";
export type * from "./types";
