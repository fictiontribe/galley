# A shop run from Galley (headless Shopify)

A Shopify store keeps what it is good at: products, prices, stock, the cart,
checkout and orders. Galley runs everything a visitor sees before checkout —
the shop's pages, the campaigns and editorial around the products, the
look — as files in the site's repository, edited three ways and published
through Proof like any other site. Its assistant can also look products up
and, only if you allow it, keep product copy in order.

Two pieces do this:

- **`starters/astro-storefront`** — "Caddow", an Astro shop for an invented
  coat and knitwear label. Works with no store connected (a demo catalogue
  and a bag that never takes payment).
- **`@galley/plugin-shopify`** — built into the app, can be turned off on the
  Plugins screen. Product and collection pickers for page sections, store
  tools for the assistant and MCP, a publish check, and a product-copy tool
  behind a switch.

- [For store owners](#for-store-owners)
- [For developers](#for-developers)
- [Sources](#sources)

Shopify is a trademark of Shopify Inc. Galley is not made, sponsored or
endorsed by Shopify; the name is used only to say what the plugin and the
starter connect to.

---

## For store owners

### What lives where

| In the store's admin | In the site (Galley) |
| --- | --- |
| Products: names, descriptions, photographs, options, variants | The home page, campaigns, the lookbook, the journal |
| Prices, stock, availability, collections | Which products a page shows, in which order (by **handle**) |
| Cart, checkout, payment, tax, delivery, orders, customers | The story around each product: fit, how it is made, what goes with it |
| Checkout branding, the checkout's cookie banner | The look: colours, type, photographs of the label |

A page names a product by its **handle** — the last part of its address in
the store, like `field-coat`. The page stores that word; the price, stock
and pictures come from the store when the site is built, and price and stock
are checked again in the visitor's browser.

### Connecting a store

**1. Storefront access (what the site reads).** In the store's admin, install
the **Headless** sales channel, then *Create storefront*. Open the
storefront, *Edit* the **Storefront API permissions** and keep product
listings, collections and carts. Put your products on that sales channel.
The storefront page shows two tokens:

- the **public** token, meant to be seen by shoppers (it may go in the
  site's `src/data/shop/store.json` as `publicToken`);
- the **private** token, for servers only — use it for builds
  (`SHOPIFY_STOREFRONT_PRIVATE_TOKEN` in the host's environment) or in the
  plugin's settings; never in a file.

Neither is required: the Storefront API can be read **without a token** for
products, collections, search and carts. Without one, queries are limited in
size (complexity 1,000) and stock counts, product tags, metafields and menus
can't be read. The site's requests are sized for that.

**2. Tell the site.** Put the store's address in
`src/data/shop/store.json` (`"domain": "your-store.myshopify.com"`), or set
`SHOPIFY_STORE_DOMAIN` where the site is built. Publish. The shop now shows
the store's products; the bag becomes the store's cart; "Check out" opens the
store's checkout.

**3. Tell the app.** On the Plugins screen, open **Shopify** and fill in the
**Store address** (the same store — the app refuses to guess if the plugin
and the site name different stores) and, if you want, the private token.
Section fields that hold a product or collection now pick from the store.

**4. Only if the assistant should edit product copy** — an Admin API token.
Since 1 January 2026 new custom apps are made in the **Dev Dashboard**, not
in the store's admin (apps made in the admin before then keep working, and
their `shpat_…` tokens too):

1. In the Dev Dashboard, create an app; on its version, choose the access
   scopes **`read_products`** and **`write_products`** (and **`write_files`**
   if the assistant should change picture descriptions), release the
   version, and install the app on your store. The app and the store must
   belong to the same organisation (for a development store, create it from
   the Dev Dashboard's *Dev stores* page).
2. In the app's *Settings*, copy the **Client ID** and **Client secret**
   into the plugin's settings ("Admin app client ID" and "Admin app client
   secret"). The plugin exchanges them for an Admin token that lasts 24
   hours and renews it itself. An older admin-made app's `shpat_…` token can
   go in "Admin API access token" instead.
3. Switch on **"Let the assistant edit product copy on Shopify"**. The
   switch says beside it what turning it on means: the changes go live in
   the store at once.

### What the assistant can and cannot change

| | |
| --- | --- |
| **Can read** (always) | Whether the store answers and which API version it uses, what the tokens allow, products (search and full detail), collections. With no store connected, the demo catalogue. |
| **Can change, only when switched on** | A product's **title**, **description**, **search title** and **search description**, and its **picture descriptions** (alt text). |
| **Never** | Prices, stock, availability, status, handles, collections, deleting anything, orders, customers. |

> **Product-copy changes go live in the store at once.** They are not part of
> the site's pending changes, they don't wait in Proof, and Discard, Undo and
> Version history in the app can't take them back. The assistant is told to
> show you the exact current and new text and to wait for your yes before it
> changes anything, and it reports what the text was before and after. Over
> MCP the tool is marked destructive and open-world, so harnesses ask before
> calling it. Turn the switch off and the tool disappears.

Everything else the assistant does — pages, product stories, the lookbook —
changes files and waits in Proof as usual.

### Before publishing

The plugin checks every product and collection the pending pages name. A
handle the store no longer has (a product deleted or renamed) is shown in
Proof and in the Publish dialog, under “Shopify”: “*Home* shows the product
*discontinued-smock* …, which your-store.myshopify.com doesn't have any
more.” The field itself says so too (“No longer in the shop”). You can still
publish — the page simply leaves that product out until it is changed. The
warning is also kept in the plugin's log on the Plugins screen.

### Consent

The site asks for consent only when it runs something that needs it (its
banner appears when an analytics or marketing script is switched on). When a
visitor answers, the answer is passed to the store's **customer privacy**
service, so the store's own analytics and checkout respect it — Shopify's
script for that loads only then, never on page load. The store's checkout
has its own cookie banner: set it in the store's admin under *Settings ›
Customer privacy › Cookie banner*. You remain responsible for your analytics
following the consent rules where you sell.

### Going live

- **Domain**: the site is served by your host at your domain; checkout is
  served by the store (its own domain or a checkout subdomain you connect
  in the store's admin). Put the checkout's domain in `store.json` as
  `checkoutDomain` if it differs from the store's address.
- **Checkout look**: logo, colours and fonts of checkout are set in the
  store's admin (*Settings › Checkout*); the site can't change them.
- **Rebuild on change**: products are read when the site is built. Add a
  deploy hook to the store's product webhooks (`products/create`,
  `products/update`, `products/delete`, `collections/update`), or rebuild on
  a schedule. Price and stock are re-checked in the browser, and the cart
  refuses what can't be bought, so a stale page never sells what has gone.

---

## For developers

### The starter (`starters/astro-storefront`)

- **Loader** — `src/lib/shop/loader.ts` is an Astro object loader (Astro 7's
  content-loader API: `load()` at build time fills the collection's data
  store; digests skip unchanged entries). `storeProducts` and
  `storeCollections` are filled from `src/lib/shop/store.ts`: the store's
  Storefront API (`POST https://<store>/api/2026-10/graphql.json`; product
  handles a page at a time, then one product per request so tokenless
  requests stay under complexity 1,000; collections and their members), or
  `src/data/shop/catalogue.json` when no domain is set. A configured store
  that can't be read fails the build. Galley lists these two collections as
  "custom loader, not editable here" — they are the store's.
- **Fixture** — `catalogue.json` is the shape the loader produces:
  `{ shop, collections: [{ handle, title, description, image, products }],
  products: [{ handle, title, description, descriptionHtml, productType,
  seo, options, images, variants: [{ sku, selectedOptions, price,
  availableForSale, quantityAvailable, image }] }] }`. Seventeen products,
  89 variants, some sold out, one entirely. The seed script and the test
  store read the same file.
- **Client** — `src/scripts/shop.ts`, bundled by Astro, no framework. Demo
  mode: the bag in `localStorage`. Store mode: `cartCreate`, `cartLinesAdd`,
  `cartLinesUpdate`, `cartLinesRemove`, `cart(id:)`; `checkoutUrl` is asked
  for again when "Check out" is pressed and the browser goes there. The
  public token (if any) goes in `X-Shopify-Storefront-Access-Token`; the
  private token never reaches the browser. No request to the store before
  the visitor does something (product photographs are the exception once a
  store is connected: they live on its image service). Live price and stock
  are fetched on the first pointer, key, touch or focus; the price and stock
  lines keep their height, so nothing shifts.
- **Pages** — `/shop/` and `/shop/<collection>/` (filters as plain form
  controls the script applies), `/products/<handle>/` (static, schema.org
  `Product` with an `Offer` per variant, `BreadcrumbList`), `/bag/`,
  `/search/` (reads `/search.json`, built with the site). All addresses go
  through `withBase()`; sub-path builds work.
- **Sections** — `featured-product`, `product-rail`, `collection-grid`,
  `shop-the-look` hold handles; `galley.config.json` marks those fields
  `"dataSource": "shopify-products"` / `"shopify-collections"`.
- **Seed** — `scripts/seed-shopify.mjs` makes the catalogue in a
  development store with `productSet` (synchronous), `collectionCreate`
  and `publishablePublish`, using an Admin token or client credentials.
  It only adds; existing handles are left alone. Stock is not set.

### The plugin (`packages/plugins/shopify`)

Settings: `storeDomain` (`SHOPIFY_STORE_DOMAIN`), `storefrontPrivateToken`
and `storefrontPublicToken` (secrets), `adminToken` (secret), `adminClientId`
and `adminClientSecret` (secret) for the client-credentials grant,
`allowProductEdits` (a toggle, saved as `on`/`off`), `apiVersion` (default `2026-10`). Secrets
go to the app's secret store, are never returned by a route (only whether
they are set and their last four characters), and are cut out of the
plugin's log and error messages.

| Tool | Effect | What it does |
| --- | --- | --- |
| `shopify_store_status` | read-only, open-world | Connected or demo; the store's name and currency; asked vs answering API version (fall-forward shown); Storefront access kind; Admin scopes (`currentAppInstallation.accessScopes`); whether copy editing is on and possible |
| `shopify_search_products` | read-only, open-world | `search(types: [PRODUCT])` or the first products; handle, title, type, price, availability |
| `shopify_get_product` | read-only, open-world | `product(handle:)`: descriptions, SEO, options, variants, pictures, collections |
| `shopify_list_collections` | read-only, open-world | Handles, titles, descriptions |
| `shopify_update_product_copy` | **destructive, open-world; `enabledBy: allowProductEdits`** | `productByIdentifier` → `productUpdate(product: { id, title?, descriptionHtml?, seo? })` → `fileUpdate(files: [{ id, alt }])` → read again; returns before and after. Description HTML with anything but paragraphs, emphasis, lists, headings, quotes and links (https, mailto, relative) is refused, not cleaned. |

Data sources: `shopify-products` and `shopify-collections` (search, and
look up a saved handle). Hook: `beforePublish` warns, never refuses.

Which store: the plugin's settings; else the store the site names in
`src/data/shop/store.json` (read without a token); else the site's demo
catalogue. Settings and site naming different stores is refused. The write
tool works only with a store connected in the settings.

Errors are classified by status and documented codes: 401 (token refused),
402 (frozen), 403, 404 (no store at that address), 423 (locked), 429 or
`THROTTLED` (Admin requests are retried up to three times, waiting for the
cost bucket to refill — `throttleStatus.restoreRate` — at most 4 s),
430 (security rejection), `ACCESS_DENIED` (names the missing scope from
`requiredAccess`), `MAX_COMPLEXITY_EXCEEDED` / `MAX_COST_EXCEEDED`.

### The data-source contribution and the picker

The plugin API's additions — `dataSources` on a plugin, `enabledBy` on a
tool, `dataSource` on a field — are described in
[docs/plugins.md](plugins.md#data-sources). The picker's route:
`GET /api/sites/:siteId/data-sources/:sourceId?q=…&limit=…` (search) or
`?value=…` (look up), answering `{ source, items }` / `{ source, item }`.

### Limits and caching (from Shopify's documentation)

- **Storefront API**: no rate limit for buyer traffic; bots and crawlers are
  limited; checkout creation is throttled (`200 Throttled`, retry with
  backoff); suspicious requests get `430`. Tokenless queries are limited to
  complexity 1,000. Requests from buyers made through a server should carry
  `Shopify-Storefront-Buyer-IP`; builds and the plugin are not buyer
  traffic, and the browser talks to the store directly, so neither sends it.
- **Admin GraphQL API**: calculated query cost; a 1,000-point bucket
  restoring 50 points a second in the documented example; one query may
  cost at most 1,000.
- **Versions**: quarterly (`YYYY-01/04/07/10`), each stable for at least 12
  months; 2026-10 is the latest stable on 2026-11-23 (supported until
  2027-10-16; 2027-01 is the release candidate). A request for a retired
  version is answered by the oldest supported one, and
  `X-Shopify-API-Version` says which; the build warns when that happens.
- **Caching**: the site reads the store once per build; the browser asks
  again only for live price, stock and the cart.

### Trying a live API without a store

Shopify's **mock.shop** (`https://mock.shop/api`) is an auth-free Storefront
API backed by sample stores. The starter doesn't use it — a starter must
build offline — but you can point a copy at it to try a live API.

### Testing without a store

`packages/plugins/shopify/test/fake/` is a strict local stand-in for one
store: Storefront and Admin GraphQL endpoints and the client-credentials
endpoint, checked against the documented schema (unknown and deprecated
fields refused, tokenless limits, scopes, throttling), with carts and a
checkout page. Run it for the starter:

```sh
node packages/plugins/shopify/test/fake/serve.mjs --port 4655 \
  --catalogue starters/astro-storefront/src/data/shop/catalogue.json \
  --public starters/astro-storefront/public
SHOPIFY_STORE_DOMAIN=http://127.0.0.1:4655 npm run build   # in the starter
```

(Plain `http://` is accepted only for 127.0.0.1 and localhost.)

---

## Sources

All read on 2026-11-23.

- Storefront API (endpoint, tokenless access and its limits, token headers,
  rate limits): https://shopify.dev/docs/api/storefront
- API versioning and the supported-versions table: https://shopify.dev/docs/api/usage/versioning
- Product, ProductVariant, ProductOption, ProductOptionValue, Image (2026-10):
  https://shopify.dev/docs/api/storefront/latest/objects/Product,
  …/ProductVariant, …/ProductOption, …/ProductOptionValue, …/Image
- Cart, CartCost, CartLine, CartLineCost, CartUserError, cartLinesAdd:
  https://shopify.dev/docs/api/storefront/latest/objects/Cart (and the
  linked object and mutation pages)
- Managing a cart and `checkoutUrl`: https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage
- Filtering products in a collection: https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/products-collections/filter-products
- `search` and `products` queries: https://shopify.dev/docs/api/storefront/latest/queries/search,
  https://shopify.dev/docs/api/storefront/latest/queries/products
- Getting Storefront access (Headless channel): https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/getting-started
- Customer Privacy API (`setTrackingConsent`, headless parameters,
  `visitorConsentCollected`): https://shopify.dev/docs/api/customer-privacy
- Consent in Hydrogen (same-origin note, checkout domain, the admin banner):
  https://shopify.dev/docs/storefronts/headless/hydrogen/analytics/consent;
  the consent script address from Hydrogen's source,
  `packages/hydrogen/src/core/shopify-scripts/constants.ts` in
  https://github.com/Shopify/hydrogen
- Admin GraphQL API (endpoint, rate limits, error codes): https://shopify.dev/docs/api/admin-graphql
- `productUpdate`, `ProductUpdateInput`, `productByIdentifier`, `fileUpdate`,
  `productUpdateMedia` (deprecated), `MediaImage`, `currentAppInstallation`,
  `productSet` and its inputs, `collectionCreate`, `publishablePublish`,
  `publications`, `Publication`, `Catalog`:
  https://shopify.dev/docs/api/admin-graphql/latest/mutations/productUpdate (and the sibling pages)
- Webhook topics: https://shopify.dev/docs/api/webhooks/latest
- Custom apps no longer made in the admin from 2026-01-01:
  https://shopify.dev/changelog/legacy-custom-apps-can-t-be-created-after-january-1-2026
- Client-credentials grant for Dev Dashboard apps (24-hour tokens, same
  organisation): https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens
- mock.shop: https://mock.shop/
- Astro content loaders: https://docs.astro.build/en/reference/content-loader-reference/
  (and `astro@7.4.13`'s `dist/content/loaders/types.d.ts` in this workspace)
