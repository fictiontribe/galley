---
title: A year of meter readings, before and after
description: Twelve months of gas and electricity from the year I moved in, set against the first full year with a heat pump and a warmer house. The short version is two-thirds less. The long version is more useful.
date: 2026-01-12
updated: 2026-02-03
author: ines-calloway
tags: [Data, Heating, Costs]
image: /images/blog/house-front.webp
imageAlt: The front of a red-brick 1930s semi with a rounded bay window, insulation boards stacked by the door.
imageCaption: The house on the morning the wood-fibre boards arrived.
featured: true
takeaways:
  - The house used 19,110 kWh in 2023 and 6,465 kWh in 2025 — about a third.
  - Most of the drop is the heat pump turning one unit of electricity into three or four of heat. Insulation made that possible, but saved less on its own than I expected.
  - Summer barely changed. The savings are all in the six cold months.
sources:
  - title: The house's monthly meter readings, 2022–2025
    note: taken on the first of each month, photos kept
  - title: Energy bills, January 2023 – December 2025
  - title: Degree-day data for the nearest weather station
    href: https://www.example.com/degree-days
    note: used to compare a mild winter with a cold one
ai: research
revisions:
  - date: 2026-02-03
    note: December 2025 corrected from 990 to 940 kWh after the estimated bill was replaced by a real reading.
---

When people ask whether it worked, I can either say "yes, two-thirds less" or show them this. The first answer is true. This one is more useful, because it shows *where* the energy went, and that tells you what to do first in a house like mine.

## The two years side by side

The grey line is 2023, the last full year with the gas boiler and no insulation to speak of. The red one is 2025, the first full year after everything except the internal wall insulation was done. Both are gas and electricity added together, in kilowatt-hours, so the boiler and the heat pump are measured the same way.

```chart
chart: line
title: Monthly energy use, 2023 and 2025
text: Gas and electricity together. The gap is widest in the coldest months.
labels: [Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec]
series:
  - name: "2023"
    values: [2900, 2600, 2200, 1500, 900, 600, 550, 560, 800, 1500, 2200, 2800]
  - name: "2025"
    values: [980, 860, 700, 450, 300, 240, 230, 235, 290, 480, 760, 940]
highlight: "2025"
unit: kWh
notes:
  - at: Jul
    label: Summer is hot water only
source: Monthly meter readings. Gas converted to kWh with the supplier's own factor.
```

Two things stand out. In July and August the lines nearly meet: the house was only heating water, and a heat pump does that about as well as a boiler once you count the extra electricity. And in January the gap is almost two thousand kilowatt-hours. That is where the money was.

> [!NOTE]
> 2025 was a slightly milder winter than 2023 — about 6% fewer heating degree-days. Adjusting for that moves the 2025 total from 6,465 to roughly 6,850 kWh. Still about a third.

## What the year cost

Prices moved a lot over the period, so the bills compare less neatly than the kilowatt-hours. Here is what I actually paid, including standing charges, which didn't go away.

```stats
title: 2023 against 2025
items:
  - value: "19,110"
    label: kWh used in 2023
  - value: "6,465"
    label: kWh used in 2025
    change: "−66%"
    trend: good
  - value: "£2,410"
    label: paid in 2023
  - value: "£1,190"
    label: paid in 2025
    change: "−£1,220"
    trend: good
source: Bills, including standing charges. The gas standing charge stopped when the meter was capped in October 2024.
```

The money fell by about half, not two-thirds, because a kilowatt-hour of electricity costs roughly four times a kilowatt-hour of gas. The heat pump's efficiency covers most of that gap, not all of it.

## Where the drop came from

This is the part I can only estimate, because the jobs overlapped. I used the months between jobs, and the degree-days for each, to split the saving. The bars are the share of the 12,645 kWh that went.

```chart
chart: bar
title: Where the saving came from
text: My estimate, from the readings between each job.
labels: [Heat pump instead of boiler, Loft insulation, Draught-proofing, Lower flow temperature, Solar panels]
series:
  - name: Share of the saving
    values: [58, 16, 11, 8, 7]
unit: "%"
source: Estimated from monthly readings and degree-days. Treat the smaller bars as ±3 points.
```

The heat pump did most of it, but I don't think it would have worked as well in the house as it was. Before the loft and the draughts, the radiators needed water at 65 °C to keep up in January, and at that temperature a heat pump is barely better than a boiler. After them, 45 °C was enough. That is the real reason to insulate first: not the kilowatt-hours it saves directly, but the temperature it lets you heat at.

## What I'd tell myself in 2022

```steps
title: In the order I'd do it again
items:
  - title: Read the meters every month, starting now
    text: A year of "before" is worth more than any survey.
    meta: Free
  - title: Fix the draughts
    text: The cheapest kilowatt-hours in the house. See the [twelve fixes](/blog/a-draught-strip-and-eleven-other-cheap-fixes/).
    meta: About £200
  - title: Top up the loft
    meta: About £1,400
  - title: Turn the boiler's flow temperature down and live with it for a winter
    text: It tells you which radiators are too small before you buy anything.
    meta: Free
  - title: Then the heat pump
    meta: About £3,600 after the grant
```

The internal wall insulation came last and is too new to show up here. That will be next January's post.
