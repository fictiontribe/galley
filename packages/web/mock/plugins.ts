/**
 * Plugins, the merged catalogues and video generation, answered from memory
 * for `dev:mock`. The fixtures cover every state the Plugins screen draws:
 * the core built-ins (can't be turned off), the OpenRouter plugin with its
 * key, the WordPress importer, installed plugins (one working with a secret
 * left unset, one whose key comes from the environment, one written for
 * another plugin API version, one video service without a key), a plugin the
 * first site names in its config, and one name conflict the site's own
 * plugin wins. Video jobs move through the same steps the engine reports.
 *
 * Loaded by Node directly, not bundled: types and the dependency-free
 * catalogue data only — never an engine runtime module.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PluginTheme } from "@galley/core/themes";
import type { DataSourceOption, PluginCatalog } from "@galley/core/api";
import type { FormProviderInfo, ScriptIntegrationInfo } from "@galley/core/kit";
import { FORM_PROVIDERS, SCRIPT_INTEGRATIONS } from "@galley/core/kit-catalog";
import { PRODUCT } from "@galley/core/brand";
import type { ImageProviderInfo, Job, PluginConflict, PluginContributions, PluginInfo, PluginSettingInfo, VideoCandidate, VideoProviderInfo } from "@galley/core/types";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError } from "./site.ts";

type PluginKey =
  | "GET /api/plugins"
  | "GET /api/sites/:siteId/plugins"
  | "POST /api/plugins/enabled"
  | "PUT /api/plugins/settings"
  | "GET /api/catalog"
  | "GET /api/sites/:siteId/catalog"
  | "GET /api/sites/:siteId/data-sources/:sourceId"
  | "GET /api/videos/providers"
  | "POST /api/sites/:siteId/videos/generate"
  | "GET /api/videos/jobs/:jobId"
  | "GET /api/videos/candidates/:candidateId"
  | "POST /api/sites/:siteId/videos/save"
  | "DELETE /api/videos/candidates/:candidateId";

const BUILTIN = "@galley/builtin";
const OPENROUTER = "@galley/plugin-openrouter";
const EXAMPLE = "galley-plugin-example";
const SITE_PLUGIN = "galley-plugin-harbour-tools";
/** What the media library accepts — the engine's own limit (workspace/media.ts). */
const VIDEO_LIMIT = 25 * 1024 * 1024;

/** A setting as the plugin declares it, plus what the mock holds for it. Secret values stay in here. */
interface SettingSpec {
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  pattern?: string;
  secret?: boolean;
  required?: boolean;
  /** Set by the environment the mock "started" in: shown, never changeable. */
  env?: { hint?: string; value?: string };
  value?: string;
}

interface Fixture {
  info: Omit<PluginInfo, "settings" | "active">;
  settings: SettingSpec[];
  /** Turned off for the session by a problem, whatever the person chose. */
  broken?: boolean;
  /** Only listed for this site. */
  siteOnly?: boolean;
  formProviders?: FormProviderInfo[];
  scriptIntegrations?: Array<ScriptIntegrationInfo & { snippet?: { src?: string; inline?: string; attributes?: Record<string, string> } }>;
  imageProviders?: ImageProviderInfo[];
  videoProviders?: Array<Omit<VideoProviderInfo, "configured"> & { keySetting?: string }>;
  importers?: PluginCatalog["importers"];
  deployTargets?: PluginCatalog["deployTargets"];
  /** Values a field can pick from, with everything the source holds. */
  dataSources?: Array<{ id: string; label: string; description?: string; items: DataSourceOption[] }>;
}

const none = (): PluginContributions => ({ adapters: [], imageProviders: [], videoProviders: [], formProviders: [], scriptIntegrations: [], importers: [], deployTargets: [], tools: [], hooks: [] });

/** OpenRouter's dated fallback list, as the plugin ships it (packages/plugins/openrouter/src). */
const OPENROUTER_VIDEO_MODELS: VideoProviderInfo["models"] = [
  { id: "google/veo-3.1-lite", label: "Veo 3.1 Lite", durations: [4, 6, 8], resolutions: ["720p", "1080p"], aspects: ["16:9", "9:16"], supportsFirstFrame: true, audio: true, price: "$0.03–$0.08 per second" },
  { id: "google/veo-3.1-fast", label: "Veo 3.1 Fast", durations: [4, 6, 8], resolutions: ["720p", "1080p", "4K"], aspects: ["16:9", "9:16"], supportsFirstFrame: true, audio: true, price: "$0.08–$0.30 per second" },
  { id: "kwaivgi/kling-v3.0-std", label: "Kling 3.0 Standard", durations: [5, 10], resolutions: ["720p"], aspects: ["16:9", "9:16", "1:1"], supportsFirstFrame: true, audio: true, price: "$0.084 per second" },
  { id: "bytedance/seedance-2.0-fast", label: "Seedance 2.0 Fast", resolutions: ["480p", "720p"], supportsFirstFrame: false, audio: false },
];

const OPENROUTER_IMAGE_MODELS: ImageProviderInfo["models"] = [
  { id: "google/gemini-3.1-flash-image", label: "Nano Banana 2", supportsReferences: true, supportsTransparency: false, price: "$0.039 per image" },
  { id: "black-forest-labs/flux.2-pro", label: "FLUX.2 Pro", supportsReferences: true, supportsTransparency: false, price: "$0.03 per megapixel" },
  { id: "openai/gpt-image-1.5", label: "GPT Image 1.5", supportsReferences: true, supportsTransparency: true, price: "$0.04 per image" },
  { id: "recraft/recraft-v4.1", label: "Recraft V4.1", supportsReferences: false, supportsTransparency: false },
];

function fixtures(siteId: string | undefined): Fixture[] {
  const builtinContributions: PluginContributions = {
    ...none(),
    adapters: ["Astro", "Eleventy", "Hugo", "Next.js"],
    imageProviders: ["Placeholders (offline)", "OpenAI", "Google"],
    formProviders: FORM_PROVIDERS.map((provider) => provider.name),
    scriptIntegrations: SCRIPT_INTEGRATIONS.map((integration) => integration.name),
    deployTargets: ["Cloudflare", "Vercel"],
  };
  return [
    {
      info: {
        name: BUILTIN,
        displayName: `${PRODUCT.name} built-ins`,
        description: "The framework adapters, image providers, form destinations and script integrations that come with the app.",
        version: "0.1.0",
        source: "builtin",
        location: "built in",
        enabled: true,
        canDisable: false,
        contributes: builtinContributions,
        problems: [],
        warnings: [],
        log: [],
      },
      settings: [],
    },
    {
      info: {
        name: OPENROUTER,
        displayName: "OpenRouter",
        description: "Make images and videos with the models OpenRouter offers, on one OpenRouter key.",
        version: "0.1.0",
        source: "builtin",
        location: "ships with the app",
        enabled: true,
        canDisable: true,
        contributes: { ...none(), imageProviders: ["OpenRouter"], videoProviders: ["OpenRouter"] },
        problems: [],
        warnings: [],
        log: ["info: read 41 image models and 9 video models from the OpenRouter catalogue"],
      },
      settings: [
        {
          key: "apiKey",
          label: "OpenRouter API key",
          help: "Create one at openrouter.ai › Keys. Images and videos are paid from that account’s credit.",
          secret: true,
          required: true,
          pattern: "^sk-or-[A-Za-z0-9_-]{16,}$",
          placeholder: "sk-or-v1-…",
          value: "sk-or-v1-mock000000000000004f2a",
        },
      ],
      imageProviders: [{ id: "openrouter", label: "OpenRouter", configured: true, models: OPENROUTER_IMAGE_MODELS, defaultModel: "google/gemini-3.1-flash-image", supportsReferences: true, supportsTransparency: false }],
      videoProviders: [{ id: "openrouter", label: "OpenRouter", models: OPENROUTER_VIDEO_MODELS, defaultModel: "google/veo-3.1-lite", keySetting: "apiKey" }],
    },
    {
      info: {
        name: "@galley/import-wordpress",
        displayName: "WordPress importer",
        description: "Posts, pages, images and SEO details from a WordPress site (its address or an export file), as pending changes to proof.",
        version: "0.1.0",
        source: "builtin",
        location: "ships with the app",
        enabled: true,
        canDisable: true,
        contributes: { ...none(), importers: ["WordPress"] },
        problems: [],
        warnings: [],
        log: [],
      },
      settings: [],
      importers: [{ id: "wordpress", name: "WordPress", description: "Posts, pages, images and SEO details from a WordPress site.", input: "url-or-file", plugin: "@galley/import-wordpress", command: true }],
    },
    {
      info: {
        name: EXAMPLE,
        displayName: "Example plugin",
        description: "Fathom Analytics, a publish webhook, and a word count for the assistant.",
        version: "0.1.0",
        source: "user",
        location: "galley-plugin-example@0.1.0",
        enabled: true,
        canDisable: true,
        contributes: { ...none(), scriptIntegrations: ["Fathom Analytics"], tools: [{ name: "count_words", title: "Count the words on a page", mode: "content", readOnly: true }], hooks: ["afterPublish"] },
        problems: [],
        warnings: [],
        log: ["info: told the webhook about the publish of Harbour Bakery", "error: afterPublish failed: the webhook answered 410"],
      },
      settings: [
        {
          key: "webhookUrl",
          label: "Publish webhook",
          help: "An address that accepts a POST with { text } — a chat channel’s incoming webhook. Every publish is summed up there. It can contain a token, so it is kept as a secret.",
          secret: true,
          pattern: "^https://.+",
          placeholder: "https://hooks.example.com/…",
        },
      ],
      scriptIntegrations: [
        {
          kind: "fathom",
          name: "Fathom Analytics",
          description: "Privacy-first page analytics without cookies.",
          category: "analytics",
          defaultConsent: "necessary",
          defaultPlacement: "head",
          settings: [{ key: "siteId", label: "Site ID", placeholder: "ABCDEFGH", pattern: "^[A-Z0-9]{4,12}$", required: true }],
          docsUrl: "https://usefathom.com/docs/script/embed",
          snippet: { src: "https://cdn.usefathom.com/script.js", attributes: { "data-site": "{{siteId}}", defer: "" } },
        },
      ],
    },
    {
      info: {
        name: "galley-plugin-mailchimp",
        displayName: "Mailchimp",
        description: "Adds form submissions to a Mailchimp audience.",
        version: "1.3.0",
        source: "user",
        location: "galley-plugin-mailchimp@^1.3.0",
        enabled: true,
        canDisable: true,
        contributes: { ...none(), formProviders: ["Mailchimp"] },
        problems: [],
        warnings: [],
        log: [],
      },
      settings: [
        { key: "apiKey", label: "Mailchimp API key", secret: true, required: true, env: { hint: "us21" }, help: "From Mailchimp › Profile › Extras › API keys." },
        { key: "audience", label: "Audience ID", placeholder: "a1b2c3d4e5", pattern: "^[a-z0-9]{10}$", value: "f81c2a90de" },
      ],
      formProviders: [
        {
          id: "mailchimp",
          name: "Mailchimp",
          description: "Adds each person to a Mailchimp audience.",
          settings: [{ key: "audience", label: "Audience ID", placeholder: "a1b2c3d4e5", pattern: "^[a-z0-9]{10}$", required: true }],
          canImportFields: false,
          docsUrl: "https://mailchimp.com/help/find-audience-id/",
        },
      ],
    },
    {
      info: {
        name: "galley-plugin-slack-notify",
        displayName: "galley-plugin-slack-notify",
        version: "2.0.0",
        source: "user",
        location: "galley-plugin-slack-notify@2.0.0",
        enabled: true,
        canDisable: true,
        contributes: none(),
        problems: ["galley-plugin-slack-notify: it was written for plugin API version 2, and this engine speaks version 1. Update the plugin. It is turned off until that is fixed."],
        warnings: [],
        log: [],
      },
      settings: [],
      broken: true,
    },
    {
      info: {
        name: "galley-plugin-lumen",
        displayName: "Lumen video",
        description: "Short product clips from a still picture.",
        version: "0.4.2",
        source: "user",
        location: "galley-plugin-lumen@0.4.2",
        enabled: true,
        canDisable: true,
        contributes: { ...none(), videoProviders: ["Lumen"] },
        problems: [],
        warnings: ["galley-plugin-lumen: “themes” isn't something a plugin can contribute, so it is ignored."],
        log: [],
      },
      settings: [{ key: "apiKey", label: "Lumen API key", secret: true, required: true, placeholder: "lmn_…" }],
      videoProviders: [{ id: "lumen", label: "Lumen", models: [{ id: "lumen-2", label: "Lumen 2", durations: [3, 5], aspects: ["1:1", "9:16", "16:9"], supportsFirstFrame: true, price: "$0.12 per second" }], defaultModel: "lumen-2", keySetting: "apiKey" }],
    },
    ...(siteId
      ? [
          {
            siteOnly: true,
            info: {
              name: SITE_PLUGIN,
              displayName: "Harbour tools",
              description: "The bakery’s own booking form destination and a check on opening hours.",
              version: "0.2.0",
              source: "site" as const,
              siteId,
              location: "./tools/plugin.mjs",
              enabled: true,
              canDisable: true,
              contributes: {
                ...none(),
                formProviders: ["Tablebook"],
                scriptIntegrations: ["Fathom Analytics"],
                tools: [
                  { name: "check_opening_hours", title: "Check the opening hours", mode: "content" as const, readOnly: true },
                  { name: "list_specials", title: "List this week’s specials", mode: "content" as const, readOnly: true },
                  { name: "rebuild_menu", title: "Rebuild the menu page", mode: "build" as const, readOnly: false },
                ],
                hooks: ["beforePublish"],
                dataSources: ["Bakes in the shop"],
              },
              problems: [],
              warnings: [],
              log: [],
            },
            settings: [{ key: "venue", label: "Tablebook venue", placeholder: "harbour-bakery", value: "harbour-bakery" }],
            dataSources: [
              {
                id: "bakery-bakes",
                label: "Bakes in the shop",
                description: "Pick a bake from the shop's list. The page keeps its handle.",
                items: [
                  { value: "country-sourdough", title: "Country sourdough", detail: "£5.20 · Bread" },
                  { value: "seeded-rye", title: "Seeded rye", detail: "£4.80 · Bread" },
                  { value: "cardamom-bun", title: "Cardamom bun", detail: "£3.10 · Pastry" },
                  { value: "almond-croissant", title: "Almond croissant", detail: "£3.40 · Pastry · Sold out" },
                  { value: "fruit-loaf", title: "Fruit loaf", detail: "£6.00 · Bread" },
                ],
              },
            ],
            formProviders: [
              {
                id: "tablebook",
                name: "Tablebook",
                description: "Turns a submission into a table booking.",
                settings: [{ key: "venue", label: "Venue", placeholder: "harbour-bakery", required: true }],
                canImportFields: false,
              },
            ],
            scriptIntegrations: [
              {
                kind: "fathom",
                name: "Fathom Analytics",
                description: "The site’s own copy, with its custom domain.",
                category: "analytics" as const,
                defaultConsent: "necessary" as const,
                defaultPlacement: "head" as const,
                settings: [{ key: "siteId", label: "Site ID", placeholder: "ABCDEFGH", pattern: "^[A-Z0-9]{4,12}$", required: true }],
                snippet: { src: "https://stats.harbour.example/script.js", attributes: { "data-site": "{{siteId}}", defer: "" } },
              },
            ],
          } satisfies Fixture,
        ]
      : []),
  ];
}

/** The first bytes of an MP4 to play in previews, if this checkout has one; otherwise a stand-in the preview can't play (the UI says so). */
function sampleVideo(): Buffer {
  const file = fileURLToPath(new URL("../../../apps/video/assets/footage/editor-ask.mp4", import.meta.url));
  return existsSync(file) ? readFileSync(file) : Buffer.from("mock video: no sample file in this checkout");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMockPlugins(mock: MockBackend) {
  /** The person's on/off choices and saved values, by plugin name. Secret values never leave this map. */
  const enabled = new Map<string, boolean>();
  const values = new Map<string, Map<string, string>>();
  const videoJobs = new Map<string, { job: Job; candidates: VideoCandidate[] }>();
  const videoBytes = new Map<string, Buffer>();
  /** The site whose config names the site plugin: the first fixture site. */
  const namingSite = () => [...mock.sites.values()][0]?.id;

  const all = (siteId?: string) => fixtures(siteId && siteId === namingSite() ? siteId : undefined);
  const stored = (name: string) => {
    let map = values.get(name);
    if (!map) {
      map = new Map();
      for (const spec of all(namingSite()).find((fixture) => fixture.info.name === name)?.settings ?? []) if (spec.value !== undefined) map.set(spec.key, spec.value);
      values.set(name, map);
    }
    return map;
  };
  const isEnabled = (fixture: Fixture) => enabled.get(fixture.info.name) ?? fixture.info.enabled;
  const isActive = (fixture: Fixture) => isEnabled(fixture) && !fixture.broken;
  const settingSet = (fixture: Fixture, key: string) => {
    const spec = fixture.settings.find((candidate) => candidate.key === key);
    return Boolean(spec?.env) || stored(fixture.info.name).has(key);
  };

  function settingInfo(fixture: Fixture, spec: SettingSpec): PluginSettingInfo {
    const saved = stored(fixture.info.name).get(spec.key);
    const base = { key: spec.key, label: spec.label, secret: Boolean(spec.secret), required: Boolean(spec.required), ...(spec.help ? { help: spec.help } : {}), ...(spec.placeholder ? { placeholder: spec.placeholder } : {}), ...(spec.pattern ? { pattern: spec.pattern } : {}) };
    if (spec.env) return { ...base, configured: true, source: "env", ...(spec.secret ? { hint: spec.env.hint ?? "····" } : { value: spec.env.value ?? "" }) };
    if (saved === undefined) return { ...base, configured: false, source: null };
    // A secret's value never appears: whether it is set and its last four characters only.
    return { ...base, configured: true, source: "stored", ...(spec.secret ? { hint: saved.slice(-4) } : { value: saved }) };
  }

  function info(fixture: Fixture): PluginInfo {
    return { ...fixture.info, enabled: isEnabled(fixture), active: isActive(fixture), settings: fixture.settings.map((spec) => settingInfo(fixture, spec)) };
  }

  function conflicts(siteId?: string): PluginConflict[] {
    const list = all(siteId).filter(isActive);
    const site = list.find((fixture) => fixture.info.name === SITE_PLUGIN);
    const example = list.find((fixture) => fixture.info.name === EXAMPLE);
    // The site's own plugin wins over an installed one.
    return site && example ? [{ kind: "scriptIntegration", id: "fathom", used: SITE_PLUGIN, ignored: [EXAMPLE] }] : [];
  }

  function videoProviders(): VideoProviderInfo[] {
    return all()
      .filter(isActive)
      .flatMap((fixture) => (fixture.videoProviders ?? []).map(({ keySetting, ...provider }) => ({ ...provider, configured: keySetting ? settingSet(fixture, keySetting) : true })));
  }

  function imageProviders(): ImageProviderInfo[] {
    return all()
      .filter(isActive)
      .flatMap((fixture) => (fixture.imageProviders ?? []).map((provider) => ({ ...provider, configured: settingSet(fixture, "apiKey") })));
  }

  function catalog(siteId?: string): PluginCatalog {
    const list = all(siteId).filter(isActive);
    const builtin = <T extends object>(items: readonly T[]) => items.map((item) => ({ ...item, plugin: BUILTIN }));
    // Most specific first wins a shared id: the site's own, then installed, then built in.
    const rank = (fixture: Fixture) => (fixture.info.source === "site" ? 0 : fixture.info.source === "user" ? 1 : 2);
    const ordered = [...list].sort((a, b) => rank(a) - rank(b));
    const firstBy = <T>(items: T[], id: (item: T) => string) => items.filter((item, index) => items.findIndex((other) => id(other) === id(item)) === index);
    return {
      formProviders: [...builtin(FORM_PROVIDERS), ...firstBy(ordered.flatMap((fixture) => (fixture.formProviders ?? []).map((provider) => ({ ...provider, plugin: fixture.info.name }))), (p) => p.id)],
      scriptIntegrations: [...builtin(SCRIPT_INTEGRATIONS), ...firstBy(ordered.flatMap((fixture) => (fixture.scriptIntegrations ?? []).map((integration) => ({ ...integration, plugin: fixture.info.name }))), (s) => s.kind)],
      imageProviders: mock.fullSettings().images.providers,
      videoProviders: videoProviders(),
      importers: list.flatMap((fixture) => fixture.importers ?? []),
      deployTargets: [
        { id: "cloudflare", name: "Cloudflare", blurb: "Workers static assets on your Cloudflare account.", plugin: BUILTIN },
        { id: "vercel", name: "Vercel", blurb: "A Vercel project on your account or team.", plugin: BUILTIN },
      ],
      dataSources: ordered.flatMap((fixture) => (fixture.dataSources ?? []).map(({ items: _items, ...source }) => ({ ...source, plugin: fixture.info.name }))),
    };
  }

  const find = (name: string, siteId?: string) => {
    const fixture = all(siteId ?? namingSite()).find((candidate) => candidate.info.name === name);
    if (!fixture) throw new MockError("not-found", `There is no plugin called “${name.slice(0, 80)}” here.`);
    return fixture;
  };

  const changed = () => mock.emit({ type: "plugins.updated" });

  function runVideo(siteId: string, prompt: string, providerId: string, model: string): Job {
    const provider = videoProviders().find((candidate) => candidate.id === providerId);
    const label = provider?.label ?? "The video service";
    const job: Job = { id: randomUUID(), kind: "video", label: `Making a video: “${prompt.length > 48 ? `${prompt.slice(0, 47)}…` : prompt}”`, state: "running", detail: `Sending it to ${label}…`, siteId, startedAt: Date.now() };
    mock.jobs.set(job.id, job);
    videoJobs.set(job.id, { job, candidates: [] });
    void (async () => {
      const steps = [0.08, 0.22, 0.41, 0.63, 0.81, 0.94];
      await sleep(1200);
      for (const progress of steps) {
        Object.assign(job, { progress, detail: `${label} is making it…` });
        mock.emit({ type: "job", job: { ...job } });
        await sleep(1400);
      }
      if (/\bfail\b/i.test(prompt)) {
        Object.assign(job, { state: "error", detail: `${label} couldn’t make this one: the request was turned down by its content rules.`, finishedAt: Date.now() });
        mock.emit({ type: "job", job: { ...job } });
        return;
      }
      Object.assign(job, { progress: 1, detail: "Downloading it…" });
      mock.emit({ type: "job", job: { ...job } });
      await sleep(700);
      const bytes = sampleVideo();
      const id = randomUUID();
      videoBytes.set(id, bytes);
      const candidate: VideoCandidate = { id, mime: "video/mp4", size: bytes.length, previewUrl: `/api/videos/candidates/${id}`, prompt, provider: providerId, model, cost: 0.4 };
      videoJobs.set(job.id, { job, candidates: [candidate] });
      Object.assign(job, { state: "done", detail: "The video is ready.", finishedAt: Date.now() });
      mock.emit({ type: "job", job: { ...job } });
    })();
    return { ...job };
  }

  const handlers: Pick<Handlers, PluginKey> = {
    "GET /api/plugins": () => ({ plugins: all().filter((fixture) => !fixture.siteOnly).map(info), conflicts: conflicts() }),
    "GET /api/sites/:siteId/plugins": ({ params }) => {
      mock.site(params.siteId);
      return { plugins: all(params.siteId).map(info), conflicts: conflicts(params.siteId) };
    },
    "POST /api/plugins/enabled": ({ body }) => {
      const fixture = find(body.name, body.siteId);
      if (!fixture.info.canDisable && !body.enabled) throw new MockError("invalid", `${body.name} comes with the app and can’t be turned off.`);
      enabled.set(fixture.info.name, body.enabled);
      changed();
      return info(fixture);
    },
    "PUT /api/plugins/settings": ({ body }) => {
      const fixture = find(body.name, body.siteId);
      const map = stored(fixture.info.name);
      for (const [key, value] of Object.entries(body.values)) {
        const spec = fixture.settings.find((candidate) => candidate.key === key);
        if (!spec) throw new MockError("invalid", `${fixture.info.displayName} has no setting called “${key}”.`);
        if (spec.env) throw new MockError("forbidden", `${spec.label} is set by the environment the app was started in, so it can’t be changed here.`);
        if (value === null || value === "") {
          map.delete(key);
          continue;
        }
        if (spec.pattern && !new RegExp(spec.pattern).test(value)) throw new MockError("invalid", `That doesn’t look like a ${spec.label}${spec.placeholder ? ` (it looks like ${spec.placeholder})` : ""}.`);
        map.set(key, value);
      }
      changed();
      return info(fixture);
    },
    "GET /api/catalog": () => catalog(),
    "GET /api/sites/:siteId/catalog": ({ params }) => {
      mock.site(params.siteId);
      return catalog(params.siteId);
    },
    "GET /api/sites/:siteId/data-sources/:sourceId": async ({ params, query }) => {
      mock.site(params.siteId);
      const fixture = all(params.siteId)
        .filter(isActive)
        .find((candidate) => candidate.dataSources?.some((source) => source.id === params.sourceId));
      const found = fixture?.dataSources?.find((source) => source.id === params.sourceId);
      if (!fixture || !found) throw new MockError("not-found", `Nothing called “${params.sourceId.slice(0, 60)}” offers values here. Check that its plugin is switched on.`);
      if (query.q !== undefined && query.value !== undefined) throw new MockError("invalid", "Ask for a search or a look-up, not both.");
      const { items, ...rest } = found;
      const source = { ...rest, plugin: fixture.info.name };
      // A shop takes a moment to answer; the picker shows that it is searching.
      await sleep(180);
      if (query.value !== undefined) return { source, item: items.find((item) => item.value === query.value) ?? null };
      const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const limit = Math.min(50, Math.max(1, Number(query.limit ?? 12) || 12));
      return { source, items: items.filter((item) => words.every((word) => `${item.title} ${item.value}`.toLowerCase().includes(word))).slice(0, limit) };
    },

    "GET /api/videos/providers": () => ({ providers: videoProviders() }),
    "POST /api/sites/:siteId/videos/generate": ({ params, body }) => {
      mock.site(params.siteId);
      const providers = videoProviders();
      if (providers.length === 0) throw new MockError("unconfigured", "No video service is set up here. Turn on a plugin that makes videos on the Plugins screen, then add its key.");
      const provider = body.provider ? providers.find((candidate) => candidate.id === body.provider) : providers[0];
      if (!provider) throw new MockError("invalid", "That video service isn’t available.", body.provider);
      if (!provider.configured) throw new MockError("unconfigured", `Add the ${provider.label} API key in Settings to make videos with ${provider.label}.`);
      const model = provider.models.find((candidate) => candidate.id === (body.model ?? provider.defaultModel));
      if (!model) throw new MockError("invalid", `${provider.label} doesn’t offer that model.`, body.model);
      if (body.durationSeconds && model.durations?.length && !model.durations.includes(body.durationSeconds)) throw new MockError("invalid", `${model.label} makes videos of ${model.durations.join(", ")} seconds. Choose one of those lengths.`);
      if (body.firstFramePath && !model.supportsFirstFrame) throw new MockError("invalid", `${model.label} can’t start from a picture.`);
      return runVideo(params.siteId, body.prompt, provider.id, model.id);
    },
    "GET /api/videos/jobs/:jobId": ({ params }) => {
      const status = videoJobs.get(params.jobId);
      if (!status) throw new MockError("not-found", "That video isn’t known here. It may have finished before the app restarted.");
      return { job: { ...status.job }, candidates: status.candidates };
    },
    "GET /api/videos/candidates/:candidateId": ({ params }) => {
      const bytes = videoBytes.get(params.candidateId);
      if (!bytes) throw new MockError("not-found", "That video is no longer available. Make it again.");
      return { kind: "bytes", type: "video/mp4", body: bytes };
    },
    "POST /api/sites/:siteId/videos/save": ({ params, body }) => {
      const bytes = videoBytes.get(body.candidateId);
      if (!bytes) throw new MockError("not-found", "That generated video has expired. Make it again.", body.candidateId);
      if (bytes.length > VIDEO_LIMIT) throw new MockError("invalid", "That video is larger than 25 MB, the most the media library keeps.");
      const item = mock.site(params.siteId).saveMedia(`${body.filename ?? "generated-video"}.mp4`, body.directory, bytes);
      videoBytes.delete(body.candidateId);
      for (const status of videoJobs.values()) status.candidates = status.candidates.filter((candidate) => candidate.id !== body.candidateId);
      mock.changed(params.siteId, [item.path], "user");
      return item;
    },
    "DELETE /api/videos/candidates/:candidateId": ({ params }) => {
      videoBytes.delete(params.candidateId);
      for (const status of videoJobs.values()) status.candidates = status.candidates.filter((candidate) => candidate.id !== params.candidateId);
      return { ok: true } as const;
    },
  };

  /** Themes the enabled plugins add (none of the fixtures adds one yet). */
  const themes = (): PluginTheme[] => [];

  return { handlers, imageProviders, themes };
}
