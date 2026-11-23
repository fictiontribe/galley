/**
 * Build-mode tools: read and change source files, edit the site's
 * configuration, and run the site's own build. Every write passes the turn's
 * mode to SiteService, which enforces it on its own — these tools being offered
 * only in build mode is a convenience for the model, not the guardrail.
 */
import { z } from "zod";
import type { GalleyConfig } from "../../types";
import { fileName, plural } from "./labels";
import { defineTool, ok, READ_ONLY, refuse, type AssistantTool } from "./types";

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
    const file = await ctx.site.readFile(input.path);
    const done = `Read ${fileName(input.path)}`;

    if (file.binary) return refuse("That's a binary file (an image or similar), so it can't be read as text.", done);
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
    "Create a source file, or replace one completely. For changes to an existing file prefer edit_file, which changes only the part you name. Content files (pages, posts) are changed with update_entry, not here.",
  input: z.object({ path: z.string(), content: z.string() }),
  mode: "build",
  effect: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
  label: (input) => `Writing ${fileName(input.path)}`,
  async run(input, ctx) {
    await ctx.site.writeFile(input.path, input.content, { origin: "agent", mode: ctx.mode });
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
  effect: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
  label: () => "Updating the site configuration",
  async run(input, ctx) {
    const model = await ctx.site.saveConfig(input.config as GalleyConfig, { mode: ctx.mode });

    return ok(
      { saved: true, collections: model.collections.map((c) => ({ id: c.id, label: c.label, items: c.count })), notes: model.notes.slice(0, 10) },
      "Updated the site configuration"
    );
  },
});

export const BUILD_TOOLS: AssistantTool[] = [listFiles, readFile, writeFile, editFile, runBuild, saveSiteConfig];
