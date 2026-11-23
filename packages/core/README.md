# @galley/core

The engine: everything Galley knows and does, as a Node library with no HTTP
and no UI. The server, the CLI, the MCP server and the desktop app all call
it; nothing else implements the product. ESM, strict TypeScript, Node 20.11+.
Inside the monorepo it is imported as TypeScript source — there is no build
step — and the CLI bundles it for distribution.

| Entry point | What |
| --- | --- |
| `@galley/core/types` | The domain contract every package speaks (`SiteModel`, `Entry`, `EditOp`, `ChangeSet`, `GalleyConfig`, …). Types only. |
| `@galley/core/api` | The HTTP contract, `ApiRoutes`. Types only. |
| `@galley/core/brand` | The product's name and version — the one place they live. |
| `@galley/core/content` | Pure content logic: detection, schema inference, `galley.config.json`, documents, surgical edits, the content index, routes, validation. No processes, no git. |
| `@galley/core/workspace` | The checkout: contained paths and the write policy, git, changes, publish, checkpoints, the preview and its proxies, media, the watcher. |
| `@galley/core/site` | `createSiteService` and `createSiteRegistry` — content and workspace composed. Server routes and the assistant's tools call this and nothing below it. |
| `@galley/core/ai` | The assistant (loop, tools, prompt, request profiles), image generation, settings, secrets, usage. |
| `@galley/core/adapter` | The public adapter API: `GalleyAdapter`, `AdapterContext`, `defineAdapter`, `conventionAdapter`. |

The design is in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3;
writing an adapter, in [`docs/adapters.md`](../../docs/adapters.md).

## Tests

```sh
pnpm --filter @galley/core test        # vitest: real files and real temporary git repositories, no mocks
pnpm --filter @galley/core typecheck
```

The assistant's request code is tested against scripted API responses. An
opt-in smoke test makes real, billed requests with your key:

```sh
ANTHROPIC_API_KEY=sk-ant-… pnpm --filter @galley/core exec tsx test/ai/live-smoke.mts
```
