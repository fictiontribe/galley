# Roadmap

Where Galley is going, as far as anyone can say today. This is intent, not a
promise: there are no dates, and the order can change. The statuses on
[the website](https://galley.fictiontribe.com/) are the source of truth for
what is built; when something here ships, it moves to the
[changelog](CHANGELOG.md).

## Shipped so far

- **0.1.0** (2026-11-23): the first release, on npm as `galley-cms` and
  `create-galley`.
- **0.1.1**: your own domain for a site that is online; documentation that
  starts from `npm create galley@latest` and `npx galley-cms`.
- **0.1.2**: fixes. Redirects are no longer read as page links; the brand
  set-up and the move from WordPress get smaller fixes.
- **0.1.3**: a batch of interface fixes found while making the tour: forms,
  Proof, the Search and AI checks, the brand, click-to-edit and more.
- **0.2.0**: a hosted editor that looks after one site (`galley serve` and
  the image), with first run from a setup link, backups and an Install page;
  “Host the editor online” for your own Fly.io, Cloudflare or server, still
  in progress.
- **0.3.0**: accounts on a hosted editor (owners, editors and contributors,
  each publishing under their own name); Google Cloud as a place to host the
  editor; the desktop app signed and notarised for Mac, and starting on
  Windows and Linux; a one-click switch between light and dark.
- **0.3.1**: fixes. First run on a hosted editor keeps a site's folder; the
  Save bar, notifications and "Use this form" behave; pages are named the
  same way everywhere.
- **0.4.0**: themes for the editing app (Quiet, Plate and Desk, or one you
  make); pictures and files kept in a bucket or in Cloudflare Images instead
  of the repository, run for real on Cloudflare R2 and against stand-ins
  for the rest; a hosted editor that keeps up with its repository; a quieter
  look, with one family of icons.
- **0.4.1**: fixes. A link to the editor can't send a browser to another
  site; an undo pauses while newer versions wait, as a publish does; moving
  media to a bucket says beforehand what the move then does.
- **0.4.2**: moving media to a bucket moves it. Pages and Galley's page
  templates are given the new addresses; a copy stays in the repository
  only for what the site is built from and a move doesn't change, and the
  plan names those files before anything happens. The site's model is
  read-only for the plugins and adapters it is handed to. A first,
  experimental part of embedding: a program that starts the server can add
  routes and events of its own. And a security release for hosted editors:
  a secrets file (any name that starts with `.env`) and the version
  history's own files are refused wherever a file, its changes or the
  preview is shown, and by the assistant's tools.
- **0.4.3**: a security release for hosted editors. Below build mode, the
  editor changes only content that can't run as code, in the form, on the
  page and through the assistant. The server can listen on a Unix socket
  for the proxy in front, and believes forwarded headers only there. The
  preview checks that what answers on its port is the site's own dev
  server, when it starts and while it is used. Search and the assistant
  read built pages only from inside the build output; backups keep links
  in their folder; stopping a preview signals only what the editor
  started. A third, experimental part of embedding: places in the app for
  an edition's own additions.
- **0.4.4**: Sarking, a blog starter for long-form writing with charts,
  tables and evidence in plain Markdown, and the first starter downloaded
  the first time it is used rather than carried in the package. A
  session's end is signed into its cookie; a site with an assistant's Undo
  still offered stays open, and a closed site refuses whoever kept it;
  what an extension or a plugin is handed is narrowed to what it is meant
  to use; accounts can be held without a password, ready for signing in
  through a provider.
- **0.4.5**: signing in to a hosted editor through your own identity
  provider (OpenID Connect), with passwords beside it or turned off;
  the provider can end a person's sessions at once (back-channel logout);
  `galley accounts` links existing accounts to their identities on the
  server, and the server's access token can sign someone out or switch
  them off. Linking accounts from People, and showing owners identities
  and removed accounts there, come later.
- **On the website**: [a tour of the app](https://galley.fictiontribe.com/tour/)
  and [fourteen how-to guides](https://galley.fictiontribe.com/how-to/), with
  pictures.

## Now

In final checks.

- **The guided move from WordPress.** Built and run against an export file
  and a stand-in WordPress site; not yet against a real one.
- **The editor hosted on your own server**, as an install that serves one
  site. Released in 0.2.0 and run for real, on its image and on a server
  behind HTTPS; its image isn't on a registry yet
  ([`docs/cloud-install.md`](docs/cloud-install.md)). Its accounts and roles
  (owner, editor, contributor) are built, tested and tried in a real
  browser, not yet with real e-mail.

## Next

Built and waiting to be proven, or being built.

- **Deploys to Vercel, run on the real service.** Built and tested against
  stand-ins.
- **Setting redirects on Cloudflare itself (Bulk Redirects), run on the real
  service.** The redirects file that travels with the site already works.
- **Attaching a fresh own domain, run on the real services.** Taking over an
  address that already points at the site has been run on Cloudflare.
- **The Shopify storefront starter.** A shop built from sections; it works
  with a demo catalogue today.
- **Hosting the editor online from the app**, on your own Fly.io, Cloudflare
  or server. Built and run against stand-ins for Fly.io and Cloudflare; not
  yet on the real services.
- **The desktop app on Windows and Linux, tried by people and signed.** The
  macOS app is signed and notarised. Windows and Linux installers are built
  and their server is exercised on every release, and on Windows the
  installed app is opened in the build; they are unsigned, and no person has
  used the app there yet.
- **The kits on npm as packages**: the site kit (`@galley/astro`), the adapter
  kit and the plugin kit. Sites carry the site kit vendored today.
- **The starters listed in Astro's catalogue** of themes.
- **Full adapters beyond Astro.** Docusaurus, Nuxt, Next.js, SvelteKit,
  Eleventy, Hugo and Jekyll are recognised by their conventions; that is the
  floor. A full adapter reads the framework's own configuration. This is a
  good place to contribute: [`docs/adapters.md`](docs/adapters.md) shows how,
  and [`examples/adapter-eleventy`](examples/adapter-eleventy) is a worked
  example.

## Later

- **Galley Cloud**: the editor, hosted for you. No date or price yet.

## Have a say

Open an [issue](https://github.com/fictiontribe/galley/issues) for a bug or a
specific request, or start a
[discussion](https://github.com/fictiontribe/galley/discussions) for an idea
or a question about direction. Before you write a lot of code, open an issue
to agree the shape ([CONTRIBUTING.md](CONTRIBUTING.md#bigger-changes)).
