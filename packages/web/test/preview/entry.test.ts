import { afterEach, describe, expect, it, vi } from "vitest";
import type { MetaInfo } from "@galley/core/types";
import { entryAddress, isSignInNeeded, needsEntry, openEntry, RENEW_LIMIT, RENEW_WINDOW_MS, requestEntry } from "../../src/features/preview/entry";
import { frameUrl } from "../../src/features/preview/frames";

const ENTRY = "https://cms-preview.example.com/__galley/enter";

/** Stands in for the server: each call to the entry route answers with fresh tickets. */
function stubServer() {
  let n = 0;
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    n += 1;
    return new Response(JSON.stringify({ preview: `${ENTRY}?ticket=p${n}`, baseline: `https://cms-live.example.com/__galley/enter?ticket=b${n}` }), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("which installs go through the entry route", () => {
  it("only a hosted install does", () => {
    expect(needsEntry({ install: { singleSite: true, setupNeeded: false, siteId: "s1" } } as MetaInfo)).toBe(true);
    expect(needsEntry({ mode: "local" } as MetaInfo)).toBe(false);
    expect(needsEntry(null)).toBe(false);
  });
});

describe("a hosted install's frames", () => {
  it("ask the entry route once and load the addresses it returns, landing on the page wanted", async () => {
    const fetchMock = stubServer();
    const session = await openEntry("s1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sites/s1/preview/entry");
    expect(init.method).toBe("POST");
    expect(session.first).toEqual({ preview: `${ENTRY}?ticket=p1`, baseline: "https://cms-live.example.com/__galley/enter?ticket=b1" });
    expect(entryAddress(session.first.preview!, "/about/?x=1#team")).toBe(`${ENTRY}?ticket=p1&to=%2Fabout%2F%3Fx%3D1%23team`);
    expect(entryAddress(session.first.preview!, "pricing")).toBe(`${ENTRY}?ticket=p1&to=%2Fpricing`);
  });

  it("ask again for a frame that was turned away, and stop after a few tries in a row", async () => {
    const fetchMock = stubServer();
    let clock = 1_000;
    const session = await openEntry("s1", requestEntry, () => clock);

    expect(await session.renew("live", "/team/")).toBe("https://cms-live.example.com/__galley/enter?ticket=b2&to=%2Fteam%2F");
    for (let i = 1; i < RENEW_LIMIT; i += 1) expect(await session.renew("live", "/")).not.toBeNull();
    expect(await session.renew("live", "/")).toBeNull();
    // The other frame keeps its own count, and a person's own click is never refused.
    expect(await session.renew("proposed", "/")).not.toBeNull();
    expect(await session.address("live", "/")).not.toBeNull();
    clock += RENEW_WINDOW_MS;
    expect(await session.renew("live", "/")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1 + RENEW_LIMIT + 3);
  });

  it("have no address to go to when the server has none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ preview: `${ENTRY}?ticket=p`, baseline: null }), { status: 200 })));
    const session = await openEntry("s1");
    expect(await session.renew("live", "/")).toBeNull();
  });

  it("recognise the gateway's sign-in note and nothing else", () => {
    expect(isSignInNeeded({ galley: 1, type: "sign-in-needed" })).toBe(true);
    expect(isSignInNeeded({ galley: 1, type: "ready", path: "/", title: "" })).toBe(false);
    expect(isSignInNeeded({ type: "sign-in-needed" })).toBe(false);
    expect(isSignInNeeded("sign-in-needed")).toBe(false);
    expect(isSignInNeeded(null)).toBe(false);
  });
});

describe("frames on this computer", () => {
  it("load the proxy's own address, without asking the entry route", () => {
    const fetchMock = stubServer();

    // What the pane loads when there is no entry session (local mode never makes one).
    expect(frameUrl("http://127.0.0.1:4611", "/about/")).toBe("http://127.0.0.1:4611/about/");
    expect(needsEntry({ mode: "local" } as MetaInfo)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
