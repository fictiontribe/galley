# Theme listing — copy to paste into portal.astro.build

Paste each block as **plain text** into the portal's editor. Do not paste
Markdown or HTML: reviewers reject descriptions that show raw formatting. If
the editor offers a bulleted list, use its button for the feature lines;
otherwise leave them as separate short paragraphs.

## Title

Pick one. All say what it is; none names the maker.

1. **Galley + Astro Starter** (recommended — matches the repository, the demo
   notice and the README)
2. Studio & Small Business Starter for Galley
3. Lowfield — Studio Site Starter (named after the sample studio)

## One-line summary

```
A static site for a small studio or business: seventeen section types, a contact form, a journal, three looks, all in plain files you can edit by hand or with Galley.
```

## Description

```
A complete marketing site for a small studio, practice or business, shown with sample content for a made-up architecture studio. Every page is a Markdown file that lists its sections, so pages are put together rather than coded.

Inside: home, services, about, pricing, contact, journal, privacy and not-found pages, built from seventeen section types: hero, logos, features, split, stats, steps, testimonial, testimonials, pricing, FAQ, gallery, team, latest posts, rich text, call to action, contact and form. Each section type has a schema, so a mistake in the content fails the build with a clear message.

The contact form is one JSON file: its fields, wording and thank-you live there, it checks answers as visitors type and it works without JavaScript. The journal has authors, reading times, newer and older links, paginated listings and a page for every tag. Site details, navigation and every interface label live in two JSON files, so no component contains copy. One CSS file of design tokens sets the colours, the two typefaces, the type scale, spacing and motion; three complete looks are included, one of them dark.

Built with Astro 7 and TypeScript, with no UI framework, no CSS framework, and no tracking or third-party requests (tags you add later wait behind a consent banner). Fonts are self-hosted. It includes a sitemap, robots.txt, Open Graph tags, a skip link, visible focus states and a mobile menu that works without JavaScript. It builds to static files and works at the root of a domain or under a sub-path, with ready configuration for GitHub Pages, Netlify and Cloudflare.

It is written to be edited with Galley, an open-source, Git-based CMS for static sites, which reads the sections and fields straight from the content schema. Galley is optional: the template is an ordinary Astro project and works without it.

The sample studio, its people and its clients are fictional. MIT licence.
```

(That is about 1,750 characters. If the portal limits the description, drop
the last two paragraphs first.)

## Categories and technology

On astro.build/themes the filters are, as of November 2026: categories
Blog, Docs, E-commerce, Landing Page, Minimal, Official, Other, Portfolio;
technology Alpine.js, Lit, MDX, PostCSS, Preact, React, SASS, SolidJS,
Svelte, Tailwind, TypeScript, UnoCSS, Vue; price Free / Paid.

- **Categories:** Landing Page, Blog. (Add Minimal only if the portal asks
  for a third; do not choose Official.)
- **Technology:** TypeScript. (No Tailwind, no MDX, no UI framework — do not
  tick them.)
- **Price:** Free.

## Links

| Field | Value |
| --- | --- |
| Repository / "Get started" | https://github.com/fictiontribe/galley-astro-starter |
| Live demo | https://fictiontribe.github.io/galley-astro-starter/ |

Both are placeholders until the repository is public and the Pages workflow
has run once. Open both in a private window before you submit.

## Images

Upload the set captured **from the deployed demo** with
`node docs/astro-catalog/capture-screens.mjs https://fictiontribe.github.io/galley-astro-starter/ docs/astro-catalog/screenshots/demo`.
Recommended order: `01-home-1920x1080`, `03-pricing-1600x900`,
`04-journal-post-1600x900`, `06-phones-1600x900`. Keep `02-home-1280x720` as
the fallback if the portal wants a smaller first image. The files in
`screenshots/local-build/` were taken from a local production build of the
same tree; they show what to expect and must not be uploaded.

## Why each review guideline is satisfied

| Guideline | How this listing meets it |
| --- | --- |
| Current major version of Astro | `package.json` depends on `astro ^7.4.13`; the generator tag on every page says Astro v7. |
| A public live demo of the repository exactly as a new user gets it | The demo is built by the repository's own `.github/workflows/deploy.yml` from `main`, with no extra steps, secrets or content. |
| Not a production site, not an advertisement | Sample content for a fictional studio; a notice at the top says it is a template and links to the README. Galley appears once in the notice and in the README, never as a sales pitch. |
| No sign-up or friction | Static pages; no cookie wall (the consent banner appears only once a site adds a tag). The contact form needs no account from the visitor; on the demo, which has no capture address, sending it says the form isn't connected yet — check the wording is acceptable, or point `forms.endpoint` at a live inbox before submitting. |
| Nothing broken | Every page, the journal flow (list → post → tag → back) and the navigation were clicked through at 390 and 1440 px with no console errors and no broken links, at the domain root and under the sub-path. Re-check on the deployed demo. |
| "Get started" points at the open-source repository | The repository link above; MIT licence. |
| README is not Astro's default and helps set up and use the project | The README covers what you get, `npm create astro@latest -- --template …`, the content layout, editing, adding a section type, theming, removing the notice and deploying to four hosts. |
| Description is short, plain, in English, without install steps | The text above: no Markdown, no commands. |
| Static screenshots from the deployed demo, reasonable in size and number | Four to six PNGs, 16:9, under 250 kB each, captured from the demo URL by the script. |
| No Houston | `grep -ri houston` over the repository and the built site finds nothing; the toolbar app uses Galley's own mark. |
| Placeholder content: example.com, root-domain social links, nothing real | E-mail addresses are `@example.com`, the site URL is `https://www.example.com`, social links are `https://www.instagram.com/` etc. with no username, the phone number is in Ofcom's range reserved for fiction (01632 960xxx), and the town (Wrenhallow), people, clients and suppliers are invented. |
| Light/dark if offered | No toggle. A dark look (Evening) ships as an alternative tokens file; the demo shows the default light look. |
| Promoted UI works | The dismissible notice, the mobile menu and the tag links were tested. |
