# Caddow — art direction: *Low Sun*

The shoot brief for every photograph on this site. It is written for whoever
makes the pictures — a photographer, or an image-generation service working
from `shots.json`, where every prompt restates the essentials below so each
shot can be made on its own and still belong.

**The idea in one line:** coats photographed in the last two hours of light,
against plain lime-washed walls by the sea — hard sun, long shadows, nothing
else in the frame.

"Fashionably cool" here means restraint and attitude, not gloss. The clothes
are plain and heavy; the light does the drama; the people are not performing.

---

## 1. Light — one world only

- **Hard, low, late-afternoon sun**, about 15° above the horizon, clear sky.
  Never overcast, never golden-hour orange, never studio flash.
- Colour of the light: clean and slightly warm white (around 4,300 K). The
  warmth is in the walls and the wool, not in a filter.
- **Long, crisp shadows** are the signature: a figure's shadow thrown across a
  wall, a hard diagonal edge of shade across plaster, a bar of window light
  across a face. Shadows stay open and cool — detail in them, never crushed
  to black.
- Indoors (the workroom) the same sun comes through tall windows as sharp
  rectangles on floor and table.
- Direction is part of the composition (see §6): each prompt says whether the
  sun comes from frame left or right.

## 2. Palette — tied to the site's tokens

| In the picture | On the site |
| --- | --- |
| Lime-wash, chalk, bone | `--color-background`, `--color-surface` (Chalk look) |
| Oat, putty, undyed wool, pale stone | `--color-surface-muted`, `--placeholder-light/mid` |
| Rust / oxide (the AW26 car coat, one knit) | `--placeholder-warm`; the Paper look's warmth |
| Ink navy, black melton | `--color-text`, `--color-inverse-background` |
| Olive-grey (waxed cotton) | the Paper look's accent |
| **One** ultramarine stripe (the blanket scarf) | `--color-accent` — the only blue in the collection |

Keep saturation low and true. The rust is the loudest colour anywhere; if a
picture has anything brighter, it is wrong.

## 3. Wardrobe

Coats and knitwear, plain and heavy, made in undyed wool, boiled wool, melton,
waxed cotton, waxed linen and linen. Wide wool trousers, rib polos, ganseys,
plain leather shoes and boots, sandals in the spring set.

- **No logos, labels, lettering or brand marks anywhere** — on clothes,
  shoes, bags, buttons or the background.
- No jewellery (one small stud at most), no sunglasses, no phones, no bags with hardware.
- Real cloth with real weight: creases where it has been worn, a loose
  thread, a slightly too-long sleeve. Nothing steamed to plastic.

The pieces are named and described in `src/content/lookbooks/*.md`; the
prompts repeat those descriptions word for word so the garments stay the
same across shots.

## 4. Sets

| Set | Used for | What it is |
| --- | --- | --- |
| `harbour-wall` | AW26 campaign and looks, the film, the image band, two stills | The north harbour wall of an invented small northern harbour town: a long, slightly uneven lime-washed wall, chalk white with faint grey weathering, above a quay of large flat pale stone flags. A squat stone bollard; two shallow buttresses. |
| `plaster-steps` | SS26 campaign, cover and looks | Pale pink-grey rendered steps rising to a deep plastered archway; softly mottled render, worn edges. |
| `workroom` | The atelier, journal covers, the founder's portrait | A first-floor workroom above a rope-maker's: limewashed walls, scrubbed pine floor, tall multi-pane windows, a long cutting table under brown pattern paper, rolls of undyed cloth, a rail of coats in calico toiles. |

Nothing else in frame: no passers-by, cars, boats with names, signs, posters,
bins, litter or modern street furniture.

## 5. Casting

A small, varied cast of **invented adults**, each resembling no real person.
Every prompt describes its person in full.

| Id | Who | Appears in |
| --- | --- | --- |
| A | A woman in her late twenties of East African heritage, close-cropped natural hair, tall and long-necked | AW26 campaign, looks 01, 04, 07, the film |
| B | A man in his forties of Mediterranean heritage, short dark hair flecked with grey, close stubble, lean | AW26 looks 02, 05, 08 |
| C | A woman in her sixties of Northern European heritage, a blunt silver bob, strong dark brows | AW26 cover, looks 03, 06; SS26 look 02 |
| D | An androgynous adult in their early twenties of East Asian heritage, straight black hair to the jaw | SS26 campaign, cover, looks 01, 03 |
| Hesper | The (invented) founder: early fifties, freckled, greying auburn hair loosely pinned up | Portrait |
| Tobiah | The (invented) pattern cutter: thirties, Black, short beard — small and from behind | The workroom |

Direction: relaxed and self-possessed; not smiling for the camera, not
sullen either. Weight on one leg, hands in pockets, looking past the lens,
eyes closed against the sun. **Nothing sexualised**: no suggestive poses,
no sheer clothing, no cleavage. Natural skin with pores, freckles and lines;
light make-up or none.

Use each person's reference image (or a character-consistency feature) for
every shot in their `seedGroup` in `shots.json`.

## 6. Lens, film and composition

- **Lenses:** 35 mm for full-length fashion (f/5.6, eye level, verticals
  straight); 50 mm for covers and stills (f/4–f/8); 85 mm for the portrait
  and the hands (f/2.8–f/4); 100 mm macro for cloth; 28 mm for the wide
  workroom.
- **Depth of field:** the wall and the figure both sharp in fashion shots;
  shallow only in the portrait and the details.
- **Film character:** medium-speed colour negative — fine, even, natural
  grain; soft highlight roll-off; muted, true colour; gentle contrast. No
  digital sharpening halos, no HDR, no lens flare, no bokeh balls.
- **Full length means full length:** headroom and footroom, nothing cut at
  the feet. Lookbook frames are 2:3 but get cropped to 3:4 and 1:1 in grids,
  so the figure stays central and whole.

### Where the empty space must be — and why

Type is set on some of these pictures. The site always lays a shade or a
plate under it, so the words are legible whatever the picture does, but the
pictures look far better when the space under the words is quiet.

| Shot | Component | The quiet space |
| --- | --- | --- |
| `campaign-aw26` | `campaign-hero`, headline **bottom-left**, full screen; mobile crops to the right third (`imageFocus: right`) | Left two-thirds: sunlit wall crossed only by her shadow. Lowest third: plain stone. A calm strip along the top for the navigation. Subject at ~72% across. |
| `campaign-ss26` | `campaign-hero` with a **plate, bottom-right**, tall | Right half: plain steps and wall cut by the arch's diagonal shadow. Subject at ~30% across. Calm top strip. |
| `band-wall` | `image-band` (21:9) and the atelier `cta`, words **lower-left** | Everything left of the coat; the bottom fifth is quay. Coat at ~62% across. |
| `film-poster` | `film`, play mark on a shade along the **bottom edge** | Lowest quarter: plain stone of the wall top. Figure small, upper middle. |
| Lookbook looks, covers, stills, portrait, journal covers | Shown beside or above text, never under it | Keep a margin round the subject so 3:4, 1:1 and hover-zoom crops never cut it. |

`focus` in `shots.json` records each subject's position; the ingest script
crops around it.

## 7. Retouching — the limits

Allowed: dust, stray threads on the backdrop, a stray hair across the face,
sensor spots, a gentle global colour balance to bring every shot to the same
light. Not allowed: skin smoothing, reshaping bodies or faces, removing
creases from clothes, changing garment colours, adding sky or sun, compositing
people from different shots.

## 8. What to avoid — the tells of generated pictures

Reject and regenerate any image with:

- **Skin** that looks waxy, airbrushed or poreless; "beauty filter" eyes.
- **Hands** with extra, fused, missing or bent fingers; hands melting into
  pockets or sleeves. When in doubt, hands go in pockets.
- **Text** of any kind: lettering on clothes, signs, labels, numbers on
  rulers, scribbles that look like words. Pencil marks on patterns are lines
  and notches only.
- **Symmetrical "AI glamour"**: a centred face staring into the lens, perfect
  hair, a catalogue smile, a teal-and-orange grade.
- **Over-saturation** or the orange golden-hour cast; skies more blue than the
  scarf.
- Garments that change between shots in the same `seedGroup` (buttons,
  collars, length); clothes that merge into the wall; shadows that disagree
  with the sun's direction; doubled sleeves or impossible folds.
- Anything that resembles a real person, brand, place or artwork.

## 9. Delivery

The photographs now in the site were made from this brief; `LOG.md` lists
every generation, the model and the cost. For a re-shoot, name each file by
its shot id (`campaign-aw26.png`, `aw26-look-01.jpg`, …),
at the size in `shots.json` or larger, in any common format, in one folder.
Then:

```sh
node scripts/ingest-photos.mjs ~/caddow-photographs
```

It crops each to its slot around `focus`, encodes WebP (JPEG for the share
image) within budget, writes it over the placeholder, lists what is still
missing, and refreshes Galley's thumbnails and previews (see the README).
Priority 1 shots are the ones the product demo shows first.
