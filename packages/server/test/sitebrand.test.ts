/**
 * The site's brand over HTTP, against the real engine and a real copy of the
 * starter — with no assistant key, so the deterministic half runs end to end:
 * material in chunks, a refused private address, the analysis job, answers,
 * save as pending changes, apply, check, drift, both exports, import, and the
 * file routes' headers.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrandProposal, BrandSource, SiteBrandState } from "@galley/core/sitebrand";
import type { AddSitesResult, Job } from "@galley/core/types";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/types";

const starter = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));

/** A tiny RGBA PNG of one flat colour, written by hand. */
function png(hex: string, size = 4): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b, 255]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

describe("the site's brand over HTTP", () => {
  let tmp = "";
  let server: RunningServer;
  let siteId = "";
  let site = "";
  const S = () => `/api/sites/${siteId}/brand`;

  async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T; text: string; headers: Headers }> {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = null;

    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed as T, text, headers: response.headers };
  }

  async function waitForJob(id: string): Promise<Job> {
    for (let i = 0; i < 200; i += 1) {
      const job = await api<Job>("GET", `/api/jobs/${id}`);

      if (job.body.state !== "running") return job.body;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("the job didn't finish");
  }

  beforeAll(async () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-brand-http-")));
    site = join(tmp, "sites", "paper-studio");
    cpSync(starter, site, { recursive: true, filter: (source) => !["node_modules", ".astro", "dist"].includes(basename(source)) });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: site });
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "add", "-A"], { cwd: site });
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "First"], { cwd: site });
    // The starter's installed font packages, so the site's own web fonts can be served.
    symlinkSync(join(starter, "node_modules"), join(site, "node_modules"), "dir");
    appendFileSync(join(site, ".git", "info", "exclude"), "node_modules\n");
    server = await startServer({ port: 0, home: join(tmp, "home"), webDir: join(tmp, "no-ui"), env: { PATH: process.env.PATH, HOME: tmp }, notice: () => {} });
    const added = await api<AddSitesResult>("POST", "/api/sites/add", { paths: [site] });

    siteId = added.body.added[0]!.id;
  });

  afterAll(async () => {
    await server?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("starts empty, says the site has pages, and that no assistant key is set", async () => {
    const state = await api<SiteBrandState>("GET", S());

    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ brand: null, proposal: null, sources: [], hasPages: true, assistant: false, settings: { dir: "galley/brand", largeFileBytes: 10 * 1024 * 1024 } });
  });

  it("takes material in chunks, sniffs it, keeps notes, and serves it under a no-script policy", async () => {
    const picture = png("#F6F1E7").toString("base64");
    const half = Math.floor(png("#F6F1E7").length / 2);
    const bytes = png("#F6F1E7");
    const first = await api<{ uploadId: string; received: number; source: BrandSource | null }>("POST", `${S()}/sources`, { name: "paper.png", total: bytes.length, offset: 0, chunk: bytes.subarray(0, half).toString("base64") });

    expect(first.body).toMatchObject({ received: half, source: null });
    const second = await api<{ source: BrandSource }>("POST", `${S()}/sources`, { uploadId: first.body.uploadId, name: "paper.png", total: bytes.length, offset: half, chunk: bytes.subarray(half).toString("base64"), note: "the paper" });

    expect(second.body.source).toMatchObject({ name: "paper.png", type: "image", mime: "image/png", width: 4, height: 4 });
    expect(second.body.source.learned.join(" ")).toMatch(/#F6F1E7 \(100%\)/);
    expect(picture.length).toBeGreaterThan(0);
    const file = await fetch(`${server.url}${S()}/sources/${second.body.source.id}/file?kind=picture`, { headers: { authorization: `Bearer ${server.token}` } });

    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-security-policy")).toMatch(/sandbox/);
    const patched = await api<BrandSource>("PATCH", `${S()}/sources/${second.body.source.id}`, { note: "old logo, do not use" });

    expect(patched.body.note).toBe("old logo, do not use");
    const refused = await api<{ error: { message: string } }>("POST", `${S()}/sources`, { name: "x.zip", total: 4, offset: 0, chunk: Buffer.from([0x50, 0x4b, 3, 0xff]).toString("base64") });

    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/can't be read here/);
  });

  it("refuses a website address on a private network", async () => {
    const response = await api<{ error: { message: string } }>("POST", `${S()}/website`, { url: "https://127.0.0.1/" });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/private or local network/);
  });

  it("reads the site and the material, then saves the brand as pending changes only in galley/brand", async () => {
    const started = await api<Job>("POST", `${S()}/analyse`, { from: "site" });

    expect(started.body).toMatchObject({ kind: "brand", state: "running" });
    expect((await waitForJob(started.body.id)).state).toBe("done");
    let state = (await api<SiteBrandState>("GET", S())).body;

    expect(state.proposal?.brand.colors.find((c) => c.role === "accent")?.token).toBe("--color-accent");
    expect(state.proposal?.findings[0]?.id).toBe("no-assistant");
    expect(state.webFonts.map((f) => f.family)).toEqual(expect.arrayContaining(["Newsreader Variable"]));
    const ask = await api<{ error: { code: string } }>("POST", `${S()}/ask`, { text: "make the accent warmer" });

    expect(ask.body.error.code).toBe("unconfigured");
    const edited = { ...state.proposal!.brand, colors: state.proposal!.brand.colors.map((c) => (c.role === "accent" ? { ...c, value: "#2E2BFF" } : c)) };
    const put = await api<BrandProposal>("PUT", `${S()}/proposal`, { brand: edited });

    expect(put.body.brand.colors.find((c) => c.role === "accent")?.value).toBe("#2E2BFF");
    const saved = await api<{ paths: string[] }>("POST", `${S()}/save`);

    expect(saved.body.paths).toEqual(expect.arrayContaining(["galley/brand/brand.json", "galley/brand/guide.md", "galley/brand/sources/manifest.json", "galley/brand/sources/paper.png"]));
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: site, encoding: "utf8" }).trim().split("\n");

    expect(status.every((line) => / galley\/brand\//.test(line) || line.endsWith(" galley/"))).toBe(true);
    state = (await api<SiteBrandState>("GET", S())).body;
    expect(state.brand?.colors.find((c) => c.role === "accent")?.value).toBe("#2E2BFF");
    expect(state.digest).toContain("#2E2BFF");
    expect(state.pending.length).toBeGreaterThan(0);

    const plan = await api<{ edits: Array<{ token: string }> }>("GET", `${S()}/apply`);

    expect(plan.body.edits.map((e) => e.token)).toEqual(["--color-accent"]);
    const applied = await api<{ paths: string[] }>("POST", `${S()}/apply`);

    expect(applied.body.paths).toEqual(["src/styles/tokens.css"]);
    const check = await api<{ items: unknown[] }>("POST", `${S()}/check`, {});

    expect(check.status).toBe(200);
    expect(Array.isArray(check.body.items)).toBe(true);
  });

  it("never serves or packs a secrets file as brand material, whatever the saved list of material names", async () => {
    const manifestFile = join(site, "galley/brand/sources/manifest.json");
    const before = readFileSync(manifestFile, "utf8");
    const manifest = JSON.parse(before) as { sources: Array<Record<string, unknown>> };
    const picture = manifest.sources.find((source) => typeof source.file === "string")!;
    const headers = { authorization: `Bearer ${server.token}` };

    writeFileSync(join(site, ".env"), "TOKEN=not-brand-material\n");
    // The same kind of entry, naming a secrets file (and one of the version history's own) where its picture was.
    const named = [".env", ".git/config"].map((file, at) => ({ ...picture, id: `named-${at}`, name: `named-${at}.txt`, file, mime: "text/plain" }));

    writeFileSync(manifestFile, `${JSON.stringify({ ...manifest, sources: [...manifest.sources, ...named] }, null, 2)}\n`);
    try {
      for (const source of named) {
        const file = await fetch(`${server.url}${S()}/sources/${source.id}/file?kind=original`, { headers });

        expect(file.status, source.file).toBe(404);
        expect(await file.text(), source.file).not.toMatch(/not-brand-material|repositoryformatversion/);
      }
      // The picture saved beside them is served as before.
      expect((await fetch(`${server.url}${S()}/sources/${String(picture.id)}/file?kind=original`, { headers })).status).toBe(200);
      const bundle = await (await fetch(`${server.url}${S()}/export?format=brand`, { headers })).text();

      expect(bundle).not.toContain(Buffer.from("TOKEN=not-brand-material\n").toString("base64"));
      expect(bundle).not.toContain("not-brand-material");
    } finally {
      writeFileSync(manifestFile, before);
      rmSync(join(site, ".env"), { force: true });
    }
  });

  it("checks drift, exports both formats, imports a bundle, and refuses unknown fonts", async () => {
    const page = { path: "/", title: "Home", viewport: { width: 1280, height: 800 }, pairs: [{ text: "#123456", background: "#FFFFFF", area: 10_000, count: 3, roles: ["body"], ratio: 9 }], grounds: [], type: [], radii: [], shadows: [], spacing: [], buttons: [], links: [], logos: [], fonts: [], variables: [], internalLinks: [], copy: [], truncated: false };
    const drift = await api<{ unknown: Array<{ value: string }> }>("POST", `${S()}/drift`, { measurements: [page] });

    expect(drift.body.unknown.map((u) => u.value)).toContain("#123456");
    const badDrift = await api("POST", `${S()}/drift`, { measurements: [{ path: "/", evil: true }] });

    expect(badDrift.status).toBe(400);
    const tokens = await fetch(`${server.url}${S()}/export?format=tokens`, { headers: { authorization: `Bearer ${server.token}` } });

    expect(tokens.headers.get("content-type")).toBe("application/design-tokens+json");
    expect(tokens.headers.get("content-disposition")).toMatch(/\.tokens\.json"$/);
    expect(((await tokens.json()) as { color: { $type: string } }).color.$type).toBe("color");
    const bundle = await (await fetch(`${server.url}${S()}/export?format=brand`, { headers: { authorization: `Bearer ${server.token}` } })).json();
    const imported = await api<BrandProposal>("POST", `${S()}/import`, { bundle });

    expect(imported.body.findings[0]?.id).toBe("imported");
    expect((await api("DELETE", `${S()}/proposal`)).status).toBe(200);
    expect((await api("GET", `${S()}/fonts/nope`)).status).toBe(404);
    const state = (await api<SiteBrandState>("GET", S())).body;
    const font = await fetch(`${server.url}${state.webFonts[0]!.url}`, { headers: { authorization: `Bearer ${server.token}` } });

    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
  });

  it("removes material and stops an analysis on request", async () => {
    const bytes = Buffer.from("Paper #F6F1E7");
    const added = await api<{ source: BrandSource }>("POST", `${S()}/sources`, { name: "note.txt", total: bytes.length, offset: 0, chunk: bytes.toString("base64") });

    expect((await api("DELETE", `${S()}/sources/${added.body.source.id}`)).status).toBe(200);
    expect((await api("POST", `${S()}/cancel`)).status).toBe(200);
  });
});
