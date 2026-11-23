/**
 * The storefront starter's seed script (starters/astro-storefront/scripts/
 * seed-shopify.mjs) against the fake store on a local port: it makes the
 * demo catalogue's collections and products with the documented Admin
 * mutations, puts them on the named sales channel, leaves what is already
 * there alone, signs in with client credentials, and stops plainly on a
 * missing permission — without printing a token.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createShopifyFake, type ShopifyFake } from "./fake/shopify-fake.mjs";

const run = promisify(execFile);
const STARTER = resolve(__dirname, "../../../../starters/astro-storefront");
const SCRIPT = resolve(STARTER, "scripts/seed-shopify.mjs");
const CATALOGUE = JSON.parse(readFileSync(resolve(STARTER, "src/data/shop/catalogue.json"), "utf8"));
const TOKEN = "shpat_seed0123456789abcdefSECRET";
const servers: Server[] = [];

afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

async function start(options: Parameters<typeof createShopifyFake>[0] = {}): Promise<ShopifyFake> {
  const fake = createShopifyFake({ catalogue: { shop: CATALOGUE.shop, collections: [], products: [] }, adminToken: TOKEN, ...options });

  servers.push(await fake.listen(0));
  return fake;
}

async function seed(fake: ShopifyFake, env: Record<string, string>, args: string[] = []) {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH!, SHOPIFY_STORE_DOMAIN: fake.state.origin, ...env }, cwd: STARTER });

    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };

    return { code: failure.code, out: failure.stdout + failure.stderr };
  }
}

describe("seed-shopify.mjs", () => {
  it("makes every collection and product, with pictures from the site's address, and puts them on the channel", async () => {
    const fake = await start();
    const result = await seed(fake, { SHOPIFY_ADMIN_TOKEN: TOKEN }, ["--images-from", "https://shop.example.com", "--publication", "Headless storefront"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain(`made 3 collections and 17 products, 20 put on “Headless storefront”`);
    expect(result.out).not.toContain(TOKEN);
    expect(fake.collections.map((collection) => [collection.handle, collection.products.length])).toEqual([
      ["coats", 9],
      ["knitwear", 5],
      ["trousers", 3],
    ]);
    const coat = fake.product("field-coat")!;

    expect(coat).toMatchObject({ title: "Field coat", status: "ACTIVE", options: [{ name: "Size", values: ["XS", "S", "M", "L", "XL"] }] });
    expect((coat.variants as unknown[]).length).toBe(5);
    expect(coat.images[0]).toMatchObject({ url: "https://shop.example.com/images/pieces/field-coat.webp", altText: expect.stringContaining("field coat") });
    expect(fake.state.published).toHaveLength(20);

    // Again: everything is there, so nothing is made twice.
    const again = await seed(fake, { SHOPIFY_ADMIN_TOKEN: TOKEN });

    expect(again.code).toBe(0);
    expect(again.out).toContain("made 0 collections and 0 products");
    expect(again.out).toContain("Already there, left as they are: collection coats");
  }, 60_000);

  it("signs in with a Dev Dashboard app's client ID and secret", async () => {
    const fake = await start({ adminToken: undefined, clientId: "app-1", clientSecret: "secret-for-app-1" });
    const result = await seed(fake, { SHOPIFY_ADMIN_CLIENT_ID: "app-1", SHOPIFY_ADMIN_CLIENT_SECRET: "secret-for-app-1" }, ["--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("would make 3 collections and 17 products");
    expect(fake.state.calls.some((call) => call.path === "/admin/oauth/access_token")).toBe(true);
  }, 60_000);

  it("stops plainly on a missing permission or a refused token", async () => {
    const fake = await start({ scopes: ["read_products"] });
    const missing = await seed(fake, { SHOPIFY_ADMIN_TOKEN: TOKEN });

    expect(missing.code).toBe(1);
    expect(missing.out).toContain("needs the write_products permission");
    const refused = await seed(fake, { SHOPIFY_ADMIN_TOKEN: "shpat_wrong0123456789wrong" });

    expect(refused.code).toBe(1);
    expect(refused.out).toContain("didn't accept the Admin API token");
    expect(refused.out).not.toContain("shpat_wrong");
  }, 60_000);
});
