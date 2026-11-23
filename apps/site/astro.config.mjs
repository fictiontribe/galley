import { defineConfig, fontProviders } from "astro/config";
import site from "./src/data/site.json" with { type: "json" };
// The site kit, vendored (node packages/astro/scripts/vendor.mjs apps/site): here
// it writes the agent-readable version of the site — a markdown twin of every
// page, llms.txt, llms-full.txt, robots.txt, sitemap.xml and the <head> links —
// from src/data/visibility.json. The email-link chooser comes in through
// <Scripts placement="body-end" /> in the layout. No forms, no managed scripts.
import galley from "./src/galley/integration.js";

// The brand's own font files (brand/fonts), served from this site. Astro's font
// pipeline writes the @font-face rules, the preload links and size-adjusted
// fallback faces, so the swap from fallback to font moves no line.
const brandFont = (file) => `../../brand/fonts/${file}`;

export default defineConfig({
  site: site.url,
  output: "static",
  trailingSlash: "always",
  build: {
    format: "directory",
    // One small stylesheet, cached across pages.
    inlineStylesheets: "never",
  },
  // Code blocks are set in the brand's mono with no colour theme.
  markdown: { syntaxHighlight: false },
  devToolbar: { enabled: false },
  prefetch: false,
  integrations: [galley()],
  fonts: [
    {
      name: "Newsreader",
      cssVariable: "--font-newsreader",
      provider: fontProviders.local(),
      fallbacks: ["Georgia", "serif"],
      display: "swap",
      options: {
        variants: [
          { src: [brandFont("newsreader-latin-opsz-normal.woff2")], weight: "200 800", style: "normal" },
          { src: [brandFont("newsreader-latin-opsz-italic.woff2")], weight: "200 800", style: "italic" },
        ],
      },
    },
    {
      name: "Figtree",
      cssVariable: "--font-figtree",
      provider: fontProviders.local(),
      fallbacks: ["sans-serif"],
      display: "swap",
      options: {
        variants: [{ src: [brandFont("figtree-latin-wght-normal.woff2")], weight: "300 900", style: "normal" }],
      },
    },
    {
      name: "IBM Plex Mono",
      cssVariable: "--font-plex-mono",
      provider: fontProviders.local(),
      fallbacks: ["monospace"],
      display: "swap",
      options: {
        variants: [
          { src: [brandFont("ibm-plex-mono-latin-400-normal.woff2")], weight: "400", style: "normal" },
          { src: [brandFont("ibm-plex-mono-latin-500-normal.woff2")], weight: "500", style: "normal" },
        ],
      },
    },
  ],
});
