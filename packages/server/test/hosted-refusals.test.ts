/**
 * A hosted install looks after one site: every multi-site route is refused
 * with one plain sentence before any handler runs, and "Host the editor
 * online" isn't there. Locally, every one of those routes still does its
 * work — the same table, run both ways.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SiteRegistry, SiteService } from "@galley/core/types";
import { EDITOR_HOST_PATHS, isEditorHostRoute, MULTI_SITE_ROUTES } from "../src/hosted-refusals";
import { fake, json, SITE_ID, testApp } from "./helpers";

const root = realpathSync(mkdtempSync(join(tmpdir(), "galley-refusals-")));
const siteDir = join(root, "a-site");

mkdirSync(siteDir, { recursive: true });
writeFileSync(join(siteDir, "package.json"), "{}\n");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ONE_SITE = "This editor looks after one site. Each site gets an editor of its own.";
const summary = { id: SITE_ID, root: siteDir, name: "A site", framework: { id: "generic", name: "Site" }, lastOpenedAt: 1, pendingChanges: 0 };
const group = { id: "g1", name: "Clients", color: "ink", collapsed: false };
const job = { id: "j1", kind: "clone", label: "x", state: "running", startedAt: 1 };

/** Each route with a request that would succeed, and the registry call that proves it ran. */
const CASES: Record<(typeof MULTI_SITE_ROUTES)[number], { path: string; body?: unknown; calls: keyof SiteRegistry | null }> = {
  "POST /api/sites/open": { path: "/api/sites/open", body: { path: siteDir }, calls: "open" },
  "POST /api/sites/clone": { path: "/api/sites/clone", body: { url: "https://code.example/sam/site.git" }, calls: "clone" },
  "POST /api/sites/create": { path: "/api/sites/create", body: { name: "New", starter: "tiny" }, calls: "create" },
  "POST /api/sites/scan": { path: "/api/sites/scan", body: { path: root }, calls: "scan" },
  "POST /api/sites/scan/cancel": { path: "/api/sites/scan/cancel", body: { id: "scan-1" }, calls: null },
  "POST /api/sites/add": { path: "/api/sites/add", body: { paths: [siteDir] }, calls: "addMany" },
  "DELETE /api/sites/:siteId": { path: `/api/sites/${SITE_ID}`, calls: "remove" },
  "POST /api/groups": { path: "/api/groups", body: { name: "Clients" }, calls: "createGroup" },
  "PATCH /api/groups/:groupId": { path: "/api/groups/g1", body: { name: "Renamed" }, calls: "updateGroup" },
  "DELETE /api/groups/:groupId": { path: "/api/groups/g1", calls: "removeGroup" },
  "PUT /api/groups/order": { path: "/api/groups/order", body: { ids: ["g1"] }, calls: "orderGroups" },
  "PATCH /api/sites/:siteId/listing": { path: `/api/sites/${SITE_ID}/listing`, body: { pinned: true }, calls: "update" },
  "GET /api/open": { path: `/api/open?root=${encodeURIComponent(siteDir)}`, calls: "list" },
  "GET /api/fs/list": { path: `/api/fs/list?path=${encodeURIComponent(root)}`, calls: null },
};

function app(mode: "local" | "hosted") {
  const called: string[] = [];
  const site = fake<SiteService>("site", { id: SITE_ID, root: siteDir, detail: async () => ({ id: SITE_ID }) as never });
  const record =
    <T,>(name: string, value: T) =>
    async () => {
      called.push(name);
      return value;
    };
  const registry: Partial<SiteRegistry> = {
    get: async (id: string) => (id === SITE_ID ? site : null),
    list: record("list", [summary]) as never,
    open: record("open", site) as never,
    clone: record("clone", job) as never,
    create: record("create", job) as never,
    scan: record("scan", { path: root, sites: [], visited: 1, truncated: false, cancelled: false, skippedLinks: 0 }) as never,
    addMany: record("addMany", { added: [], skipped: [] }) as never,
    remove: record("remove", undefined) as never,
    createGroup: record("createGroup", group) as never,
    updateGroup: record("updateGroup", group) as never,
    removeGroup: record("removeGroup", undefined) as never,
    orderGroups: record("orderGroups", [group]) as never,
    update: record("update", summary) as never,
  };
  const test = testApp({ site, registry, settings: { forgetSite: async () => {} } }, { mode, fsRoot: root, ...(mode === "hosted" ? { allowedHosts: null } : {}) });

  return { ...test, called };
}

describe("one site per hosted install", () => {
  it.each(MULTI_SITE_ROUTES.map((key) => [key]))("hosted refuses %s with one plain sentence, before any handler runs", async (key) => {
    const { call, called } = app("hosted");
    const { path, body } = CASES[key];
    const response = await call(key.split(" ")[0]!, path, body);

    expect(response.status).toBe(403);
    expect((await json(response)).error).toEqual({ code: "forbidden", message: ONE_SITE });
    expect(called).toEqual([]);
  });

  it.each(MULTI_SITE_ROUTES.map((key) => [key]))("local mode still performs %s", async (key) => {
    const { call, called } = app("local");
    const { path, body, calls } = CASES[key];
    const response = await call(key.split(" ")[0]!, path, body);

    expect(response.status).toBe(200);
    if (calls) expect(called).toContain(calls);
  });

  it("hosted answers 404 for “Host the editor online”; local reaches those routes", async () => {
    const hosted = app("hosted");
    const local = app("local");

    for (const [method, path] of [
      ["GET", "/api/editor-hosts"],
      ["POST", "/api/editor-hosts/cloudflare/connect"],
      ["GET", `/api/sites/${SITE_ID}/editor`],
      ["POST", `/api/sites/${SITE_ID}/editor/plan`],
      ["DELETE", `/api/sites/${SITE_ID}/editor`],
    ] as const) {
      const refused = await hosted.call(method, path, method === "GET" ? undefined : {});

      expect(refused.status).toBe(404);
      expect((await json(refused)).error.message).toMatch(/isn't available on a hosted editor/);
      // Locally the route itself answers (whatever it says), not the hosted refusal.
      const reached = await local.call(method, path, method === "GET" ? undefined : {});

      expect((await reached.text()).includes("hosted editor")).toBe(false);
    }
    expect(EDITOR_HOST_PATHS.length).toBe(2);
    expect(isEditorHostRoute(`/api/sites/${SITE_ID}/editorial`)).toBe(false);
  });

  it("the routes a hosted install keeps still work there", async () => {
    const { call } = app("hosted");

    expect((await call("GET", "/api/sites")).status).toBe(200);
    expect((await call("GET", `/api/sites/${SITE_ID}`)).status).toBe(200);
  });
});
