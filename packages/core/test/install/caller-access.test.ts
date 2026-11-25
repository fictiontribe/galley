/**
 * The engine holds a person's role at the point of use, whoever calls it:
 * every way of writing the site's settings file needs the settings level,
 * build mode needs its level and is refused (never quietly turned into
 * content mode), publishing and the site's other guarded methods need their
 * route's level, and long-lived things made during one person's request
 * carry nobody's access or name into later work. Against real sites in real
 * temporary repositories; nobody in scope is everything allowed, as before.
 */
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCT } from "../../src/brand";
import { GalleyError } from "../../src/errors";
import { BUILD_MODE_REFUSAL, currentCaller, NAME_NEEDED, NAME_NEEDED_REFUSAL, SITE_SETTINGS_REFUSAL, withCaller, type Caller } from "../../src/install/caller";
import { roleMay, type AccountRole } from "../../src/install/accounts";
import { BUILD_MODE_LEVEL, levelFor, ROLE_REFUSAL, ROUTE_ACCESS, SITE_METHOD_ACCESS, SITE_SETTINGS_LEVEL, SITE_SETTINGS_RECORDS, siteMethodLevel, type GuardedSiteMethod } from "../../src/install/route-access";
import { formCodeRefusal } from "../../src/site-kit/guard";
import { createEventBus, createSiteRegistry } from "../../src/site/index";
import type { GalleyConfig, ServerEvent, Settings, SiteService } from "../../src/types";
import { currentAccountAuthor, withAccountAuthor } from "../../src/workspace/author";
import { AUTHOR, cleanupAll, disposeAll, makeSite, openSite, sh, tempDir, until } from "../site/helpers";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

type Who = AccountRole | null;
const EVERYONE: Who[] = ["owner", "editor", "contributor", null];
const CONFIG = PRODUCT.configFile;

function caller(role: AccountRole, current?: () => AccountRole | null): Caller {
  return { accountId: `${role}-1`, role, ...(current ? { current } : {}) };
}

/** Runs `run` as this person (null: nobody — local mode, the operator's token). */
function as<T>(who: Who, run: () => T): T {
  return who === null ? run() : withCaller(caller(who), run);
}

async function refusalOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof GalleyError && error.code === "forbidden") return error.message;
    throw error;
  }
}

const may = (who: Who, level: Parameters<typeof roleMay>[1]) => who === null || roleMay(who, level);
const configText = (site: SiteService) => readFileSync(join(site.root, CONFIG), "utf8");

describe("the table beside the routes", () => {
  it("each guarded method of the site takes its route's level, and the engine's bookkeeping names real routes", () => {
    for (const [method, route] of Object.entries(SITE_METHOD_ACCESS)) {
      expect(siteMethodLevel(method as GuardedSiteMethod)).toBe(levelFor(route));
      expect(ROUTE_ACCESS[route]).toBe("publish");
    }
    expect(Object.fromEntries(Object.entries(SITE_SETTINGS_RECORDS).map(([kind, route]) => [kind, ROUTE_ACCESS[route]]))).toEqual({ "redirects-list": "edit", "redirects-host": "manage", "deploy-address": "publish" });
    expect(ROUTE_ACCESS["PUT /api/sites/:siteId/config"]).toBe(SITE_SETTINGS_LEVEL);
  });
});

describe("the site's settings file, whichever way it is written", () => {
  it("the settings screen's save: only someone with the settings level, whatever the change", async () => {
    for (const who of EVERYONE) {
      const { site } = await openSite(makeSite());
      const before = configText(site);
      const config = (await site.readConfig()) as GalleyConfig;

      // A name, or only where the redirects apply: the same rule (the engine's own bookkeeping has its own path).
      for (const next of [{ ...config, name: "Renamed" }, { ...config, redirects: { host: "netlify" as const } }]) {
        const refused = await as(who, () => refusalOf(site.saveConfig(next)));

        expect(refused, String(who)).toBe(may(who, SITE_SETTINGS_LEVEL) ? null : SITE_SETTINGS_REFUSAL);
      }
      if (!may(who, SITE_SETTINGS_LEVEL)) expect(configText(site)).toBe(before);
    }
  });

  it("a raw file write and a delete, in build mode, by its own name or in other letter case", async () => {
    for (const who of EVERYONE) {
      const { site } = await openSite(makeSite());
      const before = configText(site);
      const write = (path: string) => as(who, () => refusalOf(site.writeFile(path, '{ "name": "Changed" }\n', { origin: "user", mode: "build" })));
      const expected = !may(who, BUILD_MODE_LEVEL) ? BUILD_MODE_REFUSAL : !may(who, SITE_SETTINGS_LEVEL) ? SITE_SETTINGS_REFUSAL : null;

      expect(await write(CONFIG.toUpperCase()), String(who)).toBe(expected);
      expect(await write(`./${CONFIG}`), String(who)).toBe(expected);
      expect(await as(who, () => refusalOf(site.deleteFile(CONFIG, { origin: "user", mode: "build" }))), String(who)).toBe(expected);
      if (expected) expect(configText(site)).toBe(before);
    }
  });

  it("a content-mode write that the site's writable files would allow, by name or through a link to it", async () => {
    const root = makeSite();
    const config = JSON.parse(readFileSync(join(root, CONFIG), "utf8")) as GalleyConfig;

    // An owner made every top-level JSON file content: the settings file still isn't anyone's content.
    writeFileSync(join(root, CONFIG), JSON.stringify({ ...config, writable: { content: ["src/content/**", "*.json"] } }, null, 2));
    symlinkSync(CONFIG, join(root, "settings-link.json"));
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Writable JSON");
    const { site } = await openSite(root);
    const before = configText(site);

    for (const who of EVERYONE) {
      for (const path of [CONFIG, "settings-link.json"]) {
        const refused = await as(who, () => refusalOf(site.writeFile(path, before.replace("Lowfield Studio", `Lowfield ${who}`), { origin: "user", mode: "content" })));

        expect(refused, `${who} ${path}`).toBe(may(who, SITE_SETTINGS_LEVEL) ? null : SITE_SETTINGS_REFUSAL);
      }
    }
    // writable.content no longer widens what an account below build level may write: a top-level JSON file an owner
    // marked content is not recognised content (no collection, not media), so for a contributor it is refused — the
    // content guard is an allowlist, not writable.content minus the dangerous extensions.
    expect(await as("contributor", () => refusalOf(site.writeFile("notes.json", "{}\n", { origin: "user", mode: "content" })))).toBe(BUILD_MODE_REFUSAL);
    // An account at build level keeps the ordinary content-mode surface: writable.content still lets an owner write it.
    expect(await as("owner", () => refusalOf(site.writeFile("notes.json", "{}\n", { origin: "user", mode: "content" })))).toBeNull();
  });

  it("discarding a pending change to it, and undoing a turn that changed it", async () => {
    const { site } = await openSite(makeSite());
    const config = (await site.readConfig()) as GalleyConfig;
    const checkpoint = site.checkpoint("A turn that changed the settings");

    await as("owner", () => checkpoint.run(() => site.saveConfig({ ...config, name: "Owner's name" })));
    checkpoint.close();
    await as("owner", () => site.writeFile("src/content/pages/about.md", "---\ntitle: About us\n---\nHello\n", { origin: "user", mode: "content" }));
    const changed = configText(site);

    for (const who of ["editor", "contributor"] as const) {
      expect(await as(who, () => refusalOf(site.discard()))).toBe(SITE_SETTINGS_REFUSAL);
      expect(await as(who, () => refusalOf(site.discard([CONFIG])))).toBe(SITE_SETTINGS_REFUSAL);
      expect(await as(who, () => refusalOf(checkpoint.restore()))).toBe(SITE_SETTINGS_REFUSAL);
      expect(configText(site)).toBe(changed);
    }
    // Their own changes they can still discard.
    expect(await as("contributor", () => refusalOf(site.discard(["src/content/pages/about.md"])))).toBeNull();
    expect(await as("owner", () => refusalOf(checkpoint.restore()))).toBeNull();
    expect(configText(site)).not.toContain("Owner's name");
  });

  it("undoing a publish that changed it", async () => {
    const { site } = await openSite(makeSite());
    const config = (await site.readConfig()) as GalleyConfig;

    await as("owner", () => site.saveConfig({ ...config, name: "Published name" }));
    const settings = await as("owner", () => site.publish({ message: "New name" }));

    await as("owner", () => site.writeFile("src/content/pages/about.md", "---\ntitle: About us\n---\nHello\n", { origin: "user", mode: "content" }));
    const content = await as("owner", () => site.publish({ message: "About" }));

    expect(settings.ok && content.ok).toBe(true);
    expect(await as("editor", () => refusalOf(site.revert(settings.commit!)))).toBe(SITE_SETTINGS_REFUSAL);
    expect(configText(site)).toContain("Published name");
    // An editor still undoes a publish that left the settings alone.
    expect(await as("editor", () => refusalOf(site.revert(content.commit!)))).toBeNull();
    expect(await as("owner", () => refusalOf(site.revert(settings.commit!)))).toBeNull();
    expect(configText(site)).not.toContain("Published name");
  });
});

describe("build mode", () => {
  it("a write that asks for build mode is refused for someone without its level — not written in content mode instead", async () => {
    for (const who of EVERYONE) {
      const { site } = await openSite(makeSite());
      const path = "src/components/Note.astro";
      const refused = await as(who, () => refusalOf(site.writeFile(path, "<p>Note</p>\n", { origin: "user", mode: "build" })));

      expect(refused, String(who)).toBe(may(who, BUILD_MODE_LEVEL) ? null : BUILD_MODE_REFUSAL);
      expect(await site.listFiles({ glob: path })).toEqual(may(who, BUILD_MODE_LEVEL) ? [path] : []);
    }
  });

  it("every other way of asking for it: an entry edit, a new entry, the site's build, a site settings save", async () => {
    const { site } = await openSite(makeSite());
    const config = (await site.readConfig()) as GalleyConfig;
    const asks = [
      () => site.updateEntry("src/content/pages/about.md", [{ op: "set", path: ["title"], value: "About" }], { origin: "user", mode: "build" }),
      () => site.createEntry({ collection: "blog", slug: "a-new-post", data: { title: "A new post" } }, { origin: "user", mode: "build" }),
      () => site.build({ mode: "build" }),
      () => site.saveConfig({ ...config, name: "x" }, { mode: "build" }),
    ];

    for (const ask of asks) expect(await as("contributor", () => refusalOf(ask()))).toBe(BUILD_MODE_REFUSAL);
  });

  it("custom code in a form counts as build mode for the person in the app too", async () => {
    const form = (code: string) => JSON.stringify({ title: "Contact", afterSubmit: [{ type: "script", code }] });

    expect(as("contributor", () => formCodeRefusal(null, form("track()"), { origin: "user", allowBuild: true }))).toBe(BUILD_MODE_REFUSAL);
    expect(as("editor", () => formCodeRefusal(null, form("track()"), { origin: "user", allowBuild: true }))).toBeNull();
    expect(as(null, () => formCodeRefusal(null, form("track()"), { origin: "user", allowBuild: true }))).toBeNull();
    // Taking code out stays content editing.
    expect(as("contributor", () => formCodeRefusal(form("track()"), JSON.stringify({ title: "Contact" }), { origin: "user", allowBuild: true }))).toBeNull();

    const { site } = await openSite(makeSite());
    const path = "src/content/forms/contact.json";
    const before = readFileSync(join(site.root, path), "utf8");
    const data = JSON.parse(before) as Record<string, unknown>;
    const edited = await as("contributor", () => site.updateEntry(path, [{ op: "set", path: ["afterSubmit"], value: [{ type: "script", code: "track()" }] }], { origin: "user" }));

    expect(edited.applied).toBe(0);
    expect(edited.refused[0]?.reason).toBe(BUILD_MODE_REFUSAL);
    expect(await as("contributor", () => refusalOf(site.writeFile(path, JSON.stringify({ ...data, afterSubmit: [{ type: "script", code: "x()" }] }), { origin: "user", mode: "content" })))).not.toBeNull();
    expect(readFileSync(join(site.root, path), "utf8")).toBe(before);
  });
});

describe("publishing and the site's other guarded methods", () => {
  it("each needs its route's level, whoever calls the site", async () => {
    const { site } = await openSite(makeSite());

    for (const method of Object.keys(SITE_METHOD_ACCESS) as GuardedSiteMethod[]) {
      for (const who of EVERYONE) {
        const call = (site[method] as (...args: unknown[]) => Promise<unknown>).bind(site);
        const args = method === "revert" ? ["0000000"] : [];
        let message: string | null = null;

        try {
          await as(who, () => call(...args));
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        // Allowed: whatever else it says (nothing to publish, no remote), it isn't the refusal.
        if (may(who, siteMethodLevel(method))) expect(message, `${method} ${who}`).not.toBe(ROLE_REFUSAL);
        else expect(message, `${method} ${who}`).toBe(ROLE_REFUSAL);
      }
    }
  });

  it("wait for a name: someone whose account has none yet can change the draft, and is asked to choose a name before anything is published in it", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    let named = false;
    const nameless: Caller = { accountId: "editor-2", role: "editor", named: () => named };
    const refused = async (work: () => Promise<unknown>) => {
      const error = await withCaller(nameless, work).then(() => null, (caught: unknown) => caught);

      return error instanceof GalleyError ? { code: error.code, message: error.message, detail: error.detail } : error;
    };
    const head = sh(root, "rev-parse", "HEAD");

    // The draft is theirs to change, like anyone's.
    await withCaller(nameless, () => site.writeFile("src/content/pages/about.md", "---\ntitle: About us\n---\nHello\n", { origin: "user", mode: "content" }));
    for (const work of [() => site.publish({ message: "Edit" }), () => site.revert(head), () => site.send(), () => site.pull()]) {
      expect(await refused(work)).toEqual({ code: "forbidden", message: NAME_NEEDED_REFUSAL, detail: NAME_NEEDED });
    }
    expect(sh(root, "rev-parse", "HEAD")).toBe(head);
    // Read again when it is checked: once they have a name, the same request's later work goes through.
    named = true;
    expect((await withCaller(nameless, () => site.publish({ message: "Edit" }))).ok).toBe(true);
    // A role without the publish level reads the role's refusal, name or no name.
    expect(await withCaller({ accountId: "c-1", role: "contributor", named: () => false }, () => refusalOf(site.publish({ message: "x" })))).toBe(ROLE_REFUSAL);
  });

  it("the role is read again when it matters: demoted or switched off part-way, the work can do only what the role allows now", async () => {
    const { site } = await openSite(makeSite());
    let now: AccountRole | null = "editor";
    const ed = caller("editor", () => now);
    const work = () => withCaller(ed, () => site.publish({}));

    expect(await refusalOf(work())).toBeNull();
    now = "contributor";
    expect(await refusalOf(work())).toBe(ROLE_REFUSAL);
    now = null;
    expect(await refusalOf(work())).toBe(ROLE_REFUSAL);
    // Promoted part-way doesn't give more than the role the work began with.
    expect(await withCaller(caller("contributor", () => "owner"), () => refusalOf(site.publish({})))).toBe(ROLE_REFUSAL);
  });

  it("work a request starts that outlives it keeps that person's access", async () => {
    const { site } = await openSite(makeSite());
    const config = (await site.readConfig()) as GalleyConfig;
    const later = await new Promise<Promise<string | null>>((resolve) => {
      withCaller(caller("contributor"), () => setTimeout(() => resolve(refusalOf(site.saveConfig({ ...config, name: "Later" }))), 10));
    });

    expect(await later).toBe(SITE_SETTINGS_REFUSAL);
  });
});

describe("long-lived things made during someone's request", () => {
  it("an open site, opened in an owner's request, carries neither the owner's access nor name into later work", async () => {
    const home = join(tempDir("caller-home-"), ".galley");
    const bus = createEventBus();
    const registry = await createSiteRegistry({
      home,
      sitesDir: join(home, "..", "Sites"),
      startersDir: tempDir("caller-starters-"),
      events: bus,
      overlayScript: () => "",
      settings: { get: async () => ({ author: AUTHOR }) as Settings },
      install: async () => undefined,
    });
    const root = makeSite();
    const seen: Array<{ caller: Caller | null; author: unknown }> = [];

    bus.subscribe((event: ServerEvent) => {
      if (event.type === "changes.updated" && event.origin === "external") seen.push({ caller: currentCaller(), author: currentAccountAuthor() });
    });
    try {
      // The owner's request is the one that opens it, and so starts its watcher and its queues.
      const site = await withCaller(caller("owner"), () => withAccountAuthor({ name: "Sam Owner", email: "sam@example.com" }, () => registry.open({ path: root })));

      // A change made outside the app later is noticed by that watcher: as nobody.
      writeFileSync(join(root, "src", "content", "pages", "about.md"), "---\ntitle: Changed outside\n---\n");
      await until(() => seen.length > 0, 10_000);
      expect(seen[0]).toEqual({ caller: null, author: null });

      // A contributor's later request can't do what the owner's could.
      const config = (await site.readConfig()) as GalleyConfig;

      expect(await withCaller(caller("contributor"), () => refusalOf(site.saveConfig({ ...config, name: "Not theirs" })))).toBe(SITE_SETTINGS_REFUSAL);
      // An editor publishes: the version is theirs.
      const published = await withCaller(caller("editor"), () => withAccountAuthor({ name: "Ed Editor", email: "ed@example.com" }, () => site.publish({ message: "Outside change" })));

      expect(published.ok).toBe(true);
      expect(sh(root, "log", "-1", "--format=%an <%ae>")).toBe("Ed Editor <ed@example.com>");
    } finally {
      await registry.dispose();
    }
  });
});
