/**
 * The five preview links outside the preview pane: on this computer each is
 * exactly the address it always was; on a hosted install each goes through
 * the entry route — a click opens a new tab sent to a fresh entered address,
 * a picture or a frame loads one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MetaInfo } from "@galley/core/types";
import {
  agentFileTarget,
  collectionSiteTarget,
  enteredPreviewAddress,
  measureTarget,
  openPreviewTarget,
  siteHomePreviewTarget,
  thumbPreviewTarget,
} from "../../src/features/hosting/previewLinks";

const LOCAL = { mode: "local" } as MetaInfo;
const HOSTED = { mode: "hosted", install: { singleSite: true, setupNeeded: false, siteId: "s1" } } as unknown as MetaInfo;
const PROXY = "http://127.0.0.1:4611";
const GATEWAY = "https://cms-preview.example.com";
const ENTRY = `${GATEWAY}/__galley/enter?ticket=t1`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Site home › Open in a new tab", () => {
  it("is the preview's address here, and the entry on a hosted install", () => {
    expect(siteHomePreviewTarget(LOCAL, PROXY)).toEqual({ kind: "direct", href: PROXY });
    expect(siteHomePreviewTarget(null, PROXY)).toEqual({ kind: "direct", href: PROXY });
    expect(siteHomePreviewTarget(HOSTED, GATEWAY)).toEqual({ kind: "entry", path: "/" });
  });
});

describe("a collection's Open on the site", () => {
  it("opens the preview's page here, through the entry on a hosted install, and the live site as it is", () => {
    expect(collectionSiteTarget(LOCAL, PROXY, "https://example.com", "/about/")).toEqual({ kind: "direct", href: `${PROXY}/about/` });
    expect(collectionSiteTarget(HOSTED, GATEWAY, "https://example.com", "/about/")).toEqual({ kind: "entry", path: "/about/" });
    // No preview running: the live address, which anyone can open.
    expect(collectionSiteTarget(HOSTED, null, "https://example.com", "/about/")).toEqual({ kind: "direct", href: "https://example.com/about/" });
    expect(collectionSiteTarget(LOCAL, null, null, "/about/")).toBeNull();
  });
});

describe("Visibility › llms.txt and a page's markdown version", () => {
  it("is the preview's file here, and the entry on a hosted install", () => {
    expect(agentFileTarget(LOCAL, PROXY, "/llms.txt")).toEqual({ kind: "direct", href: `${PROXY}/llms.txt` });
    expect(agentFileTarget(HOSTED, GATEWAY, "/about.md")).toEqual({ kind: "entry", path: "/about.md" });
  });
});

describe("a data-source picker's picture from the preview", () => {
  it("loads from the preview here, and through a fresh entry on a hosted install", () => {
    expect(thumbPreviewTarget(LOCAL, `${PROXY}/`, "/img/shoe.jpg")).toEqual({ kind: "direct", href: `${PROXY}/img/shoe.jpg` });
    expect(thumbPreviewTarget(HOSTED, GATEWAY, "/img/shoe.jpg")).toEqual({ kind: "entry", path: "/img/shoe.jpg" });
    // Nothing on the preview to load: another address, or no preview running.
    expect(thumbPreviewTarget(HOSTED, GATEWAY, "https://cdn.example.com/shoe.jpg")).toBeNull();
    expect(thumbPreviewTarget(HOSTED, GATEWAY, "//cdn.example.com/shoe.jpg")).toBeNull();
    expect(thumbPreviewTarget(HOSTED, null, "/img/shoe.jpg")).toBeNull();
  });
});

describe("the Brand screen's measuring frame", () => {
  it("measures at the preview here; on a hosted install, at the entry's origin once let in", () => {
    expect(measureTarget(LOCAL, PROXY, null)).toEqual({ origin: PROXY, enter: null });
    expect(measureTarget(HOSTED, GATEWAY, ENTRY)).toEqual({ origin: GATEWAY, enter: `${ENTRY}&to=%2F` });
    expect(measureTarget(HOSTED, GATEWAY, null)).toBeNull();
  });
});

describe("following a link", () => {
  it("opens the address itself here, without asking for an entry", () => {
    const fetchMock = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { open });
    openPreviewTarget("s1", { kind: "direct", href: `${PROXY}/about/` });
    expect(open).toHaveBeenCalledWith(`${PROXY}/about/`, "_blank", "noopener");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on a hosted install, opens the tab at once and sends it to a fresh entered address", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ preview: ENTRY, baseline: null }), { status: 200 }));
    const sent: string[] = [];
    const tab = { opener: {} as unknown, location: { replace: (url: string) => sent.push(url) }, close: vi.fn() };
    const open = vi.fn(() => tab);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { open });
    openPreviewTarget("s1", { kind: "entry", path: "/about/" });
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    await vi.waitFor(() => expect(sent).toEqual([`${ENTRY}&to=%2Fabout%2F`]));
    expect(fetchMock).toHaveBeenCalledWith("/api/sites/s1/preview/entry", expect.objectContaining({ method: "POST" }));
  });

  it("gives an entered address for a picture, or nothing when the server has none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ preview: ENTRY, baseline: null }), { status: 200 })));
    expect(await enteredPreviewAddress("s1", "/img/shoe.jpg")).toBe(`${ENTRY}&to=%2Fimg%2Fshoe.jpg`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ preview: null, baseline: null }), { status: 200 })));
    expect(await enteredPreviewAddress("s1", "/")).toBeNull();
  });
});
