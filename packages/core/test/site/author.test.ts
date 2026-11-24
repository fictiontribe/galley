/**
 * The publishing name an open site reports is the one in use now, not the
 * one when the site was opened: a hosted install's first run sets it after
 * the site is open, and the Publish dialog reads it from gitStatus().
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AuthorLayers } from "../../src/workspace/author";
import { cleanupAll, disposeAll, makeSite, openSite } from "./helpers";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

describe("the publishing name of an open site", () => {
  it("is read afresh by gitStatus(), so a name set after opening is the one the Publish dialog shows", async () => {
    const layers: AuthorLayers = { site: null, app: null };
    const { site } = await openSite(makeSite(), { authorLayers: () => ({ ...layers }) });
    const before = (await site.gitStatus()).author;

    expect(before?.from).not.toBe("app");
    layers.app = { name: "Sam Example", email: "sam@example.com" };
    expect((await site.gitStatus()).author).toEqual({ name: "Sam Example", email: "sam@example.com", from: "app" });
  });
});
