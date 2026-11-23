/**
 * One assistant turn: the Messages API tool loop, hosted in this process
 * because the tools act on the person's local checkout.
 *
 * Request shape (per the claude-api skill; both profiles are in profiles.ts):
 *   - streaming, adaptive thinking (never a budget, never disabled), effort
 *     set explicitly, no sampling parameters, no forced tool_choice;
 *   - eager input streaming on every tool, every input validated with zod
 *     before it runs;
 *   - cache breakpoints on the stable system prefix (product prompt, then the
 *     site card);
 *   - append-only stored history; `full` replays it verbatim, `plain` derives
 *     its GA-only rendering from it at request time.
 *
 * The stop reason is checked before any tool runs; all tool results of one
 * step go back in one user message.
 *
 * The profile ladder: a `full` request refused as a bad request before
 * anything streamed is retried once, same step, on `plain`. If `plain` is
 * accepted the runtime remembers it for that model; if `plain` is refused too,
 * the person sees the original error. Auth, permission, rate-limit, overload,
 * billing and connection failures are never laddered — they aren't about the
 * request's shape.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentMode, ChatOption, ToolActivity, TurnUsage } from "../types";
import { describeApiFailure, safeDetail, scrubSecrets } from "./errors";
import { costFor } from "./models";
import { buildRequest, contextWindow, estimateInputTokens, type BuiltRequest, type HistoryEntry, type MessageMeta, type RequestProfile, type RequestShape } from "./profiles";
import type { StoredMessage } from "./threads";
import { runTool, runningActivity } from "./tools/index";
import type { ToolContext } from "./tools/types";

export { BETAS } from "./profiles";
export type { RequestShape } from "./profiles";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

export const MAX_STEPS = 40;
export const AGENT_MAX_TOKENS = 64_000;
/** Consecutive re-issues allowed when a streamed tool input can't be parsed or the stream drops. */
const MAX_REISSUES = 2;
/** Under `plain` there is no server-side compaction: stop well before the window is full. */
const CONTEXT_FILL_LIMIT = 0.8;

export const TOO_LONG_MESSAGE = "That was too much to do in one go — ask for it in smaller pieces.";
export const STEP_LIMIT_MESSAGE =
  "That needed more steps than I can take in one go, so I stopped. Anything I changed so far is in Proof — ask me to carry on.";
export const REFUSAL_MESSAGE = "I can't help with that request, so I didn't change anything for it.";
export const CONTEXT_FULL_MESSAGE =
  "This conversation has grown too long for me to keep track of all of it. Start a new chat to carry on — your changes so far are safe in Proof.";

/** A 400 `invalid_request_error`: the request's shape was refused, not the credentials or capacity. */
export function isShapeRejection(error: unknown): error is InstanceType<typeof Anthropic.BadRequestError> {
  return error instanceof Anthropic.BadRequestError && (error.type === null || error.type === undefined || error.type === "invalid_request_error");
}

/** What the API said, for one diagnostic line. Scrubbed; never the key. */
export function rejectionDetail(error: InstanceType<typeof Anthropic.BadRequestError>): string {
  const body = error.error as { error?: { message?: string } } | undefined;

  return scrubSecrets(`request ${error.requestID ?? "unknown"}, ${error.type ?? "invalid_request_error"}: ${body?.error?.message ?? error.message}`).slice(0, 600);
}

/**
 * The content to keep in history. After a mid-output fallback the API wants
 * the declined partial's thinking, tool calls and other model-internal blocks
 * left out — only text and the `fallback` marker (in place) go back.
 */
export function echoSafe(content: ContentBlock[]): ContentBlock[] {
  let boundary = -1;

  content.forEach((block, index) => {
    if (block.type === "fallback") boundary = index;
  });
  if (boundary === -1) return content;
  return content.filter((block, index) => index >= boundary || block.type === "text" || block.type === "fallback");
}

function toolUses(content: ContentBlock[]): Anthropic.Beta.BetaToolUseBlock[] {
  return content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function emptyUsage(model: string): TurnUsage {
  return { model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 };
}

/** Adds one response's usage; per-attempt `iterations` (fallbacks, compaction) are the source of truth when present. */
export function addUsage(total: TurnUsage, message: Anthropic.Beta.BetaMessage, requested: string): void {
  const parts =
    message.usage.iterations && message.usage.iterations.length > 0
      ? message.usage.iterations.map((it) => ({
          model: ("model" in it && typeof it.model === "string" ? it.model : null) ?? message.model ?? requested,
          inputTokens: it.input_tokens,
          outputTokens: it.output_tokens,
          cacheReadTokens: it.cache_read_input_tokens ?? 0,
          cacheWriteTokens: it.cache_creation_input_tokens ?? 0,
        }))
      : [
          {
            model: message.model ?? requested,
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
          },
        ];

  total.requests += 1;
  for (const part of parts) {
    total.inputTokens += part.inputTokens;
    total.outputTokens += part.outputTokens;
    total.cacheReadTokens += part.cacheReadTokens;
    total.cacheWriteTokens += part.cacheWriteTokens;
    const cost = costFor(part.model, part);

    total.cost = cost === null || total.cost === null ? null : total.cost + cost;
  }
}

export type TurnEnd = "done" | "question" | "refused" | "too-long" | "context-full" | "step-limit" | "cancelled" | "error";

export interface ProfileControl {
  /** The profile this turn starts on. */
  initial: RequestProfile;
  /** False when the profile is pinned: no ladder. */
  ladder: boolean;
  /** `plain` was accepted after `full` was refused. */
  onLadder(detail: string): void;
  /** Under `plain`, thinking in entries before this index is never replayed. */
  thinkingFloor: number;
  /** Raise the floor (after a strip-all recovery) and persist it. */
  onFloor(floor: number): void;
  /** Input-token window used by the `plain` size guard. */
  contextWindow?: number;
}

export interface LoopInput {
  client: Anthropic;
  shape: RequestShape;
  mode: AgentMode;
  /** Committed history, hydrated (images filled in), with who produced each assistant message. */
  history: HistoryEntry[];
  /** This turn's opening messages: the user message and any operator note. Committed with the first reply. */
  opening: Array<{ stored: StoredMessage; param: MessageParam }>;
  profile: ProfileControl;
  ctx: ToolContext;
  signal: AbortSignal;
  maxSteps?: number;
  onText(delta: string): void;
  onTool(activity: ToolActivity): void;
  /** Append to the stored history. Called with complete, valid messages only. */
  commit(messages: StoredMessage[]): Promise<void>;
  log(line: string): void;
}

export interface LoopResult {
  end: TurnEnd;
  text: string;
  question: { text: string; options: ChatOption[] } | null;
  /** Plain sentence for `chat.error`, when the turn failed. */
  error: string | null;
  tools: ToolActivity[];
  usage: TurnUsage;
  /** The profile the turn finished on. */
  profile: RequestProfile;
}

/** Streams one request on whichever endpoint its profile uses. */
async function streamOnce(client: Anthropic, built: BuiltRequest, signal: AbortSignal, onText: (delta: string) => void, onEvent: () => void): Promise<Anthropic.Beta.BetaMessage> {
  if (built.profile === "full") {
    const stream = client.beta.messages.stream(built.params, { signal });

    stream.on("text", (delta) => onText(delta));
    stream.on("streamEvent", onEvent);
    return stream.finalMessage();
  }
  const stream = client.messages.stream(built.params, { signal });

  stream.on("text", (delta) => onText(delta));
  stream.on("streamEvent", onEvent);
  // The GA message is a subset of the beta one for everything the loop reads
  // (content, stop_reason, stop_details, usage, model).
  return (await stream.finalMessage()) as unknown as Anthropic.Beta.BetaMessage;
}

export async function runLoop(input: LoopInput): Promise<LoopResult> {
  const { client, shape, ctx, signal, mode } = input;
  const maxSteps = input.maxSteps ?? MAX_STEPS;
  const entries: HistoryEntry[] = [...input.history, ...input.opening.map((m) => ({ param: m.param }))];
  let opened = false;
  const usage = emptyUsage(shape.model);
  const tools: ToolActivity[] = [];
  const texts: string[] = [];
  let reissues = 0;
  let profile = input.profile.initial;
  let floor = input.profile.thinkingFloor;
  /** The refusal of `full` while this step is being retried on `plain`. */
  let laddering: InstanceType<typeof Anthropic.BadRequestError> | null = null;
  let strippedAll = false;

  const result = (end: TurnEnd, extra: Partial<LoopResult> = {}): LoopResult => ({
    end,
    text: texts.join("\n\n"),
    question: null,
    error: null,
    tools,
    usage,
    profile,
    ...extra,
  });

  // Appends to the live entries and the stored history. The turn's opening
  // messages are only stored together with the first reply, so a turn that
  // fails before any reply leaves no dangling user/system messages (a system
  // message followed by the next turn's user message is a 400).
  const commit = async (...appended: Array<{ param: MessageParam; meta?: MessageMeta }>) => {
    const stored: StoredMessage[] = [];

    if (!opened) {
      stored.push(...input.opening.map((m) => m.stored));
      opened = true;
    }
    stored.push(...appended.map((entry) => ({ message: entry.param, ...(entry.meta ? { meta: entry.meta } : {}) })));
    entries.push(...appended);
    await input.commit(stored);
  };
  const assistant = (content: ContentBlock[]) => ({ param: { role: "assistant" as const, content }, meta: { profile, mode } });

  for (let step = 0; ; step += 1) {
    if (signal.aborted) return result("cancelled");
    if (step >= maxSteps) return result("step-limit", { error: STEP_LIMIT_MESSAGE });
    const built = buildRequest(profile, shape, entries, mode, floor);

    if (built.profile === "plain" && estimateInputTokens(built.params) > CONTEXT_FILL_LIMIT * (input.profile.contextWindow ?? contextWindow(shape.model))) {
      return result("context-full", { error: CONTEXT_FULL_MESSAGE });
    }
    let message: Anthropic.Beta.BetaMessage;
    let streamed = false;

    try {
      message = await streamOnce(client, built, signal, input.onText, () => (streamed = true));
      reissues = 0;
    } catch (error) {
      if (signal.aborted || error instanceof Anthropic.APIUserAbortError) return result("cancelled");
      // A tool input the SDK couldn't parse (eager input streaming) or a
      // connection dropped mid-stream: nothing was run, so re-issue the same
      // request. API errors are not retried here — the SDK already retried
      // what is retryable before the stream opened.
      if (!(error instanceof Anthropic.APIError) && reissues < MAX_REISSUES) {
        reissues += 1;
        input.log(`stream failed, re-issuing (${reissues}/${MAX_REISSUES}): ${safeDetail(error, 300)}`);
        step -= 1;
        continue;
      }
      if (!streamed && isShapeRejection(error)) {
        if (profile === "full" && input.profile.ladder) {
          laddering = error;
          profile = "plain";
          input.log(`full request refused for ${shape.model} (${rejectionDetail(error)}); retrying this step on the plain profile`);
          step -= 1;
          continue;
        }
        if (profile === "plain" && built.replaysThinking && !strippedAll) {
          // The skill's no-beta recovery: strip every thinking block and
          // retry once. The floor is persisted so later requests strip them too.
          strippedAll = true;
          floor = entries.length;
          input.profile.onFloor(floor);
          input.log(`plain request refused for ${shape.model} (${rejectionDetail(error)}); retrying once without earlier thinking`);
          step -= 1;
          continue;
        }
      }
      input.log(`request failed (${profile}): ${safeDetail(error)}`);
      const failure = describeApiFailure(laddering ?? error, { baseURL: client.baseURL });

      return failure.aborted ? result("cancelled") : result("error", { error: failure.message });
    }
    if (laddering) {
      input.profile.onLadder(rejectionDetail(laddering));
      laddering = null;
    }
    addUsage(usage, message, shape.model);
    for (const change of message.input_transformations ?? []) {
      if (change.type === "thinking_dropped" && change.reason === "prefix_binding_mismatch") {
        input.log(`history prefix changed; the API dropped thinking at ${change.path}`);
      }
    }

    const content = echoSafe(message.content);

    switch (message.stop_reason) {
      case "refusal":
        // Partial output from a declined request is discarded, never stored or run.
        input.log(`refusal category=${message.stop_details?.category ?? "none"}`);
        texts.length = 0;
        return result("refused", { text: REFUSAL_MESSAGE });

      case "max_tokens":
      case "model_context_window_exceeded": {
        if (toolUses(content).length > 0) {
          // A tool input cut off mid-way can still parse; never run it.
          return result("too-long", { error: TOO_LONG_MESSAGE });
        }
        await commit(assistant(content));
        const text = textOf(content);

        if (text) texts.push(text);
        return result("too-long", { error: TOO_LONG_MESSAGE });
      }

      case "pause_turn":
      case "compaction":
        await commit(assistant(content));
        continue;

      default:
        break;
    }

    const calls = toolUses(content);
    const text = textOf(content);

    await commit(assistant(content));
    if (calls.length === 0) {
      if (text) texts.push(text);
      return result("done");
    }
    if (text) texts.push(text);

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];

    for (const call of calls) {
      if (signal.aborted) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: "Not run: the person cancelled the turn.", is_error: true });
        continue;
      }
      const running = runningActivity(call, ctx);

      tools.push(running);
      input.onTool(running);
      const run = await runTool(call, ctx, running);

      tools[tools.indexOf(running)] = run.activity;
      input.onTool(run.activity);
      results.push(run.result);
    }
    // Every result of the step in one user message.
    await commit({ param: { role: "user", content: results } });
    if (signal.aborted) return result("cancelled");
    if (ctx.question) {
      // The question is the reply: drop any text written before it.
      return result("question", { text: ctx.question.text, question: ctx.question });
    }
  }
}
