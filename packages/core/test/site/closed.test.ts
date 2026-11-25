/**
 * What a site does once it has been closed, when something kept it. The
 * registry closes a site nothing has used for an hour (and whose Undo nobody
 * still offers); whoever asks for the site again is handed a new one. The old
 * one refuses everyone who kept it, in one sentence: it would otherwise go on
 * reading stale copies and writing the folder behind the new one's back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { RECORD_SETTINGS } from "../../src/site/settings-records";
import { SITE_CLOSED, UNDO_LOST } from "../../src/workspace";
import { cleanupAll, disposeAll, HOME, makeSite, openSite } from "./helpers";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

const CLOSED = { code: "forbidden", message: SITE_CLOSED };
/** What a closed site still answers: what it is, closing it again, and the registry's reads from memory. */
const KEPT = new Set<PropertyKey>(["id", "root", "dispose", "snapshot", "previewHandle", "liveUrl", "undoOffered", "isClosed"]);
/** Members that answer at once: closed, they throw. Every other member rejects. */
const SYNC = new Set<PropertyKey>(["resolvePath", "pendingPaths", "checkpoint", "preview"]);

it("a closed site refuses whoever kept it, in one sentence, and writes nothing; what it is still answers, and the site opened next works", async () => {
  const root = makeSite();
  const kept = await openSite(root);
  const text = (await kept.site.readFile(HOME)).content;
  // A member taken before the close refuses too: the check is made when it is called.
  const readFile = kept.site.readFile;

  await Promise.all([kept.site.dispose(), kept.site.dispose()]);
  const from = kept.events.length;

  await expect(kept.site.readFile(HOME)).rejects.toMatchObject(CLOSED);
  await expect(readFile(HOME)).rejects.toMatchObject(CLOSED);
  // However it is looked at: a descriptor hands out the refusing member, never the site's own.
  await expect((Object.getOwnPropertyDescriptor(kept.site, "readFile")!.value as typeof readFile)(HOME)).rejects.toMatchObject(CLOSED);
  await expect(kept.site.writeFile(HOME, `${text}\nwritten after it was closed\n`, { origin: "user", mode: "content" })).rejects.toMatchObject(CLOSED);
  await expect(kept.site.updateEntry(HOME, [{ op: "set", path: ["title"], value: "Closed" }], { origin: "user" })).rejects.toMatchObject(CLOSED);
  await expect(kept.site.model()).rejects.toMatchObject(CLOSED);
  await expect(kept.site.changes()).rejects.toMatchObject(CLOSED);
  await expect(kept.site.refresh()).rejects.toMatchObject(CLOSED);
  expect(() => kept.site.preview()).toThrow(SITE_CLOSED);
  expect(() => kept.site.checkpoint("after")).toThrow(SITE_CLOSED);
  expect(readFileSync(join(root, HOME), "utf8")).toBe(text);
  expect(kept.site.id).toBe("test-site");
  expect(kept.site.root).toBeTruthy();
  await expect(kept.site.dispose()).resolves.toBeUndefined();
  // Not one event from the closed site.
  expect(kept.events.slice(from)).toEqual([]);

  // The site as it is opened next reads and writes, and is told of its changes.
  const open = await openSite(root);

  await open.site.writeFile(HOME, `${text}\nwritten by the site open now\n`, { origin: "user", mode: "content" });
  expect(readFileSync(join(root, HOME), "utf8")).toContain("written by the site open now");
}, 120_000);

it("every member of a closed site but what it is refuses: those that answer at once throw, the rest reject without throwing", async () => {
  const { site } = await openSite(makeSite());
  const members = [...Object.keys(site), RECORD_SETTINGS].filter((key) => typeof (site as unknown as Record<PropertyKey, unknown>)[key] === "function" && !KEPT.has(key));

  // Each one is in the list above or answers with a promise: a member added later fails closed.
  expect(members.length).toBeGreaterThan(30);
  await site.dispose();
  for (const key of members) {
    const member = (site as unknown as Record<PropertyKey, (...args: unknown[]) => unknown>)[key]!;

    if (SYNC.has(key)) {
      expect(() => member(), String(key)).toThrow(SITE_CLOSED);
      continue;
    }
    let answer: unknown;

    expect(() => (answer = member()), String(key)).not.toThrow();
    await expect(answer, String(key)).rejects.toMatchObject(CLOSED);
  }
}, 120_000);

it("a preview kept from a site that was then closed doesn't start again", async () => {
  const { site } = await openSite(makeSite());
  const preview = site.preview();

  await site.dispose();
  await expect(preview.start()).rejects.toMatchObject(CLOSED);
  await expect(preview.restart()).rejects.toMatchObject(CLOSED);
  expect(preview.status().state).not.toBe("ready");
}, 120_000);

it("a checkpoint kept from a site that was then closed refuses to undo, in a sentence; one its holder let go still answers that nothing was put back", async () => {
  const root = makeSite();
  const { site } = await openSite(root);
  const text = (await site.readFile(HOME)).content;
  const kept = site.checkpoint("kept");
  const letGo = site.checkpoint("let go") as ReturnType<typeof site.checkpoint> & { release(): Promise<void> };

  await kept.run(() => site.writeFile(HOME, `${text}\nwritten as the kept checkpoint's own work\n`, { origin: "agent", mode: "content" }));
  kept.close();
  // Let go by whoever held it, as after an undo: asked again, there is nothing to put back, and that is all it says.
  await letGo.release();
  expect(await letGo.restore()).toEqual([]);

  await site.dispose();
  // What it kept went with the site. It does not answer as if the undo had been done.
  await expect(kept.restore()).rejects.toMatchObject({ code: "not-found", message: UNDO_LOST });
  expect(kept.left()).toEqual([]);
  expect(readFileSync(join(root, HOME), "utf8")).toContain("written as the kept checkpoint's own work");
  // Work run as the kept checkpoint's own writes nothing to the closed site.
  await expect(kept.run(() => site.writeFile(HOME, "after", { origin: "agent", mode: "content" }))).rejects.toMatchObject(CLOSED);
  // The one its holder had let go is not turned into a refusal by the site closing afterwards.
  expect(await letGo.restore()).toEqual([]);
}, 120_000);

it("once closing a site has finished, nothing more lands in its folder, whatever was on its way", async () => {
  const root = makeSite();
  const { site } = await openSite(root);
  const text = (await site.readFile(HOME)).content;

  await site.writeFile(HOME, `${text}\npending\n`, { origin: "user", mode: "content" });
  // A discard asked for as the site closes: it ends before the close does, or it is refused; never after.
  const discard = site.discard([HOME]).then(() => "done", (error: unknown) => error);

  await site.dispose();
  const after = readFileSync(join(root, HOME), "utf8");
  const outcome = await discard;

  expect(readFileSync(join(root, HOME), "utf8")).toBe(after);
  if (outcome !== "done") expect(outcome).toMatchObject(CLOSED);
}, 120_000);

it("an Undo asked while the site is closing says the site was closed, and puts nothing back", async () => {
  const root = makeSite();
  const { site } = await openSite(root);
  const text = (await site.readFile(HOME)).content;
  const checkpoint = site.checkpoint("a reply");

  await checkpoint.run(() => site.writeFile(HOME, `${text}\nthe reply's own\n`, { origin: "agent", mode: "content" }));
  checkpoint.close();
  const closing = site.dispose();

  await expect(checkpoint.restore()).rejects.toMatchObject({ code: "not-found", message: UNDO_LOST });
  await closing;
  expect(readFileSync(join(root, HOME), "utf8")).toContain("the reply's own");
}, 120_000);
