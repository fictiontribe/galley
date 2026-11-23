# create-galley

Make a new site with [Galley](https://galley.fictiontribe.com), the
open-source AI CMS for static sites, in one command:

```sh
npm create galley@latest
```

It asks which starter and what to call the site, copies the starter into a
new folder, records the first version, installs the dependencies and opens
Galley on it in your browser. All it needs is Node 22.23.4 or newer and git.

Without questions:

```sh
npm create galley@latest my-site -- --starter caddow
pnpm create galley my-site --starter caddow
yarn create galley my-site --starter caddow
bun create galley my-site --starter caddow
```

The site's dependencies are installed with the package manager you ran it
with.

| Starter | What it is |
| --- | --- |
| `lowfield` (the default) | A site for a small studio or local business |
| `caddow` | A photography-led site for a small fashion label |
| `ferrow` | A marketing site for a software company |
| `storefront` | A shop for a small fashion label, with products from Shopify |

Options: `--starter <name>`, `--look <id>`, `--dir <folder>`,
`--use npm|pnpm|yarn|bun`, `--no-install`, `--no-open`, `--no-start`,
`--port <port>`. `npm create galley@latest -- --help` lists them all.

To open the site again later, run `npx galley-cms` in its folder.

create-galley is a small front door: the work is done by
[`galley-cms`](https://www.npmjs.com/package/galley-cms)'s `galley new`, which
is installed with it. Apache-2.0.
