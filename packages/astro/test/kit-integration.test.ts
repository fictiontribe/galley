// The integration's forms and scripts parts, hook by hook, against real site
// folders in a temporary directory; and the vendoring script.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import galley, { SCRIPTS_MIDDLEWARE } from "../src/index.js";
// @ts-ignore — a plain .mjs script
import { snapshot, vendor, vendoredFiles } from "../scripts/vendor.mjs";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function site(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "galley-kit-"));

  dirs.push(root);
  writeFileSync(join(root, "package.json"), "{}");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

type Hooks = Record<string, (options: any) => unknown>;

function setup(root: string, options: Parameters<typeof galley>[0] = {}, command = "build") {
  const calls = { updateConfig: [] as any[], addMiddleware: [] as any[], addWatchFile: [] as any[], info: [] as string[] };
  const integration = galley(options);

  (integration.hooks as Hooks)["astro:config:setup"]!({
    command,
    config: { root: pathToFileURL(`${root}/`) },
    addDevToolbarApp: vi.fn(),
    updateConfig: (value: unknown) => calls.updateConfig.push(value),
    addMiddleware: (value: unknown) => calls.addMiddleware.push(value),
    addWatchFile: (value: unknown) => calls.addWatchFile.push(value),
    logger: { info: (line: string) => calls.info.push(line), warn: vi.fn() },
  });
  return { calls, integration };
}

const SCRIPTS = JSON.stringify({ consent: { mode: "banner", googleConsentMode: true }, scripts: [{ id: "gtm", kind: "gtm", enabled: true, settings: { containerId: "GTM-AB12CDE3" } }] });

describe("galley(): forms and scripts", () => {
  it("with neither a scripts file nor UTM forms (and mailto off): no middleware, only the components' settings module", () => {
    const { calls } = setup(site({}), { mailto: false });

    expect(calls.addMiddleware).toEqual([]);
    expect(calls.updateConfig).toHaveLength(1);
    expect(calls.updateConfig[0].vite.plugins[0].name).toBe("galley-kit-config");
    expect(calls.info).toEqual([]);
  });

  it("with a scripts file: adds the middleware, watches the file and logs what loads", async () => {
    const root = site({ "src/data/scripts.json": SCRIPTS });
    const { calls } = setup(root);

    expect(calls.addMiddleware).toEqual([{ order: "pre", entrypoint: SCRIPTS_MIDDLEWARE }]);
    expect(calls.addWatchFile).toContain(join(root, "src/data/scripts.json"));
    expect(calls.info[0]).toBe("scripts: 1 of 1 enabled · the built-in consent banner · Google Consent Mode v2");
    const plugin = calls.updateConfig[0].vite.plugins[0];
    const id = plugin.resolveId("virtual:galley-kit/config");
    const source: string = plugin.load(id);

    expect(source).toContain('"consent":{"mode":"banner","googleConsentMode":true}');
    expect(source).toContain('export const options = {"collection":"forms","endpoint":"","allowFormScripts":false,"messages":{},"freeEmailDomains":[]};');
  });

  it("with a form that uses UTM memory: the middleware runs even without a scripts file", () => {
    const root = site({ "src/content/forms/contact.json": JSON.stringify({ fields: [{ id: "s", type: "hidden", autofill: { from: "utm", key: "utm_source" } }] }) });
    const { calls } = setup(root);

    expect(calls.addMiddleware).toHaveLength(1);
    expect(calls.updateConfig[0].vite.plugins[0].load("\0virtual:galley-kit/config")).toContain("export const utm = true;");
  });

  it("passes the forms options to the components", () => {
    const { calls } = setup(site({}), { forms: { endpoint: "https://capture.example.test/f/1", allowFormScripts: true, messages: { required: "Required." } } });

    expect(calls.updateConfig[0].vite.plugins[0].load("\0virtual:galley-kit/config")).toContain('"endpoint":"https://capture.example.test/f/1","allowFormScripts":true,"messages":{"required":"Required."}');
  });

  it("refuses a broken scripts file with a message that says where and what", () => {
    expect(() => setup(site({ "src/data/scripts.json": "{ nope" }))).toThrow(/^@galley\/astro: src\/data\/scripts\.json can't be read as JSON/);
    expect(() => setup(site({ "src/data/scripts.json": JSON.stringify({ scripts: [{ id: "gtm", kind: "gtm", enabled: true, settings: { containerId: "GTM-1" } }] }) }))).toThrow(
      "@galley/astro: src/data/scripts.json has a problem:\n  - scripts[0].settings.containerId: “GTM-1” doesn't look like a Google Tag Manager Container ID (it looks like GTM-XXXXXXX).",
    );
  });

  it("each part can be switched off", () => {
    const root = site({ "src/data/scripts.json": SCRIPTS });

    expect(setup(root, { scripts: false, mailto: false }).calls.addMiddleware).toEqual([]);
    expect(setup(root, { scripts: { inject: false }, mailto: false }).calls.addMiddleware).toEqual([]);
    expect(setup(root, { scripts: false, forms: false, mailto: false }).calls.updateConfig).toEqual([]);
    // The email-link dialog alone still needs the middleware (it is on by default).
    expect(setup(root, { scripts: false }).calls.addMiddleware).toEqual([{ order: "pre", entrypoint: SCRIPTS_MIDDLEWARE }]);
    expect(setup(root, { scripts: false }).calls.updateConfig[0].vite.plugins[0].load("\0virtual:galley-kit/config")).toContain('export const mailto = {"options":["gmail","outlook","app","copy"]');
  });

  it("answers /__galley/scripts.json in astro dev with what a page loads", async () => {
    const root = site({ "src/data/scripts.json": SCRIPTS });
    const integration = galley({});
    const hooks = integration.hooks as Hooks;
    const use = vi.fn();

    hooks["astro:config:done"]!({ config: { root: pathToFileURL(`${root}/`), base: "/" } });
    hooks["astro:server:setup"]!({ server: { middlewares: { use } } });
    const middleware = use.mock.calls[0]![0];
    const sent = await new Promise<{ status: number; body: string }>((done) => {
      const res = { statusCode: 0, setHeader() {}, end(body: string) { done({ status: res.statusCode, body }); } };

      middleware({ url: "/__galley/scripts.json?path=/pricing/", method: "GET" }, res, () => done({ status: 404, body: "" }));
    });

    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body)).toMatchObject({ file: "src/data/scripts.json", exists: true, path: "/pricing/", scripts: [{ id: "gtm", loadsOnPage: true, inDev: false, reason: "loads after analytics consent" }] });
  });
});

describe("scripts/vendor.mjs", () => {
  it("copies the kit into src/galley as plain files, byte-stable, each saying which kit version it came from", () => {
    const root = site({});
    const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

    vendor(root);
    const first = snapshot(join(root, "src/galley"));

    vendor(root);
    expect(snapshot(join(root, "src/galley"))).toEqual(first);
    expect(Object.keys(first)).toContain("components/Form.astro");
    expect(Object.keys(first)).toContain("client/providers/marketo.js");
    expect(Object.keys(first)).toContain("settings.json");
    expect(Object.keys(first)).not.toContain("index.js");
    expect(first["components/Form.astro"]!.startsWith(`---\n// Vendored from @galley/astro ${version} by scripts/vendor.mjs.`)).toBe(true);
    expect(first["forms/forms.css"]!.startsWith(`/* Vendored from @galley/astro ${version}`)).toBe(true);
    for (const [file, text] of Object.entries(first)) if (file !== "settings.json") expect(text, file).toContain(`@galley/astro ${version}`);
    // Nothing points back at the package or the integration's virtual module.
    expect(Object.values(first).join("\n")).not.toMatch(/^(import|export)[^\n]*(virtual:galley-kit|"@galley\/)/m);
  });

  it("the browser runtime reports the package's version", () => {
    const source = readFileSync(new URL("../src/client/forms.js", import.meta.url), "utf8");
    const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

    expect(source).toContain(`export const KIT_VERSION = "${version}";`);
  });

  it("keeps the site's settings and removes kit files the kit no longer has", () => {
    const root = site({ "src/galley/settings.json": '{ "forms": { "endpoint": "https://c.example/f" } }\n', "src/galley/old.js": "stale" });

    vendor(root);
    expect(readFileSync(join(root, "src/galley/settings.json"), "utf8")).toBe('{ "forms": { "endpoint": "https://c.example/f" } }\n');
    expect(Object.keys(snapshot(join(root, "src/galley")))).not.toContain("old.js");
    expect(Object.keys(vendoredFiles())).toContain("runtime/site-config.js");
  });
});
