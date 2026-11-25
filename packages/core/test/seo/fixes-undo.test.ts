/**
 * The Undo a batch of search fixes offers. The editor offers it for a few
 * seconds, so it doesn't keep its site open; it is let go once it is undone,
 * pushed out by newer batches, or when the batch changed nothing.
 */
import { afterAll, expect, it } from "vitest";
import { auditSite } from "../../src/seo/audit";
import { applyFixes, undoFixes } from "../../src/seo/fixes";
import type { OpenSite } from "../../src/site/service";
import { disposeAll, openSite } from "../site/helpers";
import { makeFixture, plantedFiles, plantedRendered } from "./fixture";

afterAll(() => disposeAll());

const NOW = new Date("2026-11-23T12:00:00Z");

async function fixAll(site: OpenSite) {
  const audit = await auditSite(site, { now: NOW });

  return applyFixes(site, audit.findings.filter((finding) => finding.fix).map((finding) => finding.id));
}

/** What the site's checkpoints still keep in memory, read through a checkpoint opened for the purpose. */
function kept(site: OpenSite): number {
  const probe = site.checkpoint("probe") as unknown as { manager: { inMemory(): number }; release(): Promise<void> };
  const bytes = probe.manager.inMemory();

  void probe.release();
  return bytes;
}

it("doesn't keep its site open, still undoes, and lets go once undone; a batch that changed nothing keeps nothing", async () => {
  const { site } = await openSite(makeFixture(plantedFiles(), plantedRendered()));
  const open = site as OpenSite;
  const result = await fixAll(open);

  expect(result.undoId).not.toBeNull();
  expect(open.undoOffered()).toBe(false);
  expect(kept(open)).toBeGreaterThan(0);
  expect((await undoFixes(open, result.undoId!)).restored.length).toBeGreaterThan(0);
  expect(kept(open)).toBe(0);
  const none = await applyFixes(open, ["no-such-finding"]).catch(() => ({ undoId: null }));

  expect(none.undoId).toBeNull();
  expect(kept(open)).toBe(0);
}, 120_000);

it("lets go of the batches pushed out by newer ones: with the kept ones undone, nothing is kept", async () => {
  const { site } = await openSite(makeFixture(plantedFiles(), plantedRendered()));
  const open = site as OpenSite;
  const ids: string[] = [];

  // Twenty-one batches; the files are put back between them so each has something to fix.
  for (let round = 0; round < 21; round += 1) {
    const result = await fixAll(open);

    expect(result.undoId, `round ${round}`).not.toBeNull();
    ids.push(result.undoId!);
    await open.discard((await open.changes()).files.map((file) => file.path));
  }
  await expect(undoFixes(open, ids[0]!)).rejects.toMatchObject({ code: "not-found" });
  for (const id of ids.slice(1)) await undoFixes(open, id);
  // Had the first been dropped without being let go, what it kept would still be held.
  expect(kept(open)).toBe(0);
}, 300_000);
