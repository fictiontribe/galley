/**
 * Deterministic fixes: the edits a finding proposed, applied through
 * SiteService as ordinary changes (they show in Proof like any other), with
 * one checkpoint per batch so the whole batch can be undone at once. A fix
 * is applied only to the file as it was when it was checked: if the page
 * changed since, the fix is refused and the page should be checked again.
 */
import { randomUUID } from "node:crypto";
import { GalleyError } from "../errors";
import { UNDO_LOST } from "../workspace/index";
import { isRedirectsFile } from "../redirects/locate";
import type { Checkpoint, SiteModel, SiteService, UndoResult } from "../types";
import { auditSite, lastFinding } from "./audit";
import type { FixProposal, FixResult } from "./types";

const UNDO_KEEP = 20;
const undo = new Map<string, { root: string; checkpoint: Checkpoint }>();

/** Lets go of what a batch's checkpoint kept, once its Undo is no longer offered (the facade's type doesn't promise `release`). */
function release(checkpoint: Checkpoint): void {
  void (checkpoint as Checkpoint & { release?: () => Promise<void> }).release?.().catch(() => undefined);
}


/**
 * Why a fix may not be applied at all, or null. A second guard behind the
 * audit, which already leaves the redirects list out: its old addresses are
 * meant to match no page, and "pointing" one at the new address turns a
 * redirect into a page redirecting to itself.
 */
export function fixRefusal(model: Pick<SiteModel, "collections" | "media" | "redirects">, fix: Pick<FixProposal, "edits">): string | null {
  if (fix.edits.some((edit) => isRedirectsFile(model, edit.path))) return "Redirects are changed on the Redirects screen, not by a fix.";
  return null;
}

export async function applyFixes(site: SiteService, ids: string[]): Promise<FixResult> {
  if (!ids.length) return { applied: [], refused: [], undoId: null };
  if (ids.some((id) => !lastFinding(site, id))) await auditSite(site);
  const model = await site.model();
  const checkpoint = site.checkpoint("Search & AI fixes");
  const hashes = new Map<string, string>();
  const result: FixResult = { applied: [], refused: [], undoId: null };

  try {
    for (const id of ids) {
      const known = lastFinding(site, id);

      if (!known) {
        result.refused.push({ id, reason: "That problem isn't there any more." });
        continue;
      }
      const fix = known.finding.fix;

      if (!fix) {
        result.refused.push({ id, reason: "This one needs a person (or the assistant) to decide what to write." });
        continue;
      }
      const refusal = fixRefusal(model, fix);

      if (refusal) {
        result.refused.push({ id, reason: refusal });
        continue;
      }
      let ok = true;

      for (const edit of fix.edits) {
        const baseHash = hashes.get(edit.path) ?? (edit.path === known.finding.path ? known.hash : undefined);

        try {
          const outcome = await checkpoint.run(() => site.updateEntry(edit.path, edit.ops, { origin: "user", ...(baseHash ? { baseHash } : {}) }));

          if (outcome.refused.length) {
            ok = false;
            result.refused.push({ id, reason: outcome.refused[0]!.reason });
            break;
          }
          hashes.set(edit.path, outcome.entry.hash);
        } catch (error) {
          ok = false;
          result.refused.push({ id, reason: error instanceof GalleyError && error.code === "conflict" ? "The page changed since it was checked. Check again, then fix." : error instanceof Error ? error.message : String(error) });
          break;
        }
      }
      if (ok) result.applied.push({ id, path: fix.edits[0]?.path ?? known.finding.path ?? "" });
    }
  } finally {
    checkpoint.close();
  }
  if (checkpoint.paths().length) {
    const undoId = randomUUID();

    // Not offered as an Undo that keeps the site open: the editor offers a batch's Undo for a few seconds, not an hour.
    undo.set(undoId, { root: site.root, checkpoint });
    // The oldest batches past the last few are no longer offered: what they kept is let go with them.
    while (undo.size > UNDO_KEEP) {
      const oldest = undo.keys().next().value as string;

      release(undo.get(oldest)!.checkpoint);
      undo.delete(oldest);
    }
    result.undoId = undoId;
  } else release(checkpoint);
  return result;
}

/** Puts back every file one batch of fixes changed, except those someone else has changed since. */
export async function undoFixes(site: SiteService, undoId: string): Promise<UndoResult> {
  const held = undo.get(undoId);

  if (!held || held.root !== site.root) throw new GalleyError("not-found", "Those fixes can't be undone from here any more. You can still discard them in Proof.");
  // Taken off the list while it runs, so a second undo of the same batch asked meanwhile is refused rather than run twice.
  undo.delete(undoId);
  try {
    const restored = await held.checkpoint.restore();
    const left = held.checkpoint.left();

    release(held.checkpoint);
    return { restored, left };
  } catch (error) {
    // Let go with its site: nothing is left to keep. Refused before it began (the settings file, for someone below the
    // settings level): still offered, so someone who may can undo it.
    if (error instanceof GalleyError && error.message === UNDO_LOST) release(held.checkpoint);
    else undo.set(undoId, held);
    throw error;
  }
}
