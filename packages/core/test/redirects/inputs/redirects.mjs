// Redirects from the WordPress import. Use them in astro.config.*:
//   import { redirects } from "./wordpress-import/redirects.mjs";
//   export default defineConfig({ redirects, … });
export const redirects = {
  "/2019/05/survey-notes/": "/blog/measured-survey/",
  "/sample-page/": "/about/"
};
