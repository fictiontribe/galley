# @galley/overlay

The script the preview proxies add to every HTML page of the site being
previewed, served on the site's own origin at `/__galley/overlay.js`. It is
dependency-free and does nothing unless the page is inside a frame.

In the editor's preview (`edit` role) it outlines text and images on hover,
reports a click to the host window with the element's text and which
occurrence on the page it is, and — once the host says the text resolved to
one plain value — lets the element be retyped in place. In the deployed site's
frame (`follow` role, `data-galley-role="follow"`) it only reports and follows
navigation and scrolling, so the two frames move together. The messages are
`OverlayToHost` and `HostToOverlay` in `@galley/core/types`.

In **Arrange** mode (the page builder) it finds each of the entry's sections
on the page — by `data-galley-block` markers, or by evidence when a site has
none (`src/sections.ts`; it declines rather than guess) — and draws their
outlines, toolbar, insertion lines and drop line in one shadow root outside
`<body>` (`src/arrange.ts`). It never edits: every move, duplicate, removal
and drop is a request to the app, which edits the content file. See
`docs/visual-builder.md`.

The package's Node entry (`src/node.ts`) hands the server the built script,
building `dist/overlay.js` first when it is missing or older than the sources,
so development needs no separate step. The CLI bundle embeds the built script.

## Build and test

```sh
pnpm --filter @galley/overlay test        # vitest with happy-dom
pnpm --filter @galley/overlay typecheck
pnpm --filter @galley/overlay build       # dist/overlay.js
```
