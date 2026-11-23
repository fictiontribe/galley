# Governance

Galley is an open-source project maintained by
[Fiction Tribe](https://fictiontribe.com), the creative agency that started it
for the sites it builds and hands over. This page says who decides what, and
how that can change.

## Maintainers

The maintainers are the Fiction Tribe staff with merge rights on the
repository. They review and merge pull requests, cut releases, and hold the
npm packages, the domain and the GitHub organisation.

| Name | GitHub | Since |
| --- | --- | --- |
| *To be listed when the repository is published* | | |

Until the list has more than one name on it, the bus factor is Fiction Tribe
itself, stated plainly.

## How decisions are made

- **In the open.** Design decisions are made in issues and pull requests, not
  in private, and are checked against the principles in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). If the code and that document
  disagree, one of them is fixed in the same change.
- **Lazy consensus.** A proposal in an issue that stands for seven days
  without a maintainer's objection is accepted. An objection says what would
  resolve it.
- **Changes to the principles** in `docs/ARCHITECTURE.md` — what Galley
  promises (no paid tier, no telemetry, the closed write surface, surgical
  edits, never guessing) — need an issue, the seven days, and a maintainer's
  explicit approval.
- **Everything else** — code, adapters, docs, the website — merges on one
  maintainer's approval with green CI.

## Open source, always

The project's commitments are part of its governance, not a policy that can be
changed quietly: Galley is Apache-2.0; no feature is held back for a paid
tier; nothing phones home; there is no account to create.

## Becoming a maintainer

After sustained, non-trivial contributions — an adapter, a substantial fix or
feature with its tests, documentation work — a maintainer may nominate a
contributor in a public issue. After seven days of lazy consensus they are
added to the table above and given merge rights. Maintainers do not have to
work at Fiction Tribe.

## Stepping down

A maintainer who has been inactive for six months is asked whether they wish
to continue; no reply after a further month moves them to an emeritus list on
this page.

## Scope

The project maintains the engine, the server, the CLI, the web UI, the preview
overlay, the desktop app, the adapter API and conformance kit, the built-in
adapters, the Astro starter, and the website and documentation. It does not
operate a hosted Galley for anyone, and it does not receive anyone's content
or keys.

## Code of conduct

Everyone in the project's spaces follows the [Code of Conduct](CODE_OF_CONDUCT.md).
