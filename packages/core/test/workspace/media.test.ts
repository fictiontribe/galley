import { existsSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MediaConfig } from "../../src/types";
import { createWorkspace, listMedia, sanitizeMediaName, saveMedia, type Workspace } from "../../src/workspace/index";
import { cleanupAll, makeRepo, pngHeader, tempDir, WRITABLE, writeTree } from "./helpers";

const open: Workspace[] = [];
const MEDIA: MediaConfig = {
  dir: "public/images",
  publicPath: "/images",
  roots: [
    { dir: "public/images", publicPath: "/images" },
    { dir: "src/assets", publicPath: "/_assets" },
  ],
};

async function workspaceFor(root: string): Promise<Workspace> {
  // Media roots must be writable in content mode; the site model guarantees it, the test states it.
  const ws = await createWorkspace(root, {
    writable: () => ({ ...WRITABLE, content: [...WRITABLE.content, "src/assets/**"] }),
    watch: false,
  });

  open.push(ws);
  return ws;
}

afterEach(async () => {
  while (open.length) await open.pop()?.dispose();
  cleanupAll();
});

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40"/></svg>`;

describe("media library", () => {
  it("lists images under every root with dimensions, type and status", async () => {
    const root = makeRepo({
      "public/images/team/ana.png": pngHeader(640, 480),
      "public/images/logo.svg": SVG,
      "public/images/brochure.pdf": "%PDF-1.4\n",
      "public/images/notes.txt": "not media",
      "public/images/.hidden.png": pngHeader(1, 1),
      "src/assets/hero image.png": pngHeader(1600, 900),
    });

    writeTree(root, { "public/images/new.png": pngHeader(10, 20) });
    const outside = tempDir("ws-outside-");

    writeTree(outside, { "leak.png": pngHeader(5, 5) });
    symlinkSync(outside, join(root, "public/images/linked"));
    const ws = await workspaceFor(root);
    const items = await listMedia(ws, MEDIA);

    expect(items.map((i) => i.path)).toEqual([
      "public/images/brochure.pdf",
      "public/images/logo.svg",
      "public/images/new.png",
      "public/images/team/ana.png",
      "src/assets/hero image.png",
    ]);
    const byPath = Object.fromEntries(items.map((i) => [i.path, i]));

    expect(byPath["public/images/team/ana.png"]).toMatchObject({ url: "/images/team/ana.png", name: "ana.png", type: "image/png", width: 640, height: 480, status: "clean" });
    expect(byPath["public/images/logo.svg"]).toMatchObject({ type: "image/svg+xml", width: 120, height: 40 });
    expect(byPath["public/images/brochure.pdf"]).toMatchObject({ type: "application/pdf" });
    expect(byPath["public/images/brochure.pdf"]?.width).toBeUndefined();
    expect(byPath["public/images/new.png"]).toMatchObject({ status: "added", width: 10, height: 20 });
    expect(byPath["src/assets/hero image.png"]).toMatchObject({ url: "/_assets/hero%20image.png", width: 1600 });
  });

  it("re-measures a file when it changes, and not otherwise", async () => {
    const root = makeRepo({ "public/images/a.png": pngHeader(10, 10) });
    const ws = await workspaceFor(root);

    expect((await listMedia(ws, MEDIA))[0]).toMatchObject({ width: 10 });
    writeFileSync(join(root, "public/images/a.png"), pngHeader(30, 10));
    utimesSync(join(root, "public/images/a.png"), new Date(), new Date(Date.now() + 5000));
    expect((await listMedia(ws, MEDIA))[0]).toMatchObject({ width: 30 });
  });

  it("saves uploads with sanitised, collision-safe names and never overwrites", async () => {
    const root = makeRepo({ "public/images/my-photo-1.png": pngHeader(1, 1) });
    const ws = await workspaceFor(root);
    const events: string[] = [];

    ws.onChange((paths, origin) => events.push(`${origin}:${paths.join(",")}`));
    const first = await saveMedia(ws, MEDIA, { filename: "My Photo (1).PNG", data: pngHeader(300, 200) });
    const second = await saveMedia(ws, MEDIA, { filename: "my photo 1.png", data: pngHeader(300, 200) }, { origin: "agent" });

    expect(first).toMatchObject({ path: "public/images/my-photo-1-2.png", url: "/images/my-photo-1-2.png", name: "my-photo-1-2.png", width: 300, height: 200, status: "added", type: "image/png" });
    expect(second.path).toBe("public/images/my-photo-1-3.png");
    expect(Buffer.from(readFileSync(join(root, "public/images/my-photo-1.png"))).equals(Buffer.from(pngHeader(1, 1)))).toBe(true);
    expect(events).toEqual(["user:public/images/my-photo-1-2.png", "agent:public/images/my-photo-1-3.png"]);

    const nested = await saveMedia(ws, MEDIA, { filename: "Café Menü.svg", directory: "src/assets/menus", data: Buffer.from(SVG) });

    expect(nested).toMatchObject({ path: "src/assets/menus/cafe-menu.svg", url: "/_assets/menus/cafe-menu.svg", width: 120 });
  });

  it("refuses non-media types, oversized or fake images, and folders outside the media roots", async () => {
    const root = makeRepo({ "public/images/.keep": "" });
    const ws = await workspaceFor(root);

    await expect(saveMedia(ws, MEDIA, { filename: "run.sh", data: Buffer.from("echo") })).rejects.toMatchObject({ code: "invalid" });
    await expect(saveMedia(ws, MEDIA, { filename: "page.html", data: Buffer.from("<html>") })).rejects.toMatchObject({ code: "invalid" });
    await expect(saveMedia(ws, MEDIA, { filename: "big.pdf", data: new Uint8Array(25 * 1024 * 1024 + 1) })).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("25 MB"),
    });
    await expect(saveMedia(ws, MEDIA, { filename: "fake.png", data: Buffer.from("<script>") })).rejects.toMatchObject({ code: "invalid" });
    await expect(saveMedia(ws, MEDIA, { filename: "a.png", directory: "src/components", data: pngHeader(1, 1) })).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveMedia(ws, MEDIA, { filename: "a.png", directory: "../outside", data: pngHeader(1, 1) })).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveMedia(ws, MEDIA, { filename: "a.png", directory: "public/imagesX", data: pngHeader(1, 1) })).rejects.toMatchObject({ code: "forbidden" });
    expect(existsSync(join(root, "src/components"))).toBe(false);
  });

  it("sanitises names to lowercase kebab with the original extension", () => {
    expect(sanitizeMediaName("Hello World!.JPEG")).toEqual({ base: "hello-world", ext: "jpeg" });
    expect(sanitizeMediaName("../../etc/passwd.png")).toEqual({ base: "passwd", ext: "png" });
    expect(sanitizeMediaName("....png")).toEqual({ base: "image", ext: "png" });
    expect(sanitizeMediaName("Ünïcode Ñame.webp")).toEqual({ base: "unicode-name", ext: "webp" });
  });
});
