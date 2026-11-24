import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GalleyError } from "@galley/core";
import type { SiteService } from "@galley/core/types";
import { loadBrand } from "../src/brand";
import { fake, json, SITE_ID, testApp } from "./helpers";

const dir = mkdtempSync(join(tmpdir(), "galley-server-brand-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function failing(error: unknown) {
  return fake<SiteService>("site", {
    id: SITE_ID,
    changes: async () => {
      throw error;
    },
  });
}

describe("error mapping", () => {
  it.each([
    ["not-found", 404],
    ["conflict", 409],
    ["forbidden", 403],
    ["invalid", 400],
    ["git", 500],
    ["ai", 502],
    ["busy", 409],
  ] as const)("GalleyError %s → %i with its message", async (code, status) => {
    const response = await testApp({ site: failing(new GalleyError(code, "Plain words here.", "git said no")) }).call("GET", `/api/sites/${SITE_ID}/changes`);
    const body = await json(response);

    expect(response.status).toBe(status);
    expect(body.error).toEqual({ code, message: "Plain words here.", detail: "git said no" });
  });

  it("drops a detail that carries a stack trace", async () => {
    const error = new GalleyError("git", "Couldn't publish.", "Error: x\n    at run (/Users/someone/site/file.ts:1:1)");
    const body = await json(await testApp({ site: failing(error) }).call("GET", `/api/sites/${SITE_ID}/changes`));

    expect(body.error).toEqual({ code: "git", message: "Couldn't publish." });
  });

  it("anything else becomes a generic internal error, logged with its stack and never sent", async () => {
    const app = testApp({ site: failing(new Error("ENOENT: no such file, open '/Users/someone/secret/path.md'")) });
    const response = await app.call("GET", `/api/sites/${SITE_ID}/changes`);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: { code: "internal", message: "That couldn't be done because of an unexpected problem. Try again." } });
    expect(text).not.toContain("/Users/");
    expect(text).not.toContain("ENOENT");
    expect(app.logs.join("\n")).toContain("ENOENT");
    expect(app.logs.join("\n")).toMatch(/\n\s+at /);
  });

  it("a failure of the server's own is logged once, with its cause, and the cause never reaches the browser", async () => {
    const app = testApp({ site: failing(new GalleyError("internal", "The editor couldn't save its own state: the disk reported an error. Nothing was changed. Try again.", "EIO")) });
    const response = await app.call("GET", `/api/sites/${SITE_ID}/changes`);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: { code: "internal", message: "The editor couldn't save its own state: the disk reported an error. Nothing was changed. Try again." } });
    expect(text).not.toContain("EIO");
    expect(app.logs).toEqual([`GET /api/sites/${SITE_ID}/changes failed: The editor couldn't save its own state: the disk reported an error. Nothing was changed. Try again. (EIO)`]);
  });

  it("an unexpected error that carries the system's code has it in its log line", async () => {
    const app = testApp({ site: failing(Object.assign(new Error("EMFILE: too many open files, open '/data/x'"), { code: "EMFILE" })) });
    const response = await app.call("GET", `/api/sites/${SITE_ID}/changes`);

    expect(response.status).toBe(500);
    expect(app.logs).toHaveLength(1);
    expect(app.logs[0]).toMatch(new RegExp(`^GET /api/sites/${SITE_ID}/changes failed \\(EMFILE\\):\\n`));
  });

  it("an internal GalleyError hides its detail", async () => {
    const body = await json(await testApp({ site: failing(new GalleyError("internal", "Couldn't read the site.", "stack here")) }).call("GET", `/api/sites/${SITE_ID}/changes`));

    expect(body.error).toEqual({ code: "internal", message: "Couldn't read the site." });
  });

  it("a fake that wasn't given a method fails loudly as internal", async () => {
    const app = testApp({ site: fake<SiteService>("site", { id: SITE_ID }) });
    const response = await app.call("GET", `/api/sites/${SITE_ID}/changes`);

    expect(response.status).toBe(500);
    expect(app.logs.join("\n")).toContain("site.changes not faked");
  });

  it("API responses carry nosniff and no-store", async () => {
    const response = await testApp().raw("GET", "/api/meta");

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("brand", () => {
  it("defaults to the built-in brand", () => {
    expect(loadBrand({}).productName).toBe("Galley");
  });

  it("a brand file overrides the default, and env shortcuts override the file", () => {
    const file = join(dir, "brand.json");

    writeFileSync(file, JSON.stringify({ productName: "Inkwell", byline: "", accent: "#123456", docsUrl: "https://docs.example.com" }));
    expect(loadBrand({ GALLEY_BRAND_FILE: file })).toMatchObject({ productName: "Inkwell", byline: "", accent: "#123456", docsUrl: "https://docs.example.com" });
    expect(loadBrand({ GALLEY_BRAND_FILE: file, GALLEY_BRAND_NAME: "Quill", GALLEY_BRAND_ACCENT: "#abc" })).toMatchObject({ productName: "Quill", accent: "#abc" });
  });

  it("refuses a brand file with unknown keys or bad values, in plain words", () => {
    const file = join(dir, "bad.json");

    writeFileSync(file, JSON.stringify({ productName: "X", accent: "blue" }));
    expect(() => loadBrand({ GALLEY_BRAND_FILE: file })).toThrow(/hex color/);
    writeFileSync(file, JSON.stringify({ name: "X" }));
    expect(() => loadBrand({ GALLEY_BRAND_FILE: file })).toThrow(/isn't expected/);
    writeFileSync(file, "{not json");
    expect(() => loadBrand({ GALLEY_BRAND_FILE: file })).toThrow(/isn't valid JSON/);
    expect(() => loadBrand({ GALLEY_BRAND_FILE: join(dir, "missing.json") })).toThrow(/doesn't exist/);
    expect(() => loadBrand({ GALLEY_BRAND_ACCENT: "red" })).toThrow(/GALLEY_BRAND_ACCENT/);
  });

  it("meta serves the configured brand", async () => {
    const meta = await json(await testApp({}, { brand: { productName: "Inkwell", byline: "", accent: "#123456" } }).raw("GET", "/api/meta"));

    expect(meta.brand).toEqual({ productName: "Inkwell", byline: "", accent: "#123456" });
  });
});
