/**
 * A key's last characters reach only the people who may manage the keys.
 * Every answer that lists keys and that someone without "manage" may read
 * (app settings, the hosts, plugins, the capture settings) goes to an editor
 * or a contributor with every hint taken out — whether each key is set, and
 * where from, stays — and to an owner, the operator's token and local mode
 * as it always was.
 *
 * Against a real install state (real accounts, real cookies); the services
 * behind the routes are fakes that answer with hints, so what is checked is
 * what the server does to the answer on the way out.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiRouteKey } from "@galley/core/api";
import { createPeople, openInstallState, ROUTE_ACCESS, roleMayCall, type Account, type AccountRole, type Install, type InstallStore } from "@galley/core/install";
import type { CaptureSettings } from "@galley/core/api";
import type { DeployTargetInfo, PluginInfo, Settings } from "@galley/core/types";
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signSession } from "../src/auth";
import { HINTED_ROUTES, withoutKeyHints } from "../src/key-hints";
import type { Services } from "../src/types";
import { fake, fakeSite, json, SITE_ID, testApp, TOKEN, type TestApp } from "./helpers";

const PASSWORD = "correct horse battery staple";
const HOST = "https://cms.example.com";
/** The tail every fake key ends in: if it shows up in an answer, a hint got out. */
const TAIL = "WXYZ";
const home = realpathSync(mkdtempSync(join(tmpdir(), "galley-hints-")));
let store: InstallStore;
let hosted: TestApp;
let key: Uint8Array;
const people: Record<AccountRole, Account> = {} as Record<AccountRole, Account>;

const settings = {
  ai: { model: "m", effort: "medium", models: [] },
  appearance: { theme: "system" },
  secrets: [
    { name: "anthropic", configured: true, source: "stored", hint: TAIL },
    { name: "openai", configured: true, source: "env", hint: TAIL },
    { name: "google", configured: false, source: null },
  ],
} as unknown as Settings;

const targets = [
  { id: "cloudflare", name: "Cloudflare Pages", blurb: "b", recommended: true, credentials: [], secrets: [{ name: "cloudflare", configured: true, source: "stored", hint: TAIL }], keySteps: [], keyUrl: "https://example.com" },
] as unknown as DeployTargetInfo[];

const plugin = {
  name: "example-plugin",
  displayName: "Example",
  version: "1.0.0",
  source: "installed",
  enabled: true,
  active: true,
  canDisable: true,
  contributes: {},
  problems: [],
  warnings: [],
  settings: [
    { key: "apiKey", label: "Key", type: "text", secret: true, required: true, configured: true, source: "stored", hint: TAIL },
    { key: "region", label: "Region", type: "text", secret: false, required: false, configured: true, source: "stored", value: "eu" },
  ],
  log: [],
} as unknown as PluginInfo;

const capture = {
  origins: { site: [], extra: [], loopback: false },
  captureKey: { enabled: true, hint: TAIL, createdAt: "2026-11-01T00:00:00.000Z" },
  notify: {},
  mail: { configured: false },
  turnstile: { configured: true, hint: TAIL },
  rateLimits: { perIpPerMinute: 5, perFormPerMinute: 20 },
  forwardSecrets: [],
} as unknown as CaptureSettings;

function withFakes(services: Services): void {
  services.deploy = fake<NonNullable<Services["deploy"]>>("deploy", { targets: async () => structuredClone(targets) });
  services.plugins = fake<NonNullable<Services["plugins"]>>("plugins", { list: async () => [structuredClone(plugin)], conflicts: () => [] });
  services.forms = fake<NonNullable<Services["forms"]>>("forms", { captureSettings: async () => structuredClone(capture) });
}

beforeAll(async () => {
  store = await openInstallState(home);
  const engine = createPeople(store);
  const owner = await engine.createOwner({ password: PASSWORD, name: "Sam Owner", email: "sam@example.com" });

  people.owner = owner;
  for (const role of ["editor", "contributor"] as const) {
    const { link } = await engine.invite(owner.id, { email: `${role}@example.com`, role });

    people[role] = (await engine.useLink(link.code, { password: PASSWORD, name: role })).account;
  }
  const install = fake<Install>("install", { store, people: engine, home, meta: () => ({ singleSite: true, setupNeeded: false, passwordSet: true, siteId: null, signInWith: "email" }) });

  key = randomBytes(32);
  hosted = testApp({ site: fakeSite(), settings: { get: async () => structuredClone(settings) } }, { mode: "hosted", token: TOKEN, install, cookieKey: key, allowedHosts: ["cms.example.com"], publicOrigin: HOST });
  withFakes(hosted.services);
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

function cookieFor(role: AccountRole): string {
  const id = people[role].id;

  return `galley_session_test=${signSession(key, store.nextIssuedAt(Date.now(), id), undefined, id)}`;
}

const PATHS: Partial<Record<ApiRouteKey, string>> = {
  "GET /api/settings": "/api/settings",
  "GET /api/deploy/targets": "/api/deploy/targets",
  "GET /api/plugins": "/api/plugins",
  "GET /api/sites/:siteId/capture": `/api/sites/${SITE_ID}/capture`,
};

async function read(app: TestApp, route: ApiRouteKey, who: AccountRole | "token"): Promise<{ status: number; text: string; body: any }> {
  const response = await app.raw("GET", `${HOST}${PATHS[route]}`, { headers: who === "token" ? { authorization: `Bearer ${TOKEN}` } : { cookie: cookieFor(who) } });
  const text = await response.text();

  return { status: response.status, text, body: JSON.parse(text) };
}

describe("key hints on a hosted install", () => {
  it("every route that strips hints is one a person without \"manage\" may call (the others never reach them)", () => {
    for (const route of HINTED_ROUTES) expect(ROUTE_ACCESS[route] === "edit" || ROUTE_ACCESS[route] === "publish", route).toBe(true);
  });

  it.each(Object.keys(PATHS) as ApiRouteKey[])("%s: the owner and the operator's token see the hints; an editor and a contributor never do", async (route) => {
    for (const who of ["owner", "token"] as const) {
      const answer = await read(hosted, route, who);

      expect(answer.status, answer.text).toBe(200);
      expect(answer.text).toContain(TAIL);
    }
    for (const role of ["editor", "contributor"] as const) {
      const answer = await read(hosted, route, role);

      if (!roleMayCall(role, route)) {
        // The capture settings are the inbox's: a contributor is refused them altogether.
        expect(answer.status).toBe(403);
        continue;
      }
      expect(answer.status, answer.text).toBe(200);
      expect(answer.text).not.toContain(TAIL);
      expect(answer.text).not.toContain('"hint"');
    }
  });

  it("whether a key is set, and where it comes from, still reaches everyone", async () => {
    const settingsAnswer = await read(hosted, "GET /api/settings", "contributor");

    expect(settingsAnswer.body.secrets).toEqual([
      { name: "anthropic", configured: true, source: "stored" },
      { name: "openai", configured: true, source: "env" },
      { name: "google", configured: false, source: null },
    ]);
    expect((await read(hosted, "GET /api/deploy/targets", "contributor")).body.targets[0].secrets).toEqual([{ name: "cloudflare", configured: true, source: "stored" }]);
    const plugins = (await read(hosted, "GET /api/plugins", "editor")).body.plugins as PluginInfo[];

    expect(plugins[0]!.settings).toEqual([
      { key: "apiKey", label: "Key", type: "text", secret: true, required: true, configured: true, source: "stored" },
      { key: "region", label: "Region", type: "text", secret: false, required: false, configured: true, source: "stored", value: "eu" },
    ]);
    const forEditor = (await read(hosted, "GET /api/sites/:siteId/capture", "editor")).body as CaptureSettings;

    expect(forEditor.captureKey).toEqual({ enabled: true, createdAt: "2026-11-01T00:00:00.000Z" });
    expect(forEditor.turnstile).toEqual({ configured: true });
  });

  it("an owner made an editor is told no hint from the very next request", async () => {
    const engine = createPeople(store);
    const { link } = await engine.invite(people.owner.id, { email: "second-owner@example.com", role: "owner" });
    const second = (await engine.useLink(link.code, { password: PASSWORD, name: "Second Owner" })).account;
    const cookie = () => `galley_session_test=${signSession(key, store.nextIssuedAt(Date.now(), second.id), undefined, second.id)}`;
    const ask = async () => (await hosted.raw("GET", `${HOST}/api/settings`, { headers: { cookie: cookie() } })).text();

    expect(await ask()).toContain(TAIL);
    await engine.change(people.owner.id, second.id, { role: "editor" });
    expect(await ask()).not.toContain(TAIL);
  });

  it("a site's own plugins are answered the same way (the same rule, applied to that route)", () => {
    const answer = withoutKeyHints("GET /api/sites/:siteId/plugins", { plugins: [structuredClone(plugin)], conflicts: [] }) as { plugins: PluginInfo[] };

    expect(JSON.stringify(answer)).not.toContain(TAIL);
    expect(answer.plugins[0]!.settings[0]).toMatchObject({ secret: true, configured: true });
  });

  it("local mode has no accounts: the answers are as they were", async () => {
    const local = testApp({ settings: { get: async () => structuredClone(settings) } });

    withFakes(local.services);
    for (const path of ["/api/settings", "/api/deploy/targets", "/api/plugins"]) expect(await (await local.call("GET", path)).text()).toContain(TAIL);
    expect((await json(await local.call("GET", "/api/settings"))).secrets[0]).toEqual({ name: "anthropic", configured: true, source: "stored", hint: TAIL });
  });
});
