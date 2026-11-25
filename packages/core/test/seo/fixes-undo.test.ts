/**
 * The Undo a batch of search fixes offers, and the site it keeps open. While
 * a batch's Undo is offered its site is not closed for lack of use; once it is
 * undone, or pushed out by newer batches, or changed nothing, what it kept is
 * let go and the site may close again.
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

it("offers its Undo until it is undone; a batch that changed nothing offers none", async () => {
  const { site } = await openSite(makeFixture(plantedFiles(), plantedRendered()));
  const open = site as OpenSite;

  expect(open.undoOffered()).toBe(false);
  const result = await fixAll(open);

  expect(result.undoId).not.toBeNull();
  expect(open.undoOffered()).toBe(true);
  await undoFixes(open, result.undoId!);
  expect(open.undoOffered()).toBe(false);
  // Fixes asked for again where there is nothing to fix: nothing changed, nothing kept.
  const none = await applyFixes(open, ["no-such-finding"]).catch(() => ({ undoId: null }));

  expect(none.undoId).toBeNull();
  expect(open.undoOffered()).toBe(false);
}, 120_000);

it("lets go of the batches pushed out by newer ones: with the kept ones undone, nothing is offered any more", async () => {
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
  // The first is no longer offered: asked for, it says so.
  await expect(undoFixes(open, ids[0]!)).rejects.toMatchObject({ code: "not-found" });
  for (const id of ids.slice(1)) await undoFixes(open, id);
  // Had the first been dropped without being let go, its site would still count as having an Undo offered.
  expect(open.undoOffered()).toBe(false);
}, 300_000);
