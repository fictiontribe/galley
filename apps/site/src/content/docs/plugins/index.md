---
title: Plugins
description: What a plugin can add to Galley — image and video generators, form destinations, scripts, importers, hosts, tools for the assistant — how to add one, and how to write one in a single file.
group: extend
order: 3
---

This page is for developers. A plugin adds something to Galley without changing Galley: a framework adapter, an image or video generator, a form destination, a third-party script, an importer, a deploy host, a data source for a field's picker, a tool for the assistant (and every MCP client), a theme for the editing app (checked like any other: [themes](/docs/plugins/themes/)), or a hook that runs around publishing. Every built-in is registered the same way, through the same API. *Status: built.*

## What a plugin can do — and what it is not

A plugin **can** add the contributions above, ask for settings (secrets included), log, call the network with the `fetch` it is given, read a site through the same service the assistant uses, and refuse a publish.

It **cannot** take a built-in tool's name, read another plugin's settings, receive the app's own keys (Anthropic, OpenAI, Google, anything in a `GALLEY_*` variable), write to a site from a hook, or write in build mode when it was called in content mode.

**A plugin is not a sandbox.** It is code running inside Galley with the same permissions as the person who started it — your files and your keys. The rules above stop accidents and keep the API honest; they don't contain a plugin written to do harm. Add only plugins you trust, as you would any npm package. The app says the same on its **Plugins** screen.

## What ships with the app

`galley plugin list` (or **Plugins** in the app) shows them: the built-ins (9 framework adapters, 3 image generators, 7 form destinations, 12 scripts, Cloudflare and Vercel), **OpenRouter** (images and videos on one OpenRouter key), **Shopify** ([its page](/docs/plugins/shopify/)) and the **WordPress importer**. The core built-ins can't be turned off; the others can.

## Add one

For everyone on this computer (or server):

```sh
cp -R examples/plugin-example ../galley-plugin-example
galley plugin add ../galley-plugin-example
galley plugin list
galley plugin disable galley-plugin-example
galley plugin remove galley-plugin-example
```

`add` takes a folder, a packed `.tgz`, or an npm package name (no Galley plugins are on npm yet). Installed plugins live in `<GALLEY_HOME>/plugins`, installed with `npm --ignore-scripts` (a package's own install scripts never run), and the exact version is recorded. A package must have the keyword `galley-plugin` and export a plugin that passes the structural check. A running Galley picks up changes when it restarts. The app's **Plugins** screen shows each plugin, what it adds and where it shows up, and its settings; it adds nothing itself — adding is a terminal command on purpose.

For one site only, name it in the site's `galley.config.json`:

```json galley.config.json
{ "plugins": ["galley-plugin-example", "./tools/plugin.mjs"] }
```

That runs the site's own code inside Galley, only for that site. On a hosted Galley it's off unless the operator sets `GALLEY_ALLOW_SITE_PLUGINS=1`; `GALLEY_DISABLE_SITE_PLUGINS=1` turns it off anywhere. A site's plugins can't change the image or video generator, which is chosen for the whole app.

## Write one

A plugin is a plain object — no dependencies, no build step:

```js
// tools/plugin.mjs
export default {
  name: "galley-plugin-hello",
  version: "1.0.0",
  apiVersion: 1,
  tools: [
    {
      name: "say_hello",
      title: "Say hello",
      description: "Greet someone by name. Read-only; use it when the person asks the assistant to say hello.",
      input: { type: "object", properties: { name: { type: "string", description: "Who to greet." } }, required: ["name"] },
      mode: "content",
      effect: { readOnly: true },
      run: (input) => `Hello, ${input.name}.`,
    },
  ],
};
```

Name it in a site's config as above, and the assistant — and every MCP client connected to the site — offers `say_hello`.

Every key but `name` and `apiVersion` is optional: `adapters`, `imageProviders`, `videoProviders`, `formProviders`, `scriptIntegrations`, `importers`, `deployTargets`, `tools`, `dataSources`, `hooks`, `settings`, `setup`. Each call gets a context with the plugin's own settings, a logger that scrubs secrets, `fetch` and the product's name — name the product by `ctx.brand.productName`, never "Galley", because a deployment may rename it. What a tool or a hook is handed of the site, its model above all (`site.model()`), is the site's own and read-only: to work on it, take a copy (`structuredClone`).

`examples/plugin-example` in the repository is the template to copy: a script integration (Fathom), a publish webhook and a word-count tool, with tests using `@galleycms/plugin-kit`'s checks and test doubles. The docs added, listed, turned off and on, and removed it with the commands above.

Every contribution's shape, the hooks and their guarantees, settings and secrets, testing, naming and publishing: [`docs/plugins.md`]({repository}/blob/main/docs/plugins.md). `@galleycms/plugin-kit` isn't on npm yet; it is `packages/plugin-kit` in the repository.

## Next

- [Adapters](/docs/adapters/) — the plugin kind that teaches Galley a framework.
- [Galley over MCP](/docs/integrations/mcp/) — plugin tools appear there too.
- [Security](/docs/running/security/).
