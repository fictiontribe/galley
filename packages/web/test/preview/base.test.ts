/**
 * A preview whose address has a path of its own (the in-browser demo serves
 * the sample site under /demo/site): frames load under it, and the pages'
 * own paths come back without it. A preview on an origin of its own — every
 * real one — is unchanged.
 */
import { describe, expect, it } from "vitest";
import type { OverlayToHost } from "@galley/core/types";
import { addressToPath, basePathOf, frameUrl, localizeMessage, withinBase } from "../../src/features/preview/frames";

describe("a preview served under a path", () => {
  it("knows the path a preview address is mounted at", () => {
    expect(basePathOf("http://127.0.0.1:4321")).toBe("");
    expect(basePathOf("http://127.0.0.1:4321/")).toBe("");
    expect(basePathOf("https://galley.example/demo/site")).toBe("/demo/site");
    expect(basePathOf("https://galley.example/demo/site/")).toBe("/demo/site");
    expect(basePathOf(null)).toBe("");
    expect(basePathOf("not an address")).toBe("");
  });

  it("loads pages under the preview's address", () => {
    expect(frameUrl("https://galley.example/demo/site", "/atelier/")).toBe("https://galley.example/demo/site/atelier/");
    expect(frameUrl("http://127.0.0.1:4321", "/atelier/")).toBe("http://127.0.0.1:4321/atelier/");
  });

  it("reads a page's own path back from where the frame is", () => {
    expect(withinBase("/demo/site", "/demo/site/atelier/")).toBe("/atelier/");
    expect(withinBase("/demo/site", "/demo/site/")).toBe("/");
    expect(withinBase("/demo/site", "/demo/site")).toBe("/");
    expect(withinBase("/demo/site", "/demo/site?x=1")).toBe("/?x=1");
    expect(withinBase("/demo/site", "/demo/site#look-01")).toBe("/#look-01");
    // A path that only starts with the same letters isn't under it.
    expect(withinBase("/demo/site", "/demo/sites/")).toBe("/demo/sites/");
    expect(withinBase("", "/about/")).toBe("/about/");
  });

  it("gives the app the site's own paths in the overlay's messages, and leaves the rest alone", () => {
    const ready: OverlayToHost = { galley: 1, type: "ready", path: "/demo/site/journal/", title: "Journal" };
    expect(localizeMessage(ready, "/demo/site")).toEqual({ ...ready, path: "/journal/" });
    const image: OverlayToHost = { galley: 1, type: "select-image", src: "/demo/site/images/pieces/gansey.webp", alt: "", rect: { x: 0, y: 0, width: 1, height: 1 } };
    expect(localizeMessage(image, "/demo/site")).toEqual({ ...image, src: "/images/pieces/gansey.webp" });
    const scroll: OverlayToHost = { galley: 1, type: "scroll", y: 120 };
    expect(localizeMessage(scroll, "/demo/site")).toBe(scroll);
    expect(localizeMessage(ready, "")).toBe(ready);
  });

  it("takes a full address typed into the address bar on the preview's own path", () => {
    expect(addressToPath("https://galley.example/demo/site/atelier/", ["https://galley.example/demo/site", null])).toBe("/atelier/");
    expect(addressToPath("http://127.0.0.1:4321/about/", ["http://127.0.0.1:4321", null])).toBe("/about/");
    expect(addressToPath("https://elsewhere.example/about/", ["https://galley.example/demo/site", null])).toBeNull();
  });
});
