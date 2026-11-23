# Roadmap

What is missing or unverified today, in rough order. No dates: a line moves to
the [changelog](CHANGELOG.md) when it ships, and anything here can be picked up
— open an issue first to agree the shape.

## To finish before a first release

- **The web UI's editing screens.** The shell, Sites, site home, settings,
  version history and the editor's container are built; the content form, the
  media library, chat, the proof, the preview pane and the new-site screen are
  being finished.
- **Publish the packages.** `galley-cms` on npm (so `npx galley-cms` works),
  `@galley/adapter-kit`, the public repository and the website. See
  [RELEASING.md](RELEASING.md).
- **Build and verify the container.** The `Dockerfile` and
  `docker-compose.yml` are written and have never been built.
- **Finish the MCP server** (`galley mcp`, `packages/mcp`): it already gives
  any MCP client the built-in assistant's tools over stdio or HTTP. Missing,
  per [`docs/mcp.md`](docs/mcp.md): **OAuth 2.1 with dynamic client
  registration** for remote connectors that won't send a Bearer token;
  `galley://` resources when several sites are open over HTTP; the 2026-07-28
  protocol revision; undoing one harness turn the way the built-in assistant
  can.

## Verification

- **The image providers.** OpenAI and Google image generation are tested
  against scripted responses only; neither has been run against the live
  service.
- **The assistant's plain request profile.** The normal profile has been run
  against the live Anthropic API; the fallback used when a beta feature is
  refused is tested against scripted responses only.
- **Windows and Linux.** Every part has been run on macOS only. The desktop
  app has Windows and Linux code paths that have never been built.

## Running it

- **Hosted previews behind a fixed port.** In hosted mode each preview listens
  on a free port chosen at start-up, over plain HTTP, so a reverse proxy or a
  container with one port mapped can't reach it, and an HTTPS page can't frame
  it. Previews need to be served through the main address.
- **Accounts in hosted mode.** One shared password today: no per-person
  sign-in, roles or audit trail, and every publish from a hosted Galley carries
  the same author.
- **Signed desktop builds.** Code signing and notarisation are wired into the
  release workflow and have never run (no certificates). No auto-update yet.
- **The OS keychain** for API keys in the desktop app.

## Frameworks

- **More adapters.** Astro is the only framework with an adapter that reads
  its own configuration. Eleventy, Hugo, Jekyll, Next.js, Nuxt Content,
  SvelteKit and Docusaurus are recognised by convention; full adapters for any
  of them are welcome ([`docs/adapters.md`](docs/adapters.md); a worked
  Eleventy example is in [`examples/adapter-eleventy`](examples/adapter-eleventy)).
- **An optional Astro integration for exact route mapping.** Today URL
  patterns are read statically from `src/pages`, so a route that decides at
  run time which collection it renders can't be matched. An integration could
  report Astro's own route table to Galley.
- **TOML editing.** TOML front matter and data files are read-only.
