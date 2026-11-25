---
title: Are your radiators big enough for a heat pump?
description: Most installers will quote you new radiators everywhere. Usually you need two or three. Here's how to work out which ones, with a tape measure and a calculator.
date: 2024-08-22
author: dougal-reay
tags: [Heating, How-to]
series: the-heating-year
seriesPart: 3
image: /images/blog/radiator.webp
imageAlt: A hand turning a brass key to bleed an old cream cast-iron radiator, a cloth catching the drips.
imageCaption: The front-room radiator, original to the house. It stayed.
takeaways:
  - A radiator's output falls to about half when the water drops from 70 °C to 50 °C.
  - Work out each room's heat loss, then check each radiator at 50 °C. Only replace the ones that fall short.
  - In Ines's house that was two radiators out of nine.
sources:
  - title: Radiator output correction factors (EN 442)
    href: https://www.example.com/en-442
  - title: Room-by-room heat loss calculation for the house, July 2024
ai: none
---

I've been in a lot of houses where the heat pump quote came with nine new radiators and nobody could say why. Radiators are rated at a big temperature difference — the catalogue figure assumes water much hotter than a heat pump makes — so at heat-pump temperatures every radiator looks too small on paper. Some of them are. Most aren't.

## Why output drops

A radiator gives off heat in proportion to how much warmer it is than the room, and a bit more than proportionally. Run it cooler and it gives off a lot less.

```chart
chart: column
title: The same radiator at different water temperatures
text: Share of its catalogue output, in a room at 20 °C.
labels: ["70 °C", "60 °C", "55 °C", "50 °C", "45 °C", "40 °C"]
series:
  - name: Output
    values: [100, 75, 63, 51, 40, 30]
unit: "%"
source: Correction factors for a typical panel radiator (exponent 1.3).
```

At 50 °C, the radiator gives about half what the label says. So the question for each room is simple: is half the label enough?

## Room by room

Ines and I worked through the house with a tape measure, the radiator labels (or the sizes, where the labels were long gone) and her heat-loss figures for each room on a −3 °C day.

```compare
title: Each room at 50 °C water
text: Heat needed on a cold day against what the radiator gives at 50 °C.
columns: [Heat needed, Radiator at 50 °C, Enough?]
rows:
  - label: Front room
    values: ["1,450 W", "1,520 W", "yes"]
  - label: Back room
    values: ["1,180 W", "1,240 W", "yes"]
  - label: Kitchen
    values: ["820 W", "610 W", "no"]
    note: Replaced with a double panel
  - label: Hall and stairs
    values: ["960 W", "1,010 W", "yes"]
  - label: Front bedroom
    values: ["1,050 W", "1,090 W", "yes"]
  - label: Back bedroom
    values: ["910 W", "640 W", "no"]
    note: Replaced with a taller double panel
  - label: Small bedroom
    values: ["520 W", "560 W", "yes"]
  - label: Bathroom
    values: ["480 W", "450 W", "partly"]
    note: Towel rail left as it was; the room runs a degree cooler
source: Heat loss from a room-by-room calculation; outputs from the radiator sizes and the correction factor at 50 °C.
```

Two to replace, one to live with. Compare that with the nine on the first quote.

## Do it yourself

```steps
title: Checking your own radiators
items:
  - title: Find each room's heat loss
    text: An installer must do this anyway; ask for the room-by-room figures, not just the total.
    meta: Ask for it
  - title: Find each radiator's rated output
    text: From its label, or from its height, length and type (single or double panel, with or without fins) in any maker's table.
    meta: 10 minutes a room
  - title: Halve it
    text: That is roughly its output at 50 °C. For 45 °C, take 40%.
  - title: Compare
    text: Where the halved figure is below the room's heat loss, that radiator needs to be bigger — or the room needs to lose less heat.
```

> [!CAUTION]
> Don't size radiators from the old boiler's behaviour alone. A room that was fine at 75 °C tells you nothing about 50 °C. Ines's test of [turning the boiler down for a winter](/blog/turning-the-flow-temperature-down/) does, and it agreed with these sums.
