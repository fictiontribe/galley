# Review — Galley explainer, Caddow re-cut (31.37 s)

Read this before changing anything.

## Why this cut

The owner liked the script and not the pictures: the first cut edited a plain example site
(“Lowfield Studio”). This cut keeps the script, the voice and the length and re-shoots every shot on
**Caddow**, the fashion starter, so the photograph is on screen for most of the film. The film must
not show or say a command that does not work: Galley is pre-release and not on npm.

## Creative calls

- **Same storyline** (A, “one sentence, start to finish”, `STORY.md`), new sentence: Caddow's campaign
  heading “Coats for the long afternoon.” → “Coats for low sun.” — circled on the live page, clicked
  and asked for in the editor, struck out and written in on the proof, shown beside the live page,
  published, found in Version history, then the changed page on its own.
- **Words on screen:** the margin lines of the first cut (“Fast site. / Slow edits.”, “Click it. / Or
  ask.” …) are gone; each beat carries its one-word title — **Prompt**, **Proof**, **Publish** — with a
  proofreader's mark hung in the margin in blue pencil (caret = insert, dele = take out, stet dots =
  let it stand). That frees the frame for the footage: the window is 1728 px wide (90% of the frame)
  in every shot. No captions are burned in (the site shows the `.vtt`).
- **Legibility at the site's size** (the film is shown 350–830 px wide): every UI moment is cropped to
  one thing at ×2–×3.4 of the 1440 px capture (the request being typed ×3.4, the proof row ×3.2,
  Published ×3.1); the photographs are shown whole or at ×1.2–×2.
- **One line re-recorded:** “Built for Astro. Open source. One line to start.” became “Built for Astro.
  Open source. Free to use.” — “one line to start” promised a one-line install (`npx galley-cms`) that
  does not work until the package is on npm; the real way in is the quickstart (clone, install, build,
  run). “Free to use” is the site's own claim (Apache-2.0; the assistant needs the user's own key —
  the site says so beside it). The `npx galley-cms` command is gone from picture, caption and voice.
- **End card:** the lockup, “Prompt it. Proof it. Publish it.”, “Open source · built for Astro” and the
  site's address (`galley.fictiontribe.com`, read from `apps/site/src/data/site.json`) underlined in
  blue pencil. It holds 3.69 s (was 3.4) so the film stays 31.37 s with the shorter last line.
- **Scene 5** (was the “Built for Astro” type card and the command) is now the changed Caddow page on
  its own, opening from the heading to the whole page: the result, in the photograph, under the
  voice's last line.
- **Not built:** storylines B and C (`STORY.md`).

## On screen, second by second

| Time | Shot |
| --- | --- |
| 0.00–5.33 | Caddow's live home page full frame (the model in the rust coat, the sunlit harbour wall), slow 6% push; a blue-pencil loop draws round “Coats for the long afternoon.” (0.9–1.7) |
| 5.33–5.95 | The window drops under the title line and the heading lands where the editor shows it |
| 5.95–8.75 | **Prompt.** Match cut into the editor on the same heading; the pointer clicks it on “click” (7.29); its field opens under it (“Coats for *the long afternoon*.”, as stored) |
| 8.75–9.78 | The request typed at 2×, close: the “Looking at /” and “Coats for the long afternoon.” chips, then `Make it shorter: “Coats for low sun.”` |
| 9.78–10.44 | Sent: the request at the top of the conversation, “Reading the page” (4×) |
| 10.44–11.94 | The page: the old heading, the preview reloads, “Coats for *low sun*.” fades in over the photograph on “plain” (10.81); slow push |
| 11.94–15.10 | **Proof.** What changed, ×3.2: CAMPAIGN HERO › HEADING, the old heading struck out (inks in 12.24), the new one written in (12.60) |
| 15.10–18.12 | Click “On the page”: the live page beside the proposed page, the photograph in both, the headings different (the poster frame, 17.25) |
| 18.12–19.20 | To the top bar (the music-only pause after the proof line); Publish pressed (18.94) |
| 19.20–20.15 | **Publish.** Cut to the dialog (“Publish 1 change?”, note “Shorter campaign heading”, What goes: Home page); “Publish 1 change” pressed (20.10) |
| 20.15–20.95 | “Published. 1 change is live.” |
| 20.95–22.92 | Version history: “Shorter campaign heading · Latest · Hesper Lowe · just now” (on “commit”) |
| 22.92–27.68 | The changed page on its own: from the new heading out to heading + model; the sheet closes to a hairline |
| 27.68–31.37 | End card: the caret, the mark sets round it, the wordmark, the line, descriptor and address |

## What was measured

- `hyperframes check --json`: **ok**, 0 errors. Kept on purpose: 11 × `nested_media_start_basis_ambiguous`
  (every sound and video inside a scene is timed in scene-local seconds, the default the warning asks
  to confirm). Fixed along the way: `svg_round_cap_hidden_dash` ×2 (the hidden title marks could paint
  a dot), `escaped_container` ×2 (the zoomed footage planes; marked `data-layout-allow-overflow`).
- `snapshot --review` twice (beat sheet, five seam strips, phone sheet at 360 px), plus targeted
  `snapshot --at` round the typing, the heading change, the proof ink-in, the side-by-side, the
  Publish cut, history and the scene-5 pull-back; then frames decoded from the delivered MP4 at 830 px
  wide and 1:1 crops during the camera moves (no blocking at 640 kb/s; slight softness at 1:1 only).
- Files: `galley-explainer.mp4` 2.92 MB, 31.40 s, H.264 High 1920×1080 30 fps + AAC 96k stereo;
  `galley-explainer.webm` 1.78 MB, 31.41 s, VP9 + Opus 64k; poster 86 KB WebP 1920×1080 (17.25 s);
  10 caption cues; transcript. Master render 14.6 MB (kept in `renders/`, git-ignored).
- Sound (measured, **not heard**): delivered MP4 −15.5 LUFS integrated, −2.0 dBTP true peak, LRA 4.6
  (WebM −15.4 / −1.6 dBTP). Per line in the mix: −15.0, −15.0, −15.5, −14.8 and −15.4 LUFS for the
  re-recorded line — within 0.7 LU of the others. The splice point (23.17 s) sits in the 0.55 s pause
  before the line, in digital silence (−91 dBFS from 22.75 to 23.15 s); no speech crosses a cut (every
  line ends 0.15–0.95 s before its scene's cut). The first take of the new line hit +0.1 dBTP after
  gain-matching; it is now peak-limited at −2 dBFS (the line reads 0.3–0.7 LU under the others).
- Captions: well-formed WebVTT, 10 cues, ≤ 42 characters a line, no overlaps, word for word the
  audio. Cue 10 (“Open source. Free to use.”) starts at 24.98 s from ElevenLabs' alignment; the audio
  leaves silence at 24.84 s, so it lands ~0.13 s late.
- Safety: nothing in frame but the app, the invented Caddow site and its generated photographs; no
  token, path with a person's name or real identity (versions are signed “Hesper Lowe”, Caddow's
  invented maker); the browser's address bar is not captured; no command is shown or spoken.

## Notes and what changed

- t=6.0–8.7 · editor opening · ×2 framing with the field cut through its text box (P1) → framed so the window's bottom edge falls just under the field's box · match cut kept.
- t=8.2 · after the click · first pass zoomed out to fit the whole popover; the label over the heading was half-cut at the top edge (P1) → no zoom out, a 21 px drift down instead.
- t=12.0 · proof opening · the “Home page” title half-cut at the window's top (P1) → the status line (“Edited · Changed the heading.”) now sits at the top, tabs and row below.
- t=15.6–18.1 · side-by-side · confirmed: both pages whole with their labels; the heading lines are ~110 px tall in the 1920 frame (≈ 47 px at 830).
- t=19.2 · Publish cut · a 0.6 s camera move from the Publish button to the dialog passed through odd crops, and a 0.18 s fade double-exposed the dialog over the page (P1) → hard cut on the click to the whole dialog.
- t=21–22.9 · version history · first framing showed three rows including the capture's own “Add the live site address” and “Initial site · Test Editor” (P1) → framed on the page's title, its note and the new version only.
- t=26–27.6 · scene 5 · the pull-back ended with the Caddow logo cut by the top edge (P1) → ends at ×1.36 between the nav and the buttons, neither cut.
- Footage · the first capture served the live site as a production build: Caddow's build renders the display face at a higher-contrast optical size than its dev server, so in Proof the two headings looked like two fonts (P0 for the read: the viewer would think the font changed) → the capture now serves the live copy with `astro dev` (`--live-build` keeps the old way). Reported to the owner as a starter issue.

## Weakest shot, and what I would change with more time

- **9.78–10.44, the 4× “Reading the page” cut** is 0.66 s and shows a slice of the preview's toolbar
  at the left; at the film's size it reads as “sent, working”, not more. A take where the assistant
  answers faster, or a crop that is the chat panel only (needs a 3× capture), would be cleaner.
- **The typing close-up** has a dark slice of the preview on its left (the composer sits at the
  window's right edge, so ×3.4 cannot be the panel alone).
- The drawn pointer is ours (headless captures have none); everything under it is the real UI.

## What nobody checked

- Nobody **listened**. The new line was chosen and spliced by measurement (loudness, silence, peaks,
  pace 119 words a minute, against 125 for the line it replaces and 156–184 for the first four), not by ear. A listener should check: that “Built
  for Astro. Open source. Free to use.” sounds like the same read as the four lines before it (same
  voice, settings and seed, but a separate request — tone and pace may differ slightly); that the
  join at 23.2 s is not abrupt; that the line is not noticeably quieter; and that the music bed and
  effects (unchanged from the first cut) still suit the new pictures — the pencil, clicks, typing and
  whoosh are placed on the new actions, but their taste was never heard either.
- ElevenLabs output rights depend on the account's plan (`CREDITS.md`).
- The HyperFrames Studio preview was not opened (nothing was to be left running); `README.md` (d).
- Mobile Safari and Firefox were not tried; the browser checks were headless Chromium (WebM path).
