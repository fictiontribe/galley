/**
 * content/ — the engine's pure content logic: site detection, schema
 * inference, config, documents, format-preserving edits, body blocks, the
 * content index (search, click-to-edit), routes, validation and field diffs.
 * No git, no processes, no network; files are read, never written.
 */
export type {
  BodyBlock,
  BodyBlockKind,
  ContentIndex,
  FrontMatterRegion,
  FrontMatterSyntax,
  ParsedDocument,
  ResolveOptions,
  SearchOptions,
  ValidationContext,
} from "./model";

// detection + model
export { detectSite } from "./detect/detect";
export { analyzeAstroConfig, analyzeAstroSiteConfig } from "./detect/astro";
export { detectSiteModel, loadSiteModel, mergeConfig, readConfig, serializeConfig } from "./config/config";
export { diffOps, updateConfigText } from "./config/config-text";
export { configJsonSchema, validateConfig } from "./config/schema";

// documents
export { formatForPath, parseDocument, ROOT_LIST_KEY } from "./document/parse";
export { findFrontMatter } from "./document/front-matter";
export { enumerateBodyBlocks } from "./document/body-blocks";
export { serializeEntry } from "./document/serialize";
export { applyEdits, type ApplyResult } from "./edit/apply";

// schema
export { inferField, inferFields, pickListFields } from "./schema/infer";

// entries
export { collectionForPath, entryUrl, pathForSlug, slugForPath, urlKey } from "./entries/paths";
export { buildEntry, listEntries, readEntry } from "./entries/entries";
export { primeCache } from "./entries/files";
export { hashContent } from "./util/json";
export { labelForKey, normalizeSlug } from "./util/text";

// index / search / resolve
export { buildContentIndex } from "./index/content-index";

// validation + diff
export { validateEntry } from "./validate/validate";
export { diffFields, labelForFieldPath } from "./diff/fields";
export { summarizeChange, type ChangeSummaryInput } from "./diff/summary";
