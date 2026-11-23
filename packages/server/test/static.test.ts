import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { testApp } from "./helpers";

const webDir = mkdtempSync(join(tmpdir(), "galley-server-web-"));
const empty = mkdtempSync(join(tmpdir(), "galley-server-web-empty-"));

afterAll(() => {
  rmSync(webDir, { recursive: true, force: true });
  rmSync(empty, { recursive: true, force: true });
});

mkdirSync(join(webDir, "assets"));
writeFileSync(join(webDir, "index.html"), '<!doctype html><div id="root"></div>');
writeFileSync(join(webDir, "assets/index-abc123.js"), "console.log(1)");
writeFileSync(join(webDir, "favicon.svg"), "<svg/>");

describe("static UI", () => {
  const app = () => testApp({}, { webDir, frameSources: ["http://127.0.0.1:*", "http://localhost:*"] });

  it("serves index.html at / with no-cache and the UI CSP", async () => {
    const response = await app().raw("GET", "/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    const csp = response.headers.get("content-security-policy")!;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src http://127.0.0.1:* http://localhost:*");
    expect(csp).not.toMatch(/\*(?!\s|;|$)|unsafe-eval|https?:\/\/\*/);
    expect(await response.text()).toContain('id="root"');
  });

  it("caches hashed assets for a year", async () => {
    const response = await app().raw("GET", "/assets/index-abc123.js");

    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("serves other files with no-cache", async () => {
    const response = await app().raw("GET", "/favicon.svg");

    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("falls back to index.html for client-side routes", async () => {
    const response = await app().raw("GET", "/sites/abc/proof");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
  });

  it("404s a missing hashed asset instead of serving HTML", async () => {
    expect((await app().raw("GET", "/assets/old-123.js")).status).toBe(404);
  });

  it("never serves outside the web folder", async () => {
    const response = await app().raw("GET", "/..%2f..%2fetc%2fpasswd");

    expect(await response.text()).not.toContain("root:");
  });

  it("does not fall back for /api paths", async () => {
    const response = await app().call("GET", "/api/unknown");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/json/);
  });

  it("shows a plain page when the UI hasn't been built", async () => {
    for (const dir of [null, empty, join(empty, "missing")]) {
      const response = await testApp({}, { webDir: dir }).raw("GET", "/sites/x");
      const html = await response.text();

      expect(response.status).toBe(503);
      expect(html).toContain("pnpm --filter @galley/web build");
      expect(html).toContain("Galley");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    }
  });

  it("the not-built page uses the configured brand name", async () => {
    const response = await testApp({}, { webDir: null, brand: { productName: "Inkwell", byline: "" } }).raw("GET", "/");
    const html = await response.text();

    expect(html).toContain("Inkwell");
    expect(html).not.toContain("Galley");
  });
});
