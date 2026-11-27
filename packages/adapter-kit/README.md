# @galleycms/adapter-kit

Write and test framework adapters for [Galley](https://galley.fictiontribe.com),
the open-source, git-based AI CMS for static sites.

This package provides the adapter TypeScript types, `defineAdapter` and
`conventionAdapter`, and the conformance check (`checkAdapter`,
`describeAdapter`, and the `galley-adapter-check` CLI) that verifies an adapter
against a real fixture site.

Guide: [`docs/adapters.md`](https://github.com/fictiontribe/galley/blob/main/docs/adapters.md)

## Usage

```ts
import { defineAdapter, conventionAdapter, checkAdapter } from "@galleycms/adapter-kit";
```

With Vitest:

```ts
import { describeAdapter } from "@galleycms/adapter-kit/vitest";
```

From the command line:

```sh
npx galley-adapter-check ./my-adapter.mjs ./fixtures/my-site
```

## Exports

| Entry point | Contents |
| --- | --- |
| `@galleycms/adapter-kit` | `ADAPTER_API_VERSION`, `defineAdapter`, `conventionAdapter`, `parseModule`, `validateAdapter`, `checkAdapter`, `checksFor`, `CHECKS`, `FOREIGN_FIXTURES`, `formatReport`, and adapter types |
| `@galleycms/adapter-kit/vitest` | `describeAdapter` (plus `checkAdapter`, `formatReport`, and report types) |
| `galley-adapter-check` | CLI conformance checker binary |

## Licence

Apache-2.0.
