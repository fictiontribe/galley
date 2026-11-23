import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { DEFAULT_BRAND } from "@galley/core/brand";
import type {
  AgentRuntime,
  EventBus,
  ImageService,
  PreviewController,
  ServerEvent,
  SettingsService,
  SiteRegistry,
  SiteService,
} from "@galley/core/types";
import { createApp } from "../src/app";
import type { AppOptions, Services } from "../src/types";

/**
 * A fake that implements only what a test gives it. Calling anything else
 * throws "<name>.<method> not faked", so a test can't pass by accident.
 */
export function fake<T extends object>(name: string, impl: Partial<T> = {}): T {
  return new Proxy(impl as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      // Keep the proxy from looking like a promise or serialisable value.
      if (typeof prop === "symbol" || prop === "then" || prop === "toJSON") return undefined;
      return () => {
        throw new Error(`${name}.${String(prop)} not faked`);
      };
    },
  });
}

export interface TestBus extends EventBus {
  readonly listenerCount: number;
}

export function createBus(): TestBus {
  const listeners = new Set<(event: ServerEvent) => void>();

  return {
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

export const SITE_ID = "site-1";

export function fakeSite(impl: Partial<SiteService> = {}): SiteService {
  return fake<SiteService>("site", { id: SITE_ID, root: "/tmp/site-1", ...impl });
}

export function fakePreview(impl: Partial<PreviewController> = {}): PreviewController {
  return fake<PreviewController>("preview", impl);
}

export interface ServiceFakes {
  site?: SiteService;
  registry?: Partial<SiteRegistry>;
  agent?: Partial<AgentRuntime>;
  images?: Partial<ImageService>;
  settings?: Partial<SettingsService>;
  events?: EventBus;
}

export function buildServices(fakes: ServiceFakes = {}): Services {
  const site = fakes.site;

  return {
    registry: fake<SiteRegistry>("registry", {
      get: async (id: string) => (site && id === site.id ? site : null),
      ...fakes.registry,
    }),
    agent: fake<AgentRuntime>("agent", fakes.agent),
    images: fake<ImageService>("images", fakes.images),
    settings: fake<SettingsService>("settings", fakes.settings),
    events: fakes.events ?? createBus(),
  };
}

export const TOKEN = "test-token-0123456789abcdef";

export function appOptions(overrides: Partial<AppOptions> = {}): AppOptions {
  return {
    mode: "local",
    token: TOKEN,
    cookieKey: randomBytes(32),
    cookieName: "galley_session_test",
    allowedHosts: [],
    webDir: null,
    brand: { ...DEFAULT_BRAND },
    version: "0.0.0-test",
    desktop: false,
    fsRoot: "/",
    frameSources: ["http://127.0.0.1:*"],
    log: () => {},
    ...overrides,
  };
}

export interface TestApp {
  app: Hono;
  services: Services;
  logs: string[];
  /** Authenticated (Bearer) JSON request. */
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  /** Request with exactly these headers — no auth added. */
  raw(method: string, path: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Response>;
}

export function testApp(fakes: ServiceFakes = {}, overrides: Partial<AppOptions> = {}): TestApp {
  const services = buildServices(fakes);
  const logs: string[] = [];
  const app = createApp(services, appOptions({ log: (line) => logs.push(line), ...overrides }));
  const raw: TestApp["raw"] = (method, path, init = {}) => {
    const headers: Record<string, string> = { ...init.headers };
    let body: string | undefined;

    if (init.body !== undefined) {
      body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
      headers["content-type"] ??= "application/json";
    }
    return Promise.resolve(app.request(path, { method, headers, body }));
  };

  return {
    app,
    services,
    logs,
    raw,
    call: (method, path, body, headers = {}) => raw(method, path, { body, headers: { authorization: `Bearer ${TOKEN}`, ...headers } }),
  };
}

export async function json<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Cookie pairs ("name=value") from a response's Set-Cookie headers. */
export function cookiesOf(response: Response): string[] {
  return response.headers.getSetCookie().map((line) => line.split(";")[0]!);
}
