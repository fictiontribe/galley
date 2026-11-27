/**
 * `checkPlugin`: what "a correct plugin" means, as a list of checks. The
 * structural check is the one the engine runs before using a plugin; the
 * rest exercise each contribution the way the engine will — an adapter
 * through the adapter kit's conformance check (given a fixture), an image or
 * video provider against a fake `fetch` (a refused key, no network, and your
 * own scripted reply), a tool's input through the engine's validator, a
 * script integration's snippet through the resolver. Every failure says
 * what to change.
 */
import { checkAdapter, type AdapterExpectations } from "@galleycms/adapter-kit";
import { isProviderError, objectSchema, RESERVED_TOOLS, resolveScriptSnippet, validatePlugin, type GalleyPlugin, type ImageGenerationRequest } from "@galley/core/plugins";
import { fakeFetch, json, providerContext, testContext, type FakeRoute } from "./testing";

export type CheckStatus = "pass" | "fail" | "warn";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail?: string;
}

export interface PluginReport {
  /** True when no check failed (warnings are allowed). */
  ok: boolean;
  checks: CheckResult[];
}

export interface PluginCheckOptions {
  /** Settings the checks run with (as if saved in the app). */
  settings?: Record<string, string>;
  /** Per adapter id: a fixture site it must recognise, and what it must find there. */
  adapters?: Record<string, { fixture: string; expectations?: AdapterExpectations }>;
  /** Per image provider id: a scripted reply to one generation, to check pictures come back. */
  imageProviders?: Record<string, { route: FakeRoute }>;
  /** Per video provider id: scripted replies for submit, poll and download. */
  videoProviders?: Record<string, { route: FakeRoute; maxPolls?: number }>;
}

/** The key the checks hand providers. If it shows up in a message, the provider leaked it. */
export const TEST_KEY = "sk-test-pluginkit-0123456789abcdefSECRET";
const SAMPLE: Omit<ImageGenerationRequest, "model"> = { prompt: "A lighthouse at dusk, flat illustration", aspect: "1:1", count: 1, transparent: false, references: [] };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function leaks(error: unknown): boolean {
  const record = error as { message?: unknown; plain?: unknown; detail?: unknown; stack?: unknown };

  return [record.message, record.plain, record.detail].some((part) => typeof part === "string" && part.includes(TEST_KEY));
}

/** What a provider threw, judged: a plain ProviderError of the expected kind, with the key nowhere in it. */
function judge(error: unknown, expected: string, what: string): Omit<CheckResult, "id" | "title"> {
  if (error === undefined) return { status: "fail", detail: `${what} succeeded where it should have failed — the scripted reply was an error.` };
  if (!isProviderError(error)) {
    return {
      status: "fail",
      detail: `${what} threw a raw error (“${message(error).slice(0, 160)}”). Throw ProviderError(kind, plain, detail) from @galleycms/plugin-kit so the person reads a plain sentence.`,
    };
  }
  if (leaks(error)) return { status: "fail", detail: `${what} put the API key in its error. Cut it out of message and detail before throwing.` };
  if (error.kind !== expected) return { status: "warn", detail: `${what} said “${error.plain}” as a “${error.kind}” problem; this situation is usually “${expected}”.` };
  return { status: "pass", detail: error.plain };
}

async function attempt(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
    return undefined;
  } catch (error) {
    return error;
  }
}

const refusedKey: FakeRoute = () => json(401, { error: { code: 401, message: `Invalid credentials: ${TEST_KEY}` } });
const noNetwork: FakeRoute = () => {
  throw new TypeError("fetch failed");
};

export async function checkPlugin(value: unknown, options: PluginCheckOptions = {}): Promise<PluginReport> {
  const checks: CheckResult[] = [];
  const add = (id: string, title: string, result: Omit<CheckResult, "id" | "title">) => checks.push({ id, title, ...result });
  const shape = validatePlugin(value, (value as { name?: string } | null)?.name ?? "The plugin", { reservedTools: RESERVED_TOOLS });

  add("shape", "Is a well-formed plugin", shape.ok ? (shape.warnings.length ? { status: "warn", detail: shape.warnings.join(" ") } : { status: "pass" }) : { status: "fail", detail: shape.problems.join(" ") });
  if (!shape.ok) return { ok: false, checks };
  const plugin = value as GalleyPlugin;
  const settings = { ...options.settings };

  if (plugin.setup) {
    const ctx = testContext({ name: plugin.name, settings });
    const failure = await attempt(async () => {
      const dispose = await Promise.race([Promise.resolve(plugin.setup!(ctx)), new Promise<never>((_r, reject) => setTimeout(() => reject(new Error("setup took longer than 5 seconds")), 5_000))]);

      if (typeof dispose === "function") await dispose();
    });

    add("setup", "Starts and stops cleanly", failure === undefined ? { status: "pass" } : { status: "fail", detail: `setup failed: ${message(failure)}. The engine turns a plugin off for the session when this happens.` });
  }

  for (const adapter of plugin.adapters ?? []) {
    const fixture = options.adapters?.[adapter.id];
    const title = `The ${adapter.name} adapter passes the adapter checks`;

    if (!fixture) {
      add(`adapter:${adapter.id}`, title, { status: "warn", detail: `Pass { adapters: { "${adapter.id}": { fixture: "<a folder with a small site>" } } } to run the adapter conformance checks.` });
      continue;
    }
    const report = await checkAdapter(adapter, fixture.fixture, fixture.expectations);
    const failed = report.checks.filter((check) => check.status === "fail");

    add(`adapter:${adapter.id}`, title, failed.length ? { status: "fail", detail: failed.map((check) => `${check.title}: ${check.detail ?? "failed"}`).join(" ") } : { status: "pass" });
  }

  for (const provider of plugin.imageProviders ?? []) {
    const request = { ...SAMPLE, model: provider.defaultModel };

    add(
      `image:${provider.id}:auth`,
      `${provider.label}: a refused key becomes a plain message without the key in it`,
      judge(await attempt(() => provider.generate(request, providerContext({ settings, key: TEST_KEY, fetch: fakeFetch(refusedKey).fetch }))), "auth", "generate")
    );
    add(
      `image:${provider.id}:offline`,
      `${provider.label}: no network becomes a plain message`,
      judge(await attempt(() => provider.generate(request, providerContext({ settings, key: TEST_KEY, fetch: fakeFetch(noNetwork).fetch }))), "unavailable", "generate")
    );
    let models: unknown;
    const modelsError = await attempt(async () => {
      models = await provider.models(providerContext({ settings, key: TEST_KEY, fetch: fakeFetch(noNetwork).fetch }));
    });

    add(
      `image:${provider.id}:models`,
      `${provider.label}: lists its models even offline`,
      modelsError !== undefined
        ? { status: "warn", detail: `models() threw without a network (${message(modelsError)}). Keep a small fallback list so Settings can still show something.` }
        : !Array.isArray(models) || models.length === 0
          ? { status: "warn", detail: "models() listed nothing without a network. Keep a small fallback list." }
          : !(models as Array<{ id: string }>).some((model) => model.id === provider.defaultModel)
            ? { status: "warn", detail: `The default model “${provider.defaultModel}” isn't in the list models() returns.` }
            : { status: "pass" }
    );
    const scripted = options.imageProviders?.[provider.id];

    if (scripted) {
      let images: unknown;
      const failure = await attempt(async () => {
        images = await provider.generate(request, providerContext({ settings, key: TEST_KEY, fetch: fakeFetch(scripted.route).fetch }));
      });
      const list = Array.isArray(images) ? (images as Array<{ data?: unknown; mime?: unknown }>) : [];
      const good = list.length > 0 && list.every((image) => image.data instanceof Uint8Array && image.data.byteLength > 0 && typeof image.mime === "string" && image.mime.startsWith("image/"));

      add(
        `image:${provider.id}:generate`,
        `${provider.label}: turns a scripted reply into pictures`,
        failure !== undefined ? { status: "fail", detail: `generate failed on the scripted reply: ${message(failure)}` } : good ? { status: "pass" } : { status: "fail", detail: "generate should return at least one { data: Uint8Array, mime: \"image/…\" }." }
      );
    }
  }

  for (const provider of plugin.videoProviders ?? []) {
    const request = { prompt: "Waves on a pebble beach", model: provider.defaultModel };

    add(
      `video:${provider.id}:auth`,
      `${provider.label}: a refused key becomes a plain message without the key in it`,
      judge(await attempt(() => provider.start(request, providerContext({ settings, key: TEST_KEY, fetch: fakeFetch(refusedKey).fetch }))), "auth", "start")
    );
    const scripted = options.videoProviders?.[provider.id];

    if (scripted) {
      const failure = await attempt(async () => {
        const ctx = providerContext({ settings, key: TEST_KEY, fetch: fakeFetch(scripted.route).fetch });
        const { jobId } = await provider.start(request, ctx);

        for (let poll = 0; ; poll += 1) {
          if (poll >= (scripted.maxPolls ?? 10)) throw new Error("the job never finished in the scripted replies");
          const state = await provider.poll(jobId, ctx);

          if (state.state === "failed") throw new Error(`the job failed: ${state.message}`);
          if (state.state === "done") break;
        }
        const file = await provider.download(jobId, 0, ctx);

        if (!(file.data instanceof Uint8Array) || file.data.byteLength === 0 || !file.mime.startsWith("video/")) throw new Error("download should return { data: Uint8Array, mime: \"video/…\" }");
      });

      add(`video:${provider.id}:cycle`, `${provider.label}: submits, polls and downloads a scripted job`, failure === undefined ? { status: "pass" } : { status: "fail", detail: message(failure) });
    }
  }

  for (const tool of plugin.tools ?? []) {
    const failure = await attempt(async () => {
      objectSchema(tool.input).parse({});
    });
    const required = tool.input.required ?? [];
    const valid = failure === undefined || required.length > 0;

    add(
      `tool:${tool.name}`,
      `The ${tool.name} tool's input can be checked by the engine`,
      !valid
        ? { status: "fail", detail: `An empty input was refused although nothing is required: ${message(failure)}` }
        : tool.description.length < 40
          ? { status: "warn", detail: "The description is short. The model decides when to use a tool from its description — say what it does and when to use it." }
          : { status: "pass" }
    );
  }

  for (const integration of plugin.scriptIntegrations ?? []) {
    const sample = Object.fromEntries(integration.settings.map((field) => [field.key, "sample-value"]));
    const resolved = resolveScriptSnippet(integration, sample);
    let ok = true;

    if (resolved.src) {
      try {
        ok = new URL(resolved.src).protocol === "https:";
      } catch {
        ok = false;
      }
    }
    add(`script:${integration.kind}`, `The ${integration.name} snippet resolves`, ok ? { status: "pass" } : { status: "fail", detail: `With its settings filled in, the script address isn't a valid https:// address: ${resolved.src ?? ""}` });
  }

  return { ok: checks.every((check) => check.status !== "fail"), checks };
}

/** A report as plain lines, for a terminal or a test failure. */
export function formatPluginReport(report: PluginReport): string {
  const mark = { pass: "✓", warn: "!", fail: "✗" } as const;

  return report.checks.map((check) => `${mark[check.status]} ${check.title}${check.detail ? `\n    ${check.detail}` : ""}`).join("\n");
}
