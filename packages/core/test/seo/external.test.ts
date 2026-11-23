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
