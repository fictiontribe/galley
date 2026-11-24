---
title: "Themes for the editing app"
navTitle: "Themes (developers)"
description: "The theme contract, the legibility check and how it matches the CSS, where themes are kept and who may change them, the routes, sharing, the plugin contribution and galley theme."
group: "extend"
order: 5
---

<!-- Generated from docs/themes.md by apps/site/scripts/sync-docs.mjs. Edit that file, not this one. -->

> This page is [`docs/themes.md`]({repository}/blob/main/docs/themes.md) from the repository, rendered as it is. The person's version is [Themes: choose one, make one, share one](/docs/editing/themes/).

A theme changes how the editing app looks: its paper, its ink, its pencil, and
four fixed choices about materials. **Quiet** is Galley's own look and the
default; **Plate** and **Desk** ship beside it; anyone can make their own in
the app, save it, export it as a file, and propose it to the community.

A theme belongs to the app. It never changes a site, its repository or its
published pages, and the marketing site stays Quiet.

This page is for developers. The person's version is
[Themes: choose one, make one, share one](https://galley.fictiontribe.com/docs/editing/themes/).
The contract and the legibility rules are the art director's, in
[`brand/themes/README.md`]({repository}/blob/main/brand/themes/README.md); this page says how the
app implements them.

## The contract

A theme is a small JSON file, checked against
[`brand/themes/theme.schema.json`]({repository}/blob/main/brand/themes/theme.schema.json):

```json
{
  "$schema": "https://galley.fictiontribe.com/schema/theme.schema.json",
  "contract": 1,
  "id": "harbour",
  "name": "Harbour",
  "description": "One sentence.",
  "author": "Someone",
  "light": { "paper": "#F3F5F5", "ink": "#101A24", "pencil": "#00857A", "plate": "#121A20", "table": "#D7DDD9" },
  "switches": { "sidebar": "sheet", "assist": "ruled", "icons": "one-tone", "depth": "soft" }
}
```

- `contract` is `1`. `id` is 1–32 lower-case letters, digits and dashes.
  `name` is up to 40 characters, `description` 240, `author` 80, all plain
  text (no control or reordering characters); they are only ever shown as text.
- Five **seed colours** for `light`, and optionally for `dark`, each exactly
  `#RRGGBB`. With no `dark`, the dark colours are made from the light ones.
- Four **switches** from fixed lists: `sidebar` (`sheet` · `desk` · `plate`),
  `assist` (`ruled` · `washed`), `icons` (`one-tone` · `duotone`), `depth`
  (`soft` · `lit`). A missing switch is Quiet's choice.
- Nothing else. A file with any other key, a colour in any other form, or
  over 8 KB is refused before anything reads it further.

`parseTheme` (in `packages/core/src/themes/contract.ts`) is that strict reader.
The app's colour fields accept other forms people type (`rgb()`, `oklch()`,
`f6f4f0`) and turn them into `#RRGGBB` before they reach a theme.

### What a theme puts on the page

On `<html>`, and nothing else (`themeOnPage` in `core/src/themes/apply.ts`):

```css
html {
  /* the light seeds, after the check */
  --theme-paper: #F3F5F5; --theme-ink: #101A24; --theme-pencil: #00857A; --theme-plate: #121A20; --theme-table: #D7DDD9;
  /* the dark seeds, after the check (made from the light ones when the file has none) */
  --theme-dark-paper: …; --theme-dark-ink: …; --theme-dark-pencil: …; --theme-dark-plate: …; --theme-dark-table: …;
  /* only an ink the check tuned, for the mode on screen: --proof-insert, --proof-delete, --proof-change, --success, --warning, --danger, --info */
  /* only a people colour the check tuned, the same in light and dark: --person-1 … --person-12 */
}
```

and the attributes `data-look-sidebar`, `data-look-assist`, `data-look-icons`,
`data-look-depth` (the switches) and `data-look` (the theme's id,
informational).

Quiet exactly as it ships sets nothing: the CSS's fallbacks are Quiet.
Everything else is derived by `brand/tokens.css` §6–7 and
`packages/web/src/styles/themes.css`.

`data-theme` on the same element is the **appearance** (light, dark, or the
system's). The app keeps the two words apart: a *theme* is Quiet, Plate, Desk
or one someone made; the *appearance* is light, dark or "match my system".

## The legibility check

`checkTheme(input)` (`packages/core/src/themes/check.ts`) is the README's
rules as one pure function. It runs before any theme is shown, saved, shared,
listed from a plugin or read back from disk, and it never trusts its input:

1. **Shape.** `parseTheme`; refused with its words.
2. **Ranges.** Each seed is clamped into its OKLCH range, hue kept. A pencil
   with chroma below 0.06 is refused.
3. **Derive** every colour exactly as `tokens.css` does
   (`core/src/themes/derive.ts`): the accent rules of §2 (on-accent by
   luminance, the fill nudged out of the 0.175–0.2274 dead band, hover and
   pressed), the pencil ramp of §5 and the recipes of §6.
4. **Measure** the README's pairs in both modes (WCAG 2 contrast).
5. **Repair**, in 0.01 lightness steps, at most 60, staying inside each
   seed's range: the ink, then the pencil under button text, the plate, the
   table (and the ink again when the table is at the end of its range). Proof
   and status inks are tuned in lightness only and emitted as overrides.
   Each people colour must reach 3:1 as an outline on the light and the dark
   sheet; one that doesn't is tuned in lightness only, once for both modes.
6. **Report** each change as `{ mode, colour, from, to, kind, reason }`, the
   reason a sentence for a person ("Your paper was too dark for a light
   theme, so it was lightened from #CFCBC4 to #ECE8E0.").
7. **Warn**, changing nothing, when the pencil is within 25° of hue and 0.12
   of lightness of the insert, delete, change, success, warning or danger ink,
   and when the pencil's text colour is more than 0.15 lighter or darker than
   the pencil ("This pencil color is light, …").

The result is the theme as it will be applied: `theme` (the file with the
adjusted seeds; `dark` only when the file had one), `applied` (both modes,
every switch, the tuned inks), `adjusted`, `warnings`, `refused`, every pair
as measured (`measures`, shown under "Technical details" in the editor) and
every derived colour. A theme is saved and shared in its adjusted form, so a
saved theme checked again changes no seed.

What still fails after repair is refused, in words. With the contract's
ranges that is rare; it is what stops a theme that would make focus or the
current place invisible.

### The engine matches the CSS

`packages/web/test/themes/parity.browser.test.ts` applies Quiet, Plate, Desk
and the README's test themes (Fog, Lemon, Harbour, and one that tunes people
colours) to a page with `brand/tokens.css` and `styles/look.css`, in light and
dark, paints every derived colour, and compares the screenshot's pixels with
the engine's derivation: 33 colours plus the older accent tints and the
twelve people colours, within 2/255 a channel. It needs a Chromium through
`playwright-core`, which the repository doesn't depend on:

```sh
THEME_PARITY_PLAYWRIGHT=/path/to/a/project/with/playwright-core pnpm --filter @galley/web exec vitest run test/themes/parity.browser.test.ts
```

Without `THEME_PARITY_PLAYWRIGHT` it is skipped, and says so.

Where the README's reference numbers and the CSS differ, the CSS is what
ships and the engine follows it:

- The near-black on-accent text is `srgb-linear 0.0103`, which is `#1A1A1A`
  (the reference used `#030303`).
- The button's fill is nudged out of the dead band by `tokens.css` itself, so
  Harbour's pencil is not moved: white on its fill (`#008378`) is 4.62.
- Fog: the reference reported the ink as `#36322D` but kept moving it without
  saying so; the check reports both steps. The paper lands on `#ECE8E0`, the
  first hex colour inside the range (`#EBE7E0` is a hair under 0.93).

## Where themes live, and who may do what

| | Local mode and the desktop app | A hosted editor |
| --- | --- | --- |
| Built-ins (Quiet, Plate, Desk) | ship with the app | ship with the app |
| Community themes | bundled when the app was built | bundled when the app was built |
| Saved for everyone here | `<home>/themes/<id>.json` | `<data folder>/themes/<id>.json` (people who can **manage**) |
| Saved for me | — (one person: Save is for everyone) | this browser's storage (`galley.themes`), anyone signed in |
| Added by plugins | installed plugins | installed plugins |
| The theme a person sees | the default (App settings), one for the app | their own choice, kept in their browser; until they choose, the default |
| The default | `settings.json` → `appearance.look` | the same, set by people who can manage |

One theme for the app, not one per site: the app is the person's tool, the
sidebar is shared across sites, and a theme must never change a site.

A theme saved for everyone is checked on the way in and stored adjusted, and
checked again whenever it is read; a file edited by hand into something that
fails is left out. Up to 100 are kept. A built-in's id can't be taken.

The default is App settings' choice, else a white-label brand's `theme`, else
Quiet; a default that no longer exists (deleted, a plugin turned off) falls
through to the next.

**White-labelling.** A brand file may name a `theme` (the one the install
starts with) and an `accent`. The accent is the built-in themes' pencil, in
light and dark, so whichever built-in someone chooses carries the brand.
Themes people make keep their own pencil. The app no longer sets the accent
property on its own: the accent arrives as the theme's pencil, so themes and
the brand never fight over the same properties.

### Before the first paint

`packages/web/public/theme.js` runs before the app's styles paint, on every
screen the app opens on (sign-in, first run and one-time links included). It
applies the appearance from `galley.ui`, and the theme: the install's default,
which the server puts in front of the script it serves at `/theme.js`
(`self.galleyStart = { keeper, look }`), or, on a hosted editor where the
person has chosen their own, this browser's copy of it (`galley.look`). In
local mode and the desktop app the default is the person's choice, so it
always wins. Nothing is stored for someone who hasn't chosen. Only colours
that are exactly `#RRGGBB` and switches from their lists are applied; anything
else is ignored.

The default also goes out on `GET /api/meta` (`look`), to anyone: colours and
switches only, never a name, description or author.

## Routes

| Route | Level | |
| --- | --- | --- |
| `GET /api/themes` | edit | The themes saved here, the plugins', and the default's id |
| `PUT /api/themes/:themeId` | manage | Save for everyone (adding or replacing); 400 with the check's words when refused |
| `DELETE /api/themes/:themeId` | manage | Delete one saved here |
| `PATCH /api/settings` `{ appearance: { look } }` | manage | Choose the default (only a theme this install has) |

Every change sends `themes.updated` on the event stream; open browsers read
the lists and the default again. A person's own choice on a hosted install is
never sent anywhere.

## Sharing

- **Export** downloads the theme as `<id>.json`, adjusted. **Import** reads a
  file (8 KB at most), checks it, and opens it in the editor with the report
  before anything is saved.
- **Share with the community** opens GitHub's new-file page for this
  repository's [`themes/`]({repository}/tree/main/themes/) folder in a new tab, with the file name
  and contents in the address
  (`https://github.com/fictiontribe/galley/new/main/themes?filename=<id>.json&value=<the file>`).
  The person proposes it there with their own GitHub account. The app sends
  nothing itself and there is no Galley account.
- Themes in `themes/` and `brand/themes/` are checked by
  `packages/core/test/themes/check.test.ts`: a theme that would be refused or
  adjusted can't be merged. The app bundles `themes/` when it is built, so
  "Browse community themes" works offline.

## Plugins

A plugin may add themes with `themes: ThemeContribution[]` (theme files as
objects). Each is checked when the plugin is loaded: one that would be refused
is a problem (the plugin doesn't load), one the check would adjust is a
warning (ship the adjusted values). Only plugins installed for the app add
themes; a site's own plugin can't change the app. A saved theme with the same
id comes before a plugin's.

## Command line

```sh
galley theme list
galley theme check harbour.json
galley theme add harbour.json
galley theme use harbour
galley theme export harbour --out harbour.json
galley theme remove harbour
```

`check` prints the report and exits 1 when the theme would be refused. `add`
saves it for everyone who uses Galley on this computer or server.

## What a theme cannot change

The proof, status and people colours (the check may tune a lightness, never a
hue), shape, spacing, type and sizes, where colour may appear, that focus and
the current place are drawn, and the marketing site. See the README.
