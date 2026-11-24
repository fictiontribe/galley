/**
 * site/ — the facade. Content and workspace composed into one SiteService per
 * open site, and the SiteRegistry that knows every site. Server routes and the
 * assistant's tools call these and nothing below them (docs/ARCHITECTURE.md §3.3).
 */
export { createEventBus } from "./events";
export { createSiteService, siteNameAt, type SiteDeps } from "./service";
export { createSiteRegistry, type GalleySiteRegistry, type SiteRegistryOptions } from "./registry";
export { currentSiteId, isSiteId, withSiteScope, withoutSiteScope } from "./scope";
export { createPreviewPolicy, DEFAULT_PREVIEW_POLICY, PREVIEW_LIMITS, type PreviewPolicy, type PreviewPolicyOptions } from "./preview-policy";
export { probeSite, scanForSites, SCAN_LIMITS, type ProbedSite, type ScanLimits, type ScanOutcome } from "./scan";
export { countPorcelain, findShareImage, readSiteFacts, type FactsResult } from "./facts";
export { createSiteStore, GROUP_COLORS, type SiteRecord, type SiteStore } from "./store";
export { siteIdFor } from "./util";
export { changeSettings, readSettings } from "./settings-records";
export { checkLook, lookFor, nameSite, scaffoldSite, SITE_NAME_FILES, type ScaffoldSiteInput } from "./scaffold-site";
export { listStarters, readStarterManifest, starterPreviewFile, STARTER_MANIFEST } from "./starters";
