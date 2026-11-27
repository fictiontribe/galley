# Theme listing — Ferrow (`galley-astro-saas`) copy to paste into portal.astro.build

Paste each block as **plain text** into the portal's editor. Do not paste
Markdown or HTML: reviewers reject descriptions that show raw formatting. If
the editor offers a bulleted list, use its button for the feature lines;
otherwise leave them as separate short paragraphs.

## Title

Pick one. All say what it is; none names the maker.

1. **Ferrow — B2B SaaS Starter for Galley** (recommended — matches the sample brand, the demo notice and the README)
2. Galley + Astro SaaS Starter
3. B2B Software Marketing Starter (Ferrow)

## One-line summary

```
A static B2B SaaS marketing site built with Astro 7: twenty-nine section types, customer stories, a changelog, pricing tables, a blog with tags and three looks, all in plain files.
```

## Description

```
A complete marketing site template for a B2B software company, shown with sample content for a fictional planned-maintenance and compliance platform called Ferrow. Every page is a Markdown file that composes its sections from a typed schema, so new landing, product, pricing or solution pages are assembled from content rather than coded.

Inside: home, product, pricing, solutions, customer stories, blog, changelog, security, about, contact, privacy, terms and not-found pages, built from twenty-nine section types: split hero, centred hero, hero with lead form, logo matrix, interactive feature tabs, metrics, feature grid, split feature, annotated screenshot, steps, use cases, testimonials, featured quote, customer stories, awards, pricing tiers, feature comparison table, alternative comparison table, security practices, integrations, changelog preview, latest posts, FAQ, team, rich text, newsletter, contact, standalone form and call to action. Every section type has a Zod schema, so a mistake in content fails the build with a clear message.

Product UI visuals, diagrams and brand marks are inlined theme-reactive SVGs drawn from design tokens, so switching looks recolours the entire site and its screenshots together. One CSS file of design tokens sets colours, typography, fluid type scale, spacing, borders and elevation; three complete looks are included (Signal, Meridian and a dark look, Night shift). Forms live as JSON files with inline validation and no-JavaScript fallback. The blog includes authors, reading times, pagination and a page for every tag; customer stories and the changelog each have their own collections. Site identity, navigation and every interface label live in two JSON files, so no component contains hardcoded copy.

Built with Astro 7 and TypeScript, with no UI framework, no CSS framework and zero external requests or tracking. Fonts are self-hosted. It includes a sitemap, robots.txt, Open Graph metadata, a skip link, keyboard-accessible menus and tabs that work without JavaScript, and WCAG AA contrast across every look. It builds to static HTML at a domain root or under a sub-path, with ready configuration for GitHub Pages, Netlify and Cloudflare.

It is structured to be edited with Galley, an open-source, Git-based CMS for static sites that reads sections and fields directly from the content schema. Galley is optional: the template is an ordinary Astro project and works completely on its own.

The sample company, its customers, people and figures are fictional. MIT licence.
```

(That is about 2,400 characters. If the portal limits the description length, drop the last two paragraphs first.)

## Categories and technology

On astro.build/themes the filters are, as of November 2026: categories
Blog, Docs, E-commerce, Landing Page, Minimal, Official, Other, Portfolio;
technology Alpine.js, Lit, MDX, PostCSS, Preact, React, SASS, SolidJS,
Svelte, Tailwind, TypeScript, UnoCSS, Vue; price Free / Paid.

- **Categories:** Landing Page, Blog. (Do not choose Official.)
- **Technology:** TypeScript. (No Tailwind, no MDX, no UI framework — do not tick them.)
- **Price:** Free.

## Links

| Field | Value |
| --- | --- |
| Repository / "Get started" | https://github.com/fictiontribe/galley-astro-saas |
| Live demo | https://fictiontribe.github.io/galley-astro-saas/ |

Both are placeholders until the repository is public and the Pages workflow
has run once. Open both in a private window before you submit.

## Images

Capture static screenshots **from the deployed demo** once GitHub Pages is live
(for example with `docs/astro-catalog/capture-screens.mjs` pointed at
`https://fictiontribe.github.io/galley-astro-saas/`). Recommended set of four
16:9 images: home hero (`1920x1080`), interactive product tabs & metrics
(`1600x900`), pricing & comparison table (`1600x900`), and responsive mobile
views composed on a `1600x900` canvas. Keep a `1280x720` home capture as a
fallback if the portal prefers smaller uploads.

## Why each review guideline is satisfied

| Guideline | How this listing meets it |
| --- | --- |
| Current major version of Astro | `package.json` depends on `astro ^7.4.13`; the generator tag on every page reports Astro v7. |
| A public live demo of the repository exactly as a new user gets it | The demo is built by the repository's own `.github/workflows/deploy.yml` from `main`, with no extra steps, secrets or content. |
| Not a production site, not an advertisement | Sample content for a fictional B2B software company (Ferrow); a dismissible template notice links to the README; no sales pitch. |
| No sign-up or friction | Static pages; no cookie wall (the consent banner appears only once a site adds a tag). Contact and demo forms need no account. |
| Nothing broken | Every page, the blog flow (list → post → tag → back), customer stories, changelog, keyboard dropdowns, mobile menu and tabs (with and without JavaScript) were tested at 390 and 1440 px with zero console errors, zero broken links and zero horizontal overflow at both root and sub-path builds. Re-check on the deployed demo. |
| "Get started" points at the open-source repository | The repository link above; MIT licence. |
| README is not Astro's default and helps set up and use the project | The README covers all 29 section types, `npm create astro@latest -- --template …`, content collections, editing, adding a section type, switching looks, templates, thumbnails, removing the notice and deploying. |
| Description is short, plain, in English, without install steps | The text above: no Markdown, no HTML, no shell commands. |
| Static screenshots from the deployed demo, reasonable in size and number | Static PNGs/WebPs captured from the live demo URL. |
| No Houston | `grep -ri houston` across the repository and built site finds nothing. |
| Placeholder content: example.com, root-domain social links, nothing real | E-mail addresses are `@example.com`, the site URL is `https://www.example.com`, social links are root domains (`https://www.linkedin.com/`, `https://www.youtube.com/`, `https://github.com/`), phone is `+1 555 0142`, and all company, customer, award and people names are invented. |
| Light/dark if offered | No runtime toggle. A dark look (`Night shift`) ships as an alternative tokens file; the demo shows the default light look (`Signal`). |
| Promoted UI works | Dismissible template notice, keyboard dropdowns, mobile menu, interactive feature tabs (JS + no-JS fallback), FAQ accordions and blog tag pages were tested. |
