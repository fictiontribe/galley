# Story — Galley home-page explainer (≈30 s)

## The one thing

- **What it is:** Galley lets the people who own a fast static site change it themselves — click the text or ask in plain words — and shows them exactly what changed, marked up like a proof, beside the live site, before it becomes a commit in their own repository.
- **What the viewer remembers, in their words:** "I can change our site without waiting for a developer, and I see exactly what will change before it goes live."
- **The spine:** one viewer, one real task — the campaign heading of Caddow, the fashion starter ("Coats for *the long afternoon*." over a full-bleed photograph), becomes "Coats for *low sun*." That one sentence travels through every shot: circled on the live page → clicked and asked for in the editor → struck out and written in on the proof, then beside the live page → published as a version → the page with its new heading, on its own. (Re-cut 2026-11-23 on Caddow; the first cut used the plain "Lowfield Studio" starter.)
- **Facts vs choices.** Facts (from `docs/ARCHITECTURE.md`, `brand/positioning.md`, the running app): click-to-edit and chat editing; Proof = plain-language change list + proposed page beside the deployed site; Publish = `git commit` (+ push); Astro first; Apache-2.0, free to use. Galley is pre-release and not on npm: it runs from a clone (the site's quickstart), so the film shows and says no install command. Choices: the angle (one sentence, start to finish), the look (a proof sheet on the desk), the sound (calm piano under a voice).

## Five sketches (device × form)

1. A moment in someone's day × one continuous take — an editor at 4:55 pm with a typo the developer can't fix until Monday. *Dropped: needs a person or a staged desk; we have no footage of people and drawing one is "a drawing of it".*
2. The worked example × object-to-object chain — one heading travels from the live site through the product to the commit. **Kept (A).**
3. Life before and after × split screen to one — a queue of small requests on one side, Galley on the other, collapsing into one. **Kept (B).**
4. Type carries the argument × one frame that rebuilds — the three words Prompt / Proof / Publish set large and literally proofread. **Kept (C, the bold one).**
5. The feature as the hook × match cuts — open on the proof marks themselves (caret, dele) and match-cut them into the logo. *Folded into A's ending instead of a film of its own.*

---

## A — "One sentence, start to finish" (recommended, built)

**Device:** the worked example. **Form:** object-to-object chain on one home stage — a proof sheet on the desk: the margin on the left carries the words, the page on the right carries the product.

The viewer watches one real heading on one real site get changed by the person who owns it: it is circled in blue pencil on the live site, clicked in the editor, asked for in plain words, then shown struck out and replaced beside the live page, published, and ends as a version with a name and a time. It feels calm and exact — the way the product talks.

- **First two seconds:** Caddow's live home page fills the frame on warm paper inside crop marks — the model in the rust coat against the sunlit harbour wall; a blue-pencil loop starts drawing around the heading.
- **Beats:** need (the circled heading) → **Prompt** (the real editor: the heading clicked, its field, then the request typed to the assistant; the heading changes over the photograph) → **Proof** (What changed, inked in; then the live page beside the proposed page — the longest beat) → **Publish** (the real dialog, Published, the version in history) → the changed page on its own → the mark lands: Prompt it. Proof it. Publish it. · Open source · built for Astro · the site's address.
- **Look:** paper `#F6F1E7`, ink `#1A1712`, one Blue Pencil `#2E2BFF` for the pencil marks and the caret; Newsreader display in the margin, Figtree for small notes, IBM Plex Mono only for real paths, keys and the command; real product footage at 2× inside crop marks.
- **Sound:** a calm solo piano loop (~120 bpm, soft) under a warm, mid-paced voice; pencil strokes on the two hand-drawn marks, a soft click on each real click, a short key burst under typing, one short whoosh where the page zooms into the product. The music lifts back to full level under the end card.

## B — "The queue"

**Device:** life before and after. **Form:** split screen to one.

The frame opens as a wall of small, polite requests — "Can we change the heading?", "Typo on pricing", "New team photo" — stacked in a developer's queue, each stamped *waiting*, the counter ticking up. One request is lifted out of the column and set into Galley; the queue side of the screen keeps churning while the Galley side calmly does the change, proofs it, and publishes; the split collapses onto the Galley side and the queue goes quiet.

- **First two seconds:** a full column of request cards scrolling slowly upward, one card highlighted: "Change the home page heading — waiting · 6 days".
- **Beats:** queue → one request lifted → Galley does it (ask, proof, publish) while the queue churns → split collapses → the site's address → mark.
- **Look:** the same paper and ink; the queue side in grey stet dots, the Galley side in real footage; the split is a hairline gutter.
- **Sound:** a muffled office tick under the queue, the piano entering when Galley appears.
- *Why not first:* its first half is spent on an invented queue (the "6 days" would be made up), the proof gets half a screen at the moment it matters most, and request cards drift toward the "three cards in a row" tell.

## C — "Proof it" (the bold one)

**Device:** type carries the argument. **Form:** one frame that rebuilds.

The whole film is one typeset page. "Prompt it. Proof it. Publish it." is set huge in Newsreader; then the page is literally proofread: a caret opens "Prompt" and the real assistant panel slides into the gap; a dele loop strikes through "Proof" and the real proof view prints in its place; a registration mark lands on "Publish" and the version row prints under it. The letters never leave the frame; the product appears inside the type.

- **First two seconds:** the three-beat line set at 200 px across the frame, a blue caret blinking under the space after "Prompt".
- **Beats:** line set → Prompt opened (assistant) → Proof struck and replaced (proof view) → Publish registered (version) → the line resets clean with the site's address beneath → mark.
- **Look:** a single paper sheet with a column grid in non-repro blue; huge Newsreader; real footage only inside counters and gaps of the type.
- **Sound:** no voice-led clock — piano on a strict grid, one pencil stroke per mark, the voice reading only the three-beat line at the end.
- *Why not first:* striking and stunning, but the product is seen through slots in letters, the "live site beside your changes" idea needs room this form cannot give it, and with the sound off a stranger learns the slogan rather than what the product does.

---

## The pick

**A — "One sentence, start to finish"**, because a stranger can follow one real heading being changed by its owner from need to publish, and the proof moment gets the most screen and the most time. It is also the easiest to re-cut: every shot is one named capture (`assets/footage/*`) placed by measured boxes, so fresh captures of a polished UI drop straight in.
The owner can ask for B or C later; both are written above in enough detail to build.

## Voiceover (as recorded — ElevenLabs "George", eleven_v4; lines 1–4 from the first cut, line 5 re-recorded for the Caddow cut)

> Your site is fast. So why does every small change wait for a developer?
> With Galley, click the text on the page, or just ask for the change in plain words.
> Then proof it: every change marked up like an editor's proof, beside your live site.
> Publish, and it's a commit in your own repository.
> Built for Astro. Open source. Free to use.

(Line 5 was "… One line to start." — it promised a one-line install that does not exist until Galley is on npm.)

The end card carries "Prompt it. Proof it. Publish it." on screen only (the voice never reads the screen word for word).

## On-screen words (sound off)

| Shot | Words on screen |
| --- | --- |
| Need | none of ours: the live page and the blue-pencil loop round its heading |
| Prompt | the title **Prompt** (caret in the margin), and the product's own text: the heading's field, the typed request, the changed heading |
| Proof | the title **Proof** (dele in the margin), and the product's own: the struck and written-in heading, *Live site · production* / *Proposed · your changes* |
| Publish | the title **Publish** (stet dots in the margin), and the product's own: "Publish 1 change?", "Published.", the version row (note, author, "just now") |
| Start | none of ours: the changed page on its own |
| End | the Galley lockup · **Prompt it. Proof it. Publish it.** · *Open source · built for Astro* · `galley.fictiontribe.com` (from `apps/site/src/data/site.json`) |

Captions are not burned in: the site shows `galley-explainer.en.vtt`.
