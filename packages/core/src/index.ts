/**
 * @galley/core — the engine.
 *
 *   types / api   the contracts every package speaks
 *   content       pure content logic: detection, schema inference, format-preserving edits, search
 *   workspace     the checkout: guarded files, git, changes, publish, preview, media
 *   site          SiteService + SiteRegistry — content and workspace composed into one facade
 *   ai            the assistant, image generation, settings and usage
 */
export * from "./types";
export * from "./api";
export * from "./kit";
export * from "./kit-catalog";
export * from "./brand";
export * from "./errors";
export * as content from "./content/index";
export * as workspace from "./workspace/index";
export * as site from "./site/index";
export * as ai from "./ai/index";
