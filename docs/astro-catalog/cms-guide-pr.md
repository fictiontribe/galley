# Pull request to `withastro/docs`: a Galley CMS stub page

**Open this only after** the `galley-cms` package is on npm and the three
links in the page resolve (galley.fictiontribe.com/docs, the `galley` and
`galley-astro-starter` repositories). Every sentence of the page describes
the code as it is today; the command and the links depend on publication.

## The files

The format copies the community stub pages already in Astro's docs —
`pages-cms.mdx`, `vault-cms.mdx` (front matter, one paragraph, official
resources) and `sitepins.mdx` (a three-step "Getting started" list). A recent
stub, Vault CMS (withastro/docs#13235, merged February 2026), changed exactly
these three kinds of file:

| File in `withastro/docs` | Source here |
| --- | --- |
| `src/content/docs/en/guides/cms/galley.mdx` | `docs/astro-catalog/cms-guide-galley.mdx` |
| `public/logos/galley.svg` | `docs/astro-catalog/galley-logo.svg` (the Galley mark, reversed on an ink tile so it reads on Astro's light and dark themes) |
| `src/data/logos.ts` | add one line, in alphabetical order (after `'frontmatter-cms'`, before `gatsby`): `galley: { file: 'galley.svg', padding: '.1em' },` |

Steps: fork `withastro/docs`, create a branch `cms-galley`, add the three
changes above, run `pnpm install && pnpm run format && pnpm run check` if you can, push, and open
the pull request against `main` with the text below. Only English changes —
the translation teams pick up new pages themselves.

## Title

```
Add Galley to the CMS guides (stub)
```

## Description

```markdown
#### Description (required)

Adds a stub page for [Galley](https://galley.fictiontribe.com/), an open-source (Apache-2.0), Git-based AI CMS for static sites that is built for Astro: it reads an Astro project's content collections and schemas without configuration, and publishes changes as Git commits.

The page follows the existing stubs (Pages CMS, Vault CMS, Sitepins): one paragraph, a three-step getting-started list, a starter-template command and official resources. It adds `public/logos/galley.svg` and its entry in `src/data/logos.ts`.

Disclosure: I work on Galley.

#### References

- Suggested label: `3rd-party guide`
- Discord username: ...
```

## Checks before you press "Create pull request"

- `npx galley-cms` in an Astro project folder opens Galley (needs the npm
  package).
- `npm create astro@latest -- --template fictiontribe/galley-astro-starter`
  creates the starter (needs the public template repository).
- https://galley.fictiontribe.com/docs/ answers (needs the site deployed).
- The page builds in the docs preview that the pull request gets, and the
  logo shows on both themes.
