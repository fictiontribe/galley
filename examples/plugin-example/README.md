# galley-plugin-example

A small but real Galley plugin, and the template to copy for your own. It is
built only on the public plugin API (`@galley/plugin-kit`) and adds three
things:

- **A script integration** — Fathom Analytics. Its snippet is a template
  (`{{siteId}}` is filled in from the setting when the app adds it to a site).
- **A publish webhook** — an `afterPublish` hook that posts one plain
  sentence about each publish (“Harbour Bakery: 2 files published.”) to the
  address in its *Publish webhook* setting. The address is kept as a secret,
  because webhook addresses usually carry a token.
- **An assistant tool** — `count_words`, read-only: the words in one entry's
  body and text fields. The built-in assistant and every MCP harness get it.

The full guide is [docs/plugins.md](../../docs/plugins.md).

## Use it

A plugin is installed as built JavaScript (installing runs npm with
`--ignore-scripts`, and Node won't run TypeScript from `node_modules`), so
this folder ships `dist/` — what `npm run build` makes from `src/` — and its
`package.json` points there. The plugin imports types only (it checks its
shape with `satisfies GalleyPlugin`), so the built file has no dependencies
and installs as it is. Copy the folder (call it after your plugin), then:

```sh
galley plugin add ./galley-plugin-example     # or the .tgz `npm pack` makes
galley plugin list
```

Restart the app to load it. After changing `src/`, run `npm run build`; the
tests fail while `dist/` is out of date.

Or for one site only, named in its `galley.config.json` (installed in the
site's `node_modules`, or a path to a file inside the site):

```json
{ "plugins": ["galley-plugin-example"] }
```

Then set the webhook on the Plugins screen, or over HTTP with
`PUT /api/plugins/settings` — `{ "name": "galley-plugin-example", "values": { "webhookUrl": "https://…" } }`.

## Make your own from it

1. Copy this folder. Rename the package to `galley-plugin-<name>` (or
   `@scope/galley-plugin-<name>`), keep the `galley-plugin` keyword, and set
   `name` in `src/index.ts` to the same.
2. Delete the contributions you don't need and add yours — each kind, with a
   real example, is in [docs/plugins.md](../../docs/plugins.md#contributions).
3. Keep `test/plugin.test.ts`: `describePlugin(plugin)` runs the kit's checks
   (the same structural check the app runs before it uses a plugin, plus each
   contribution exercised the way the app will), and below it go one or two
   tests of what your plugin actually does, with the kit's `fakeFetch` and
   `testContext`.
4. `npm run build`, then `npm test`. Publish built JavaScript: installing
   runs npm with `--ignore-scripts`, so nothing is compiled on the way in.

## Files

- `src/index.ts` — the plugin.
- `dist/` — the built plugin, what gets installed (`npm run build`).
- `test/plugin.test.ts` — the kit's checks and one behaviour test per contribution.
- `test/built.test.ts` — `dist/` matches `src/` and imports nothing.
