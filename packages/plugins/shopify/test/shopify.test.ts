/**
 * The Shopify plugin against a strict local fake of the Storefront API,
 * the Admin GraphQL API and the client-credentials endpoint (shapes from
 * shopify.dev, API version 2026-10, read 2026-11-23). The kit's checks;
 * tools through the real plugin registry (so the switch, the declared
 * effects and secret handling are the engine's); data sources in store
 * and demo mode; the publish check. Nothing here reaches the network:
 * the global fetch throws for the whole file.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describePlugin } from "@galley/plugin-kit/vitest";
import type { SiteService } from "@galley/plugin-kit";
import { createFileSecretStore } from "@galley/core/ai";
import { createPluginRegistry, createPluginSettingsStore, type PluginRegistry } from "@galley/core/plugins";
import type { ToolContext } from "@galley/core/ai";
import { createShopifyFake, type FakeCatalogue, type ShopifyFake } from "./fake/shopify-fake.mjs";
import { connectionFrom, descriptionProblem, graphql, referencedHandles, SHOPIFY_PLUGIN_NAME, shopifyPlugin, storeOrigin, throttleWait } from "../src/index";

const ADMIN_TOKEN = "shpat_admin0123456789abcdefSECRET";
const PRIVATE_TOKEN = "storefront-private-0123456789SECRET";
const CLIENT_SECRET = "client-secret-0123456789abcdefSECRET";
const homes: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (() => Promise.reject(new Error("This test file makes no network calls."))) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

const CATALOGUE: FakeCatalogue = {
  shop: { name: "Test label", currencyCode: "GBP" },
  collections: [
    { handle: "coats", title: "Coats", description: "Heavy ones.", products: ["field-coat", "car-coat"] },
    { handle: "knitwear", title: "Knitwear", products: ["gansey"] },
  ],
  products: [
    {
      handle: "field-coat",
      title: "Field coat",
      description: "Undyed wool.",
      descriptionHtml: "<p>Undyed wool.</p>",
      productType: "Coat",
      seo: { title: "Field coat", description: "An undyed wool coat." },
      options: [{ name: "Size", values: ["S", "M"] }],
      images: [{ url: "/images/pieces/field-coat.webp", altText: "A pale coat", width: 1600, height: 2000 }, { url: "/images/lookbooks/aw26/look-01.webp", altText: "Worn open" }],
      variants: [
        { sku: "FC-S", selectedOptions: [{ name: "Size", value: "S" }], price: { amount: "640.00", currencyCode: "GBP" }, availableForSale: true, quantityAvailable: 2 },
        { sku: "FC-M", selectedOptions: [{ name: "Size", value: "M" }], price: { amount: "640.00", currencyCode: "GBP" }, availableForSale: false, quantityAvailable: 0 },
      ],
    },
    {
      handle: "car-coat",
      title: "Car coat",
      description: "Boiled wool, rust.",
      productType: "Coat",
      options: [{ name: "Size", values: ["M"] }],
      images: [{ url: "/images/lookbooks/aw26/look-04.webp", altText: "Rust coat" }],
      variants: [{ sku: "CC-M", selectedOptions: [{ name: "Size", value: "M" }], price: { amount: "580.00", currencyCode: "GBP" }, availableForSale: true, quantityAvailable: 5 }],
    },
    {
      handle: "gansey",
      title: "Gansey",
      description: "Worsted wool.",
      productType: "Knitwear",
      options: [{ name: "Colour", values: ["Navy"] }],
      images: [],
      variants: [{ sku: "G-N", selectedOptions: [{ name: "Colour", value: "Navy" }], price: { amount: "260.00", currencyCode: "GBP" }, availableForSale: true, quantityAvailable: 9 }],
    },
  ],
};

const ORIGIN = "https://test-label.myshopify.com";

function store(options: Parameters<typeof createShopifyFake>[0] = {}): ShopifyFake {
  return createShopifyFake({ catalogue: CATALOGUE, adminToken: ADMIN_TOKEN, storefrontPrivateToken: PRIVATE_TOKEN, origin: ORIGIN, ...options });
}

/** Just enough of a site: its files, and entries with their fields. */
function fakeSite(files: Record<string, string>, entries: Record<string, { title: string; data: object; fields: object[] }> = {}): SiteService {
  return {
    id: "site-1",
    root: "/sites/one",
    readFile: async (path: string) => {
      if (!(path in files)) throw new Error(`no ${path}`);
      return { path, content: files[path]!, hash: "h", binary: false };
    },
    readEntry: async (path: string) => {
      const entry = entries[path];

      if (!entry) throw new Error(`no entry ${path}`);
      return { path, ...entry };
    },
    writeFile: async () => undefined,
  } as unknown as SiteService;
}

async function registryWith(fake: ShopifyFake, values: Record<string, string>): Promise<{ registry: PluginRegistry; lines: string[] }> {
  const home = mkdtempSync(join(tmpdir(), "galley-shopify-"));

  homes.push(home);
  const lines: string[] = [];
  const registry = createPluginRegistry({
    home,
    fetch: fake.fetch,
    settings: createPluginSettingsStore({ home, env: {}, secrets: createFileSecretStore(home) }),
    log: (line) => lines.push(line),
  });

  registry.register(shopifyPlugin, { source: "builtin", location: "ships with the app" });
  await registry.start();
  if (Object.keys(values).length) await registry.saveSettings(SHOPIFY_PLUGIN_NAME, values);
  return { registry, lines };
}

async function call(registry: PluginRegistry, name: string, input: Record<string, unknown>, site: SiteService = fakeSite({})) {
  const tool = registry.tools().find((candidate) => candidate.name === name);

  if (!tool) throw new Error(`${name} isn't offered`);
  const parsed = tool.input.parse(input);
  const outcome = await tool.run(parsed, { site, siteId: site.id, mode: "content", signal: new AbortController().signal } as unknown as ToolContext);

  return { outcome, data: outcome.isError ? null : (JSON.parse(outcome.content) as Record<string, any>) };
}

// The kit's checks: the shape the engine requires, and each tool's input through the engine's validator.
describePlugin(shopifyPlugin);

describe("the fake store is strict", () => {
  const ask = (fake: ShopifyFake, query: string, headers: Record<string, string> = {}, path = "/api/2026-10/graphql.json") =>
    fake.handle({ method: "POST", url: `${ORIGIN}${path}`, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ query }) }).then((reply) => ({ ...reply, json: JSON.parse(String(reply.body)) }));

  it("refuses unknown and deprecated fields, and fields tokenless access can't read", async () => {
    const fake = store();

    expect((await ask(fake, `{ product(handle: "field-coat") { nope } }`)).json.errors[0].message).toMatch(/doesn't exist on type 'Product'/);
    expect((await ask(fake, `{ product(handle: "field-coat") { variants(first: 1) { nodes { priceV2 { amount } } } } }`)).json.errors[0].message).toMatch(/deprecated/);
    expect((await ask(fake, `{ product(handle: "field-coat") { options { values } } }`)).json.errors[0].message).toMatch(/deprecated/);
    expect((await ask(fake, `{ product(handle: "field-coat") { variants(first: 1) { nodes { quantityAvailable } } } }`)).json.errors[0].extensions.code).toBe("ACCESS_DENIED");
    expect((await ask(fake, `{ product(handle: "field-coat") { variants(first: 1) { nodes { quantityAvailable } } } }`, { "shopify-storefront-private-token": PRIVATE_TOKEN })).json.data.product.variants.nodes[0].quantityAvailable).toBe(2);
    expect((await ask(fake, `{ products(first: 250) { nodes { variants(first: 250) { nodes { id title } } } } }`)).json.errors[0].extensions.code).toBe("MAX_COMPLEXITY_EXCEEDED");
  });

  it("falls forward from a retired version and says which one answered", async () => {
    const reply = await ask(store(), `{ shop { name } }`, {}, "/api/2024-10/graphql.json");

    expect(reply.headers["x-shopify-api-version"]).toBe("2026-01");
    expect(reply.json.data.shop.name).toBe("Test label");
  });
});

describe("the connection", () => {
  it("reads store addresses the way people type them", () => {
    expect(storeOrigin("test-label")).toBe("https://test-label.myshopify.com");
    expect(storeOrigin("test-label.myshopify.com")).toBe("https://test-label.myshopify.com");
    expect(storeOrigin("https://test-label.myshopify.com/admin/products")).toBe("https://test-label.myshopify.com");
    expect(storeOrigin("http://127.0.0.1:4655")).toBe("http://127.0.0.1:4655");
    expect(() => storeOrigin("http://test-label.myshopify.com")).toThrow(/https/);
    expect(() => storeOrigin("")).toThrow(/Add the store's address/);
  });

  it("picks the private token, then the public one, then none", () => {
    expect(connectionFrom({ storeDomain: "a", storefrontPrivateToken: "p", storefrontPublicToken: "q" }).storefront).toEqual({ kind: "private", token: "p" });
    expect(connectionFrom({ storeDomain: "a", storefrontPublicToken: "q" }).storefront).toEqual({ kind: "public", token: "q" });
    expect(connectionFrom({ storeDomain: "a" }).storefront).toEqual({ kind: "tokenless", token: null });
    expect(() => connectionFrom({ storeDomain: "a", apiVersion: "2026-11" })).toThrow(/isn't an API version/);
  });

  it("waits for the bucket to refill before trying a throttled request again", async () => {
    expect(throttleWait({ requestedQueryCost: 100, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 50, restoreRate: 50 } })).toBe(1000);
    expect(throttleWait({ requestedQueryCost: 900, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 0, restoreRate: 50 } })).toBe(4000);
    const fake = store();

    fake.throttle(1);
    const result = await graphql<{ shop: { name: string } }>({ fetch: fake.fetch }, connectionFrom({ storeDomain: ORIGIN }), "admin", `query { shop { name } }`, {}, { adminToken: ADMIN_TOKEN });

    expect(result.data.shop.name).toBe("Test label");
    expect(fake.state.calls.filter((entry) => entry.path.startsWith("/admin/api"))).toHaveLength(2);
  });
});

describe("read-only tools", () => {
  it("search, read and list from the store, with the private token in its own header", async () => {
    const fake = store();
    const { registry } = await registryWith(fake, { storeDomain: "test-label.myshopify.com", storefrontPrivateToken: PRIVATE_TOKEN });

    expect(registry.tools().map((tool) => tool.name).sort()).toEqual(["shopify_get_product", "shopify_list_collections", "shopify_search_products", "shopify_store_status"]);
    for (const tool of registry.tools()) expect(tool.effect).toMatchObject({ readOnly: true, openWorld: true });

    const search = await call(registry, "shopify_search_products", { query: "coat" });

    expect(search.data!.products.map((product: { handle: string }) => product.handle)).toEqual(["field-coat", "car-coat"]);
    expect(search.data!.products[0]).toMatchObject({ title: "Field coat", price: "£640", available: true, image: `${ORIGIN}/cdn/images/pieces/field-coat.webp?width=240` });
    const product = await call(registry, "shopify_get_product", { handle: "field-coat" });

    expect(product.data!.product).toMatchObject({ title: "Field coat", options: [{ name: "Size", values: ["S", "M"] }], collections: ["coats"] });
    expect(product.data!.product.variants).toEqual([
      { title: "S", sku: "FC-S", available: true, price: "£640", options: { Size: "S" } },
      { title: "M", sku: "FC-M", available: false, price: "£640", options: { Size: "M" } },
    ]);
    expect((await call(registry, "shopify_get_product", { handle: "nope" })).outcome).toMatchObject({ isError: true, content: expect.stringMatching(/has no product with the handle “nope”/) });
    expect((await call(registry, "shopify_list_collections", {})).data!.collections.map((collection: { handle: string }) => collection.handle)).toEqual(["coats", "knitwear"]);
    const storefrontCalls = fake.state.calls.filter((entry) => entry.path === "/api/2026-10/graphql.json");

    expect(storefrontCalls.length).toBeGreaterThan(0);
    for (const entry of storefrontCalls) {
      expect(entry.headers["shopify-storefront-private-token"]).toBe(PRIVATE_TOKEN);
      expect(entry.headers["shopify-storefront-buyer-ip"]).toBeUndefined();
    }
  });

  it("report the connection: version, access, scopes and the edit switch", async () => {
    const fake = store({ scopes: ["read_products", "write_products"] });
    const { registry } = await registryWith(fake, { storeDomain: ORIGIN, adminToken: ADMIN_TOKEN, apiVersion: "2026-07" });
    const status = (await call(registry, "shopify_store_status", {})).data!;

    expect(status).toMatchObject({
      connected: true,
      store: "test-label.myshopify.com",
      name: "Test label",
      currency: "GBP",
      apiVersion: { asked: "2026-07", answered: "2026-07", fellForward: false },
      admin: { set: true, scopes: ["read_products", "write_products"], canEditCopy: true, canEditAltText: false },
      productCopyEditing: "off",
    });
    expect(status.storefrontAccess).toMatch(/no token/);
  });

  it("say plainly when the store isn't there, and never put a token in the message or the log", async () => {
    const fake = store();
    const { registry, lines } = await registryWith(fake, { storeDomain: ORIGIN, storefrontPrivateToken: "wrong-private-token-SECRET" });
    const outcome = (await call(registry, "shopify_search_products", { query: "coat" })).outcome;

    expect(outcome).toMatchObject({ isError: true, content: expect.stringMatching(/didn't accept the Storefront API token/) });
    expect(outcome.content).not.toContain("wrong-private-token-SECRET");
    expect(lines.join("\n")).not.toContain("wrong-private-token-SECRET");
    const listed = JSON.stringify(await registry.list());

    expect(listed).not.toContain("wrong-private-token-SECRET");
    expect(listed).toContain('"hint":"CRET"');
  });

  it("read the demo catalogue when no store is connected", async () => {
    const fake = store();
    const { registry } = await registryWith(fake, {});
    const site = fakeSite({ "src/data/shop/catalogue.json": JSON.stringify(CATALOGUE) });
    const search = await call(registry, "shopify_search_products", { query: "gansey" }, site);

    expect(search.data).toEqual({ from: "the demo catalogue in src/data/shop/catalogue.json (no store is connected)", products: [{ handle: "gansey", title: "Gansey", type: "Knitwear", price: "£260", available: true, image: null }] });
    expect((await call(registry, "shopify_store_status", {}, site)).data).toMatchObject({ connected: false, products: 3, collections: 2 });
    expect(fake.state.calls).toHaveLength(0);
    expect((await call(registry, "shopify_search_products", {}, fakeSite({}))).outcome).toMatchObject({ isError: true, content: expect.stringMatching(/No store is connected/) });
  });

  it("refuse to guess when the plugin and the site name different stores", async () => {
    const { registry } = await registryWith(store(), { storeDomain: ORIGIN });
    const site = fakeSite({ "src/data/shop/store.json": JSON.stringify({ domain: "another-label.myshopify.com" }) });

    expect((await call(registry, "shopify_search_products", {}, site)).outcome.content).toMatch(/names another-label\.myshopify\.com, but the Shopify plugin is connected to test-label\.myshopify\.com/);
  });
});

describe("editing product copy (changes Shopify directly)", () => {
  const ON = { storeDomain: ORIGIN, adminToken: ADMIN_TOKEN, allowProductEdits: "on" };

  it("is offered only while switched on, says so in its title, and declares a destructive open-world effect", async () => {
    const fake = store();
    const { registry } = await registryWith(fake, { storeDomain: ORIGIN, adminToken: ADMIN_TOKEN });

    expect(registry.tools().some((tool) => tool.name === "shopify_update_product_copy")).toBe(false);
    await registry.saveSettings(SHOPIFY_PLUGIN_NAME, { allowProductEdits: "on" });
    const tool = registry.tools().find((candidate) => candidate.name === "shopify_update_product_copy")!;

    expect(tool.title).toBe("Change product copy on Shopify (changes Shopify directly)");
    expect(tool.effect).toEqual({ readOnly: false, destructive: true, idempotent: true, openWorld: true });
    expect(tool.description).toMatch(/does NOT go through Proof/);
    expect(tool.description).toMatch(/only after the person said yes in this conversation/);
    expect(tool.description).toMatch(/never changes price, stock/);
    // Only copy can be sent: nothing in the input names price, stock, status or deletion.
    expect(Object.keys((tool.input as unknown as { shape: object }).shape)).toEqual(["handle", "title", "descriptionHtml", "seoTitle", "seoDescription", "imageAlts"]);
  });

  it("changes title, description, search texts and a picture's description, and returns before and after", async () => {
    const fake = store();
    const { registry, lines } = await registryWith(fake, ON);
    const { data } = await call(registry, "shopify_update_product_copy", {
      handle: "field-coat",
      title: "The field coat",
      descriptionHtml: "<p>Undyed Shetland wool, cut long.</p>",
      seoTitle: "Field coat in undyed wool",
      imageAlts: [{ position: 2, alt: "The field coat worn open by the harbour wall" }],
    });

    expect(data!.before).toEqual({ title: "Field coat", descriptionHtml: "<p>Undyed wool.</p>", seoTitle: "Field coat", imageAlts: [{ position: 2, alt: "Worn open" }] });
    expect(data!.after).toEqual({ title: "The field coat", descriptionHtml: "<p>Undyed Shetland wool, cut long.</p>", seoTitle: "Field coat in undyed wool", imageAlts: [{ position: 2, alt: "The field coat worn open by the harbour wall" }] });
    expect(data!.live).toMatch(/live in the store now/);
    const product = fake.product("field-coat")!;

    expect(product.seo).toEqual({ title: "Field coat in undyed wool", description: "An undyed wool coat." });
    expect(product.images[1]!.altText).toBe("The field coat worn open by the harbour wall");
    // What reached Shopify: productUpdate with copy keys only, then fileUpdate with id and alt only.
    const sent = fake.state.calls.filter((entry) => entry.path === "/admin/api/2026-10/graphql.json").map((entry) => JSON.parse(entry.body));
    const update = sent.find((body) => /productUpdate/.test(body.query));
    const files = sent.find((body) => /fileUpdate/.test(body.query));

    expect(Object.keys(update.variables.product).sort()).toEqual(["descriptionHtml", "id", "seo", "title"]);
    expect(files.variables.files).toEqual([{ id: "gid://shopify/MediaImage/101", alt: "The field coat worn open by the harbour wall" }]);
    expect(lines.join("\n")).toMatch(/changed the copy of field-coat on test-label\.myshopify\.com/);
    expect(lines.join("\n")).not.toContain(ADMIN_TOKEN);
  });

  it("refuses unsafe description HTML without sending anything", async () => {
    expect(descriptionProblem("<p>Fine <a href=\"https://example.com\">link</a></p><ul><li>one</li></ul>")).toBeNull();
    expect(descriptionProblem("<p>Hi</p><script>alert(1)</script>")).toMatch(/<script>/);
    expect(descriptionProblem('<p onclick="x()">Hi</p>')).toMatch(/onclick/);
    expect(descriptionProblem('<a href="javascript:alert(1)">x</a>')).toMatch(/doesn't start with/);
    const fake = store();
    const { registry } = await registryWith(fake, ON);
    const { outcome } = await call(registry, "shopify_update_product_copy", { handle: "field-coat", descriptionHtml: "<iframe src=x></iframe>" });

    expect(outcome).toMatchObject({ isError: true, content: expect.stringMatching(/Not sent: .*<iframe>.*Nothing was changed/) });
    expect(fake.state.calls.filter((entry) => entry.path.startsWith("/admin"))).toHaveLength(0);
  });

  it("names the missing permission plainly", async () => {
    const fake = store({ scopes: ["read_products"] });
    const { registry } = await registryWith(fake, ON);
    const { outcome } = await call(registry, "shopify_update_product_copy", { handle: "field-coat", title: "New" });

    expect(outcome.content).toMatch(/doesn't have the write_products permission/);
    expect(fake.product("field-coat")!.title).toBe("Field coat");
  });

  it("says when the Admin token is refused, without the token", async () => {
    const { registry } = await registryWith(store(), { ...ON, adminToken: "shpat_wrongwrongwrong0123456789" });
    const { outcome } = await call(registry, "shopify_update_product_copy", { handle: "field-coat", title: "New" });

    expect(outcome.content).toMatch(/didn't accept the Admin API token/);
    expect(outcome.content).not.toContain("shpat_wrong");
  });

  it("signs in with a Dev Dashboard app's client ID and secret, and keeps the 24-hour token", async () => {
    const fake = store({ adminToken: undefined, clientId: "client-1", clientSecret: CLIENT_SECRET });
    const { registry } = await registryWith(fake, { storeDomain: ORIGIN, adminClientId: "client-1", adminClientSecret: CLIENT_SECRET, allowProductEdits: "on" });

    await call(registry, "shopify_update_product_copy", { handle: "car-coat", title: "Car coat in rust" });
    await call(registry, "shopify_update_product_copy", { handle: "car-coat", seoDescription: "A boiled wool car coat." });
    const grants = fake.state.calls.filter((entry) => entry.path === "/admin/oauth/access_token");

    expect(grants).toHaveLength(1);
    expect(new URLSearchParams(grants[0]!.body).get("grant_type")).toBe("client_credentials");
    expect(fake.product("car-coat")).toMatchObject({ title: "Car coat in rust", seo: { description: "A boiled wool car coat." } });

    const refused = await registryWith(store({ adminToken: undefined, clientId: "client-2", clientSecret: "right" }), { storeDomain: "https://other.myshopify.com", adminClientId: "client-2", adminClientSecret: "wrong-secret-value", allowProductEdits: "on" });
    const { outcome } = await call(refused.registry, "shopify_update_product_copy", { handle: "car-coat", title: "x" });

    expect(outcome.content).toMatch(/same organisation in the Dev Dashboard/);
    expect(outcome.content).not.toContain("wrong-secret-value");
  });

  it("won't write to a store the site names but the settings don't connect", async () => {
    const { registry } = await registryWith(store(), { allowProductEdits: "on" });
    const site = fakeSite({ "src/data/shop/store.json": JSON.stringify({ domain: ORIGIN }) });

    expect((await call(registry, "shopify_update_product_copy", { handle: "field-coat", title: "x" }, site)).outcome.content).toMatch(/connected in the Shopify plugin's settings/);
  });
});

describe("data sources", () => {
  it("search the store and look up a saved handle", async () => {
    const fake = store();
    const { registry } = await registryWith(fake, { storeDomain: ORIGIN });
    const site = fakeSite({});

    expect(registry.dataSources()).toEqual([
      { id: "shopify-products", label: "Products in the shop", description: expect.any(String), plugin: SHOPIFY_PLUGIN_NAME },
      { id: "shopify-collections", label: "Collections in the shop", description: expect.any(String), plugin: SHOPIFY_PLUGIN_NAME },
    ]);
    const products = registry.dataSource("shopify-products", site)!;
    const ctx = await products.context(new AbortController().signal, 5);

    expect(await products.contribution.search("coat", ctx)).toEqual([
      { value: "field-coat", title: "Field coat", image: `${ORIGIN}/cdn/images/pieces/field-coat.webp?width=240`, detail: "£640 · Coat" },
      { value: "car-coat", title: "Car coat", image: `${ORIGIN}/cdn/images/lookbooks/aw26/look-04.webp?width=240`, detail: "£580 · Coat" },
    ]);
    expect(await products.contribution.get("gansey", ctx)).toEqual({ value: "gansey", title: "Gansey", detail: "£260 · Knitwear" });
    expect(await products.contribution.get("gone", ctx)).toBeNull();
    const collections = registry.dataSource("shopify-collections", site)!;

    expect(await collections.contribution.search("knit", await collections.context(new AbortController().signal, 5))).toEqual([{ value: "knitwear", title: "Knitwear" }]);
  });

  it("offer the demo catalogue, labelled, when no store is connected", async () => {
    const { registry } = await registryWith(store(), {});
    const site = fakeSite({ "src/data/shop/catalogue.json": JSON.stringify(CATALOGUE) });
    const products = registry.dataSource("shopify-products", site)!;

    expect(await products.contribution.search("", await products.context(new AbortController().signal, 2))).toEqual([
      { value: "field-coat", title: "Field coat", image: "/images/pieces/field-coat.webp", detail: "£640 · Coat · Demo catalogue" },
      { value: "car-coat", title: "Car coat", image: "/images/lookbooks/aw26/look-04.webp", detail: "£580 · Coat · Demo catalogue" },
    ]);
  });
});

describe("the publish check", () => {
  const sectionFields = [
    {
      key: "sections",
      label: "Sections",
      type: "blocks",
      discriminator: "type",
      blocks: [
        { type: "featured-product", label: "Featured product", fields: [{ key: "product", label: "Product", type: "string", dataSource: "shopify-products" }] },
        { type: "product-rail", label: "Product rail", fields: [{ key: "products", label: "Products", type: "list", of: { key: "item", label: "Product", type: "string", dataSource: "shopify-products" } }, { key: "collection", label: "Collection", type: "string", dataSource: "shopify-collections" }] },
      ],
    },
  ];
  const page = {
    title: "Home",
    fields: sectionFields,
    data: { sections: [{ type: "featured-product", product: "field-coat" }, { type: "product-rail", products: ["gansey", "discontinued-smock"], collection: "old-sale" }, { type: "statement", heading: "x" }] },
  };

  it("finds every handle a page names, in blocks and lists", () => {
    expect(referencedHandles(sectionFields as never, page.data as never)).toEqual([
      { kind: "product", handle: "field-coat", field: "Sections 1 (Featured product) › Product" },
      { kind: "product", handle: "gansey", field: "Sections 2 (Product rail) › Products 1" },
      { kind: "product", handle: "discontinued-smock", field: "Sections 2 (Product rail) › Products 2" },
      { kind: "collection", handle: "old-sale", field: "Sections 2 (Product rail) › Collection" },
    ]);
  });

  it("warns about handles the store no longer has, and never refuses", async () => {
    const fake = store();
    const { registry, lines } = await registryWith(fake, { storeDomain: ORIGIN });
    const site = { ...fakeSite({}, { "src/content/pages/index.md": page }), root: "/sites/one" } as unknown as SiteService;
    const check = await registry.checkPublish(site, { files: [{ path: "src/content/pages/index.md", status: "modified", kind: "content", binary: false, additions: 1, deletions: 1 }], totals: { files: 1, additions: 1, deletions: 1 } } as never);

    expect(check.refusal).toBeNull();
    // The person reads them in Proof and the Publish dialog, under the plugin's name…
    expect(check.warnings).toHaveLength(2);
    expect(check.warnings.every((warning) => warning.plugin === "Shopify")).toBe(true);
    expect(check.warnings[0]!.message).toMatch(/^“Home” shows the product “discontinued-smock” \(Sections 2 \(Product rail\) › Products 2\), which test-label\.myshopify\.com doesn't have any more/);
    expect(check.warnings[1]!.message).toMatch(/the collection “old-sale”/);
    // …and the plugin's log keeps them too.
    expect(lines.filter((line) => /doesn't have any more/.test(line))).toHaveLength(2);
  });
});
