/**
 * The tool registry: definitions for the API, the harness-neutral list MCP
 * serves, and the dispatcher that validates each call and runs it.
 *
 * The `tools` array is the same for every request of every conversation —
 * changing it mid-conversation would invalidate both the prompt cache and the
 * thinking blocks already in the history. Mode filtering is therefore done
 * the append-only way: build-only tools are declared with `defer_loading`, and
 * surfaced or withdrawn with `tool_addition` / `tool_removal` blocks in a
 * mid-conversation system message when the mode changes (see loop.ts).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { GalleyError } from "../../errors";
import type { AgentMode, ToolActivity } from "../../types";
import { activePlugins } from "../../plugins/active";
import type { AccessLevel } from "../../install/accounts";
import { BUILD_MODE_REFUSAL, callerMay } from "../../install/caller";
import { BUILD_MODE_LEVEL, ROLE_REFUSAL } from "../../install/route-access";
import { safeDetail } from "../errors";
import { BUILD_TOOLS } from "./build";
import { CONTENT_TOOLS } from "./content";
import { SEO_TOOLS } from "./seo";
import { SITE_BRAND_TOOLS } from "../../sitebrand/tools";
import { REDIRECT_TOOLS } from "../../redirects/tools";
import type { AssistantTool, ToolContext, ToolOutcome } from "./types";

export const ALL_TOOLS: AssistantTool[] = [...CONTENT_TOOLS, ...SEO_TOOLS, ...SITE_BRAND_TOOLS, ...REDIRECT_TOOLS, ...BUILD_TOOLS].sort((a, b) => a.name.localeCompare(b.name));
export const BUILD_TOOL_NAMES: string[] = BUILD_TOOLS.map((tool) => tool.name).sort();
const BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

/**
 * The harness-neutral registry: every tool that is offered outside the app's
 * own chat (over MCP), one definition each — name, title, description, zod
 * input, mode, effect and handler over SiteService. The assistant uses the
 * same definitions through ALL_TOOLS, so the two can never drift apart.
 */
export const siteTools: readonly AssistantTool[] = ALL_TOOLS.filter((tool) => (tool.surface ?? "everywhere") === "everywhere");

/**
 * Every tool for a site: the built-ins plus those of enabled plugins (the
 * site's own plugins only for that site). A plugin can never shadow a
 * built-in. With no plugin registry active this is exactly ALL_TOOLS.
 */
export function toolsFor(siteRoot: string | null = null): AssistantTool[] {
  const extra = (activePlugins()?.tools(siteRoot) ?? []).filter((tool) => !BY_NAME.has(tool.name));

  return extra.length ? [...ALL_TOOLS, ...extra].sort((a, b) => a.name.localeCompare(b.name)) : ALL_TOOLS;
}

/**
 * What the person whose turn it is needs for a tool, on a hosted install: its
 * own level when it has one, else BUILD_MODE_LEVEL for a build-mode tool and
 * "edit" for the rest. The engine holds the same line again underneath, at
 * the write itself (install/caller.ts).
 */
export function toolLevel(tool: AssistantTool): AccessLevel {
  return tool.level ?? (tool.mode === "build" ? BUILD_MODE_LEVEL : "edit");
}

/** Whether the person whose work this is may be offered, and may run, this tool. Nobody in scope (local mode, the operator's token): every tool. */
export function callerMayUse(tool: AssistantTool): boolean {
  return callerMay(toolLevel(tool));
}

/** The tools offered outside the app's own chat (over MCP), plugins' included — those the caller may use. */
export function everywhereTools(siteRoot: string | null = null): AssistantTool[] {
  return toolsFor(siteRoot).filter((tool) => (tool.surface ?? "everywhere") === "everywhere" && callerMayUse(tool));
}

/** Build-only tools, by name: the ones surfaced and withdrawn when the mode changes. Every one, whoever asks: what was surfaced must be withdrawable. */
export function buildToolNames(siteRoot: string | null = null): string[] {
  return toolsFor(siteRoot)
    .filter((tool) => tool.mode === "build")
    .map((tool) => tool.name)
    .sort();
}

/** The build-only tools the person whose turn it is may be offered, by name. */
export function offeredBuildToolNames(siteRoot: string | null = null): string[] {
  return toolsFor(siteRoot)
    .filter((tool) => tool.mode === "build" && callerMayUse(tool))
    .map((tool) => tool.name)
    .sort();
}

/** A registry tool by name, whichever surface it is offered on. */
export function toolByName(name: string, siteRoot: string | null = null): AssistantTool | undefined {
  return BY_NAME.get(name) ?? toolsFor(siteRoot).find((tool) => tool.name === name);
}

/** The tools for a mode that the person whose turn it is may use. */
export function toolsForMode(mode: AgentMode, siteRoot: string | null = null): AssistantTool[] {
  return toolsFor(siteRoot).filter((tool) => (tool.mode === "any" || mode === "build") && callerMayUse(tool));
}

function schemaOf(tool: AssistantTool): Anthropic.Beta.BetaTool.InputSchema {
  const schema = z.toJSONSchema(tool.input, { target: "draft-7", io: "input" }) as Record<string, unknown>;

  delete schema.$schema;
  return schema as Anthropic.Beta.BetaTool.InputSchema;
}

const definitions = new Map<AssistantTool, Anthropic.Beta.BetaTool>();

/**
 * Every tool, in name order, each definition built once per process so the
 * bytes never vary while the set of tools stays the same (plugins change it
 * only when one is enabled or disabled). Client tools stream their input
 * eagerly (large file bodies arrive as they are written); the loop validates
 * every input with zod before anything runs.
 */
export function toolDefinitions(siteRoot: string | null = null): Anthropic.Beta.BetaTool[] {
  return toolsFor(siteRoot).map((tool) => {
    let definition = definitions.get(tool);

    if (!definition) {
      definition = {
        name: tool.name,
        description: tool.description,
        input_schema: schemaOf(tool),
        eager_input_streaming: true,
        ...(tool.mode === "build" ? { defer_loading: true } : {}),
      };
      definitions.set(tool, definition);
    }
    return definition;
  });
}

export interface ToolRun {
  result: Anthropic.Beta.BetaToolResultBlockParam;
  activity: ToolActivity;
}

export function runningActivity(block: Anthropic.Beta.BetaToolUseBlock, ctx: ToolContext): ToolActivity {
  const tool = toolByName(block.name, ctx.site.root);
  let label = "Working on it";

  if (tool) {
    const parsed = tool.input.safeParse(block.input);

    if (parsed.success) {
      try {
        label = tool.label(parsed.data, ctx);
      } catch {
        // A label must never fail a turn.
      }
    }
  }
  return { id: block.id, name: block.name, label, status: "running" };
}

function issueText(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}

/**
 * Validates and runs one call to a registry tool, the same way for every
 * caller — the assistant's loop and any harness over MCP. Refusals from the
 * engine come back as error outcomes in plain words, so the model can adapt;
 * nothing here throws. `label` is the present-tense activity line, used to
 * say what couldn't be finished.
 */
export async function executeTool(tool: AssistantTool | undefined, name: string, input: unknown, ctx: ToolContext, label: string): Promise<ToolOutcome> {
  if (!tool) return { content: `There is no tool called ${name}.`, isError: true, doneLabel: "Couldn't do that" };
  // Checked again on every call: the list offered is a convenience, and the person's role may have changed since it was made.
  if (!callerMayUse(tool)) {
    return {
      content: `${tool.mode === "build" && toolLevel(tool) === BUILD_MODE_LEVEL ? BUILD_MODE_REFUSAL : ROLE_REFUSAL} Tell the person their account can't do this, and don't try another way round it.`,
      isError: true,
      doneLabel: "Not something this account can do",
    };
  }
  if (tool.mode === "build" && ctx.mode !== "build") {
    return {
      content: "That isn't available in content mode: only pages, posts, data files and images can be changed. Tell the person this needs build mode and suggest switching.",
      isError: true,
      doneLabel: "Not available in content mode",
    };
  }
  const parsed = tool.input.safeParse(input);

  if (!parsed.success) {
    // With eager input streaming the API no longer validates inputs, and a
    // tolerant parser can hand back a truncated object: never run it.
    return {
      content: JSON.stringify({ INVALID_JSON: JSON.stringify(input).slice(0, 2000), problems: issueText(parsed.error) }),
      isError: true,
      doneLabel: "Couldn't do that",
    };
  }
  try {
    if (ctx.signal.aborted) return { content: "Stopped: the person cancelled the turn before this ran.", isError: true, doneLabel: "Stopped" };
    return await tool.run(parsed.data, ctx);
  } catch (error) {
    const failed = `Couldn't finish: ${label.charAt(0).toLowerCase()}${label.slice(1)}`;

    if (error instanceof GalleyError) return { content: error.message, isError: true, doneLabel: failed };
    if (ctx.signal.aborted) return { content: "Stopped: the person cancelled the turn.", isError: true, doneLabel: "Stopped" };
    return { content: `That didn't work because of an unexpected problem (${safeDetail(error, 300)}).`, isError: true, doneLabel: failed };
  }
}

/** The assistant's dispatcher: executeTool, shaped as an API tool result plus the finished activity line. */
export async function runTool(block: Anthropic.Beta.BetaToolUseBlock, ctx: ToolContext, running: ToolActivity): Promise<ToolRun> {
  const outcome = await executeTool(toolByName(block.name, ctx.site.root), block.name, block.input, ctx, running.label);

  return {
    result: {
      type: "tool_result",
      tool_use_id: block.id,
      content: outcome.content,
      ...(outcome.isError ? { is_error: true } : {}),
    },
    activity: {
      ...running,
      label: outcome.doneLabel ?? running.label,
      status: outcome.isError ? "error" : "done",
      ...(outcome.isError ? { detail: outcome.content.slice(0, 300) } : {}),
    },
  };
}
