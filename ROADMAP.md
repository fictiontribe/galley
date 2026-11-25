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
  of the repository, not yet run against the live services; a hosted editor
  that keeps up with its repository; a quieter look, with one family of
  icons.
- **On the website**: [a tour of the app](https://galley.fictiontribe.com/tour/)
  and [twelve how-to guides](https://galley.fictiontribe.com/how-to/), with
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

- **Single sign-on for hosted installs.** Today each person signs in to a
  hosted Galley with their own e-mail and password.
- **Galley Cloud**: the editor, hosted for you. No date or price yet.

## Have a say

Open an [issue](https://github.com/fictiontribe/galley/issues) for a bug or a
specific request, or start a
[discussion](https://github.com/fictiontribe/galley/discussions) for an idea
or a question about direction. Before you write a lot of code, open an issue
to agree the shape ([CONTRIBUTING.md](CONTRIBUTING.md#bigger-changes)).
