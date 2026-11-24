/**
 * What the engine records in the site's settings file inside actions people
 * below the settings level may start — an editor's production deploy notes
 * the live address, a contributor's first save of the redirects list gives
 * the list its place, the redirects screen says where they apply — goes
 * through the engine's own path: only that record's keys change, the rest of
 * the file stays byte for byte, and no other key (the commands this server
 * runs, the publish branch, build mode) can be set through it. And saving
 * the site's brand, per role: content where the brand folder is content,
 * build mode (and its level) where it isn't.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createDeployService } from "../../src/deploy/index";
import { GalleyError } from "../../src/errors";
import { roleMay, type AccountRole } from "../../src/install/accounts";
import { BUILD_MODE_REFUSAL, SITE_SETTINGS_REFUSAL, withCaller } from "../../src/install/caller";
import { ROLE_REFUSAL } from "../../src/install/route-access";
import { createRedirectsService, type RedirectsService } from "../../src/redirects/index";
import { createEventBus } from "../../src/site/index";
import { recordSettings, type SettingsRecord } from "../../src/site/settings-records";
import { writeBrandFiles } from "../../src/sitebrand/files";
import type { Settings } from "../../src/types";
import { disposeAll, openSite } from "../site/helpers";
import { cleanupAll, sh, tempDir, writeTree } from "../workspace/helpers";
import { startFakeCloudflare, type FakeCloudflare } from "../deploy/fakes/cloudflare";

const ACCOUNT = "acc0123456789abcdef0123456789abc";
/** Odd spacing on purpose: the engine's bookkeeping must leave every line it doesn't own byte for byte. */
const LINES = ['  "build":   { "command": "node build.mjs",   "outDir": "dist" },', '  "dev":     { "command": "node dev.mjs" },', '  "publish": { "branch": "main",  "push": false },', '  "ai":      { "allowBuild": false },'];
const CONFIG = `{\n${LINES.join("\n")}\n  "name": "Lowfield Studio",\n  "collections": [{ "id": "pages", "path": "content", "format": "markdown" }, { "id": "site", "kind": "data", "path": "settings/site.json" }]\n}\n`;
const BUILD = `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", "<h1>Home</h1>");
`;

type Who = AccountRole | null;
const as = <T>(who: Who, run: () => T): T => (who === null ? run() : withCaller({ accountId: `${who}-1`, role: who }, run));
const services: RedirectsService[] = [];
let cloudflare: FakeCloudflare | null = null;

afterEach(async () => {
  while (services.length) services.pop()!.dispose();
  await disposeAll();
});
afterAll(async () => {
  await cloudflare?.close();
  cleanupAll();
});

function tinySite(): string {
  const root = tempDir("records-site-");

  writeTree(root, { "galley.config.json": CONFIG, "build.mjs": BUILD, ".gitignore": "dist/\n", "content/about.md": "---\ntitle: About us\n---\nWho we are.\n", "settings/site.json": "{}\n" });
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "First version");
  return root;
}

async function refusalOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof GalleyError && (error.code === "forbidden" || error.code === "invalid")) return error.message;
    throw error;
  }
}

/** The file with every line it had still there, in order, apart from the one block that may change. */
function expectOnlyChanged(before: string, after: string, block: string): void {
  const kept = (text: string) => JSON.stringify({ ...JSON.parse(text), [block]: undefined });

  expect(kept(after)).toBe(kept(before));
  for (const line of LINES) expect(after.split("\n")).toContain(line);
}

describe("the engine's bookkeeping in the settings file", () => {
  it("an editor's production deploy records the live address, and nothing else in the file moves", async () => {
    cloudflare ??= await startFakeCloudflare({ echoAuth: true });
    const root = tinySite();
    const bus = createEventBus();
    const deploy = createDeployService({
      home: tempDir("records-home-"),
      settings: { readSecret: async (name) => (name === "cloudflare" ? cloudflare!.token : null), get: async () => ({ author: { name: "Test Editor", email: "editor@example.com" } }) as Settings, setSecret: async (name) => ({ name, configured: true, source: "stored" }) },
      events: bus,
      apiBase: { cloudflare: cloudflare.api },
      env: {},
    });
    const { site: open } = await openSite(root, { events: bus });
    // Handed out the way the server hands sites out: through a wrapper that binds every method (plugins' hooks).
    const site = new Proxy(open, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;

        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });

    await as("owner", () => deploy.configure(site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" }));
    const before = readFileSync(join(root, "galley.config.json"), "utf8");
    const deployment = await as("editor", () => deploy.run(site, { kind: "production" }));
    const after = readFileSync(join(root, "galley.config.json"), "utf8");

    expect(deployment.url).toBe("https://lowfield-studio.studio.workers.dev");
    expect(JSON.parse(after).deploy).toMatchObject({ target: "cloudflare", account: ACCOUNT, project: "lowfield-studio", productionUrl: deployment.url, defaultUrl: deployment.url });
    expectOnlyChanged(before, after, "deploy");
    // Setting up where it goes stays an owner's.
    expect(await as("editor", () => refusalOf(deploy.configure(site, { target: "cloudflare", account: ACCOUNT, project: "elsewhere" })))).toBe(SITE_SETTINGS_REFUSAL);
    // The record is a deploy's: below its level it is refused.
    expect(await as("contributor", () => refusalOf(recordSettings(site, { kind: "deploy-address", defaultUrl: "https://example.com" })))).toBe(ROLE_REFUSAL);
  });

  it("a contributor's first save of the redirects list gives the list its place; where the redirects apply is an owner's to say", async () => {
    // A site with no settings file yet: the list's place is the first thing in it.
    const root = tempDir("records-plain-");

    writeTree(root, { "src/content/pages/about.md": "---\ntitle: About us\n---\nWho we are.\n" });
    sh(root, "init", "-q", "-b", "main");
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "First version");
    const bus = createEventBus();
    const { site } = await openSite(root, { events: bus });
    const redirects = createRedirectsService({ home: tempDir("records-redirects-"), events: bus, registry: { get: async (id) => (id === site.id ? site : null) }, settings: { readSecret: async () => null, get: async () => ({}) as Settings } });

    services.push(redirects);
    const saved = await as("contributor", () => redirects.save(site, { redirects: [{ from: "/old-about/", to: "/about/", status: 301 }], baseHash: null }));
    const first = readFileSync(join(root, "galley.config.json"), "utf8");
    const { $schema: _schema, ...settings } = JSON.parse(first) as Record<string, unknown>;

    expect(saved.redirects).toHaveLength(1);
    expect(settings).toEqual({ redirects: { file: "src/data/redirects.json" } });
    // Where they take effect is part of the site's settings: refused below an owner, and nothing is written.
    for (const who of ["contributor", "editor"] as const) expect(await as(who, () => refusalOf(redirects.configure(site, { host: "netlify" })))).toBe(ROLE_REFUSAL);
    expect(readFileSync(join(root, "galley.config.json"), "utf8")).toBe(first);
    await as("owner", () => redirects.configure(site, { host: "netlify" }));
    const configured = readFileSync(join(root, "galley.config.json"), "utf8");

    expect(JSON.parse(configured).redirects).toEqual({ file: "src/data/redirects.json", host: "netlify" });
    // Every line that was there is still there, but for the one that gained a neighbour.
    for (const line of first.split("\n").filter((line) => !line.includes('"file"'))) expect(configured.split("\n")).toContain(line);
  });

  it("no other key can be set through it, whatever is sent beside a record", async () => {
    const root = tinySite();
    const { site } = await openSite(root);
    const before = readFileSync(join(root, "galley.config.json"), "utf8");
    const smuggled = { dev: { command: "node other.mjs" }, publish: { branch: "elsewhere", push: true }, ai: { allowBuild: true }, writable: { content: ["**/*"] }, build: { command: "node other.mjs" } };
    const records = [
      { kind: "redirects-list", ...smuggled, redirects: { file: "package.json" } },
      { kind: "redirects-host", host: "netlify", ...smuggled, file: "package.json" },
    ] as unknown as SettingsRecord[];

    // Each record at the lowest level that may make it: the list's place by a contributor, where it applies by an owner.
    await as("contributor", () => recordSettings(site, records[0]!));
    expect(await as("contributor", () => refusalOf(recordSettings(site, records[1]!)))).toBe(ROLE_REFUSAL);
    await as("owner", () => recordSettings(site, records[1]!));
    const after = readFileSync(join(root, "galley.config.json"), "utf8");

    expect(JSON.parse(after).redirects).toEqual({ file: "settings/redirects.json", host: "netlify" });
    expectOnlyChanged(before, after, "redirects");
    // A kind of record the engine doesn't keep is refused outright.
    expect(await as("owner", () => refusalOf(recordSettings(site, { kind: "dev-command", command: "node other.mjs" } as unknown as SettingsRecord)))).toBe("That isn't something the engine records in the site's settings.");
    expect(readFileSync(join(root, "galley.config.json"), "utf8")).toBe(after);
  });
});

describe("saving the site's brand", () => {
  it("is content where the brand folder is content; elsewhere it is build mode, refused without its level and with nothing half-saved", async () => {
    for (const who of ["owner", "editor", "contributor", null] as Who[]) {
      const root = tinySite();

      // Build mode on, so the brand folder can be written at all outside the content.
      writeTree(root, { "galley.config.json": CONFIG.replace('"allowBuild": false', '"allowBuild": true') });
      sh(root, "commit", "-q", "-am", "Build mode on");
      const { site } = await openSite(root);
      const inContent = await as(who, () => refusalOf(writeBrandFiles(site, [{ path: "content/brand-notes.md", content: "---\ntitle: Brand\n---\n" }])));
      const outside = await as(who, () => refusalOf(writeBrandFiles(site, [{ path: "content/also.md", content: "---\ntitle: Also\n---\n" }, { path: "galley/brand/brand.json", content: "{}\n" }])));

      expect(inContent, String(who)).toBeNull();
      expect(outside, String(who)).toBe(who === null || roleMay(who, "publish") ? null : BUILD_MODE_REFUSAL);
      if (outside) expect(await site.listFiles({ glob: "content/also.md" })).toEqual([]);
    }
  });
});
