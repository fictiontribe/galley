/**
 * createMcpServer — one implementation behind both transports. It returns
 * the SDK's server object, not yet connected: stdio connects it to the
 * process's standard streams, the HTTP mount connects one per session.
 *
 * Every call resolves its site, reads the current model, and runs in the
 * connection's mode — but the mode is enforced again by SiteService itself on
 * every write, so the tool list is a convenience for the model, never the
 * guardrail.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { GalleyError } from "@galley/core";
import { buildSiteCard, deterministicSummary, executeTool, loadInstructionFiles, type GalleyImageService, type ToolContext } from "@galley/core/ai";
import type { AgentMode, ChangeSet, SiteModel, SiteService } from "@galley/core/types";
import { inputFor, toolCatalog, type CatalogEntry, type CatalogOptions } from "./catalog";
import { editPagePrompt, PROMPTS, reviewPrompt, serverInstructions, writePostPrompt } from "./instructions";
import type { SiteResolver } from "./sites";
import type { HarnessContext } from "./tools";

export interface McpServerOptions {
  /** Resolve the site a call is about. stdio: always the one site. HTTP: by the `site` argument. */
  sites: SiteResolver;
  /** "build" lists the source-file tools and lets calls run in build mode where the site allows it. */
  mode: AgentMode;
  allowPublish: boolean;
  /** List, read, search and proof tools only. */
  readOnly?: boolean;
  /** generate_image is listed only when this is given (an image provider is configured). */
  images?: GalleyImageService;
  /** Default publish message. Default: a deterministic summary — no model call is made on the harness's behalf. */
  describeChanges?: (siteId: string, changes: ChangeSet) => Promise<string>;
  /** add_media takes a local file path on stdio and base64 data over HTTP. */
  transport: "stdio" | "http";
  brand: { name: string; version: string };
  /** The one site's folder, when there is exactly one: its own plugins' tools are listed too. */
  siteRoot?: string;
}

/** Used when no image provider is configured; generate_image isn't listed then, so this only guards direct calls. */
const NO_IMAGES: GalleyImageService = {
  providers: async () => [],
  generate: async () => {
    throw new GalleyError("unconfigured", "Image generation isn't set up on this server.");
  },
  read: async () => null,
  save: async () => {
    throw new GalleyError("unconfigured", "Image generation isn't set up on this server.");
  },
  discard: async () => undefined,
  sweep: async () => 0,
};

function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cms";
}

function text(content: string, isError = false, structured?: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: content }], ...(isError ? { isError: true } : {}), ...(structured ? { structuredContent: structured } : {}) };
}

function failure(error: unknown): CallToolResult {
  if (error instanceof GalleyError) return text(error.message, true);
  const detail = error instanceof Error ? error.message : String(error);

  return text(`That didn't work because of an unexpected problem (${detail.slice(0, 300)}).`, true);
}

/** Build mode applies only where the server allows it and the site's own settings do too. */
function modeFor(requested: AgentMode, model: SiteModel): AgentMode {
  return requested === "build" && model.ai.allowBuild ? "build" : "content";
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const readOnly = Boolean(options.readOnly);
  const catalogOptions: CatalogOptions = {
    mode: options.mode,
    allowPublish: options.allowPublish,
    readOnly,
    images: Boolean(options.images),
    transport: options.transport,
    sites: options.sites.kind,
    ...(options.siteRoot ? { siteRoot: options.siteRoot } : {}),
  };
  const describeChanges = options.describeChanges ?? (async (_siteId: string, changes: ChangeSet) => deterministicSummary(changes));
  /** Titles seen on this connection, so activity labels in errors can name things. */
  const titles = new Map<string, string>();
  /** Source files as this session last read or wrote them (ToolContext.read). */
  const read = new Map<string, string>();
  /** Resource URIs use the product's slug as their scheme ("galley://site" unbranded). */
  const scheme = slugOf(options.brand.name);
  const server = new McpServer(
    { name: slugOf(options.brand.name), title: options.brand.name, version: options.brand.version },
    {
      instructions: serverInstructions({
        productName: options.brand.name,
        mode: options.mode,
        allowPublish: options.allowPublish,
        readOnly,
        multiSite: options.sites.kind === "many",
      }),
      capabilities: { tools: {}, resources: {}, prompts: {} },
    }
  );

  async function open(site: string | undefined): Promise<{ site: SiteService; model: SiteModel; mode: AgentMode }> {
    const resolved = await options.sites.resolve(site);
    const model = await resolved.model();

    return { site: resolved, model, mode: modeFor(options.mode, model) };
  }

  async function call(entry: CatalogEntry, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
    try {
      const { site: siteArg, ...input } = args;

      if (entry.source === "sites") {
        const list = await options.sites.list();

        return text(
          JSON.stringify(list.map((s) => ({ id: s.id, name: s.name, framework: s.framework.name, pendingChanges: s.pendingChanges, ...(s.branch ? { branch: s.branch } : {}) })))
        );
      }
      const { site, model, mode } = await open(typeof siteArg === "string" ? siteArg : undefined);

      if (entry.group === "build" && mode !== "build") {
        return text(
          options.mode === "build"
            ? "Build mode is turned off in this site's own settings, so only its content can be changed. Tell the person; the site's configuration (ai.allowBuild) controls it."
            : "That isn't available in content mode: only pages, posts, data files and images can be changed. Tell the person this needs build mode, which whoever runs this server can turn on.",
          true
        );
      }
      if (entry.source === "registry") {
        const ctx: ToolContext = {
          site,
          siteId: site.id,
          mode,
          model,
          images: options.images ?? NO_IMAGES,
          signal,
          titles,
          read,
          question: null,
          askedLastTurn: false,
        };
        let label = entry.title;

        try {
          label = entry.tool.label(input, ctx);
        } catch {
          // A label only words an error message; it must never fail a call.
        }
        const outcome = await executeTool(entry.tool, entry.name, input, ctx, label);

        return text(outcome.content, Boolean(outcome.isError));
      }
      const ctx: HarnessContext = {
        site,
        model,
        mode,
        allowPublish: options.allowPublish,
        readOnly,
        transport: options.transport,
        productName: options.brand.name,
        describeChanges,
        signal,
      };
      const result = await entry.tool.run(input, ctx);

      return text(result.text, Boolean(result.isError), result.structured);
    } catch (error) {
      return failure(error);
    }
  }

  for (const entry of toolCatalog(catalogOptions)) {
    server.registerTool(
      entry.name,
      {
        title: entry.title,
        description: entry.description,
        inputSchema: inputFor(entry, catalogOptions),
        ...(entry.source === "mcp" && entry.output ? { outputSchema: entry.output } : {}),
        annotations: {
          title: entry.title,
          readOnlyHint: entry.effect.readOnly,
          destructiveHint: entry.effect.destructive,
          idempotentHint: entry.effect.idempotent,
          openWorldHint: entry.effect.openWorld,
        },
      },
      (args: Record<string, unknown>, extra) => call(entry, args, extra.signal)
    );
  }

  // ── resources: the site card, the content guide, and entries by path

  async function card(): Promise<string> {
    const { site, model } = await open(undefined);

    return buildSiteCard(model, await loadInstructionFiles(site, model));
  }

  server.registerResource(
    "site",
    `${scheme}://site`,
    { title: `The site card`, description: "Every collection, field and section type of the site, its media folders and its content guide — what get_site returns, as a document.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: await card() }] })
  );

  server.registerResource(
    "guide",
    `${scheme}://guide`,
    { title: "The content guide", description: "The site's own guidance for writing and editing it (voice, style, rules), from the files its settings name.", mimeType: "text/markdown" },
    async (uri) => {
      const { site, model } = await open(undefined);
      const files = await loadInstructionFiles(site, model);
      const body = files.length
        ? files.map((file) => `<!-- ${file.path} -->\n${file.content ?? "(This file is listed in the site's settings but couldn't be read.)"}`).join("\n\n")
        : "This site has no content guide. Its settings can name one or more files under ai.instructions.";

      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: body }] };
    }
  );

  const MIME: Record<string, string> = { markdown: "text/markdown", mdx: "text/markdown", json: "application/json", yaml: "application/yaml", toml: "application/toml" };

  server.registerResource(
    "entry",
    new ResourceTemplate(`${scheme}://entry/{+path}`, {
      list: async () => {
        const { site, model } = await open(undefined);
        const resources = [];

        for (const collection of model.collections) {
          if (resources.length >= 500) break;
          const list = await site.listEntries(collection.id, { limit: 500 - resources.length, sort: "title" });

          for (const item of list.items) {
            resources.push({ uri: `${scheme}://entry/${item.path}`, name: item.path, title: `${item.title} (${collection.singular})`, mimeType: MIME[collection.format] ?? "text/plain" });
          }
        }
        return { resources };
      },
      complete: {
        path: async (value) => {
          const { site, model } = await open(undefined);
          const found: string[] = [];

          for (const collection of model.collections) {
            const list = await site.listEntries(collection.id, { search: value || undefined, limit: 20 });

            found.push(...list.items.map((item) => item.path));
          }
          return found.filter((path) => path.startsWith(value) || value === "" || path.includes(value)).slice(0, 50);
        },
      },
    }),
    { title: "A page, post or data file", description: "One entry's file exactly as stored, by its path in the site.", mimeType: "text/markdown" },
    async (uri, variables) => {
      const { site } = await open(undefined);
      const path = decodeURIComponent(String(Array.isArray(variables.path) ? variables.path.join("/") : variables.path));
      const entry = await site.readEntry(path);

      return { contents: [{ uri: uri.href, mimeType: MIME[entry.format] ?? "text/plain", text: entry.raw }] };
    }
  );

  // ── prompts: three workflows, in the assistant's own principles

  if (!readOnly) {
    server.registerPrompt(
      PROMPTS.editPage.name,
      {
        title: PROMPTS.editPage.title,
        description: PROMPTS.editPage.description,
        argsSchema: { change: z.string().describe("What to change, in plain words."), page: z.string().optional().describe("Which page, if it isn't obvious: its title or address.") },
      },
      (args) => ({ messages: [{ role: "user", content: { type: "text", text: editPagePrompt(args) } }] })
    );
    server.registerPrompt(
      PROMPTS.writePost.name,
      {
        title: PROMPTS.writePost.title,
        description: PROMPTS.writePost.description,
        argsSchema: { topic: z.string().describe("What the post is about."), notes: z.string().optional().describe("Facts, points or wording to include.") },
      },
      (args) => ({ messages: [{ role: "user", content: { type: "text", text: writePostPrompt(args) } }] })
    );
  }
  server.registerPrompt(PROMPTS.reviewAndPublish.name, { title: PROMPTS.reviewAndPublish.title, description: PROMPTS.reviewAndPublish.description }, () => ({
    messages: [{ role: "user", content: { type: "text", text: reviewPrompt({ canPublish: options.allowPublish && !readOnly, productName: options.brand.name }) } }],
  }));
  return server;
}
