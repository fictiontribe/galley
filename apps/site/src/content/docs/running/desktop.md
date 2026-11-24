---
title: Desktop app
description: The native shell around the same server and web UI — how it starts and stops, what it adds over a browser tab, how to build it, and what hasn't been done or verified yet.
group: running
order: 1
---

This page is for developers building or evaluating the desktop app. It is a thin native shell — Tauri 2, Rust, the system webview (WebKit on macOS), no bundled Chromium — around the same server and web UI the CLI runs. It starts the server privately on `127.0.0.1`, shows the UI in a native window, and stops everything when you quit. The source and its full account are in [`apps/desktop/`]({repository}/tree/main/apps/desktop) and its [README]({repository}/blob/main/apps/desktop/README.md).

> **Status.** Built and tested on macOS, where the app is **signed and notarised by Apple**: it opens like any other downloaded app. The Windows and Linux installers are built on every release and their packaged server is started and walked through a site (open, edit, proof, publish, preview) on each system, but they are **unsigned**. On Windows each build is also installed from its installer and opened, and a picture of the window is kept with the build; no person has used the app there yet. On Linux the window hasn't been opened at all. There are no published downloads yet: the installers are attached to a release from the next version on. There is no auto-update. The OS keychain is **not** used for keys yet — they are kept in the Galley home like the CLI's.

## Opening it the first time

- **macOS** (11 or later; one download for Apple silicon, one for Intel): open the `.dmg` and drag the app to Applications. macOS asks once whether to open an app downloaded from the internet.
- **Windows** (10 or later): the installer isn't signed, so Windows shows *Windows protected your PC*. Choose **More info**, then **Run anyway**.
- **Linux** (built on Ubuntu 22.04; needs WebKitGTK 4.1): install the `.deb`, or make the `.AppImage` executable (`chmod +x`) and run it. Neither is signed.

Each release lists the SHA-256 sum of every installer in `SHA256SUMS.txt`.

## What it adds over a browser tab

- **A folder picker** for opening a site (the browser can only browse the server's folder list).
- **Reveal in Finder** for a site's folder, and links that open in your default browser.
- **A native menu**, one instance at a time, and the window's size and position remembered.
- **A start-up check**: an app opened from the Finder gets a minimal `PATH`, so the shell reads your login shell's `PATH` and adds the usual install folders (Homebrew, nvm, Volta, fnm, asdf, mise, pnpm…). If `git` or `node` still can't be found, the start-up window says which, what it is for and where to get it, with **Check again** and **Continue without them**.
- **No terminal**, and nothing left running when the window closes.

It shares the Galley home with the CLI (`~/.galley`, or `GALLEY_HOME` from the environment it was started in), so both see the same sites and settings.

## How it runs the server

1. It picks a free loopback port (the last one used, when still free, so the UI keeps its origin and browser storage between launches) and a fresh 256-bit token.
2. It starts the server as `galley desktop --exit-with-parent --port <port>` with `GALLEY_DESKTOP=1`, `GALLEY_HOST=127.0.0.1`, `GALLEY_PORT` and `GALLEY_TOKEN` set, in its own process group.
3. When `GET /api/meta` answers with `desktop: true`, the main window opens on `http://127.0.0.1:<port>/?token=…`, and the server swaps the token for a cookie. If the server exits early or doesn't answer within 30 seconds, the window shows *Couldn't start* with the last 40 lines of output under Technical details.

`galley desktop` is a command of the CLI made for this ([Command line](/docs/reference/cli/#galley-desktop)): loopback only, exactly the port given, and with `--exit-with-parent` it stops when its standard input closes — so if the shell crashes or is killed, the server and its dev servers go too.

**Quitting** — ⌘Q, closing the last window, logging out, a signal — sends SIGTERM to the server's process group, gives it 5 seconds to stop its previews, then SIGKILL, and kills any dev server that outlived it.

The packaged app ships its own Node.js runtime as the sidecar, with the single-file CLI bundle beside it. (A Bun-compiled binary was tried first and failed every request; the README records why.) The cost is size: Node is about 120 MB uncompressed.

## Security

The UI is served from `http://127.0.0.1:<port>`, which Tauri treats as a remote origin with no IPC unless a capability names it. The main window's page may call exactly three commands — pick a folder, open an external link, reveal a site's folder — granted at run time for that port only, and each argument is checked in Rust (http/https links only; a folder only if it is the root of a site the server lists). Preview iframes on other ports can't call them. Navigation is locked to the app's origin; links that leave it open in your browser.

## Build it

Prerequisites: Rust stable 1.90 or later and the platform's build tools (Xcode command-line tools on macOS), Node.js 20.11+ and pnpm 10. The Tauri CLI comes from the repository's dev dependencies.

```sh
pnpm install
pnpm --filter @galley/web build
```

Then a debug build, which runs the CLI from source:

```sh
pnpm --filter @galley/desktop dev
```

Or the installers for this operating system, in `src-tauri/target/release/bundle/`:

```sh
pnpm --filter @galley/desktop bundle
```

A debug build runs the monorepo's CLI with your own Node, so changes to the server or engine need only a restart. If `packages/cli/dist/galley.mjs` exists, the CLI prefers it — a leftover bundle is what a debug build would run.

## Tests

- Unit tests — `PATH`, ports, tokens, the process tree, argument checks: `pnpm --filter @galley/desktop test:rust`
- The end-to-end flow against the server runtime: `pnpm --filter @galley/desktop test:sidecar`
- Launching the real app and quitting it twice (macOS, needs a desktop session): `pnpm --filter @galley/desktop test:shutdown`

None of these is part of `pnpm test`.

## Not done yet

- Auto-update.
- Signing on Windows and Linux. (macOS is signed and notarised.)
- Windows and Linux in a person's hands: both are built and their server exercised on every release, and on Windows the installed app is opened and photographed, but the menu and the folder picker have only been used by a person on macOS.
- The OS keychain for secrets.

## Next

- [Command line](/docs/reference/cli/).
- [Security model](/docs/running/security/).
