import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ApiRouteKey } from "@galley/core/api";
import type { ChangeSet, SiteService } from "@galley/core/types";
import { routes } from "../src/routes";
import { fake, fakePreview, json, SITE_ID, testApp, type ServiceFakes } from "./helpers";

/** Route keys read from the contract's source, so the list comes from api.ts and not from memory. */
function contractKeys(): string[] {
  const source = readFileSync(fileURLToPath(new URL("../../core/src/api.ts", import.meta.url)), "utf8");
  const block = source.slice(source.indexOf("export interface ApiRoutes"), source.indexOf("export type ApiRouteKey"));

  return [...block.matchAll(/"((?:GET|POST|PUT|PATCH|DELETE) \/api[^"]*)"/g)].map((match) => match[1]!);
}

const changeSet: ChangeSet = {
  branch: "main",
  baseCommit: "abc1234",
  files: [
    { path: "src/content/blog/a.md", status: "modified", kind: "content", binary: false, additions: 2, deletions: 1, summary: "Changed the title" },
    { path: "public/images/b.png", status: "added", kind: "media", binary: true, additions: 0, deletions: 0, summary: "Added an image" },
  ],
  totals: { files: 2, additions: 2, deletions: 1 },
};

type Calls = Array<[string, unknown[]]>;

/** A site whose every method records its call and returns a canned value. */
function recordingSite(calls: Calls): SiteService {
  const preview = fakePreview({
    status: () => ({ state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] }),
    start: async () => ({ state: "ready", url: "http://127.0.0.1:5000", baselineUrl: null, baselineSource: null, log: [] }),
    stop: async () => {},
    restart: async () => ({ state: "ready", url: "http://127.0.0.1:5001", baselineUrl: null, baselineSource: null, log: [] }),
  });
  const canned: Record<string, unknown> = {
    detail: { id: SITE_ID, name: "Site" },
    refresh: { name: "Site", collections: [] },
    readConfig: { name: "Site" },
    detected: { name: "site", collections: [] },
    send: { ok: true, commit: "def5678", files: [], pushed: true },
    saveConfig: { name: "Renamed", collections: [] },
    listEntries: { collection: "blog", total: 0, items: [] },
    readEntry: { path: "src/content/blog/a.md" },
    updateEntry: { entry: { path: "src/content/blog/a.md" }, applied: 1, refused: [] },
    createEntry: { path: "src/content/blog/new.md" },
    deleteEntry: undefined,
    search: [],
    resolveText: { status: "none", matches: [] },
    entryForUrl: null,
    validate: [],
    listFiles: ["a.md"],
    readFile: { path: "a.md", content: "x", hash: "h", binary: false },
    writeFile: undefined,
    deleteFile: undefined,
    listMedia: [],
    saveMedia: { path: "public/images/up.png" },
    changes: changeSet,
    diff: { path: "src/content/blog/a.md", status: "modified", binary: false, before: "a", after: "b", hunks: [] },
    discard: { ...changeSet, files: [], totals: { files: 0, additions: 0, deletions: 0 } },
    publish: { ok: true, commit: "def5678", files: ["src/content/blog/a.md"], pushed: false },
    history: [],
    revert: { ok: true, commit: "0123abc", files: [], pushed: false },
    gitStatus: { branch: "main", detached: false, hasRemote: false, ahead: 0, behind: 0, clean: true },
    pull: { branch: "main", detached: false, hasRemote: true, ahead: 0, behind: 0, clean: true },
    build: { ok: true, output: "", durationMs: 1 },
  };
  const impl: Record<string, unknown> = { id: SITE_ID, root: "/tmp/site-1", preview: () => preview };

  for (const [name, value] of Object.entries(canned)) {
    impl[name] = async (...args: unknown[]) => {
      calls.push([name, args]);
      return value;
    };
  }
  return fake<SiteService>("site", impl as Partial<SiteService>);
}

function services(calls: Calls): ServiceFakes {
  const record =
    (name: string, value: unknown) =>
    async (...args: unknown[]) => {
      calls.push([name, args]);
      return value;
    };
  const job = { id: "job-1", kind: "clone", label: "Cloning", state: "running", startedAt: 1 };

  return {
    site: recordingSite(calls),
    registry: {
      list: record("registry.list", []) as never,
      open: record("registry.open", recordingSite(calls)) as never,
      clone: record("registry.clone", job) as never,
      create: record("registry.create", { ...job, id: "job-2", kind: "create" }) as never,
      starters: record("registry.starters", [{ id: "astro-starter", name: "Astro", description: "", framework: "astro" }]) as never,
      job: (id: string) => (id === "job-1" ? (job as never) : null),
      remove: record("registry.remove", undefined) as never,
    },
    settings: {
      get: record("settings.get", { ai: {}, images: {}, author: {}, appearance: {}, secrets: [] }) as never,
      update: record("settings.update", { ai: {}, images: {}, author: {}, appearance: {}, secrets: [] }) as never,
      setSecret: record("settings.setSecret", { name: "anthropic", configured: true, source: "stored", hint: "abcd" }) as never,
      usage: record("settings.usage", { today: {} }) as never,
    },
    images: {
      providers: record("images.providers", []) as never,
      generate: record("images.generate", []) as never,
      save: record("images.save", { path: "public/images/gen.png" }) as never,
      discard: record("images.discard", undefined) as never,
    },
    agent: {
      listThreads: record("agent.listThreads", []) as never,
      createThread: record("agent.createThread", { id: "t1", messages: [] }) as never,
      getThread: record("agent.getThread", { id: "t1", messages: [] }) as never,
      renameThread: record("agent.renameThread", { id: "t1", title: "Spring menu" }) as never,
      deleteThread: record("agent.deleteThread", undefined) as never,
      send: record("agent.send", { turnId: "turn-1" }) as never,
      cancel: record("agent.cancel", undefined) as never,
      undoTurn: record("agent.undoTurn", ["a.md"]) as never,
      describeChanges: record("agent.describeChanges", "Update the blog") as never,
    },
  };
}

const S = `/api/sites/${SITE_ID}`;
const PNG = `data:image/png;base64,${Buffer.from("not really a png").toString("base64")}`;

interface Row {
  key: ApiRouteKey;
  url: string;
  body?: unknown;
  /** The engine call the route must make. */
  call?: [string, unknown[]];
}

const happy: Row[] = [
  { key: "GET /api/meta", url: "/api/meta" },
  { key: "GET /api/settings", url: "/api/settings", call: ["settings.get", []] },
  { key: "PATCH /api/settings", url: "/api/settings", body: { ai: { effort: "high" } }, call: ["settings.update", [{ ai: { effort: "high" } }]] },
  { key: "PUT /api/secrets/:name", url: "/api/secrets/anthropic", body: { value: "sk-test-value" }, call: ["settings.setSecret", ["anthropic", "sk-test-value"]] },
  { key: "GET /api/usage", url: "/api/usage", call: ["settings.usage", []] },
  { key: "GET /api/sites", url: "/api/sites", call: ["registry.list", []] },
  { key: "POST /api/sites/clone", url: "/api/sites/clone", body: { url: "https://example.com/site.git" }, call: ["registry.clone", [{ url: "https://example.com/site.git" }]] },
  { key: "POST /api/sites/create", url: "/api/sites/create", body: { name: "New", starter: "astro-starter" }, call: ["registry.create", [{ name: "New", starter: "astro-starter" }]] },
  { key: "GET /api/starters", url: "/api/starters", call: ["registry.starters", []] },
  { key: "GET /api/jobs/:jobId", url: "/api/jobs/job-1" },
  { key: "GET /api/sites/:siteId", url: S, call: ["detail", []] },
  { key: "DELETE /api/sites/:siteId", url: S, call: ["registry.remove", [SITE_ID]] },
  { key: "POST /api/sites/:siteId/refresh", url: `${S}/refresh`, call: ["refresh", []] },
  { key: "GET /api/sites/:siteId/config", url: `${S}/config`, call: ["detected", []] },
  { key: "PUT /api/sites/:siteId/config", url: `${S}/config`, body: { config: { name: "Renamed" } }, call: ["saveConfig", [{ name: "Renamed" }]] },
  {
    key: "GET /api/sites/:siteId/entries",
    url: `${S}/entries?collection=blog&sort=date&order=desc&limit=10&offset=5`,
    call: ["listEntries", ["blog", { sort: "date", order: "desc", limit: 10, offset: 5 }]],
  },
  { key: "GET /api/sites/:siteId/entry", url: `${S}/entry?path=src/content/blog/a.md`, call: ["readEntry", ["src/content/blog/a.md"]] },
  {
    key: "PATCH /api/sites/:siteId/entry",
    url: `${S}/entry?path=src/content/blog/a.md`,
    body: { ops: [{ op: "set", path: ["title"], value: "New title" }], baseHash: "h1" },
    call: ["updateEntry", ["src/content/blog/a.md", [{ op: "set", path: ["title"], value: "New title" }], { baseHash: "h1", origin: "user" }]],
  },
  {
    key: "POST /api/sites/:siteId/entries",
    url: `${S}/entries`,
    body: { collection: "blog", slug: "new", data: { title: "New" } },
    call: ["createEntry", [{ collection: "blog", slug: "new", data: { title: "New" } }, { origin: "user" }]],
  },
  {
    // A page template chosen in "New page" reaches the engine (it used to be dropped by the request check).
    key: "POST /api/sites/:siteId/entries",
    url: `${S}/entries`,
    body: { collection: "pages", slug: "spring", data: { title: "Spring" }, template: "campaign" },
    call: ["createEntry", [{ collection: "pages", slug: "spring", data: { title: "Spring" }, template: "campaign" }, { origin: "user" }]],
  },
  { key: "DELETE /api/sites/:siteId/entry", url: `${S}/entry?path=src/content/blog/a.md`, call: ["deleteEntry", ["src/content/blog/a.md", { origin: "user" }]] },
  { key: "GET /api/sites/:siteId/search", url: `${S}/search?q=tide&limit=5`, call: ["search", ["tide", { collection: undefined, limit: 5 }]] },
  { key: "POST /api/sites/:siteId/resolve", url: `${S}/resolve`, body: { urlPath: "/", text: "Hello", occurrence: 0, total: 1 }, call: ["resolveText", [{ urlPath: "/", text: "Hello", occurrence: 0, total: 1 }]] },
  { key: "GET /api/sites/:siteId/route", url: `${S}/route?url=/about/`, call: ["entryForUrl", ["/about/"]] },
  { key: "POST /api/sites/:siteId/validate", url: `${S}/validate`, body: { paths: ["a.md"] }, call: ["validate", [["a.md"]]] },
  { key: "GET /api/sites/:siteId/files", url: `${S}/files?glob=src/**&limit=20`, call: ["listFiles", [{ glob: "src/**", limit: 20 }]] },
  { key: "GET /api/sites/:siteId/file", url: `${S}/file?path=src/a.astro`, call: ["readFile", ["src/a.astro"]] },
  {
    key: "PUT /api/sites/:siteId/file",
    url: `${S}/file?path=src/a.astro`,
    body: { content: "<h1>x</h1>", mode: "build" },
    call: ["writeFile", ["src/a.astro", "<h1>x</h1>", { origin: "user", mode: "build", baseHash: undefined }]],
  },
  { key: "GET /api/sites/:siteId/media", url: `${S}/media`, call: ["listMedia", []] },
  { key: "POST /api/sites/:siteId/media", url: `${S}/media`, body: { filename: "up.png", data: PNG } },
  { key: "DELETE /api/sites/:siteId/media", url: `${S}/media?path=public/images/old.png`, call: ["deleteFile", ["public/images/old.png", { origin: "user", mode: "content" }]] },
  { key: "GET /api/images/providers", url: "/api/images/providers", call: ["images.providers", []] },
  {
    key: "POST /api/sites/:siteId/images/generate",
    url: `${S}/images/generate`,
    body: { prompt: "A lighthouse", count: 2, referencePaths: ["public/images/a.png"] },
    // The site goes with it, so reference pictures can be read from it.
    call: ["images.generate", [{ prompt: "A lighthouse", count: 2, referencePaths: ["public/images/a.png"] }, { site: expect.objectContaining({ id: SITE_ID }), siteId: SITE_ID }]],
  },
  { key: "POST /api/sites/:siteId/images/save", url: `${S}/images/save`, body: { candidateId: "c1" } },
  { key: "DELETE /api/images/candidates/:candidateId", url: "/api/images/candidates/c1", call: ["images.discard", ["c1"]] },
  { key: "GET /api/sites/:siteId/changes", url: `${S}/changes`, call: ["changes", []] },
  { key: "GET /api/sites/:siteId/diff", url: `${S}/diff?path=src/content/blog/a.md`, call: ["diff", ["src/content/blog/a.md"]] },
  { key: "POST /api/sites/:siteId/discard", url: `${S}/discard`, body: { paths: ["a.md"] }, call: ["discard", [["a.md"]]] },
  { key: "POST /api/sites/:siteId/publish", url: `${S}/publish`, body: { message: "Update", paths: ["a.md"] }, call: ["publish", [{ message: "Update", paths: ["a.md"] }]] },
  { key: "POST /api/sites/:siteId/publish/check", url: `${S}/publish/check`, body: { paths: ["a.md"] } },
  { key: "GET /api/sites/:siteId/history", url: `${S}/history?limit=3`, call: ["history", [3]] },
  { key: "POST /api/sites/:siteId/revert", url: `${S}/revert`, body: { commit: "def5678" }, call: ["revert", ["def5678"]] },
  { key: "GET /api/sites/:siteId/git", url: `${S}/git`, call: ["gitStatus", []] },
  { key: "POST /api/sites/:siteId/pull", url: `${S}/pull`, call: ["pull", []] },
  { key: "POST /api/sites/:siteId/send", url: `${S}/send`, call: ["send", []] },
  { key: "GET /api/sites/:siteId/preview", url: `${S}/preview` },
  { key: "POST /api/sites/:siteId/preview/start", url: `${S}/preview/start` },
  { key: "POST /api/sites/:siteId/preview/stop", url: `${S}/preview/stop` },
  { key: "POST /api/sites/:siteId/preview/restart", url: `${S}/preview/restart` },
  // Local mode: the proxies' own addresses. The hosted answer (one-use entry addresses) is in hosted-gateway.test.ts.
  { key: "POST /api/sites/:siteId/preview/entry", url: `${S}/preview/entry` },
  { key: "POST /api/sites/:siteId/build", url: `${S}/build`, call: ["build", []] },
  { key: "GET /api/sites/:siteId/threads", url: `${S}/threads`, call: ["agent.listThreads", [SITE_ID]] },
  { key: "POST /api/sites/:siteId/threads", url: `${S}/threads`, body: { title: "Hero copy", mode: "content" }, call: ["agent.createThread", [SITE_ID, { title: "Hero copy", mode: "content" }]] },
  { key: "GET /api/sites/:siteId/threads/:threadId", url: `${S}/threads/t1`, call: ["agent.getThread", [SITE_ID, "t1"]] },
  { key: "PATCH /api/sites/:siteId/threads/:threadId", url: `${S}/threads/t1`, body: { title: "  Spring   menu " }, call: ["agent.renameThread", [SITE_ID, "t1", "Spring menu"]] },
  { key: "DELETE /api/sites/:siteId/threads/:threadId", url: `${S}/threads/t1`, call: ["agent.deleteThread", [SITE_ID, "t1"]] },
  {
    key: "POST /api/sites/:siteId/threads/:threadId/messages",
    url: `${S}/threads/t1/messages`,
    body: { text: "Make the heading shorter", context: { urlPath: "/" }, brief: { description: "A sailing club" } },
    call: ["agent.send", [SITE_ID, "t1", { text: "Make the heading shorter", context: { urlPath: "/" }, brief: { description: "A sailing club" } }]],
  },
  { key: "POST /api/sites/:siteId/threads/:threadId/cancel", url: `${S}/threads/t1/cancel`, call: ["agent.cancel", [SITE_ID, "t1"]] },
  { key: "POST /api/sites/:siteId/threads/:threadId/undo", url: `${S}/threads/t1/undo`, body: { turnId: "turn-1" }, call: ["agent.undoTurn", [SITE_ID, "t1", "turn-1"]] },
];

/** Covered in their own files: they need real files, streams, or sessions. */
const coveredElsewhere: ApiRouteKey[] = [
  "GET /api/sites/:siteId/visibility", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "GET /api/sites/:siteId/visibility/entry", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "POST /api/sites/:siteId/visibility/fix", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "POST /api/sites/:siteId/visibility/undo", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "GET /api/sites/:siteId/visibility/crawlers", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "PUT /api/sites/:siteId/visibility/crawlers", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "GET /api/sites/:siteId/visibility/agent-view", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "POST /api/sites/:siteId/visibility/write/plan", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "POST /api/sites/:siteId/visibility/write", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "GET /api/sites/:siteId/visibility/write/:jobId", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "POST /api/sites/:siteId/visibility/write/:jobId/cancel", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "POST /api/sites/:siteId/visibility/external-links", // visibility.test.ts (real engine; batches without a key, and core test/seo/write.test.ts)
  "POST /api/auth/login", // auth.test.ts
  "POST /api/auth/logout", // auth.test.ts
  "GET /api/events", // events.test.ts
  "GET /api/fs/list", // fs-list.test.ts
  "POST /api/sites/open", // fs-list.test.ts (needs a real folder)
  "GET /api/sites/:siteId/raw", // files.test.ts
  "GET /api/images/candidates/:candidateId", // files.test.ts
  "GET /api/starters/:starterId/preview", // files.test.ts
  "GET /api/open", // fs-list.test.ts (needs real folders)
  "POST /api/sites/:siteId/publish/message", // below
  "GET /api/sites/:siteId/data-sources/:sourceId", // data-sources.test.ts (a real plugin registry)
  // redirects.test.ts (fakes for each route, and one pass with the real service on a copy of the starter)
  "GET /api/sites/:siteId/redirects",
  "PUT /api/sites/:siteId/redirects",
  "POST /api/sites/:siteId/redirects/review",
  "POST /api/sites/:siteId/redirects/import",
  "POST /api/sites/:siteId/redirects/try",
  "PUT /api/sites/:siteId/redirects/settings",
  "POST /api/sites/:siteId/redirects/derived/replace",
  "POST /api/sites/:siteId/redirects/leftover/remove",
  "GET /api/sites/:siteId/redirects/export",
  "GET /api/sites/:siteId/redirects/health",
  "POST /api/sites/:siteId/redirects/cloudflare/plan",
  "POST /api/sites/:siteId/redirects/cloudflare/apply",
  "POST /api/sites/:siteId/redirects/cloudflare/check",
  "POST /api/sites/:siteId/redirects/cloudflare/remove",
  // forms.test.ts (needs a real capture service and store)
  "POST /api/sites/:siteId/forms/introspect",
  "GET /api/sites/:siteId/inbox",
  "GET /api/sites/:siteId/inbox/:formId",
  "GET /api/sites/:siteId/inbox/:formId/export",
  "GET /api/sites/:siteId/inbox/:formId/:submissionId",
  "PATCH /api/sites/:siteId/inbox/:formId",
  "POST /api/sites/:siteId/inbox/:formId/delete",
  "POST /api/sites/:siteId/inbox/:formId/restore",
  "POST /api/sites/:siteId/inbox/:formId/:submissionId/retry",
  "GET /api/sites/:siteId/capture",
  "PATCH /api/sites/:siteId/capture",
  "POST /api/sites/:siteId/capture/key",
  // multisite.test.ts (needs the real registry and settings: groups, bulk add, a site's own keys)
  "GET /api/groups",
  "POST /api/groups",
  "PATCH /api/groups/:groupId",
  "DELETE /api/groups/:groupId",
  "PUT /api/groups/order",
  "PATCH /api/sites/:siteId/listing",
  "POST /api/sites/scan",
  "POST /api/sites/scan/cancel",
  "POST /api/sites/add",
  "GET /api/sites/:siteId/thumbnail",
  "POST /api/sites/:siteId/presence",
  "GET /api/sites/:siteId/connections",
  "PUT /api/sites/:siteId/secrets/:name",
  "PUT /api/sites/:siteId/author",
  "GET /api/sites/:siteId/usage",
  "GET /api/usage/sites",
  // media-storage.test.ts (needs a media storage service and a bucket)
  "GET /api/media-storage/connectors",
  "GET /api/sites/:siteId/media/storage",
  "POST /api/sites/:siteId/media/storage/check",
  "PUT /api/sites/:siteId/media/storage",
  "DELETE /api/sites/:siteId/media/storage",
  "GET /api/sites/:siteId/media/usage",
  "POST /api/sites/:siteId/media/storage/delete",
  "POST /api/sites/:siteId/media/storage/move/plan",
  "POST /api/sites/:siteId/media/storage/move",
  // deploy.test.ts (needs a deploy service)
  "GET /api/deploy/targets",
  "POST /api/deploy/targets/:targetId/connect",
  "POST /api/sites/:siteId/deploy/check",
  "GET /api/sites/:siteId/deploy",
  "PUT /api/sites/:siteId/deploy",
  "POST /api/sites/:siteId/deploy/live-address",
  "POST /api/sites/:siteId/deploy",
  "GET /api/sites/:siteId/deployments",
  "POST /api/sites/:siteId/deploy/domain/plan",
  "POST /api/sites/:siteId/deploy/domain",
  "POST /api/sites/:siteId/deploy/domain/check",
  "DELETE /api/sites/:siteId/deploy/domain",
  // plugins.test.ts (needs a real plugin registry, or a video service)
  "GET /api/plugins",
  "GET /api/sites/:siteId/plugins",
  "POST /api/plugins/enabled",
  "PUT /api/plugins/settings",
  "GET /api/catalog",
  "GET /api/sites/:siteId/catalog",
  "GET /api/videos/providers",
  "POST /api/sites/:siteId/videos/generate",
  "GET /api/videos/jobs/:jobId",
  "GET /api/videos/candidates/:candidateId",
  "POST /api/sites/:siteId/videos/save",
  "DELETE /api/videos/candidates/:candidateId",
  // site-kit.test.ts (needs the real engine on a real site)
  "GET /api/sites/:siteId/forms",
  "GET /api/sites/:siteId/kit",
  "POST /api/sites/:siteId/kit/setup",
  "POST /api/sites/:siteId/kit/endpoint",
  "POST /api/sites/:siteId/kit/visibility",
  // sitebrand.test.ts (needs the real brand service on a real site)
  "GET /api/sites/:siteId/brand",
  "POST /api/sites/:siteId/brand/analyse",
  "POST /api/sites/:siteId/brand/cancel",
  "POST /api/sites/:siteId/brand/sources",
  "POST /api/sites/:siteId/brand/website",
  "PATCH /api/sites/:siteId/brand/sources/:sourceId",
  "DELETE /api/sites/:siteId/brand/sources/:sourceId",
  "GET /api/sites/:siteId/brand/sources/:sourceId/file",
  "PUT /api/sites/:siteId/brand/proposal",
  "DELETE /api/sites/:siteId/brand/proposal",
  "POST /api/sites/:siteId/brand/ask",
  "POST /api/sites/:siteId/brand/save",
  "GET /api/sites/:siteId/brand/apply",
  "POST /api/sites/:siteId/brand/apply",
  "POST /api/sites/:siteId/brand/check",
  "POST /api/sites/:siteId/brand/drift",
  "GET /api/sites/:siteId/brand/export",
  "POST /api/sites/:siteId/brand/import",
  "GET /api/sites/:siteId/brand/fonts/:fontId",
  // Bringing a WordPress site over: test/import.test.ts, against the real engine and an invented WordPress.
  "POST /api/sites/:siteId/import/upload",
  "POST /api/sites/:siteId/import/inspect",
  "POST /api/sites/:siteId/import/plan",
  "POST /api/sites/:siteId/import/run",
  "GET /api/sites/:siteId/import/runs/:runId",
  "POST /api/sites/:siteId/import/runs/:runId/cancel",
  "GET /api/sites/:siteId/import/report",
  "POST /api/sites/:siteId/import/rebuild",
  "GET /api/sites/:siteId/import/rebuild-all",
  "POST /api/sites/:siteId/import/rebuild-all",
  "GET /api/sites/:siteId/import/rebuild-all/:jobId",
  "POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel",
  // The hosted install's first run and sessions: test/install.test.ts, over real HTTP against the real engine.
  "GET /api/setup",
  "POST /api/setup/password",
  "POST /api/setup/deploy-key",
  "POST /api/setup/site/check",
  "POST /api/setup/site",
  "PUT /api/setup/details",
  "POST /api/setup/handover",
  "POST /api/setup/finish",
  "POST /api/install/password",
  "POST /api/auth/logout-all",
  // The Install page, backups and restores: test/install-ops.test.ts, over real HTTP against real folders and a real repository.
  "GET /api/install",
  "POST /api/install/backup",
  "POST /api/install/restore/upload",
  "POST /api/install/restore",
  // "Host the editor online": test/hosting.test.ts (the routes over a faked engine) and core test/hosting/ (the engine against fake hosts).
  "GET /api/editor-hosts",
  "POST /api/editor-hosts/:hostId/connect",
  "GET /api/sites/:siteId/editor",
  "POST /api/sites/:siteId/editor/plan",
  "POST /api/sites/:siteId/editor",
  "POST /api/sites/:siteId/editor/setup-link",
  "POST /api/sites/:siteId/editor/check",
  "POST /api/sites/:siteId/editor/upgrade",
  "POST /api/sites/:siteId/editor/backup",
  "GET /api/sites/:siteId/editor/removal",
  "DELETE /api/sites/:siteId/editor",
  // People on a hosted install: test/accounts.test.ts and test/accounts-access.test.ts, over real HTTP against a real install (local mode answers 404 there too).
  "GET /api/account",
  "PATCH /api/account",
  "POST /api/account/password",
  "GET /api/people",
  "POST /api/people/invitations",
  "DELETE /api/people/invitations/:invitationId",
  "PATCH /api/people/:accountId",
  "DELETE /api/people/:accountId",
  "POST /api/people/:accountId/password-link",
  "POST /api/people/:accountId/sign-out",
  "POST /api/people/sign-out",
  "POST /api/auth/link/check",
  "POST /api/auth/link",
  "POST /api/auth/forgot",
];

describe("route coverage", () => {
  it("implements exactly the routes in ApiRoutes", () => {
    const keys = contractKeys();

    expect(keys.length).toBeGreaterThan(50);
    expect(Object.keys(routes).sort()).toEqual([...keys].sort());
  });

  it("registers every route on the app with its method and path", () => {
    const { app } = testApp();
    const registered = new Set(app.routes.map((route) => `${route.method} ${route.path}`));

    for (const key of contractKeys()) expect(registered, key).toContain(key);
  });

  it("has a happy-path test for every route", () => {
    const tested = new Set([...happy.map((row) => row.key), ...coveredElsewhere]);

    for (const key of contractKeys()) expect(tested, key).toContain(key);
  });
});

describe("happy paths", () => {
  it.each(happy)("$key", async (row) => {
    const calls: Calls = [];
    const { call, logs } = testApp(services(calls));
    const method = row.key.split(" ")[0]!;
    const response = await call(method, row.url, row.body);

    expect(response.status, `${logs.join("\n")}`).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    await response.json();
    if (row.call) expect(calls).toContainEqual(row.call);
  });

  it("stops the preview and reports its status", async () => {
    const { call } = testApp(services([]));
    const body = await json(await call("POST", `${S}/preview/stop`));

    expect(body.state).toBe("idle");
  });

  it("POST publish/message describes only the requested paths", async () => {
    const calls: Calls = [];
    const { call } = testApp(services(calls));
    const response = await call("POST", `${S}/publish/message`, { paths: ["public/images/b.png"] });

    expect(await json(response)).toEqual({ message: "Update the blog" });
    const described = calls.find(([name]) => name === "agent.describeChanges")![1];

    expect(described[0]).toBe(SITE_ID);
    expect((described[1] as ChangeSet).files.map((file) => file.path)).toEqual(["public/images/b.png"]);
    expect((described[1] as ChangeSet).totals).toEqual({ files: 1, additions: 0, deletions: 0 });
  });

  it("POST publish/message with no paths describes everything", async () => {
    const calls: Calls = [];
    const { call } = testApp(services(calls));

    await call("POST", `${S}/publish/message`);
    const described = calls.find(([name]) => name === "agent.describeChanges")![1];

    expect((described[1] as ChangeSet).files).toHaveLength(2);
  });

  it("diff of an image carries before/after media URLs", async () => {
    const site = fake<SiteService>("site", {
      id: SITE_ID,
      diff: async (path) => ({ path, status: "modified", binary: true, before: null, after: null, hunks: [] }),
    });
    const { call } = testApp({ site });
    const body = await json(await call("GET", `${S}/diff?path=${encodeURIComponent("public/images/hero image.png")}`));

    expect(body.beforeMediaUrl).toBe(`/api/sites/${SITE_ID}/raw?path=public%2Fimages%2Fhero%20image.png&rev=base`);
    expect(body.afterMediaUrl).toBe(`/api/sites/${SITE_ID}/raw?path=public%2Fimages%2Fhero%20image.png`);
  });

  it("diff of an added image has no before URL", async () => {
    const site = fake<SiteService>("site", {
      id: SITE_ID,
      diff: async (path) => ({ path, status: "added", binary: true, before: null, after: null, hunks: [] }),
    });
    const body = await json(await testApp({ site }).call("GET", `${S}/diff?path=a.webp`));

    expect(body.beforeMediaUrl).toBeUndefined();
    expect(body.afterMediaUrl).toContain("raw?path=a.webp");
  });

  it("an unknown job is not found", async () => {
    const response = await testApp(services([])).call("GET", "/api/jobs/nope");

    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe("not-found");
  });

  it("an unknown thread is not found", async () => {
    const response = await testApp({ ...services([]), agent: { getThread: async () => null } }).call("GET", `${S}/threads/zzz`);

    expect(response.status).toBe(404);
  });
});

const bad: Array<{ name: string; method: string; url: string; body?: unknown }> = [
  { name: "settings: unknown effort", method: "PATCH", url: "/api/settings", body: { ai: { effort: "maximum" } } },
  { name: "secret: unknown name", method: "PUT", url: "/api/secrets/github", body: { value: "x" } },
  { name: "secret: value missing", method: "PUT", url: "/api/secrets/anthropic", body: {} },
  { name: "open: no path", method: "POST", url: "/api/sites/open", body: {} },
  { name: "clone: not a git address", method: "POST", url: "/api/sites/clone", body: { url: "file:///etc" } },
  { name: "create: no starter", method: "POST", url: "/api/sites/create", body: { name: "X" } },
  { name: "create: bad brand color", method: "POST", url: "/api/sites/create", body: { name: "X", starter: "a", brief: { description: "d", brandColor: "red" } } },
  { name: "config: missing", method: "PUT", url: `${S}/config`, body: {} },
  { name: "config: wrong shape", method: "PUT", url: `${S}/config`, body: { config: { collections: "all" } } },
  { name: "entries: no collection", method: "GET", url: `${S}/entries` },
  { name: "entries: bad sort", method: "GET", url: `${S}/entries?collection=blog&sort=size` },
  { name: "entries: limit not a number", method: "GET", url: `${S}/entries?collection=blog&limit=lots` },
  { name: "entry: no path", method: "GET", url: `${S}/entry` },
  { name: "patch: no ops", method: "PATCH", url: `${S}/entry?path=a.md`, body: { ops: [] } },
  { name: "patch: unknown op", method: "PATCH", url: `${S}/entry?path=a.md`, body: { ops: [{ op: "rename" }] } },
  { name: "patch: no path in query", method: "PATCH", url: `${S}/entry`, body: { ops: [{ op: "body", value: "x" }] } },
  { name: "create entry: no data", method: "POST", url: `${S}/entries`, body: { collection: "blog", slug: "x" } },
  { name: "delete entry: no path", method: "DELETE", url: `${S}/entry` },
  { name: "search: no q", method: "GET", url: `${S}/search` },
  { name: "resolve: no text", method: "POST", url: `${S}/resolve`, body: { urlPath: "/" } },
  { name: "route: no url", method: "GET", url: `${S}/route` },
  { name: "validate: paths not a list", method: "POST", url: `${S}/validate`, body: { paths: "a.md" } },
  { name: "files: limit zero", method: "GET", url: `${S}/files?limit=0` },
  { name: "file: no path", method: "GET", url: `${S}/file` },
  { name: "write file: no content", method: "PUT", url: `${S}/file?path=a.md`, body: {} },
  { name: "write file: bad mode", method: "PUT", url: `${S}/file?path=a.md`, body: { content: "x", mode: "admin" } },
  { name: "upload: no data", method: "POST", url: `${S}/media`, body: { filename: "a.png" } },
  { name: "delete media: not media", method: "DELETE", url: `${S}/media?path=src/pages/index.astro` },
  { name: "raw: no path", method: "GET", url: `${S}/raw` },
  { name: "raw: bad rev", method: "GET", url: `${S}/raw?path=a.png&rev=HEAD~1` },
  { name: "generate: no prompt", method: "POST", url: `${S}/images/generate`, body: { prompt: " " } },
  { name: "generate: too many", method: "POST", url: `${S}/images/generate`, body: { prompt: "x", count: 9 } },
  { name: "save image: no candidate", method: "POST", url: `${S}/images/save`, body: {} },
  { name: "diff: no path", method: "GET", url: `${S}/diff` },
  { name: "discard: paths not a list", method: "POST", url: `${S}/discard`, body: { paths: 1 } },
  { name: "publish: bad mode", method: "POST", url: `${S}/publish`, body: { mode: "force-push" } },
  { name: "history: bad limit", method: "GET", url: `${S}/history?limit=-1` },
  { name: "revert: not a version", method: "POST", url: `${S}/revert`, body: { commit: "HEAD; rm -rf /" } },
  { name: "publish message: bad paths", method: "POST", url: `${S}/publish/message`, body: { paths: [3] } },
  { name: "thread: bad mode", method: "POST", url: `${S}/threads`, body: { mode: "god" } },
  { name: "rename: empty", method: "PATCH", url: `${S}/threads/t1`, body: { title: "   " } },
  { name: "rename: too long", method: "PATCH", url: `${S}/threads/t1`, body: { title: "x".repeat(121) } },
  { name: "rename: no title", method: "PATCH", url: `${S}/threads/t1`, body: {} },
  { name: "create: empty look", method: "POST", url: "/api/sites/create", body: { name: "New", starter: "astro-starter", look: "" } },
  { name: "message: no text", method: "POST", url: `${S}/threads/t1/messages`, body: {} },
  { name: "message: bad brief", method: "POST", url: `${S}/threads/t1/messages`, body: { text: "x", brief: { audience: "y" } } },
  { name: "undo: no turn", method: "POST", url: `${S}/threads/t1/undo`, body: {} },
  { name: "body is not JSON", method: "POST", url: `${S}/discard`, body: "{nope" },
];

describe("validation failures", () => {
  it.each(bad)("$name → 400 invalid", async ({ method, url, body }) => {
    const calls: Calls = [];
    const { call } = testApp(services(calls));
    const response = await call(method, url, body);
    const payload = await json(response);

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid");
    expect(payload.error.message).toMatch(/^[A-Z“]/);
    expect(payload.error.message).not.toMatch(/ZodError|\bat \w+ \(/);
    // Nothing reached the engine.
    expect(calls.filter(([name]) => !name.startsWith("registry.get"))).toEqual([]);
  });

  it("names the missing field in plain words", async () => {
    const payload = await json(await testApp(services([])).call("GET", `${S}/entry`));

    expect(payload.error.message).toBe("“path” is missing.");
  });

  it.each(happy.filter((row) => row.url.startsWith(S)))("unknown site → 404 for $key", async (row) => {
    const response = await testApp(services([])).call(row.key.split(" ")[0]!, row.url.replace(SITE_ID, "nope"), row.body);
    const payload = await json(response);

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("not-found");
  });

  it("an unknown API path is a JSON 404", async () => {
    const response = await testApp().call("GET", "/api/nothing-here");

    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe("not-found");
  });
});
