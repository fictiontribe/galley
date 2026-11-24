# The in-browser demo

The real web app, running entirely in the visitor's browser on a sample site
(Caddow, `starters/astro-editorial`), with a two-minute walkthrough on top.
No server, no account, nothing saved. It is served from `/demo/` on the
marketing site, from generated files committed in `apps/site/public/demo/`.

## Rebuild it

```sh
pnpm --filter @galley/web build:demo     # → packages/web/demo/dist
pnpm --filter @galley/web demo:publish   # → apps/site/public/demo (+ manifest.json)
```

Then commit `apps/site/public/demo`. The site's own build copies it as is;
it can't build the demo itself (it has no access to this package's
dependencies). `pnpm --filter @galley/web demo:check` fails when the committed
copy is stale: when any file it was built from (listed in `scripts/publish.mjs`)
has changed since. `build:demo --app-only` rebuilds only the app over the
sample site prepared last time, which is quicker while working on the app.

## How it works

- **The server is in the page.** `vite.demo.config.ts` builds the app a second
  time with `demo/index.html` as its entry. `demo/boot.tsx` starts the mock
  server (`mock/server.ts`, the one `dev:mock` uses) in the page and answers
  the app's `fetch` to `/api` and its one `EventSource` from it
  (`shim/transport.ts`). Media addresses under `/api` that the browser loads
  itself (`<img src>`, links to files) are rewritten as they are set
  (`shim/assets.ts`). An in-page shim rather than a service worker: a worker
  can be stopped whenever it is idle, which would lose the visitor's work.
- **Node, stood in for.** `Buffer` (`shim/buffer.ts`) and the bits of
  `node:crypto`, `node:fs` and `node:url` the mock imports (`shim/node.ts`).
  Two mock modules are swapped at build time (`build/plugin.ts`):
  `mock/fixtures.ts` (reads the starter from disk) for `fixtures.ts`, and
  `mock/preview.ts` (loopback servers) for `preview.ts`. The starter's text
  files are snapshotted into the bundle (`virtual:galley-demo/site`); its
  photographs are files beside the demo.
- **Demo-only answers** go in through the mock server's `handlers` option
  (`server.ts`): the recorded assistant (`assistant.ts`), the sample brand
  (`brand.ts`), section pictures and templates from the starter's
  `galley.config.json`, the inbox showing the starter's contact form. The
  sample inbox and redirects are put in through the mock's own routes
  (`sample.ts`).
- **The preview** is the starter built under `/demo/site/` with its
  photographs resized, the real overlay at `site/__galley/overlay.js`, and
  `site/__demo/frame.js` in every page (`frame/`): in the proposed frame it
  draws the working copy onto the built page (words and pictures by their
  section markers, sections in their new order), and it sends the contact
  form to the demo's inbox. The live frame shows the built page as it is.
- **Routing** is a hash router (`#/sites/caddow/edit?…`): a static host has
  no fallback for deep links, so reloads and shared links work anywhere.
- **State** lives in memory and in `sessionStorage` (`persist.ts`, the tour's
  `tour/store.ts`), so a reload keeps the visitor's changes, versions,
  conversations and place in the tour. "Start over" clears it.
- **The walkthrough** (`tour/`) moves on when the visitor does the real thing
  (`tour/steps.ts`, tested in `test/demo`), from the server's state and the
  app's address, never from clicks on the card.

Below 1024 × 600 the app isn't loaded at all: a short page offers the film
and the tour instead (`smallScreen.ts`).
