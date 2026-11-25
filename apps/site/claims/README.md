# Claims about other products

One file per comparison article in `src/content/compare/`, with the same name.
Each lists every statement the article makes about another product: the words
on the page, the product's own page that supports them, and the date it was
read. Statements about Galley itself follow [`../CLAIMS.md`](../CLAIMS.md) and
`src/data/status.json`, as everywhere else on the site.

The rules these pages are written to:

- A statement about another product is true on the day it is written and comes
  from that product's own public pages or documentation. If it can't be
  checked, it is left out.
- Prices, plans and limits change often. Wherever the page quotes one, it says
  the month it was read ("as of November 2026").
- Each article says plainly where the other product is the better choice.
- "The most modern option" is our opinion and is written as ours ("we think"),
  with the reasons. No page promises rankings, traffic or citations by AI.
- Public sources only: nothing from client work.
- Other products' names name them, and nothing else: no logos, no captures of
  their apps.

Before a batch of articles is published, someone who did not write them
checks every row against its source again and records the date in the file.

To refresh an article: read each row's source again, correct the article and
the row, change `checked` in the article's front matter, and set `updated`.
