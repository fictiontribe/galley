/**
 * Content-mode tools: everything an editor can do — find, read and change
 * entries, look at media, make an image, ask a question. All of it goes
 * through SiteService; nothing here touches the filesystem or the network.
 */
import { z } from "zod";
import { PLACEHOLDER_PROVIDER } from "../images/catalog";
import { GalleyError } from "../../errors";
import type { EditOp, Entry, FieldPath, JsonValue } from "../../types";
import { describeFields } from "../site-card";
import { entryName, plural, quoted } from "./labels";
import { checkPageDraws, drawWarning } from "./draws";
import { CHANGED_AFTER_READ, forgetVersion, rememberVersion, versionRead } from "./reads";
import { defineTool, ok, READ_ONLY, refuse, type AssistantTool, type ToolContext } from "./types";
import { siteImageryBrief } from "../../sitebrand/tools";

const BODY_PAGE = 8_000;
const DATA_INLINE = 12_000;

const fieldPathInput = z
  .union([z.string(), z.array(z.union([z.string(), z.number().int().min(0)]))])
  .describe(
    'Where in the entry. A dotted path such as "title", "hero.heading" or "sections.2.heading" (numbers are positions in a list, counting from 0), or the same as an array: ["sections", 2, "heading"].'
  );

/** "sections.2.heading" → ["sections", 2, "heading"]. */
export function toFieldPath(input: string | Array<string | number>): FieldPath {
  if (Array.isArray(input)) return input;
  const trimmed = input.trim();

  if (trimmed === "") return [];
  return trimmed
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment !== "")
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function valueAt(data: unknown, path: FieldPath): unknown {
  let node: unknown = data;

  for (const segment of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[segment];
  }
  return node;
}

function isJson(value: unknown): value is JsonValue {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

function remember(ctx: ToolContext, path: string, title: string | undefined): void {
  if (title) ctx.titles.set(path, title);
}

/** A big data object, summarised so the model can ask for the part it needs. */
function summarizeData(data: Record<string, JsonValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      out[key] = {
        list: value.length,
        items: value.slice(0, 40).map((item, index) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const record = item as Record<string, JsonValue>;
            const kind = record.type ?? record._type ?? record._component ?? record.block;
            const heading = record.heading ?? record.title ?? record.name ?? record.label;

            return { index, ...(kind !== undefined ? { type: kind } : {}), ...(typeof heading === "string" ? { heading: heading.slice(0, 80) } : {}) };
          }
          return { index, value: typeof item === "string" ? item.slice(0, 80) : item };
        }),
      };
    } else if (value && typeof value === "object") {
      out[key] = { object: Object.keys(value) };
    } else {
      out[key] = typeof value === "string" && value.length > 300 ? `${value.slice(0, 300)}… (${value.length} characters)` : value;
    }
  }
  return out;
}

function outline(body: string): Array<{ at: number; heading: string }> {
  const headings: Array<{ at: number; heading: string }> = [];
  const pattern = /^(#{1,6})\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) && headings.length < 60) headings.push({ at: match.index, heading: `${match[1]} ${match[2]?.trim()}` });
  return headings;
}

function issuesOf(entry: Entry, severity?: "error") {
  return entry.issues
    .filter((issue) => !severity || issue.severity === severity)
    .slice(0, 20)
    .map((issue) => ({ severity: issue.severity, message: issue.message, ...(issue.field ? { field: issue.field.join(".") } : {}) }));
}

const listCollections = defineTool({
  name: "list_collections",
  title: "List the collections",
  description:
    "List the site's collections (pages, posts, data files…) with how many items each has. The site card already describes them; use this for current counts or when you need to know which collections allow new items.",
  input: z.object({}),
  mode: "any",
  effect: READ_ONLY,
  surface: "assistant",
  label: () => "Looking at what the site contains",
  async run(_input, ctx) {
    return ok(
      ctx.model.collections.map((c) => ({
        id: c.id,
        label: c.label,
        singular: c.singular,
        kind: c.kind,
        path: c.path,
        url: c.url,
        items: c.count,
        canCreate: c.create,
      })),
      "Looked at what the site contains"
    );
  },
});

const listEntries = defineTool({
  name: "list_entries",
  title: "List entries",
  description:
    "List the entries in one collection — their titles, paths and page URLs — optionally filtered by a search word. Use it to find the entry a request is about before reading it, and to check that a page you want to link to exists. Results are paged: pass offset for more.",
  input: z.object({
    collection: z.string().describe("The collection id from the site card, e.g. \"pages\"."),
    search: z.string().optional().describe("Only entries whose title or path contains this text."),
    limit: z.number().int().min(1).max(50).optional().describe("How many to return (default 20, at most 50)."),
    offset: z.number().int().min(0).optional(),
  }),
  mode: "any",
  effect: READ_ONLY,
  label: (input, ctx) => `Listing ${ctx.model.collections.find((c) => c.id === input.collection)?.label.toLowerCase() ?? "entries"}`,
  async run(input, ctx) {
    const limit = input.limit ?? 20;
    const list = await ctx.site.listEntries(input.collection, { search: input.search, limit, offset: input.offset ?? 0, sort: "title" });
    const label = ctx.model.collections.find((c) => c.id === input.collection)?.label.toLowerCase() ?? "entries";

    for (const item of list.items) remember(ctx, item.path, item.title);
    return ok(
      {
        total: list.total,
        offset: input.offset ?? 0,
        items: list.items.map((item) => ({
          path: item.path,
          title: item.title,
          url: item.url,
          ...(item.date ? { date: item.date } : {}),
          ...(item.draft ? { draft: true } : {}),
          ...(item.status !== "clean" ? { status: item.status } : {}),
        })),
        ...(list.total > (input.offset ?? 0) + list.items.length ? { more: `pass offset ${(input.offset ?? 0) + list.items.length} for the next page` } : {}),
      },
      `Listed ${plural(list.total, "item")} in ${label}`
    );
  },
});

const readEntry = defineTool({
  name: "read_entry",
  title: "Read an entry",
  description:
    "Read one entry: its fields, its main text, the fields its collection defines, and any problems found in it. Always read an entry in the current turn before changing it, and use the returned hash as baseHash when you update it. Large entries come back summarised — pass `field` to read one part (for example \"sections.3\") or `bodyOffset` to read further into the main text.",
  input: z.object({
    path: z.string().describe("The entry's path, as listed by list_entries or search_content."),
    field: fieldPathInput.optional(),
    bodyOffset: z.number().int().min(0).optional().describe("Start reading the main text at this character position."),
  }),
  mode: "any",
  effect: READ_ONLY,
  label: (input, ctx) => `Reading ${entryName(input.path, ctx.model, ctx.titles)}`,
  async run(input, ctx) {
    const entry = await ctx.site.readEntry(input.path);

    remember(ctx, entry.path, entry.title);
    rememberVersion(ctx, entry.path, entry.hash);
    const done = `Read ${entryName(entry.path, ctx.model, ctx.titles)}`;
    const base = { path: entry.path, collection: entry.collection, title: entry.title, url: entry.url, format: entry.format, hash: entry.hash };

    if (input.field !== undefined) {
      const path = toFieldPath(input.field);
      const value = valueAt(entry.data, path);

      if (value === undefined) return refuse(`This entry has nothing at “${path.join(".")}”. Read it without \`field\` to see what it has.`, done);
      return ok({ ...base, field: path.join("."), value }, done);
    }
    const dataText = JSON.stringify(entry.data);
    const data = dataText.length > DATA_INLINE ? summarizeData(entry.data) : entry.data;
    let body: Record<string, unknown> | null = null;

    if (entry.body !== null) {
      const from = Math.min(input.bodyOffset ?? 0, entry.body.length);
      const to = Math.min(entry.body.length, from + BODY_PAGE);

      body = {
        text: entry.body.slice(from, to),
        from,
        to,
        total: entry.body.length,
        ...(to < entry.body.length ? { more: `the text continues; pass bodyOffset ${to} to read on`, outline: outline(entry.body) } : {}),
      };
    }
    return ok(
      {
        ...base,
        ...(dataText.length > DATA_INLINE ? { note: "The fields are summarised because the entry is large. Read one part with `field`, e.g. \"sections.2\"." } : {}),
        data,
        body,
        fields: describeFields(entry.fields).map((line) => line.trim()),
        issues: issuesOf(entry),
      },
      done
    );
  },
});

const searchContent = defineTool({
  name: "search_content",
  title: "Search the content",
  description:
    "Search every page, post and data file for a word or phrase. Returns where each match is (which entry, which field or part of the main text) with the text around it. Use it to find text the person quoted or to find every place something is mentioned.",
  input: z.object({
    query: z.string().min(1),
    collection: z.string().optional().describe("Only search this collection."),
    limit: z.number().int().min(1).max(30).optional().describe("Default 15."),
  }),
  mode: "any",
  effect: READ_ONLY,
  label: (input) => `Searching for ${quoted(input.query)}`,
  async run(input, ctx) {
    const hits = await ctx.site.search(input.query, { collection: input.collection, limit: input.limit ?? 15 });

    for (const hit of hits) remember(ctx, hit.path, hit.title);
    return ok(
      hits.map((hit) => ({
        path: hit.path,
        title: hit.title,
        url: hit.url,
        where:
          hit.location.kind === "field"
            ? `field ${hit.location.field.join(".")}`
            : hit.location.kind === "body"
              ? `main text, characters ${hit.location.start}–${hit.location.end}`
              : `line ${hit.location.line}`,
        excerpt: hit.excerpt,
      })),
      `Searched for ${quoted(input.query)} · ${plural(hits.length, "match", "matches")}`
    );
  },
});

const jsonValue = z.unknown().describe("Any value: text, a number, true/false, a list, or an object such as a whole section.");

const editOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), path: fieldPathInput, value: jsonValue }).describe("Set one field (or one list item, or a whole section) to a new value."),
  z.object({ op: z.literal("unset"), path: fieldPathInput }).describe("Remove an optional field."),
  z
    .object({
      op: z.literal("insert"),
      path: fieldPathInput.describe("The list to insert into, e.g. \"sections\"."),
      index: z.number().int().min(0).optional().describe("Position for the new item (0 is first). Leave out to add at the end."),
      value: jsonValue,
    })
    .describe("Add an item to a list — a new section, a new link, a new feature."),
  z
    .object({ op: z.literal("move"), path: fieldPathInput.describe("The list, e.g. \"sections\"."), from: z.number().int().min(0), to: z.number().int().min(0) })
    .describe("Move a list item to another position."),
  z
    .object({ op: z.literal("remove"), path: fieldPathInput.describe("The list, e.g. \"sections\"."), index: z.number().int().min(0) })
    .describe("Remove one item from a list."),
  z
    .object({
      op: z.literal("body-replace"),
      find: z.string().min(1).describe("Exact text in the main text, copied from read_entry."),
      replace: z.string(),
      all: z.boolean().optional().describe("Replace every occurrence. Without it the text must occur exactly once."),
    })
    .describe("Replace text inside the main text (markdown body). Best for small changes in long text."),
  z.object({ op: z.literal("body"), value: z.string() }).describe("Replace the whole main text."),
]);

type EditOpInput = z.infer<typeof editOp>;

async function toEditOps(input: EditOpInput[], ctx: ToolContext, path: string): Promise<EditOp[]> {
  let entry: Entry | null = null;
  const ops: EditOp[] = [];

  for (const op of input) {
    switch (op.op) {
      case "set":
      case "insert": {
        if (!isJson(op.value)) throw new GalleyError("invalid", "One of the values isn't plain data (text, numbers, lists or objects).");
        if (op.op === "set") {
          ops.push({ op: "set", path: toFieldPath(op.path), value: op.value as JsonValue });
          break;
        }
        let index = op.index;

        if (index === undefined) {
          entry ??= await ctx.site.readEntry(path);
          const list = valueAt(entry.data, toFieldPath(op.path));

          index = Array.isArray(list) ? list.length : 0;
        }
        ops.push({ op: "insert", path: toFieldPath(op.path), index, value: op.value as JsonValue });
        break;
      }
      case "unset":
        ops.push({ op: "unset", path: toFieldPath(op.path) });
        break;
      case "move":
        ops.push({ op: "move", path: toFieldPath(op.path), from: op.from, to: op.to });
        break;
      case "remove":
        ops.push({ op: "remove", path: toFieldPath(op.path), index: op.index });
        break;
      case "body-replace":
        ops.push({ op: "body-replace", find: op.find, replace: op.replace, ...(op.all ? { all: true } : {}) });
        break;
      case "body":
        ops.push({ op: "body", value: op.value });
        break;
    }
  }
  return ops;
}

const updateEntry = defineTool({
  name: "update_entry",
  title: "Change an entry",
  description:
    "Change an existing entry with a list of edits, applied in order: set a field, add/move/remove a list item or page section, replace text in the main text, or replace the main text. Only the bytes you change are touched; formatting and comments elsewhere are kept. The entry must have been read with read_entry in this conversation, and is changed only if it is still what you read (or the version you pass as baseHash): when it has changed since, nothing is changed and you read it again. The result says which edits were applied and which were refused (with the reason), and lists any errors the entry now has — fix errors your edits caused before finishing.",
  input: z.object({
    path: z.string(),
    ops: z.array(editOp).min(1).max(50),
    baseHash: z.string().optional().describe("The hash read_entry returned. Left out: the version you last read or wrote in this conversation."),
  }),
  mode: "any",
  effect: { readOnly: false, destructive: true, idempotent: false, openWorld: false },
  label: (input, ctx) => `Updating ${entryName(input.path, ctx.model, ctx.titles)}`,
  async run(input, ctx) {
    const name = entryName(input.path, ctx.model, ctx.titles);
    // Always with the version the edit was made from. An edit that names none and has read none is made from nothing
    // this conversation has seen (or from an earlier reply's reading that is no longer remembered): it changes nothing.
    const baseHash = input.baseHash || versionRead(ctx, input.path);

    if (!baseHash) return refuse("You haven't read this entry in this conversation, so nothing was changed. Read it with read_entry first, then make your change.", `Couldn't edit ${name}`);
    const ops = await toEditOps(input.ops, ctx, input.path);
    let result: Awaited<ReturnType<typeof ctx.site.updateEntry>>;

    try {
      result = await ctx.site.updateEntry(input.path, ops, { origin: "agent", mode: ctx.mode, baseHash });
    } catch (error) {
      if (!(error instanceof GalleyError && error.code === "conflict")) throw error;
      // Never worked out again for the assistant: what it sent was made from text that is no longer there.
      return refuse(`The entry ${CHANGED_AFTER_READ}, so nothing was changed. Read it again with read_entry, then make your change to what is there now.`, `Couldn't edit ${name}`);
    }
    remember(ctx, result.entry.path, result.entry.title);
    // What it wrote is what it knows: the next edit can follow without another read.
    if (result.applied > 0) rememberVersion(ctx, result.entry.path, result.entry.hash);
    const summary = {
      applied: result.applied,
      refused: result.refused.map((r) => ({ edit: r.index, reason: r.reason })),
      hash: result.entry.hash,
      url: result.entry.url,
      errors: issuesOf(result.entry, "error"),
    };

    if (result.applied === 0 && result.refused.length > 0) return { content: JSON.stringify(summary), isError: true, doneLabel: `Couldn't edit ${name}` };
    if (result.applied === 0) return ok({ ...summary, note: "Nothing changed: the entry already had those values." }, `Checked ${name} — already up to date`);
    // Not success if the page stopped drawing: the assistant hears it from the same signal the preview does.
    const warning = result.entry.url ? drawWarning(result.entry.url, await checkPageDraws(ctx.site, result.entry.url)) : null;
    return ok(warning ? { ...summary, warning } : summary, `Edited ${name}`);
  },
});

const createEntry = defineTool({
  name: "create_entry",
  title: "Create an entry",
  description:
    "Create a new entry (a page, a post, a team member…) in a collection that allows new items. Give it a slug — lowercase words joined by hyphens — and its fields; include every required field from the site card. For collections with a main text, pass it as markdown in body. Returns the new entry's path, page URL and any problems.",
  input: z.object({
    collection: z.string(),
    slug: z.string().min(1).describe("e.g. \"spring-opening-hours\". May contain \"/\" for nested entries."),
    data: z.record(z.string(), z.unknown()).describe("The fields, by key."),
    body: z.string().optional().describe("The main text, in markdown."),
  }),
  mode: "any",
  effect: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
  label: (input, ctx) => {
    const collection = ctx.model.collections.find((c) => c.id === input.collection);
    const title = typeof input.data.title === "string" ? ` ${quoted(input.data.title)}` : "";

    return `Writing a new ${collection?.singular.toLowerCase() ?? "entry"}${title}`;
  },
  async run(input, ctx) {
    if (!isJson(input.data)) return refuse("The fields must be plain data (text, numbers, lists or objects).");
    const entry = await ctx.site.createEntry(
      { collection: input.collection, slug: input.slug, data: input.data as Record<string, JsonValue>, ...(input.body !== undefined ? { body: input.body } : {}) },
      { origin: "agent", mode: ctx.mode }
    );

    remember(ctx, entry.path, entry.title);
    // It wrote the entry, so it knows it: it can go on to change it without reading it back.
    rememberVersion(ctx, entry.path, entry.hash);
    return ok(
      { path: entry.path, url: entry.url, title: entry.title, hash: entry.hash, issues: issuesOf(entry) },
      `Created ${entryName(entry.path, ctx.model, ctx.titles)}`
    );
  },
});

const deleteEntry = defineTool({
  name: "delete_entry",
  title: "Delete an entry",
  description:
    "Delete an entry. Only when the person asked for it to be removed, or the task plainly requires it (for example replacing sample content). It can be undone until they publish.",
  input: z.object({ path: z.string() }),
  mode: "any",
  effect: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
  label: (input, ctx) => `Deleting ${entryName(input.path, ctx.model, ctx.titles)}`,
  async run(input, ctx) {
    const name = entryName(input.path, ctx.model, ctx.titles);
    // With the version it read, when it has read the entry: one that has changed since (newer versions came in, someone
    // saved) is not deleted as it now is on the strength of what it was. An entry it never read is deleted as asked.
    const read = versionRead(ctx, input.path);

    try {
      await ctx.site.deleteEntry(input.path, { origin: "agent", ...(read ? { baseHash: read } : {}) });
    } catch (error) {
      if (!(read && error instanceof GalleyError && error.code === "conflict")) throw error;
      return refuse(`The entry ${CHANGED_AFTER_READ}, so it wasn't deleted. Read it again with read_entry, and delete it only if that is still what the person wants.`, `Couldn't delete ${name}`);
    }
    forgetVersion(ctx, input.path);
    return ok({ deleted: input.path }, `Deleted ${name}`);
  },
});

const listMedia = defineTool({
  name: "list_media",
  title: "List images and files",
  description:
    "List the images and files in the site's media library, with their site URLs and sizes. Use it to find an existing image to place on a page; use the url value exactly as given.",
  input: z.object({
    search: z.string().optional().describe("Only files whose name contains this text."),
    limit: z.number().int().min(1).max(100).optional().describe("Default 40."),
    offset: z.number().int().min(0).optional(),
  }),
  mode: "any",
  effect: READ_ONLY,
  label: (input) => (input.search ? `Looking for images matching ${quoted(input.search)}` : "Looking through the images"),
  async run(input, ctx) {
    const all = await ctx.site.listMedia();
    const needle = input.search?.toLowerCase();
    const matching = needle ? all.filter((item) => item.path.toLowerCase().includes(needle)) : all;
    const offset = input.offset ?? 0;
    const page = matching.slice(offset, offset + (input.limit ?? 40));

    return ok(
      {
        total: matching.length,
        items: page.map((item) => ({ url: item.url, path: item.path, type: item.type, ...(item.width ? { width: item.width, height: item.height } : {}) })),
        ...(matching.length > offset + page.length ? { more: `pass offset ${offset + page.length} for more` } : {}),
      },
      `Looked through ${plural(matching.length, "image")}`
    );
  },
});

const generateImage = defineTool({
  name: "generate_image",
  title: "Generate an image",
  description:
    "Generate one image with the image provider chosen in Settings and save it into the site's media. Returns its site URL; then place it on a page with update_entry (and write alt text that describes it). Use it when the person asks for an image, or when a task calls for new imagery. Describe the picture concretely — subject, setting, composition, mood — and never ask for text, logos or real people's likenesses in the image.",
  input: z.object({
    prompt: z.string().min(3).max(2000).describe("What the image shows."),
    aspect: z.enum(["1:1", "16:9", "4:3", "3:2", "9:16", "3:4", "2:3"]).optional().describe("Shape; default 1:1. Heroes are usually 16:9 or 3:2."),
    style: z.string().max(300).optional().describe("A style direction, e.g. \"soft watercolour illustration\"."),
    filename: z.string().max(80).optional().describe("A short name hint for the file, e.g. \"team-at-work\"."),
  }),
  mode: "any",
  effect: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
  label: () => "Generating an image",
  async run(input, ctx) {
    const brandDirection = await siteImageryBrief(ctx.site);
    const candidates = await ctx.images.generate(
      { prompt: input.prompt, aspect: input.aspect ?? "1:1", count: 1, ...(input.style ? { style: input.style } : {}), ...(brandDirection ? { brandDirection } : {}) },
      { site: ctx.site, siteId: ctx.siteId, signal: ctx.signal }
    );
    const candidate = candidates[0];

    if (!candidate) return refuse("The image provider didn't return an image.", "Couldn't generate an image");
    const item = await ctx.images.save(ctx.site, { candidateId: candidate.id, ...(input.filename ? { filename: input.filename } : {}) }, "agent");

    const placeholder = candidate.provider === PLACEHOLDER_PROVIDER;

    return ok(
      {
        url: item.url,
        path: item.path,
        width: item.width ?? candidate.width,
        height: item.height ?? candidate.height,
        provider: candidate.provider,
        ...(placeholder
          ? { placeholder: "This is placeholder artwork, not a real picture: no image service is chosen in Settings. Say so to the person, and that choosing one there gives real images." }
          : {}),
      },
      placeholder ? "Made placeholder artwork" : "Generated an image"
    );
  },
});

const validate = defineTool({
  name: "validate",
  title: "Check for problems",
  description:
    "Check entries for problems: missing required fields, wrong types, images that don't exist, links to pages that don't exist. With no paths it checks everything changed since the last publish. Run it after larger changes.",
  input: z.object({ paths: z.array(z.string()).max(50).optional() }),
  mode: "any",
  effect: READ_ONLY,
  label: () => "Checking the changes",
  async run(input, ctx) {
    const issues = await ctx.site.validate(input.paths);
    const errors = issues.filter((issue) => issue.severity === "error");

    return ok(
      {
        errors: errors.length,
        warnings: issues.length - errors.length,
        issues: issues.slice(0, 50).map((issue) => ({ severity: issue.severity, message: issue.message, path: issue.path, ...(issue.field ? { field: issue.field.join(".") } : {}) })),
      },
      errors.length ? `Found ${plural(errors.length, "problem")}` : "Checked the changes · no problems"
    );
  },
});

const askUser = defineTool({
  name: "ask_user",
  title: "Ask the person a question",
  description:
    "Ask the person one short question, with two to four concrete answers shown as buttons, and end your turn. Use it only when the request is genuinely ambiguous (which page, which of two identical texts, which wording) — not when it is specific enough to act on, and never twice in a row. Their answer arrives as their next message.",
  input: z.object({
    question: z.string().min(5).max(300),
    options: z
      .array(z.object({ label: z.string().min(1).max(60), detail: z.string().max(120).optional() }))
      .min(2)
      .max(4),
  }),
  mode: "any",
  effect: READ_ONLY,
  surface: "assistant",
  label: () => "Asking a question",
  async run(input, ctx) {
    if (ctx.question) return refuse("You already asked a question in this reply. Ask one at a time.");
    if (ctx.askedLastTurn) {
      return refuse(
        "Your previous message was already a question. Don't ask again: act on the person's answer, make the most reasonable choice for anything still open, and say what you chose."
      );
    }
    ctx.question = { text: input.question.trim(), options: input.options.map((o) => ({ label: o.label, ...(o.detail ? { detail: o.detail } : {}) })) };
    return ok({ shown: true, note: "The question is on screen with its answer buttons. Their answer will arrive as their next message; end your turn now." }, "Asked a question");
  },
});

export const CONTENT_TOOLS: AssistantTool[] = [
  listCollections,
  listEntries,
  readEntry,
  searchContent,
  updateEntry,
  createEntry,
  deleteEntry,
  listMedia,
  generateImage,
  validate,
  askUser,
];
