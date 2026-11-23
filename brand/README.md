# Galley — brand

**Prompt it. Proof it. Publish it.** · The AI CMS for static sites · Galley by Fiction Tribe

A *galley proof* is the preliminary printing of a text that editors mark up
before it goes to press. That is the product: every change is a proof before
it is published. The brand is built from that one idea — a set page on warm
paper, printing ink, one blue pencil, and the precise marks of a proofreader
in the margin.

Open **[specimen.html](specimen.html)** to see everything below working (it
runs offline; use the header to switch theme and test other accents).

| File | What it is |
| --- | --- |
| [tokens.css](tokens.css) | **Source of truth.** Every colour, type, space, radius, shadow, layer, motion and layout token; light, dark and system themes; measured contrast in comments. |
| [tokens.json](tokens.json) | The same values as data (generated from `tokens.css`; colours resolved to hex per theme). |
| [components.css](components.css) | `g-` prefixed components on the tokens. Import directly into the web app. |
| [specimen.html](specimen.html) | The visual contract: every component, the proof marks, a miniature app frame. |
| [logo/](logo/) | Mark, wordmark, lockups, favicon, app icon, social card — and [construction rules](logo/README.md). |
| [voice.md](voice.md) | How the product talks; vocabulary; 32 before → after strings. |
| [positioning.md](positioning.md) | Descriptions, headlines, audiences, features → benefits, comparisons, FAQ, boilerplate. |
| `fonts/` | Latin-subset woff2 files for the specimen only, with their OFL licences. The app installs the npm packages. |

---

## Personality

| Trait | This | Not that |
| --- | --- | --- |
| **Exact** | Says what changed, word for word, in content terms. "Home › Hero › Heading." | Vague reassurance. "Your content has been updated!" |
| **Calm** | Nothing is live until you say so; everything can be undone; errors say your work is safe. | Alarm, red walls, modal panic, exclamation marks. |
| **Plain** | Publish, Changes, Proof, Discard, Undo, Version history. | commit, diff, checkout, revert — or cute jargon of our own. |
| **Crafted** | The care of a set page: real typography, real proof marks, hairlines that line up. | Generic SaaS: gradient blobs, glassy cards, icon-in-a-rounded-square grids. |

Kin to the parent (Fiction Tribe): warm paper, near-black ink, one electric
accent, pill buttons, mono labels, punchy copy. Galley's own: the proofing
metaphor, a serif set page, the blue pencil, and marks instead of boxes.

---

## Visual principles

1. **Paper and ink carry the interface.** Warm newsprint `#F6F1E7`, printing
   ink `#1A1712`. Never pure white pages, never pure black.
2. **One blue pencil.** The accent (`#2E2BFF`) marks the action (Publish) and
   where you are (current nav item, focus). It is not decoration.
3. **Marks, not boxes.** Changes are shown the way editors mark a proof — a
   tint like a highlighter plus a mark that carries the meaning. Colour is
   never the only signal.
4. **The page is set; the margin is precise.** Content and proofs are set in
   the serif; the interface runs in a quiet sans; labels, keys and counts are
   mono — like a typesetter's notes, never handwriting.
5. **Square paper, round buttons.** Surfaces are nearly square (2–6 px). Things
   you press are pills.
6. **Hairlines and restraint.** 1 px rules, low shadows, tight 13 px UI. Crop
   marks, ruled baselines and column guides appear where they explain something
   (the preview, empty pages, marketing) — not as wallpaper.
7. **The logo is never load-bearing.** It sits in a fixed slot; any
   deployment's logo or plain name fits.

---

## Logo

Two lines of set type, the lower one opened by a proofreader's caret — *a
change is being inserted and hasn't gone to press.* Ink bars, Blue Pencil
caret; reverse on dark; one colour (`currentColor`) anywhere else. Clear space
is one bar-pitch (¼ of the mark's width); minimum 16 px for the mark, 80 px
wide for the lockup. Never set "galley" in a font. Full rules:
[logo/README.md](logo/README.md).

## Colour

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Paper | `#F6F1E7` | `#16140F` | App background |
| Raised / sunken / overlay | `#FDFAF4` / `#EDE6D8` / `#FFFCF7` | `#201D17` / `#0F0D0A` / `#27231C` | Panes & inputs / wells & preview table / menus, dialogs |
| Ink · secondary · tertiary | `#1A1712` · `#514A3F` · `#6B6356` | `#F2ECE1` · `#BDB3A3` · `#968C7C` | Text. All ≥ 4.5:1 on every surface. |
| Border strong | `#857B69` | `#7A7162` | Input and control edges (≥ 3:1) |
| **Accent — Blue Pencil** | `#2E2BFF` | `#2E2BFF` fill / `#A4A1FF` text | Primary action, current place, focus |
| **Insert** | `#0B6E55` | `#5FD0AE` | Added — solid underline + caret ‸ |
| **Delete** | `#B8361A` | `#FF8A6B` | Removed — strike-through + dele loop |
| **Change / move** | `#8E3A7A` | `#E58BD0` | Changed or moved — dashed underline + transpose ∽ |
| Success · warning · danger · info | `#2D6A2E` · `#8A5800` · `#A8233A` · `#2E5A8C` | `#8BCF7A` · `#E7B44C` · `#FF7D8F` · `#8DB8F0` | Status. Each has `-tint` and `-ink`. |

The proof trio comes from the Okabe–Ito colour-blind-safe set (bluish green,
vermilion, reddish purple) and is always paired with its mark. Proof and
status colours do **not** follow the accent.

### White-labelling

Set one property:

```css
:root { --accent: #00A86B; }
```

Everything else re-derives (in `tokens.css` §2): fill, hover, pressed, tints,
guide lines, focus ring, and accent-as-text. **On-accent text is chosen by
luminance**: near-white when the accent's relative luminance is below 0.199,
near-black above — the crossover where both give equal contrast. Accents in
the dead band (luminance 0.175–0.227, where neither reaches 4.5:1) get their
fill nudged just out of it; every other accent renders exactly. Hover and
pressed move *away* from the text colour, so contrast only increases.
Accent-as-text is clamped in OKLCH lightness (≤ 0.45 on light, ≥ 0.76 on
dark). Verified over 251 accents: on-accent ≥ 4.59:1, accent text ≥ 4.83:1
(light) and ≥ 7.04:1 (dark).

This uses CSS relative colour syntax (Chrome/Edge 119+, Safari 18+, Firefox
128+). Older engines fall back to white on-accent text and the raw accent —
correct for dark accents such as the default; with a light accent there,
also set `--accent-on` and `--accent-text` by hand.

Override `--accent` on `:root`, on an element with `[data-theme]`, or on
`.g-scope` — derived values are computed where they're declared.

## Type

| Role | Family | npm package (self-host; never a font CDN) |
| --- | --- | --- |
| Display & proof | **Newsreader** (variable, optical sizes) | `@fontsource-variable/newsreader` → `opsz.css`, `opsz-italic.css` |
| Interface | **Figtree** (variable) | `@fontsource-variable/figtree` → `wght.css` |
| Labels, keys, counts | **IBM Plex Mono** 400/500 | `@fontsource/ibm-plex-mono` → `400.css`, `500.css` |

All OFL-1.1. App scale is fixed: 11 mono labels · 12 meta · **13 UI base** ·
**14 inputs and chat** · 16 · 20 and 26 display titles. Marketing display
sizes are fluid (`--display-sm` … `--display-xl`, 28 → 112 px). Newsreader is
set at 400–500 with italic for emphasis; Figtree at 400/500/600; mono uppercase
labels track +0.08em.

## Proof marks

| Mark | Class | Means |
| --- | --- | --- |
| Caret ‸ | `.g-mark--caret`, `.g-ins` | Inserted / added / edited |
| Dele | `.g-mark--dele`, `.g-del` | Deleted / removed / discard |
| Transpose ∽ | `.g-mark--transpose`, `.g-chg` | Changed or moved |
| Stet ··· | `.g-mark--stet`, `.g-dots` | Let it stand: unchanged, working, waiting |
| Registration ⌖ | `.g-mark--reg` | In register: published, live, in sync |
| Pilcrow ¶ | `.g-mark--pilcrow` | A paragraph or body block; empty pages |

Marks are CSS masks — they take `currentColor` and need no icon font. In
markup, pair every inline diff with hidden words for screen readers:
`<ins class="g-ins"><span class="g-sr">Added: </span>text</ins>`.
In forced-colours mode the tints drop away and real underline/strike
decorations take over.

## Motion

Fast and calm: 140 ms for hover and colour, 200 ms for menus and toasts,
320 ms for panes and dialogs; expo-out for entrances. The signature is the
**ink-in** — new proof marks draw left to right in 480 ms
(`.g-ink-in`). Nothing bounces. `prefers-reduced-motion` zeroes every duration.

---

## For engineers

```ts
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource-variable/figtree/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../../brand/tokens.css';
import '../../brand/components.css';
```

```html
<html data-theme="system">          <!-- light | dark | system -->
  <body class="g-root"> … </body>
```

- Use tokens, never raw hex. Use components, never re-invent a button.
- The brand name comes from `/api/meta`; logos render in `.g-brand__logo`
  (fixed 20 px height) with `.g-brand__name` as the fallback.
- **Checking contrast:** every intended pair is annotated in `tokens.css`. If
  you change a colour, re-measure (WCAG 2 relative luminance) and update the
  comment; `specimen.html` shows live ratios for the current theme and accent.

## Do / don't

**Do**
- Show every change with its mark *and* its colour.
- Keep one primary button per view — usually Publish.
- Put paths and keys in mono, under the human title.
- Use crop marks and guides where they frame the page being proofed.
- Keep the accent for action and place; let paper and ink do the rest.
- Write "Publish", "Changes", "Proof", "Discard", "Undo", "Version history".

**Don't**
- Don't use GitHub-style red/green boxes or `+`/`−` gutters in editor UI.
- Don't use the accent for decoration, illustrations or large fills.
- Don't put the proof colours on non-change UI (green ≠ "good", red ≠ "error"
  here — status colours exist for that).
- Don't use pure white pages, pure black, glassmorphism, gradient text or
  drop-shadowed buttons.
- Don't set "galley" in a typeface or use Gilroy anywhere; don't use the
  Fiction Tribe logo or wordmark.
- Don't hard-code the product name in UI strings.
- Don't load fonts from a CDN.
