# @galley/web

The React UI. Talks to the server only through `src/lib/api.ts` (typed from
`ApiRoutes` in `@galley/core/api`) and one Server-Sent Events stream.

```sh
pnpm --filter @galley/web dev        # against a real server (GALLEY_SERVER, default http://127.0.0.1:4400)
pnpm --filter @galley/web dev:mock   # against in-memory fixtures — no server needed
pnpm --filter @galley/web typecheck  # app (DOM) + mock/config/tests (Node)
pnpm --filter @galley/web test       # vitest: api URL building, the query cache, formatting
pnpm --filter @galley/web build      # → dist/
```

The dev proxy forwards `/api` to the server without buffering SSE, and
presents the browser's dev origin as the server's own (the server checks
`Origin` on state-changing requests).

## Layout

```
src/
  main.tsx            entry: styles + <App/>
  app/                shell: routes, frames, sidebar, top bar, status bar, ⌘K palette, activity tray, boot, error boundary
  lib/                data layer: api, events (SSE), query cache, sync (events → stores/cache), stores, format
  ui/                 design system — see src/ui/README.md
  components/         small domain widgets shared by screens (FileChangeRow, PreviewControls)
  screens/            screens built here: sites, site home, history, app settings, site settings, login, not found
  features/           seams for the next builders (see below); editor/ is complete
  styles/             index.css (fonts + brand + app.css); the only place for colours and font names
mock/                 the fixture backend (Vite plugin) for dev:mock
test/                 vitest
```

## Rules of the road

- **Server data**: call `api("METHOD /api/…", { params, query, body })`. It is
  fully typed; a wrong param, query key or body is a compile error. It throws
  `ApiFailure` (`.shape` is the server's `{ code, message, detail }`;
  `.offline` when the server can't be reached). For raw bytes use
  `rawFileUrl(siteId, path, rev?)` and `candidateUrl(id)`.
- **Caching**: `useQuery(key, fetcher, { enabled?, deps? })` from
  `@/lib/query`. Use the key builders in `keys` (`@/lib/sync`) so events
  invalidate the right data. After a mutation that returns the new value,
  `setQueryData(key, value)`; otherwise `invalidate(prefix)`.
- **Live updates**: `useServerEvent(type, handler)` from `@/lib/events` for
  component-lifetime subscriptions (chat deltas, tool activity). Don't open a
  second EventSource. `lib/sync.ts` already maps `changes.updated`,
  `site.updated`, `sites.updated`, `preview.status` and `job` to the stores
  and the cache.
- **Stores** (zustand, `@/lib/stores/*`): `useMeta` (brand, mode), `useSites`,
  `useSite` (current `SiteDetail`), `useChanges` + `usePendingCount()` +
  `discard(paths?)`, `usePreview` / `usePreviewStatus(siteId)` + `run(siteId,
  "start"|"stop"|"restart")`, `useJobs` / `useJob(id)`, `notify()` for toasts,
  `useUi` (theme, pane sizes, collapsed panes, preview mode — persisted).
- **⌘K**: in a text editor that formats (the body editor, Markdown fields)
  ⌘K adds a link — the editor handles the key and calls `preventDefault`, and
  the palette ignores a key someone already used. Anywhere else ⌘K opens the
  palette (the sidebar's Search opens it from inside an editor too).
- **Chrome**: every screen calls `useTopBar({ crumbs, tag? })` (the last crumb
  becomes the document title). Open global flows with `useChrome`:
  `setPublishOpen(true)`, `setDiscardOpen(true)`, `setPaletteOpen(true)`.
- **Brand**: never type the product name; read `useMeta().meta.brand`. No raw
  colours or font names outside `src/styles/` — use tokens and `g-` classes.
- **States**: every screen has loading (skeletons for layout), empty, error
  (`ErrorState` with the thrown value) and populated states.

## Seams for the next builders

Each file exists, is routed or mounted, renders a "coming together"
placeholder (`features/SeamPlaceholder.tsx`), and has its final props. Replace
the internals; keep the export name and props (extend props additively if you
must, and say so).

### Content + media builder

| File | Mounted at | Props / context |
| --- | --- | --- |
| `features/content/CollectionScreen.tsx` | `/sites/:siteId/c/:collectionId` | Route params. Collection from `useSite(s => s.detail?.model.collections)`. Entries via `GET …/entries` with `keys.entries(siteId, id)`. Set crumbs with `useTopBar`. Open an entry with `/sites/:siteId/edit?path=…`. |
| `features/content/EntryForm.tsx` | Editor form pane | `{ siteId: string; path: string }`. Read `useEditor()` → `entry` (with `fields`, `data`, `body`, `hash`), `refresh()`, `collection`, `setSelection()`. Save with `PATCH …/entry` (`ops`, `baseHash: entry.hash`) and `setQueryData(keys.entry(siteId, path), result.entry)`. The pane is a flex column; own your scrolling. |
| `features/media/MediaScreen.tsx` | `/sites/:siteId/media` | Route params. `GET …/media` with `keys.media(siteId)`; thumbnails with `rawFileUrl`. Generation: `GET /api/images/providers`, `POST …/images/generate` → `candidateUrl(id)` → `POST …/images/save`. |
| `features/media/MediaPicker.tsx` | (use from EntryForm) | `{ siteId; open; onClose; onPick(url: string) }` — `url` is the site URL (`MediaItem.url`). |

### Chat + proof + preview + new-site builder

| File | Mounted at | Props / context |
| --- | --- | --- |
| `features/preview/PreviewPane.tsx` | Editor preview pane body | `{ siteId; urlPath; onNavigate(urlPath); mode: "proposed" \| "live" \| "split" }`. The mode control lives in the pane head (EditorScreen). Status from `usePreviewStatus(siteId)` (`url`, `baselineUrl`). Overlay protocol: `OverlayToHost`/`HostToOverlay` in `types.ts`. Call `onNavigate` when the frame reports `navigate`; click-to-edit via `POST …/resolve`; selection into `useEditor().setSelection`. |
| `features/chat/ChatPanel.tsx` | Editor assistant pane body | `{ siteId; context?: ChatContext; initialMessage?: string }`. `context` is `useEditor().chatContext`, kept current. `initialMessage` is a request typed on Site home (send it or put it in the composer once). Stream with `useServerEvent("chat.delta" …)` etc. The pane is a flex column (body + `g-pane__foot` composer). |
| `features/proof/ProofScreen.tsx` | `/sites/:siteId/proof` | Route params. Changes from `useChanges` (kept fresh by events); per-file `GET …/diff`; discard with `useChanges().discard(paths)`. `components/FileChangeRow.tsx` renders a file row. |
| `features/proof/PublishDialog.tsx` | Mounted once by the top bar | `{ siteId; open; onClose }`. Opened by the top bar, the palette and anyone calling `useChrome.getState().setPublishOpen(true)`. Message from `POST …/publish/message`; result toasts per voice.md (“Published.”, “Saved, not live yet.”, “Sent for review.”). |
| `features/wizard/NewSiteScreen.tsx` | `/new` | `GET /api/starters`, `POST /api/sites/create` → `Job`; follow it with `useJobs.getState().upsert(job)` + `useJob(id)`; the activity tray already shows it. |

### Page builder (`features/builder/`)

Arrange mode: the preview's third page tool (Click to edit · Arrange ·
Browse). `useArrange` talks to the overlay and acts through the entry's own
op queue (`useEditor().formStore`, registered by the form) with the shared
list actions in `features/content/fields/items/listActions.ts` — the form's
section cards use the same ones. `PaletteList` is the one section picker
(the Arrange panel and the form's "Add section" dialog). Pure logic is in
`model.ts` and `drag.ts`; tests in `test/builder/`. Guide:
`docs/visual-builder.md`.

### Built here (don't replace, extend)

`features/editor/EditorScreen.tsx` + `EditorContext.tsx`: the three-pane
editor (`/sites/:siteId/edit?path=…`). `useEditor()` gives `siteId`, `path`,
`setPath`, `entry`, `entryStatus`/`entryError`/`entryLoading`, `refresh`,
`collection`, `urlPath`, `navigate(urlPath)` (moves the preview and switches
to the entry behind that page), `selection`/`setSelection`, `previewMode`,
`chatContext`. Without `?path=` the editor opens the entry behind `/`.
`?ask=` hands a typed request to the chat once.

## The mock (`mock/`)

`dev:mock` answers **every** route in `ApiRoutes` from memory. The handler
table is a mapped type over `ApiRoutes`, so a contract change breaks the
mock's compile until it is updated.

- **Sites**: the real `starters/astro-starter`, read from disk at start-up
  (fields and section types inferred from its own files) with four pending
  changes made through the same edit path (two field changes, a new post, a
  new image); a small Eleventy handbook; a forgotten site whose folder is
  missing. Clone and create run as `job`s with progress and add sites.
- **Edits** splice plain scalars in place like the engine does; other edits
  re-serialise. Changes, field changes, diffs, discard, publish, undo-publish
  and pull all act on the in-memory base/working copies and emit the matching
  events.
- **Preview**: start runs two loopback servers rendering the site's pages from
  the working copy (proposed) and the published copy (live), so the split
  view shows real differences. Pages report navigation like the overlay does.
- **Assistant**: scripted. Quoted text (“…”) sets the page's first heading;
  “find …” searches; anything else asks one question with options, and
  answering makes that edit. Streams `chat.message`, `chat.tool`,
  `chat.delta`, `chat.done`; Undo restores the turn's files.
- **Folder picker**: a pretend disk under `/Users/you`.
- `GALLEY_MOCK_MODE=hosted` shows the sign-in screen (password `proof`);
  `GALLEY_MOCK_LATENCY=ms` changes the response delay (default 120).
