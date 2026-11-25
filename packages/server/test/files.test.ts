import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { MediaItem, SiteService } from "@galley/core/types";
import { decodeMediaDataUrl, MAX_MEDIA_BYTES } from "../src/data-url";
import { fake, json, SITE_ID, testApp } from "./helpers";

const root = mkdtempSync(join(tmpdir(), "galley-server-files-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(join(root, "public/images"), { recursive: true });
writeFileSync(join(root, "public/images/logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
writeFileSync(join(root, "public/images/photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
writeFileSync(join(root, "public/page.html"), "<script>steal()</script>");
writeFileSync(join(root, "notes.md"), "# Notes\n");
mkdirSync(join(root, "galley/sections"), { recursive: true });
writeFileSync(join(root, "galley/sections/hero.webp"), Buffer.from("RIFF....WEBPVP8 "));

function fileSite(extra: Partial<SiteService> = {}): SiteService {
  return fake<SiteService>("site", {
    id: SITE_ID,
    root,
    resolvePath: (path: string) => join(root, path),
    readBase: async (path: string) => (path === "public/images/photo.png" ? new Uint8Array([1, 2, 3]) : null),
    ...extra,
  });
}

const S = `/api/sites/${SITE_ID}`;

describe("GET …/raw", () => {
  it.each([
    ["public/images/photo.png", "image/png"],
    ["notes.md", "text/markdown; charset=utf-8"],
    ["public/page.html", "text/plain; charset=utf-8"],
  ])("serves %s as %s with nosniff", async (path, type) => {
    const response = await testApp({ site: fileSite() }).call("GET", `${S}/raw?path=${path}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("serves a section picture kept outside the public folder (galley/sections/hero.webp)", async () => {
    const response = await testApp({ site: fileSite() }).call("GET", `${S}/raw?path=galley/sections/hero.webp`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("RIFF....WEBPVP8 ");
  });

  it("serves SVG as SVG under a CSP that forbids scripts", async () => {
    const response = await testApp({ site: fileSite() }).call("GET", `${S}/raw?path=public/images/logo.svg`);

    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toMatch(/^default-src 'none'; style-src 'unsafe-inline'/);
    expect(await response.text()).toContain("<svg");
  });

  it("serves the published version with rev=base", async () => {
    const response = await testApp({ site: fileSite() }).call("GET", `${S}/raw?path=public/images/photo.png&rev=base`);

    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("404s a file with no published version, and a missing file", async () => {
    const app = testApp({ site: fileSite() });

    expect((await app.call("GET", `${S}/raw?path=notes.md&rev=base`)).status).toBe(404);
    expect((await app.call("GET", `${S}/raw?path=missing.png`)).status).toBe(404);
    expect((await app.call("GET", `${S}/raw?path=public`)).status).toBe(404);
  });

  it("never serves .env or .git files", async () => {
    const app = testApp({ site: fileSite() });

    expect((await app.call("GET", `${S}/raw?path=.env`)).status).toBe(403);
    expect((await app.call("GET", `${S}/raw?path=.git/config`)).status).toBe(403);
    expect((await app.call("GET", `${S}/file?path=.env.production`)).status).toBe(403);
  });

  it("never shows a secrets file's changes or the version history's own files' either", async () => {
    const asked: string[] = [];
    const app = testApp({ site: fileSite({ diff: async (path: string) => (asked.push(path), { path, status: "added", binary: false, hunks: [], additions: 1, deletions: 0 }) as never }) });

    for (const path of [".env", ".env.local", ".envrc", ".env-production", ".ENV", "config/.Envrc", ".git/config", "sub/.GIT/HEAD", ".env/", ".env/.", ".envrc//"]) {
      const response = await app.call("GET", `${S}/diff?path=${encodeURIComponent(path)}`);

      expect(response.status, path).toBe(403);
      expect((await json(response)).error.message, path).toBe("That file can't be shown here.");
    }
    // The engine was never asked for one of them; an ordinary file's changes are shown as before.
    expect(asked).toEqual([]);
    expect((await app.call("GET", `${S}/diff?path=notes.md`)).status).toBe(200);
    expect(asked).toEqual(["notes.md"]);
  });

  it("takes any file whose name starts with .env for a secrets file, and no other", async () => {
    const app = testApp({ site: fileSite() });

    for (const path of [".envrc", ".env-production", ".env_local", ".ENV", "config/.Env.Staging", "sub/.envrc", ".env/", ".env/.", ".envrc//", ".git/", ".envs/production"]) {
      expect((await app.call("GET", `${S}/raw?path=${encodeURIComponent(path)}`)).status, `raw ${path}`).toBe(403);
      expect((await app.call("GET", `${S}/file?path=${encodeURIComponent(path)}`)).status, `file ${path}`).toBe(403);
    }
    // A name that only has "env" in it is an ordinary file: refused by nothing here (it isn't in this site, so 404).
    for (const path of ["src/env.d.ts", "environment.md", "docs/my.env.md", "env"]) {
      expect((await app.call("GET", `${S}/raw?path=${encodeURIComponent(path)}`)).status, `raw ${path}`).not.toBe(403);
      expect((await app.call("GET", `${S}/file?path=${encodeURIComponent(path)}`)).status, `file ${path}`).not.toBe(403);
    }
  });

  it("passes the engine's containment refusal through", async () => {
    const { GalleyError } = await import("@galley/core");
    const site = fileSite({
      resolvePath: () => {
        throw new GalleyError("forbidden", "That file is outside the site.");
      },
    });
    const response = await testApp({ site }).call("GET", `${S}/raw?path=../../etc/passwd`);

    expect(response.status).toBe(403);
    expect((await json(response)).error.message).toBe("That file is outside the site.");
  });
});

describe("GET /api/images/candidates/:candidateId", () => {
  it("streams the candidate with its type, nosniff and a script-free CSP", async () => {
    const { call } = testApp({ images: { read: async (id: string) => (id === "c1" ? { data: new TextEncoder().encode("<svg/>"), mime: "image/svg+xml" } : null) } });
    const response = await call("GET", "/api/images/candidates/c1");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    expect(await response.text()).toBe("<svg/>");
    expect((await call("GET", "/api/images/candidates/gone")).status).toBe(404);
  });

  it("never serves a candidate as HTML", async () => {
    const { call } = testApp({ images: { read: async () => ({ data: new Uint8Array([60]), mime: "text/html" }) } });

    expect((await call("GET", "/api/images/candidates/c1")).headers.get("content-type")).toBe("application/octet-stream");
  });

  it("requires a session", async () => {
    expect((await testApp().raw("GET", "/api/images/candidates/c1")).status).toBe(401);
  });
});

describe("POST …/media (data: URL uploads)", () => {
  const saved: Array<{ filename: string; directory?: string; size: number }> = [];
  const site = fake<SiteService>("site", {
    id: SITE_ID,
    saveMedia: async (input) => {
      saved.push({ filename: input.filename, directory: input.directory, size: input.data.byteLength });
      return { path: `public/images/${input.filename}` } as MediaItem;
    },
  });
  const png = (bytes: number) => `data:image/png;base64,${Buffer.alloc(bytes, 7).toString("base64")}`;

  it("decodes and saves an image", async () => {
    const response = await testApp({ site }).call("POST", `${S}/media`, { filename: "hero.png", directory: "public/images", data: png(1000) });

    expect(response.status).toBe(200);
    expect(saved.at(-1)).toEqual({ filename: "hero.png", directory: "public/images", size: 1000 });
  });

  it("adds the extension from the type when the name has none", async () => {
    await testApp({ site }).call("POST", `${S}/media`, { filename: "hero", data: `data:image/webp;base64,${Buffer.from("x").toString("base64")}` });
    expect(saved.at(-1)!.filename).toBe("hero.webp");
  });

  it("refuses a file over 25 MB in plain words", async () => {
    const response = await testApp({ site }).call("POST", `${S}/media`, { filename: "big.png", data: png(MAX_MEDIA_BYTES + 10) });
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error.message).toBe("That file is too large. Media files can be up to 25 MB.");
  });

  it("refuses types that aren't media", async () => {
    const response = await testApp({ site }).call("POST", `${S}/media`, { filename: "x.html", data: "data:text/html;base64,PHNjcmlwdD4=" });

    expect(response.status).toBe(400);
    expect((await json(response)).error.message).toBe("Only images, MP4 videos, and PDFs can be added to media.");
  });

  it("refuses a media type under a non-media file name", async () => {
    const response = await testApp({ site }).call("POST", `${S}/media`, { filename: "evil.html", data: png(10) });

    expect(response.status).toBe(400);
  });

  it("refuses something that isn't a data: URL", async () => {
    const response = await testApp({ site }).call("POST", `${S}/media`, { filename: "x.png", data: "https://example.com/x.png" });

    expect(response.status).toBe(400);
    expect((await json(response)).error.message).toBe("That upload couldn't be read. Choose the file again.");
  });

  it("refuses a request body over 40 MB with 413", async () => {
    const response = await testApp({ site }).call("POST", `${S}/media`, { filename: "huge.png", data: png(31 * 1024 * 1024) });

    expect(response.status).toBe(413);
    expect((await json(response)).error.message).toMatch(/40 MB/);
  });

  it("decodes percent-encoded SVG", () => {
    const decoded = decodeMediaDataUrl("data:image/svg+xml,%3Csvg%2F%3E");

    expect(decoded.mime).toBe("image/svg+xml");
    expect(Buffer.from(decoded.data).toString()).toBe("<svg/>");
  });
});

describe("GET /api/starters/:starterId/preview", () => {
  const picture = join(root, "starter-preview.png");

  writeFileSync(picture, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const asked: Array<[string, string | undefined]> = [];
  const registry = {
    starterPreview: async (id: string, look?: string) => {
      asked.push([id, look]);
      return id === "studio" ? { path: picture, type: "image/png" } : null;
    },
  };

  it("serves only what the registry says the starter declares, as a sandboxed image", async () => {
    const { call } = testApp({ registry });
    const response = await call("GET", "/api/starters/studio/preview?look=dusk");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(asked).toContainEqual(["studio", "dusk"]);
    expect((await call("GET", "/api/starters/other/preview")).status).toBe(404);
  });

  it("requires a session", async () => {
    const response = await testApp({ registry }).raw("GET", "/api/starters/studio/preview");

    expect(response.status).toBe(401);
    expect((await json(response)).error.code).toBe("unauthorized");
  });
});
