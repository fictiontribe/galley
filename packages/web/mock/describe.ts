/**
 * The publish note the engine suggests when no assistant writes one
 * (core/src/ai/describe.ts `deterministicSummary`), and the shorter name a
 * commit gives a page (core/src/site/enrich.ts), done the same way here: the
 * public demo runs on this stand-in, so its words are the ones visitors read.
 * Mocks import only types from the engine, so the rules are repeated, not shared.
 */
import type { FileChange } from "@galley/core/types";

function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * A page as the app names it: the site's root is "Home page" (its title is
 * usually the site's name and strapline); otherwise the title before any
 * " — " strapline; otherwise the file's name.
 */
export function pageNameOf(file: Pick<FileChange, "path" | "title" | "url">): string {
  const home = file.url === "/" || (/(^|\/)index\.[a-z0-9]+$/i.test(file.path) && /\/pages\/index\.|^src\/content\/index\.|^content\/_?index\./i.test(file.path));

  if (home) return "Home page";
  if (file.title) {
    const short = file.title.split(/ [—–|·] /)[0]?.trim() ?? file.title;

    return short.length >= 3 ? short : file.title;
  }
  return file.path.split("/").pop() ?? file.path;
}

/** "Update Home page and About", "Add 2 images and update Pricing", "Update 7 pages and posts". */
export function suggestedNote(files: readonly FileChange[]): string {
  if (files.length === 0) return "No changes";
  const media = files.filter((f) => f.kind === "media");
  const other = files.filter((f) => f.kind !== "media");
  const parts: string[] = [];
  const phrase = (verb: string, group: FileChange[]) => {
    if (group.length === 0) return;
    parts.push(group.length <= 3 ? `${verb} ${listOf(group.map(pageNameOf))}` : `${verb} ${group.length} ${group.every((f) => f.kind === "content") ? "pages and posts" : "files"}`);
  };

  phrase("update", other.filter((f) => f.status === "modified"));
  phrase("add", other.filter((f) => f.status === "added"));
  phrase("remove", other.filter((f) => f.status === "deleted"));
  if (media.length > 0) {
    const verb = media.every((f) => f.status === "added") ? "add" : media.every((f) => f.status === "deleted") ? "remove" : "update";

    parts.push(`${verb} ${media.length === 1 ? "1 image" : `${media.length} images`}`);
  }
  // "Update Home page and About, and add 1 image": a comma keeps compound parts apart.
  const sentence = parts.length === 2 && parts.some((part) => part.includes(" and ")) ? parts.join(", and ") : listOf(parts);

  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** A page's name in a commit made without a note: "Home page", a short title, or the file's words. */
export function commitName(file: Pick<FileChange, "path" | "title" | "url">): string {
  if (file.url === "/") return "Home page";
  if (file.title && file.title.length <= 40) return file.title;
  const slug = file.path.replace(/\.[^./]+$/, "").split("/");
  const last = slug[slug.length - 1] === "index" || slug[slug.length - 1] === "_index" ? slug[slug.length - 2] : slug[slug.length - 1];
  const words = (last ?? file.path).replace(/[-_]+/g, " ").trim();

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : file.path;
}
