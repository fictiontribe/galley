/**
 * What a site's checkpoints keep in memory stays within a budget: a site whose
 * Undo is offered stays open, so past the budget a file's earlier copy goes to
 * a temp file whatever its size, and putting it back still works.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { MEMORY_BUDGET_BYTES, SPILL_BYTES } from "../../src/workspace";
import { cleanupAll, disposeAll, makeSite, openSite, sh } from "../site/helpers";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

it("keeps at most the budget in memory across a site's checkpoints, and puts every file back", async () => {
  const root = makeSite();
  const size = SPILL_BYTES - 1024;
  const count = Math.ceil(MEMORY_BUDGET_BYTES / size) + 2;
  const names = Array.from({ length: count }, (_, i) => `public/images/big-${i}.png`);

  mkdirSync(join(root, "public/images"), { recursive: true });
  for (const [i, name] of names.entries()) writeFileSync(join(root, name), Buffer.alloc(size, i + 1));
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "Big files");
  const { site } = await openSite(root);
  const checkpoint = site.checkpoint("big") as ReturnType<typeof site.checkpoint> & { manager: { inMemory(): number } };

  await checkpoint.run(async () => {
    for (const name of names) await site.writeFile(name, Buffer.alloc(16, 7), { origin: "agent", mode: "content" });
  });
  checkpoint.close();
  expect(checkpoint.manager.inMemory()).toBeLessThanOrEqual(MEMORY_BUDGET_BYTES);
  expect(checkpoint.manager.inMemory()).toBeGreaterThan(0);
  expect((await checkpoint.restore()).sort()).toEqual([...names].sort());
  for (const [i, name] of names.entries()) expect(readFileSync(join(root, name)).equals(Buffer.alloc(size, i + 1))).toBe(true);
}, 120_000);

it("keeps a made file's lines as numbers, never its text", async () => {
  const { site } = await openSite(makeSite());
  const checkpoint = site.checkpoint("made") as ReturnType<typeof site.checkpoint> & { records: Map<string, { made: Set<unknown> | null }> };
  const page = "src/content/pages/made.md";

  await checkpoint.run(() => site.writeFile(page, "---\ntitle: Made\n---\n\nA line.\nAnother line.\n", { origin: "agent", mode: "content" }));
  const made = [...(checkpoint.records.get(page)?.made ?? [])];

  expect(made.length).toBeGreaterThan(0);
  expect(made.every((line) => typeof line === "number")).toBe(true);
}, 120_000);
