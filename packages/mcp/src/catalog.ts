/**
 * Which tools a connection offers, and in what shape: the shared registry
 * tools from the engine (exactly the definitions the built-in assistant
 * uses) plus the MCP-side verbs, filtered by mode, read-only, publishing and
 * image availability. The server registers from this list and the docs'
 * tool reference is generated from it, so neither can drift from the other.
 */
import { z } from "zod";
import { everywhereTools, READ_ONLY, type SiteTool, type ToolEffect } from "@galley/core/ai";
import type { AgentMode } from "@galley/core/types";
import { harnessTools, type HarnessTool, type ToolGroup } from "./tools";

export interface CatalogOptions {
  mode: AgentMode;
  allowPublish: boolean;
  readOnly: boolean;
  /** generate_image is listed only when an image provider is configured. */
  images: boolean;
  transport: "stdio" | "http";
  /** "many": every tool takes an optional `site` and list_sites is offered. */
  sites: "single" | "many";
  /** The one site's folder (stdio): its own plugins' tools are offered too. Otherwise only server-wide plugins' tools. */
  siteRoot?: string | null;
}

export type CatalogEntry =
  | { source: "registry"; name: string; title: string; description: string; group: ToolGroup; input: z.ZodObject; effect: ToolEffect; tool: SiteTool }
  | { source: "mcp"; name: string; title: string; description: string; group: ToolGroup; input: z.ZodObject; output?: z.ZodObject; effect: ToolEffect; tool: HarnessTool }
  | { source: "sites"; name: string; title: string; description: string; group: ToolGroup; input: z.ZodObject; effect: ToolEffect };

export const SITE_ARGUMENT = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe("Which site, by its id or name from list_sites. Needed only when more than one site is open.");

export const LIST_SITES = {
  name: "list_sites",
  title: "List the open sites",
  description:
    "List the sites open on this server, with their ids, names, frameworks and how many changes each has waiting to be published. When more than one is open, pass a site's id or name as `site` to the other tools.",
  group: "orientation" as const,
  input: z.object({}),
  effect: READ_ONLY,
};

/** Where each registry tool sits in the reference. */
function groupOf(tool: SiteTool): ToolGroup {
  return tool.mode === "build" ? "build" : "content";
}

const GROUP_ORDER: ToolGroup[] = ["orientation", "content", "proof", "publish", "preview", "build"];
/** Inside a group: the order a person would reach for them — find, read, change, then media. */
const NAME_ORDER = [
  "list_sites",
  "get_site",
  "list_entries",
  "read_entry",
  "search_content",
  "find_text",
  "update_entry",
  "create_entry",
  "delete_entry",
  "list_media",
  "add_media",
  "generate_image",
  "validate",
];

function rank(entry: CatalogEntry): number {
  const index = NAME_ORDER.indexOf(entry.name);

  return GROUP_ORDER.indexOf(entry.group) * 100 + (index === -1 ? 50 : index);
}

export function toolCatalog(options: CatalogOptions): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  if (options.sites === "many") entries.push({ source: "sites", ...LIST_SITES });
  for (const tool of harnessTools(options.transport)) {
    entries.push({ source: "mcp", name: tool.name, title: tool.title, description: tool.description, group: tool.group, input: tool.input, ...(tool.output ? { output: tool.output } : {}), effect: tool.effect, tool });
  }
  // The engine's registry: built-in tools plus those of enabled plugins.
  for (const tool of everywhereTools(options.siteRoot ?? null)) {
    entries.push({ source: "registry", name: tool.name, title: tool.title, description: tool.description, group: groupOf(tool), input: tool.input as z.ZodObject, effect: tool.effect, tool });
  }
  return entries
    .filter((entry) => {
      if (entry.group === "build" && options.mode !== "build") return false;
      if (entry.group === "publish" && !options.allowPublish && !entry.effect.readOnly) return false;
      if (entry.name === "generate_image" && !options.images) return false;
      if (options.readOnly && !entry.effect.readOnly) return false;
      return true;
    })
    .sort((a, b) => rank(a) - rank(b));
}

/** The input schema as a harness sees it: with `site` added when several sites can be open. */
export function inputFor(entry: CatalogEntry, options: Pick<CatalogOptions, "sites">): z.ZodObject {
  return options.sites === "many" && entry.source !== "sites" ? entry.input.extend({ site: SITE_ARGUMENT }) : entry.input;
}
