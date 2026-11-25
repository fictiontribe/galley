/** Links to other sites, checked only when asked, against a local server standing in for them; and what an agent reads. */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentView, checkExternalLinks } from "../../src/seo/external";
import { disposeAll, openSite } from "../site/helpers";
import { cleanFiles, cleanRendered, distFiles, makeFixture } from "./fixture";

let server: Server;
let origin = "";
const seen: Array<{ method: string; url: string; agent: string }> = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push({ method: request.method ?? "", url: request.url ?? "", agent: String(request.headers["user-agent"]) });
    if (request.url === "/head-refused" && request.method === "HEAD") return void response.writeHead(405).end();
    response.writeHead(request.url === "/gone" ? 410 : request.url === "/missing" ? 404 : 200).end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await disposeAll();
  await new Promise((resolve) => server.close(resolve));
});

describe("links to other sites", () => {
  it("reports the ones that answer “gone” or “not found”, politely and within the cap", async () => {
    const files = cleanFiles();

    files["src/content/pages/about.md"] = String(files["src/content/pages/about.md"]).replace(
      "Read [the journal](/blog/)",
      `Our [mill](${origin}/ok), [the old dairy](${origin}/gone), [a recipe](${origin}/missing) and [the market](${origin}/head-refused). Read [the journal](/blog/)`
    );
    const { site } = await openSite(makeFixture(files));
    const result = await checkExternalLinks(site, { limit: 10, concurrency: 2 });

    expect(result).toMatchObject({ checked: 4, total: 4 });
    expect(result.findings.map((f) => f.evidence.value).sort()).toEqual([`${origin}/gone`, `${origin}/missing`]);
    expect(result.findings[0]).toMatchObject({ code: "link-external-dead", path: "src/content/pages/about.md" });
    expect(seen.filter((r) => r.url === "/head-refused").map((r) => r.method)).toEqual(["HEAD", "GET"]);
    expect(seen.every((r) => /link-check/.test(r.agent))).toBe(true);
    expect((await checkExternalLinks(site, { limit: 1 })).checked).toBe(1);
  });
});

describe("what an agent reads, and a secrets file", () => {
  const SECRET = "TOKEN=not-for-an-agent";
  const leak = (twin: string) => `<!doctype html><html lang="en"><head><title>A page</title><link rel="alternate" type="text/markdown" href="${twin}"></head><body><h1>A page</h1><p>Its own words.</p></body></html>`;

  it("is never one that sits in the build folder, whatever a page names as its markdown version", async () => {
    const dist = distFiles(cleanRendered(), { "dist/leak/index.html": leak("/.env"), "dist/other/index.html": leak("/keys/.env.production"), "dist/.env": `${SECRET}\n`, "dist/keys/.env.production": `${SECRET}\n` });
    const { site } = await openSite(makeFixture(cleanFiles(), dist));

    for (const page of ["/leak/", "/other/"]) {
      const view = await agentView(site, page);

      expect(view.text, page).not.toContain("not-for-an-agent");
      expect(view.kind, page).toBe("text");
      expect(view.text, page).toContain("Its own words.");
    }
    // Asked for by its own address it is not there.
    for (const path of ["/.env", "/keys/.env.production", "/.env/"]) expect((await agentView(site, path)).text, path).not.toContain("not-for-an-agent");
  });

  it.each([".", "./", ".git", "..", ".envs"])("is never read out of a build folder the settings name as %s", async (outDir) => {
    const files = cleanFiles();

    files["galley.config.json"] = `${JSON.stringify({ ...JSON.parse(String(files["galley.config.json"])), build: { command: "true", outDir } }, null, 2)}\n`;
    files["index.html"] = leak("/.env");
    files["leak.html"] = leak("/.env");
    const root = makeFixture(files, { ".env": `${SECRET}\n`, ".envs/index.html": leak("/.env"), ".envs/.env": `${SECRET}\n` });
    const { site } = await openSite(root);

    for (const page of ["/", "/leak.html", "/.env", "/config"]) expect(JSON.stringify(await agentView(site, page)), page).not.toContain("not-for-an-agent");
  });
});

describe("what an agent reads", () => {
  it("is the page's markdown version when it is served, else what the content says", async () => {
    const built = await openSite(makeFixture(cleanFiles(), distFiles(cleanRendered())));
    const markdown = await agentView(built.site, "/about/");

    expect(markdown.kind).toBe("markdown");
    expect(markdown.text).toMatch(/^---\ntitle: "About the bakery"\n---\n\n# About the bakery\n/);
    const plain = await openSite(makeFixture(cleanFiles()));
    const content = await agentView(plain.site, "/about/");

    expect(content.kind).toBe("content");
    expect(content.text).toMatch(/converted net loft/);
  });
});
