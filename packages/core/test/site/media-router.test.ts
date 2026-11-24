import { afterEach, describe, expect, it } from "vitest";
import { cleanupAll, disposeAll, makeSite, openSite } from "./helpers";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

describe("the uploads waiting in a media store, in Proof", () => {
  it("are said plainly to be unknown when they can't be looked up, never shown as nothing", async () => {
    const { site } = await openSite(makeSite(), {
      media: {
        save: async (_site, _upload, toRepository) => toRepository(),
        list: async (_site, repository) => repository,
        pending: async () => {
          throw new Error("the search isn't available");
        },
      },
    });
    const changes = await site.changes();

    expect(changes.storeUploads).toBeUndefined();
    expect(changes.storeUploadsProblem).toMatch(/couldn't be looked up just now: the search isn't available/);
  });
});
