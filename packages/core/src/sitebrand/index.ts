/**
 * sitebrand — the brand of a site the app edits: its look and voice, set up
 * from the site itself or from material people add, reviewed as a proposal,
 * saved as files in the site. See docs/brand.md.
 *
 * (Not the product's own white-label brand: that is src/brand.ts.)
 */
export * from "./types";
export { contrastRatio, contrastResult, deltaE, normalizeColor, parseColor, toHex } from "./color";
export { scanDeclared, type DeclaredScan, type DeclaredVar } from "./declared";
export { decodePng, encodePng, paletteOf, downscale } from "./png";
export { readSvg, inertSvg } from "./svg";
export { readPdf } from "./pdf";
export { mergeMeasurements, parseMeasurements, measureSummarySchema, MAX_MEASURED_PAGES } from "./measured";
export { buildCandidates, buildProposal, evidencePack, contrastPairs, roleFromName, refresh } from "./proposal";
export { parseBrandFile, siteBrandFileSchema, readingSchema, synthesisSchema, revisionSchema } from "./schema";
export { planApply } from "./apply";
export { checkChanges, drift } from "./check";
export { exportBundle, exportDesignTokens, readBundle, BUNDLE_KIND, DTCG_MEDIA_TYPE, type BrandBundle } from "./export";
export { brandLocation, readSavedBrand, DEFAULT_BRAND_DIR, DEFAULT_LARGE_FILE_MB, BRAND_SCHEMA_URL } from "./files";
export { brandJsonSchema } from "./schema";
export { renderGuide, brandDigest, imageryBrief } from "./guide";
export { SOURCE_LIMITS, sniff } from "./sources";
export { PDF_LIMITS, SYSTEM as ANALYSIS_SYSTEM_PROMPT } from "./model";
export { createSiteBrandService, type SiteBrandService, type SiteBrandServiceOptions, type AnalyseRequest } from "./service";
export { siteBrandInstructions, SITE_BRAND_TOOLS } from "./tools";
