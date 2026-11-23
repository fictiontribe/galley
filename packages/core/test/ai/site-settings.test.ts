/**
 * Per-site connections: a site's own keys and author, resolved site → environment →
 * shared, stored with the same care as the shared ones, and never handed out.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSettingsService } from "../../src/ai/index";
import { createEventBus, createSiteRegistry, withSiteScope, type GalleySiteRegistry } from "../../src/site/index";
import { cleanupAll, makeSite } from "../site/helpers";
import { cleanEnv, tempDir } from "./helpers/env";

const SHARED = "sk-ant-api03-sharedsharedsharedshared0000SHRD";
const OWN = "sk-ant-api03-ownownownownownownownown0000OWN1";
const FROM_ENV = "sk-ant-api03-environmentenvironment0000ENVK";
const SITE = "a1b2c3d4e5f6";
const OTHER = "0f0e0d0c0b0a";

const registries: GalleySiteRegistry[] = [];

afterEach(async () => {
  while (registries.length) await registries.pop()?.dispose();
  cleanupAll();
});

describe("a site's own keys", () => {
  it("resolve in the documented order: the site's own, then the environment, then the shared key", async () => {
    const home = tempDir();
    const shared = createSettingsService({ home, env: cleanEnv() });

    await shared.setSecret("anthropic", SHARED);
    expect(await shared.readSecret("anthropic", { siteId: SITE })).toBe(SHARED);
    await shared.setSiteSecret!(SITE, "anthropic", OWN);
    expect(await shared.readSecret("anthropic", { siteId: SITE })).toBe(OWN);
    expect(await shared.readSecret("anthropic", { siteId: OTHER })).toBe(SHARED);
    expect(await shared.readSecret("anthropic")).toBe(SHARED);

    // The environment beats the shared key, but not a site's own.
    const withEnv = createSettingsService({ home, env: cleanEnv({ ANTHROPIC_API_KEY: FROM_ENV }) });

    expect(await withEnv.readSecret("anthropic")).toBe(FROM_ENV);
    expect(await withEnv.readSecret("anthropic", { siteId: OTHER })).toBe(FROM_ENV);
    expect(await withEnv.readSecret("anthropic", { siteId: SITE })).toBe(OWN);
    // The shared key can't be changed under an environment key; a site's own can.
    await expect(withEnv.setSecret("anthropic", SHARED)).rejects.toThrow(/environment/);
    const connections = await withEnv.setSiteSecret!(OTHER, "anthropic", OWN);

    expect(connections.secrets.find((secret) => secret.name === "anthropic")).toEqual({
      name: "anthropic",
      inUse: "site",
      hint: "OWN1",
      site: { configured: true, hint: "OWN1" },
      shared: { configured: true, source: "env", hint: "ENVK" },
    });
  });

  it("are used for the site whose request is being served, without the caller passing an id", async () => {
    const settings = createSettingsService({ home: tempDir(), env: cleanEnv() });

    await settings.setSecret("openai", "sk-proj-sharedsharedshared00SHRD");
    await settings.setSiteSecret!(SITE, "openai", "sk-proj-ownownownownownown0OWN2");
    // Every caller written before keys were per site: the assistant, images, deploy.
    expect(await withSiteScope(SITE, () => settings.readSecret("openai"))).toBe("sk-proj-ownownownownownown0OWN2");
    expect(await withSiteScope(OTHER, () => settings.readSecret("openai"))).toBe("sk-proj-sharedsharedshared00SHRD");
    // A turn that outlives its request keeps the request's site.
    const later = withSiteScope(SITE, () => new Promise<string | null>((resolve) => setTimeout(() => void settings.readSecret("openai").then(resolve), 20)));

    expect(await later).toBe("sk-proj-ownownownownownown0OWN2");
    expect((await withSiteScope(SITE, () => settings.get())).secrets.find((secret) => secret.name === "openai")).toEqual({
      name: "openai",
      configured: true,
      source: "stored",
      hint: "OWN2",
    });
    expect((await settings.get()).secrets.find((secret) => secret.name === "openai")?.hint).toBe("SHRD");
  });

  it("are kept like the shared keys — 0600 in a 0700 folder — never shown, and forgotten with the site", async () => {
    const home = tempDir();
    const settings = createSettingsService({ home, env: cleanEnv() });

    await settings.setSiteSecret!(SITE, "cloudflare", "cfcfcfcfcfcfcfcfcfcfcfcfcfcfcfcfcfcf");
    await settings.setSiteSecret!(SITE, "vercel", "vcvcvcvcvcvcvcvcvcvcvcvcLAST");
    const file = join(home, "state", SITE, "secrets.json");

    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "state", SITE)).mode & 0o777).toBe(0o700);
    const shown = JSON.stringify(await settings.siteConnections!(SITE));

    expect(shown).not.toContain("cfcfcfcfcfcf");
    expect(shown).not.toContain("vcvcvcvcvcvc");
    expect(shown).toContain("LAST");
    await expect(settings.setSiteSecret!(SITE, "anthropic", "not a key")).rejects.toThrow(/doesn't look like/);
    await expect(settings.setSiteSecret!("../escape", "anthropic", OWN)).rejects.toThrow(/isn't in the list/);
    await settings.setSiteSecret!(SITE, "vercel", null);
    expect((await settings.siteConnections!(SITE)).secrets.find((secret) => secret.name === "vercel")?.inUse).toBeNull();
    // Another file in the site's state folder (its deploy records) is left alone.
    writeFileSync(join(home, "state", SITE, "deployments.jsonl"), "");
    await settings.forgetSite!(SITE);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(home, "state", SITE, "deployments.jsonl"))).toBe(true);
    expect(await settings.readSecret("cloudflare", { siteId: SITE })).toBeNull();
  });

  it("let a site name its own publishing author, and count its own assistant use", async () => {
    const home = tempDir();
    const settings = createSettingsService({ home, env: cleanEnv() });

    expect((await settings.get({ siteId: SITE })).author).toEqual({ name: "Test Editor", email: "editor@example.com" });
    await settings.setSiteAuthor!(SITE, { name: "  Client Writer ", email: "writer@client.example" });
    expect((await settings.get({ siteId: SITE })).author).toEqual({ name: "Client Writer", email: "writer@client.example" });
    expect((await settings.get({ siteId: OTHER })).author.name).toBe("Test Editor");
    expect((await settings.siteConnections!(SITE)).author).toEqual({ name: "Client Writer", email: "writer@client.example", inUse: "site", site: { name: "Client Writer", email: "writer@client.example" } });
    await expect(settings.setSiteAuthor!(SITE, { name: "X", email: "nope" })).rejects.toThrow(/email address/);
    await settings.setSiteAuthor!(SITE, null);
    expect((await settings.siteConnections!(SITE)).author.inUse).toBe("shared");

    const at = Date.now();
    const turn = { model: "claude-opus-5-5", requests: 2, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.25 };

    await settings.recordUsage({ ...turn, siteId: SITE, at });
    await settings.recordUsage({ ...turn, siteId: SITE, at, cost: 0.5 });
    await settings.recordUsage({ ...turn, siteId: OTHER, at: at - 40 * 86_400_000 });
    expect((await settings.usage({ siteId: SITE })).last30).toMatchObject({ turns: 2, cost: 0.75 });
    expect((await settings.usage()).allTime.turns).toBe(3);
    const bySite = await settings.usageBySite!();

    expect(bySite.find((entry) => entry.siteId === SITE)?.last30.cost).toBe(0.75);
    expect(bySite.find((entry) => entry.siteId === OTHER)).toMatchObject({ last30: { turns: 0 }, allTime: { turns: 1 } });
  });
});

describe("publishing from two sites", { timeout: 120_000 }, () => {
  it("records each site's own author on its versions", async () => {
    const home = tempDir();
    const settings = createSettingsService({ home, env: cleanEnv() });
    const registry = await createSiteRegistry({
      home,
      sitesDir: join(home, "Sites"),
      startersDir: join(home, "none"),
      events: createEventBus(),
      overlayScript: () => "",
      settings,
      previewPolicy: false,
    });

    registries.push(registry);
    const [first, second] = await Promise.all([makeSite(), makeSite()].map((root) => registry.open({ path: root })));

    await settings.update({ author: { name: "Agency Editor", email: "editor@agency.example" } });
    await settings.setSiteAuthor!(first!.id, { name: "Client One Writer", email: "writer@one.example" });
    for (const site of [first!, second!]) {
      const path = "src/content/pages/index.md";

      writeFileSync(join(site.root, path), `${readFileSync(join(site.root, path), "utf8")}\nA new line.\n`);
      expect((await site.publish({ message: "Add a line" })).ok).toBe(true);
    }
    const authorOf = (root: string) => execFileSync("git", ["log", "-1", "--format=%an <%ae>"], { cwd: root, encoding: "utf8" }).trim();

    expect(authorOf(first!.root)).toBe("Client One Writer <writer@one.example>");
    expect(authorOf(second!.root)).toBe("Agency Editor <editor@agency.example>");
  });
});
