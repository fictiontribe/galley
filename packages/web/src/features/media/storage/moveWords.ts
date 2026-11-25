/**
 * The words for how a move of the site's files ended. A file that stays in
 * the repository because the site's code or a template uses it is the move
 * working as meant, so only `problems` make it an error.
 */
import type { MediaMovePlan, MediaMoveResult } from "@galley/core/media-storage/contract";
import { bytes, count } from "@/lib/format";

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

/** "a, b, c and 2 more", as the result of a move lists them. */
function someOf(paths: string[], most = 5): string {
  return paths.length > most ? `${paths.slice(0, most).join(", ")} and ${paths.length - most} more` : paths.join(", ");
}

/**
 * What the repository's copies will do, counted as the move itself will: how
 * many are removed, how many stay, and every file that keeps them there.
 */
function copiesWords(plan: MediaMovePlan): string {
  const stay = plan.stillMentioned ?? [];

  if (plan.keepCopies) return "The repository keeps its copies.";
  if (!stay.length) return "Then the repository’s copies are removed; they leave the site when you publish.";
  const mentioning = [...new Set(stay.flatMap((item) => item.pages))].sort();
  const why = (plan.leftAlone ?? []).some((path) => mentioning.includes(path)) ? " Galley doesn’t change the site’s code or templates, so the files they use stay where they are." : "";
  const where = `still mentioned in ${someOf(mentioning)}.${why}`;

  if (plan.removes === 0) return `None of the repository’s copies are removed: ${stay.length === 1 ? "the file is" : `all ${stay.length} are`} ${where}`;
  return `Then ${plan.removes} of the repository’s copies ${plan.removes === 1 ? "is" : "are"} removed (${plan.removes === 1 ? "it leaves" : "they leave"} the site when you publish) and ${stay.length} ${stay.length === 1 ? "stays" : "stay"}: ${where}`;
}

/** What a move will do, before it does anything: the sentences of the dialog that asks. */
export function planWords(plan: MediaMovePlan): string {
  if (plan.kind === "address") {
    return `${plan.references} ${plan.references === 1 ? "place" : "places"} in ${plan.pages} ${plan.pages === 1 ? "page" : "pages"} will use ${plan.publicUrl} instead. Galley first checks the new address serves the bucket’s files; nothing changes if it doesn’t.`;
  }
  const where = plan.to === "repository" ? "the repository" : plan.to === "images" ? "Cloudflare Images" : "the bucket";
  const parts = [
    `${plan.files} ${plan.files === 1 ? "file" : "files"} (${bytes(plan.bytes)}) will be copied to ${where}${plan.done ? `, ${plan.done} of them already there from an earlier run` : ""}.`,
    `${plan.references} ${plan.references === 1 ? "place" : "places"} in ${plan.pages} ${plan.pages === 1 ? "page" : "pages"} will point at ${plan.to === "repository" ? "the site’s own addresses" : "their full addresses"}.`,
  ];

  if (plan.to !== "repository") parts.push(copiesWords(plan));
  else parts.push(`${plan.from === "images" ? "Cloudflare Images keeps its pictures" : "The bucket keeps its files"}; remove them once the pages are published.`);
  if (plan.unpublished) parts.push(`${plan.unpublished} of them ${plan.unpublished === 1 ? "isn’t" : "aren’t"} published yet: once copied, ${plan.unpublished === 1 ? "it is" : "they are"} public at ${plan.unpublished === 1 ? "its address" : "their addresses"}, and ${plan.unpublished === 1 ? "waits" : "wait"} in Proof.`);
  if (plan.staying) parts.push(`${plan.staying.files} stay where they are: ${plan.staying.reason}`);
  if (plan.problems.length) parts.push(`${plan.problems.length} can’t be moved: ${plan.problems.map((problem) => `${problem.path} (${problem.reason})`).join("; ")}.`);
  return parts.join(" ");
}
