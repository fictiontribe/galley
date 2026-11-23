/**
 * Deterministic fixes: the edits a finding proposed, applied through
 * SiteService as ordinary changes (they show in Proof like any other), with
 * one checkpoint per batch so the whole batch can be undone at once. A fix
 * is applied only to the file as it was when it was checked: if the page
 * changed since, the fix is refused and the page should be checked again.
 */
import { randomUUID } from "node:crypto";
import { GalleyError } from "../errors";
import { isRedirectsFile } from "../redirects/locate";
import type { Checkpoint, SiteModel, SiteService } from "../types";
import { auditSite, lastFinding } from "./audit";
import type { FixProposal, FixResult } from "./types";

const UNDO_KEEP = 20;
const undo = new Map<string, { root: string; checkpoint: Checkpoint }>();

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
          const outcome = await site.updateEntry(edit.path, edit.ops, { origin: "user", ...(baseHash ? { baseHash } : {}) });

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

    undo.set(undoId, { root: site.root, checkpoint });
    while (undo.size > UNDO_KEEP) undo.delete(undo.keys().next().value as string);
    result.undoId = undoId;
  }
  return result;
}

/** Puts back every file one batch of fixes changed. */
export async function undoFixes(site: SiteService, undoId: string): Promise<string[]> {
  const held = undo.get(undoId);

  if (!held || held.root !== site.root) throw new GalleyError("not-found", "Those fixes can't be undone from here any more. You can still discard them in Proof.");
  undo.delete(undoId);
  return held.checkpoint.restore();
}
