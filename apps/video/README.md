# Galley explainer video

A 31-second home-page explainer for Galley, built with [HyperFrames](https://hyperframes.heygen.com)
(HTML rendered to video). Every shot is the real app, recorded from a live Galley editing **Caddow**,
the fashion starter (`starters/astro-editorial`): its campaign heading over the photograph goes from
“Coats for the long afternoon.” to “Coats for low sun.” — asked for, proofed beside the live page,
published as a version. The story, the choices and the review live beside it:

| File | What |
| --- | --- |
| `STORY.md` | The storylines, the one built and why, the voiceover and on-screen words |
| `SPEC.md` | The film as numbers: look, motion, shots by time, sound, banned defaults, QA frames |
| `REVIEW.md` | What the review found and changed, what was measured, what nobody checked |
| `CREDITS.md` | Every source and its licence |
| `voiceover.txt` | The script, one sentence group per scene |
| `film.config.json` | How the voice becomes the clock: pauses, pre-roll, end-card length, voice choices |
| `index.html`, `compositions/s1…s6-*.html` | The film (root + one file per scene) |
| `scripts/` | Capture, voice, timing, captions and delivery scripts (below) |

Deliverables are written to `../site/public/video/`:
`galley-explainer.mp4` (H.264/AAC, faststart, ≈ 2.9 MB), `galley-explainer.webm` (VP9/Opus, ≈ 1.8 MB),
`galley-explainer-poster.webp` (the proof: live page beside the proposed one), `galley-explainer.en.vtt`
(captions, not burned in), `galley-explainer.txt` (transcript). The home page's film section
(`apps/site/src/components/sections/Film.astro`) shows the poster, loads the video only on play, and
offers the captions and three chapters (Prompt 0:06, Proof 0:12, Publish 0:19).

## The pipeline

```
capture-footage.mjs ─► assets/footage/*.jpg|mp4 + manifest.json  (element boxes, event times)
make-voiceover.mjs  ─► assets/audio/voiceover.wav + voiceover.timings.json  (sentence + word times)
apply-timings.mjs   ─► index.html + scenes re-timed to the voice and the footage
hyperframes check / snapshot --review ─► fix ─► hyperframes render (master) ─► encode-deliverables.mjs
```

Nothing in a scene is timed in absolute seconds: each scene starts 0.3 s before its sentence, and
inside a scene the moves are anchored to words (`window.__FILM`, written by `apply-timings.mjs`) and
to element boxes measured during capture. A new read or a new capture is re-timed by one command.

### Machine notes (this repo's Mac)

- **ffmpeg:** Homebrew's ffmpeg fails to start here (its freetype 2.15 bottle links
  `/usr/lib/libhvf.dylib`, which this macOS build lacks). Wrappers that point it at the older freetype:
  ```sh
  mkdir -p /tmp/galley-video/bin
  for b in ffmpeg ffprobe; do printf '#!/bin/sh\nDYLD_LIBRARY_PATH=/opt/homebrew/Cellar/freetype/2.13.3/lib exec /opt/homebrew/bin/%s "$@"\n' $b > /tmp/galley-video/bin/$b; chmod +x /tmp/galley-video/bin/$b; done
  export HYPERFRAMES_FFMPEG_PATH=/tmp/galley-video/bin/ffmpeg HYPERFRAMES_FFPROBE_PATH=/tmp/galley-video/bin/ffprobe
  export FFMPEG_PATH=$HYPERFRAMES_FFMPEG_PATH FFPROBE_PATH=$HYPERFRAMES_FFPROBE_PATH
  ```
  On a machine with a working ffmpeg, skip this.
- **HyperFrames CLI:** `npx --yes hyperframes@0.9.41 …` (pinned). Inside the Claude Code plugin use
  its launcher instead: `node ~/.claude/plugins/cache/hyperframes/hyperframes/0.9.41/skills/hyperframes/scripts/plugin-cli.mjs …`
  and set `HYPERFRAMES_CLI` to the same so the scripts use it too.
- **Playwright** (capture only): `playwright-core` is not a dependency here; point `PLAYWRIGHT_FROM`
  at any `node_modules/` that has it with its Chromium downloaded.
- **Disk:** a full render peaks at ~0.5 GB of temporary frames; it writes 942 frames and cleans up.
  A capture keeps its frames in the temp folder only while it encodes (~0.3 GB for the 15 s take).

## (a) Re-shoot the footage

Needs a live Galley with the assistant connected, opened on a **throwaway git copy of the Caddow
starter** (the capture edits, publishes, then rewinds it). From the repo root:

```sh
# 1. a throwaway copy of the starter (git-initialised, node_modules linked from the starter)
rsync -a --exclude node_modules --exclude dist --exclude .astro starters/astro-editorial/ /tmp/galley-film/site/
ln -s "$PWD/starters/astro-editorial/node_modules" /tmp/galley-film/site/node_modules
git -C /tmp/galley-film/site init -q -b main && git -C /tmp/galley-film/site add -A \
  && git -C /tmp/galley-film/site -c user.name="Test Editor" -c user.email="editor@example.com" commit -q -m "Initial site"

# 2. the app's screens, built to a temp folder, and a Galley server with the assistant key in its env
pnpm --filter @galley/web exec vite build --outDir /tmp/galley-film/web --emptyOutDir
env -i PATH="$PATH" HOME="$HOME" ANTHROPIC_API_KEY=… GALLEY_HOME=/tmp/galley-film/home \
  GALLEY_WEB_DIR=/tmp/galley-film/web GALLEY_TOKEN=<any token> GALLEY_PORT=4760 \
  node packages/cli/bin/galley.js /tmp/galley-film/site --no-open &
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:4760/api/sites   # → the site id

# 3. the takes (from apps/video)
node scripts/capture-footage.mjs --app http://127.0.0.1:4760 --token <token> --site-id <id> \
  --site /tmp/galley-film/site --live-port 4761 --note "Shorter campaign heading"
node scripts/apply-timings.mjs
```

- What it records (same names every time; the scenes pick up new boxes and times): `site-live.jpg`
  (the live home page), `editor-ask.mp4` (click the heading → its field opens → type the request with
  the clicked heading riding along as a chip → send → the heading changes on the page), `site-after.jpg`
  (the changed page on its own), `proof-what-changed.jpg`, `proof-on-the-page.jpg`, `publish-dialog.jpg`,
  `publish-done.jpg`, `history.jpg`, `editor-before/after.jpg` (not used in the cut), `manifest.json`.
  Stills are JPEG q≈92 at 2× (1440×900 CSS → 2880×1800 px); the recording is a CDP screencast at 2×.
- **The live site** is the unmodified copy run by its own `astro dev` on `--live-port`, so Proof's two
  sides render alike and differ only by the change. (`--live-build` serves a production build instead —
  but Caddow's build sets its display face at a different optical size than its dev server does, so
  the live heading would look like a different cut of the font.)
- **The request** (default `Make it shorter: “Coats for low sun.”`, after clicking the heading) and the
  headings (`--heading "Coats for low sun."`, `--from "Coats for the long afternoon."`) are options.
  The assistant kept the original's italics (`Coats for *low sun*.`): the proof and the page show that.
- **Costs:** one assistant request per full run. `--note "…"` types the version note instead of asking
  the assistant for one (no second call). `--dry-ask` rehearses the editor take up to the typed request
  without sending (free). Re-take everything except the editor recording for free with
  `--only live,proof,publish --no-ai --value "Coats for *low sun*." --note "Shorter campaign heading"`
  (`--value` is the heading as stored, written through the content API).
- Versions are signed by Caddow's (invented) maker, “Hesper Lowe”, set as the app's author for the run
  and cleared afterwards, so nobody's real git identity is in frame. The run also commits the live-site
  address in the throwaway repo (“Add the live site address”); the history shot is framed above it.
- If the UI changes shape (a renamed button), fix the selector in the take that broke — each take is a
  short block in the script — and re-run. If an element moves, nothing needs changing: its box is measured.

## (b) The voice

The voiceover is ElevenLabs “George” (`JBFqnCBsd6RMkjVDRZzb`, `eleven_v4`, settings in
`film.config.json`). Lines 1–4 are the original 2026-11-23 read; line 5 was re-recorded for this cut
(“One line to start.” promised a one-line install that does not exist yet) and spliced in.

The key is read from the environment only; it is never written to a file or printed.

```sh
cd apps/video
export ELEVENLABS_API_KEY="$(grep -E '^ELEVENLABS_API_KEY=' ../../.env.local | cut -d= -f2-)"   # quotes are stripped by the script
# Re-record ONE line (its new text in voiceover.txt) and splice it into the existing voiceover.wav:
node scripts/make-voiceover.mjs --provider elevenlabs --only start     # ~42 characters
# …or every line (replaces the whole read, ~330 characters):
node scripts/make-voiceover.mjs
node scripts/apply-timings.mjs                  # re-time the cut to the new read
```

- `--only <line id>` keeps every sample of `voiceover.wav` outside that line's slot; the new take
  starts where the old one did (after the same pause), is trimmed to its speech, gain-matched to the
  old line's EBU R128 loudness and peak-limited at −2 dBFS. `--only <id> --reuse` re-splices the take
  already in `assets/audio/lines/` (free). Restore the old file first if you re-splice, or the "old
  slot" it matches is the new take.
- If the read changes length, the scene boundaries follow automatically. The film's length is the sum
  of the lines, the pauses in `film.config.json`, `tailAfterLastLine` and `endCard.duration`; this cut
  keeps it at 31.37 s by giving the end card 3.69 s (the site's film heading says “31 seconds”).
- Audition a line without touching the film:
  `node scripts/make-voiceover.mjs --test-line "…" --name try1 --out /tmp/vo [--voice id] [--el-speed 0.95]`.
- Without a key, `make-voiceover.mjs` uses the on-device Kokoro voice (`hyperframes tts`); see its header.

## (c) Re-render and deliver

```sh
cd apps/video
npx --yes hyperframes@0.9.41 check --json            # must be ok; 11 nested_media warnings are expected (see REVIEW.md)
npx --yes hyperframes@0.9.41 snapshot --review       # look at the sheets
npx --yes hyperframes@0.9.41 render --quality delivery -o renders/galley-explainer-master.mp4
node scripts/encode-deliverables.mjs                 # mp4 + webm + poster + captions + transcript → ../site/public/video/
```

- `encode-deliverables.mjs`: mp4 two-pass ~640 kb/s + AAC 96k, webm VP9 two-pass ~420 kb/s + Opus 64k
  (`--video-bitrate`, `--webm-bitrate`); poster 2.15 s after the click that opens “On the page”
  (`--poster-at <s>` to choose another frame). The site shows the film 350–830 px wide; at these rates
  the 1080p frames hold up at that size (checked frame by frame, see REVIEW.md).
- The end card's address is read from `apps/site/src/data/site.json` (`url`) by `apply-timings.mjs`,
  and the transcript's end line by `make-captions.mjs`.

## (d) Open the editable preview

```sh
cd apps/video
npx --yes hyperframes@0.9.41 preview --background --port 4763   # Studio at http://localhost:4763/#project/video
npx --yes hyperframes@0.9.41 preview --stop                       # when finished
```

The three beat titles, the end-card descriptor and the address are Studio variables (Variables panel).
The HyperFrames desktop app is another way to keep editing (`npx --yes hyperframes@0.9.41 open`).
