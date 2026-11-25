/**
 * The words for a move of the site's files: what it will do, and how it
 * ended. A file that stays in the repository because something the site is
 * built from still uses it is the move working as meant, so only `problems`
 * make it an error.
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

/** "a, b, c and 2 more", as the result of a move lists them. */
function someOf(paths: string[], most = 5): string {
  return paths.length > most ? `${paths.slice(0, most).join(", ")} and ${paths.length - most} more` : paths.join(", ");
}

/**
 * A file that keeps a copy, with what reads it when that is why it counts:
 * one outside the folders the site is built from that a file of the site's
 * source reads ("data/team.json (read by src/lib/team.ts)").
 */
function withReaders(path: string, readBy: MediaMovePlan["readBy"]): string {
  const readers = readBy?.[path];

  return readers?.length ? `${path} (read by ${someOf(readers, 2)})` : path;
}

/** One file that stayed, and what still uses it. */
export function stayedLine(item: MediaMoveResult["stayed"][number], readBy?: MediaMoveResult["readBy"]): string {
  return `${item.path}: still used by ${item.pages.map((path) => withReaders(path, readBy)).join(", ")}`;
}

/**
 * The line of its own for files that name what is moving but that nothing
 * the site is built from reads (a README, a record, a script outside its
 * source): they aren't changed and keep no file. Galley can't follow every
 * way a build reads a file, so the line says what to do when it missed one.
 * Null when there are none.
 */
export function alsoMentionedWords(plan: Pick<MediaMovePlan, "alsoMentioned">): string | null {
  const paths = plan.alsoMentioned ?? [];
  const one = paths.length === 1;

  if (!paths.length) return null;
  return `Also mentioned in ${someOf(paths)}. Nothing the site is built from reads ${one ? "it" : "them"}, as far as Galley can follow, so ${one ? "it isn’t" : "they aren’t"} changed and ${one ? "keeps" : "keep"} no copy. If the build does read ${one ? "it" : "one"}, name it in build.sources first.`;
}

/**
 * What the repository's copies will do, counted as the move itself will: how
 * many are removed, how many stay, what keeps them there, and what to do
 * about it.
 */
function copiesWords(plan: MediaMovePlan): string {
  const stay = plan.stillMentioned ?? [];

  if (plan.keepCopies) return "The repository keeps its copies.";
  if (!stay.length) return "Then the repository’s copies are removed; they leave the site when you publish.";
  const using = [...new Set(stay.flatMap((item) => item.pages))].sort();
  const alone = (plan.leftAlone ?? []).filter((path) => using.includes(path));
  const one = alone.length === 1;
  const why = alone.length
    ? ` The site is built from ${one ? "that file" : "those files"} and a move doesn’t change ${one ? "it" : "them"}. To move what ${one ? "it uses" : "they use"} too, put the new addresses there by hand or in build mode, then run the move again.`
    : "";
  const where = `still used by ${someOf(using.map((path) => withReaders(path, plan.readBy)))}.${why}`;

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
    `${plan.references} ${plan.references === 1 ? "place" : "places"} in ${plan.pages} ${plan.pages === 1 ? "page" : "pages"}${plan.templates ? ` and ${plan.templates} page ${plan.templates === 1 ? "template" : "templates"}` : ""} will point at ${plan.to === "repository" ? "the site’s own addresses" : "their full addresses"}.`,
  ];

  if (plan.to !== "repository") parts.push(copiesWords(plan));
  else parts.push(`${plan.from === "images" ? "Cloudflare Images keeps its pictures" : "The bucket keeps its files"}; remove them once the pages are published.`);
  if (plan.unpublished) parts.push(`${plan.unpublished} of them ${plan.unpublished === 1 ? "isn’t" : "aren’t"} published yet: once copied, ${plan.unpublished === 1 ? "it is" : "they are"} public at ${plan.unpublished === 1 ? "its address" : "their addresses"}, and ${plan.unpublished === 1 ? "waits" : "wait"} in Proof.`);
  if (plan.staying) parts.push(`${plan.staying.files} stay where they are: ${plan.staying.reason}`);
  if (plan.problems.length) parts.push(`${plan.problems.length} can’t be moved: ${plan.problems.map((problem) => `${problem.path} (${problem.reason})`).join("; ")}.`);
  return parts.join(" ");
}
