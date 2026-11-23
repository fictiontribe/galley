# Galley logo

**The idea.** A galley proof is type set in a column, waiting for corrections.
The mark is two lines of that type, the lower one opened by a proofreader's
caret (‸): *something is being inserted, and it hasn't gone to press yet.*
Draw it from memory as: **a long bar, a broken bar, a caret rising into the
break.**

## Files

| File | Use |
| --- | --- |
| `mark.svg` | The symbol on light backgrounds. Ink bars, Blue Pencil caret. |
| `mark-reverse.svg` | The symbol on dark backgrounds (`#F2ECE1` bars, `#A4A1FF` caret). |
| `mark-mono.svg` | One colour, `currentColor`. Inline it to recolour. |
| `wordmark.svg` / `wordmark-mono.svg` | “galley” alone. Ink / `currentColor`. |
| `lockup.svg` | Mark + wordmark, light backgrounds. The default logo. |
| `lockup-reverse.svg` | Mark + wordmark, dark backgrounds. |
| `lockup-mono.svg` | Mark + wordmark, `currentColor` — on the accent, on photos with a scrim, in print. |
| `favicon.svg` | The mark with a `prefers-color-scheme` style: switches to the reverse colours in dark browser chrome. |
| `app-icon.svg` | 1024 × 1024 macOS-style icon: 824 px tile (100 px margin), 185 px corner, baked soft shadow, the mark set on its own non-repro guides inside crop marks. Feed it to `tauri icon`. |
| `social-card.svg` | 1200 × 630 Open Graph image with the three-beat line. |

All files are hand-built geometry: no raster, no embedded fonts, no `<text>`.
The wordmark and the social-card lettering are drawn from one monoline
construction (circles of radius 7.9, stems, a shared descender hook; stroke
4.2 on a 40-unit body), so they render identically everywhere.

## Construction

The mark is drawn on a **32-unit grid**; at 16 px every edge lands on a whole
pixel.

```
 y 6 ┌────────────────────────────┐   upper line   (x 2–30, 4 units thick)
 y10 └────────────────────────────┘
 y14 ┌─────────┐        ┌─────────┐   lower line, broken for 8 units (x 12–20)
 y18 └─────────┘   /\   └─────────┘
                  /  \               caret: apex at y 15.33 (inside the break),
 y26.76          /    \              legs 4 units thick, apex angle 78°,
                                     feet cut square to the stroke
```

- Bars are **4 units** thick with **4 units** of leading (bar pitch = 8).
- The caret's apex rises *into* the break; its feet stop about one bar-pitch
  below the line. A caret sits under the insertion point, never on it.
- In the lockup, the mark is scaled so its top bar meets the wordmark's
  ascender and the caret's feet meet the baseline; the gap between mark and
  wordmark is 11 units (about half an x-height).

## Clear space and minimum size

- **Clear space:** one bar-pitch on every side — 8 units of the 32-unit grid
  (¼ of the mark's width). For the lockup, use the wordmark's x-height
  (the height of the “a”).
- **Minimum size:** mark **16 px**; wordmark **56 px** wide; lockup **80 px**
  wide. Below 80 px use the mark alone.

## Colour

| Context | Bars + wordmark | Caret |
| --- | --- | --- |
| Paper / light | Ink `#1A1712` | Blue Pencil `#2E2BFF` |
| Ink / dark | `#F2ECE1` | `#A4A1FF` |
| On the accent, photos, print, one-colour | `currentColor` throughout | same |

When a deployment changes `--accent`, the in-app logo is replaced as a whole
by the deployment's own logo — Galley's mark is not recoloured to the new
accent. Inside the product the logo sits in a fixed 20 px-high slot
(`.g-brand__logo`) and nothing in the layout depends on its shape.

## Don't

- Don't set “galley” in a typeface. Use the drawn wordmark.
- Don't outline, gradient, shadow, glow or animate-bounce the mark.
- Don't rotate the caret, or point it anywhere but up — rotated, it becomes an
  arrow and stops meaning *insert*.
- Don't recolour the bars and caret with two non-brand colours; it's either
  ink + accent or one colour throughout.
- Don't stack the wordmark under the mark; the lockup is horizontal only.
- Don't use the Fiction Tribe mark or wordmark next to it as a co-logo. The
  maker credit is text: “Galley by Fiction Tribe”.
