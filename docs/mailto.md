# Email links

On every site built with Galley, an email link doesn't just fire `mailto:`.
Plenty of visitors have no mail program set up, or use one in the browser, so
clicking an address either does nothing or opens an app they never use.
Instead, activating a `mailto:` link opens a small dialog next to it:

- **Send with Gmail** — Gmail's compose window in a new tab
- **Send with Outlook** — Outlook on the web's compose window in a new tab
- **Open my mail app** — the original link, exactly as written
- **Copy address** — copies the address (“Copied” is announced)

The address is shown in the dialog and can be selected. Recipients, `cc`,
`bcc`, the subject and the body of the original link are carried into every
option.

It is part of `@galley/astro` and **on by default**: the integration adds it
to every page that has an email link; the vendored kit adds it through
`<Scripts placement="body-end" />`.

## How it behaves

- Without JavaScript the link is an ordinary `mailto:` link.
- A modified click (Ctrl/⌘, Shift, Alt), a middle click, the context menu, a
  link with `download`, and a click something else already handled are left
  to the browser. In the editor's click-to-edit mode the overlay takes clicks
  first, so the dialog never fights the editor.
- Enter or Space on a link opens it; focus moves to the first action. Arrow
  keys (and Home/End) move between actions, Tab works as usual. Escape, a
  click outside, or the × button closes it and returns focus to the link.
  Clicking the link again closes it. One dialog at a time.
- It is a non-modal `role="dialog"` named “Email kim@example.com”, not a
  `menu`: besides the four actions it holds the address (selectable text) and
  a `role="status"` line for “Copied”, which a menu may not contain.
- It sits under the link (above when there's no room below), stays inside the
  viewport, follows the link as the page scrolls, and becomes a bottom sheet
  on screens narrower than 32rem. It is `position: fixed`, so nothing on the
  page moves. It has no animation.
- Links added later (a form's thank-you message, Markdown content) work too:
  one click and one keydown listener on the document do nothing until an
  email link is activated; the styles are added the first time it opens.

**Remembering a choice** ("always use Gmail") is left out on purpose: it would
need a stored preference treated under the consent settings and a way to undo
it inside the dialog — more than a four-item choice is worth.

## The addresses

| Option | Opens |
| --- | --- |
| Gmail | `https://mail.google.com/mail/?view=cm&fs=1&to=…&cc=…&bcc=…&su=…&body=…` |
| Outlook | `https://outlook.office.com/mail/deeplink/compose?to=…&cc=…&bcc=…&subject=…&body=…` |
| Outlook.com (optional, `"outlook-live"`) | `https://outlook.live.com/mail/0/deeplink/compose?…` (same parameters) |
| Mail app | the link's own `href` |

Reading the link follows RFC 6068: recipients before `?` and in `to=`
(comma-separated, all kept), header names in any case, percent-decoded UTF-8,
`+` is a plus sign (as in `kim+news@example.com` or `1+1`), CRLF becomes a
line break, a broken escape is kept as written. Values are written back with
`encodeURIComponent` — spaces as `%20`, never `+`, which Outlook on the web
would otherwise show as plus signs.

Neither Google nor Microsoft documents these compose addresses. The Gmail
form (`view=cm&fs=1`) is the long-standing one; a newer form
(`/mail/u/0/?tf=cm`) is reported to work too
([notes, 2024](https://til.simonwillison.net/google/gmail-compose-url)). The
Outlook deep link is the one Microsoft's own answers use
([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/4619953/want-to-pre-populate-to-cc-subject-body-by-passing),
[Tech Community](https://techcommunity.microsoft.com/discussions/microsoft-365/outlook-deeplink-for-email-compose-replaces-spaces-with--when-user-not-logged-in/4111903));
`outlook.office.com` serves work and school accounts, and personal accounts
are expected to be sent on to Outlook.com when they sign in — not verified.
A site whose visitors are mostly personal Outlook.com users can offer
`"outlook-live"` instead of (or as well as) `"outlook"`. Checked 2026-11-23.

## Turning it off, choosing the options

With the integration:

```js
galley({ mailto: false })                                          // off for the whole site
galley({ mailto: { options: ["gmail", "outlook", "app", "copy"] } }) // remove or reorder
```

Vendored: `src/galley/settings.json` →
`"mailto": { "options": [...], "strings": {...} }`, or `"mailto": false`.

One link (or everything inside an element): `data-galley-mailto="off"`.

With `mailto: false` the integration adds nothing to the build (byte-identical
output — tested).

## Theming

Structural CSS only, inheriting the page's font:

| Property | Default |
| --- | --- |
| `--galley-mailto-bg` | `Canvas` |
| `--galley-mailto-text` | `CanvasText` |
| `--galley-mailto-border` | a neutral grey at 40% |
| `--galley-mailto-radius` | `0.5rem` |
| `--galley-mailto-shadow` | a soft shadow |
| `--galley-mailto-hover` | a neutral grey at 13% |
| `--galley-field-focus` | `Highlight` (the focus ring, shared with forms) |

Parts: `.galley-mailto` (`[data-sheet]` on narrow screens),
`.galley-mailto__address`, `.galley-mailto__options`, `.galley-mailto__option`
(`[data-option="gmail|outlook|outlook-live|app|copy"]`),
`.galley-mailto__status`, `.galley-mailto__close`. The `astro-saas` starter
maps it in three lines:

```css
.galley-mailto {
  --galley-mailto-bg: var(--color-surface);
  --galley-mailto-text: var(--color-text);
  --galley-mailto-border: var(--color-border);
  --galley-mailto-radius: var(--radius-m);
  --galley-mailto-shadow: var(--shadow-raised);
  --galley-field-focus: var(--color-accent);
}
```

## Wording

Every word is a string you can replace (`mailto.strings`):

| Key | Default |
| --- | --- |
| `label` | Email {address} — the dialog's accessible name |
| `labelNoAddress` | Write an email |
| `gmail` | Send with Gmail |
| `outlook` | Send with Outlook |
| `outlook-live` | Send with Outlook.com |
| `app` | Open my mail app |
| `copy` | Copy address |
| `copied` | Copied |
| `copyFailed` | Couldn't copy. Select the address above instead. |
| `close` | Close |

The starters keep every string in `src/data/site.json` → `labels`; they map
them by adding a `labels.email` block there and passing it as
`mailto.strings` (integration) or copying it into
`src/galley/settings.json` (vendored).

## Size

2.6 KB gzipped, styles and wording included, inlined once before `</body>`
on pages that have an email link (`node packages/astro/scripts/size.mjs`).
