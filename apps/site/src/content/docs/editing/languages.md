---
title: Translate your site into other languages
navTitle: Languages and translations
description: Translate individual pages or the whole site automatically with upfront cost estimates, edit side by side with the original language, and keep localized URL slugs, translation memory, glossaries and hreflang tags in Git.
group: site
order: 7
---

For people who look after a multilingual site. **Languages** lets you add languages, translate pages by hand or automatically with the assistant, reuse recurring phrases from Translation Memory, and keep localized URL slugs and `hreflang` tags in step.

## Add languages and configure URLs

Open **Languages** in the sidebar and select **Add language**. Galley saves your language list in `galley.config.json` as a pending change in Proof. If your Astro site already declares an `i18n` block in `astro.config.*`, Galley detects those languages automatically before you add anything to `galley.config.json`.

```json galley.config.json
{
  "i18n": {
    "defaultLocale": "en",
    "locales": [
      { "code": "en", "label": "English" },
      { "code": "es", "label": "Español" },
      { "code": "fr", "label": "Français" }
    ],
    "strategy": "folder",
    "prefixDefaultLocale": false,
    "localizeSlugs": true
  }
}
```

- **File layout (`strategy`)** — `folder` (default) puts translations in a language subfolder (`src/content/pages/es/precios.md`); `suffix` puts them beside the original (`src/content/pages/precios.es.md`).
- **Localized URL slugs (`localizeSlugs`)** — when on, page slugs can be translated per language (`/pricing/` maps to `/es/precios/` and `/fr/tarifs/`). Home pages (`index`) always stay at `/<locale>/`.
- **Default language prefix (`prefixDefaultLocale`)** — off keeps the default language at the site root (`/pricing/`); on gives every language a prefix (`/en/pricing/`).
- **Astro sync** — on an Astro site, **Sync Astro i18n config** under **Language selector & URLs** updates the `i18n` block in `astro.config.*` as a pending change in Proof.

## Translate manually side by side

Whenever a site has two or more languages, the editor shows a language bar above the form:

- Switch directly between existing translations or click a missing language (`+ ES`) to scaffold a draft linked to the source page.
- Toggle **Show original** to view the default-language text right above each field and above the Markdown body.
- When a field matches an entry in Translation Memory, click **Use memory match** to insert it in one click.
- When the original page changes after a translation was saved, Galley marks the translation **Outdated** using a content hash stored in `galley/i18n/manifest.json` — without injecting extra frontmatter keys into your Markdown files.

## Translate pages or the whole site automatically

Click **Translate site…** in the **Languages** header, **Translate missing…** on a language card, or **Translate page…** inside the editor. Before any request is sent to the model, Galley computes and shows:

- **Galley Cloud (managed AI credits)** — the estimated AI credit total, request count, model, and exact Translation Memory savings (reused segments cost 0 credits). Large batches over 600 credits ask for explicit confirmation before starting.
- **Self-hosted and local installs (BYOK)** — the estimated USD cost, input and output token counts, model, equivalent credits, and Translation Memory savings.
- **Zero-cost memory matches** — if every segment of the selected pages already exists in Translation Memory, the preview shows **0 credits ($0.00)** and applies them directly without needing an AI key.

During automatic translation, Galley preserves frontmatter structure, section blocks, images, numbers, and fenced code blocks, rewrites internal links across locales (`/pricing/` to `/es/precios/`), applies your glossary rules, and updates `galley/i18n/manifest.json` and `galley/i18n/memory.json`. Every file waits in Proof for review; nothing is published automatically.

## Translation Memory and Glossary

Both live as plain JSON files inside the repository so they travel with Git history and pull requests:

- **`galley/i18n/memory.json`** — stores approved `source → target` segments per language pair. Exact matches are applied automatically for 0 tokens and $0 during batch translations and surfaced as suggestions while editing manually.
- **`galley/i18n/glossary.json`** — stores brand names marked **Do not translate** and preferred per-language translations injected into every automatic translation prompt.

## Language selector and hreflang tags

On Astro sites using `@galleycms/astro`, import `<LocaleHead />` and `<LanguageSelector />` from `@galleycms/astro/components`. Both read `galley.config.json` and `galley/i18n/manifest.json` to link each page to its exact translated counterpart, including localized slugs, and emit `hreflang` and `x-default` links in `<head>`. See [The site kit](/docs/astro/site-kit/#languages-and-hreflang).
