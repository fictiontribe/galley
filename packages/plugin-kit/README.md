# @galley/plugin-kit

Write and test plugins for [Galley](https://galley.fictiontribe.com), the
open-source, git-based AI CMS for static sites.

This package provides the plugin TypeScript types, `definePlugin`,
`ProviderError`, `resolveScriptSnippet`, testing helpers (`fakeFetch`,
`testContext`, `providerContext`), and `checkPlugin` / `describePlugin` for
structural and behavioural plugin verification.

Guide: [`docs/plugins.md`](https://github.com/fictiontribe/galley/blob/main/docs/plugins.md)

## Usage

```ts
import { definePlugin, ProviderError, checkPlugin } from "@galley/plugin-kit";
```

With Vitest:

```ts
import { describePlugin } from "@galley/plugin-kit/vitest";
```

## Exports

| Entry point | Contents |
| --- | --- |
| `@galley/plugin-kit` | `PLUGIN_API_VERSION`, `definePlugin`, `validatePlugin`, `ProviderError`, `isProviderError`, `resolveScriptSnippet`, `checkPlugin`, `formatPluginReport`, `summarizePlugin`, `fakeFetch`, `json`, `testContext`, `providerContext`, and plugin types |
| `@galley/plugin-kit/vitest` | `describePlugin` (plus `checkPlugin`, `formatPluginReport`, and report types) |

## Licence

Apache-2.0.
