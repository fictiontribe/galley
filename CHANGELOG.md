# Changelog

All notable changes to Galley, newest first. Versions follow
[Semantic Versioning](https://semver.org); while Galley is 0.x, a minor version
may change the configuration file, the HTTP API or the adapter API, and the
entry says how.

## Unreleased

### Added

- **Themes for the editing app.** Quiet stays the default; **Plate** and
  **Desk** ship beside it, and anyone can make their own. A theme is a small
  file (five colours per mode and four switches; `brand/themes/README.md`)
  and changes the app only, never a site. The light/dark control is now
  called the *appearance*, and the theme picker sits beside it wherever it
  appears (the sidebar's foot, the sign-in and first-run screens), each
  theme drawn as a swatch. **Settings › Themes** makes a theme from any
  other: five colours with a colour picker and a text field, dark colours
  made from them or set by hand, the four switches drawn small, the whole app
  re-themed live in that browser until it is saved, undo, and a readability
  report in plain words. Every theme passes one check (`checkTheme`) before it
  is shown, saved or shared: colours kept in range, every pair people read
  measured as the CSS draws it (proved in a browser), small lightness repairs
  said in words, and a warning when the pencil sits near a colour that means
  something or is light. A theme the check adjusted is saved adjusted.
  Themes are saved for everyone here (in the data folder, by people who can
  manage) or, on a hosted editor, for me in this browser; each person chooses
  their own there, and the install has a default (App settings, else a
  white-label brand's `theme`, else Quiet), shown before the first paint on
  the sign-in screen too. Export, import, and **Share with the community**,
  which opens GitHub's new-file page for the repository's `themes/` folder
  with the theme filled in; the app sends nothing itself. Community themes
  are bundled when the app is built. `docs/themes.md`.
- **Routes for themes**: `GET /api/themes` (edit), `PUT` and
  `DELETE /api/themes/:themeId` (manage), and `appearance.look` in
  `PATCH /api/settings` for the default. `GET /api/meta` gains `look` (the
  default theme's colours and switches, for the sign-in screen); a new
  event, `themes.updated`. `/theme.js` is served with the default in front
  of it.
- **A `themes` contribution for plugins**, checked like any other theme; only
  plugins installed for the app add themes, never a site's own.
- **`galley theme`** `list`, `check <file>` (exit 1 when it would be
  refused), `add <file>`, `use <id>`, `export <id>`, `remove <id>`.
- **The brand file's `theme`**: the theme a white-labelled install starts
  with. Its `accent` is now the built-in themes' pencil, so the brand and a
  theme never set the same colours twice. Like any pencil it may be adjusted
  for legibility; an accent too close to grey can't be a pencil, and then the
  built-ins keep their own and the server says so when it starts.
- **`themes/`**, the community folder, with its README; a test checks every
  theme in it and in `brand/themes/`.

- **A hosted editor keeps up with its repository.** Every 5 minutes
  (`GALLEY_SYNC_MINUTES`; `0` turns it off) it asks the code host what is
  new and, when nothing here is in the way, brings newer versions in
  forward only, as **Get latest** does. It skips a round while a publish, an
  undo, a restore, a connect or other git work is under way, and logs one
  line when versions come in or a look fails in a new way. `galley serve`
  prints how often it looks. The desktop app and local mode never look by
  themselves.
- **`POST /api/sites/:siteId/git/check`**, for anyone signed in: asks the
  code host what is new without changing a file and answers the status as
  of now. `GitStatus` gains `checkedAt` (when the code host last answered),
  `checkProblem` (why the newest look couldn't reach it) and `inTheWay`
  (what stops newer versions coming in: unpublished changes to files they
  change, or the two having gone separate ways). A new event,
  `repository.checked`, tells open browsers a look found something new or
  versions came in. `SiteService` gains `checkGit()` and `catchUp()`.
- **An adapter hook, `forgetPreviewSaves`**: the files the framework's dev
  server keeps between runs and trusts on its next start. The Astro adapter
  names its content store (`.astro/data-store.json` and
  `node_modules/.astro/data-store.json`); the model carries them as
  `previewSaves`.

### Changed

- **One server to a data folder.** A hosted server takes its data folder
  before it reads or changes anything in it, keeps its hold (`server.lock`)
  fresh while it runs, and refuses to start while another server is running
  on the folder, or when it can't write its hold. Until now a second server
  started without a word. After a server that didn't stop cleanly, the next
  start takes the folder over: at once when that server's process is gone
  on the same machine, otherwise after watching its hold for about 20
  seconds. Local mode and the desktop app take no hold.
- **Names say who someone is.** A person's name is kept without characters
  a reader can't see (the controls that reorder text, characters with no
  width, blank fillers), and a name that reads as someone else's on the same
  editor — in another case or width, or with unseen characters in it — is
  refused wherever a name is set. Names that were alike before stay until
  one of them changes. Look-alike letters from different alphabets are not
  caught.
- **The event stream keeps to its readers.** On a hosted editor one account
  may hold 16 streams open (16 windows of the editor; the operator's token
  counts as one identity) and the next is answered 429. A stream whose
  reader has stopped reading is ended once 1 MB is waiting for it; the app
  connects again and reads everything afresh, as after any drop.
- **Version history tells the truth about the repository.** It looks when
  it opens, says "Checking the repository…" until it knows, and then says
  when it last checked; it no longer says "In step" on the strength of what
  was last fetched, however long ago. It says plainly when it couldn't look,
  when newer versions are waiting and who can bring them in, and when the
  two have gone separate ways. A hosted editor's status bar says "Newer
  versions are waiting" while they can't come in by themselves.
- **Getting the latest restarts the preview properly.** A running preview
  is stopped before newer versions change the files, the dev server's saved
  content store is removed, and the preview starts again — a dev server that
  saw a page and its schema change together under it went on showing the
  old entry, through any number of restarts. **Restart preview** removes
  that store too when the copy has moved to another version since the
  preview started. Newer versions that change `package.json` or a lockfile
  make the next start install the site's packages first.
- **Get latest** no longer starts when it can already tell git would refuse:
  it says which files with unpublished changes the newer versions change.
- **A quieter, more finished look, in the app and on the site.** Sheets rest
  on the desk, controls are pressed into the paper, and only menus and
  dialogs float. Pills are for buttons; chips, tags and counts are small
  rectangles and stamps. Blue Pencil marks the action, the current place and
  the fields where the assistant writes. Labels are words in sentence case
  instead of small capitals. The page preview sits on the same tan table as
  the captures on the site. Nothing moved: layout, wording and behaviour are
  as they were.
- **One drawn icon family**, shared by the app and the site
  (`brand/icons.ts`). Site details, Navigation, Scripts, Forms, Brand,
  Search & AI and Install each have a glyph of their own; three of them used
  to share a pair of braces.
- **The look is described as a theme**: five colours for light and for dark
  and four switches (`brand/themes/`), with everything else derived from
  them. Quiet is the look above; two more, Plate and Desk, are in the same
  folder.
- **A lighter, less yellow paper in the app.** The canvas, cards, wells and
  borders are a cooler bond paper, and every card on the canvas has the same
  edge and the lightest shadow, so panels lift off the page. The dark theme
  and the marketing site are as they were.
- **One page frame.** Every list and settings screen sits in the same column
  with its title at the same left edge and height; the page's main action
  sits level with the title. Side panels switch between beside and below by
  the room the column really has, so opening the sidebar or the assistant no
  longer squeezes them.
- **Scripts:** asking is one field with its examples under it, and "Add a
  script" appears once while there are none.
- **Redirects:** "Where is this site hosted?" lists the hosts one to a row
  instead of four small cards, and its question can no longer break a word
  at a time; the toolbar keeps to one line and the WordPress import's panel
  fits its column.
- **Empty lists** sit in a card where the list goes, with one way to start.
  Pages and other collections no longer offer "New" twice.
- **Site settings** put each section's title and note beside its fields when
  there is room. **Online** has a heading for each of its three sections.

### Fixed

- **A section added on the page no longer takes the page down.** A new
  section's words still start blank, but a required field a blank can't
  draw — a picture, a video or download named by its file, a choice, a
  reference, a date — starts with what the site declares for it (a default,
  or `examples` in galley.config.json or zod's `.meta({ examples })`), else
  with the value the nearest section of the same type already has (this
  page, then this collection, then anywhere). The person is told once, with
  Undo, what was borrowed and from where ("The new Film section starts with
  the video from the “Home” page. Change it in the form."). Lists start with
  as many items as the schema asks for (`.min()`), and an optional group
  that would hold only blanks is left out. The form's **Add section** and
  Arrange share the one rule.
- **A page that fails to draw is said to have failed.** Arrange no longer
  says a site "hasn't marked its sections" when the dev server answered the
  page with an error: the panel, and the preview in every mode and in
  Proof, say "This page couldn't be drawn", with the framework's first line
  under **Technical details** and the site's own error one click away. When
  it began with a change made here, the note names it ("after adding a
  Steps section") and offers **Undo** for exactly that change; the page is
  reloaded once the file is back and Arrange carries on. A preview that
  isn't answering, and a page the preview doesn't have, are said as such.
  The overlay reports `page-state` and a `cause` with `arrange-status`; the
  preview proxy hands it the page's status on its script tag.
- **The assistant hears when its change stopped a page drawing.**
  `update_entry` loads the changed page from a running preview and, when it
  answers with an error, returns a warning with the dev server's own line,
  so the assistant fixes or undoes its change instead of reporting success.
- **The Caddow starters' form sections draw before a form is chosen**
  (editorial and storefront): a note while developing, as the other
  starters already did.
- **Undoing an assistant reply no longer undoes other people's work.** An
  undo put back every file written while the reply was being made, whoever
  wrote it, and put each one back whole. It now puts back only what that
  reply itself changed, and only the pages still as the reply left them. A
  page changed again since — by you, by someone else or by another reply —
  is left as it is, and the reply says which pages those are. The same holds
  for **Undo** after Search and AI fixes. `POST …/threads/:threadId/undo`
  and `POST …/visibility/undo` answer `{ restored, left }`, and a chat
  message gains `undoLeft`.

## 0.3.1 — 2026-11-24

### Fixed

- **First run on a hosted editor keeps the folder a site was given.** When a
  site lives in a folder inside its repository (`apps/site`), finishing first
  run in the browser dropped the folder and connected the whole repository.
  The folder is kept, and the "Connect the site" step shows it and has a
  field for it.
- **Site settings:** the Save bar sits below the settings instead of over
  them, so it no longer cuts through a heading such as "Publishing" at the
  foot of the screen, at any window size.
- **Notifications** take a space of their own at the foot of the screen,
  above the status bar, instead of covering what is there: the "Fixed"
  message no longer sits over the AI crawlers panel, its switches or its
  confirm bar, nor over the status bar's links.
- **Forms › Use this form** no longer suggests a page that already shows the
  form (the contact form for the home page while Contact has it): it says
  where the form is, offers the pages that don't have it yet, and offers
  nothing to add when every page already has it.
- **Brand:** "Open the proof" and the exports no longer reload the whole
  app; the proof opens in place and an export downloads.
- **The demo** suggests "Update Home page" as the publish note, as the app
  does, and counts a moved section as one change instead of an edit to
  every field it passed.
- **A markdown field's** Write/Preview switch no longer lands on "Saved" or
  "Put back": on a narrow form it moves to its own line.
- **Pages and data files are named the same way everywhere:** the forms
  list, Use this form, Search & AI, redirects, page suggestions in link
  fields and search say "Home page" and "Stockists", not the home page's
  whole title or a file path.
- **Brand sources** give an SVG's size in plain words ("Drawn at 120 × 40")
  instead of its viewBox.

## 0.3.0 — 2026-11-24

A hosted install has accounts instead of one shared password. If you run a
hosted install today, read **Changed** before upgrading. The desktop app and
local mode have no accounts and are unchanged.

### Added

- **Accounts and roles on a hosted install.** Each person signs in with their
  own e-mail and password, as an **Owner** (everything), an **Editor**
  (changes the site and publishes it, reads the inbox) or a **Contributor**
  (changes the site and sees Proof; an editor or owner publishes). One table
  decides which role may call which route
  (`packages/core/src/install/route-access.ts`), and the app hides what a role
  can't use. First run now creates the owner's account; `GALLEY_OWNER_NAME`
  and `GALLEY_OWNER_EMAIL` give it a name and e-mail on an unattended start.
- **Build mode and the site's settings, by role, at every way in.** The
  engine checks both where the write happens, whichever way a request comes
  — a screen, a file write, the assistant, an AI tool. Build mode (the
  site's code and templates, custom code in a form, saving the brand
  outside the content files) needs an editor or owner; a contributor works
  in content mode, and a request for build mode is refused in plain words.
  The site's settings file — and discarding or undoing a change to it, and
  undoing a publish that changed it — is an owner's. The few values the
  editor records for itself inside an allowed action (the live address
  after putting the site online, where the redirects list lives) are
  written without opening the rest of the file. The assistant
  offers each person only the tools their role includes.
- **People**, on the Install page, for owners: invite someone (a link shown
  once, good for 7 days), change a role, change someone's e-mail, make a
  new-password link (good for 60 minutes; e-mailed to the person and not
  shown to the owner when the server can e-mail it, shown to copy when it
  can't), sign one person or everyone out, switch an account off or on,
  remove it. The last owner who can sign in always stays.
- **Your account**: your name, your password, and **Sign out everywhere**
  for yourself. An owner changes their own e-mail here, with their
  password; editors and contributors ask an owner. An account with no
  e-mail yet adds one.
- **E-mail for invitations and new-password links**, and **Forgot your
  password?** on the sign-in page, when `GALLEY_SMTP_URL`,
  `GALLEY_MAIL_FROM` and the editor's public address, `GALLEY_PUBLIC_URL`,
  are set: a link is only ever built from that address. Without the public
  address, a link is shown only on a trial on one computer (a loopback
  address), and making one anywhere else is refused until it is set.
  Without e-mail, owners send each link themselves. The `E-mail:` line
  `galley serve` prints says which case it is. Not yet tried against a real
  mail server.
- **Each publish carries its author**: a signed-in person's publishes and
  undos are recorded with their own name and e-mail.
- **Sign-in limits.** A client is an IPv4 address or a whole IPv6 `/64`,
  held, before its password is checked, to 2 checks at once, 20 attempts a
  minute (successful ones too) and 5 failures a minute; 10 failed sign-ins
  for one e-mail from one client in 15 minutes. One e-mail's sign-ins are
  checked one at a time from everywhere, 3 more waiting, and after 10
  failures each waits a delay that grows from 1 to 30 seconds: at most
  about 2,900 guesses a day at one account. A browser that has signed in
  before keeps a cookie of its own (never a session) and isn't held up; an
  unknown browser may have to wait while an account is being guessed at,
  and a one-time link always works. Password checks run 2 at a time, shared
  out client by client with known browsers first, and "wait" comes only
  past 256 waiting. Changing your password, and the password typed to
  change an e-mail, go through the same limits. Plus limits on "forgot my
  password".
- **Guarded work needs someone.** On a hosted install, publishing, the
  site's settings file and writing outside the content happen only for a
  signed-in person, the operator's token or the engine's own steps; work
  done for nobody — a plugin reacting to events, or anything it leaves
  running — is refused.
- **Sign-outs are kept within a cap** (10,000 signed-out browsers). Past it,
  a sign-out signs that person out everywhere; a longer list is trimmed at
  start-up by signing everyone out once, with a line in the log.
- The HTTP API gains `/api/account`, `/api/people/*`, `/api/auth/link`,
  `/api/auth/link/check` and `/api/auth/forgot` (`PATCH /api/people/:accountId`
  takes a `role`, `disabled` or `email`; a `OneTimeLink`'s `url` is `null`
  when the link was e-mailed to someone else); `POST /api/auth/login` takes
  an `email`; `POST /api/setup/password` takes the owner's `name` and
  `email`; `GET /api/meta` gains `account`, `install.signInWith` and
  `install.passwordEmail`.
- **Host the editor online on Google Cloud.** A fourth place for the
  editor: a virtual machine of its own in your Google Cloud project, with a
  20 GB disk, a network of its own, one firewall rule for the web ports (no
  SSH) and a fixed address, running the same compose recipe as "Any server
  with Docker" (the editor and Caddy for HTTPS). It needs a key file from
  Google Cloud (a service account's JSON key) with Compute Instance Admin
  (v1), Compute Network Admin and Compute Security Admin; the app checks the
  roles and the Compute Engine API before anything is made. About $17.88 a
  month with 2 GB, $30.11 with 4 GB (on-demand in Iowa, worked out from
  Google's hourly prices, read 2026-11-24). Also `galley host --host gcp`
  and `GOOGLE_APPLICATION_CREDENTIALS_JSON`. Run only against a stand-in for
  Google's APIs so far.
- **A light and dark switch on every screen.** One click at the foot of the
  sidebar (or in the corner of sign-in and first run) goes light ↔ dark;
  holding it, right-clicking it or pressing ↓ offers Match my system, and
  ⌘K has all three. Locally the theme is still saved for every window; on a
  hosted install each person's theme is their own, kept in their browser,
  and App settings sets the one a new person starts with. Dark link
  underlines and selected outlines are easier to see.

### Changed

- **Upgrading an install** (its data layout goes from 1 to 2): the shared
  password becomes one owner with the same password and no name or e-mail
  yet, who signs in with the password alone and is asked once for the rest.
  **Everyone is signed out once**; old cookies and the preview's old viewer
  cookies are refused. The old state file is kept as
  `install.json.schema-1.bak`.
- **`galley serve --reset-password`** now prints a one-time new-password link
  for the owner (`--email <owner>` when there are several) and no longer
  signs everyone out or forgets the password; the owner's old password works
  until the link is used. With no owner yet it still prints a setup link.
- **`POST /api/install/password`** changes the signed-in person's own
  password; with the operator's token (`GALLEY_TOKEN`) it is refused (403).
  `POST /api/auth/logout-all` signs out only the person calling it (with the
  token: everyone).
- A publish made over MCP or with the operator's token carries the install's
  publishing name, not a person's.
- The Install page is for owners. Editors and contributors don't see it;
  their password and **Sign out everywhere** are on **Your account**.
- A restore signs everyone out, and the backup's own people and passwords
  apply from then on.
- For anyone who can't read the inbox, the live event stream carries that a
  form was submitted, never what was sent.
- The last characters of a stored key are shown only to owners; everyone
  else still sees whether a key is set.
- **The macOS desktop app is signed and notarised by Apple.** It opens like
  any other downloaded app, on Apple silicon and Intel.
- **Desktop installers for Windows and Linux are built on every release**,
  unsigned, alongside the two for macOS, and gathered with their SHA-256
  sums into a draft release. On each system the packaged server is started
  and walked through a site before the installer is kept, and on Windows
  the app is installed and opened. No person has used it on Windows or Linux
  yet.


### Fixed

- A sign-in cookie whose signature was the right length but held a character
  outside plain English letters and digits made that one request fail with an
  error instead of "not signed in". It is now refused like any other.
- When a hosted editor can't save its own state (a full disk, too many open
  files), it says so in plain words instead of "unexpected problem", and
  nothing is changed.
- **On Windows, a site's preview could not start**: the command lookup found
  the plain `npm` file that ships beside `npm.cmd`, which Windows can't run.
  Names are now tried with Windows' own endings first.
- **The Mac app, started from a terminal through a path with a symbolic link
  in it** (a copy under `/tmp`, say), said "This copy is incomplete. Reinstall
  it." with nothing missing. It now finds its server from its own folder,
  and when something really is missing the details say what was looked for.
- **On Windows, the desktop app could not start**: it handed its server's
  path to Node.js in the long `\\?\C:\…` form Windows returns, which Node
  can't open, so the window said "Couldn't start" on every launch. It now
  uses the ordinary spelling.
- **On Windows, the desktop app's start-up check said git was missing** for
  every Git for Windows install (it reports itself as `2.47.1.windows.1`).
- **Building on Windows** stopped at the first file read exactly, because
  git there checked text files out with CRLF line endings. Every text file
  is now checked out with LF on every system (`.gitattributes`).
- **Next.js 16 no longer writes an AGENTS.md into the site** when Galley
  is started from Cursor's agent, GitHub Copilot's CLI, Augment or
  Antigravity: the preview's dev server no longer gets the variables those
  tools set, which `next dev` takes as an AI agent running it.
- **The preview no longer lets browsers keep its redirects.** A permanent
  redirect (301, 308) from the site's dev server, and anything it sends
  without a caching policy, now goes out as `no-store`. A browser that once
  saw a redirect through the preview (from another server answering on the
  site's port, or the site before a change to its trailing slashes) kept it
  for good, and the preview then looped ("redirected you too many times").
- **Media detection** no longer picks a `public/images` that doesn't exist
  when the site keeps its images in a folder of another name
  (`public/imagery`): new images are saved there. A site with no images
  folder still gets `public/images`.
- **A list of short values** (a list of strings, links or numbers) no longer
  gives every row the same `id`: the controls inside a group of fields take
  no id from the group, whose legend names it.

## 0.2.0 — 2026-11-24

A hosted install now looks after one site. If you run `galley serve` for
several sites today, read **Changed** before upgrading.

### Added

- **A hosted install looks after one site.** `galley serve` (and the image)
  now runs Galley for exactly one site, with its own state in one data
  folder: ten sites are ten installs that share nothing. The desktop app and
  the local command line stay multi-site. The multi-site routes answer 403 on
  a hosted install, and it has an **Install** page instead of a Sites screen.
  An older hosted data folder with one site is adopted in place; with several,
  `GALLEY_SITE_DIR` names the one to keep. The whole account:
  [`docs/cloud-install.md`](docs/cloud-install.md).
- **First run from a one-time setup link**: choose the password, connect the
  site — an existing repository, a folder inside one, or a starter sent to an
  empty repository — with the install's own deploy key or an access token,
  then the publishing name, the live address and the assistant's key. Or
  restore from a backup. Everything it asks can be given up front as starting
  values (the environment or one JSON file), used once, so restarts change
  nothing.
- **The preview through one address.** The preview and the live comparison
  are served by hostname on the server's one port (`cms-preview.example.com`,
  `cms-live.example.com`), on origins of their own, only to a browser the
  editor let in.
- **Backups**: one file sealed with a passphrase, from the Install page or
  `galley backup create|restore`, with the site's unpublished changes and
  history. Backups kept in the data folder's `backups/` are never part of a
  backup and a restore leaves them alone.
- **Operations**: `/healthz` and `/readyz`, logs with no secrets and one line
  per request, a graceful stop, a memory ceiling for the site's own commands.
- **The image and its files.** The image runs the server as `node` with no
  capabilities. `galley host recipe` writes one install's compose file,
  Caddyfile and `.env` (Caddy, a Caddy shared by several installs, or a
  Cloudflare Tunnel in front), hardened, with no port published for the
  editor; the repository's own `docker-compose.yml`, `Caddyfile` and
  `.env.example` are that output. `scripts/create-install.sh` adds one install
  per run to a server with Docker. Building the image needs Docker's
  BuildKit. The image is not on a registry yet.
- **Host the editor online**, from **Online** or `galley host`: a hosted
  install for the open site on your own Fly.io account, behind a Cloudflare
  Tunnel on a computer of yours, or as files for any server with Docker —
  planned and priced before anything is created, keys handed over only when
  you tick them, removed exactly. `--preview-address` and `--live-address`
  for addresses like `example.co.uk`. Run against strict stand-ins for
  Fly.io and Cloudflare, not yet against the real services. Plugins can add
  hosts (`editorHosts`); `galley.config.json` gains `editor` (`url`, `host`).

### Changed

- **Sign-in on a hosted install**: `galley serve` no longer needs
  `GALLEY_PASSWORD`. The password is stored as an scrypt hash, can be changed
  in the app, and **Sign out everywhere** and sign-outs survive a restart; the
  cookie is `__Host-` on `https://`. `galley serve --reset-password` replaces
  a forgotten password with a new setup link and keeps serving; a setup code
  that was used stays dead.
- On a hosted install, preview ports are no longer used, and
  `GALLEY_PREVIEW_PORTS` and `GALLEY_SITES_DIR` are ignored.
- A hosted install keeps the site's live address in its own state, never in
  the site's `galley.config.json` (the site's own `urls.production` wins), so
  first run leaves no unpublished change; and installing the site's packages
  for the preview never leaves a lockfile in a site that has none.
- `galley serve` exits by itself once it has stopped.
## 0.1.3 — 2026-11-24

Fixes for problems seen while capturing the tour and the how-to guides.

### Fixed

- **Forms**: a form used by a page section is listed as used (a page with
  several forms, a section that names its form by id, and a section showing
  its default form were all missed). **Add a destination** is a proper menu
  inside its column. **Use this form** proposes the section that shows this
  form, not the first form section it finds.
- **Proof**: a new script is named ("Scripts › Google Analytics 4 · Added"),
  and a count of details no longer looks like a link.
- **Search and AI checks**: pages are read once the preview has woken, so the
  first check no longer says pages "didn't answer"; the "Fixed" message goes
  away by itself; and changing an AI-crawler rule keeps its confirm bar in
  view, and no longer loses unsaved choices when the checks refresh.
- **Moving from WordPress**: after the import's changes are discarded or
  published, the report says so and offers to start again; "Put it online" is
  a button like its neighbours.
- **Brand**: material says where it will be kept before and after saving;
  voice examples name their page ("Home page"); colour cards line up.
- **Click to edit**: "Which one did you mean?" can be closed (a Close button,
  Escape, or a click elsewhere), and focus returns to the page. Menus and
  popovers across the app now take focus when they open.
- **Online**: set-up ends by saying its settings are a change waiting in
  Proof, with one press to publish just that; the address has a labelled
  Copy button.
- **Site settings**: the Save bar no longer covers the next section.
- **The assistant**: an empty pane offers to continue the last conversation.
- **Inbox**: "Test" means a submission from the app's own preview or "Send a
  test", not any submission from the same computer.
- Smaller things: the suggested publish note names the home page "Home
  page"; generated file names end on a whole word; the answer under "Try an
  address" has no stray space; the editor's address box shows the whole
  address.

### Changed

- Agent-readable pages and the per-crawler switch are marked built, for
  Astro sites with the site kit.

## 0.1.2 — 2026-11-24

### Fixed

- **Redirects are no longer read as page links.** The Search and AI checks
  and Proof's "things to check" reported every old address in the redirects
  list as a broken link, and **Point it at the new address** rewrote the
  redirect itself. The list and the host files written from it are now left
  out of link checks, and a fix can never edit them. A real broken link in a
  page still gets its fix.
- **Brand: material added after the brand is saved can be read.** New files
  are offered as "new files to read" whenever there are any, and stay offered
  across a restart.
- **The Brand screen opens at once** instead of staying blank while it reads
  the site's styles.
- **From a WordPress move to its redirects**: "Review redirects" opens the
  review with the import's old addresses already chosen, and a list that
  already has redirects says how many of them are still waiting.
- A command whose output is cut short (`galley starters | head`) ends quietly.
- `galley mcp config` prints the `npx -y galley-cms mcp …` form first.
- Wording: the path of a redirect loop, the contrast notes and type sample on
  the Brand screen, the summary of the Search and AI checks, and the WordPress
  report (no command-line option in the app's text; it says when entries were
  left out).

### Changed

- Redirects, the brand set-up and the Search and AI checks are no longer
  marked "new, in final checks".

## 0.1.1 — 2026-11-24

### Added

- **Your own domain** for a site that is online: **Online › Use your own
  domain…** in the app, `galley domain <hostname>` and
  `galley deploy --domain <hostname>` on the command line. Galley shows what
  will change first, never replaces a DNS record, waits until the address
  answers over HTTPS, and detaches only an address it attached itself. On
  Cloudflare the domain has to be in the same account as the site; on Vercel
  you're shown the DNS record to add. New optional settings: `deploy.domain`
  and `deploy.defaultUrl`.

### Changed

- The packages describe Galley as an open-source AI CMS **for static sites**:
  Astro fits deepest, and Docusaurus, Nuxt, Next.js, SvelteKit, Eleventy, Hugo
  and Jekyll are recognised by their conventions.
- The documentation, the quickstart and the starters' READMEs start from
  `npm create galley@latest` and `npx galley-cms`; running from a clone is in
  `CONTRIBUTING.md`, for people changing Galley itself.
- A site's live address stays the one you chose: a deploy no longer replaces
  an own domain with the host's default address.

### Known problems (fixed in 0.1.2)

- The Search and AI checks, and Proof's "things to check", read the redirects
  list as page links and report every old address as a broken link. Don't use
  **Point it at the new address** or **Fix all** on those findings: it
  rewrites the redirect.
- `galley starters | head` (any command whose output is cut short) ends with
  an error message.

## 0.1.0 — 2026-11-23

The first release, on npm as `galley-cms` and `create-galley`.

### Engine (`@galley/core`)

- **Detection without configuration**: framework, package manager, dev and
  build commands, collections, fields, page sections, URL patterns, media
  folders and the live address, read statically — no site code is run.
- **The Astro adapter**: `astro.config.*`, the content config and its zod
  schemas (glob and file loaders, legacy collections, Starlight's loaders,
  discriminated unions as page sections), and dynamic routes in `src/pages`.
- **Convention adapters** for Eleventy, Hugo, Jekyll, Next.js, Nuxt,
  SvelteKit and Docusaurus, and a generic markdown fallback.
- **The public adapter API** (`GalleyAdapter`, `AdapterContext` and its
  helpers, `defineAdapter`, `conventionAdapter`), with site adapters loaded
  only when `galley.config.json` names them.
- **Schema inference** from the files, with the precedence config > schema >
  inferred.
- **`galley.config.json`**: strict validation with readable errors, and a JSON
  Schema generated from the same definition.
- **Surgical edits**: YAML scalars spliced at their byte range, structural
  edits through the YAML document API, JSON indentation kept, body edits that
  refuse ambiguity, TOML read-only.
- **Click-to-edit resolution** that returns unique, ambiguous or none — never
  a guess.
- **The workspace**: contained paths, a closed write surface per mode, atomic
  writes, change sets with field-level changes, discard, publish (commit and
  push, or a branch and a pull request), undo a publish (`git revert`), pull,
  history, checkpoints, an outside-edit watcher.
- **The preview**: the site's own dev server behind a proxy that keeps hot
  reload, removes frame blocking and adds the overlay; a baseline proxy for the
  deployed site.
- **The assistant**: Anthropic's Messages API with tools, content and build
  modes enforced by the engine, one-question clarification, per-turn undo,
  prompt caching, a plain fallback request profile, settings, secrets and
  usage estimates.
- **Image generation**: OpenAI and Google providers (unverified against the
  live services) and an offline placeholder provider.

### Server, CLI and UI

- **`@galley/server`**: every route of the HTTP API, Server-Sent Events, the
  UI with a strict Content Security Policy, local mode (loopback and a session
  token) and hosted mode (a password, signed cookies, rate-limited sign-in),
  Host and Origin checks, white-label branding.
- **`galley-cms`**: `galley [path]`, `serve`, `init`, `doctor`, `new`, `mcp`,
  `version`, and `desktop` for the desktop app; a single-file bundle build.
- **`@galley/web`**: the shell, Sites (open, clone, create), site home,
  settings, version history and the editor's container. The content form,
  media library, chat, proof, preview pane and new-site screen are in
  progress.
- **`@galley/overlay`**: the script in the preview that outlines, reports
  clicks and allows retyping in place.

### Around it

- **The desktop app** (Tauri 2): runs the server privately, a native folder
  picker, clean shutdown of the server and its dev servers. Built and tested
  on macOS; installers unsigned.
- **`@galley/mcp`** (in progress): Galley over the Model Context Protocol —
  the built-in assistant's tools for any MCP client, over stdio
  (`galley mcp`) or Streamable HTTP at `/mcp` with a Bearer token.
- **`@galley/astro`** (in progress): an optional Astro Dev Toolbar app that
  shows whether Galley is running and opens the current page in it.
- **`@galley/adapter-kit`**: sixteen conformance checks for adapters, as a
  vitest helper and a command-line checker; a worked Eleventy example.
- **The Astro starter**: sixteen section types, a blog, a team, data files for
  every piece of interface text, one theme file and a content guide.
- **The container**: a `Dockerfile` and `docker-compose.yml` for hosted mode
  (not built yet).
- **The website and documentation**, which check themselves against the code
  on every build.
