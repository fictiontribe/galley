/**
 * Setting the redirects on Cloudflare, against the strict fake: the plan
 * before anything changes, the asynchronous list operation polled to the
 * end, idempotence (a second apply sends nothing), lists and rules this app
 * didn't make left exactly as they were, permission errors that name the
 * permission to add, the key never in a message, and the record kept in the
 * site's state folder.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCloudflare, checkCloudflare, createRedirectsService, desiredItems, listNameFor, planCloudflare, probeCloudflare, removeCloudflare, type Redirect, type RedirectsService } from "../../src/redirects/index";
import { createEventBus } from "../../src/site/index";
import type { Job, ServerEvent, Settings } from "../../src/types";
import { disposeAll, makeSite, openSite, sh, tempDir, until, writeTree } from "../site/helpers";
import { createFakeCloudflare, type FakeCloudflare } from "./fake-cloudflare";

/** The error a promise rejects with (fails the test when it resolves). */
async function failureOf(promise: Promise<unknown>): Promise<{ code: string; message: string; detail?: string; status?: number }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string; detail?: string; status?: number };
  }
  throw new Error("expected it to fail");
}

const r = (from: string, to: string, status: Redirect["status"] = 301): Redirect => ({ from, to, status });
const LIST: Redirect[] = [r("/old-about/", "/about/"), r("/far/", "https://elsewhere.example/x?ref=1", 302), r("/blog/*", "/journal/:splat", 308), r("/?p=12", "/blog/")];

function api(fake: FakeCloudflare) {
  return { token: fake.token, fetch: fake.fetch, apiBase: fake.apiBase, pollMs: 1 };
}
const target = (fake: FakeCloudflare) => ({ account: fake.account, hostnames: ["www.lowfield.example"], siteId: "1a2b3c4d5e6f7a8b9c0d", siteName: "Lowfield Studio" });

describe("Bulk Redirects against the fake", () => {
  it("plans first, then creates one list and one rule, polling the list operation to the end", async () => {
    const fake = createFakeCloudflare({ pollsToComplete: 3 });
    const { plan } = await planCloudflare(api(fake), target(fake), LIST);

    expect(plan).toMatchObject({ list: "create", rule: "create", add: 3, change: 0, remove: 0, total: 3 });
    expect(plan.skipped).toEqual([{ from: "/?p=12", reason: "Bulk Redirects can't match an old address by its query string." }]);
    expect(plan.notes.join(" ")).toMatch(/own domain/);
    expect(fake.lists).toHaveLength(0);
    const record = await applyCloudflare(api(fake), target(fake), LIST, plan.id, () => undefined);
    const list = fake.lists[0]!;

    expect(list.name).toBe(listNameFor("1a2b3c4d5e6f7a8b9c0d"));
    expect(list.items.map((item) => item.redirect)).toEqual([
      { source_url: "www.lowfield.example/old-about/", target_url: "https://www.lowfield.example/about/", status_code: 301, preserve_query_string: true, include_subdomains: false, subpath_matching: false, preserve_path_suffix: false },
      { source_url: "www.lowfield.example/far/", target_url: "https://elsewhere.example/x?ref=1", status_code: 302, preserve_query_string: false, include_subdomains: false, subpath_matching: false, preserve_path_suffix: false },
      { source_url: "www.lowfield.example/blog/", target_url: "https://www.lowfield.example/journal/", status_code: 308, preserve_query_string: true, include_subdomains: false, subpath_matching: true, preserve_path_suffix: true },
    ]);
    expect(fake.ruleset!.rules).toEqual([expect.objectContaining({ ref: list.name, expression: `http.request.full_uri in $${list.name}`, action: "redirect", action_parameters: { from_list: { name: list.name, key: "http.request.full_uri" } } })]);
    expect(fake.log.filter((entry) => entry.path.includes("bulk_operations")).length).toBeGreaterThanOrEqual(3);
    expect(record).toMatchObject({ listId: list.id, ruleId: fake.ruleset!.rules[0]!.id, items: 3 });
  });

  it("is idempotent: the same list again sends no items and changes no rule", async () => {
    const fake = createFakeCloudflare();
    const first = await planCloudflare(api(fake), target(fake), LIST);

    await applyCloudflare(api(fake), target(fake), LIST, first.plan.id, () => undefined);
    const again = await planCloudflare(api(fake), target(fake), LIST);

    expect(again.plan).toMatchObject({ list: "none", rule: "none", add: 0, change: 0, remove: 0, unchanged: 3 });
    const writes = fake.log.length;

    await applyCloudflare(api(fake), target(fake), LIST, again.plan.id, () => undefined);
    expect(fake.log.slice(writes).filter((entry) => !["GET"].includes(entry.method))).toEqual([]);
    expect((await checkCloudflare(api(fake), target(fake), LIST)).matches).toBe(true);
  });

  it("says what changes: add, change, remove", async () => {
    const fake = createFakeCloudflare();
    const first = await planCloudflare(api(fake), target(fake), LIST);

    await applyCloudflare(api(fake), target(fake), LIST, first.plan.id, () => undefined);
    const next = [r("/old-about/", "/contact/"), r("/blog/*", "/journal/:splat", 308), r("/new/", "/about/")];
    const { plan } = await planCloudflare(api(fake), target(fake), next);

    expect(plan).toMatchObject({ add: 1, change: 1, remove: 1, unchanged: 1, list: "update", rule: "none" });
    const check = await checkCloudflare(api(fake), target(fake), next);

    expect(check.matches).toBe(false);
    expect(check.differences).toEqual(["1 redirect is missing on Cloudflare.", "1 redirect goes somewhere else on Cloudflare.", "1 redirect on Cloudflare isn't in the list any more."]);
  });

  it("never touches lists or rules it didn't create", async () => {
    const fake = createFakeCloudflare();

    fake.lists.push({ id: "foreign-list", name: "their_redirects", kind: "redirect", description: "Made by hand", items: [{ id: "i1", redirect: { source_url: "shop.lowfield.example/a", target_url: "https://shop.lowfield.example/b" }, created_on: "" }] });
    fake.ruleset = { id: "rs1", rules: [{ id: "their-rule", ref: "theirs", expression: "http.request.full_uri in $their_redirects", action: "redirect", action_parameters: { from_list: { name: "their_redirects", key: "http.request.full_uri" } } }] };
    const before = JSON.stringify([fake.lists[0], fake.ruleset.rules[0]]);
    const { plan } = await planCloudflare(api(fake), target(fake), LIST);

    await applyCloudflare(api(fake), target(fake), LIST, plan.id, () => undefined);
    expect(fake.ruleset.rules).toHaveLength(2);
    expect(JSON.stringify([fake.lists.find((list) => list.id === "foreign-list"), fake.ruleset.rules.find((rule) => rule.id === "their-rule")])).toBe(before);
    await removeCloudflare(api(fake), target(fake));
    expect(fake.lists.map((list) => list.id)).toEqual(["foreign-list"]);
    expect(fake.ruleset.rules.map((rule) => rule.id)).toEqual(["their-rule"]);
  });

  it("refuses a list with its name that it didn't make", async () => {
    const fake = createFakeCloudflare();

    fake.lists.push({ id: "squatter", name: listNameFor("1a2b3c4d5e6f7a8b9c0d"), kind: "redirect", description: "Someone else's", items: [] });
    await expect(planCloudflare(api(fake), target(fake), LIST)).rejects.toMatchObject({ code: "conflict" });
    expect(fake.log.every((entry) => entry.method === "GET")).toBe(true);
  });

  it("puts a rule back when someone switched it off on Cloudflare", async () => {
    const fake = createFakeCloudflare();
    const first = await planCloudflare(api(fake), target(fake), LIST);

    await applyCloudflare(api(fake), target(fake), LIST, first.plan.id, () => undefined);
    fake.ruleset!.rules[0]!.enabled = false;
    const { plan } = await planCloudflare(api(fake), target(fake), LIST);

    expect(plan.rule).toBe("update");
    await applyCloudflare(api(fake), target(fake), LIST, plan.id, () => undefined);
    expect(fake.ruleset!.rules[0]!.enabled).toBe(true);
  });

  it("refuses a stale plan", async () => {
    const fake = createFakeCloudflare();
    const { plan } = await planCloudflare(api(fake), target(fake), LIST);

    await expect(applyCloudflare(api(fake), target(fake), [...LIST, r("/x/", "/y/")], plan.id, () => undefined)).rejects.toMatchObject({ code: "conflict" });
    expect(fake.lists).toHaveLength(0);
  });

  it("reads long lists page by page (500 at a time)", async () => {
    const fake = createFakeCloudflare();
    const long = Array.from({ length: 1201 }, (_, index) => r(`/old-${index}/`, "/about/"));
    const { plan } = await planCloudflare(api(fake), target(fake), long);

    await applyCloudflare(api(fake), target(fake), long, plan.id, () => undefined);
    const again = await planCloudflare(api(fake), target(fake), long);

    expect(again.plan.unchanged).toBe(1201);
    expect(fake.log.filter((entry) => /\/items\?per_page=500/.test(entry.path)).length).toBeGreaterThanOrEqual(3);
  });

  it("a failed list operation stops before the rule", async () => {
    const fake = createFakeCloudflare({ failOperation: "Quota exceeded" });
    const { plan } = await planCloudflare(api(fake), target(fake), LIST);

    await expect(applyCloudflare(api(fake), target(fake), LIST, plan.id, () => undefined)).rejects.toThrow(/Quota exceeded/);
    expect(fake.ruleset).toBeNull();
  });

  it("names the permission a key lacks, and never shows the key", async () => {
    const lists = createFakeCloudflare({ noLists: true });
    const rules = createFakeCloudflare({ noRules: true });

    expect(await probeCloudflare(api(lists), lists.account)).toEqual({ missing: ["Account › Account Filter Lists › Edit"] });
    expect(await probeCloudflare(api(rules), rules.account)).toEqual({ missing: ["Account › Bulk URL Redirects › Edit"] });
    const error = await failureOf(planCloudflare(api(lists), target(lists), LIST));

    expect(error.code).toBe("forbidden");
    expect(error.message).toContain("Account › Account Filter Lists › Edit");
    expect(`${error.message} ${error.detail}`).not.toContain(lists.token);
  });

  it("a key Cloudflare doesn't know is 'unconfigured' (400), never 401", async () => {
    const fake = createFakeCloudflare();
    const error = await failureOf(planCloudflare({ ...api(fake), token: "wrong-token-0123456789abcdef" }, target(fake), LIST));

    expect(error.code).toBe("unconfigured");
    expect(error.status).toBe(400);
  });

  it("one item per domain, the first redirect for a source wins", () => {
    const { items } = desiredItems([r("/a/", "/b/"), r("/a/", "/c/")], ["lowfield.example", "www.lowfield.example"]);

    expect(items.map((item) => [item.source_url, item.target_url])).toEqual([
      ["lowfield.example/a/", "https://lowfield.example/b/"],
      ["www.lowfield.example/a/", "https://www.lowfield.example/b/"],
    ]);
  });
});

describe("through the service", () => {
  let service: RedirectsService | null = null;

  afterEach(async () => {
    service?.dispose();
    service = null;
    await disposeAll();
  });

  it("plan → apply as a job → record in the state folder → out of date after a change → check", async () => {
    const fake = createFakeCloudflare();
    const root = makeSite();

    writeTree(root, {
      "galley.config.json": JSON.stringify({ name: "Lowfield Studio", collections: [{ id: "pages", url: "/{slug}/" }, { id: "blog", url: "/blog/{slug}/" }], redirects: { host: "cloudflare", cloudflare: { account: fake.account, hostnames: ["www.lowfield.example"] } } }, null, 2),
    });
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Config");
    const bus = createEventBus();
    const events: ServerEvent[] = [];

    bus.subscribe((event) => events.push(event));
    const { site } = await openSite(root, { events: bus });
    const home = tempDir("redirects-home-");

    service = createRedirectsService({ home, events: bus, fetch: fake.fetch, cloudflareApi: fake.apiBase, pollMs: 1, settings: { readSecret: async (name) => (name === "cloudflare" ? fake.token : null), get: async () => ({ author: { name: "Test Editor", email: "e@example.com" } }) as Settings } });
    await service.save(site, { redirects: [r("/old-about/", "/about/"), r("/blog-old/*", "/blog/:splat")], baseHash: null });
    let overview = await service.overview(site);

    expect(overview.cloudflare).toMatchObject({ relevant: true, keyConfigured: true, account: fake.account, hostnames: ["www.lowfield.example"], last: null });
    const plan = await service.cloudflarePlan(site);

    expect(plan).toMatchObject({ add: 2, list: "create" });
    const job = await service.cloudflareApply(site, { planId: plan.id });

    expect(job.kind).toBe("redirects");
    await until(() => service!.job(job.id)?.state !== "running");
    expect(service.job(job.id)).toMatchObject({ state: "done", detail: "Cloudflare now has 2 redirects for www.lowfield.example." });
    expect(events.some((event) => event.type === "job" && (event.job as Job).id === job.id)).toBe(true);
    const state = JSON.parse(readFileSync(join(home, "state", site.id, "redirects.json"), "utf8"));

    expect(state.cloudflare).toMatchObject({ items: 2, who: "Test Editor", hostnames: ["www.lowfield.example"] });
    overview = await service.save(site, { redirects: [r("/old-about/", "/contact/")], baseHash: (await service.overview(site)).hash });
    expect(overview.cloudflare!.outOfDate).toBe(true);
    const check = await service.cloudflareCheck(site);

    expect(check.matches).toBe(false);
    expect(JSON.stringify(events)).not.toContain(fake.token);
    await service.cloudflareRemove(site);
    expect(fake.lists).toHaveLength(0);
    expect((await service.overview(site)).cloudflare!.last).toBeNull();
  });

  it("a key without the permissions: the job never starts and the error lists both", async () => {
    const fake = createFakeCloudflare({ noLists: true, noRules: true });
    const root = makeSite();

    writeTree(root, { "galley.config.json": JSON.stringify({ redirects: { host: "cloudflare", cloudflare: { account: fake.account, hostnames: ["lowfield.example"] } } }) });
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Config");
    const { site } = await openSite(root);

    service = createRedirectsService({ home: tempDir("redirects-home-"), events: createEventBus(), fetch: fake.fetch, cloudflareApi: fake.apiBase, settings: { readSecret: async () => fake.token, get: async () => ({}) as Settings } });
    const error = await failureOf(service.cloudflareApply(site, { planId: "x" }));

    expect(error.code).toBe("forbidden");
    expect(error.message).toContain("Account › Account Filter Lists › Edit and Account › Bulk URL Redirects › Edit");
  });

  it("refuses a workers.dev address as the domain", async () => {
    const root = makeSite();
    const { site } = await openSite(root);

    service = createRedirectsService({ home: tempDir("redirects-home-"), events: createEventBus(), settings: { readSecret: async () => "t", get: async () => ({}) as Settings } });
    await expect(service.configure(site, { cloudflare: { hostnames: ["lowfield.studio.workers.dev"] } })).rejects.toThrow(/address Cloudflare provides/);
  });
});
