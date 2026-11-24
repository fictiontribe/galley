/**
 * Bringing a WordPress site over, through the HTTP API, against the real
 * engine, copies of the starter, an invented WordPress on this computer, and
 * the real assistant runtime answering from a scripted model (no live
 * calls): the quick look, upload, plan, run, stop part-way, the report, the
 * hosted-mode address guard, what never happens to an application password,
 * and rebuilding page-builder pages one at a time or as a queue.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentRuntime, type GalleyImageService } from "@galley/core/ai";
import type { ChatThread, ImportInspection, ImportPlanView, ImportRebuildPlan, ImportRebuildStatus, ImportRunStatus, ServerEvent, SiteDetail } from "@galley/core/types";
import { buildFakeSite, serveFakeSite, writeFakeSiteWxr, type RunningFakeSite } from "../../import-wordpress/test/fake-site";
import { git, makeSite, tempDir } from "../../import-wordpress/test/helpers";
import { scriptedFetch, stream, testClient, TEST_KEY } from "../../core/test/ai/helpers/scripted-fetch";
import { createServices } from "../src/compose";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/types";

const SECRET = "wxyz 1234 abcd 5678 efgh 9012";
const wpSite = buildFakeSite({ posts: 10, pages: 4, elementor: 2 });
let fake: RunningFakeSite;
let locked: RunningFakeSite;
let slow: RunningFakeSite;
let server: RunningServer;
let hosted: RunningServer;
let hostedSite = "";
let home = "";
let wxr = "";
const events: ServerEvent[] = [];
const script = scriptedFetch(Array.from({ length: 8 }, (_, i) => stream({ content: [{ type: "text", text: `I rebuilt the page from the site's sections (${i + 1}).` }], stop_reason: "end_turn" })));

async function call<T>(target: RunningServer, method: string, path: string, body?: unknown): Promise<{ status: number; body: T; text: string }> {
  const response = await fetch(`${target.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${target.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();

  return { status: response.status, body: (text ? JSON.parse(text) : null) as T, text };
}
const api = <T>(method: string, path: string, body?: unknown) => call<T>(server, method, path, body);

async function open(name: string): Promise<{ id: string; root: string }> {
  const root = makeSite(name);

  return { id: (await api<SiteDetail>("POST", "/api/sites/open", { path: root })).body.id, root };
}

async function finished(siteId: string, runId: string): Promise<ImportRunStatus> {
  for (let i = 0; i < 600; i += 1) {
    const { body } = await api<ImportRunStatus>("GET", `/api/sites/${siteId}/import/runs/${runId}`);

    if (body.state !== "running") return body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the import never finished");
}

function everyFile(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isSymbolicLink() || entry.name === "node_modules" || entry.name === ".git") return [];
    return entry.isDirectory() ? everyFile(path) : [path];
  });
}

beforeAll(async () => {
  fake = await serveFakeSite(wpSite);
  locked = await serveFakeSite(wpSite, { credentials: `ines:${SECRET}` });
  slow = await serveFakeSite(buildFakeSite({ posts: 30, pages: 2, elementor: 0 }), { mediaDelayMs: 60 });
  wxr = join(tempDir("srv-wxr-"), "fernhill.WordPress.xml");
  writeFakeSiteWxr(wpSite, fake.url, wxr);
  home = tempDir("srv-home-");
  const env = { PATH: process.env.PATH, HOME: home, ANTHROPIC_API_KEY: TEST_KEY, GALLEY_DISABLE_USER_PLUGINS: "1" };
  const services = await createServices({ home, sitesDir: tempDir("srv-sites-"), startersDir: tempDir("srv-starters-"), env });

  // The real assistant runtime, answering from a scripted model.
  services.agent = createAgentRuntime({ home, registry: services.registry, settings: services.settings, images: services.images as GalleyImageService, events: services.events, client: testClient(script.fetch), logger: () => undefined });
  services.events.subscribe((event) => events.push(event));
  server = await startServer({ port: 0, home, webDir: join(home, "no-ui"), env, services, notice: () => {} });
  hostedSite = makeSite("hosted");
  // Hosted mode opens sites only inside its sites folder.
  hosted = await startServer({ port: 0, mode: "hosted", sitesDir: dirname(hostedSite), password: "a long operator password", token: "operator-token-for-tests", home: tempDir("srv-hosted-"), webDir: join(home, "no-ui"), env: { PATH: process.env.PATH, HOME: home, GALLEY_DISABLE_USER_PLUGINS: "1" }, notice: () => {} });
}, 120_000);

afterAll(async () => {
  await server?.close();
  await hosted?.close();
  await Promise.all([fake?.close(), locked?.close(), slow?.close()]);
});

describe("step 1: where is it?", () => {
  it("looks at an address: WordPress, readable, how much — and says when it's on this computer", async () => {
    const site = await open("look");
    const { status, body } = await api<ImportInspection>("POST", `/api/sites/${site.id}/import/inspect`, { source: { kind: "address", address: fake.url } });

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, title: "Fernhill Garden Studio", counts: { posts: 10, pages: 4, comments: 37 } });
    expect(body.notes.join(" ")).toMatch(/on this computer or your local network/);
  });

  it("explains a site that hides its content, and a wrong password, as answers rather than errors", async () => {
    const site = await open("hidden");
    const hidden = await api<ImportInspection>("POST", `/api/sites/${site.id}/import/inspect`, { source: { kind: "address", address: locked.url } });

    expect(hidden.status).toBe(200);
    expect(hidden.body.problem).toMatchObject({ reason: "blocked", offer: ["password", "file"] });
    expect(hidden.body.problem!.message).toMatch(/hides its content from visitors\. Add an application password, or upload an export file instead\./);
    const wrong = await api<ImportInspection>("POST", `/api/sites/${site.id}/import/inspect`, { source: { kind: "address", address: locked.url, user: "ines", password: "not the one" } });

    // Never a 401: that would tell the app its own session ended.
    expect(wrong.status).toBe(200);
    expect(wrong.body.problem?.reason).toBe("auth");
    const right = await api<ImportInspection>("POST", `/api/sites/${site.id}/import/inspect`, { source: { kind: "address", address: locked.url, user: "ines", password: SECRET } });

    expect(right.body).toMatchObject({ ok: true, signedIn: true, counts: { posts: 10 } });
  });

  it("takes an export file in chunks, sniffs it, and keeps it in the site's state folder — never the site", async () => {
    const site = await open("upload");
    const notExport = await api<{ error: { message: string } }>("POST", `/api/sites/${site.id}/import/upload`, { name: "notes.xml", total: 12, offset: 0, chunk: Buffer.from("<notes></notes>").toString("base64").slice(0, 16) });

    expect(notExport.status).toBe(400);
    expect(notExport.body.error.message).toMatch(/isn't a WordPress export\. In WordPress, open Tools › Export/);
    const bytes = readFileSync(wxr);
    const half = Math.ceil(bytes.length / 2);
    const first = await api<{ uploadId: string; received: number; upload: null }>("POST", `/api/sites/${site.id}/import/upload`, { name: "fernhill.xml", total: bytes.length, offset: 0, chunk: bytes.subarray(0, half).toString("base64") });
    const last = await api<{ upload: { id: string; size: number } }>("POST", `/api/sites/${site.id}/import/upload`, { uploadId: first.body.uploadId, name: "fernhill.xml", total: bytes.length, offset: half, chunk: bytes.subarray(half).toString("base64") });

    expect(last.body.upload).toMatchObject({ id: first.body.uploadId, size: bytes.length });
    expect(everyFile(join(home, "state", site.id, "import", "uploads"))).toHaveLength(1);
    expect(git(site.root, "status", "--porcelain", "-uall")).toBe("");
    const look = await api<ImportInspection>("POST", `/api/sites/${site.id}/import/inspect`, { source: { kind: "file", uploadId: first.body.uploadId } });

    expect(look.body).toMatchObject({ ok: true, kind: "file", counts: { posts: 10, pages: 4 }, builderPages: 2 });
  });
});

describe("hosted mode", () => {
  it("refuses to read this computer or a private network, before any connection", async () => {
    const opened = await call<SiteDetail>(hosted, "POST", "/api/sites/open", { path: hostedSite });

    expect(opened.status).toBe(200);
    const before = fake.requests.length;
    const { body } = await call<ImportInspection>(hosted, "POST", `/api/sites/${opened.body.id}/import/inspect`, { source: { kind: "address", address: fake.url } });

    expect(body.ok).toBe(false);
    expect(body.problem).toMatchObject({ reason: "refused", offer: ["address", "file"] });
    expect(body.problem!.message).toMatch(/private or local network address/);
    expect(fake.requests.length).toBe(before);
  });
});

describe("steps 2–4: plan, bring it over, report", () => {
  let site: { id: string; root: string };
  let uploadId = "";
  let done: ImportRunStatus;

  beforeAll(async () => {
    site = await open("full");
    const bytes = readFileSync(wxr);

    uploadId = (await api<{ uploadId: string }>("POST", `/api/sites/${site.id}/import/upload`, { name: "fernhill.xml", total: bytes.length, offset: 0, chunk: bytes.toString("base64") })).body.uploadId;
  });

  it("plans: counts, where each kind goes, page-builder pages, and questions answered with their defaults", async () => {
    const { body } = await api<ImportPlanView>("POST", `/api/sites/${site.id}/import/plan`, { source: { kind: "file", uploadId } });

    expect(body.counts).toMatchObject({ posts: 10, pages: 4, authors: 3, categories: 4, tags: 10 });
    expect(body.counts.images).toBeGreaterThan(10);
    expect(body.destinations.map((d) => [d.kind, d.collection])).toEqual([["posts", "blog"], ["pages", "pages"]]);
    expect(body.builders).toEqual([{ name: "Elementor", count: 2, titles: ["Planting plans", "Garden design"] }]);
    const author = body.questions.find((q) => q.id === "default:blog.author")!;

    expect(author.question).toMatch(/Ines Calder, Rowan Pike and Mae Tulloch as authors/);
    expect(author.answer).toBe(author.default);
    expect(body.redirects).toBe(10);
    expect(body.seo.descriptions).toBeGreaterThan(0);
    expect(git(site.root, "status", "--porcelain", "-uall")).toBe("");
  });

  it("runs as a job with plain steps and real counts, and lands only content, media and the hand-off", { timeout: 120_000 }, async () => {
    const started = await api<ImportRunStatus>("POST", `/api/sites/${site.id}/import/run`, { source: { kind: "file", uploadId }, answers: { "default:blog.author": "sam-okoro" } });

    expect(started.body.job).toMatchObject({ kind: "import", state: "running", siteId: site.id });
    done = await finished(site.id, started.body.id);
    expect(done.state).toBe("done");
    expect(done.steps.map((s) => [s.id, s.state])).toEqual([["read", "done"], ["media", "done"], ["posts", "done"], ["pages", "done"], ["finish", "done"]]);
    expect(done.steps.find((s) => s.id === "posts")).toMatchObject({ done: 10, total: 10 });
    const labels = events.filter((e): e is Extract<ServerEvent, { type: "job" }> => e.type === "job" && e.job.id === started.body.job.id).map((e) => e.job.label);

    expect(labels.some((label) => /^(Bringing over posts|Downloading images) — \d+ of \d+$/.test(label))).toBe(true);
    const changed = git(site.root, "status", "--porcelain", "-uall").split("\n").filter(Boolean).map((line) => line.slice(3));

    expect(changed.every((path) => /^(src\/content\/(blog|pages)\/|public\/images\/|wordpress-import\/)/.test(path))).toBe(true);
    expect(changed).toContain("wordpress-import/_redirects");
    expect(readFileSync(join(site.root, "src/content/blog", readdirSync(join(site.root, "src/content/blog")).find((name) => name.startsWith("what-to-plant"))!), "utf8")).toMatch(/^author: sam-okoro$/m);
  });

  it("reports what arrived, what needs a look (with links to entries), redirects, SEO and the builder pages", async () => {
    const { body } = await api<{ report: NonNullable<ImportRunStatus["report"]> }>("GET", `/api/sites/${site.id}/import/report`);
    const report = body.report;

    // The starter already has a Services page: it's kept, and the WordPress one is listed as not brought over.
    expect(report).toMatchObject({ stopped: false, arrived: { posts: 10, pages: 3 } });
    expect(report.notImported).toEqual([expect.objectContaining({ title: "Services", note: expect.stringMatching(/already lives at \/services\//) })]);
    expect(report.arrived.images).toBeGreaterThan(10);
    expect(report.redirects).toMatchObject({ count: 10, file: "wordpress-import/_redirects" });
    expect(report.rebuilds.map((r) => r.title).sort()).toEqual(["Garden design", "Planting plans"]);
    expect(report.rebuilds[0]!.originalUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/(garden-design|planting-plans)\/$/);
    // One of the ten posts never had an SEO description: its description was written from the opening paragraph.
    expect(report.seo.descriptions).toBe(12);
    expect(report.seo.descriptionsWritten).toBe(1);
    const credited = report.needsLook.find((group) => /credited to the person chosen/.test(group.title))!;

    expect(credited.items).toHaveLength(10);
    expect(credited.items[0]!.path).toMatch(/^src\/content\/blog\/.+\.md$/);
  });

  it("rebuilds one page with the assistant: build mode, the prepared brief, the page as context", async () => {
    const path = done.report!.rebuilds.find((r) => r.title === "Garden design")!.path;
    const before = script.requests.length;
    const { status, body } = await api<{ threadId: string; turnId: string }>("POST", `/api/sites/${site.id}/import/rebuild`, { path });

    expect(status).toBe(200);
    for (let i = 0; i < 100 && !events.some((e) => e.type === "chat.done" && e.turnId === body.turnId); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    const thread = (await api<ChatThread>("GET", `/api/sites/${site.id}/threads/${body.threadId}`)).body;

    expect(thread).toMatchObject({ mode: "build", title: "Rebuild “Garden design”" });
    expect(thread.messages[0]!.text).toMatch(/^Rebuild the page “Garden design” \(src\/content\/pages\/garden-design\.md\) from this site's own sections\./);
    const sent = JSON.stringify(script.requests[before]!.body.messages);

    expect(sent).toContain("Sections, top to bottom:");
    expect(sent).toContain("src/content/pages/garden-design.md");
    // Build mode: the source-file tools are offered.
    expect(JSON.stringify(script.requests[before]!.body)).toMatch(/write_file|tool_addition/);
  });

  it("shows the cost of rebuilding all before starting, then rebuilds them one at a time", async () => {
    const plan = (await api<ImportRebuildPlan>("GET", `/api/sites/${site.id}/import/rebuild-all`)).body;

    expect(plan).toMatchObject({ connected: true, model: "claude-opus-5-5" });
    expect(plan.pages).toHaveLength(2);
    expect(plan.estimate!.low).toBeGreaterThan(0);
    expect(plan.estimate!.high).toBeGreaterThan(plan.estimate!.low);
    const started = (await api<ImportRebuildStatus>("POST", `/api/sites/${site.id}/import/rebuild-all`, {})).body;
    let status = started;

    for (let i = 0; i < 200 && status.job.state === "running"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = (await api<ImportRebuildStatus>("GET", `/api/sites/${site.id}/import/rebuild-all/${started.job.id}`)).body;
    }
    expect(status.pages.map((p) => p.state)).toEqual(["done", "done"]);
    expect(new Set(status.pages.map((p) => p.threadId)).size).toBe(2);
    // Stopping a queue that has finished changes nothing and says how it ended.
    const stopped = await api<ImportRebuildStatus>("POST", `/api/sites/${site.id}/import/rebuild-all/${started.job.id}/cancel`);

    expect(stopped.status).toBe(200);
    expect(stopped.body.pages.map((p) => p.state)).toEqual(["done", "done"]);
  });

  it("says where what it brought stands: waiting, then published or discarded in Proof", { timeout: 60_000 }, async () => {
    const report = async () => (await api<{ report: NonNullable<ImportRunStatus["report"]> }>("GET", `/api/sites/${site.id}/import/report`)).body.report;
    const before = await report();
    const written = before.entries.filter((entry) => entry.action !== "unchanged").map((entry) => entry.path);

    expect(before.standing).toEqual({ pending: written.length, published: 0, discarded: 0 });
    const published = await api<{ ok: boolean }>("POST", `/api/sites/${site.id}/publish`, { message: "One post", paths: [written[0]] });

    expect(published.body.ok).toBe(true);
    await api("POST", `/api/sites/${site.id}/discard`, {});
    expect((await report()).standing).toEqual({ pending: 0, published: 1, discarded: written.length - 1 });
  });
});

describe("stopping part-way", () => {
  it("keeps what arrived and says so", { timeout: 120_000 }, async () => {
    const site = await open("stop");
    const started = await api<ImportRunStatus>("POST", `/api/sites/${site.id}/import/run`, { source: { kind: "address", address: slow.url } });

    for (let i = 0; i < 300; i += 1) {
      const now = (await api<ImportRunStatus>("GET", `/api/sites/${site.id}/import/runs/${started.body.id}`)).body;

      if ((now.steps.find((s) => s.id === "media")?.done ?? 0) >= 4) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await api("POST", `/api/sites/${site.id}/import/runs/${started.body.id}/cancel`);
    const stopped = await finished(site.id, started.body.id);

    expect(stopped.state).toBe("stopped");
    expect(stopped.report?.stopped).toBe(true);
    expect(stopped.message).toMatch(/^Stopped\. .* had arrived; they're kept as pending changes\. Start again to bring the rest/);
    expect(stopped.steps.find((s) => s.id === "media")!.state).toBe("stopped");
    expect(git(site.root, "status", "--porcelain", "-uall")).toMatch(/public\/images\//);
  });
});

describe("an application password", () => {
  it("is used for the job and is never written, logged or sent in an event", { timeout: 120_000 }, async () => {
    const site = await open("secret");
    const source = { kind: "address", address: locked.url, user: "ines", password: SECRET };
    const plan = await api<ImportPlanView>("POST", `/api/sites/${site.id}/import/plan`, { source });

    expect(plan.body.counts.posts).toBe(10);
    const started = await api<ImportRunStatus>("POST", `/api/sites/${site.id}/import/run`, { source });
    const done = await finished(site.id, started.body.id);

    expect(done.state).toBe("done");
    const leaks = [...everyFile(home), ...everyFile(site.root)].filter((file) => statSync(file).size < 50_000_000 && readFileSync(file).includes(SECRET));

    expect(leaks).toEqual([]);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(done)).not.toContain(SECRET);
    const wrong = await api<{ error: { message: string } }>("POST", `/api/sites/${site.id}/import/plan`, { source: { ...source, password: "a wrong secret phrase" } });

    expect(wrong.status).toBe(400);
    expect(wrong.text).not.toContain("a wrong secret phrase");
  });
});
