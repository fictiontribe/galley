# Photography log

Every image-generation call made for this starter, in order. Prompts are the
`prompt` and `negative` of each shot in `shots.json` (sent as one text,
"Avoid: …" appended), at 2K, in the shot's aspect ratio, through OpenRouter's
`/api/v1/images` endpoint. "ref" means the accepted anchor frame of the shot's
`seedGroup` was sent as a reference image, to keep the person, garment or set
the same.

## Choosing the model

Two candidates on the priority-1 hero (`campaign-aw26`), same prompt:

| Model | Price | Verdict |
| --- | --- | --- |
| `bytedance-seed/seedream-5-5` | $0.035 (2K), +$0.008 a reference | **Chosen.** True colour-negative character (grain, soft highlights, muted rust), the composition the brief asks for (subject at ~70 %, quiet wall and stone for the headline), natural skin and hands, a coherent garment. |
| `google/gemini-nano-banana-2.1` | $0.064 (token-priced) | Clean and sharp but more digital: bluer sky, the subject pushed to the frame edge, a second "figure" of shadow that does not match her pose. Nearly twice the price. |

Every other shot was made with Seedream 5.5, anchors first, then each
seed group from its anchor.

## Calls

| When (UTC) | Model | Shot | Reference | Result | Cost |
| --- | --- | --- | --- | --- | --- |
| 2026-11-23 10:19 | bytedance-seed/seedream-5-5 | campaign-aw26 | — | failed (401), not billed | $0.000 |
| 2026-11-23 10:19 | google/gemini-nano-banana-2.1 | campaign-aw26 | — | failed (401), not billed | $0.000 |
| 2026-11-23 10:21 | bytedance-seed/seedream-5-5 | campaign-aw26 | — | comparison winner; re-rolled for a coherent shadow | $0.035 |
| 2026-11-23 10:21 | google/gemini-nano-banana-2.1 | campaign-aw26 | — | rejected — shadow detached, wall step | $0.064 |
| 2026-11-23 10:23 | bytedance-seed/seedream-5-5 | campaign-aw26 | — | **accepted** | $0.035 |
| 2026-11-23 10:23 | bytedance-seed/seedream-5-5 | campaign-aw26 | — | rejected | $0.035 |
| 2026-11-23 10:26 | bytedance-seed/seedream-5-5 | piece-field-coat | — | rejected — readable brand label in the collar | $0.035 |
| 2026-11-23 10:26 | bytedance-seed/seedream-5-5 | aw26-look-02 | — | **accepted** | $0.035 |
| 2026-11-23 10:26 | bytedance-seed/seedream-5-5 | atelier-workroom | — | **accepted** | $0.035 |
| 2026-11-23 10:26 | bytedance-seed/seedream-5-5 | campaign-ss26 | — | **accepted** | $0.035 |
| 2026-11-23 10:26 | bytedance-seed/seedream-5-5 | aw26-look-03 | — | **accepted** | $0.035 |
| 2026-11-23 10:27 | bytedance-seed/seedream-5-5 | portrait-hesper | — | **accepted** | $0.035 |
| 2026-11-23 10:27 | bytedance-seed/seedream-5-5 | piece-rib-polo | — | **accepted** | $0.035 |
| 2026-11-23 10:27 | bytedance-seed/seedream-5-5 | atelier-weave | — | **accepted** | $0.035 |
| 2026-11-23 10:27 | bytedance-seed/seedream-5-5 | piece-blanket-scarf | — | **accepted** | $0.035 |
| 2026-11-23 10:27 | bytedance-seed/seedream-5-5 | piece-gansey | — | **accepted** | $0.035 |
| 2026-11-23 10:27 | bytedance-seed/seedream-5-5 | aw26-look-01 | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:27 | bytedance-seed/seedream-5-5 | journal-rust | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:27 | bytedance-seed/seedream-5-5 | aw26-look-07 | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:28 | bytedance-seed/seedream-5-5 | aw26-look-04 | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:28 | bytedance-seed/seedream-5-5 | film-poster | 1 ref | rejected — a play button baked into the frame | $0.028 |
| 2026-11-23 10:31 | bytedance-seed/seedream-5-5 | piece-field-coat | — | **accepted** | $0.035 |
| 2026-11-23 10:31 | bytedance-seed/seedream-5-5 | aw26-look-05 | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:31 | bytedance-seed/seedream-5-5 | aw26-look-08 | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:31 | bytedance-seed/seedream-5-5 | film-poster | 1 ref | **accepted** | $0.028 |
| 2026-11-23 10:31 | bytedance-seed/seedream-5-5 | aw26-cover | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:31 | bytedance-seed/seedream-5-5 | aw26-look-06 | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:31 | bytedance-seed/seedream-5-5 | ss26-look-02 | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:32 | bytedance-seed/seedream-5-5 | ss26-cover | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:32 | bytedance-seed/seedream-5-5 | ss26-look-03 | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:32 | bytedance-seed/seedream-5-5 | ss26-look-01 | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:35 | bytedance-seed/seedream-5-5 | band-wall | 1 ref | **accepted** | $0.028 |
| 2026-11-23 10:35 | bytedance-seed/seedream-5-5 | journal-pattern | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:35 | bytedance-seed/seedream-5-5 | journal-care | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:35 | bytedance-seed/seedream-5-5 | atelier-hands | 1 ref | **accepted** | $0.043 |
| 2026-11-23 10:35 | bytedance-seed/seedream-5-5 | journal-forty | 2 ref | **accepted** | $0.051 |

**Total: $1.334** over 36 calls (34 images; 2 failed calls, not billed). Budget: $10.

## Result

All 30 slots hold an accepted photograph: 29 generated frames and the share
image, which `ingest-photos.mjs` crops from `campaign-aw26`. Each frame was
checked at full size for skin, hands, garments, lettering and logos before it
was accepted. Rejected frames were not kept.

Generated at 2048 px on the long side, frames for the 2400-pixel and
1600 × 2400 slots are scaled up 17 % by the ingest script; regenerate those at a
larger size if your generator allows it.

The photographs are original generations made for this template and ship
under its MIT licence; no found or stock photograph is used.
