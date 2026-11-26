/**
 * The adapters that ship with Galley, in registration order. Order breaks
 * ties between equally confident matches; the generic markdown adapter is
 * last because it matches every folder, weakly.
 */
import type { GalleyAdapter } from "../adapter/types";
import { astroAdapter } from "./astro/index";
import { docusaurusAdapter } from "./docusaurus/index";
import { eleventyAdapter } from "./eleventy/index";
import { genericAdapter } from "./generic/index";
import { hugoAdapter } from "./hugo/index";
import { jekyllAdapter } from "./jekyll/index";
import { nextAdapter } from "./next/index";
import { nuxtAdapter } from "./nuxt/index";
import { sveltekitAdapter } from "./sveltekit/index";

export { astroAdapter } from "./astro/index";
export { docusaurusAdapter } from "./docusaurus/index";
export { eleventyAdapter } from "./eleventy/index";
export { genericAdapter, GENERIC_ID } from "./generic/index";
export { hugoAdapter } from "./hugo/index";
export { jekyllAdapter } from "./jekyll/index";
export { nextAdapter } from "./next/index";
export { nuxtAdapter } from "./nuxt/index";
export { sveltekitAdapter } from "./sveltekit/index";

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
