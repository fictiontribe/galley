## What

<!-- One paragraph: what changes and why. Link the issue. -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`, the [DCO](../DCO))
- [ ] Tests for the behaviour this changes (engine code against real files and real git repositories)
- [ ] `pnpm -r --if-present typecheck` and `pnpm -r --if-present test` pass
- [ ] Docs updated where a command, option, config key, variable, route or message changed — `pnpm --filter @galley/site check` passes
- [ ] User-facing copy follows `brand/voice.md`; no product name hard-coded outside `packages/core/src/brand.ts`
- [ ] No telemetry, no new outbound connection, nothing written outside the write surface

## Proof

<!-- The commands you ran and their output, abridged. -->

```
$ …
```
