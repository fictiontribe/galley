import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, api, buildUrl, candidateUrl, fillPath, queryString, rawFileUrl, setUnauthorizedHandler } from "../src/lib/api";

describe("URL building", () => {
  it("fills and encodes path params", () => {
    expect(fillPath("/api/sites/:siteId/threads/:threadId", { siteId: "a b", threadId: "t/1" })).toBe("/api/sites/a%20b/threads/t%2F1");
  });

  it("refuses a missing param", () => {
    expect(() => fillPath("/api/sites/:siteId", {})).toThrow(/siteId/);
  });

  it("builds query strings, skipping undefined", () => {
    expect(queryString({ q: "pricing page", limit: 5, draft: false, collection: undefined })).toBe("?q=pricing+page&limit=5&draft=false");
    expect(queryString({})).toBe("");
    expect(queryString(undefined)).toBe("");
  });

  it("builds a typed route URL", () => {
    expect(buildUrl("GET /api/sites/:siteId/entries", { siteId: "s1" }, { collection: "blog", sort: "date" })).toBe("/api/sites/s1/entries?collection=blog&sort=date");
  });

  it("builds the non-JSON URLs", () => {
    expect(rawFileUrl("s1", "public/images/a b.png")).toBe("/api/sites/s1/raw?path=public%2Fimages%2Fa+b.png");
    expect(rawFileUrl("s1", "x.png", "base")).toBe("/api/sites/s1/raw?path=x.png&rev=base");
    expect(candidateUrl("c-1")).toBe("/api/images/candidates/c-1");
  });
});

describe("api()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  it("sends JSON bodies and returns the parsed response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("POST /api/sites/:siteId/discard", { params: { siteId: "s1" }, body: { paths: ["a.md"] } })).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/sites/s1/discard");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"paths":["a.md"]}');
    expect(init.credentials).toBe("same-origin");
  });

  it("throws ApiFailure with the server's error shape", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "conflict", message: "This page changed while you were editing it." } }), { status: 409 }));
    const failure = await api("GET /api/sites/:siteId", { params: { siteId: "s1" } }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect((failure as ApiFailure).status).toBe(409);
    expect((failure as ApiFailure).shape.code).toBe("conflict");
    expect((failure as ApiFailure).message).toBe("This page changed while you were editing it.");
  });

  it("reports an unreachable server as offline, in plain words", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const failure = (await api("GET /api/sites").catch((error: unknown) => error)) as ApiFailure;
    expect(failure.offline).toBe(true);
    expect(failure.shape.detail).toBe("Failed to fetch");
  });

  it("calls the sign-in handler on 401, except for the auth routes", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await api("GET /api/sites").catch(() => undefined);
    await api("POST /api/auth/login", { body: { password: "x" } }).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// Compile-time contract: these lines must stay type errors (checked by `pnpm typecheck`).
export function typeContract(): void {
  // @ts-expect-error — wrong path param name
  void api("GET /api/sites/:siteId", { params: { site: "x" } });
  // @ts-expect-error — required params missing
  void api("GET /api/sites/:siteId/history");
  // @ts-expect-error — unknown query key
  void api("GET /api/sites/:siteId/search", { params: { siteId: "x" }, query: { q: "a", page: 2 } });
  // @ts-expect-error — wrong body shape
  void api("POST /api/sites/:siteId/revert", { params: { siteId: "x" }, body: { sha: "abc" } });
  // @ts-expect-error — a route that takes no body
  void api("GET /api/sites", { body: {} });
  // @ts-expect-error — raw-bytes routes are not JSON calls
  void api("GET /api/sites/:siteId/raw", { params: { siteId: "x" }, query: { path: "a" } });
}

describe("/open", () => {
  it("goes to the entry's form, or to the page by address when no entry lives there", async () => {
    const { editorAddress } = await import("../src/screens/open/address");
    expect(editorAddress("s1", { path: "src/content/pages/about.md" }, "/about/")).toBe("/sites/s1/edit?path=src%2Fcontent%2Fpages%2Fabout.md");
    expect(editorAddress("s1", null, "/team/ana/")).toBe("/sites/s1/edit?url=%2Fteam%2Fana%2F");
    expect(editorAddress("s1", null, null)).toBe("/sites/s1/edit?url=%2F");
  });
});
