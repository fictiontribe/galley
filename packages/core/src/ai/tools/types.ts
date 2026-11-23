/** The shape every assistant tool has, and what it may touch. */
import type { z } from "zod";
import type { AgentMode, ChatOption, SiteModel, SiteService } from "../../types";
import type { GalleyImageService } from "../images/service";

export interface ToolContext {
  site: SiteService;
  siteId: string;
  mode: AgentMode;
  model: SiteModel;
  images: GalleyImageService;
  signal: AbortSignal;
  /** Titles seen this turn, so activity labels can name things the person recognises. */
  titles: Map<string, string>;
  /** Set when ask_user ran: the turn ends after this step. */
  question: { text: string; options: ChatOption[] } | null;
  /** The previous turn ended with a question — a second one in a row is refused. */
  askedLastTurn: boolean;
}

export interface ToolOutcome {
  /** What the model reads. Compact JSON or short text. */
  content: string;
  isError?: boolean;
  /** Past-tense label for the activity line once it finished. */
  doneLabel?: string;
}

/**
 * What a tool does to the site, stated truthfully. Harnesses that speak MCP
 * receive these as tool annotations and decide from them when to ask the
 * person first, so a tool that can overwrite or remove anything says so.
 */
export interface ToolEffect {
  /** Reads only: nothing on disk, in git or in running processes changes. */
  readOnly: boolean;
  /** May overwrite or remove something (not merely add). Meaningful only when not read-only. */
  destructive: boolean;
  /** Calling it again with the same arguments changes nothing more. */
  idempotent: boolean;
  /** Reaches services outside the site and this machine (an image provider). */
  openWorld: boolean;
}

export interface AssistantTool<S extends z.ZodType = z.ZodType> {
  name: string;
  /** A short human title for harness UIs, e.g. "Read an entry". */
  title: string;
  description: string;
  input: S;
  /** "build": offered only in build mode. */
  mode: "any" | "build";
  effect: ToolEffect;
  /**
   * "everywhere" (default): the built-in assistant and every harness over MCP.
   * "assistant": only inside the app's own chat — the tool depends on the chat
   * UI (answer buttons) or is covered by an MCP-side tool (the site card).
   */
  surface?: "everywhere" | "assistant";
  /** Present-tense label while running, from the real arguments. Never a tool name or a path. */
  label(input: z.infer<S>, ctx: ToolContext): string;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutcome>;
}

export const READ_ONLY: ToolEffect = { readOnly: true, destructive: false, idempotent: true, openWorld: false };

export function defineTool<S extends z.ZodType>(tool: AssistantTool<S>): AssistantTool {
  return tool as unknown as AssistantTool;
}

/** Results are sized for the model: anything longer is cut with a note saying how to get the rest. */
export const RESULT_LIMIT = 20_000;

export function json(value: unknown): string {
  const text = JSON.stringify(value);

  return text.length > RESULT_LIMIT
    ? `${text.slice(0, RESULT_LIMIT)}… [cut off: the result was ${text.length} characters; ask for less — a smaller limit, a narrower search or a single field]`
    : text;
}

export function ok(value: unknown, doneLabel?: string): ToolOutcome {
  return { content: json(value), ...(doneLabel ? { doneLabel } : {}) };
}

export function refuse(message: string, doneLabel?: string): ToolOutcome {
  return { content: message, isError: true, ...(doneLabel ? { doneLabel } : {}) };
}
