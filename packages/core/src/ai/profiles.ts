/**
 * The two request profiles, in one place.
 *
 *   full   what the assistant normally sends: the beta Messages endpoint with
 *          explicit thinking-block binding (drop on mismatch), one fixed tool
 *          list with build tools deferred and surfaced by tool_addition /
 *          tool_removal blocks, server-side compaction, and the server-side
 *          refusal fallback where the model has one.
 *   plain  the generally-available surface only: the GA endpoint, no beta
 *          header, no block_binding, no context_management, no fallbacks;
 *          the tool list filtered by mode on every request.
 *
 * `plain` exists so that a rejected beta can't make the assistant unusable:
 * the loop drops to it when `full` is refused as a bad request (loop.ts), and
 * operators can pin either one with GALLEY_AI_PROFILE.
 *
 * Both render from the same stored thread; nothing stored is rewritten. What
 * `plain` changes at request time, and why it can't cause a hard failure:
 *
 * - Operator notes, stored as mid-conversation `role: "system"` messages, are
 *   sent as a user-turn text block instead (the skill's fallback form for
 *   those notes); tool-change blocks are dropped, because the tool list itself
 *   follows the mode. Consecutive user messages are allowed and combined.
 * - Thinking blocks. A block is valid only while the system prompt, the tool
 *   list and every earlier message are byte-identical to when it was made, and
 *   `plain` has no `drop_block` safety net. A block made under `full`, or under
 *   `plain` in the other mode, saw a different tool list, so replaying it could
 *   be a 400 on accounts where the check is enforced. So `plain` keeps thinking
 *   only in the contiguous run of most recent assistant messages that `plain`
 *   produced in the current mode, and strips every block before that run. The
 *   skill allows exactly this: removing a leading run of thinking blocks keeps
 *   the later ones valid. The boundary only ever moves forward, so a stripped
 *   block is never put back (putting one back would invalidate the blocks made
 *   while it was gone). The cost is that `plain` loses earlier reasoning, and
 *   the messages cache restarts whenever the boundary moves.
 * - If `plain` is refused anyway while it still replays thinking, the loop
 *   strips all thinking blocks and retries once — the skill's no-beta
 *   recovery — and records a floor so later requests strip them too.
 * - Fallback markers and compaction blocks exist only under betas. A fallback
 *   marker is left out; its thinking is stripped already. A compaction block
 *   is replaced by its plain-text summary, and the messages it summarised are
 *   left out, as the server would have done.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/index";
import type { AgentMode, Effort } from "../types";
import { supportsServerFallback } from "./models";
import { toolDefinitions, toolsForMode } from "./tools/index";

export type RequestProfile = "full" | "plain";
export const PROFILE_ENV = "GALLEY_AI_PROFILE";

type BetaParam = Anthropic.Beta.BetaMessageParam;
type BetaBlockParam = Anthropic.Beta.BetaContentBlockParam;

export const BETAS = {
  /** Explicit prefix-check setting for replayed thinking blocks. */
  thinkingBinding: "thinking-binding-controls-2026-08-01",
  /** tool_addition / tool_removal by reference, for mode changes. */
  toolChanges: "mid-conversation-tool-changes-2026-07-01",
  /** Server-side compaction of long conversations. */
  compaction: "compact-2026-01-12",
  /** `fallbacks: "default"` on a classifier refusal. */
  fallback: "server-side-fallback-2026-07-01",
} as const;

export interface RequestShape {
  model: string;
  effort: Effort;
  maxTokens: number;
  system: Anthropic.Beta.BetaTextBlockParam[];
  /** The site's folder: its own plugins' tools are offered for it. */
  siteRoot?: string;
}

/** Which profile produced an assistant message, and in which mode — what `plain` needs to decide what it may replay. */
export interface MessageMeta {
  profile: RequestProfile;
  mode: AgentMode;
}

export interface HistoryEntry {
  param: BetaParam;
  meta?: MessageMeta;
}

export type BuiltRequest =
  | { profile: "full"; params: BetaMessageStreamParams; replaysThinking: boolean }
  | { profile: "plain"; params: Anthropic.Messages.MessageStreamParams; replaysThinking: boolean };

/** The pinned profile, if any: the runtime option first, then GALLEY_AI_PROFILE. Unknown values are ignored. */
export function pinnedProfile(option: RequestProfile | undefined, env: NodeJS.ProcessEnv): RequestProfile | null {
  if (option === "full" || option === "plain") return option;
  const value = env[PROFILE_ENV]?.trim().toLowerCase();

  return value === "full" || value === "plain" ? value : null;
}

// ─────────────────────────────────────────────────────────────── full

function fullParams(shape: RequestShape, messages: BetaParam[]): BetaMessageStreamParams {
  const fallback = supportsServerFallback(shape.model);

  return {
    model: shape.model,
    max_tokens: shape.maxTokens,
    system: shape.system,
    tools: toolDefinitions(shape.siteRoot ?? null),
    messages,
    thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
    output_config: { effort: shape.effort },
    cache_control: { type: "ephemeral" },
    context_management: { edits: [{ type: "compact_20260112" }] },
    betas: [BETAS.thinkingBinding, BETAS.toolChanges, BETAS.compaction, ...(fallback ? [BETAS.fallback] : [])],
    ...(fallback ? { fallbacks: "default" as const } : {}),
  };
}

// ─────────────────────────────────────────────────────────────── plain

const definitionsByName = (siteRoot: string | null) => new Map(toolDefinitions(siteRoot).map((tool) => [tool.name, tool]));

/** The mode's tools, GA-shaped: no defer_loading. Still name-sorted and byte-stable per mode. */
export function plainTools(mode: AgentMode, siteRoot: string | null = null): Anthropic.Messages.Tool[] {
  const byName = definitionsByName(siteRoot);

  return toolsForMode(mode, siteRoot).map((tool) => {
    const { defer_loading: _deferred, ...definition } = byName.get(tool.name) as Anthropic.Beta.BetaTool;

    return definition as Anthropic.Messages.Tool;
  });
}

function isThinking(block: BetaBlockParam): boolean {
  return block.type === "thinking" || block.type === "redacted_thinking";
}

/**
 * Index of the first entry whose thinking `plain` may replay: the start of the
 * trailing run of assistant messages that `plain` made in `mode` (user and
 * note messages in between don't break the run), never before `floor`.
 */
export function thinkingBoundary(entries: HistoryEntry[], mode: AgentMode, floor: number): number {
  let boundary = entries.length;

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as HistoryEntry;

    if (entry.param.role !== "assistant") continue;
    if (entry.meta?.profile !== "plain" || entry.meta.mode !== mode) break;
    boundary = i;
  }
  return Math.max(boundary, floor);
}

function noteText(param: BetaParam): string {
  if (typeof param.content === "string") return param.content;
  return (param.content ?? [])
    .filter((block): block is Anthropic.Beta.BetaTextBlockParam => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}

export function renderPlainMessages(entries: HistoryEntry[], mode: AgentMode, floor: number): { messages: Anthropic.Messages.MessageParam[]; replaysThinking: boolean } {
  // Messages before the last compaction block were summarised by it.
  let start = 0;
  let summary: string | null = null;
  let afterSummary: BetaBlockParam[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const { param } = entries[index] as HistoryEntry;

    if (param.role !== "assistant" || typeof param.content === "string") continue;
    const at = param.content.map((block) => block.type).lastIndexOf("compaction");

    if (at === -1) continue;
    const block = param.content[at] as Anthropic.Beta.BetaCompactionBlockParam;

    start = index + 1;
    summary = block.content ?? "(The earlier part of this conversation was summarised, but the summary isn't available.)";
    afterSummary = param.content.slice(at + 1);
  }
  const boundary = thinkingBoundary(entries, mode, Math.max(floor, start));
  const out: Anthropic.Messages.MessageParam[] = [];
  let replaysThinking = false;

  if (summary !== null) {
    out.push({ role: "user", content: [{ type: "text", text: `<conversation_summary>\n${summary}\n</conversation_summary>` }] });
    const rest = afterSummary.filter((block) => !isThinking(block) && block.type !== "fallback");

    if (rest.length) out.push({ role: "assistant", content: rest as Anthropic.Messages.ContentBlockParam[] });
  }
  for (let i = start; i < entries.length; i += 1) {
    const { param } = entries[i] as HistoryEntry;

    if (param.role === "system") {
      const text = noteText(param);

      // Tool-change blocks are left out: the tool list follows the mode instead.
      if (text) out.push({ role: "user", content: [{ type: "text", text: `<app_note>\n${text}\n</app_note>` }] });
      continue;
    }
    if (param.role === "user" || typeof param.content === "string") {
      out.push(param as Anthropic.Messages.MessageParam);
      continue;
    }
    const keepThinking = i >= boundary;
    const content = param.content.filter((block) => block.type !== "fallback" && block.type !== "compaction" && (keepThinking || !isThinking(block)));

    if (keepThinking && content.some(isThinking)) replaysThinking = true;
    // An assistant message left empty (it held only thinking) is dropped.
    if (content.length) out.push({ role: "assistant", content: content as Anthropic.Messages.ContentBlockParam[] });
  }
  return { messages: out, replaysThinking };
}

function plainParams(shape: RequestShape, messages: Anthropic.Messages.MessageParam[], mode: AgentMode): Anthropic.Messages.MessageStreamParams {
  return {
    model: shape.model,
    max_tokens: shape.maxTokens,
    system: shape.system as Anthropic.Messages.TextBlockParam[],
    tools: plainTools(mode, shape.siteRoot ?? null),
    messages,
    thinking: { type: "adaptive" },
    output_config: { effort: shape.effort },
  };
}

export function buildRequest(profile: RequestProfile, shape: RequestShape, entries: HistoryEntry[], mode: AgentMode, floor: number): BuiltRequest {
  if (profile === "full") {
    const messages = entries.map((entry) => entry.param);

    return { profile, params: fullParams(shape, messages), replaysThinking: messages.some((m) => typeof m.content !== "string" && (m.content ?? []).some(isThinking)) };
  }
  const { messages, replaysThinking } = renderPlainMessages(entries, mode, floor);

  return { profile, params: plainParams(shape, messages, mode), replaysThinking };
}

// ─────────────────────────────────────────────────────────────── size guard

/** Context windows, input tokens. All four picker models have 1M; anything else is assumed smaller. */
const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-5-5": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-haiku-5-5": 1_000_000,
  "claude-fable-5-2": 1_000_000,
};

export function contextWindow(model: string): number {
  return CONTEXT_WINDOWS[model] ?? 200_000;
}

/** Images cost roughly this many tokens each, whatever the length of their base64. */
const IMAGE_TOKENS = 1_600;

/**
 * A deliberately pessimistic estimate (3.5 characters a token), used only
 * where there's no server-side compaction to fall back on.
 */
export function estimateInputTokens(params: { system?: unknown; tools?: unknown; messages: Array<{ content: unknown }> }): number {
  let images = 0;
  const text = JSON.stringify({ system: params.system, tools: params.tools, messages: params.messages }, (key, value) => {
    if (value && typeof value === "object" && (value as { type?: string }).type === "image") {
      images += 1;
      return null;
    }
    return value;
  });

  return Math.ceil(text.length / 3.5) + images * IMAGE_TOKENS;
}
