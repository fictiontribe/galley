# Changelog

All notable changes to Galley, newest first. Versions follow
[Semantic Versioning](https://semver.org); while Galley is 0.x, a minor version
may change the configuration file, the HTTP API or the adapter API, and the
entry says how.

## Unreleased

### Added

- **Signing in through your own identity provider (OpenID Connect)**, on a
  hosted install, beside the passwords. Set `GALLEY_OIDC_ISSUER` and
  `GALLEY_OIDC_CLIENT_ID` in the server's environment (never in the
  starting-values file), with `GALLEY_PUBLIC_URL` on `https://`. The sign-in
  screen gets a "Sign in with …" button. It uses the authorization code flow
  with PKCE, checks every ID token in full (one algorithm, the issuer, this
  editor as its only audience, its age, its nonce), finds each person by the
  provider's issuer and subject (never by e-mail), and starts a session of
  `GALLEY_OIDC_SESSION_HOURS` (12 by default). The provider sets the role at
  every sign-in, from `GALLEY_OIDC_ROLE_CLAIM`, or `GALLEY_OIDC_DEFAULT_ROLE`.
  `GALLEY_OIDC_OWNER` names the first owner by subject. Someone who signs in
  through the provider gets no password ("forgot my password" and new-password
  links don't apply to them), so removing them at the provider removes them.
  The variables are in the environment reference.
- **Passwords can be turned off** with `GALLEY_OIDC_ONLY=1` beside an
  identity provider: the sign-in screen has the provider's button alone;
  signing in with a password, invitations, "forgot my password", an owner's
  new-password links and choosing a password at first run are refused, and
  open links stop working. Sessions not started through the provider are
  refused when read, and once passwords have been off, those from before stay
  refused even if they are turned back on. `GALLEY_PASSWORD` is ignored with
  a notice (and refused while the install has no owner: name it with
  `GALLEY_OIDC_OWNER`).
- **`galley serve --reset-password` lets back in an owner who signs in
  through the provider, or anyone while passwords are off**: its link signs
  them in once, without a password, with a session as long as the provider's,
  and sets none. `--account <id>` and `--subject <subject>` name the owner
  when there are several; with none named, they are listed on the console.
- **Connecting your own account to the identity provider in the app**
  (Your account → Sign in with …), with passwords on: your current password
  (held to the same limits as a password change), a fresh sign-in at the
  provider (`prompt=login`, `max_age=0`, and its `auth_time` checked), then a
  page showing whom it signed in (an e-mail only when the provider confirmed
  it) to Connect or Cancel. Nothing is bound before Connect, which needs this
  browser still signed in as you; it drops your password and open links,
  signs you out everywhere and starts a session through the provider. A
  subject with an account of its own, or removed, is refused: two accounts
  are never merged. Each link is logged naming the subject. From the link
  `serve --reset-password` makes, an account connected to the wrong person
  can take the provider off and choose a password.
- **`galley accounts`** (list, link, rekey), run on the server with the
  server stopped: `link` binds existing accounts to their subjects at the
  identity provider (`GALLEY_OIDC_ISSUER`), one pair or a file of them, and
  each loses its password and open links and is signed out everywhere;
  `--replace` puts a wrong link right; a subject another account has, or one
  that was removed, is refused. `rekey` moves every account and removed
  account to a new issuer in one write, or none if one would clash. Both
  refuse while a server holds the data folder.
- **Back-channel logout** from the identity provider
  (`POST /api/auth/oidc/backchannel-logout`, OpenID Connect Back-Channel
  Logout 1.0): a logout token for a subject ends every one of their sessions,
  open streams included, holds across a restart, and refuses a sign-in begun
  before it, also for someone with no account here yet. The token is checked
  as an ID token is (the same keys and algorithm, this editor alone) and as a
  logout token (the event, `iat`, `jti`, no `nonce`, no older than 30 days, a
  subject). The route reads no cookie and needs no Origin, by its exact path;
  its body is capped at 16 KB; it shares no limit with signing in. It
  answers `200` once the logout is written; `503` means send it again (it
  couldn't be checked or written just then, or a backup is being put back);
  `400` means the token will never be taken. RSA keys under 2,048 bits are
  never used.
- **The server's access token can sign one person out**
  (`POST /api/people/:accountId/sign-out`), logged as the token. It could
  already sign everyone out; the rest of People still needs a person signed
  in in a browser. Where an identity provider is set up (above), it may
  also switch someone off, delete an account already switched off, list the
  people without names or e-mails, and look one up by subject
  (`GET /api/people/by-identity`). None of them ever switches someone on,
  changes a role or an e-mail, or makes a link.

## 0.4.4 — 2026-11-26

**Security.** If you run a hosted editor, or extensions or plugins you
didn't write, update: a request is now read by the name in its Host header
alone however its request line is written, and an extension or a plugin is
handed only what it is meant to use.

### Added

- **Sarking (`sarking`, `starters/astro-blog`), a blog starter for long-form
  writing with evidence.** Posts are plain Markdown, never MDX — so on a
  hosted install contributors can edit them — with twelve fenced-block YAML
  embeds (`chart`, `compare`, `stats`, `verdict`, `proscons`, `timeline`,
  `steps`, `faq`, `gallery`, `pullquote`, `video`, `takeaways`) validated
  against schemas in `content.config.ts` and rendered on the server without
  JavaScript. Eighteen section types, four templates, three looks (Ledger,
  Fieldbook, Almanac, each light and dark), authors, series, topics, archive,
  search, full-text RSS and JSON feeds, and a Markdown copy of every page via
  the site kit. Travels as a downloaded starter (`"download": true`), fetched
  and hash-checked each time a site is made from it.
- **A starter can travel apart from `galley-cms`, downloaded whenever a site
  is made from it.** A starter whose `starter.json` says `"download": true`
  is published as `starters-<id>.tgz` on its version's starters release; the
  package keeps what shows it in the wizard and `galley starters`, with the
  archive's size and SHA-256. Making a site from it (the wizard, `galley
  new`, a hosted editor's first run, the desktop app) downloads the archive
  each time — nothing is kept between uses, so it needs the computer to be
  online, and the `tar` program to unpack it — refuses one that isn't exactly
  what was recorded, and says plainly when it can't be downloaded. The four
  starters that shipped before stay inside the package and work offline as
  before. `GALLEY_STARTER_DOWNLOADS` points the download at a mirror.

### Security

- **What an extension or a plugin is handed is narrowed to what it is meant
  to use.** A checkpoint or a preview controller taken from a site is now its
  public members only, and what they answer is a copy; a plugin's site no
  longer has members the engine keeps for itself, and can't be changed
  through. Before, an extension or a plugin could reach past the limits it
  was given (its read-only scope, the mode, the site being closed). **If you
  run extensions or plugins you didn't write, update.**
- **A request is read by the name in its Host header alone, however its
  request line is written.** 0.4.3 left some request lines that the preview
  could still read another way; they are now refused (400) before the preview
  or the app sees them. **If you run a hosted editor, update.**

### Changed

- **The Plugins screen is laid out anew.** Each installed plugin is a card
  with its status, a switch, what it adds and one action (Configure, Set up
  or Details), and its settings, problems and details open in a panel of
  their own. **Create with AI** starts a plugin from an idea, in the
  assistant's build mode or as a prompt to copy for another coding agent.
  A **Directory** tab lists the plugins that ship with the app, the example
  plugin in Galley's repository, and ideas the assistant can build. It
  offers to install a package only from a list of plugins Galley publishes
  on npm, which is empty for now, so the plugins listed there say "Built in"
  or link to their source rather than offering an npm name. Adding a plugin
  by hand is a command shown in its own window, as before.
- **A session's end is signed into its cookie.** On a hosted install, a
  sign-in cookie made from this version on carries when the session ends and how it was started,
  under its signature, and every place that reads a session (a request, the
  event stream, the preview, an extension asking whether a sign-in counts)
  ends it at that moment; a sign-out is remembered until then. A password
  sign-in still lasts 30 days, and cookies from before stay good until their
  30 days are up. Changing your password keeps this browser signed in until
  the same time as before, rather than for 30 days more. The preview's
  viewer cookies from before are refused once: the preview asks the editor
  for a new one, which it gets by itself.
- **The install's data layout goes from 2 to 3** at the first start of this
  version, to make room for accounts that sign in through an identity
  provider, which a later version adds. Nothing changes for anyone: every
  account keeps its password, and open invitations and links keep working.
  As with every upgrade of the layout, an older version refuses the folder
  afterwards; the state file from before is kept as
  `install.json.schema-2.bak`, and the copy from the upgrade before
  (`install.json.schema-1.bak`, from the upgrade to accounts, holding the old
  shared password's hash) is removed, as the guide to running an install
  always said.
- **A site with an assistant's Undo still offered stays open.** The editor
  closes a site nobody has used for an hour, and Undo's memory went with it:
  Undo of an assistant's reply an hour later said it couldn't be done any
  more. A site isn't closed for lack of use now while a reply's Undo is still
  offered. There is no time limit: a reply that changed something offers its
  Undo until it is undone, its conversation is deleted, or it is pushed out by
  20 newer replies in that conversation. So a site the assistant has changed
  usually stays open, with its file watcher, until the app stops. Measured on
  the Astro starter (24 entries; a larger site costs more), each site kept
  open beyond the first costs about 1.3 MB of memory, plus what its Undo
  keeps, about 15 KB for a typical reply; a site's Undo keeps at most 32 MB of
  earlier copies of files in memory, and further copies go to temporary
  files. A batch of search fixes, whose Undo is offered for a few seconds,
  doesn't keep a site open, and it now lets go of what it kept once undone
  or pushed out. A checkpoint an extension or a plugin opens and never lets
  go of (`release()`) is let go about an hour after its `close()`; one never
  closed is kept until its site closes.
- **A site that has been closed refuses whoever kept it.** A site closes after
  an hour without use (as above), when it is removed, when a backup is put
  back, and when the app stops. Something that kept it from before (an
  extension or a plugin that held on to it, a preview controller, a save
  still on its way) used to go on reading stale copies and writing the
  site's folder behind the site opened since, where two edits of one file
  could each answer "saved" while one was lost. It now gets *This site has
  been closed, so it can't be used from here any more. Open it again to go
  on.* (403) for anything it asks after the close: a file save still on its
  way and git work still waiting its turn are refused the same way, a preview
  taken from it doesn't start again, and an Undo asked of a checkpoint taken
  from it says the site was closed. Work already running when the site
  closes (a discard, a publish) runs to its end unless it has to wait its
  turn again, and the site isn't opened again until it has. For an
  extension: ask `host.sites.get(siteId)` each time you need a site.

### Fixed

- **A save the previewed page asked for, when refused, no longer tells an
  owner or an editor to ask an owner or an editor.** Someone at build-mode
  level is told only what they can do: make the change in the form. An
  account below that level is still told who can help.
- **A backup can be restored when the site's files share a file with the
  install's own.** A file with names in two of the data folder's top-level
  folders is now carried under the names in one of them only, never the
  site's when another holds it, so the site's own name for such a file isn't
  in the restored site; before, the restore refused such a backup.

## 0.4.3 — 2026-11-25

**Security.** 0.4.3 is for anyone who runs a hosted editor, above all one
with contributors or a reverse proxy on the same machine. Below build-mode
level the editor no longer changes content that the site's framework runs as
code — through the form, the previewed page or the assistant. A proxy on the
same machine can reach the editor over a Unix socket, the only place
forwarded headers are then believed. Smaller fixes keep the preview, Search,
backups and stopping a preview to what is the site's own. If you run a hosted
editor, update. None of this makes the roles a wall: the preview still runs
the site's own code for whoever may change that code.

### Added

- **Embedding, third part: places in the app (experimental).** A program
  that builds its own edition of the editor can draw in three places of the
  app: once inside the signed-in app (`root`), at the right of the top bar
  (`topBar`), and after the title in each row of a collection's list
  (`listRow`). Additions are given to the root component when the program
  is built, `<App additions={[…]} />`, and nowhere else; with none, every
  place renders nothing and the app is as it ships. `@galley/web/additions`
  gives an addition a client for its extension's own routes, its events by
  name, the value its window's stream carries, the open site, the signed-in
  person's name and role, and two components for showing other people's
  words safely. An addition that fails while it draws shows nothing in that
  place and the rest of the screen stays, and one that waits shows nothing
  there while it waits. It is not a sandbox: an addition is part of the one bundle. The web package now has
  entry points (`./app`, `./additions`, `./ui`, `./styles`) and a small Vite
  preset (`./vite`): the two aliases its source is written with, one copy of
  React and the router, and the app's public folder and build target. An
  edition starts its page from the app's own `index.html`.
- **The server can listen on a Unix socket for the proxy in front
  (`GALLEY_SOCKET`, `galley serve --socket`).** With a reverse proxy on the
  same machine, `GALLEY_TRUST_PROXY=1` believes the `X-Forwarded-For` and
  `X-Forwarded-Proto` of every connection that reaches the port — the proxy's,
  or anything else that can reach it (another user's program on that machine,
  another container, a neighbour on the network), which can then claim any
  client address and slip past the per-address sign-in limits. With
  `GALLEY_SOCKET` set, a hosted editor also listens on that socket, made for
  its own user alone, or for its group too with `GALLEY_SOCKET_MODE=0660`
  (as the image sets, for a proxy in another container); the proxy connects
  to it, and forwarded headers are believed for requests on the socket
  alone, never for those on the port. That keeps out other users (with
  `0660`, all but the group's members), other containers and the network. It doesn't
  keep out code that runs as the server's own user — which, until the editor
  runs the site's code as a user of its own, includes the site's preview and
  build. The same app answers on both, `/healthz`, `/readyz` and the preview's
  WebSocket upgrades included. It is for a hosted editor (`galley serve`)
  and not on Windows; a local editor ignores the setting and says so. The
  server refuses a socket in a folder other users could change. Existing
  installs are unchanged: without a socket, `GALLEY_TRUST_PROXY` works as it
  did.

### Changed

- **One part of the app that fails on a live update no longer costs the
  others theirs.** The app has one live connection to the server, and each
  screen listens on it. When one listener failed on an update, the listeners
  after it never heard that update, so another screen could stay stale until
  it was reloaded. The same held for what each screen does when the
  connection comes back after a drop. Each listener now runs on its own, and
  a failure is reported as an uncaught error, once for each listener, and
  not again while it keeps failing the same way.

### Fixed

- **Changing content a framework runs needs build mode.** The preview and the
  build run the site's own code for everyone, and on many sites some content
  is part of that code: MDX, the template languages of frameworks like
  Docusaurus, Eleventy and Jekyll, and on Astro the layout and the images a
  Markdown page names. On a hosted install an account below build-mode level
  could change such content, and so run code on the editor's server through
  the preview. Below that level content mode is now a short list. Such an
  account may edit and add Markdown on an Astro site, on a Markdown site where
  the editor sees no build tool, and in a collection the owner marks `plain`;
  add pictures, PDFs and MP4 videos in the media folder (on Astro, also
  beside a collection's entries); edit a data file in a collection (on Astro, JSON
  only; never a build tool's or a host's settings file, or one in a
  framework's template folder); and edit the redirects. On Astro it may not
  add or change a page's layout, or add an image that isn't a picture, PDF or
  MP4 video in the site. It may not change MDX, other frameworks' content, the
  site's settings or source, or the files assistants read as their
  instructions (STYLE.md, the brand folder, AGENTS.md and the like). It may
  not turn a script on, or change what one that is on runs; it may turn one
  off, remove it, or change where it loads and how consent is asked. It may
  delete only what it may write. On a hosted install the same list holds,
  whoever is signed in, for a save the previewed page asks for (click to
  edit, Arrange), and for the assistant outside build mode: a content
  conversation, a writing batch, and an AI client over MCP in content mode,
  the operator's own token included. A plugin's writes count as the
  assistant's, whatever the plugin says. **If you run a hosted editor with
  contributors, update.** This does not wall the roles off: the preview runs
  the site's own code for every role, content can still make it run code that
  is already in the site, and HTML written into Markdown runs in the browser
  of whoever views the page.

  What changes for ordinary use on a hosted install, whoever is signed in:
  click to edit and Arrange, and the assistant outside build mode (a content
  conversation, the writing batch, an MCP client in content mode), now change
  only what an account below build-mode level could. They can't change MDX; on
  Astro, anything but Markdown, JSON and media, a page's layout (a new page
  from a template that sets one included), an image that isn't a picture, PDF
  or MP4 video in the site, or a page whose settings at the top aren't one
  plain block; on other frameworks, their Markdown and templates; on a site
  the editor doesn't recognise, its Markdown once its folder shows a build
  tool (a package.json with scripts or dependencies, a generator's or host's
  settings, a CI workflow) or its settings give a dev or build command; or,
  anywhere, a page named like an assistant's instructions (agents.md,
  claude.md, gemini.md and the like). For now the writing batch is stricter
  still: on a site the editor doesn't recognise, it leaves the Markdown pages
  alone. An owner or editor can still make these changes in the form or over
  the HTTP API, and the assistant and MCP clients can in build mode; where
  build mode is off, only the form and the HTTP API can. An
  owner can declare a collection `plain` in `galley.config.json` when the site
  runs no code in its Markdown; its Markdown can then be changed these ways
  again (MDX never can). That is the owner's word: if the site does run code
  there, anyone who can edit the collection can run code.

  Turning a script on, or changing what one that is on runs (its settings,
  such as an ID or custom code, or whether it runs in the preview), now asks
  what a form's custom code asks, for everyone and locally too: the site must
  allow build mode (where it doesn't, nobody can, owners included, until an
  owner turns on “Allow build mode” in Site settings › Assistant), and the
  assistant and MCP clients need build mode for it, as does a write of the
  whole file over the HTTP API (`PUT …/file` with `"mode": "build"`); an edit
  through the form, as on the Scripts screen, counts as build mode for someone
  at build-mode level. Turning a script off, removing it, and changing where
  it loads and how consent is asked stay as they were. Where the person may
  use build mode, a request typed in the Scripts screen's Ask line opens in
  build mode, ready to send. For someone who may not turn a script on, the
  Scripts screen hides Add a script and the switch that turns one on, and
  says why a change was refused; undoing the removal of a script that was on
  brings it back turned off. The docs for `ai.allowBuild` now say that it
  holds for everyone, as it already did.

- **Undo no longer says it undid something when it could not.** The editor
  closes a site that nobody has used for an hour (one whose preview isn't
  running), and what Undo keeps for the assistant's replies and for a batch
  of search fixes is let go with it. Undo after that put nothing back, yet
  answered as if it had: the chat said "Undone. Everything this reply
  changed is back to how it was." and marked the reply, with the pages
  still changed. Undo now says that it can't be undone from here any more
  and why, the reply stays as it was, and the changes are still in Proof to
  discard. Most likely on your own computer, after an hour away from the
  window; a hosted editor keeps its site open while it keeps up with the
  repository.
- **The preview checks that what answers on its port is the site's own dev
  server.** When a preview starts, Galley chooses a free port for the site's
  dev server. If another program got that port in the moment before the dev
  server asked for it, the preview could come up showing that program's
  pages as the site's — on a hosted editor too, where the preview is passed
  on to the people signed in — or it stopped with "The preview stopped
  before it was ready". Now, before a page that answers on the port is used,
  Galley checks that every program listening on that port, on whichever
  address, is the dev server it started (by process, or by running in the
  site's folder). If something else has it, the dev server is started again
  on another port, up to twice; if the dev server moved to a port of its own
  and said so, it is followed there; if it stopped for a reason of its own,
  it isn't started again.
  When another program holds the port and the dev server neither stops nor
  moves, the preview gives up with a sentence that says what to do. A
  listener this computer can see but can't attribute (another user's, on a
  shared server) is not taken for the dev server's. Where the computer can't
  say which program has a port at all — Windows, or a Mac without `lsof` —
  the answer is taken as before, and the log says so; Linux needs
  neither tool. A dev command that runs its server where it can't be seen as
  the site's own, such as in a container, needs `dev.trustPort` in the
  site's settings, which an owner sets to take the port on trust. The
  preview still runs the site's own code: this keeps one site's preview from
  showing another program's pages, it is not a wall around what a site's own
  code may do.
- **Search and the assistant read built pages only from inside the build
  output.** When a site has been built, Search and the assistant read its
  built pages to check links and to find where a text lives, and could read
  files outside the build output while doing so — a secrets file (`.env…`)
  or one of the version history's own among them. Now each built page is
  resolved before it is read, and one that leaves the build output, is a
  secrets file, or sits in the repository's `.git` reaches nothing — the same
  rule the editor's other reads already follow. The list of built pages
  leaves those out too. The content index and a collection's listing check each
  file the same way as it is read, not only when it is listed.
- **A dev server that moves itself to the background is checked on its port
  like any other.** Some dev commands start their server and then exit,
  leaving it running in the background; Galley took whatever answered on the
  port that server announced, so another program's pages could be shown as
  the site's. Now the announced port is checked the same way as a foreground
  server — that what
  listens there is the server Galley started (by the process it named, or by
  its running in the site's folder) — and a port another program shares is
  not shown. A background server isn't started again, so the preview reports
  that it didn't start in time rather than showing the wrong pages.
- **A preview keeps checking, while it is used, that its port is still its own
  dev server's.** The checks above happen while a preview starts. A dev server
  can also let go of its address after the preview is ready — on a restart, say
  — and another program can take it, with the dev server's own process still
  running, so nothing noticed. Now, before serving a request, the preview
  re-confirms (at most once every fifteen seconds of use, never while idle)
  that the port is still its dev server's; if another program has taken it, the
  preview is stopped with a plain message rather than showing that program's
  pages. A check that can't tell keeps the preview as it is, and only after
  several in a row that can't does it stop. A port an owner set `dev.trustPort`
  for is not re-checked, as it isn't checked to begin with, and neither is
  one taken without a check (on Windows, say).
- **The default author is the computer's git identity, not a repository's.**
  When no author is set, the app falls back to the name and email in this
  computer's git settings. It read them from whatever folder the editor was
  started in, so starting it inside a repository with an identity of its own
  gave every site that repository's author. It now reads them from the
  editor's own folder, the same way as every other git call it makes.
- **A backup and a restore keep links inside their own folder.** A backup
  could carry, and a restore put back, a link from the site's files to the
  install's own files beside them. Now a link has to stay in the folder it is
  in (the site's files, the state, and so on): a backup leaves out a
  symbolic link that doesn't, and a restore refuses an archive with any link,
  hard links too, that doesn't.
- **Stopping a preview signals only what the editor itself started.**
  Stopping a preview could signal a process the editor hadn't started, on a
  site whose dev command moves its server to the background. Now the editor
  stops only the process group it started the command in: a background
  server that stayed in it is stopped with the preview; one that moved to a
  group of its own is left running, and the preview says so (stop it the way
  its dev tool says). On Windows such a server is now always left running,
  and the preview says so too.
- **A request is taken to have come over HTTPS only when it did, and to the
  name in its Host header only.** The protocol a request arrived over now
  comes from its connection, or from the proxy in front where its word is
  believed, never from how the request itself was written. And the app checks
  the name a request is for in its Host header alone — the one the preview's
  addresses are told apart by — so the two can't disagree about where a
  request is going. The protocol and the name decide which page addresses
  count as the app's own for a change, and whether a session cookie is marked
  secure.
- **The starters' Deploy buttons deploy the starter.** The Cloudflare and
  Vercel buttons in each starter's README pointed at repositories that don't
  exist; each now deploys that starter's own folder of Galley's repository,
  and the `create astro` commands in the READMEs name the folder too. The
  editorial starter (Caddow) gains the buttons and a `wrangler.jsonc`, so the
  Redirects screen takes a site made from it for a Cloudflare site; delete
  the file if the site is hosted elsewhere. Its README and the storefront's
  show their sections and home page.

## 0.4.2 — 2026-11-25

**Security.** 0.4.2 closes several ways a signed-in person on a
hosted editor, or the assistant, could see what a secrets file (`.env…`) or
the version history holds. If you run a hosted editor, update. If the
assistant may have read such a file before, change the keys in it and delete
those conversations: a conversation keeps what its tools returned.

### Changed

- **Moving media to a bucket moves it.** A move kept a repository file while
  any file at all named it, so a README, a record of the photographs or a
  script beside the site kept every picture it listed: on the fashion
  editorial starter a move copied 31 files and removed none. A copy now
  stays only while something the site is built from, and that the move can't
  update, still uses it. On the four starters a move removes 25 of 27, 29 of
  31, 35 of 37 and 30 of 52 copies, where it removed 11, 0, 16 and 20. (For
  the two fashion starters those numbers also take the change to the
  starters under Fixed below: their own source read the shot list, which
  names every photograph, so with the old code a move still removes 0 of 31
  and 20 of 52.)
  - **Galley's own page templates are updated like pages**, so a page made
    from one later doesn't carry an address that is gone. A template is not
    content: the move writes it in build mode, when the site allows build
    mode and the person may use it, and the change waits in Proof. Where
    build mode is off, templates are left and keep the files they use, as
    before. (A template kept in a folder content mode writes is content, and
    is updated either way.)
  - **What still stays, and what to do about it.** The site's code and data
    it is built from that content mode doesn't write are never changed by a
    move, so what they use stays: the favicon and share picture a layout
    names, the pictures in a catalogue file. The plan names those files and
    says how to move the rest.
  - **A file the site's source reads counts, wherever it is kept.** What a
    site is built from is its framework's folders (see `builtFrom` under
    Added). A page that imports `../../data/team.json` is built from that
    file too, so the pictures it names stay, and the plan says why: "still
    used by data/team.json (read by src/lib/team.ts)". Galley follows a
    relative path written out in the file that does the reading (an import,
    a file the code opens, a glob), one step from the site's own folders.
    It can't follow an alias, a path that starts at the site's root or is
    put together while the site builds, or a file reached through a second
    file outside those folders: name those in `build.sources`.
  - **Other mentions no longer keep a file**, on a site whose framework says
    what it is built from: Astro, today. The plan lists them on a line of
    their own before anything happens ("Also mentioned in …. Nothing the
    site is built from reads them, as far as Galley can follow, so they
    aren't changed and keep no copy"), and they are left as they are. Read
    that line before moving: if the site's build reads one of those files
    in a way Galley can't follow, add it to `build.sources` first, as the
    line says. On any other framework every file still counts, as before.
  - **What is never removed**: a copy that a file counted as above still
    uses. A removed copy is an ordinary deletion in Proof that can be put
    back, and the bucket has the file. One that was never published has no
    deletion to put back, since removing it only takes back an addition: it
    is in the bucket, and Proof lists it among the uploads.

  The plan counts only what the move updates: it used to count places in
  files it would never change. The plan's answer gains `templates`,
  `alsoMentioned` and `readBy`; a move's result gains them too (in the
  command line's `--json`, the count of templates is `rewrittenTemplates`).

- **The site's model is read-only.** The engine keeps one description of a
  site (its collections, where media lives, what content mode may write, how
  it publishes) and hands that same object to everyone who asks: a route, the
  assistant, a plugin. Whoever changed what they were
  handed changed the site's rules for everyone until the model was next
  loaded. It is now read-only all the way down. Nothing of Galley's own
  changed it. **A plugin or an adapter that did** now gets a `TypeError`
  where it makes the change ("Cannot assign to read only property…",
  "Cannot add property…, object is not extensible"); in code that doesn't
  run in strict mode an assignment is silently dropped instead (a method
  that changes one of its lists, such as `push`, throws there too). Take a copy
  (`structuredClone(model)`) and change that. The same goes for an object an
  adapter gives the engine as part of the model (a collection's fields, a
  command): it is the model's from then on, so give a new object each time
  rather than keeping one and changing it later.

### Added

- **An adapter says what a site is built from**: a new optional convention,
  `builtFrom`, globs from the site root. The Astro adapter gives the source
  folder, the public folder and the configuration at the root. An adapter
  that says nothing keeps every file counting, as before. The conformance
  kit checks that the list holds the site's collections, media folders and
  routes folder.
- **`build.sources`** in `galley.config.json`: further files a site's build
  reads, added to the adapter's list.
- **Embedding, first part: routes of your own (experimental).** A program that
  starts Galley's server can add API routes to it when it is built
  (`startServer({ extensions })`, `@galley/server/extensions`), for an edition
  of the editor with something of its own in it: a status page, a button that
  files a request. Each route lives under `/api/x/<id>/`, which no address of
  the editor's own uses, and names the level it needs (edit, publish or
  manage); the server doesn't start with a route that has none. A request has
  passed every check a request to the editor's own API passes before a handler
  sees it, and two more: with a cookie the browser must say the request is the
  editor's own page's, or that a person opened the address directly (a typed
  address, a bookmark, a link from outside a browser), on GET too; and a part
  of the address can't carry a path. A handler is handed a narrowed request
  (never the cookie or the headers) and the site with `.git/` and `.env*`
  unreadable by name; what the site answers with is copied where it is data,
  from a change as from a read, and a thing to drive (the preview's
  controller, a checkpoint) is handed behind the same guards; on GET it
  refuses whatever would change it. On an install with accounts, work a
  handler leaves running loses its caller's access once it has answered,
  though what it records still carries that person's publishing name; without
  accounts everything is the one person's. An extension names its secret
  environment variables: on a hosted install they are kept from the site's
  commands, and everywhere their values, when they are six characters or more,
  are taken out of the server's log and of the extension's error messages.
  Once an extension has been stopped, what it was handed does nothing: the
  sites it holds, and the preview's controller if it took one. It is not a
  sandbox: an extension is its author's code with the server's permissions. A
  server with extensions must be the only server in its process. The shapes
  may change in any 0.x release. The docs page is *Run Galley › Embedding the
  editor*.
- **Embedding, second part: events of your own, and knowing a window is there
  (experimental).** An extension can now send events on the editor's live
  stream. It declares each by name with a level (edit, publish or manage), and
  a reader is sent one only if their role has that level at that event; an
  optional `for` says what each reader is sent, and can narrow that but never
  widen it. A window receives `{ type: "extension", source, name, siteId,
  payload }`: `type` and `source` are the server's, and `name` and `siteId`
  are checked against what the extension declared and the sites it has, so an
  extension can't send one of the editor's own events or speak as another. A
  payload is JSON of at most 64 KB about a site the extension has been handed
  (on a hosted editor, its one site). In any one second an extension may send
  50 events and 256 KB; past either its events are dropped and counted in the
  log. A window that already has more than half of what it may have waiting
  (512 KB of 1 MB) is not sent an extension's event. So an extension's events
  never fill more than half of that and one event, and the rest is always the
  editor's own. Such a window is told what it missed once it has room again
  (`stream.missed`, with how many), because it was never disconnected and
  nothing else would tell it. Names that begin with `stream.` are the server's
  own. A stream opened with a value for an extension
  (`/api/events?x-<id>=<value>`) tells it that the window is there and, later,
  that it has gone, which replaces a heartbeat route. A value is taken only
  from the editor's own page, from an address a person opened directly, or
  with the operator's token; from anywhere else it is refused and the stream
  opens without it. An extension can refuse its value too, never the stream:
  the window is sent `stream.refused` and the stream opens as usual. The
  editor's own app does not add a value yet. A restore replaces the data
  folder under a running server: an extension's `stop` runs before it and its
  `setup` again afterwards, with a new host, so a program that embeds the
  server needn't be restarted after one. The routes it returns must be the
  ones it returned when the server started, because an address keeps the
  guards it was mounted with. One that returns others, or can't start again,
  is left stopped: its routes answer 503, and the log says why.

### Fixed

- **A window that has been signed out stops receiving live updates.** On an
  install with accounts, an open live connection was checked for its own
  sign-out and for its account being switched off, removed or signed out
  everywhere, but not for everyone being signed out at once when a backup is
  put back, and not for the sign-in's age. A window signed out that way was
  refused on its next request, yet went on receiving the assistant's replies,
  jobs and changes until it was reloaded. A connection is now held to the test
  a request is held to for as long as it is open: it ends the moment everyone
  is signed out, and at the next heartbeat (twenty seconds, unless the server
  was started with another) after a sign-in passes its thirty days. The page
  that starts a restore closes its own connection first and follows the
  restore by asking, so it still says how the restore went.
- **Crops on the two fashion starters keep their focus point when the
  pictures move.** The editorial and storefront starters anchor each crop
  on its photograph's focus point, so a head or a garment stays in frame.
  They looked the photograph up by its whole address, so once the pictures
  had moved to a bucket and the pages held the bucket's addresses, nothing
  was found and every crop that used the photograph's own point fell back
  to the middle (one with left or right chosen for it never used the
  point). Half the photographs on each starter have a focus point that
  isn't the middle (15 of 30, 15 of 31; one of them is only the share
  picture, which isn't cropped), and the rest of those were cut differently
  from then on. Since 0.4.0, when media
  in a bucket arrived. A photograph is now found by its path inside the
  address, which is the same in the repository and in a bucket. The focus
  points are read from `src/lib/focus.json`, which `npm run focus` writes
  from the shot list; the starters' source no longer reads the shot list
  itself. A site made from one of these starters before this release has
  the old code: a move's plan says so ("still used by
  galley/photography/shots.json (read by src/lib/site.ts)") and keeps what
  the shot list names. To change it, take `src/lib/site.ts` (the part about
  focus points), `src/lib/focus.json`, `scripts/focus-points.mjs` and the
  `focus` line under `scripts` in `package.json` from the starter as it is
  now.
- **A start that fails undoes everything it had started.** When a hosted
  install could not start (its port was already taken) or could not finish
  starting, the process stayed in hosted mode, and a site it had opened
  stayed open. Both are now undone, as a stop undoes them, and the error
  the start failed with is the one reported.
- **Stopping a server that can't let go of its data folder says so.** A stop
  that fails to release the folder still fails, as before; the reason is now
  also written to the log, and the rest of the stop is finished first.
- **A secrets file is any file whose name starts with `.env`.** Galley
  never shows, changes, publishes or deploys a secrets file. It knew one by
  two names, `.env` and `.env.` followed by something, so a file called
  `.envrc`, `.env-production` or `.env_local` was treated as an ordinary
  file of the site. Any file whose name starts with `.env` now counts, in
  any letter case and in any folder, and so does anything kept in a folder
  so named, however the path to it is written or whatever a link to it is
  called. One rule decides it everywhere. It errs on the side of refusing,
  so a harmless file that starts the same way (`.envoy.yaml`) is refused
  too. A folder whose name starts with `.env` is refused everywhere as
  well, Publish included: a change made by hand inside one stays among the
  waiting changes and is never published. It is a rule about names: a
  secret kept under another name (`.npmrc`, `.dev.vars`, a `.pem` or `.key`
  file) is not covered by it.
- **The assistant never reads a secrets file.** In build mode the
  assistant's file tools read any file of the site by its path, and so did
  an MCP client, which is given the same tools. So what a secrets file holds
  could go to the model's provider and into the conversation without anyone
  having meant it. No tool reads a secrets file or anything under `.git/`
  now, in any mode: asked for one, the assistant is told it isn't read here
  and to ask the person for what it needs. That includes `.env.example`:
  tell the assistant the names of the variables it should use. A secrets
  file named in the settings as guidance for the assistant
  (`ai.instructions`) is left out too, and a picture named for the image or
  video provider to work from is held to the same rule.
- **A secrets file's changes are not shown.** On a hosted editor, a
  signed-in person could see the lines of a secrets file where the site's
  changes are shown. Wherever a file or its changes are shown, in the app
  and to an AI tool connected over MCP, the rule now holds.
- **A secrets file is never read as something else.** A file can be named,
  in a request or in the site's settings, to be read as a list of
  redirects, a collection of content, a page template, a built page or a
  piece of brand material. A secrets file named so was read, which on a
  hosted editor let a signed-in person see what it holds. None of these
  reads a secrets file now, or one of the version history's own.
- **A deploy's output folder is a folder inside the site.** The folder a
  deploy puts online is named by the site's settings or its framework's
  configuration, and nothing looked at which folder that was: someone
  allowed to change the settings and deploy could put the version history's
  own folder online, or one outside the site. It has to be a folder inside
  the site now, and not the site folder itself, the version history's or
  one that holds secrets; a deploy that names another is refused with a
  sentence that says so. If your build writes outside the site (a monorepo
  whose framework is set to `../dist`), have it write to a folder inside
  the site.
- **The preview refuses an address that names a secrets file.** The preview
  is the site's own dev server, and a dev server answers for files of the
  site. On a hosted editor, a signed-in person could be shown a secrets
  file that the dev server itself would have answered for. An address that
  names a secrets file, or anything under `.git/`, is now refused before it
  reaches the dev server, on a hosted editor's preview too. The preview
  still runs the site's own code, so what a page shows is the site's to
  decide: the levels people are given keep them out of each other's way,
  and are not a wall against someone who means harm.

## 0.4.1 — 2026-11-25

### Changed

- **A window nobody is at stops asking for its connection.** When the app
  loses its live connection to the server, it asks again every few seconds, as
  before, while someone is at the window. Five minutes after the window was
  last touched, it stops asking, and asks again the moment the window is
  clicked, typed in, scrolled, pointed at or brought back to the front. A
  laptop left with the editor open no longer asks every fifteen seconds for
  a live connection to a server it can't reach, and a server that was
  restarted, or is switched off, is no longer asked for one by every window
  that was left open. (A window in view on a site still tells the server
  every half-minute that the site is open in it, as before.) A connection
  that is working is never closed by this. While it waits, the
  status bar reads "Live updates paused — move the pointer or press a key to
  reconnect".

### Fixed

- **A link to the editor can't send a browser to another site.** A link that
  carries `?token=` is answered with a redirect to the same address without
  the token. An address written to begin with two slashes made that redirect
  point at another site, so a link on the editor's own address could land
  someone somewhere else. The redirect now only ever goes to a path of the
  editor itself. No token or session was given away by it.
- **A hosted editor refuses what it doesn't do however the address is
  spelled.** The check in front of the routes a hosted editor leaves out
  (other sites, hosting the editor online) read the address as it was typed,
  while the router read it decoded, so a percent-encoded letter took a
  request past the check to a route that then asked for an owner as usual.
  Every such check now reads the address the router matched.
- **Moving media to a bucket: the plan says what the move then does.** Before
  it starts, the move said how many of the repository's files would stay
  behind, and it counted only some of the reasons: a file used by the site's
  code or by one of Galley's page templates (which a move never changes) was
  not counted until the move had run. On a starter the plan could say 30 of 31
  files would stay "still mentioned in" one file, and the result that all 31
  had, naming eight. The plan now takes the move's own steps without changing
  anything, so it gives the same count and names the same files as the result:
  how many copies are removed, how many stay, and the files that still
  mention them (the window names five and counts the rest; `galley media
  move` prints them all). The result names them too, where it used to stop
  at the first reason.
- **Looking at the code host runs none of the repository's own hooks.**
  Bringing newer versions in already ran none. The look before it did: git
  has one hook for it (`reference-transaction`), and a repository that has
  one saw it run every few minutes on a hosted editor, whenever Version
  history opened, and before a publish that then published nothing. A look
  runs no hook now, wherever the app makes it. Publishing still runs the
  site's own checks.
- **Undo of a publish no longer offers publishing while newer versions
  wait.**
  With unpublished changes to a file the undo would change, it said
  "Publish or discard those changes first". While the repository has newer
  versions, publishing is paused, so it now says to discard them (Proof
  shows them, so what you wrote can be copied first), get the latest
  versions, then try again. With nothing newer waiting it says what it
  said.
- **An undo made while newer versions wait no longer sends this copy and
  the repository separate ways.** An undo is a version of its own. Made on
  top of an older copy, the code host refused it, and the two then had to be
  brought together by a developer. Undo now looks first, as Publish does,
  and pauses while nothing has changed: "The repository has newer versions
  than this copy, so the undo is paused. Get the latest versions, then try
  again." The paused answer carries `behind`, as a paused publish's does.
- **Connecting a bucket no longer sets back a setting someone else just
  saved.** Connecting, changing or disconnecting a bucket or Cloudflare
  Images saved the whole settings file from an earlier read of it, so a key
  somebody else saved in between was put back to what it had been. They now
  save over the version they read, as Site settings, putting the site
  online and hosting the editor do: when the file changed in between, it is
  read again and the change is made to what is there.

## 0.4.0 — 2026-11-25

### Added

- **Media in a bucket.** A site can keep new pictures, PDFs and videos in a
  Cloudflare R2 or Amazon S3 bucket instead of its repository (Media › Keep
  media outside the repository, or `galley media connect`). Galley does the provider's
  steps with you, then checks for real before saving — it stores a tiny test
  picture, reads it back, lists, loads it from the public address and removes
  it — and says what to change when a step fails. Pages store each file's full
  address; names never overwrite; Proof lists what was put in the bucket since
  the last publish; a file's details say which pages use it; deleting from the
  bucket is refused while any page, published or not, uses it. Files move to
  the bucket and back, and to a new public address, safely and repeatably
  (`galley media move`). New configuration key `media.storage`; new routes
  under `/api/sites/:siteId/media/storage` and `/api/media-storage`, and
  `GET /api/sites/:siteId/media/usage`; `GET /api/sites/:siteId/media` may
  also answer `storeProblems`, and `GET /api/sites/:siteId/changes`
  `storeUploads` and `storeUploadsProblem`. Cloudflare R2 has been run end
  to end on the real service (2026-11-25, with
  `scripts/rehearse-media-storage.mjs`); Amazon S3 and other S3-compatible
  stores have not yet, and are checked against stand-ins.
- **Pictures in Cloudflare Images.** Beside a bucket or the repository, a
  site's pictures can go to Cloudflare Images, which resizes them and sends
  each browser WebP or AVIF (Media › Keep media outside the repository ›
  Cloudflare Images, or `galley media connect --connector cloudflare-images`).
  Files it doesn't take — PDFs, video, anything over 10 MB — go to the bucket
  or the repository, and each upload in Media says where it went. It can use the
  site's Cloudflare key for putting it online when that key has Cloudflare
  Images › Edit. New configuration key `media.images`; new routes under
  `/api/sites/:siteId/media/images`. Not yet run against the live service.
- **Make the bucket for me** (Cloudflare R2): with the site's Cloudflare key
  for putting it online (it needs Workers R2 Storage › Edit), Galley makes
  the bucket and its r2.dev address; the key for its files is still made by
  hand. Another S3-compatible store (Backblaze B2, Spaces, Wasabi, MinIO) is
  one of the four choices.
- **Themes for the editing app.** Quiet stays the default; **Plate** and
  **Desk** ship beside it, and anyone can make their own. A theme is a small
  file (five colours per mode and four switches; `brand/themes/README.md`)
  and changes the app only, never a site. The light/dark control is now
  called the *appearance*, and the theme picker sits beside it wherever it
  appears (the sidebar's foot, the sign-in and first-run screens), each
  theme drawn as a swatch. **App settings › Themes** makes a theme from any
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
  undo, a restore, a connect or other git work is under way, and while the
  assistant is working on the site (`AgentRuntime` gains `working(siteId)`)
  or the preview is installing its packages. In those two cases it still
  asks the code host what is new, so "Newer versions are waiting" stays
  true. Looking holds no save back: it asks outside the lock every save
  takes, and a round uses a look that is already going. It logs one line
  when versions come in or a look fails in a new way; rounds skipped for 30
  minutes running are logged once, with the reason, and once more when
  they run again. A restore waits for a round in progress before it closes
  the site. `galley serve` prints how often it looks. The desktop app and
  local mode never look by themselves.
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
  seconds. A running server that finds another server's hold on its folder
  stops by itself: it answers nobody, writes nothing more to the folder,
  says why, and `galley serve` exits 1. The hold is written whole or not at
  all, so a write that fails (a full disk) leaves the hold that was there,
  and a hold file that can't be read is written again, never taken for
  another server's. Local mode and the desktop app take no hold.
- **Names say who someone is.** A person's name is kept without characters
  a reader can't see (the controls that reorder text, characters with no
  width, blank fillers), and a name that reads as someone else's on the same
  editor — in another case or width, or with unseen characters in it — is
  refused wherever someone signed in sets a name. Someone accepting an
  invitation with such a name is let in without it and asked to choose
  one, so an invitation link says nothing about who is here. Until they
  have, they can't publish, undo a publish, send or get the latest (*Choose
  your name first…*), and anything they would record carries their e-mail
  address in the name's place, never the install's publishing name. Names
  saved
  before are cleaned when they are read, and a publishing name (the
  install's, App settings › You, a site's own author) is kept the same way.
  Names that were alike before stay until one of them changes. Look-alike
  letters from different alphabets are not caught.
- **The event stream keeps to its readers.** On a hosted editor one account
  may hold 16 streams open (16 windows of the editor; the operator's token
  counts as one identity). One more is told so in a new event,
  `stream.limit`, on a stream that then ends; the app shows it ("Live
  updates paused — too many windows open") and asks again until a place is
  free. At most once in 10 minutes the newcomer is let in instead and the
  account's other streams are ended, so windows that went without a word (a
  closed laptop) give up their place while the ones still there connect
  again. A stream whose reader has stopped reading is ended once 1 MB is
  waiting for it, not counting one event larger than that by itself; the app
  connects again and reads everything afresh, as after any drop.
- **Version history tells the truth about the repository.** It looks when
  it opens, says "Checking the repository…" until it knows, and then says
  when it last checked; it no longer says "In step" on the strength of what
  was last fetched, however long ago. It says plainly when it couldn't look,
  when newer versions are waiting and who can bring them in, and when the
  two have gone separate ways. People who open it together share one look.
  A hosted editor's status bar says "Newer versions are waiting" while they
  can't come in by themselves.
- **Getting the latest restarts the preview properly.** A running preview
  is stopped before newer versions change the files, the dev server's saved
  content store is removed, and the preview starts again — a dev server that
  saw a page and its schema change together under it went on showing the
  old entry, through any number of restarts. **Restart preview** removes
  that store too when the copy has moved to another version since the
  preview started. Newer versions that change `package.json` or a lockfile
  make the next start install the site's packages first. A preview that is
  installing is left to finish: a hosted editor's round waits for it, and
  Get latest says to try again once it has. A Start pressed while newer
  versions are coming in waits until the files are in, and the preview says
  so; when stopping the preview fails, it is still started again.
- **Bringing newer versions in runs none of the repository's own hooks**,
  and starts none of git's background tidying. That is so wherever the app
  runs: a hosted editor's own round, and **Get latest** when you press it
  on your own computer or in the desktop app. A `post-merge` hook no longer
  runs when versions come in through the app (it still does when you pull
  in a terminal). The usual reason for one is covered: when the newer
  versions change `package.json` or a lockfile, the preview installs the
  site's packages before it starts again. Publishing still runs the site's
  own checks.
- **Get latest** no longer starts when it can already tell git would refuse:
  it says which files with unpublished changes the newer versions change.
- **A quieter, more finished look, in the app and on the site.** Sheets rest
  on the desk, controls are pressed into the paper, and only menus and
  dialogs float. Pills are for buttons; chips, tags and counts are small
  rectangles and stamps. Blue Pencil marks the action, the current place and
  the fields where the assistant writes. Labels are words in sentence case
  instead of small capitals. The page preview sits on a tan table, like the
  captures on the site. Nothing moved: layout, wording and behaviour are
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
  is as it was.
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

- **One focus ring, not two, on the boxes where you ask the assistant.** On a
  site's home the text field drew its own ring inside the box's ring, and
  tabbing to the send button drew a second one there and in the editor's
  assistant. The box now shows the focus for its text field only, and a
  button in it keeps its own.
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
  is left as it is, and the reply says which pages those are. A page the
  reply moved goes back as a pair or stays as a pair, never the page twice.
  The same holds for **Undo** after Search and AI fixes. `POST …/threads/:threadId/undo`
  and `POST …/visibility/undo` answer `{ restored, left }`, and a chat
  message gains `undoLeft`.
- **Get latest no longer holds up saves while it asks the code host.** It
  asked while holding the lock every save takes, so a code host that was
  slow to answer stalled saving for up to two minutes at a time. It now
  asks outside that lock, which is taken only for the moment newer versions
  change the files. Publishing, undoing a publish and sending still hold
  saves for as long as sending to the code host takes.
- **An edit never lands on top of text that was replaced under it.** An
  edit to an entry is written only over the text it was worked out from.
  When a discard, newer versions coming in, an undone publish, an undone
  reply or an edit from outside the app rewrote the file first, the edit is
  worked out again from what is there now; an edit that said which version
  it had open is refused, as before, so the person reopens it. The same now
  holds for the redirects list and the host's redirects file, the site
  kit's settings, the stylesheet a brand is applied to, and the site's own
  settings file: Site settings, putting the site online and hosting the
  editor each save their keys over the version they read, so a key someone
  else changed in between is not set back. `SiteService.saveConfig` and
  `deleteEntry` take a `baseHash`; `GET /api/sites/:siteId/config` answers
  the file's `hash`, and `PUT` takes it back as `baseHash` (409 when the
  file has changed since).
- **The assistant changes only what it has read, as it read it.** It
  changes an entry, replaces a file or saves the site's configuration only
  if it has read it in the conversation and it is still that version;
  otherwise nothing is changed and it reads again. An entry it has read is
  deleted only while it is still that version. A file that is already
  there and can't be read as text (a picture, a font) is not replaced, and
  the assistant is told so plainly. Its edits are never
  worked out again on newer text. What a conversation has read is
  remembered from one reply to the next, so versions that come in between
  two replies are not written over from the first one's reading.
- **A preview whose install was cut short installs again.** When the
  preview was stopped during an install, or the install failed, the next
  start installs again even though the packages folder is already there.
- **Get latest speaks for itself.** A refused Get latest (unpublished
  changes in the way, or the two having gone separate ways) answers 409
  `conflict` rather than 500. One that couldn't reach the code host answers
  502 and no longer borrows the words of a failed publish, bringing
  versions in that took too long no longer blames the connection, and the
  words for a site with no repository or code host no longer speak of
  fetching.
- **Publish and Get latest no longer send you to each other.** When the
  repository had newer versions that changed a file with unpublished
  changes here, Publish said to get the latest and Get latest said to
  publish. A refused Publish now names the file and the way out that works:
  discard that change (Proof shows it, so what you wrote can be copied
  first), get the latest, then make the change again. It offers **Review in
  Proof** in place of a **Get the latest** that would be refused, and so
  does Version history; Get latest and a hosted editor's log no longer
  offer publishing as a way on. The refusal is headed "Publishing is
  paused" and speaks of the repository, where it said "The live site has
  newer changes". `PublishResult` gains `inTheWay`.
- **Technical details never carry what signs in to an address.** The part
  of an address that signs in is removed wherever the address appears in a
  message, not only at its start, and from every failed git command's
  details: a password in any kind of address (one containing an `@` too),
  a query value named as a token, key, secret or signature, and GitHub's
  and GitLab's own key formats wherever they appear.
- **`galley serve`** says which site it has when that site has no
  repository behind it, instead of "not connected yet". A temporary copy of
  the install's state file, left behind when the server was stopped in the
  middle of a write, is removed at the next start.
- **Undo, in the cases that were left.** A change a reply made after it had
  ended is no longer passed over in silence: it is left and named. An undo
  that can't put a file back puts back the rest, names that file and says
  what it put back, instead of stopping half-way. Undoing a reply made in
  build mode needs the level build mode needs: a contributor reads *Your
  account can't undo this reply: it changed the site's code and templates
  (build mode). Ask an owner or an editor of this editor.* in the Undo
  button's place (a chat message gains `mode`).

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
