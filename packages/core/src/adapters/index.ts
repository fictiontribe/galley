/**
 * The adapters that ship with Galley, in registration order. Order breaks
 * ties between equally confident matches; the generic markdown adapter is
 * last because it matches every folder, weakly.
 */
import type { GalleyAdapter } from "../adapter/types";
import { astroAdapter } from "./astro/index";
import { docusaurusAdapter, nextAdapter, nuxtAdapter, sveltekitAdapter } from "./conventions/index";
import { eleventyAdapter } from "./eleventy/index";
import { genericAdapter } from "./generic/index";
import { hugoAdapter } from "./hugo/index";
import { jekyllAdapter } from "./jekyll/index";

export { astroAdapter } from "./astro/index";
export { docusaurusAdapter, nextAdapter, nuxtAdapter, sveltekitAdapter } from "./conventions/index";
export { eleventyAdapter } from "./eleventy/index";
export { genericAdapter, GENERIC_ID } from "./generic/index";
export { hugoAdapter } from "./hugo/index";
export { jekyllAdapter } from "./jekyll/index";

export const BUILTIN_ADAPTERS: readonly GalleyAdapter[] = Object.freeze([
  astroAdapter,
  docusaurusAdapter,
  nuxtAdapter,
  nextAdapter,
  sveltekitAdapter,
  eleventyAdapter,
  hugoAdapter,
  jekyllAdapter,
  genericAdapter,
]);
