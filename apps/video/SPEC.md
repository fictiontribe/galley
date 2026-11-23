# SPEC — "One sentence, start to finish" (Caddow cut)

```text
GOAL:    A stranger understands that they can change their own site by clicking or asking, will see
         exactly what changed beside the live site, and that publishing is a commit in their repo —
         shown on a good-looking, photograph-led site (Caddow), the photograph on screen most of the time.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, H.264 + AAC (plus WebM), poster = the proof frame.
         Shown on the site 350–830 px wide: every moment must read at 620 px.
TIME:    31.37 s x 30 = 942 frames. The voice is the clock: every scene starts 0.30 s before its sentence
         (film.config.json → apply-timings.mjs); the end card holds 3.69 s.
LOOK:    medium = a galley proof on the desk, the same family as the site (paper, ink, blue pencil,
         Newsreader / Figtree / IBM Plex Mono, proofreader's marks).
         ground  paper #F6F1E7 flat, no texture, no vignette, no grain.
         ink     #1A1712 (all display type), #514A3F secondary; crop marks #857B69.
         accent  Blue Pencil #2E2BFF — only: the loop round the heading (s1), the beat marks (caret,
                 dele, stet), the end card's caret and the address's underline. One accent per frame.
         proof   insert #0B6E55, delete #B8361A only where the product itself shows them.
         titles  one word per beat, Newsreader 400 104 px, x 192 / top 100 (inside title-safe), its mark
                 hung in the margin at x ≈ 96–170, inked left to right in 0.48 s.
         window  RF x 96–1824, y 54–1026 (no title: s1, s5); RT x 96–1824, y 236–1026 (under a title:
                 s2–s4); radius 4 px; crop marks 28 px long, 1.5 px, 14 px outside each corner.
         footage captured at 2x (2880 x 1800 per 1440 x 900 viewport); photographs at x1.2–2,
                 UI moments cropped to one thing at x2–3.4 (text ≥ 45 px in the 1920 frame).
         end     lockup 160 px tall; line 100 px; descriptor Figtree 500 44 px; address Plex Mono 500 44 px
                 underlined in blue pencil to its length.

OBJECTS: Caddow's live home page (dev-served copy of the unmodified starter); the editor (real recording:
         the heading clicked, its field, the typed request with the clicked heading as a chip, the page
         changing); Proof › What changed and › On the page (real stills); the Publish dialog, Published and
         Version history (real stills); the changed page on its own (real still); a drawn pointer (ink
         arrow with a paper outline) because headless captures have none; the Galley lockup SVG.

MOTION:  titles  mark draws 0.3–0.4 s, word inks in 0.48 s on cubic-bezier(.13,.6,.23,.98); leave in 0.18 s.
         camera  power2.inOut / power3.inOut, 0.55–0.95 s per reframe; slow pushes power1/2.inOut over
                 the scene; never more than one camera move at a time.
         ink-in  the struck and written-in heading uncovered left to right, 0.48 s each (the product's).
         cuts    s1→s2 match cut on the heading (the window drops under the title line as the live
                 heading lands where the editor shows it); in-scene hard cuts on clicks; s2→s3 hard cut;
                 s3 tab click → camera to the side-by-side; s3→s4 hard cut on the Publish click to the
                 dialog; s4→s5 hard cut, the window opens to the full frame; s5→s6 the sheet closes to
                 a hairline, the caret alone on paper, the mark sets round it.
         nothing bounces; no breathing, floating or pulsing loops; titles dead still once landed.

SHOTS (absolute seconds; inside each scene times are anchored to words and measured boxes):
  s1 need    0.00–5.95  Live page full frame, ×1.2 → ×1.27 push; blue-pencil loop round the heading 0.9–1.7
                        (pencil); 5.33–5.95 window RF→RT and the heading lands on the editor's (whoosh).
  s2 prompt  5.95–11.94 "Prompt" 6.09. Editor ×2: the pointer clicks the heading on "click" (7.29, click);
                        the field opens (7.32), camera drifts down to it. Cut 8.75: the composer ×3.4, typing
                        at 2× (keys). Cut 9.78: the conversation ×3.4 at 4×. Cut 10.44: the page ×1.75→×2,
                        the heading becomes "Coats for low sun." on "plain" (10.81).
  s3 proof   11.94–19.20 "Proof" 12.08. What changed ×3.2: struck heading inks in 12.24, new one 12.60
                        (pencil strokes). Pointer clicks "On the page" 15.10 (click); camera to the two pages
                        ×1.63 (15.25–16.20); holds to 18.12 (the voice ends 18.0); to the top bar ×3,
                        clicks Publish 18.94 (click).
  s4 publish 19.20–22.92 "Publish" 19.34. Hard cut to the whole dialog ×1.96; click "Publish 1 change" 20.10
                        (click) → "Published." ×3.1 20.15 → Version history ×2.6 20.95 (the title, its note,
                        the new version: "Shorter campaign heading · Hesper Lowe · just now").
  s5 result  22.92–27.68 The changed page on its own: ×1.55 on the new heading, window RT→RF, out to ×1.36
                        (heading + model, between nav and buttons); closes to a hairline 27.38.
  s6 end     27.68–31.37 Caret alone; bars ink in, wordmark wipes in (to 28.64); the line 28.38–28.94;
                        descriptor + address 28.68–29.1; underline 28.98–29.46; hold ≥ 1.9 s.
  Poster: 17.25 s (Proof: the live page beside the proposed page, the photograph in both).

SOUND:   voice: ElevenLabs "George" (eleven_v4), lines 1–4 from the first cut, line 5 re-recorded and spliced
         in the pause before it (gain-matched, limited at −2 dBFS); piano bed (CC0) from 36 s into its
         source: 0.26 before the first word, 0.15 under the voice, 0.30 in the post-proof pause, 0.55 on the
         end card; sfx: pencil ×2, click ×4, typing ×1, whoosh ×1, each peaking one frame after its picture.
         Delivered mix −15.5 LUFS integrated, −2.0 dBTP true peak.

BANNED:  the HyperFrames defaults (dark void, glow, gradients, glass cards, centred-everything, fade-and-
         slide-up for every element, drifting titles, corner HUD labels, three cards in a row, a title
         over a dimmed screenshot, the logo docked in a corner); plus for this film: red/green diff
         boxes or +/− gutters drawn by us; drawn mock-ups of the app; captions burned in; any command
         that does not work today (`npx galley-cms`); generic "AI sparkle"; stock footage; any real
         person's name, a token or a local file path in frame; numbers the source does not give;
         bounce; a cursor click ring; the accent used as a fill; the drawn pointer resting on text
         being read; UI chrome or a logo half-cut at a window edge at rest; a sheet left blank.

QA:      t=0.0 frame not empty (the live page); t≈1.8 loop complete; t≈8.3 the field and its text
         readable; t≈9.7 typed request readable at 620 px; t≈11.8 new heading over the photograph;
         t≈13.5 struck/inserted lines readable at 620 px; t≈17.0 live vs proposed both readable;
         t≈19.8 dialog and its button; t≈21.8 version row readable; t≈27.2 whole heading + model, no edge
         cuts; t≈30.5 end card complete and still. No text of ours outside x 192–1728 / y 108–972.
```
