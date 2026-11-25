/**
 * What a site does once it has been closed, when something kept it. The
 * registry closes a site nothing has used for a while; whoever asks for the
 * site again is handed a new one. The old one is not made to refuse: it goes
 * on working on the folder, and tells nobody. That is why nothing should
 * keep a site, and the embedding docs say so in these words.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { cleanupAll, disposeAll, HOME, makeSite, openSite } from "./helpers";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

it("a closed site that something kept still reads and writes its folder, and nobody is told of what it changes", async () => {
  const root = makeSite();
  const kept = await openSite(root);
  const text = (await kept.site.readFile(HOME)).content;

  await kept.site.dispose();
  const from = kept.events.length;

  expect((await kept.site.readFile(HOME)).content).toBe(text);
  await kept.site.writeFile(HOME, `${text}\nwritten after it was closed\n`, { origin: "user", mode: "content" });
  expect(readFileSync(join(root, HOME), "utf8")).toContain("written after it was closed");
  expect((await kept.site.changes()).files.map((file) => file.path)).toEqual([HOME]);

  // The same write through the site as it is opened next is told, as every change is (a moment after the write).
  const open = await openSite(root);

  await open.site.writeFile(HOME, text, { origin: "user", mode: "content" });
  for (const deadline = Date.now() + 10_000; open.of("changes.updated").length === 0 && Date.now() < deadline; ) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(open.of("changes.updated")).toEqual([{ type: "changes.updated", siteId: "test-site", paths: [HOME], origin: "user" }]);
  // And the closed one's, made before it: not one event, then or since. No window hears of that change.
  expect(kept.events.slice(from)).toEqual([]);
}, 120_000);
