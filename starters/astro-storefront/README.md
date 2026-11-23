# Galley + Astro storefront starter

A shop for a small fashion label, built with [Astro](https://astro.build) and
a Shopify store. The store keeps what it is good at — products, prices,
stock, the cart, checkout and orders. Everything a visitor sees before
checkout is this site: the shop's pages, the campaign, the lookbook, the
journal, the story around every piece, the look. Those are plain files.

It works **with no store connected**: a demo catalogue of seventeen pieces in
three collections, and a bag that keeps what you choose and says plainly that
nothing is charged. Connect a store and the same pages show its products,
the bag becomes the store's cart, and "Check out" opens the store's own
checkout.

The sample label is **Caddow**, an invented coat and knitwear maker — every
person, shop, product and town here is made up. Replace it with your own.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/fictiontribe/galley-astro-storefront)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffictiontribe%2Fgalley-astro-storefront)

Every word lives in Markdown and JSON, so you can edit it in any text editor,
or with [Galley](https://github.com/fictiontribe/galley), the open-source AI
CMS for static sites this starter is written for. Nothing here depends on
Galley: it is an ordinary Astro project.

## The two-minute start

**Without a store** (the demo shop):

```sh
npm create astro@latest -- --template fictiontribe/galley-astro-storefront
cd <your-project>
npm run dev
```

Open the shop, choose a size, add to the bag, change the quantity, press
"Check out": you get the demo notice, not a payment page.

**With a store**:

1. In your store's admin, install the **Headless** sales channel and create a
   storefront (Sales channels › Headless › Create storefront). Under
   *Storefront API permissions*, keep at least products, collections and
   carts. Put your products on that channel.
2. Put the store's address in `src/data/shop/store.json`:

   ```json
   { "domain": "your-store.myshopify.com", "publicToken": "", "apiVersion": "2026-10", "checkoutDomain": "" }
   ```

   That is enough: products, collections and carts can be read without a
   token. Add the storefront's **public** access token as `publicToken` to
   lift the tokenless limits (it is meant to be seen by shoppers). For
   builds you can instead set `SHOPIFY_STORE_DOMAIN`,
   `PUBLIC_SHOPIFY_STOREFRONT_TOKEN`, and — build only, never in a file —
   `SHOPIFY_STOREFRONT_PRIVATE_TOKEN`.
3. `npm run build`. Products and collections are read from the store when the
   site is built; a product page exists for every product. A store that
   can't be read fails the build with a plain message — the site never falls
   back to demo products when it is meant to sell real ones.
4. Rebuild when products change (a deploy hook from the store's product
   webhooks, or a schedule). Price and stock are checked again in the
   visitor's browser, so a stale build never sells something that has gone.

Want the demo's seventeen pieces in a development store?
`node scripts/seed-shopify.mjs --images-from https://<where this site is online>`
creates them (see the top of the script for the permissions it needs).

## What you get

- **Shop pages** — the shop with filters (size, waist, colour, what can be
  sent now, an order) that work without any framework; a page per collection;
  a page per product with its photographs, choices, price, stock and the
  bag; a bag drawer and a bag page; search across the shop and the journal.
- **Editorial pages** — a campaign home page, the lookbook (every look's
  pieces link into the shop: shop the look), an atelier page, a journal with
  tags, stockists, contact, privacy and a not-found page.
- **Twenty-four section types**, each with its own schema. Four of them show
  the shop's products by **handle** — a plain string like `field-coat` in the
  content file:

  | Section | Use it for |
  | --- | --- |
  | `featured-product` | One product, large, with a line on why it matters |
  | `product-rail` | A row of products, picked by handle or from a collection |
  | `collection-grid` | The shop's collections as photograph tiles |
  | `shop-the-look` | One photograph and the pieces in it, with prices |
  | `campaign-hero`, `split-editorial`, `lookbook-grid`, `look`, `gallery`, `image-band`, `quote`, `statement`, `pieces`, `story`, `journal-list`, `stockists`, `chapters`, `marquee`, `newsletter`, `form`, `cta`, `contact`, `film`, `credits` | The editorial sections of the Caddow editorial starter |

  [`CONTENT-GUIDE.md`](./CONTENT-GUIDE.md) lists every field and variant.
- **Product stories** — `src/content/products/<handle>.md`: a fit note, the
  pieces that go with it, and any sections (how it is made, a look, a quote),
  shown on the product page under the buy box.
- **Thirty-one real photographs** and the shoot brief they were made from
  (`galley/photography/`), three looks (Chalk, Paper, Night), forms that
  send to the Galley inbox, a consent banner, and the e-mail link chooser.
- **Sections sized to what they hold** — one step of air above and below
  every section (`--space-section`, the top of the spacing scale in
  `src/styles/tokens.css`), shared between two sections on the same ground;
  only the campaign hero fills the screen. Crops are anchored on each
  photograph's focus point from `galley/photography/shots.json`. On a phone
  the shop's filters fold behind one "Filter and sort" button. Everything
  holds still under reduced motion and reads complete without JavaScript.

## Where things live

| What | Where |
| --- | --- |
| The store (or the demo) | `src/data/shop/store.json` |
| The demo catalogue | `src/data/shop/catalogue.json` (same shape the store loader produces) |
| Pages, lookbooks, journal, product stories | `src/content/` |
| Words in the interface (the bag, filters, search) | `src/data/site.json` → `labels` |
| Header and footer links | `src/data/navigation.json` |
| Colours, type, spacing | `src/styles/tokens.css` (and `themes/` for the three looks) |

## How the shop works

- **Build time**: `src/lib/shop/loader.ts` is an Astro content loader. It
  fills two collections, `storeProducts` and `storeCollections`, from the
  store's Storefront API (or the demo catalogue). Pages read them with
  `getCollection`. Product pages, prices, the structured data search engines
  read (schema.org `Product` with an `Offer` per variant, and breadcrumbs)
  and the sitemap all come from there.
- **In the browser**: `src/scripts/shop.ts`, a small script with no
  framework. Nothing is asked of the store until the visitor does something:
  the bag's count is read from this browser; live price and stock are
  fetched on the first click, key or touch; the cart is created on the first
  "Add to bag". The price line never changes height, so nothing moves when
  the live price arrives.
- **Checkout** is the store's: "Check out" asks the store for the cart's
  `checkoutUrl` and goes there. Payment, tax, delivery and the order are the
  store's. Checkout branding is set in the store's admin.
- **Consent**: when a visitor answers the consent banner, their answer is
  passed to the store's customer-privacy service (so the store's own
  analytics and checkout respect it). Shopify's script is loaded only then.
- **Demo mode**: with no store, the bag lives in the visitor's browser and
  "Check out" explains that nothing can be paid for. The bag is always
  labelled "Demo shop".

## For AI agents and search

The site kit also publishes an agent-readable version of the shop (from
`src/data/visibility.json`): a markdown copy of every page — a product's
copy keeps its price, its sizes and colours and what is sold out —
`llms.txt`, `llms-full.txt`, `agent.md`, `robots.txt`, `sitemap.xml` and
structured data. Product pages carry their own `Product` and breadcrumb
data; the kit adds none on top. The bag and search pages are left out.

## Campaign tags in forms

The forms read campaign tags (`utm_source`, `utm_campaign`…) only from the
address of the page they are on, and keep nothing — so a fresh copy shows no
cookie banner. To remember a visitor's first campaign across pages, give a
hidden field `"autofill": { "from": "utm", "key": "utm_campaign", "touch":
"first" }` in its `src/content/forms/*.json`: that stores the tags in the
visitor's browser, so the consent banner then asks first.

## Editing with Galley

In the project folder (`npm run galley` does the same):

```sh
npx galley-cms
```

Galley detects the collections and sections. Its Shopify plugin (built in,
can be turned off) lets a section's product field be picked from the store,
lets the assistant look products up, warns before publishing a page that
names a product the store no longer has, and — only if you switch it on —
lets the assistant change product copy in the store. **Those product-copy
changes go live in the store at once; they don't wait in Proof.** Everything
else (pages, stories, the look) waits in Proof until you publish.

## Looks, thumbnails, sizes

- Switch the look: `cp src/styles/themes/night.css src/styles/tokens.css`.
- `npm run sizes` makes the 640-pixel copies of the demo photographs used in
  `srcset` (a store's own photographs are resized by the store).
- `PLAYWRIGHT_MODULES=<a node_modules with playwright-core> npm run thumbnails`
  remakes Galley's section, template and look pictures in `galley/`.
- `PLAYWRIGHT_MODULES=… npm run check:type` checks that the build and
  `astro dev` set identical type (Proof shows a build beside a dev page): every
  piece of text on every page, its font properties, width and the first
  screen's pixels, at 1440 and 390 wide. `--looks` runs all three looks;
  `--linked` runs from a copy whose `node_modules` is a link, the layout in
  which dev used to refuse the font files.

## Deploy

`npm run build` writes a plain static site to `dist/`. The buttons above copy
this repository to your account and deploy it (Cloudflare uses
`wrangler.jsonc`; Vercel needs nothing). `netlify.toml` covers Netlify. Pass
`--site https://your-domain` (and `--base /path` for a sub-path) to the
build so canonical links and the sitemap are right. Set the store variables
in the host's environment, never a private token in the repository.

## Trademarks and licence

MIT — see [`LICENSE`](./LICENSE). The photographs were made for this
template and ship under the same licence.

Shopify is a trademark of Shopify Inc. This starter is not made, sponsored or
endorsed by Shopify; it is named only to say which store it connects to.
Astro is a trademark of its owners. "Caddow" and everything about it are
invented.
