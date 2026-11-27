import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import galley, { APP_ID, DEFAULT_URL, INTEGRATION_NAME, PRODUCT_NAME, TOOLBAR_ENTRYPOINT, resolveGalleyUrl } from "../src/index.js";

type Hooks = Record<string, (options: any) => unknown>;
const hooks = (integration: ReturnType<typeof galley>) => integration.hooks as Hooks;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("galley()", () => {
  it("is named after its package, and the toolbar app after the product", () => {
    expect(galley().name).toBe("@galleycms/astro");
    expect(INTEGRATION_NAME).toBe("@galleycms/astro");
    expect(PRODUCT_NAME).toBe("Galley");
  });

  it("adds the toolbar app in `astro dev` only", () => {
    for (const command of ["build", "preview", "sync"]) {
      const addDevToolbarApp = vi.fn();

      hooks(galley())["astro:config:setup"]!({ command, addDevToolbarApp });
      expect(addDevToolbarApp, command).not.toHaveBeenCalled();
    }

    const addDevToolbarApp = vi.fn();

    hooks(galley())["astro:config:setup"]!({ command: "dev", addDevToolbarApp });
    expect(addDevToolbarApp).toHaveBeenCalledTimes(1);
    expect(addDevToolbarApp.mock.calls[0]![0]).toMatchObject({ id: APP_ID, name: PRODUCT_NAME, entrypoint: TOOLBAR_ENTRYPOINT });
    expect(addDevToolbarApp.mock.calls[0]![0].icon).toMatch(/^<svg[^>]*>.*<\/svg>$/);
    expect(existsSync(TOOLBAR_ENTRYPOINT)).toBe(true);
  });

  it("with visibility off, uses no hook that touches a build: no scripts, routes, middleware or Vite build config", () => {
    const used = Object.keys(galley({ visibility: false }).hooks).sort();

    expect(used).toEqual(["astro:config:done", "astro:config:setup", "astro:server:setup"]);
    const calls: string[] = [];
    const record = (name: string) => () => calls.push(name);

    hooks(galley({ visibility: false }))["astro:config:setup"]!({
      command: "build",
      addDevToolbarApp: record("addDevToolbarApp"),
      injectScript: record("injectScript"),
      injectRoute: record("injectRoute"),
      addMiddleware: record("addMiddleware"),
      updateConfig: record("updateConfig"),
    });
    expect(calls).toEqual([]);
  });

  it("with visibility on (the default), adds only a build-done step, a dev-server answer and a look at the site's routes: no routes, scripts or middleware of its own", () => {
    const used = Object.keys(galley().hooks).sort();

    expect(used).toEqual(["astro:build:done", "astro:config:done", "astro:config:setup", "astro:routes:resolved", "astro:server:setup"]);
    const calls: string[] = [];
    const record = (name: string) => () => calls.push(name);

    hooks(galley({ forms: false, scripts: false, mailto: false }))["astro:config:setup"]!({
      command: "build",
      config: { root: pathToFileURL("/nonexistent-site/") },
      addDevToolbarApp: record("addDevToolbarApp"),
      injectScript: record("injectScript"),
      injectRoute: record("injectRoute"),
      addMiddleware: record("addMiddleware"),
      updateConfig: record("updateConfig"),
      addWatchFile: record("addWatchFile"),
    });
    expect(calls).toEqual(["addWatchFile"]);
  });

  it("mounts the status route on the dev server with the project's root and base", async () => {
    const use = vi.fn();
    const integration = galley({ url: "http://127.0.0.1:4999" });

    hooks(integration)["astro:config:done"]!({ config: { root: pathToFileURL("/projects/studio/"), base: "/docs" } });
    hooks(integration)["astro:server:setup"]!({ server: { middlewares: { use } } });
    // The status route first, then the agent-readable answers (docs/ai-first-output.md).
    expect(use).toHaveBeenCalledTimes(2);

    const middleware = use.mock.calls[0]![0] as (req: unknown, res: unknown, next: () => void) => void;
    const next = vi.fn();

    middleware({ url: "/about/", method: "GET" }, {}, next);
    expect(next).toHaveBeenCalledTimes(1);

    const sent = await new Promise<{ status: number; body: string }>((done) => {
      const res = { statusCode: 0, setHeader() {}, end(body: string) { done({ status: res.statusCode, body }); } };
      middleware({ url: "/docs/__galley/status", method: "GET" }, res, next);
    });

    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body)).toEqual({ running: false, url: "http://127.0.0.1:4999", root: "/projects/studio" });
  });
});

describe("resolveGalleyUrl()", () => {
  it("takes the option, then GALLEY_URL, then the default", () => {
    expect(resolveGalleyUrl({}, {})).toBe(DEFAULT_URL);
    expect(resolveGalleyUrl({}, { GALLEY_URL: "http://localhost:4401/" })).toBe("http://localhost:4401");
    expect(resolveGalleyUrl({ url: "https://cms.example.com/galley/" }, { GALLEY_URL: "http://localhost:4401" })).toBe("https://cms.example.com/galley");
  });

  it("reads GALLEY_URL from the environment by default", () => {
    vi.stubEnv("GALLEY_URL", "http://127.0.0.1:4410");
    expect(resolveGalleyUrl()).toBe("http://127.0.0.1:4410");
  });

  it("refuses an address that isn't http(s), saying what to set", () => {
    expect(() => resolveGalleyUrl({ url: "not a url" }, {})).toThrow(/isn't a web address\. Set `url` \(or GALLEY_URL\)/);
    expect(() => resolveGalleyUrl({ url: "ftp://example.com" }, {})).toThrow(/must start with http:\/\/ or https:\/\//);
  });
});
