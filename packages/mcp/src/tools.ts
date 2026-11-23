/**
 * The verbs MCP adds to the shared registry: the ones the app's own UI
 * performs around the built-in assistant — describe the site, find where a
 * visible text lives, add a file to the media library, read the proof,
 * discard, publish, version history, undo a publish, and run the preview.
 *
 * Like the registry tools, every one of them goes through SiteService and
 * nothing below it; refusals come back as tool errors in plain words.
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, sep } from "node:path";
import { z } from "zod";
import { GalleyError } from "@galley/core";
import { buildSiteCard, loadInstructionFiles, READ_ONLY, type ToolEffect } from "@galley/core/ai";
import type { AgentMode, ChangeSet, Field, FileChange, JsonValue, PublishResult, SiteModel, SiteService, SourceLocation } from "@galley/core/types";

export interface HarnessContext {
  site: SiteService;
  model: SiteModel;
  /** The mode calls run in for this site (build only when the server allows it and the site does). */
  mode: AgentMode;
  allowPublish: boolean;
  readOnly: boolean;
  transport: "stdio" | "http";
  productName: string;
  describeChanges(siteId: string, changes: ChangeSet): Promise<string>;
  signal: AbortSignal;
}

export interface HarnessResult {
  /** What the model reads. */
  text: string;
  /** Structured output, for tools that declare an output schema. */
  structured?: Record<string, unknown>;
  isError?: boolean;
}

export type ToolGroup = "orientation" | "content" | "proof" | "publish" | "preview" | "build";

export interface HarnessTool {
  name: string;
  title: string;
  description: string;
  group: ToolGroup;
  input: z.ZodObject;
  output?: z.ZodObject;
  effect: ToolEffect;
  run(input: Record<string, unknown>, ctx: HarnessContext): Promise<HarnessResult>;
}

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MEDIA_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "avif", "gif", "svg", "pdf", "mp4"]);
const VALUE_CHARS = 300;
const DIFF_LINES = 300;

function refusal(text: string): HarnessResult {
  return { text, isError: true };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function clip(text: string, max = VALUE_CHARS): string {
  return text.length > max ? `${text.slice(0, max - 1)}… (${text.length} characters)` : text;
}

function shown(value: JsonValue | undefined): string {
  if (value === undefined) return "(nothing)";
  return clip(typeof value === "string" ? `“${value}”` : JSON.stringify(value));
}

/** Long values are cut in structured output too: the proof is for reading, get_diff has the exact bytes. */
function compactValue(value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.length > VALUE_CHARS ? `${value.slice(0, VALUE_CHARS - 1)}…` : value;
  const text = JSON.stringify(value);

  return text.length > VALUE_CHARS ? `${text.slice(0, VALUE_CHARS - 1)}…` : value;
}

function where(location: SourceLocation): string {
  if (location.kind === "field") return `field ${location.field.join(".")}`;
  if (location.kind === "body") return `main text, characters ${location.start}–${location.end}`;
  return `line ${location.line}`;
}

// ─────────────────────────────────────────────────────────────── get_site

interface FieldInfo {
  key: string;
  label: string;
  type: string;
  required: boolean;
  [extra: string]: unknown;
}

function fieldInfo(field: Field): FieldInfo {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    ...(field.options?.length ? { options: field.options } : {}),
    ...(field.default !== undefined ? { default: field.default } : {}),
    ...(field.collection ? { collection: field.collection } : {}),
    ...(field.hidden ? { hidden: true } : {}),
    ...(field.of ? { of: fieldInfo(field.of) } : {}),
    ...(field.fields?.length ? { fields: field.fields.map(fieldInfo) } : {}),
    ...(field.type === "blocks"
      ? {
          discriminator: field.discriminator ?? "type",
          sections: (field.blocks ?? []).map((block) => ({ type: block.type, label: block.label, fields: block.fields.map(fieldInfo) })),
        }
      : {}),
  };
}

function publishingLine(model: SiteModel, ctx: HarnessContext): string {
  const { publish } = model;
  const target =
    publish.mode === "pull-request"
      ? `as a request for review against the ${publish.branch} branch`
      : `onto the ${publish.branch} branch${publish.remote && publish.push ? `, then sent to ${publish.remote}` : publish.remote ? " (sending to the remote is turned off)" : " (there is no remote, so it stays on this computer)"}`;

  if (ctx.readOnly) return `Publishing goes ${target}. This connection is read-only and can't publish.`;
  return ctx.allowPublish
    ? `Publishing goes ${target}. You may publish with the publish tool, but only when the person asks you to.`
    : `Publishing goes ${target}. Publishing is turned off for this connection: the person publishes from ${ctx.productName}.`;
}

const collectionOutput = z.looseObject({ id: z.string(), label: z.string(), kind: z.string(), items: z.number(), fields: z.array(z.looseObject({ key: z.string(), type: z.string() })) });

const getSite: HarnessTool = {
  name: "get_site",
  title: "Describe the site",
  group: "orientation",
  description:
    "Describe the site: its name and framework; every collection (pages, posts, data files…) with its fields, their types, which are required and their allowed values, and for page-section fields every section type with its fields; where images are kept and how pages refer to them; the site's own content guide; where publishing goes; and how many changes are waiting to be published. Call this first — other tools refer to it as the site card — and follow the content guide it includes.",
  input: z.object({}),
  output: z.looseObject({
    id: z.string(),
    name: z.string(),
    framework: z.string(),
    mode: z.enum(["content", "build"]),
    pendingChanges: z.number(),
    publishing: z.looseObject({ allowed: z.boolean(), branch: z.string(), mode: z.string() }),
    media: z.looseObject({ dir: z.string(), publicPath: z.string() }),
    guide: z.array(z.looseObject({ path: z.string(), readable: z.boolean() })),
    collections: z.array(collectionOutput),
  }),
  effect: READ_ONLY,
  async run(_input, ctx) {
    const { model, site } = ctx;
    const [instructions, changes] = await Promise.all([loadInstructionFiles(site, model), site.changes()]);
    // The card is written for the built-in assistant, which never publishes;
    // over MCP that one line depends on how this connection was started.
    const card = buildSiteCard(model, instructions).replace(/^Publishing: .*$/m, publishingLine(model, ctx));
    const pending = changes.files.length;
    const connection = [
      "## This connection",
      ctx.mode === "build"
        ? "Build mode: content, media and the site's source files can be changed, and its build can be run."
        : "Content mode: pages, posts, data files and images can be changed; source files can't.",
      ...(ctx.readOnly ? ["Read-only: nothing can be changed from here."] : []),
      pending === 0
        ? "Nothing is waiting to be published."
        : `${plural(pending, "file")} ${pending === 1 ? "has" : "have"} changes waiting to be published — get_changes lists them.`,
      ...(model.urls.production ? [`The live site: ${model.urls.production}`] : []),
      ...(model.urls.staging ? [`The staging site: ${model.urls.staging}`] : []),
    ];

    return {
      text: `${card}\n\n${connection.join("\n")}`,
      structured: {
        id: site.id,
        name: model.name,
        framework: model.framework.version ? `${model.framework.name} ${model.framework.version}` : model.framework.name,
        mode: ctx.mode,
        readOnly: ctx.readOnly,
        pendingChanges: pending,
        publishing: { allowed: ctx.allowPublish && !ctx.readOnly, branch: model.publish.branch, mode: model.publish.mode, remote: model.publish.remote, push: model.publish.push },
        media: { dir: model.media.dir, publicPath: model.media.publicPath, roots: model.media.roots },
        urls: model.urls,
        buildModeAvailable: model.ai.allowBuild,
        guide: instructions.map((file) => ({ path: file.path, readable: file.content !== null })),
        collections: model.collections.map((c) => ({
          id: c.id,
          label: c.label,
          singular: c.singular,
          kind: c.kind,
          path: c.path,
          format: c.format,
          body: c.body,
          url: c.url,
          canCreate: c.create,
          items: c.count,
          fields: c.fields.map(fieldInfo),
        })),
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────── find_text

/** The page the text was seen on; "" when none was given, which resolveText reads as "favour no page". */
function urlPathOf(input: string | undefined): string {
  if (!input?.trim()) return "";
  const text = input.trim();

  try {
    return new URL(text).pathname;
  } catch {
    return text.startsWith("/") ? text.split(/[?#]/)[0]! : `/${text.split(/[?#]/)[0]}`;
  }
}

const findText: HarnessTool = {
  name: "find_text",
  title: "Find where a text lives",
  group: "content",
  description:
    "Given a piece of text the person saw on the website (and, ideally, the address of the page it was on), find which entry and which field or paragraph it comes from. It never guesses: the result is \"unique\" (exactly one place — safe to edit), \"ambiguous\" (several candidates are listed; ask the person which one they mean) or \"none\" (the text isn't in any content file — it may be written into the site's templates, which needs build mode). Use it before editing text the person quoted from a page.",
  input: z.object({
    text: z.string().min(1).max(2000).describe("The visible text, as it appears on the page."),
    url: z.string().max(2000).optional().describe('The page it was on: a path such as "/pricing/" or a full address. Strongly recommended.'),
    occurrence: z.number().int().min(0).optional().describe("When the same text appears several times on that page: which one (0 is the first)."),
    total: z.number().int().min(1).optional().describe("How many times the text appears on that page."),
  }),
  effect: READ_ONLY,
  async run(input, ctx) {
    const text = String(input.text).replace(/\s+/g, " ").trim();
    const result = await ctx.site.resolveText(
      {
        urlPath: urlPathOf(input.url as string | undefined),
        text,
        ...(input.occurrence !== undefined ? { occurrence: input.occurrence as number } : {}),
        ...(input.total !== undefined ? { total: input.total as number } : {}),
      },
      { mode: ctx.mode }
    );
    const matches = result.matches.slice(0, 20).map((match) => ({
      path: match.path,
      ...(match.title ? { title: match.title } : {}),
      ...(match.collection ? { collection: match.collection } : {}),
      where: where(match.location),
      ...(match.location.kind === "field" ? { field: match.location.field.join(".") } : {}),
      value: clip(match.value, 500),
      plain: match.plain,
      editable: match.editable,
    }));
    const next =
      result.status === "unique"
        ? matches[0]?.editable
          ? matches[0].field
            ? `Read it with read_entry, then change it with update_entry (op "set" at "${matches[0].field}").`
            : "Read it with read_entry, then change it with update_entry (op \"body-replace\")."
          : "It is in a source file, which only build mode can change."
        : result.status === "ambiguous"
          ? "Ask the person which of these they mean; don't pick one."
          : "It isn't in any content file. It may be written into the site's templates (a build-mode change) or computed.";

    return { text: JSON.stringify({ status: result.status, ...(result.reason ? { reason: result.reason } : {}), matches, next }) };
  },
};

// ─────────────────────────────────────────────────────────────── add_media

function extensionOf(name: string): string {
  return extname(name).slice(1).toLowerCase();
}

/** Formats the engine doesn't measure are checked here, so a renamed text file can't pass as one. */
function looksLike(ext: string, data: Uint8Array): boolean {
  const head = Buffer.from(data.subarray(0, 4096));

  if (ext === "pdf") return head.subarray(0, 5).toString("latin1") === "%PDF-";
  if (ext === "mp4") return head.subarray(4, 8).toString("latin1") === "ftyp";
  if (ext === "svg") return /<svg[\s>]/i.test(head.toString("utf8"));
  return true;
}

function targetName(source: string, wanted: string | undefined): string | GalleyError {
  const ext = extensionOf(source);

  if (!wanted?.trim()) return source;
  const name = wanted.trim();
  const given = extensionOf(name);

  if (given && given !== ext && !(["jpg", "jpeg"].includes(given) && ["jpg", "jpeg"].includes(ext))) {
    return new GalleyError("invalid", `The new name must keep the file's type (.${ext}), not .${given}.`);
  }
  return given ? name : `${name}.${ext}`;
}

async function readLocalMedia(file: string): Promise<{ name: string; data: Uint8Array }> {
  if (!isAbsolute(file)) throw new GalleyError("invalid", "Give the file's full location on this computer, starting from the top of the disk.");
  let real: string;

  try {
    real = await realpath(file);
  } catch {
    throw new GalleyError("not-found", "There's no file at that location.", file);
  }
  // Hidden folders hold keys and settings, never pictures meant for a website.
  if (real.split(sep).some((part) => part.startsWith(".") && part.length > 1)) {
    throw new GalleyError("forbidden", "Files inside hidden folders can't be added to the site.", real);
  }
  const info = await lstat(real);

  if (!info.isFile()) throw new GalleyError("invalid", "That's a folder, not a file.", real);
  if (!MEDIA_EXTENSIONS.has(extensionOf(real))) {
    throw new GalleyError("invalid", "Only images (PNG, JPG, WebP, AVIF, GIF, SVG), PDFs and MP4 videos can be added to the media library.", real);
  }
  if (info.size > MAX_MEDIA_BYTES) throw new GalleyError("invalid", "That file is larger than 25 MB. Make it smaller and try again.", real);
  return { name: basename(real), data: new Uint8Array(await readFile(real)) };
}

function decodeBase64(data: string): Uint8Array {
  const clean = data.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");

  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw new GalleyError("invalid", "The file data isn't valid base64.");
  return new Uint8Array(Buffer.from(clean, clean.includes("-") || clean.includes("_") ? "base64url" : "base64"));
}

const directoryInput = z.string().max(300).optional().describe("A folder inside the site's media folder (see get_site). Default: the media folder itself.");

function addMedia(transport: "stdio" | "http"): HarnessTool {
  const local = transport === "stdio";

  return {
    name: "add_media",
    title: "Add a file to the media library",
    group: "content",
    description: local
      ? "Copy an image (PNG, JPG, WebP, AVIF, GIF, SVG), a PDF or an MP4 video from this computer into the site's media library, so it can be placed on a page. The file name is cleaned up and never overwrites an existing file. Returns the URL to use in an image field (then write alt text that describes the picture)."
      : "Upload an image (PNG, JPG, WebP, AVIF, GIF, SVG), a PDF or an MP4 video into the site's media library, as base64 data, so it can be placed on a page. The file name is cleaned up and never overwrites an existing file. Returns the URL to use in an image field (then write alt text that describes the picture).",
    input: local
      ? z.object({
          file: z.string().min(1).max(4000).describe("The file's full location on this computer, e.g. /Users/ana/Pictures/team.jpg."),
          filename: z.string().max(120).optional().describe("A name for it in the site, e.g. \"team-at-work\". Default: the file's own name."),
          directory: directoryInput,
        })
      : z.object({
          data: z.string().min(4).describe("The file's bytes, base64-encoded (a data: URL is accepted too). At most 25 MB."),
          filename: z.string().min(1).max(120).describe("Its name including the extension, e.g. \"team-at-work.jpg\"."),
          directory: directoryInput,
        }),
    effect: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    async run(input, ctx) {
      let source: { name: string; data: Uint8Array };

      if (local) {
        source = await readLocalMedia(String(input.file));
      } else {
        const filename = String(input.filename);

        source = { name: filename, data: decodeBase64(String(input.data)) };
        if (source.data.length > MAX_MEDIA_BYTES) throw new GalleyError("invalid", "That file is larger than 25 MB. Make it smaller and try again.");
      }
      const name = local ? targetName(source.name, input.filename as string | undefined) : source.name;

      if (name instanceof GalleyError) throw name;
      if (!looksLike(extensionOf(name), source.data)) throw new GalleyError("invalid", `That file doesn't look like a real .${extensionOf(name)} file.`);
      const item = await ctx.site.saveMedia(
        { filename: name, data: source.data, ...(input.directory ? { directory: String(input.directory) } : {}) },
        { origin: "agent" }
      );

      return { text: JSON.stringify({ url: item.url, path: item.path, type: item.type, ...(item.width ? { width: item.width, height: item.height } : {}) }) };
    },
  };
}

// ─────────────────────────────────────────────────────────────── proof

function fileOutput(file: FileChange) {
  return {
    path: file.path,
    status: file.status,
    kind: file.kind,
    ...(file.title ? { title: file.title } : {}),
    ...(file.collection ? { collection: file.collection } : {}),
    ...(file.url ? { url: file.url } : {}),
    summary: file.summary,
    additions: file.additions,
    deletions: file.deletions,
    ...(file.binary ? { binary: true } : {}),
    ...(file.bodyChanged ? { bodyChanged: true } : {}),
    ...(file.fieldChanges?.length
      ? {
          fieldChanges: file.fieldChanges.slice(0, 40).map((change) => ({
            field: change.field.join("."),
            label: change.label,
            kind: change.kind,
            ...(change.before !== undefined ? { before: compactValue(change.before) } : {}),
            ...(change.after !== undefined ? { after: compactValue(change.after) } : {}),
            ...(change.kind === "moved" ? { from: change.from, to: change.to } : {}),
          })),
        }
      : {}),
  };
}

function describeFile(file: FileChange): string[] {
  const name = file.title ? `${file.title} (${file.path})` : file.path;
  const verb = { added: "new", modified: "changed", deleted: "removed" }[file.status];
  const lines = [`- ${name} — ${verb}: ${file.summary}`];

  for (const change of (file.fieldChanges ?? []).slice(0, 20)) {
    if (change.kind === "changed") lines.push(`    ${change.label}: ${shown(change.before)} → ${shown(change.after)}`);
    else if (change.kind === "added") lines.push(`    ${change.label}: added ${shown(change.after)}`);
    // Positions count from 1, as the form shows them; the item's own edits follow as their own lines.
    else if (change.kind === "moved") lines.push(`    ${change.label}: moved from ${(change.from ?? 0) + 1} to ${(change.to ?? 0) + 1}`);
    else lines.push(`    ${change.label}: removed (was ${shown(change.before)})`);
  }
  if ((file.fieldChanges?.length ?? 0) > 20) lines.push(`    …and ${file.fieldChanges!.length - 20} more field changes`);
  if (file.bodyChanged) lines.push("    The main text changed (get_diff shows exactly how).");
  return lines;
}

const getChanges: HarnessTool = {
  name: "get_changes",
  title: "Show the pending changes",
  group: "proof",
  description:
    "Show everything that has changed since the last publish — the proof. For each file: its title, whether it is new, changed or removed, a one-line summary, and for pages and posts every field that changed with its value before → after. This is what the person would review before publishing: use it to tell them, in plain words, what is about to go live. Results are paged: pass offset for more. get_diff shows one file's exact lines.",
  input: z.object({
    limit: z.number().int().min(1).max(100).optional().describe("How many files (default 30)."),
    offset: z.number().int().min(0).optional(),
  }),
  output: z.looseObject({
    branch: z.string(),
    baseCommit: z.string().nullable(),
    totals: z.object({ files: z.number(), additions: z.number(), deletions: z.number() }),
    offset: z.number(),
    files: z.array(z.looseObject({ path: z.string(), status: z.string(), summary: z.string() })),
  }),
  effect: READ_ONLY,
  async run(input, ctx) {
    const changes = await ctx.site.changes();
    const offset = (input.offset as number | undefined) ?? 0;
    const page = changes.files.slice(offset, offset + ((input.limit as number | undefined) ?? 30));
    const more = changes.files.length > offset + page.length ? `pass offset ${offset + page.length} for the next files` : undefined;
    const text =
      changes.files.length === 0
        ? "Nothing has changed since the last publish."
        : [
            `${plural(changes.files.length, "file")} changed on ${changes.branch}, not published yet:`,
            ...page.flatMap(describeFile),
            ...(more ? [`(${changes.files.length - offset - page.length} more — ${more})`] : []),
          ].join("\n");

    return {
      text,
      structured: { branch: changes.branch, baseCommit: changes.baseCommit, totals: changes.totals, offset, files: page.map(fileOutput), ...(more ? { more } : {}) },
    };
  },
};

const getDiff: HarnessTool = {
  name: "get_diff",
  title: "Show one file's exact changes",
  group: "proof",
  description:
    "Show exactly which lines of one file changed since the last publish, as a unified diff (lines starting with - were removed, + were added). Use it when the plain summary from get_changes isn't enough, for example to check a long text edit. Long diffs come back in parts: pass offset for more.",
  input: z.object({
    path: z.string().min(1).describe("The file's path, as get_changes lists it."),
    offset: z.number().int().min(0).optional().describe("Skip this many diff lines."),
  }),
  effect: READ_ONLY,
  async run(input, ctx) {
    const diff = await ctx.site.diff(String(input.path));

    if (diff.binary) return { text: `${diff.path} is a binary file (${diff.status}); its lines can't be shown.` };
    const lines: string[] = [];

    for (const hunk of diff.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
      for (const line of hunk.lines) lines.push(`${line.type === "add" ? "+" : line.type === "del" ? "-" : " "}${line.text}`);
    }
    const offset = (input.offset as number | undefined) ?? 0;
    const page = lines.slice(offset, offset + DIFF_LINES);
    const rest = lines.length - offset - page.length;

    return {
      text: [`${diff.path} (${diff.status})`, ...(lines.length === 0 ? ["No line changes."] : page), ...(rest > 0 ? [`… ${rest} more lines — pass offset ${offset + page.length}`] : [])].join("\n"),
    };
  },
};

const discardChanges: HarnessTool = {
  name: "discard_changes",
  title: "Discard pending changes",
  group: "proof",
  description:
    "Throw away pending changes, putting files back the way they were at the last publish (new files are removed). Name the files with paths, or pass all: true to discard everything. This can't be undone, and it also throws away changes the person made themselves in those files — only do it when they asked.",
  input: z.object({
    paths: z.array(z.string().min(1)).min(1).max(200).optional().describe("The files to put back, as get_changes lists them."),
    all: z.boolean().optional().describe("Discard every pending change."),
  }),
  effect: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
  async run(input, ctx) {
    const paths = input.paths as string[] | undefined;

    if (!paths && input.all !== true) return refusal("Say which files to discard with paths, or pass all: true to discard everything.");
    if (paths && input.all === true) return refusal("Pass either paths or all: true, not both.");
    const before = await ctx.site.changes();

    if (paths) {
      const pending = new Set(before.files.map((file) => file.path));
      const unknown = paths.filter((path) => !pending.has(path));

      if (unknown.length) return refusal(`These have no pending changes, so nothing was discarded: ${unknown.join(", ")}.`);
    }
    if (before.files.length === 0) return { text: "There was nothing to discard." };
    const after = await ctx.site.discard(paths);
    const discarded = before.files.length - after.files.length;

    return {
      text: `Discarded the changes to ${plural(discarded, "file")}. ${after.files.length === 0 ? "Nothing is waiting to be published now." : `${plural(after.files.length, "file")} still ${after.files.length === 1 ? "has" : "have"} pending changes.`}`,
    };
  },
};

// ─────────────────────────────────────────────────────────────── publish

function shortCommit(commit: string | undefined): string {
  return commit ? commit.slice(0, 7) : "";
}

function explainPublish(result: PublishResult, model: SiteModel, verb: string): HarnessResult {
  const structured = {
    ok: result.ok,
    ...(result.commit ? { commit: result.commit } : {}),
    ...(result.branch ? { branch: result.branch } : {}),
    files: result.files,
    pushed: result.pushed,
    ...(result.pushError ? { pushError: result.pushError } : {}),
    ...(result.pullRequestUrl ? { pullRequestUrl: result.pullRequestUrl } : {}),
  };

  if (!result.ok) {
    const detail = result.detail ? `\n\nDetails: ${clip(result.detail, 1500)}` : "";

    return { text: `${result.error ?? "That didn't work."}${detail}`, isError: true, structured };
  }
  const what = `${verb} ${plural(result.files.length, "file")} as version ${shortCommit(result.commit)} on ${result.branch ?? model.publish.branch}`;
  let text: string;

  if (result.pullRequestUrl) text = `${what}, and opened a request for review: ${result.pullRequestUrl}. It goes live once that is merged.`;
  else if (result.pushed) text = `${what}, and sent it to ${model.publish.remote ?? "the remote"}. The site's hosting takes it from there.`;
  else if (result.pushError) {
    text = `${what} on this computer, but it couldn't be sent to ${model.publish.remote ?? "the remote"}: ${result.pushError} It isn't live yet. Nothing is lost — once that is sorted out, the next publish sends it along with anything new.`;
  } else if (!model.publish.remote) text = `${what}. This site has no remote to send it to, so it stays on this computer.`;
  else text = `${what}. Sending to ${model.publish.remote} is turned off for this site, so it stays on this computer until someone sends it.`;
  return { text: `${text}\nFiles: ${result.files.join(", ")}\nVersion: ${result.commit ?? "unknown"}`, structured };
}

const publish: HarnessTool = {
  name: "publish",
  title: "Publish the changes",
  group: "publish",
  description:
    "Publish pending changes: save them as a new version of the site (a git commit) and send it on, which makes them live for everyone visiting the site. Call this only when the person has asked to publish, after they have seen what will change (get_changes). Publishes everything pending unless paths are given. Returns the new version, whether it was sent, and — if it was saved but couldn't be sent — why, in plain words.",
  input: z.object({
    message: z.string().max(200).optional().describe("One plain sentence saying what changed, e.g. \"Update the opening hours on the Contact page\". Written for you when left out."),
    paths: z.array(z.string().min(1)).min(1).max(500).optional().describe("Publish only these files (as get_changes lists them)."),
  }),
  effect: { readOnly: false, destructive: true, idempotent: false, openWorld: false },
  async run(input, ctx) {
    const changes = await ctx.site.changes();
    const paths = input.paths as string[] | undefined;
    const files = paths ? changes.files.filter((file) => paths.includes(file.path)) : changes.files;

    if (changes.files.length === 0) return refusal("There's nothing waiting to be published.");
    if (paths) {
      const unknown = paths.filter((path) => !changes.files.some((file) => file.path === path));

      if (unknown.length) return refusal(`These have no pending changes, so nothing was published: ${unknown.join(", ")}.`);
    }
    const message = (input.message as string | undefined)?.trim() || (await ctx.describeChanges(ctx.site.id, { ...changes, files }));
    const result = await ctx.site.publish({ message, ...(paths ? { paths } : {}) });

    return explainPublish(result, ctx.model, "Published");
  },
};

const getHistory: HarnessTool = {
  name: "get_history",
  title: "Show version history",
  group: "publish",
  description:
    "List the site's published versions, newest first: when, by whom, the message, and how many files each changed. Use it to answer \"what changed recently\" or to find the version to undo with undo_publish.",
  input: z.object({ limit: z.number().int().min(1).max(50).optional().describe("How many versions (default 10).") }),
  effect: READ_ONLY,
  async run(input, ctx) {
    const history = await ctx.site.history((input.limit as number | undefined) ?? 10);

    return {
      text: JSON.stringify(
        history.map((entry) => ({
          commit: entry.commit,
          short: entry.shortCommit,
          date: entry.date,
          author: entry.author,
          message: clip(entry.message.split("\n")[0] ?? "", 200),
          files: entry.files.length,
          ...(entry.viaGalley ? { viaThisApp: true } : {}),
        }))
      ),
    };
  },
};

const undoPublish: HarnessTool = {
  name: "undo_publish",
  title: "Undo a published version",
  group: "publish",
  description:
    "Undo one published version by publishing a new version that reverses it (history is never rewritten), which changes the live site. Only when the person asked to undo a publish. Give the commit from get_history.",
  input: z.object({ commit: z.string().regex(/^[0-9a-f]{4,64}$/i, "a commit id from get_history").describe("The version's commit id from get_history.") }),
  effect: { readOnly: false, destructive: true, idempotent: false, openWorld: false },
  async run(input, ctx) {
    return explainPublish(await ctx.site.revert(String(input.commit)), ctx.model, "Undid that version by publishing");
  },
};

// ─────────────────────────────────────────────────────────────── preview

const startPreview: HarnessTool = {
  name: "start_preview",
  title: "Start the preview",
  group: "preview",
  description:
    "Start the site's own development server so the pending changes can be seen in a browser, and return its address (plus the address of the deployed site for comparison, when one is configured). It can take a minute the first time. The preview updates by itself as content changes. Give the person the address; you can't look at it yourself.",
  input: z.object({}),
  effect: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
  async run(_input, ctx) {
    const status = await ctx.site.preview().start();

    if (status.state !== "ready") {
      return refusal(`${status.detail ?? "The preview didn't start."}${status.log.length ? `\n\nThe last lines it printed:\n${status.log.slice(-12).join("\n")}` : ""}`);
    }
    return {
      text: JSON.stringify({
        state: status.state,
        url: status.url,
        ...(status.baselineUrl ? { baselineUrl: status.baselineUrl, baselineSource: status.baselineSource } : {}),
        note: "This address shows the site with the pending changes. It only works on the computer the server runs on unless the server is hosted.",
      }),
    };
  },
};

const stopPreview: HarnessTool = {
  name: "stop_preview",
  title: "Stop the preview",
  group: "preview",
  description: "Stop the site's development server started by start_preview. Pending changes are kept.",
  input: z.object({}),
  effect: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
  async run(_input, ctx) {
    await ctx.site.preview().stop();
    return { text: "The preview is stopped." };
  },
};

export function harnessTools(transport: "stdio" | "http"): HarnessTool[] {
  return [getSite, findText, addMedia(transport), getChanges, getDiff, discardChanges, publish, getHistory, undoPublish, startPreview, stopPreview];
}
