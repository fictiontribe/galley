import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ImportError } from "../src/errors";
import { apiFromLinkHeader, endpoint, readRest } from "../src/source/rest";
import { retryAfterMs, USER_AGENT } from "../src/source/http";
import { startFakeWordPress, type FakeWordPress } from "./fake-wordpress";
import { tempDir, uploads } from "./helpers";

let server: FakeWordPress | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe("finding the API", () => {
  it("reads the Link header WordPress sends", () => {
    expect(apiFromLinkHeader('<https://a.example/wp-json/>; rel="https://api.w.org/", <https://a.example/?p=1>; rel=shortlink')).toBe("https://a.example/wp-json/");
    expect(apiFromLinkHeader('<https://a.example/?p=1>; rel=shortlink')).toBeNull();
  });

  it("builds endpoint addresses for both permalink styles", () => {
    expect(endpoint("https://a.example/wp-json/", "wp/v2/posts", { page: 2 })).toBe("https://a.example/wp-json/wp/v2/posts?page=2");
    expect(endpoint("https://a.example/?rest_route=/", "wp/v2/posts", { page: 2 })).toBe("https://a.example/?rest_route=%2Fwp%2Fv2%2Fposts&page=2");
  });

  it("works with pretty permalinks", async () => {
    server = await startFakeWordPress();
    const wp = await readRest(server.url, { cacheDir: tempDir("cache-") });

    expect(wp.source.apiRoot).toBe(`${server.url}/wp-json/`);
    expect(wp.title).toBe("Quillfield Pottery");
  });

  it("works without pretty permalinks (?rest_route=)", async () => {
    server = await startFakeWordPress({ mode: "plain" });
    const wp = await readRest(server.url, { cacheDir: tempDir("cache-") });

    expect(wp.source.apiRoot).toBe(`${server.url}/?rest_route=/`);
    expect(wp.items.length).toBe(5);
  });

  it("says plainly when the API is switched off, and points at the export file", async () => {
    server = await startFakeWordPress({ mode: "disabled" });
    const error = await readRest(server.url, { cacheDir: tempDir("cache-") }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).reason).toBe("blocked");
    expect((error as ImportError).message).toMatch(/doesn't let its content be read/);
    expect((error as ImportError).message).toMatch(/Tools › Export/);
  });

  it("says when a site isn't WordPress at all", async () => {
    const plain = createServer((req, res) => {
      res.writeHead(req.url === "/" ? 200 : 404, { "content-type": "text/html" });
      res.end("<html><body>Hello</body></html>");
    });

    await new Promise<void>((resolve) => plain.listen(0, "127.0.0.1", resolve));
    try {
      const error = await readRest(`http://127.0.0.1:${(plain.address() as AddressInfo).port}`, { cacheDir: tempDir("cache-") }).catch((e: unknown) => e);

      expect((error as ImportError).reason).toBe("not-wordpress");
      expect((error as ImportError).message).toMatch(/doesn't look like a WordPress site/);
    } finally {
      await new Promise((resolve) => plain.close(resolve));
    }
  });
});

describe("reading content", () => {
  it("pages through lists, embeds media, terms and authors, and offers custom types", async () => {
    server = await startFakeWordPress({ maxPerPage: 2, files: uploads() });
    const wp = await readRest(server.url, { cacheDir: tempDir("cache-") });
    const posts = wp.items.filter((item) => item.type === "post");

    expect(posts.map((post) => post.id)).toEqual([103, 102, 101]);
    // Three posts at two per page: two requests.
    expect(server.requests.filter((r) => r.path.includes("/wp/v2/posts")).length).toBe(2);
    expect(wp.media.find((media) => media.id === 201)?.sizes).toEqual([`${server.url}/wp-content/uploads/2024/03/kiln-room-300x200.png`]);
    expect(wp.terms.find((term) => term.slug === "beginners")?.parentId).toBe(12);
    expect(wp.authors.map((author) => author.name).sort()).toEqual(["Ana Whitcombe", "Sam Okoro"]);
    expect(wp.postTypes).toEqual([{ slug: "course", name: "Courses", restBase: "wp/v2/courses", count: 1 }]);
    expect(wp.features).toEqual(expect.arrayContaining(["yoast", "contact-form-7"]));
    expect(wp.commentCount).toBe(4);
    // SEO titles come without the site name the plugin appends.
    expect(posts.find((post) => post.id === 101)?.seo).toMatchObject({ title: "Opening the new kiln room", plugin: "yoast" });
    expect(wp.items.find((item) => item.id === 304)?.builder?.name).toBe("elementor");
  });

  it("is a polite client: generic User-Agent, backs off on 429, resumes from its cache", async () => {
    server = await startFakeWordPress({ rateLimitOnce: ["/wp/v2/pages"] });
    const cacheDir = tempDir("cache-");
    const started = Date.now();
    const first = await readRest(server.url, { cacheDir });

    expect(first.items.filter((item) => item.type === "page")).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(new Set(server.requests.map((r) => r.userAgent))).toEqual(new Set([USER_AGENT]));
    expect(USER_AGENT).not.toMatch(/@|mailto/);
    const pageRequests = server.requests.filter((r) => r.path.startsWith("/wp-json/wp/v2/pages")).length;

    expect(pageRequests).toBe(2);
    expect(readdirSync(cacheDir).length).toBeGreaterThan(3);
    const before = server.requests.length;

    await readRest(server.url, { cacheDir });
    // Only the home page (never cached: it's how the API is found) is asked for again.
    expect(server.requests.slice(before).map((r) => r.path)).toEqual(["/"]);
    await readRest(server.url, { cacheDir, fresh: true });
    expect(server.requests.length - before).toBeGreaterThan(5);
  });

  it("reads Retry-After in seconds and as a date", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
    expect(retryAfterMs(null)).toBeNull();
  });

  it("signs in with an application password to read drafts, and never leaks it", async () => {
    server = await startFakeWordPress({ credentials: "ana:abcd efgh ijkl" });
    const wp = await readRest(server.url, { cacheDir: tempDir("cache-"), auth: { user: "ana", password: "abcd efgh ijkl" } });

    expect(wp.source.authenticated).toBe(true);
    expect(wp.items.find((item) => item.id === 104)?.status).toBe("draft");
    expect(server.requests.some((r) => r.authorization)).toBe(true);
    // Files are public: credentials never go with downloads, and the home page is fetched anonymously.
    expect(server.requests.find((r) => r.path === "/")?.authorization).toBe(false);
    const wrong = await readRest(server.url, { cacheDir: tempDir("cache-"), auth: { user: "ana", password: "nope-secret" } }).catch((e: unknown) => e);

    expect((wrong as ImportError).reason).toBe("auth");
    expect(JSON.stringify(wrong) + String((wrong as Error).message)).not.toContain("nope-secret");
  });

  it("notes what it couldn't read instead of failing", async () => {
    server = await startFakeWordPress();
    const wp = await readRest(server.url, { cacheDir: tempDir("cache-"), only: ["posts"] });

    expect(wp.items.every((item) => item.type === "post")).toBe(true);
    expect(wp.notes).toEqual([]);
  });
});
