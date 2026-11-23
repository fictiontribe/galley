# Credits and licences

Everything in this film is either the product itself, the Galley brand, or material licensed for
commercial use on a public website. No attribution is legally required for any item below; it is
given here so the sources can be checked.

## Picture

| What | Source | Licence |
| --- | --- | --- |
| All product footage (`assets/footage/*`) | Captured from a local Galley instance running a throwaway copy of the `astro-editorial` starter ("Caddow", an invented coat and knitwear label) with `scripts/capture-footage.mjs` | Galley's own product (Apache-2.0) and starter (MIT) |
| The photographs on screen (inside the footage) | The Caddow starter's own photographs, made for the template from its shoot brief (`starters/astro-editorial/galley/photography/`); the model and every name in the site are invented | Part of the starter (MIT) |
| Galley lockup and mark (inlined in `compositions/s6-end.html`, copies in `assets/brand/`) | `galley/brand/logo/lockup.svg`, `mark.svg` | Galley brand assets — use per `brand/logo/README.md` |
| Newsreader (variable) | `galley/brand/fonts/`, copied to `assets/fonts/` | SIL Open Font License 1.1 (`assets/fonts/OFL-newsreader.txt`) |
| Figtree (variable) | same | SIL OFL 1.1 (`assets/fonts/OFL-figtree.txt`) |
| IBM Plex Mono 400/500 | same | SIL OFL 1.1 (`assets/fonts/OFL-ibm-plex-mono.txt`) |

## Sound

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `assets/audio/voiceover.wav` (+ `lines/*.wav`) | Voiceover | ElevenLabs text-to-speech, voice "George" (`JBFqnCBsd6RMkjVDRZzb`, ElevenLabs default library), model `eleven_v4`, generated with the owner's ElevenLabs account. Lines 1–4: the 2026-11-23 read; line 5 ("Built for Astro. Open source. Free to use.") re-recorded 2026-11-23 for the Caddow cut (42 characters) and spliced in | Commercial use of ElevenLabs output is governed by the account's plan — **confirm the plan allows commercial use** (free-tier output requires attribution and is not for commercial use) |
| `assets/audio/music/piano-loops-030-josefpres.mp3` | Music bed, "Piano loops 030 octave up long loop 120 bpm" by josefpres | [freesound.org/people/josefpres/sounds/652514](https://freesound.org/people/josefpres/sounds/652514) (Freesound HQ preview, found through Openverse) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `assets/audio/sfx/pencil-writing-elliotlp.mp3` | Pencil on paper (the loop in scene 1) — "Pencil Writing on Paper" by elliotlp | [freesound.org/people/elliotlp/sounds/277312](https://freesound.org/people/elliotlp/sounds/277312) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `assets/audio/sfx/pencil-strokes-ani_music.mp3` | Pencil strokes (the proof marks inking in) — "Pencil writing on paper (7 strokes)" by ani_music | [freesound.org/people/ani_music/sounds/632476](https://freesound.org/people/ani_music/sounds/632476) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `assets/audio/sfx/click-soft.mp3`, `click.mp3`, `typing.mp3`, `whoosh-short.mp3` | UI click (×2 takes), key burst, short whoosh | Bundled with the HyperFrames `media-use` skill, sourced from Pixabay | [Pixabay Content License](https://pixabay.com/service/license-summary/) — free for commercial use, no attribution required |

The on-device fallback voice (used when no ElevenLabs key is set) is Kokoro-82M via `hyperframes tts`
(model weights Apache-2.0), voice `af_heart`.

## Words

Script, on-screen copy and the three-beat line come from `galley/brand/positioning.md` and
`brand/voice.md`. "Astro" is a trademark of its owner; the film says "Built for Astro" as the
README does and shows no Astro logo. "Free to use" is the site's own wording (`apps/site`, the closing
section: "Apache-2.0, free to use. The assistant runs on your own AI key.").
