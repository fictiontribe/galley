/**
 * The words for how a move of the site's files ended. A file that stays in
 * the repository because the site's code or a template uses it is the move
 * working as meant, so only `problems` make it an error.
 */
import type { MediaMoveResult } from "@galley/core/media-storage/contract";
import { count } from "@/lib/format";

/** The heading over how a move ended. */
export function moveTitle(result: Pick<MediaMoveResult, "request" | "state" | "problems">): string {
  const { request } = result;

  if (result.state === "error") {
    if (request.kind === "address") return "The address wasn’t changed";
    return result.problems.length ? `The move finished with ${count(result.problems.length, "problem")}` : "The move stopped";
  }
  if (request.kind === "address") return "The files’ address was changed";
  if (request.to === "repository") return "The files are back in the repository";
  return request.to === "images" ? "The pictures were moved to Cloudflare Images" : "The files were moved to the bucket";
}

/** What opens the list of the files that stayed in the repository. */
export function stayedLabel(result: Pick<MediaMoveResult, "stayedFiles">): string {
  return result.stayedFiles === 1 ? "The file that stayed" : `The ${result.stayedFiles} files that stayed`;
}

/** One file that stayed, and where it is still mentioned. */
export function stayedLine(item: MediaMoveResult["stayed"][number]): string {
  return `${item.path}: still mentioned in ${item.pages.join(", ")}`;
}
