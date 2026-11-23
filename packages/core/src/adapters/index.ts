/**
 * The adapters that ship with Galley, in registration order. Order breaks
 * ties between equally confident matches; the generic markdown adapter is
 * last because it matches every folder, weakly.
 */
import type { GalleyAdapter } from "../adapter/types";
import { astroAdapter } from "./astro/index";
import { docusaurusAdapter, eleventyAdapter, hugoAdapter, jekyllAdapter, nextAdapter, nuxtAdapter, sveltekitAdapter } from "./conventions/index";
import { genericAdapter } from "./generic/index";

export { astroAdapter } from "./astro/index";
export { docusaurusAdapter, eleventyAdapter, hugoAdapter, jekyllAdapter, nextAdapter, nuxtAdapter, sveltekitAdapter } from "./conventions/index";
export { genericAdapter, GENERIC_ID } from "./generic/index";

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
