---
title: Never guess
description: When something is ambiguous, Galley asks or declines. How a click on the previewed page is traced back to one value in one file, what happens when several match, and how the assistant handles ambiguous requests.
group: concepts
order: 6
---

This page is for developers. It explains the fourth principle: when Galley can't be sure — which of three identical “Learn more” links was clicked, which page “the pricing page” means — it asks, or it declines. It never picks one for you.

## Clicking text on the page

The preview shows the site's own rendered HTML, which carries no record of which file a word came from. So when someone clicks text in the preview, the overlay sends the host three things — the page's URL path, the element's visible text, and, when the same text appears several times on the page, which occurrence was clicked and how many there are — and the engine looks for it ([`content/index/content-index.ts`]({repository}/blob/main/packages/core/src/content/index/content-index.ts)).

The engine keeps an index of every editable string in the site: front-matter values with their field path, markdown body blocks, data-file strings. It compares on whitespace-collapsed text with markdown inline syntax and HTML tags stripped, exact case first and then case-folded, and checks, in order:

1. **The entry behind this page.** The URL is mapped back to an entry through the collection's URL pattern. One match there, and the text appears once on the page → **unique**.
2. **The same text several times on the page**, and the page's entry holds it exactly that many times → document order maps one-to-one, and the clicked occurrence is **unique**.
3. **Otherwise, on this page** → **ambiguous**: the candidates are listed and the person chooses.
4. **Nothing on this page**: one match anywhere else in the site → **unique**; several → **ambiguous**, listed; very many → **none**, *too many to tell which one this is*.
5. **No match at all** → **none**: *This text isn't in any content file. It may be written into the site's code or produced by it.*

A unique match can be retyped in place only when the stored value equals what is shown (`plain: true`) — otherwise markdown or markup would be lost — and only when the mode allows writing that file (`editable`). Anything else opens the field in the form instead.

## What that looks like

On the starter, *Book a free first visit* is a button label on two pages: the home page's hero and the pricing page's closing section.

```sh
$ curl -s -X POST -H "Authorization: Bearer $GALLEY_TOKEN" -H "Content-Type: application/json" \
    "http://127.0.0.1:4400/api/sites/$SITE/resolve" -d '{"urlPath":"/","text":"Book a free first visit"}'
```

| Clicked on | Result |
| --- | --- |
| `/` | `unique` — `src/content/pages/index.md`, *Sections › 1 (Hero) › CTA › Label* |
| `/pricing/` | `unique` — `src/content/pages/pricing.md`, *Sections › 4 (CTA) › CTA › Label* |
| `/about/`, whose own entry doesn't hold the text | `ambiguous` — *This text appears in 2 places. Choose the one you meant.*, both listed |
| any page, text that is in no content file | `none` — *This text isn't in any content file. It may be written into the site's code or produced by it.* |

Those are the real responses from the engine for those requests. The first two are unique even though the words appear twice in the site, because the page's own entry is checked first.

## Asking instead of guessing in chat

The assistant follows the same rule through its instructions and one tool:

- When a request is genuinely ambiguous — which page, which of two identical texts, what wording — it asks **one** short question with `ask_user`, offering two to four concrete answers as buttons, and stops.
- It never asks twice in a row. A second `ask_user` straight after an answer is refused by the tool itself: *Don't ask again: act on the person's answer, make the most reasonable choice for anything still open, and say what you chose.*
- It says a change happened only when a tool reported that it did, and quotes short new text exactly so the person can check it without opening the proof.
- It is told not to invent facts — statistics, quotes, names, prices, dates, links or image paths it wasn't given and didn't find on the site.

The prompt is in [`ai/prompt.ts`]({repository}/blob/main/packages/core/src/ai/prompt.ts); the refusal is in [`ai/tools/content.ts`]({repository}/blob/main/packages/core/src/ai/tools/content.ts). The rules about facts are instructions to a model, not guarantees — which is why every change still goes through the proof.

## Elsewhere in the engine

The same reluctance shows up wherever the engine could quietly pick:

- A body text replacement that matches more than once is refused unless all occurrences were asked for.
- A select is inferred only on strong evidence; otherwise the field stays text ([detection](/docs/concepts/detection/#4-fields)).
- A field holding a number in one file and a string in another is treated as a string.
- An edit sent with a stale `baseHash` is refused, not merged.

## Next

- [Surgical edits](/docs/concepts/surgical-edits/).
- [The preview and astro dev](/docs/astro/preview/) — where the overlay runs.
