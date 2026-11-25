/**
 * The site's model is read-only for everyone it is handed to. The engine
 * reads its own rules from that one object (what content mode may write, how
 * it publishes), so a change to it by whoever asked for it would change
 * those rules for everyone.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readOnly } from "../../src/site/read-only";
import type { SiteModel } from "../../src/types";
import { cleanupAll, disposeAll, makeSite, openSite, STARTERS } from "./helpers";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

/** Every plain object and array under `value` is frozen; reports the first that isn't. */
function unfrozen(value: unknown, path = "model", seen = new Set<object>()): string | null {
  if (value === null || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (!Object.isFrozen(value)) return path;
  for (const [key, item] of Object.entries(value)) {
    const found = unfrozen(item, `${path}.${key}`, seen);

    if (found) return found;
  }
  return null;
}

/** Whatever isn't plain data under `value`: the model is expected to hold none. */
function notPlain(value: unknown, path = "model", seen = new Set<object>(), out: string[] = []): string[] {
  if (typeof value === "function") out.push(path);
  if (value === null || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  const proto = Object.getPrototypeOf(value) as unknown;

  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) out.push(path);
  for (const [key, item] of Object.entries(value)) notPlain(item, `${path}.${key}`, seen, out);
  return out;
}

describe("the site's model", { timeout: 120_000 }, () => {
  it.each(STARTERS)("is plain data, read-only all the way down (%s)", async (starter) => {
    const { site } = await openSite(makeSite({ starter }));
    const model = await site.model();

    expect(notPlain(model)).toEqual([]);
    expect(unfrozen(model)).toBeNull();
  });

  it("can't be changed by whoever is handed it: a change is an error where it is made, and the site's rules stay as they were", async () => {
    const { site } = await openSite(makeSite());
    const model = await site.model();
    const before = JSON.stringify(model);

    expect(() => model.writable.content.push("src/**")).toThrow(TypeError);
    expect(() => void (model.writable.build.length = 0)).toThrow(TypeError);
    expect(() => void ((model.publish as { push: boolean }).push = false)).toThrow(TypeError);
    expect(() => void ((model as { name: string }).name = "Someone else's")).toThrow(TypeError);
    expect(() => void ((model.collections[0] as { label: string }).label = "Changed")).toThrow(TypeError);
    expect(() => void delete (model as Partial<SiteModel>).media).toThrow(TypeError);
    expect(() => void ((model as SiteModel & { added?: boolean }).added = true)).toThrow(TypeError);
    expect(JSON.stringify(await site.model())).toBe(before);
    // Content mode is as narrow as it was: the site's code still needs build mode.
    await expect(site.writeFile("src/layouts/Base.astro", "changed", { origin: "user", mode: "content" })).rejects.toThrow("Only content and media can be changed in content mode.");
  });

  it("stays read-only through everything that makes a new one: a refresh, a change of settings, a new page", async () => {
    const { site } = await openSite(makeSite());
    const refreshed = await site.refresh();

    expect(unfrozen(refreshed)).toBeNull();
    const saved = await site.saveConfig({ ...((await site.readConfig()) ?? {}), name: "Renamed" });

    expect(saved.name).toBe("Renamed");
    expect(unfrozen(saved)).toBeNull();
    expect(unfrozen(await site.model())).toBeNull();
    // A new entry changes the collections' counts, which makes a new model.
    const pages = (await site.model()).collections.find((collection) => collection.kind === "entries" && collection.path.includes("pages"))!;
    const count = pages.count ?? 0;

    await site.writeFile(`${pages.path}/a-new-page.md`, "---\ntitle: A new page\n---\nHello\n", { origin: "user", mode: "content" });
    await site.refresh();
    const after = await site.model();

    expect(after.collections.find((collection) => collection.id === pages.id)!.count).toBe(count + 1);
    expect(unfrozen(after)).toBeNull();
  });
});

describe("making plain data read-only", () => {
  it("freezes plain objects and arrays all the way down, and leaves anything with behaviour of its own as it is", () => {
    class Controller {
      state = "stopped";
    }
    const controller = new Controller();
    const fn = () => 1;
    const bytes = new Uint8Array([1, 2]);
    const value = readOnly({ list: [{ deep: { deeper: [1, 2] } }], controller, fn, bytes, when: new Date(0), none: null, n: 1 });

    expect(Object.isFrozen(value) && Object.isFrozen(value.list) && Object.isFrozen(value.list[0]!.deep.deeper)).toBe(true);
    expect(() => value.list.push({ deep: { deeper: [] } })).toThrow(TypeError);
    controller.state = "running";
    expect(value.controller.state).toBe("running");
    expect(Object.isFrozen(controller) || Object.isFrozen(value.when)).toBe(false);
    bytes[0] = 9;
    expect(value.bytes[0]).toBe(9);
    expect(value.fn).toBe(fn);
  });

  it("copes with loops and with what was already read-only, and hands back the same object", () => {
    const loop: { self?: unknown; items: unknown[] } = { items: [] };

    loop.self = loop;
    loop.items.push(loop);
    expect(readOnly(loop)).toBe(loop);
    expect(Object.isFrozen(loop) && Object.isFrozen(loop.items)).toBe(true);
    expect(readOnly(loop)).toBe(loop);
    for (const plain of [null, undefined, 1, "text", true]) expect(readOnly(plain)).toBe(plain);
    const bare = Object.create(null) as { a: number[] };

    bare.a = [1];
    expect(Object.isFrozen(readOnly(bare).a)).toBe(true);
  });
});
