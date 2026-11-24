/**
 * A hosted install's rule for guarded work (install/caller.ts): with the
 * switch a hosted server sets at start, publishing, the site's other guarded
 * methods, the settings file and build mode need someone — a person, the
 * operator's mark or the engine's mark. Work done for nobody is refused,
 * whatever handle to the site it holds; a plugin reacting to an event runs
 * as nobody. Without the switch (local mode, the desktop app) nothing
 * changes. Against real sites in real temporary repositories.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCT } from "../../src/brand";
import { GalleyError } from "../../src/errors";
import { createFileSecretStore, createSettingsService } from "../../src/ai/index";
import { asEngine, asOperator, NO_CALLER_REFUSAL, outsideAnyPerson, requireCallerForGuardedWork, SITE_SETTINGS_REFUSAL, withCaller } from "../../src/install/caller";
import { ROLE_REFUSAL, SITE_METHOD_ACCESS, type GuardedSiteMethod } from "../../src/install/route-access";
import { createPluginRegistry, createPluginSettingsStore, definePlugin, PLUGIN_API_VERSION } from "../../src/plugins/index";
import { formCodeRefusal } from "../../src/site-kit/guard";
import { recordSettings } from "../../src/site/settings-records";
import type { GalleyConfig, SiteService } from "../../src/types";
import { cleanupAll, disposeAll, makeSite, openSite, tempDir } from "../site/helpers";

afterEach(async () => {
  requireCallerForGuardedWork(false);
  await disposeAll();
  cleanupAll();
});

const CONFIG = PRODUCT.configFile;
const owner = { accountId: "owner-1", role: "owner" as const };

async function refusalOf(work: () => unknown): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (error) {
    if (error instanceof GalleyError && error.code === "forbidden") return error.message;
    throw error;
  }
}

/** Every guarded write, each on a site of its own (a write that goes through changes what the next one finds). */
const WRITES: Record<string, (site: SiteService, config: GalleyConfig) => Promise<unknown>> = {
  "saving the settings": (site, config) => site.saveConfig({ ...config, name: "Changed" }),
  "the engine's bookkeeping in the settings": (site) => recordSettings(site, { kind: "redirects-list" }),
  "deleting the settings file": (site) => site.deleteFile(CONFIG, { origin: "user", mode: "build" }),
  "a write in build mode": (site) => site.writeFile("src/components/Note.astro", "<p>Note</p>\n", { origin: "user", mode: "build" }),
  "an entry edit in build mode": (site) => site.updateEntry("src/content/pages/about.md", [{ op: "set", path: ["title"], value: "About" }], { origin: "user", mode: "build" }),
  "a new entry in build mode": (site) => site.createEntry({ collection: "blog", slug: "a-new-post", data: { title: "A new post" } }, { origin: "user", mode: "build" }),
  "the site's build in build mode": (site) => site.build({ mode: "build" }),
};

describe("on a hosted install, guarded work needs someone", () => {
  it("each guarded method, called outside any scope, is refused in plain words; inside the operator's or the engine's mark it runs", async () => {
    const { site } = await openSite(makeSite());

    requireCallerForGuardedWork(true);
    for (const method of Object.keys(SITE_METHOD_ACCESS) as GuardedSiteMethod[]) {
      const call = () => (site[method] as (...args: unknown[]) => Promise<unknown>).call(site, ...(method === "revert" ? ["0000000"] : []));

      expect(await refusalOf(call), method).toBe(NO_CALLER_REFUSAL);
      // Inside a mark it goes ahead: whatever it then says (nothing to publish, no remote), it isn't a refusal for want of someone.
      for (const mark of [asOperator, asEngine]) {
        const message = await mark(call).then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error))
        );

        expect(message, `${method} ${mark.name}`).not.toBe(NO_CALLER_REFUSAL);
      }
    }
  });

  it("each guarded write, called outside any scope, is refused and changes nothing; inside either mark, or for an owner, it is written", async () => {
    for (const [what, write] of Object.entries(WRITES)) {
      for (const who of ["nobody", "operator", "engine", "owner"] as const) {
        requireCallerForGuardedWork(false);
        const { site } = await openSite(makeSite());
        const config = (await site.readConfig()) as GalleyConfig;
        const before = await site.changes();

        requireCallerForGuardedWork(true);
        const run = () => write(site, config);
        const refused = await refusalOf(() => (who === "nobody" ? run() : who === "operator" ? asOperator(run) : who === "engine" ? asEngine(run) : withCaller(owner, run)));

        if (who === "nobody") {
          expect(refused, what).toBe(NO_CALLER_REFUSAL);
          expect((await site.changes()).files, what).toEqual(before.files);
        } else {
          expect(refused, `${what}: ${who}`).toBeNull();
        }
        await disposeAll();
      }
    }
  }, 120_000);

  it("custom code in a form, and discarding a waiting change to the settings, need someone too", async () => {
    const form = (code: string) => JSON.stringify({ title: "Contact", afterSubmit: [{ type: "script", code }] });

    requireCallerForGuardedWork(true);
    expect(formCodeRefusal(null, form("track()"), { origin: "user", allowBuild: true })).toBe(NO_CALLER_REFUSAL);
    expect(asOperator(() => formCodeRefusal(null, form("track()"), { origin: "user", allowBuild: true }))).toBeNull();
    const { site } = await openSite(makeSite());
    const config = (await site.readConfig()) as GalleyConfig;

    await withCaller(owner, () => site.saveConfig({ ...config, name: "Owner's name" }));
    expect(await refusalOf(() => site.discard([CONFIG]))).toBe(NO_CALLER_REFUSAL);
    expect(readFileSync(join(site.root, CONFIG), "utf8")).toContain("Owner's name");
    expect(await refusalOf(() => asEngine(() => site.discard([CONFIG])))).toBeNull();
  });

  it("a person's work is held to their role exactly as before, and what it starts keeps that person; work made as nobody inside it is nobody's", async () => {
    const { site } = await openSite(makeSite());
    const config = (await site.readConfig()) as GalleyConfig;

    requireCallerForGuardedWork(true);
    expect(await withCaller({ accountId: "c-1", role: "contributor" }, () => refusalOf(() => site.saveConfig({ ...config, name: "x" })))).toBe(SITE_SETTINGS_REFUSAL);
    expect(await withCaller({ accountId: "c-1", role: "contributor" }, () => refusalOf(() => site.publish({})))).toBe(ROLE_REFUSAL);
    const later = await new Promise<Promise<string | null>>((resolve) => {
      withCaller(owner, () => setTimeout(() => resolve(refusalOf(() => site.saveConfig({ ...config, name: "Later" }))), 5));
    });

    expect(await later).toBeNull();
    expect(await withCaller(owner, () => outsideAnyPerson(() => refusalOf(() => site.saveConfig({ ...config, name: "Nobody's" }))))).toBe(NO_CALLER_REFUSAL);
  });

  it("a plugin's callback, fired by an event after the request that set it up has ended, can't publish, write the settings file or write in build mode", async () => {
    const home = tempDir("caller-plugins-");
    const secrets = createFileSecretStore(home);
    const settings = createSettingsService({ home, env: {}, secretStore: secrets });
    const registry = createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env: {}, secrets, setBuiltinSecret: (name, value) => settings.setSecret(name, value) }), hookTimeoutMs: { before: 2_000, after: 5_000, setup: 2_000 } });
    const { site } = await openSite(makeSite());
    const config = (await site.readConfig()) as GalleyConfig;
    const tried: Record<string, string | null> = {};
    // A plugin that keeps hold of the full site it was somehow given, and reaches for it from every hook.
    const attempts = async (when: string) => {
      tried[`${when}: publish`] = await refusalOf(() => site.publish({ message: "From a plugin" }));
      tried[`${when}: settings`] = await refusalOf(() => site.saveConfig({ ...config, name: "Plugin's name" }));
      tried[`${when}: build mode`] = await refusalOf(() => site.writeFile("src/components/Plugin.astro", "<p>x</p>\n", { origin: "agent", mode: "build" }));
    };

    registry.register(
      definePlugin({
        name: "galley-plugin-reacts",
        apiVersion: PLUGIN_API_VERSION,
        hooks: {
          onSubmission: () => attempts("a visitor's form"),
          afterPublish: () => attempts("after an owner's publish"),
        },
      }),
      { source: "user" }
    );
    await registry.start();
    requireCallerForGuardedWork(true);
    await withCaller(owner, () => site.writeFile("src/content/pages/about.md", "---\ntitle: About us\n---\nHello\n", { origin: "user", mode: "content" }));
    // A visitor's form arrives with nobody signed in; an owner's publish fires its hooks while the owner's request is still running.
    await registry.onSubmission(site, { id: "one", form: "contact", values: {}, receivedAt: new Date().toISOString() } as never);
    const published = await withCaller(owner, async () => {
      const result = await site.publish({ message: "Owner's publish" });

      await registry.afterPublish(site, result);
      return result;
    });

    await registry.settled();
    expect(published.ok).toBe(true);
    expect(Object.keys(tried)).toHaveLength(6);
    for (const [what, refusal] of Object.entries(tried)) expect(refusal, what).toBe(NO_CALLER_REFUSAL);
    expect(readFileSync(join(site.root, CONFIG), "utf8")).not.toContain("Plugin's name");
    await registry.dispose();
  });
});

describe("without the switch (local mode, the desktop app)", () => {
  it("work outside any scope does everything it always did", async () => {
    const { site } = await openSite(makeSite());
    const config = (await site.readConfig()) as GalleyConfig;

    expect(await refusalOf(() => site.saveConfig({ ...config, name: "Local" }))).toBeNull();
    expect(await refusalOf(() => site.writeFile("src/components/Note.astro", "<p>Note</p>\n", { origin: "user", mode: "build" }))).toBeNull();
    expect(await refusalOf(() => recordSettings(site, { kind: "redirects-list" }))).toBeNull();
    expect(await refusalOf(() => site.publish({ message: "Local publish" }))).toBeNull();
    expect(formCodeRefusal(null, JSON.stringify({ title: "Contact", afterSubmit: [{ type: "script", code: "x()" }] }), { origin: "user", allowBuild: true })).toBeNull();
  });
});
