/**
 * The mock server (mock/server.ts) as the demo runs it, in the visitor's
 * page: local mode (no sign-in), the sample site from demo/fixtures.ts, and
 * a few answers of the demo's own, each added through the server's
 * `handlers` option so the mock's code is shared, not copied:
 *
 * - the assistant replays one recorded exchange (demo/assistant.ts);
 * - the preview is ready at once: it is the sample site's files, not a dev server;
 * - the site's model carries what its galley.config.json declares (section
 *   pictures, templates), which the mock's own inference leaves out;
 * - the inbox shows the sample site's own contact form.
 */
import type { BlockType, Field, GalleyConfig, SiteModel } from "@galley/core/types";
import type { MockBackend, Handlers } from "../mock/backend.ts";
import { createMockServer, type MockServer } from "../mock/server.ts";
import { MockError } from "../mock/site.ts";
import { runDemoTurn } from "./assistant";
import { CADDOW_BRAND, CADDOW_GUIDE } from "./brand";
import { DEMO_SITE_ID } from "./fixtures";
import { snapshotUrl } from "./preview";

type ConfigField = { key: string; blocks?: Array<{ type: string; label?: string; description?: string; thumbnail?: string }> };
type ConfigCollection = { id: string; fields?: ConfigField[] };

/** Section labels, descriptions and pictures from galley.config.json, over the blocks the mock inferred. */
export function withDeclaredBlocks(fields: Field[], declared: ConfigField[] | undefined): Field[] {
  if (!declared?.length) return fields;
  return fields.map((field) => {
    const config = declared.find((candidate) => candidate.key === field.key);
    if (field.type !== "blocks" || !config?.blocks) return field;
    const seen = new Map((field.blocks ?? []).map((block) => [block.type, block]));
    const blocks: BlockType[] = config.blocks.map((item) => {
      const inferred = seen.get(item.type);
      return { ...(inferred ?? { type: item.type, fields: [], count: 0 }), label: item.label ?? inferred?.label ?? item.type, ...(item.description ? { description: item.description } : {}), ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}) };
    });
    // Anything on the pages the config doesn't name stays, after the declared ones.
    for (const block of field.blocks ?? []) if (!config.blocks.some((item) => item.type === block.type)) blocks.push(block);
    return { ...field, blocks };
  });
}

export function withDeclarations(model: SiteModel, config: GalleyConfig | null): SiteModel {
  if (!config) return model;
  const collections = (config.collections ?? []) as ConfigCollection[];
  return {
    ...model,
    collections: model.collections.map((collection) => ({ ...collection, fields: withDeclaredBlocks(collection.fields, collections.find((c) => c.id === collection.id)?.fields) })),
    ...(config.templates ? { templates: config.templates } : {}),
  };
}

function demoHandlers(handlers: Handlers, mock: MockBackend): Handlers {
  const configOf = (siteId: string) => mock.sites.get(siteId)?.config ?? null;
  const declaredFor = (siteId: string, path: string) => {
    const site = mock.sites.get(siteId);
    const collection = site?.collectionOf(path);
    return ((site?.config?.collections ?? []) as ConfigCollection[]).find((c) => c.id === collection?.id)?.fields;
  };

  return {
    ...handlers,
    "GET /api/meta": (request) => {
      const meta = handlers["GET /api/meta"](request);
      // Keyboard hints follow the visitor's computer, as they would with the app running on it.
      const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      return { ...(meta as Awaited<typeof meta>), platform: mac ? "darwin" : /Win/.test(navigator.platform) ? "win32" : "linux" };
    },
    "GET /api/sites/:siteId": (request) => {
      const site = handlers["GET /api/sites/:siteId"](request) as Awaited<ReturnType<Handlers["GET /api/sites/:siteId"]>>;
      return { ...site, model: withDeclarations(site.model, configOf(request.params.siteId)) };
    },
    "POST /api/sites/open": (request) => {
      const site = handlers["POST /api/sites/open"](request) as Awaited<ReturnType<Handlers["POST /api/sites/open"]>>;
      return { ...site, model: withDeclarations(site.model, configOf(site.id)) };
    },
    "POST /api/sites/:siteId/refresh": (request) => withDeclarations(handlers["POST /api/sites/:siteId/refresh"](request) as SiteModel, configOf(request.params.siteId)),
    "GET /api/sites/:siteId/entry": (request) => {
      const entry = handlers["GET /api/sites/:siteId/entry"](request) as Awaited<ReturnType<Handlers["GET /api/sites/:siteId/entry"]>>;
      return { ...entry, fields: withDeclaredBlocks(entry.fields, declaredFor(request.params.siteId, entry.path)) };
    },
    "PATCH /api/sites/:siteId/entry": (request) => {
      const result = handlers["PATCH /api/sites/:siteId/entry"](request) as Awaited<ReturnType<Handlers["PATCH /api/sites/:siteId/entry"]>>;
      return { ...result, entry: { ...result.entry, fields: withDeclaredBlocks(result.entry.fields, declaredFor(request.params.siteId, result.entry.path)) } };
    },
    // The preview is the sample site's built files: nothing to start, so it is ready straight away.
    "POST /api/sites/:siteId/preview/start": ({ params }) => {
      mock.site(params.siteId);
      const url = snapshotUrl();
      return mock.setPreview(params.siteId, { state: "ready", url, baselineUrl: url, baselineSource: "production", detail: "Preview running", log: ["The demo’s preview is the sample site’s built pages, with your changes applied in the page."], startedAt: Date.now() });
    },
    "POST /api/sites/:siteId/threads/:threadId/messages": ({ params, body }) => {
      const site = mock.site(params.siteId);
      const thread = mock.threads.get(params.siteId)?.find((t) => t.id === params.threadId);
      if (!thread) return handlers["POST /api/sites/:siteId/threads/:threadId/messages"]({ params, body } as Parameters<Handlers["POST /api/sites/:siteId/threads/:threadId/messages"]>[0]);
      if (thread.busy) return handlers["POST /api/sites/:siteId/threads/:threadId/messages"]({ params, body } as Parameters<Handlers["POST /api/sites/:siteId/threads/:threadId/messages"]>[0]);
      return runDemoTurn(mock, site, thread, body);
    },
    // The sample site's brand, saved; the mock's own is another (invented) studio's.
    "GET /api/sites/:siteId/brand": async (request) => {
      const state = await handlers["GET /api/sites/:siteId/brand"](request);
      if (state.brand || state.proposal || state.analysis) return state;
      return { ...state, brand: CADDOW_BRAND, guide: CADDOW_GUIDE, pending: [], imagery: CADDOW_BRAND.imagery?.direction ?? null, digest: `The site's brand (galley/brand).\n\n${CADDOW_GUIDE}` };
    },
    "POST /api/sites/:siteId/brand/analyse": () => {
      throw new MockError("unconfigured", "Reading a brand measures the site running on your own computer, so the demo keeps the brand it already has. On your own site this reads every page.");
    },
    // The mock's brand checks report sample problems in files and pages the sample site doesn't have.
    "POST /api/sites/:siteId/brand/check": () => ({ items: [] }),
    "POST /api/sites/:siteId/brand/drift": () => ({ checkedAt: new Date().toISOString(), pages: ["/", "/atelier/", "/journal/"], unknown: [], unused: [], matching: 14 }),
    "GET /api/sites/:siteId/inbox": async (request) => {
      const answer = await handlers["GET /api/sites/:siteId/inbox"](request);
      const site = mock.sites.get(request.params.siteId);
      const text = site?.read("src/content/forms/contact.json")?.toString("utf8");
      if (!text) return answer;
      const definition = JSON.parse(text) as NonNullable<(typeof answer.forms)[number]["definition"]>;
      return { ...answer, forms: answer.forms.map((form) => (form.id === "contact" ? { ...form, name: definition.name, definition } : form)) };
    },
  };
}

export interface DemoServerHandle {
  server: MockServer;
  siteId: string;
  /** Versions the sample site ships with: any more were published during the visit. */
  sampleVersions: number;
}

export function createDemoServer(): DemoServerHandle {
  // No added latency: the server is in the page, and answers as fast as a local one.
  const server = createMockServer({ mode: "local", latency: 0, handlers: demoHandlers });
  const backend = server.backend;
  // No earlier conversations: the visitor's are the only ones.
  for (const id of backend.sites.keys()) backend.threads.set(id, []);
  // An assistant key is "set" so the chat is open; it is never used (demo/assistant.ts). No image service: the offline placeholders only.
  backend.secrets.anthropic = { name: "anthropic", configured: true, source: "env", hint: "demo" };
  backend.secrets.openai = { name: "openai", configured: false, source: null };
  return { server, siteId: DEMO_SITE_ID, sampleVersions: backend.sites.get(DEMO_SITE_ID)?.history.length ?? 0 };
}
