/**
 * One plain sentence for a publish message. A small model writes it when a key
 * is configured; otherwise — or when that call fails or takes longer than three
 * seconds — a deterministic summary does. Never throws.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ChangeSet, FileChange } from "../types";
import { safeDetail } from "./errors";
import { costFor, SUMMARY_MODEL } from "./models";

export const DESCRIBE_TIMEOUT_MS = 3_000;

function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * A page as the rest of the app names it: the site's root is "Home page"
 * (its title is usually the whole site's name and strapline, which made a
 * message about "the Caddow page"); otherwise the title before any " — "
 * strapline; otherwise the file's name.
 */
export function pageNameOf(file: Pick<FileChange, "path" | "title" | "url" | "kind">): string {
  // The same rule as the app's page names (web: features/preview/clickToEdit entryName), or the address itself.
  const home = file.url === "/" || (/(^|\/)index\.[a-z0-9]+$/i.test(file.path) && /\/pages\/index\.|^src\/content\/index\.|^content\/_?index\./i.test(file.path));

  if (home) return "Home page";
  if (file.title) {
    const short = file.title.split(/ [—–|·] /)[0]?.trim() ?? file.title;

    return short.length >= 3 ? short : file.title;
  }
  return file.path.split("/").pop() ?? file.path;
}

const nameOf = pageNameOf;

/** "Update Home page and About page", "Add 2 images and update Pricing", "Update 7 pages". */
export function deterministicSummary(changes: ChangeSet): string {
  const files = changes.files;

  if (files.length === 0) return "No changes";
  const media = files.filter((f) => f.kind === "media");
  const other = files.filter((f) => f.kind !== "media");
  const parts: string[] = [];

  if (other.length > 0) {
    const added = other.filter((f) => f.status === "added");
    const removed = other.filter((f) => f.status === "deleted");
    const changed = other.filter((f) => f.status === "modified");
    const phrase = (verb: string, group: FileChange[]) => {
      if (group.length === 0) return;
      parts.push(group.length <= 3 ? `${verb} ${listOf(group.map(nameOf))}` : `${verb} ${group.length} ${group.every((f) => f.kind === "content") ? "pages and posts" : "files"}`);
    };

    phrase("update", changed);
    phrase("add", added);
    phrase("remove", removed);
  }
  if (media.length > 0) {
    const verb = media.every((f) => f.status === "added") ? "add" : media.every((f) => f.status === "deleted") ? "remove" : "update";

    parts.push(`${verb} ${media.length === 1 ? "1 image" : `${media.length} images`}`);
  }
  // "Update Home and About, and add 1 image": a comma keeps compound parts apart.
  const sentence = parts.length === 2 && parts.some((part) => part.includes(" and ")) ? parts.join(", and ") : listOf(parts);

  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export interface DescribeDeps {
  client: Anthropic | null;
  record(usage: { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number | null }): Promise<void>;
  log(line: string): void;
}

export async function describeChangeSet(changes: ChangeSet, deps: DescribeDeps): Promise<string> {
  const fallback = deterministicSummary(changes);

  if (!deps.client || changes.files.length === 0) return fallback;
  const listing = changes.files.slice(0, 40).map((file) => ({
    // The page's name as the app shows it, never its full title: the home page's title is the site's own name.
    what: pageNameOf(file),
    kind: file.kind,
    status: file.status,
    summary: file.summary,
    // A moved section is named as moved, or the label alone would read as an edit.
    ...(file.fieldChanges?.length ? { fields: file.fieldChanges.slice(0, 6).map((c) => (c.kind === "moved" ? `${c.label} (moved)` : c.label)) } : {}),
  }));

  try {
    const message = await deps.client.messages.create(
      {
        model: SUMMARY_MODEL,
        max_tokens: 1024,
        output_config: { effort: "low" },
        system:
          "You write the one-line message saved with a website update when it is published. Write a single plain sentence in the imperative, under 72 characters, naming what changed the way an editor would (pages, posts, images, sections) — no file names, no technical words, no quotes, no full stop at the end. Reply with the sentence only.",
        messages: [{ role: "user", content: `These are the changes being published:\n${JSON.stringify(listing)}` }],
      },
      { signal: AbortSignal.timeout(DESCRIBE_TIMEOUT_MS), maxRetries: 0, timeout: DESCRIBE_TIMEOUT_MS }
    );
    const usage = {
      model: SUMMARY_MODEL,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };

    await deps.record({ ...usage, cost: costFor(SUMMARY_MODEL, usage) });
    if (message.stop_reason === "refusal") return fallback;
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^["“']|["”']$/g, "")
      .replace(/\.$/, "");

    return text && text.length <= 120 ? text : fallback;
  } catch (error) {
    deps.log(`describeChanges fell back: ${safeDetail(error, 300)}`);
    return fallback;
  }
}
