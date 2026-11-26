/**
 * The product's name lives here and nowhere else. Renaming the product, or
 * white-labelling a deployment, starts in this file — nothing user-facing may
 * hard-code "Galley".
 */
import type { BrandConfig } from "./types";

export const PRODUCT = {
  name: "Galley",
  tagline: "Prompt it. Proof it. Publish it.",
  descriptor: "The AI CMS for static sites",
  maker: "Fiction Tribe",
  /** CLI binary and config file stem. */
  slug: "galley",
  configFile: "galley.config.json",
  /** Trailer added to every commit the product makes. */
  commitTrailer: "Galley-Publish",
  /** Per-user state directory name (inside the OS home), overridable with GALLEY_HOME. */
  homeDir: ".galley",
} as const;

/**
 * The project's public addresses — planned; nothing is served there until the
 * first release (RELEASING.md). Everything that points at them is built from
 * these, so moving the site is a one-line change.
 */
export const SITE_URL = "https://galley.fictiontribe.com";
export const REPOSITORY_URL = "https://github.com/fictiontribe/galley";
/** Where the config file's JSON Schema is published: the docs site builds it from `galley schema`. */
export const CONFIG_SCHEMA_URL = `${SITE_URL}/schema/${PRODUCT.configFile}`;

export const DEFAULT_BRAND: BrandConfig = {
  productName: PRODUCT.name,
  byline: `by ${PRODUCT.maker}`,
  docsUrl: `${SITE_URL}/docs`,
};

export const VERSION = "0.4.9";

/**
 * Where the hosted install's image is published: the GitHub Container Registry,
 * under the same organisation as the repository. "Host the editor online" runs
 * `${IMAGE_REPOSITORY}:${VERSION}` unless GALLEY_HOSTING_IMAGE names another
 * image.
 */
export const IMAGE_REPOSITORY = `ghcr.io${new URL(REPOSITORY_URL).pathname.toLowerCase()}`;
