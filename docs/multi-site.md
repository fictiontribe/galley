# Looking after many sites

For an agency lead, or anyone who looks after more than a handful of sites.
One copy of Galley keeps a list of every site you look after; each site
stays in its own folder, with its own version history, and opens on its own.
This page covers adding them, filing them by client, reading what each one is
waiting on, giving a client's site its own keys, how previews are kept from
slowing the computer down, and windows in the desktop app — and, plainly,
what isn't there yet.

## Adding the sites you look after

On the Sites screen, **Add sites › Add sites from a folder…** (or the first
screen's first button). Choose the folder that holds your sites — usually the
one your clients' repositories are cloned into. Galley looks one and two
levels down and lists everything that looks like a site:

- a folder with a framework's settings file (`astro.config.*`,
  `eleventy.config.*`, `hugo.toml`, `next.config.*`, `nuxt.config.*`,
  `svelte.config.*`, `docusaurus.config.*`), a `package.json` that depends on
  one of them, a Jekyll or Hugo layout, or Galley's own `galley.config.json`;
- never inside `node_modules`, hidden folders (`.git`, `.cache`…), build
  output, or a folder already recognised as a site;
- never through a link to a folder (links are counted and listed, not
  followed — a link can point anywhere).

Every new site is ticked; sites already in your list are shown but can't be
ticked again. Choose a group to file them under, then **Add N sites**. Adding
only puts them in the list — nothing in their folders changes, and nothing is
opened or read in depth. Each site is read properly the first time you open
it. The search stops after 4,000 folders, 400 sites or 15 seconds, and
**Stop looking** ends it at once.

Each folder added this way is checked exactly as **Open a folder** checks one
(it must exist, be a folder, not be your home folder, the disk itself, or the
app's own folder). The three other ways in are still there: open one folder,
clone a site, create a new one.

## Groups, pins and notes

- **Groups** are for clients. **New group** names one and gives it a colour;
  a group's menu renames, recolours, folds or removes it (removing a group
  never removes its sites — they become "Not in a group"). Drag a site onto a
  group to move it, or use the site's menu › **Move to group…**.
- **Pin** the sites you work on most: pinned sites come first in every group,
  first in the switcher, and take ⌘1, ⌘2… (Ctrl elsewhere).
- **Notes** are a line or two per site — "Dana is the contact; launch 12
  March". Search finds them.

Groups, pins and notes are kept with the list in the Galley home
(`~/.galley/sites.json`, or `GALLEY_HOME`). They belong to this computer;
they are not written into any site.

## What the chips mean

Each site shows what it is waiting on, most urgent first. A site with
nothing waiting says **Up to date**.

| Chip | Means | What to do |
| --- | --- | --- |
| **Folder missing** | The folder was moved, renamed or deleted outside the app. Nothing was deleted by Galley. | Open the folder from its new place, or remove the site from the list. |
| **N versions not sent** | Published here, but not sent to the site's host (the push failed or the computer was offline). | Open the site; the status bar offers **Send now**. |
| **N versions not live** | Published, but the site hasn't been put online since (for sites put online from Galley). | Open the site and put it online. |
| **N unread** | Form submissions nobody has read yet. | Open the site's inbox. |
| **N changes** | Edits waiting in Proof, not published yet. | Open the proof and publish, or discard. |
| **Preview running** | The site's preview is running on this computer. Not a task, just a fact. | — |

The list is ordered: pinned first, then by what is waiting, then by when you
last used each site. **Needs attention** shows only the sites with something
waiting; the status bar says how many there are on every screen and leads
there. Search looks at names, groups, notes, live addresses and folders;
filters narrow by group and kind of site. Cards or a compact list — your
choice is remembered.

The picture on each card is the site's own share image (the one it gives
social sites), when it has one in a usual place (`public/images/share.*`,
`public/og.*`…). A site without one shows its initials in its group's
colour. Galley never takes screenshots of your sites behind your back.

**How fresh is this?** A closed site's facts are read in the background a
moment after the list is shown, two sites at a time, and again when they are
more than five minutes old: two quick, read-only questions to its version
history, a small settings file, and the site's state in the Galley home.
Showing the list itself never waits for any of that, so it stays instant with
fifty sites. An open site's changes are always current.

## Switching between sites

- The site's name at the top of the sidebar opens the **switcher**: type to
  find a site (by name, initials, group or note), arrows and Enter to go.
  Pinned and recent sites come first, then the rest by group, each with its
  chips. In the desktop app, ⌘-Enter (Ctrl-Enter) opens it in a window of its
  own.
- **⌘K** (Ctrl-K) lists sites first when what you typed names one.
- **⌘1…⌘9** go straight to the pinned and most recently used sites (in a
  browser, where the browser doesn't keep those keys for its tabs).
- Each site **keeps its place**: the screen and page you were on, the pane
  sizes, the preview mode, and the assistant conversation. Switching back
  returns you there. This is kept in this browser (or the desktop app).

## A client's site with its own keys

Every site uses the keys in **App settings** unless it has its own. In a
site's **Settings › Connections** you can give it its own:

- the assistant's key (Anthropic),
- image keys (OpenAI, Google),
- the keys used to put it online (Cloudflare, Vercel — and any host added
  later, with no change here),
- and its own **publishing author** (the name and e-mail its versions are
  recorded under).

Each line says which one is in use — **This site's own key** or **The shared
key** — and its last four characters. Keys go in and never come back out: the
app is only ever told whether a key is set and how it ends.

**Who pays for what.** The site's own key is used for everything done on that
site — every assistant request, every generated image, every upload to a
host — so the client whose key it is is billed for their site's use and
nothing else. **Assistant use** on the same page, and the site's **Details…**
on the Sites screen, show what the assistant has cost on that site in the
last 30 days and in all (list prices, whichever key paid).

**The order keys are looked for in**, for every key:

1. the site's own key;
2. the key in the environment the app was started from
   (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`,
   `CLOUDFLARE_API_TOKEN`, `VERCEL_TOKEN`);
3. the shared key saved in App settings.

The environment sits between the two on purpose: it is how whoever runs
Galley pins the one key an installation shares, and App settings can't
override it (as before). A site's own key is the most specific choice there
is — set on purpose, for that one site — so it wins even over the
environment.

Where they are kept: `<home>/state/<site id>/secrets.json`, written whole
each time with permissions 0600 (readable by you only) — exactly like the
shared `<home>/secrets.json`. Each time a key is saved, the folder it is saved
in is set to 0700 as well. The Galley home folder itself is only made 0700 by
the server when it creates it, or once a shared key is saved there; until
then it can be 0755 (if something else created it), which is safe because
every file holding a key is 0600 whatever its folder. Removing a site from the list forgets its own keys and
author too (its folder is never touched).

## Previews when many sites are open

A site's preview is its own dev server — often a few hundred megabytes of
memory — plus two small proxies. Galley keeps that in check:

- **At most 3 previews run at once** (App settings › Previews; 1 to 12). When
  one more starts, the one used longest ago stops.
- **A preview nobody uses for 20 minutes stops** (5 minutes to 4 hours).
  "Used" means a page viewed in it, or an editor open on its site.
- A stopped preview **starts again when you come back** — the preview pane
  says "Waking the preview…" with the usual progress.
- A preview is never stopped while it is starting, or while its site is being
  built, published or put online.
- Sites that are only listed cost nothing: no process, no file watcher, no
  index until you open one. A site you opened but haven't touched for an hour
  is closed again (its watcher and index released) and reopens when you
  return.

Measured on a laptop with ten sites in the list: the server alone uses about
170–210 MB; each running Astro preview adds two processes and about
370–420 MB. With the default limit the previews stay under about 1.2 GB
whatever you open.

## Sites in their own windows (desktop app)

- **Open in a new window** from a site's menu on the Sites screen, ⌘-Enter in
  the switcher, ⌘-click on a site's name, or **File › Open site in new
  window…**. **File › New window** opens another window on the Sites screen.
- Each window is titled with its site, has its own place, and is exactly as
  locked down as the main one (the same three native actions: choose a
  folder, open a web link, show a site's folder).
- Windows are remembered: the site windows open when you quit reopen next
  time, at their size and position.
- **File › Open recent** lists recent sites (**Clear** empties it); the
  **Window** menu lists open windows; on macOS the Dock icon's menu lists
  recent sites.
- Drop a site's folder on the Dock icon, or follow a
  `galley://open?path=/path/to/site` link, to add and open it — checked
  exactly as a folder chosen in the picker.
- Closing the last window quits; every preview and the server stop with it.

## Working as a team today

Each person has their own Galley and their own copy of each site's
repository, cloned from the same place (GitHub, GitLab…). Git is what keeps
everyone in step: you publish, a colleague's Galley shows the new version
after they pull (or their copy is behind until they do). Galley never forces
or rewrites anything, so two people working on one site can't silently
overwrite each other — at worst one of them is asked to bring their copy up
to date first. Groups, pins, notes and per-site keys live on each person's
computer; share keys the way you share any key.

A **hosted install** (`galley serve`, one container) serves several people
from one place — for **one site**: its checkout on the server, everyone
signing in with the same password. Ten sites are ten installs that share
nothing; the list of many sites is the desktop app's
([`docs/cloud-install.md`](cloud-install.md)).

## Not there yet

- **Accounts.** There are no user accounts: a hosted install has one password
  for everyone; a local one belongs to whoever uses the computer.
- **Roles and permissions per site.** Anyone who can open Galley can open,
  edit and publish every site in its list. Restrict who can publish with your
  git host's branch protection (Galley's pull-request mode sends changes for
  review instead of publishing).
- **A shared list across computers.** Groups, pins, notes and the list
  itself are per installation.
- **The OS keychain.** Keys are kept in files readable only by you, not yet
  in the keychain.
