import { describe, expect, it } from "vitest";
import { fakeFetch, json, resolveScriptSnippet, testContext, type SiteService } from "@galley/plugin-kit";
import { describePlugin } from "@galley/plugin-kit/vitest";
import { examplePlugin } from "../src/index";

// #region checks
// The kit's checks: the shape the engine requires, and each contribution exercised the way the engine uses it.
describePlugin(examplePlugin);
// #endregion checks

// #region behaviour
/** Just enough of a site for these tests: one entry and the site's name. */
const site = {
  id: "site-1",
  readEntry: async () => ({ title: "About", data: { title: "About", hero: { heading: "Fresh bread daily" } }, body: "We bake at dawn. It's warm by six." }),
  summary: async () => ({ name: "Harbour Bakery" }),
} as unknown as SiteService;

describe("behaviour", () => {
  it("fills the Fathom snippet in from its settings", () => {
    const [fathom] = examplePlugin.scriptIntegrations;

    expect(resolveScriptSnippet(fathom!, { siteId: "ABCDEFGH" })).toEqual({ src: "https://cdn.usefathom.com/script.js", attributes: { "data-site": "ABCDEFGH", defer: "" } });
  });

  it("posts one plain sentence to the webhook after a publish", async () => {
    const hook = fakeFetch(() => json(200, { ok: true }));
    const ctx = { ...testContext({ settings: { webhookUrl: "https://hooks.example.com/abc" }, fetch: hook.fetch }), site, siteId: "site-1" };

    await examplePlugin.hooks.afterPublish!(ctx, { ok: true, commit: "1a2b3c4", files: ["src/content/pages/about.md", "public/images/loaf.webp"], pushed: true });
    expect(hook.requests).toEqual([expect.objectContaining({ url: "https://hooks.example.com/abc", method: "POST", body: { text: "Harbour Bakery: 2 files published." } })]);
  });

  it("counts the words in an entry's body and fields", async () => {
    const [tool] = examplePlugin.tools;
    const ctx = { ...testContext(), site, siteId: "site-1", mode: "content" as const, signal: new AbortController().signal };

    // Body: 8 words ("It's" is one); fields: "About" and "Fresh bread daily" — 4.
    expect(await tool!.run({ path: "src/content/pages/about.md" }, ctx)).toEqual({ title: "About", words: 12, body: 8, fields: 4 });
  });
});
// #endregion behaviour
