#!/usr/bin/env node
// Runs the fake store on a local port, for trying the storefront starter
// and the seed script against something that behaves like the real APIs:
//
//   node packages/plugins/shopify/test/fake/serve.mjs --port 4655 \
//     --catalogue starters/astro-storefront/src/data/shop/catalogue.json \
//     --public starters/astro-storefront/public [--empty] \
//     [--admin-token T] [--client-id ID --client-secret S] [--public-token T]
//
// --empty starts a store with no products (to seed); --catalogue fills it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createShopifyFake } from "./shopify-fake.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);

  return at === -1 ? undefined : args[at + 1];
};
const port = Number(flag("port") ?? 4655);
const cataloguePath = flag("catalogue");
const catalogue = args.includes("--empty") || !cataloguePath ? undefined : JSON.parse(readFileSync(resolve(cataloguePath), "utf8"));
const fake = createShopifyFake({
  ...(catalogue ? { catalogue: args.includes("--empty") ? { ...catalogue, products: [], collections: [] } : catalogue } : {}),
  ...(flag("public") ? { publicDir: resolve(flag("public")) } : {}),
  ...(flag("admin-token") ? { adminToken: flag("admin-token") } : {}),
  ...(flag("client-id") ? { clientId: flag("client-id"), clientSecret: flag("client-secret") } : {}),
  ...(flag("public-token") ? { storefrontPublicToken: flag("public-token") } : {}),
});

await fake.listen(port);
console.log(`fake store on http://127.0.0.1:${port} (Storefront /api/2026-10/graphql.json, Admin /admin/api/2026-10/graphql.json)`);
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
