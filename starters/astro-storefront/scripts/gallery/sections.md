---
# The section gallery's fixture: one example of every section type, in the
# order of galley.config.json. scripts/make-thumbnails.mjs photographs each
# one alone (galley/sections/<type>.webp). Keep the examples short enough to
# read in a 640-pixel picture, and keep one entry per type.
title: Section gallery
description: Every section type, rendered alone.
sections:
  - type: campaign-hero
    eyebrow: Autumn–Winter 2026
    heading: The *long* afternoon.
    text: Eight coats, shot on a harbour wall in the last two hours of light.
    cta:
      label: See the lookbook
      href: /lookbook/aw26-the-long-afternoon/
    image: /images/campaign/aw26-harbour-wall.webp
    imageAlt: A woman in a long rust-coloured coat stands against a lime-washed harbour wall, her shadow thrown long across it by a low sun.
    size: tall
    imageFocus: right
  - type: split-editorial
    tone: muted
    eyebrow: The workroom
    heading: Every coat is cut on a table you can see *from the street*.
    text: Four of us, one long table, and the windows of a rope-maker's loft.
    image: /images/atelier/workroom.webp
    imageAlt: "The Caddow workroom: a long cutting table under tall windows, rolls of undyed cloth and a rail of coats, low sun across the floor."
    ratio: landscape
    cta:
      label: Visit the atelier
      href: /atelier/
  - type: lookbook-grid
    heading: The *hour before dark*
    lookbook: aw26-the-long-afternoon
    limit: 3
    columns: 3
    captions: false
  - type: look
    eyebrow: Look 01
    heading: The field coat
    image: /images/lookbooks/aw26/look-01.webp
    imageAlt: A woman in an open, undyed wool field coat and wide dark trousers walks along the foot of a sunlit wall.
    pieces:
      - name: Field coat
        detail: Undyed Shetland wool
        price: £640
      - name: Rib polo
        detail: Lambswool, oat
        price: £210
  - type: gallery
    heading: A week at the table
    layout: mosaic
    items:
      - image: /images/atelier/workroom.webp
        imageAlt: "The Caddow workroom: a long cutting table under tall windows, rolls of undyed cloth and a rail of coats, low sun across the floor."
      - image: /images/atelier/weave.webp
        imageAlt: Close up, the twill of undyed Shetland wool and its loose selvedge, in raking light.
      - image: /images/atelier/hands.webp
        imageAlt: Hands marking undyed wool with tailor's chalk along a wooden rule.
      - image: /images/lookbooks/aw26/look-03.webp
        imageAlt: An older woman in a long belted bone-coloured wrap coat stands side-on to a wall, her shadow crisp beside her.
      - image: /images/lookbooks/ss26/look-02.webp
        imageAlt: An older woman in a light putty trench walks down pale steps with the arch's shadow across her.
  - type: image-band
    image: /images/campaign/wall-shadow.webp
    imageAlt: A coat hangs from an iron hook on a long sunlit wall, its shadow stretched out beside it.
  - type: quote
    quote: I wanted a coat you could sleep in on a train and still wear to a funeral the next morning.
    name: Hesper Lowe
    role: Founder and designer
    image: /images/people/hesper-lowe.webp
    imageAlt: Hesper Lowe, Caddow's founder, by the workroom window with a tape measure round her neck.
    size: medium
  - type: statement
    eyebrow: The label
    heading: We make *coats*, and the knits that go under them. Forty of each.
  - type: pieces
    heading: Four to begin with
    columns: 4
    items:
      - image: /images/pieces/field-coat.webp
        imageAlt: The undyed wool field coat on a wooden hanger against a sunlit white wall.
        name: Field coat
        price: £640
      - image: /images/pieces/rib-polo.webp
        imageAlt: An oat rib-knit polo folded on a stone ledge in low sun.
        name: Rib polo
        price: £210
      - image: /images/pieces/gansey.webp
        imageAlt: A navy fisherman's gansey laid flat on unbleached linen, its stitch pattern caught by low light.
        name: Gansey
        price: £260
      - image: /images/pieces/blanket-scarf.webp
        imageAlt: A folded oat lambswool scarf with a single blue stripe, draped over the back of a wooden chair.
        name: Blanket scarf
        price: £120
  - type: story
    layout: two-column
    dropCap: true
    heading: Forty is not a marketing number
    text: |-
      Caddow began with a single coat, cut forty times on a borrowed table. Forty is what one cutter can make in a month without hurrying, and what one roll of good Shetland will give if you lay the pattern carefully.
  - type: journal-list
    heading: Notes from the workroom
    limit: 3
  - type: stockists
    heading: Stockists
    groups:
      - marrowby
      - vellamy
      - kestrelmouth
  - type: marquee
    size: large
    items:
      - Undyed Shetland
      - Waxed cotton
      - Forty of each
      - Cut in Marrowby
  - type: newsletter
    heading: Four letters a year, *and no more*.
    text: When a lookbook is ready, when a coat comes back. Nothing else.
  - type: cta
    tone: inverse
    heading: Come and try one on.
    text: The workroom is open Thursday to Saturday, ten till five.
    cta:
      label: Plan a visit
      href: /contact/
    image: /images/campaign/wall-shadow.webp
    imageAlt: A coat hangs from an iron hook on a long sunlit wall, its shadow stretched out beside it.
  - type: contact
    heading: Write to the *workroom*.
    items:
      - label: Email
        value: studio@example.com
        href: mailto:studio@example.com
      - label: The workroom
        value: The Ropewalk, Marrowby
  - type: film
    eyebrow: Film
    heading: The Long Afternoon, *in two minutes and forty-eight seconds*.
    image: /images/film/the-long-afternoon.webp
    imageAlt: "A still from the film: a woman in a rust coat walks the length of the harbour wall at sunset."
    href: https://www.example.com/films/the-long-afternoon
    duration: "2:48"
  - type: form
    eyebrow: For shops
    heading: Carry Caddow in your *town*.
    form: stockist
  - type: chapters
    eyebrow: In the workroom
    heading: How a coat is made, *in 3 days*
    items:
      - heading: Day one, the cloth
        text: The Shetland comes off the roll and rests for a day before anyone cuts it.
        image: /images/atelier/weave.webp
        imageAlt: Close up, the twill of undyed Shetland wool and its loose selvedge, in raking light.
      - heading: Day two, the cut
        text: Marked out in chalk along a wooden rule and cut by hand, forty at a time.
        image: /images/atelier/hands.webp
        imageAlt: Hands marking undyed wool with tailor's chalk along a wooden rule.
  - type: credits
    eyebrow: Credits
    columns: 3
    items:
      - role: Photography
        name: Rafe Dunmore
      - role: Styling
        name: Lou Castellane
      - role: Casting
        name: Mina Sorell
  - type: featured-product
    eyebrow: Knitted in the round
    product: gansey
    text: A fisherman's gansey with no side seams to give way.
  - type: product-rail
    eyebrow: New this season
    heading: Four coats for *the hour before dark*
    products:
      - car-coat
      - field-coat
      - wrap-coat
      - overcoat
  - type: collection-grid
    tone: muted
    eyebrow: The shop
    heading: Coats, knitwear and *trousers*
  - type: shop-the-look
    eyebrow: Look 01
    heading: The field coat, *worn open*
    image: /images/lookbooks/aw26/look-01.webp
    imageAlt: A woman in an open, undyed wool field coat and wide dark trousers walks along the foot of a sunlit wall.
    products:
      - field-coat
      - rib-polo
      - wide-trouser
---
