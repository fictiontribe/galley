/**
 * Search & AI visibility over HTTP, against the real engine and a real copy
 * of the starter: the audit, one entry, a fix and its undo, the crawler
 * report, the agent view, and batch planning without an assistant key.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SiteDetail } from "@galley/core/types";
import type { AgentView, CrawlerReport, EntryAudit, FixResult, SiteAudit, WritePlan } from "@galley/core/seo";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/types";

const starter = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));

describe("visibility routes", () => {
  let tmp = "";
  let server: RunningServer;
  let siteId = "";
  // Stands in for the other sites the starter links to, so no request leaves this machine.
  let elsewhere: Server;
  let elsewhereOrigin = "";
  const git = (...args: string[]) => execFileSync("git", args, { cwd: join(tmp, "site"), encoding: "utf8" });

  async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  }

  beforeAll(async () => {
    elsewhere = createServer((request, response) => void response.writeHead(request.url === "/gone/" ? 404 : 200).end("ok"));
    await new Promise<void>((resolve) => elsewhere.listen(0, "127.0.0.1", resolve));
    elsewhereOrigin = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}`;
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-visibility-")));
    const site = join(tmp, "site");

    cpSync(starter, site, { recursive: true, filter: (source) => !["node_modules", ".astro", "dist"].includes(basename(source)) });
    // One planted problem with a deterministic fix: the home page kept out of search.
    const home = join(site, "src/content/pages/index.md");

    writeFileSync(home, readFileSync(home, "utf8").replace(/^description: (.*)$/m, "description: $1\nnoindex: true"));
    // Every link to another site in the content points at the stand-in.
    for (const file of readdirSync(join(site, "src"), { recursive: true, encoding: "utf8" }).filter((name) => /\.(md|json)$/.test(name))) {
      const path = join(site, "src", file);

      writeFileSync(path, readFileSync(path, "utf8").replace(/https:\/\/www\.instagram\.com\//g, `${elsewhereOrigin}/gone/`).replace(/https:\/\/www\.(linkedin|pinterest)\.com\//g, `${elsewhereOrigin}/ok/`));
    }
    git("init", "-q");
    git("symbolic-ref", "HEAD", "refs/heads/main");
    git("config", "user.name", "Visibility Test");
    git("config", "user.email", "visibility@example.invalid");
    git("add", "-A");
    git("commit", "-q", "-m", "First version");
    server = await startServer({ port: 0, home: join(tmp, "home"), webDir: join(tmp, "no-ui"), env: { PATH: process.env.PATH, HOME: tmp }, notice: () => {} });
    siteId = (await api<SiteDetail>("POST", "/api/sites/open", { path: site })).body.id;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    await new Promise((resolve) => elsewhere?.close(resolve));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("audits the site from its content when nothing is rendered, and says so", async () => {
    const { status, body } = await api<SiteAudit>("GET", `/api/sites/${siteId}/visibility`);

    expect(status).toBe(200);
    expect(body.rendering.source).toBe("none");
    expect(body.findings.find((f) => f.code === "noindex-important")).toMatchObject({ severity: "must", url: "/" });
    expect(body.checks.length).toBeGreaterThan(40);
    // The starter uses the site kit: its robots.txt is written from the kit's data file.
    expect(body.crawlers.where).toEqual({ kind: "kit", path: "src/data/visibility.json" });
    expect(body.agentReadable.kit).toMatchObject({ file: "src/data/visibility.json", llmsTxt: true, markdownTwins: true });
  });

  it("audits one entry and applies a fix that can be undone", async () => {
    const entry = await api<EntryAudit>("GET", `/api/sites/${siteId}/visibility/entry?path=${encodeURIComponent("src/content/pages/index.md")}`);
    const finding = entry.body.findings.find((f) => f.code === "noindex-important")!;

    expect(entry.body.preview).toMatchObject({ titleFrom: "content", descriptionFrom: "content" });
    const fixed = await api<FixResult>("POST", `/api/sites/${siteId}/visibility/fix`, { ids: [finding.id] });

    expect(fixed.body.applied).toEqual([{ id: finding.id, path: "src/content/pages/index.md" }]);
    expect(git("diff", "--unified=0")).toMatch(/-noindex: true\n\+noindex: false/);
    const undone = await api<{ restored: string[] }>("POST", `/api/sites/${siteId}/visibility/undo`, { undoId: fixed.body.undoId });

    expect(undone.body.restored).toEqual(["src/content/pages/index.md"]);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("reports the crawler policy, shows what an agent receives, and plans a batch", async () => {
    const crawlers = await api<CrawlerReport>("GET", `/api/sites/${siteId}/visibility/crawlers`);

    expect(crawlers.body).toMatchObject({ editable: true, readable: true, readFrom: "kit" });
    const changed = await api<CrawlerReport>("PUT", `/api/sites/${siteId}/visibility/crawlers`, { choices: { GPTBot: "block" } });

    expect(changed.status).toBe(200);
    expect(changed.body.policy).toBe("Blocks AI training (GPTBot).");
    expect(git("status", "--porcelain")).toBe(" M src/data/visibility.json\n");
    git("checkout", "--", "src/data/visibility.json");
    const view = await api<AgentView>("GET", `/api/sites/${siteId}/visibility/agent-view?url=${encodeURIComponent("/about/")}`);

    expect(view.body).toMatchObject({ kind: "content", url: "/about/" });
    expect(view.body.text.length).toBeGreaterThan(100);
    const plan = await api<WritePlan>("POST", `/api/sites/${siteId}/visibility/write/plan`, { kind: "description" });

    expect(plan.body).toMatchObject({ kind: "description", connected: false, requests: 0 });
    const start = await api<{ error: { code: string } }>("POST", `/api/sites/${siteId}/visibility/write`, { kind: "description" });

    expect(start.status).toBe(400);
    expect(start.body.error.code).toBe("unconfigured");
    expect((await api("POST", `/api/sites/${siteId}/visibility/write`, { kind: "poem" })).status).toBe(400);
    expect((await api("GET", `/api/sites/${siteId}/visibility/write/nope`)).status).toBe(404);
    expect((await api("POST", `/api/sites/${siteId}/visibility/write/nope/cancel`)).status).toBe(404);
  });

  it("checks links to other sites only when asked", async () => {
    const { status, body } = await api<{ checked: number; findings: Array<{ code: string; evidence: { value: string } }> }>("POST", `/api/sites/${siteId}/visibility/external-links`, { limit: 5 });

    expect(status).toBe(200);
    expect(body.checked).toBe(2);
    expect(body.findings.map((f) => [f.code, f.evidence.value])).toEqual([["link-external-dead", `${elsewhereOrigin}/gone/`]]);
  });
});
