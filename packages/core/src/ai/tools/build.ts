/**
 * Build-mode tools: read and change source files, edit the site's
 * configuration, and run the site's own build. Every write passes the turn's
 * mode to SiteService, which enforces it on its own — these tools being offered
 * only in build mode is a convenience for the model, not the guardrail.
 */
import { z } from "zod";
import { PRODUCT } from "../../brand";
import { GalleyError } from "../../errors";
import { SITE_SETTINGS_LEVEL } from "../../install/route-access";
import type { GalleyConfig } from "../../types";
import { hashContent } from "../../workspace/files";
import { deniedReason, mayBeShown, notReadReason } from "../../workspace/policy";
import { fileName, plural } from "./labels";
import { CHANGED_AFTER_READ, NEVER_READ, rememberVersion, versionRead } from "./reads";
import { defineTool, ok, READ_ONLY, refuse, type AssistantTool, type ToolContext } from "./types";

/**
 * What is at a path, for a write that was told it replaces nothing it has
 * read: nothing, a file that can be read (and so must be, first), or one
 * that can't be read as text at all (a picture, a font) and so can never be
 * replaced from a reading. A file that may not be shown is never opened to
 * find out.
 */
async function whatIsThere(ctx: ToolContext, path: string): Promise<"nothing" | "readable" | "unreadable"> {
  if (!mayBeShown(path)) return "unreadable";
  try {
    return (await ctx.site.readFile(path)).binary ? "unreadable" : "readable";
  } catch (error) {
    return error instanceof GalleyError && error.code === "not-found" ? "nothing" : "unreadable";
  }
}

const READ_LINES = 400;
const BUILD_TAIL = 4_000;

function count(haystack: string, needle: string): number {
  let n = 0;

  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) n += 1;
  return n;
}

const listFiles = defineTool({
  name: "list_files",
  title: "List source files",
  description:
    "List the site's files matching a glob (for example \"src/components/**/*.astro\" or \"src/styles/*.css\"). Ignored folders such as node_modules are never listed. Use it to find the component, layout or stylesheet to change.",
  input: z.object({
    glob: z.string().optional().describe("Default: every file."),
    limit: z.number().int().min(1).max(500).optional().describe("Default 200."),
  }),
  mode: "build",
  effect: READ_ONLY,
  label: () => "Looking through the site's files",
  async run(input, ctx) {
    const files = await ctx.site.listFiles({ ...(input.glob ? { glob: input.glob } : {}), limit: input.limit ?? 200 });

    return ok({ files, count: files.length }, `Looked through ${plural(files.length, "file")}`);
  },
});

const readFile = defineTool({
  name: "read_file",
  title: "Read a source file",
  description:
    "Read a source file, with line numbers. Files longer than 400 lines come back in parts: pass startLine and endLine for the part you need. Read a file before editing it.",
  input: z.object({
    path: z.string(),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  }),
  mode: "build",
  effect: READ_ONLY,
  label: (input) => `Reading ${fileName(input.path)}`,
  async run(input, ctx) {
    // A secrets file, or one of the version history's own: what it holds would go to the model's provider and into the
    // conversation. Refused by its name, before it is opened.
    const notRead = notReadReason(input.path);

    if (notRead) return refuse(notRead, `Didn't read ${fileName(input.path)}`);
    const file = await ctx.site.readFile(input.path);
    const done = `Read ${fileName(input.path)}`;

    if (file.binary) return refuse("That's a binary file (an image or similar), so it can't be read as text.", done);
    rememberVersion(ctx, file.path, file.hash);
    const lines = file.content.split("\n");
    const start = Math.max(1, input.startLine ?? 1);
    const end = Math.min(lines.length, input.endLine ?? start + READ_LINES - 1);
    const width = String(end).length;
    const text = lines
      .slice(start - 1, end)
      .map((line, i) => `${String(start + i).padStart(width, " ")}\t${line}`)
      .join("\n");

    return ok(
      {
        path: file.path,
        hash: file.hash,
        lines: lines.length,
        from: start,
        to: end,
        text,
        ...(end < lines.length ? { more: `the file continues; pass startLine ${end + 1}` } : {}),
      },
      done
    );
  },
});

const writeFile = defineTool({
  name: "write_file",
  title: "Write a source file",
  description:
    "Create a source file, or replace one completely. A file that is already there must have been read with read_file in this conversation, and is replaced only if it is still what you read: when it has changed since, read it again first. For changes to an existing file prefer edit_file, which changes only the part you name. Content files (pages, posts) are changed with update_entry, not here.",
  input: z.object({ path: z.string(), content: z.string() }),
  mode: "build",
  effect: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
  label: (input) => `Writing ${fileName(input.path)}`,
  async run(input, ctx) {
    const read = versionRead(ctx, input.path);
    const couldnt = `Couldn't write ${fileName(input.path)}`;

    // Never written, whatever the mode; said here so that nothing below opens the file to see what is in the way.
    if (!mayBeShown(input.path)) return refuse(deniedReason(input.path, ctx.mode) ?? notReadReason(input.path) ?? "That file can't be changed from here.", couldnt);
    try {
      // With the version it was written from; a file never read is sent a version nothing has, so it replaces nothing.
      await ctx.site.writeFile(input.path, input.content, { origin: "agent", mode: ctx.mode, baseHash: read ?? NEVER_READ });
    } catch (error) {
      if (!(error instanceof GalleyError && error.code === "conflict")) throw error;
      if (read) return refuse(`The file ${CHANGED_AFTER_READ}, so it wasn't replaced. Read it again, then make your change to what is there now.`, couldnt);
      const there = await whatIsThere(ctx, input.path);

      if (there === "readable") {
        return refuse("That file is already there and you haven't read it in this conversation, so it wasn't replaced. Read it with read_file first, then write it.", couldnt);
      }
      if (there === "unreadable") {
        // Not "read it first": it can't be read, so that could never be done.
        return refuse("That file is already there and it isn't text (a picture, a font or another kind of file), so it can't be read and write_file doesn't replace it. Write to another name, or tell the person the file has to be replaced by hand.", couldnt);
      }
      // A new file: there was nothing to read.
      await ctx.site.writeFile(input.path, input.content, { origin: "agent", mode: ctx.mode });
    }
    rememberVersion(ctx, input.path, hashContent(input.content));
    return ok({ written: input.path, lines: input.content.split("\n").length }, `Wrote ${fileName(input.path)}`);
  },
});

const editFile = defineTool({
  name: "edit_file",
  title: "Edit a source file",
  description:
    "Change part of a source file by exact replacement: old_string must appear exactly once (include enough surrounding lines to make it unique), or set replace_all to change every occurrence. Copy old_string from read_file without the line numbers.",
  input: z.object({
    path: z.string(),
    old_string: z.string().min(1),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  }),
  mode: "build",
  effect: { readOnly: false, destructive: true, idempotent: false, openWorld: false },
  label: (input) => `Editing ${fileName(input.path)}`,
  async run(input, ctx) {
    const name = fileName(input.path);
    // Before it is opened: an edit that says whether its text was found, and how often, would be a way to ask what the file holds.
    const notRead = notReadReason(input.path);

    if (notRead) return refuse(notRead, `Couldn't edit ${name}`);
    const file = await ctx.site.readFile(input.path);

    if (file.binary) return refuse("That's a binary file, so it can't be edited as text.", `Couldn't edit ${name}`);
    const found = count(file.content, input.old_string);

    if (found === 0) return refuse("old_string wasn't found in the file. Read the file again and copy the text exactly.", `Couldn't edit ${name}`);
    if (found > 1 && !input.replace_all) {
      return refuse(`old_string appears ${found} times. Include more surrounding text so it appears once, or set replace_all.`, `Couldn't edit ${name}`);
    }
    if (input.old_string === input.new_string) return ok({ replaced: 0, note: "old_string and new_string are the same; nothing changed." });
    const next = input.replace_all ? file.content.split(input.old_string).join(input.new_string) : file.content.replace(input.old_string, () => input.new_string);

    await ctx.site.writeFile(input.path, next, { origin: "agent", mode: ctx.mode, baseHash: file.hash });
    rememberVersion(ctx, file.path, hashContent(next));
    return ok({ replaced: input.replace_all ? found : 1 }, `Edited ${name}`);
  },
});

const runBuild = defineTool({
  name: "run_build",
  title: "Build the site",
  description:
    "Run the site's own build and report whether it passed, with the end of its output. Run it after changing components, layouts, styles or configuration, and fix what it reports before you finish.",
  input: z.object({}),
  mode: "build",
  effect: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
  label: () => "Building the site to check it",
  async run(_input, ctx) {
    const result = await ctx.site.build({ mode: ctx.mode });
    const output = result.output.length > BUILD_TAIL ? `…${result.output.slice(-BUILD_TAIL)}` : result.output;

    return {
      content: JSON.stringify({ ok: result.ok, seconds: Math.round(result.durationMs / 100) / 10, output }),
      ...(result.ok ? {} : { isError: true }),
      doneLabel: result.ok ? "Built the site · no problems" : "Built the site · it reported problems",
    };
  },
});

const saveSiteConfig = defineTool({
  name: "save_site_config",
  title: "Save the site configuration",
  description:
    "Replace the site's configuration file (galley.config.json) with a new version — it corrects or extends what the app detected: collection labels, URL patterns, field settings, the media folder, instruction files. Read the current file with read_file first and send the whole new configuration. The site's structure is re-read afterwards.",
  input: z.object({ config: z.record(z.string(), z.unknown()).describe("The complete configuration object.") }),
  mode: "build",
  level: SITE_SETTINGS_LEVEL,
  effect: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
  label: () => "Updating the site configuration",
  async run(input, ctx) {
    // The whole file, written from a reading of it: only over that reading. One never read is sent a version nothing has
    // (as write_file does), after the engine's own checks of who may change the settings at all.
    const read = versionRead(ctx, PRODUCT.configFile);
    const couldnt = "Couldn't update the site configuration";
    const save = (baseHash?: string) => ctx.site.saveConfig(input.config as GalleyConfig, { mode: ctx.mode, ...(baseHash ? { baseHash } : {}) });
    let model: Awaited<ReturnType<typeof save>>;

    try {
      model = await save(read ?? NEVER_READ);
    } catch (error) {
      if (!(error instanceof GalleyError && error.code === "conflict")) throw error;
      if (read) return refuse(`The configuration file ${CHANGED_AFTER_READ}, so it wasn't replaced. Read it again with read_file, then send the whole new configuration.`, couldnt);
      if ((await whatIsThere(ctx, PRODUCT.configFile)) !== "nothing") {
        return refuse(`You haven't read the configuration file (${PRODUCT.configFile}) in this conversation, so it wasn't replaced. Read it with read_file first, then send the whole new configuration.`, couldnt);
      }
      // The site has no configuration file yet: there was nothing to read.
      model = await save();
    }
    return ok(
      { saved: true, collections: model.collections.map((c) => ({ id: c.id, label: c.label, items: c.count })), notes: model.notes.slice(0, 10) },
      "Updated the site configuration"
    );
  },
});

export const BUILD_TOOLS: AssistantTool[] = [listFiles, readFile, writeFile, editFile, runBuild, saveSiteConfig];
