# Galley themes

A theme changes how the editing app looks: its paper, its ink, its pencil, and
four fixed choices about materials. It is **data**: a small JSON file, checked
against [theme.schema.json](theme.schema.json). It holds no selectors, no CSS,
no sizes, so a theme can be shared as a file and can never break a layout.

Built in: **[Quiet](quiet.json)** (Galley's own look, and the default),
**[Plate](plate.json)** and **[Desk](desk.json)**. The marketing site is Quiet
only; themes apply to the editing app.

## The contract

```json
{
  "$schema": "./theme.schema.json",
  "contract": 1,
  "id": "plate",
  "name": "Plate",
  "description": "One sentence.",
  "light": { "paper": "#F6F4F0", "ink": "#1A1712", "pencil": "#2E2BFF", "plate": "#1C1915", "table": "#E3DBCD" },
  "dark":  { "paper": "#16140F", "ink": "#F2ECE1", "pencil": "#2E2BFF", "plate": "#0E0C09", "table": "#2B2620" },
  "switches": { "sidebar": "plate", "assist": "washed", "icons": "duotone", "depth": "lit" }
}
```

`dark` is optional (see *Dark from light*). `author` is an optional line.
Every switch is optional and falls back to Quiet's choice.

### Seeds — five colours per mode

| Seed | What it is | What is drawn from it | Allowed (OKLCH) |
| --- | --- | --- | --- |
| `paper` | The ground | Sheets, overlays, wells, borders, ink steps, the desk tone, the pencil's tints | light L 0.93–0.995 · dark L 0.14–0.27 · C ≤ 0.035 |
| `ink` | Text | Secondary, tertiary and disabled ink; every border; shadows' colour; text on the plate (dark mode) | light L ≤ 0.32, C ≤ 0.05 · dark L ≥ 0.90, C ≤ 0.04 |
| `pencil` | The accent | The button fill and its text, hover and pressed, pencil text, the 50–900 ramp, focus, selection, the current place | any hue, any L · C ≥ 0.06 |
| `plate` | A dark material | The plate sidebar and status strip, its inks, its current-place marker | L ≤ 0.28 (dark: ≤ 0.22 and below the paper) · C ≤ 0.06 |
| `table` | The proofing table | The ground under the preview | light L 0.80–0.93 · dark L 0.24–0.34 · C ≤ 0.06 |

The recipes are in [tokens.css](../tokens.css) §6, the single source. For
example, sheet = paper 30 % toward white, borders = ink 7–51 % into paper with
the ink's warmth kept, and pencil tints = the pencil's text colour 5–34 % into
the sheet. With Quiet's seeds, every derived value lands within 1.07:1 of
Quiet's hand-set values.

### Switches — fixed choices

| Switch | Values (first = Quiet) | What changes |
| --- | --- | --- |
| `sidebar` | `sheet` · `desk` · `plate` | `sheet`: the sidebar sits on the desk's edge and the current page is a sheet. `desk`: a toned desk, a real step darker than the page. `plate`: an inked plate with light type and the current place in pencil; the status line becomes a strip of the plate. |
| `assist` | `ruled` · `washed` | `ruled`: the assistant's fields are edged in pencil. `washed`: its fields, pane, request and suggestions are washed in pencil, selection and selected tabs take the pencil, and Proof becomes the pencil's home in the top bar. |
| `icons` | `one-tone` · `duotone` | `duotone`: icons in the sidebar, the palette and the collection lists draw their tint at rest (pencil-200; on the plate, mixed into the plate). |
| `depth` | `soft` · `lit` | `lit`: a crisp edge and a layered fall under sheets, lit and pressed buttons, recessed wells, the top bar as a band, stamps with a stronger edge. |

### What the app reads

On `<html>` (the app already sets `data-theme="light|dark|system"` and
`data-surfaces="app"`; theme names never use those):

| Name | Kind | Set to |
| --- | --- | --- |
| `--theme-paper` `--theme-ink` `--theme-pencil` `--theme-plate` `--theme-table` | custom properties | the light seeds, after the legibility check |
| `--theme-dark-paper` … `--theme-dark-table` | custom properties | the dark seeds, after the check |
| `--proof-insert` … `--info` (only when tuned) | custom properties | an ink the check had to tune (below) |
| `data-look` | attribute | the theme's `id` (informational; nothing is drawn from it) |
| `data-look-sidebar` `data-look-assist` `data-look-icons` `data-look-depth` | attributes | the switches |

Applying a theme sets exactly these and nothing else. Removing them all is
Quiet. The rules each switch drives are in
`packages/web/src/styles/themes.css`.

### Dark from light

When a theme has no `dark`, the app derives one (OKLab mixes), then checks it
like any other:

- paper = light ink 90 % toward black
- ink = light paper 75 % into the light table
- pencil = the same pencil
- plate = light plate 70 % toward black
- table = light ink 90 % into the light table

## Keeping every theme legible

One pure function, `checkTheme(theme) → { seeds, inks, adjusted[], warnings[], refused[] }`,
runs before any theme is shown, saved or published. It never trusts the file.

1. **Shape.** The file must validate against the schema. If not, it is
   refused, with the schema's error.
2. **Ranges.** Each seed is clamped into its range in OKLCH, keeping its hue
   (table above). A pencil with chroma below 0.06 is refused: it would not read
   as a colour against the ink.
3. **Derive** exactly as tokens.css §6 does. That includes the accent rules in
   §2: on-accent text is chosen by luminance, and pencil text is clamped to
   L ≤ 0.45 in light and ≥ 0.76 in dark.
4. **Measure** every pair below (WCAG 2 contrast) in both modes.
5. **Repair**, in this order, until every pair passes (at most 60 steps of
   0.01 L each):
   - ink pairs fail → move the ink seed's lightness away from the paper;
   - the button text fails on the pencil → move the pencil's lightness away
     from its text (darker under white text, lighter under black);
   - plate pairs fail → darken the plate seed;
   - table pairs fail → move the table seed's lightness away from the ink;
   - a proof or status ink fails on paper, sheet or well → move that ink's
     lightness (light: darker, dark: lighter), hue and chroma kept, and emit it
     as an override property.
6. **Report** each change as
   `{ colour, from, to, reason }`, worded for a person: *"Your paper was too
   dark for a light theme, so it was lightened from #CFCBC4 to #EBE7E0."*
   The editor shows these beside the colour they touch. Publishing stores the
   adjusted values, not the originals.
7. **Warn**, without changing anything, when the pencil's hue is within 25°
   and its lightness within 0.12 of the insert, delete, change, success,
   warning or danger ink: *"Your pencil is close to the delete colour; selected
   things may look like deletions."* The marks still carry the meaning.

### The pairs

| Pair | Minimum |
| --- | --- |
| ink on paper, sheet, well, overlay | 7 |
| ink-2, ink-3 on paper, sheet, well, overlay | 4.5 |
| ink on the table; ink-2 on the table | 7 · 4.5 (ink-3 is never set on the table) |
| ink-3 on the desk tone | 4.5 |
| strong edge (field boundaries) on paper, sheet, well | 3 |
| pencil text on paper, sheet, well, overlay | 4.5 |
| focus ring (pencil text) on paper, sheet, well, overlay; on the plate (pencil-on-plate) | 3 |
| button text on the pencil fill (and hover, pressed) | 4.5 |
| pencil-800 on pencil-100; ink on pencil-200 | 4.5 |
| selection tint (pencil-100) against the sheet | 1.1, so a selected row is visible as well as marked |
| pencil-400 (the assistant's ruled edge) on the sheet | 3 |
| on-plate on the plate · on-plate-2 · on-plate-3 | 7 · 4.5 · 4.5 |
| white on the current place on the plate | 4.5 |
| the current-place bar (pencil-on-plate) against the plate | 3 |
| each proof and status ink on paper, sheet, well (light and dark values) | 4.5 |

### The five test themes

These were run through the reference check on paper, from the recipes in
tokens.css §6.

| Theme | What the rules did |
| --- | --- |
| **Quiet** | Nothing. Lowest pairs: ink-3 on the well 5.07, the strong edge on the well 3.56, on-plate-3 on the plate 5.52 (dark: 5.89, 4.08, 5.87). |
| **Plate** | Nothing. It has the same seeds as Quiet; only the switches differ. |
| **Desk** | Nothing. ink-3 on the desk tone is 4.63 (dark 4.93). |
| **Fog** (paper `#CFCBC4`, ink `#6E6A64`: grey on grey, 2.9:1) | Paper lightened to `#EBE7E0` (it was L 0.84, below 0.93). Ink darkened to `#36322D` (it was L 0.53, above 0.32). On the paler well that this produced, delete was tuned `#B8361A → #B53216` and warning `#8A5800 → #875500` (lightness only), each reported. Everything else then passes: ink-3 on the well is 4.96, the strong edge 3.48. |
| **Lemon** (pencil `#F2E35C`, a pale yellow) | Nothing refused, nothing adjusted. The button keeps its yellow fill with near-black text (15.63). Pencil text, lines and tints come from the clamped pencil text (`#665600`, olive): text 7.06 on the sheet, ruled edge 3.0, pencil-800 on pencil-100 4.60, selection tint 1.16. It is legible but olive where you expect yellow; the editor should show that preview before saving. |

## What a theme cannot change

- **The proof and status colours.** Insert, delete and change mean the same
  thing in every theme and every client's app; they are tuned for contrast,
  never chosen.
- **Shape, spacing, type and sizes.** Radii, control heights, the grid and the
  three faces are fixed, so no theme can make a layout overflow, a target too
  small, or text too small. My view: if corners ever become themable, allow
  one switch between two radii sets, not a number.
- **Where colour may appear.** A theme picks colours; the switches pick from
  materials that have been designed. No theme can put the pencil on headings
  or colour a whole icon.
- **Focus and the current place.** They are always drawn, always from the
  pencil, and always checked.
- **The marketing site.** It is Galley's own page, in Quiet.

## Making a theme by hand

Say you want a cooler, bluer Galley for a studio whose brand is teal.

1. Copy `quiet.json` to `harbour.json`. Set `"id": "harbour"` and
   `"name": "Harbour"`.
2. **Paper.** A faintly cool white, `#F3F5F5`. That is L 0.966 and C 0.004,
   inside light's 0.93–0.995 and C ≤ 0.035.
3. **Ink.** A blue-black, `#16202A`. That is L 0.24 and C 0.022, inside
   L ≤ 0.32 and C ≤ 0.05. Its slight blue carries into every border and ink
   step.
4. **Pencil.** The brand teal, `#00857A`. Its chroma (0.098) is well above
   0.06. Its luminance puts white text on it, and the pencil text clamps to
   L ≤ 0.45 (`#00665C`). Teal sits 19° from insert green at a similar
   lightness, so expect the warning *"close to the insert colour"*. Here that
   is acceptable: the caret and the underline still say "inserted".
5. **Plate and table.** Keep the plate near-black but cool, `#121A20`. Give
   the table a grey-green, `#D7DDD9`, which is L 0.88.
6. **Dark.** Leave `dark` out at first and let the app derive it. Look at it,
   then write your own `dark` if the derived one isn't right.
7. **Switches.** Start from Quiet's (`sheet`, `ruled`, `one-tone`, `soft`).
   Change one at a time; `assist: "washed"` is the biggest step.
8. **Load and check.** The check reports any colour it moved, and why. For
   Harbour, run through it on paper, it reports two changes:
   - the ink goes from `#16202A` to `#101A24`, because ink-3 on the well was
     4.49 and ink-3 on the desk tone 4.13;
   - the pencil goes from `#00857A` to `#008277`, because white on it was
     4.49 and is now 4.67.

   The derived dark passes as it is. Keep the adjusted values; they are what
   everyone else will see.
