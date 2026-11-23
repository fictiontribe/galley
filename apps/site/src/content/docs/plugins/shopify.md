---
title: Shopify
description: The Shopify plugin — product and collection pickers, store tools for the assistant, a publish check, a product-copy switch — and the storefront starter that runs a shop's pages from Galley.
group: extend
order: 5
---

This page is for developers and store owners. A Shopify store keeps what it is good at — products, prices, stock, cart, checkout, orders. Galley runs everything a visitor sees before checkout, as files in the site's repository. *Status: the plugin is built into the app; the storefront starter is in progress.* The docs didn't connect a real store; everything below about the store comes from the code and [`docs/shopify.md`]({repository}/blob/main/docs/shopify.md).

Shopify is a trademark of Shopify Inc. Galley is not made, sponsored or endorsed by Shopify.

## The two pieces

- **`@galley/plugin-shopify`** ([`packages/plugins/shopify`]({repository}/tree/main/packages/plugins/shopify)) — built into the app, can be turned off on the **Plugins** screen. It adds product and collection pickers for section fields (the `shopify-products` data source), five tools for the assistant and MCP (`shopify_store_status`, `shopify_search_products`, `shopify_get_product`, `shopify_list_collections`, `shopify_update_product_copy`), and a check before publishing.
- **`starters/astro-storefront`** — a Caddow shop that works with no store connected: a demo catalogue and a bag that never takes payment. `galley starters` lists it as `storefront`; it is still in progress.

## Connect a store

1. **Storefront access.** In the store's admin, install the **Headless** sales channel and create a storefront with product listings, collections and carts. It gives a public token (fine in the site's files) and a private one (for servers only). Neither is required: products, collections, search and carts can be read without a token, with smaller queries.
2. **Tell the site.** Put the store's address in `src/data/shop/store.json` (`"domain": "your-store.myshopify.com"`), and publish.
3. **Tell the app.** **Plugins** › **Shopify** › **Store address** — the same store; the app refuses to guess if the plugin and the site name different ones. Section fields that hold a product or collection now pick from the store.
4. **Only if the assistant should edit product copy:** an Admin app (client ID and secret, or an older `shpat_…` token) with `read_products` and `write_products`, then switch on **Let the assistant edit product copy on Shopify**.

## What the assistant can change

| | |
| --- | --- |
| Can read, always | Whether the store answers, what the tokens allow, products, collections. |
| Can change, only when switched on | A product's title, description, search title and description, and picture descriptions. |
| Never | Prices, stock, availability, status, handles, collections, orders, customers; it deletes nothing. |

**Product-copy changes go live in the store at once.** They don't wait in Proof, and Discard, Undo and Version history can't take them back. The assistant shows the current and new text and waits for a yes before each change; over MCP the tool is marked destructive. Everything else — pages, product stories, the lookbook — waits in Proof as usual.

## Before publishing

The plugin checks every product and collection the pending pages name. One the store no longer has is shown in Proof and the Publish window under "Shopify"; you can still publish, and the page leaves that product out.

## Next

- Limits, caching, the data source and testing without a store: [`docs/shopify.md`]({repository}/blob/main/docs/shopify.md#for-developers).
- [Plugins](/docs/plugins/), [Starters](/docs/astro/starters/).
