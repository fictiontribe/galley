/**
 * The assistant: threads, turns, undo and publish summaries for every site.
 * One instance serves the whole app; one turn at a time per thread.
 */
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { GalleyError } from "../errors";
import type {
  AgentMode,
  AgentRuntime,
  ChatAttachment,
  ChatMessage,
  ChatThreadSummary,
  Checkpoint,
  EntrySummary,
  EventBus,
  SendMessageRequest,
  SettingsService,
  SiteRegistry,
  SiteService,
  ToolActivity,
} from "../types";
import { briefToPrompt } from "./brief";
import { describeChangeSet } from "./describe";
import { DEFAULT_API_BASE_URL, noKeyError, safeDetail, scrubSecrets } from "./errors";
import { PLACEHOLDER_PROVIDER } from "./images/catalog";
import type { GalleyImageService } from "./images/service";
import { AGENT_MAX_TOKENS, MAX_STEPS, emptyUsage, runLoop, type LoopResult } from "./loop";
import { pinnedProfile, type RequestProfile } from "./profiles";
import { contextText, modeChangeNote, siteChangedNote, SYSTEM_PROMPT, undoNote } from "./prompt";
import { buildSiteCard, loadInstructionFiles } from "./site-card";
import { hashText, summaryOf, ThreadStore, titleFrom, type StoredImageRef, type StoredMessage, type ThreadRecord } from "./threads";
import { buildToolNames, offeredBuildToolNames } from "./tools/index";
import { BUILD_MODE_REFUSAL, callerMay, currentScope, requireBuildMode, requireLevel } from "../install/caller";
import type { SiteActor } from "../site/service";
import { BUILD_MODE_LEVEL, UNDO_BUILD_REFUSAL } from "../install/route-access";
import { siteBrandInstructions } from "../sitebrand/tools";
import { plural } from "./tools/labels";
import type { ToolContext } from "./tools/types";
import type { UsageLine } from "./usage";

/** How many turns per thread keep their undo information. */
export const UNDO_DEPTH = 20;
/** How many conversations' reads are remembered at once (each at most READS_KEPT files). */
export const CONVERSATIONS_REMEMBERED = 200;
const MAX_TEXT = 20_000;
const MAX_ATTACHMENTS = 6;
/** Conversation names, as the rename route accepts them. */
export const MAX_TITLE = 120;
/** The API's per-image limit is 5 MB of base64; this leaves room for the encoding. */
const VIEWABLE_BYTES = 3_700_000;
const VISION_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MEDIA_EXT: Record<string, string> = { ...VISION_MIME, "image/svg+xml": "svg", "image/avif": "avif" };

export interface AssistantTurnNotice {
  siteId: string;
  threadId: string;
  turnId: string;
  phase: "start" | "write" | "end";
  actor: SiteActor;
  paths?: string[];
}

export interface AgentRuntimeOptions {
  home: string;
  registry: SiteRegistry;
  settings: SettingsService;
  images: GalleyImageService;
  events: EventBus;
  /** Test seam: a pre-built Anthropic client (e.g. one constructed with a scripted `fetch`). */
  client?: Anthropic;
  /** Per-response output cap. Default 64,000. */
  maxTokens?: number;
  /** Loop ceiling. Default 40. */
  maxSteps?: number;
  /** Diagnostic lines (already scrubbed of secrets). Default: stderr. */
  logger?: (line: string) => void;
  now?: () => number;
  /** Pin the request profile ("full" or "plain") and turn the ladder off. Beats GALLEY_AI_PROFILE. */
  profile?: RequestProfile;
  /** Where GALLEY_AI_PROFILE is read from. Default: process.env. */
  env?: NodeJS.ProcessEnv;
  /** Test seam: the input-token window the plain profile's size guard uses. */
  contextWindow?: number;
  /** Optional observer notified when a turn starts, writes files, or ends. Never fails the turn. */
  onTurn?: (notice: AssistantTurnNotice) => void;
}

/** The runtime plus a diagnostic: which request profile a turn finished on. */
export interface GalleyAgentRuntime extends AgentRuntime {
  working(siteId: string): boolean;
  turnProfile(turnId: string): RequestProfile | undefined;
}

interface ActiveTurn {
  turnId: string;
  controller: AbortController;
  done: Promise<void>;
}

interface HeldCheckpoint {
  turnId: string;
  checkpoint: Checkpoint;
  /** The mode the turn ran in: undoing it changes the same files back, so it needs the level that mode needs. */
  mode: AgentMode;
}

export { UNDO_BUILD_REFUSAL };

function release(checkpoint: Checkpoint): void {
  // The workspace's checkpoints keep their pre-images until released; the
  // facade's type doesn't promise `release`, so it is used when present.
  const releasable = checkpoint as Checkpoint & { release?: () => Promise<void> };

  void releasable.release?.().catch(() => undefined);
}

/** Marks a held reply's checkpoint as an Undo still offered, so its site isn't closed for lack of use (checkpoint.ts `offer`). */
function offer(checkpoint: Checkpoint): void {
  (checkpoint as Checkpoint & { offer?: () => void }).offer?.();
}

function parseDataUrl(url: string): { mime: string; data: Uint8Array } | null {
  const match = /^data:([^;,]+)((?:;[^;,]+)*?);base64,(.*)$/s.exec(url);

  if (!match) return null;
  return { mime: (match[1] ?? "").toLowerCase(), data: new Uint8Array(Buffer.from(match[3] ?? "", "base64")) };
}

export { DEFAULT_API_BASE_URL };

/**
 * Builds the SDK client from the key in Settings and nothing ambient.
 *
 * The SDK reads ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN from the
 * environment by itself. Those are routinely set by other tools for their own
 * traffic (an AI coding tool's terminal points them at a local proxy), and a
 * person who starts the app from such a terminal would see their valid key
 * rejected by someone else's proxy. So the endpoint is explicit: the public
 * API, or GALLEY_ANTHROPIC_BASE_URL when an operator deliberately routes
 * through a gateway.
 */
export function createApiClient(apiKey: string, env: NodeJS.ProcessEnv, maxRetries: number): Anthropic {
  const override = env.GALLEY_ANTHROPIC_BASE_URL?.trim() || process.env.GALLEY_ANTHROPIC_BASE_URL?.trim();

  return new Anthropic({ apiKey, authToken: null, baseURL: override || DEFAULT_API_BASE_URL, maxRetries });
}

export function createAgentRuntime(options: AgentRuntimeOptions): GalleyAgentRuntime {
  const store = new ThreadStore(options.home);
  const env = options.env ?? process.env;
  const pinned = pinnedProfile(options.profile, env);
  /** Models whose `full` request was refused and `plain` accepted, for the life of this process. */
  const plainModels = new Set<string>();
  const turnProfiles = new Map<string, RequestProfile>();
  const active = new Map<string, ActiveTurn>();
  const held = new Map<string, HeldCheckpoint[]>();
  /**
   * What each conversation has read, from one reply to the next (tools/reads.ts):
   * newer versions may come in between two replies, and the second must not
   * write from what the first one saw. Kept for the conversations used most
   * recently; one that is forgotten reads again before it changes anything.
   */
  const reads = new Map<string, Map<string, string>>();
  const now = options.now ?? Date.now;
  const log = (line: string) => (options.logger ?? ((text: string) => process.stderr.write(`[assistant] ${text}\n`)))(scrubSecrets(line));
  const key = (siteId: string, threadId: string) => `${siteId}/${threadId}`;

  function readsOf(threadKey: string): Map<string, string> {
    const kept = reads.get(threadKey) ?? new Map<string, string>();

    // Set afresh, so the conversation used last is the last to be forgotten.
    reads.delete(threadKey);
    reads.set(threadKey, kept);
    for (const oldest of reads.keys()) {
      if (reads.size <= CONVERSATIONS_REMEMBERED) break;
      // Never one whose reply is being written now: its tools hold this very map.
      if (!active.has(oldest)) reads.delete(oldest);
    }
    return kept;
  }

  async function siteFor(siteId: string): Promise<SiteService> {
    const site = await options.registry.get(siteId);

    if (!site) throw new GalleyError("not-found", "That site isn't open any more.", siteId);
    return site;
  }

  async function clientFor(): Promise<Anthropic> {
    const apiKey = await options.settings.readSecret("anthropic");

    if (!apiKey) throw noKeyError();
    return options.client ?? createApiClient(apiKey, env, 2);
  }

  function emitMessage(siteId: string, threadId: string, message: ChatMessage): void {
    options.events.emit({ type: "chat.message", siteId, threadId, message });
  }

  /** Replies being undone now: a second undo of the same reply meanwhile is told so, never run twice. */
  const undoing = new Set<HeldCheckpoint>();

  function hold(threadKey: string, turnId: string, checkpoint: Checkpoint, mode: AgentMode): void {
    const list = held.get(threadKey) ?? [];

    // A reply that changed something is an Undo its site stays open for; one that changed nothing keeps nothing.
    if (checkpoint.paths().length > 0) offer(checkpoint);
    else release(checkpoint);

    list.push({ turnId, checkpoint, mode });
    while (list.length > UNDO_DEPTH) {
      const old = list.shift();

      if (old) release(old.checkpoint);
    }
    held.set(threadKey, list);
  }

  async function lookup(site: SiteService, request: SendMessageRequest): Promise<{ viewing: EntrySummary | null; editing: EntrySummary | null }> {
    const context = request.context;
    const viewing = context?.urlPath ? await site.entryForUrl(context.urlPath).catch(() => null) : null;
    const editing = context?.entryPath ? await site.readEntry(context.entryPath).catch(() => null) : null;

    return { viewing, editing };
  }

  function validate(request: SendMessageRequest): void {
    const text = request.text?.trim() ?? "";

    if (!text && !request.brief) throw new GalleyError("invalid", "Type a message first.");
    if (text.length > MAX_TEXT) throw new GalleyError("invalid", "That message is too long. Keep it under 20,000 characters, or split it up.");
    if (request.mode !== undefined && request.mode !== "content" && request.mode !== "build") throw new GalleyError("invalid", "Choose content mode or build mode.");
    if ((request.attachments?.length ?? 0) > MAX_ATTACHMENTS) throw new GalleyError("invalid", `Attach at most ${MAX_ATTACHMENTS} images at a time.`);
    for (const attachment of request.attachments ?? []) {
      if (!attachment.dataUrl) throw new GalleyError("invalid", "An attached file arrived empty. Attach it again.");
      const parsed = parseDataUrl(attachment.dataUrl);

      if (!parsed || !Object.hasOwn(MEDIA_EXT, parsed.mime)) throw new GalleyError("invalid", "Only images can be attached (PNG, JPG, WebP, GIF, AVIF or SVG).", attachment.name);
    }
  }

  /** Saves attachments into the site's media (so they can go on a page) and keeps a copy for replay. */
  async function stageAttachments(site: SiteService, siteId: string, threadId: string, attachments: ChatAttachment[]) {
    const staged: Array<{ shown: ChatAttachment; path: string; url: string; viewable: boolean; mime: string; data: Uint8Array; file: string | null }> = [];

    for (const attachment of attachments) {
      const parsed = parseDataUrl(attachment.dataUrl ?? "");

      if (!parsed) continue;
      const ext = (Object.hasOwn(MEDIA_EXT, parsed.mime) ? MEDIA_EXT[parsed.mime] : undefined) ?? "png";
      const base = attachment.name.replace(/\.[a-z0-9]{2,5}$/i, "") || "attachment";
      const item = await site.saveMedia({ filename: `${base}.${ext}`, data: parsed.data }, { origin: "user" });
      const viewable = Object.hasOwn(VISION_MIME, parsed.mime) && parsed.data.length <= VIEWABLE_BYTES;
      const file = viewable ? await store.storeAttachment(siteId, threadId, parsed.data, ext) : null;

      staged.push({ shown: { name: attachment.name, mime: parsed.mime, path: item.path, url: item.url }, path: item.path, url: item.url, viewable, mime: parsed.mime, data: parsed.data, file });
    }
    return staged;
  }

  async function finishTurn(params: {
    siteId: string;
    threadId: string;
    turnId: string;
    assistantId: string;
    checkpoint: Checkpoint;
    outcome: LoopResult;
    mode: AgentMode;
  }): Promise<void> {
    const { siteId, threadId, turnId, assistantId, checkpoint, outcome, mode } = params;

    checkpoint.close();
    const changedPaths = checkpoint.paths();
    let text = outcome.text;

    if (!text) {
      if (outcome.end === "cancelled") text = changedPaths.length ? `Stopped. I'd already changed ${plural(changedPaths.length, "item")}; they're in Proof, and Undo puts them back.` : "Stopped. Nothing was changed.";
      else if (outcome.end === "done") text = changedPaths.length ? `I made changes to ${plural(changedPaths.length, "item")}. They're waiting in Proof.` : "I didn't change anything.";
    }
    const message: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text,
      at: now(),
      turnId,
      mode,
      tools: outcome.tools,
      changedPaths,
      usage: outcome.usage,
      ...(outcome.question ? { options: outcome.question.options } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    };

    await store
      .update(siteId, threadId, (record) => {
        const index = record.thread.messages.findIndex((m) => m.id === assistantId);

        if (index === -1) record.thread.messages.push(message);
        else record.thread.messages[index] = message;
        record.thread.updatedAt = now();
      })
      .catch((error) => log(`couldn't save the reply: ${safeDetail(error)}`));
    if (outcome.usage.requests > 0) {
      await options.settings.recordUsage({ ...outcome.usage, siteId, at: now() });
    }
    emitMessage(siteId, threadId, message);
    if (outcome.error) options.events.emit({ type: "chat.error", siteId, threadId, turnId, message: outcome.error });
    options.events.emit({ type: "chat.done", siteId, threadId, turnId });
  }

  return {
    async listThreads(siteId) {
      const records = await store.list(siteId);

      return records.map((record): ChatThreadSummary => summaryOf(record, active.has(key(siteId, record.thread.id))));
    },

    async getThread(siteId, threadId) {
      const record = await store.load(siteId, threadId).catch(() => null);

      return record ? { ...record.thread, busy: active.has(key(siteId, threadId)) } : null;
    },

    async createThread(siteId, input = {}) {
      const site = await siteFor(siteId);
      const mode: AgentMode = input.mode ?? "content";

      if (mode === "build") requireBuildMode();
      if (mode === "build" && !(await site.model()).ai.allowBuild) {
        throw new GalleyError("invalid", "Build mode is turned off for this site, so the assistant can change content only.");
      }
      const record = await store.create(siteId, { ...input, mode }, now());

      return { ...record.thread, busy: false };
    },

    async renameThread(siteId, threadId, title) {
      const clean = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";

      if (!clean) throw new GalleyError("invalid", "Give the conversation a name.");
      if (clean.length > MAX_TITLE) throw new GalleyError("invalid", `That name is too long. Keep it under ${MAX_TITLE} characters.`);
      const record = await store.update(siteId, threadId, (stored) => {
        // Not an update to the conversation: its place in the list stays where it was.
        stored.thread.title = clean;
        return stored;
      });

      return summaryOf(record, active.has(key(siteId, threadId)));
    },

    async deleteThread(siteId, threadId) {
      const threadKey = key(siteId, threadId);
      const turn = active.get(threadKey);

      if (turn) {
        turn.controller.abort();
        await turn.done;
      }
      for (const entry of held.get(threadKey) ?? []) release(entry.checkpoint);
      held.delete(threadKey);
      reads.delete(threadKey);
      await store.remove(siteId, threadId);
    },

    async send(siteId, threadId, request) {
      validate(request);
      const threadKey = key(siteId, threadId);

      if (active.has(threadKey)) {
        throw new GalleyError("busy", "I'm still working on the last message. Wait for it to finish, or stop it first.");
      }
      // Claim the thread before the first await, so two quick sends can't both start.
      const controller = new AbortController();
      const turnId = randomUUID();
      let resolveDone: () => void = () => undefined;
      const done = new Promise<void>((resolve) => (resolveDone = resolve));

      active.set(threadKey, { turnId, controller, done });
      try {
        const client = await clientFor();
        const site = await siteFor(siteId);
        const record = await store.load(siteId, threadId);

        if (!record) throw new GalleyError("not-found", "That conversation doesn't exist any more.", threadId);
        const model = await site.model();
        const mode: AgentMode = request.mode ?? record.thread.mode;

        // Asked for, or carried on from someone else's build-mode conversation: either way refused, never quietly switched.
        if (mode === "build" && !callerMay(BUILD_MODE_LEVEL)) {
          throw new GalleyError("forbidden", request.mode === "build" ? BUILD_MODE_REFUSAL : `${BUILD_MODE_REFUSAL} This conversation is in build mode: switch it to content mode to carry on.`);
        }
        if (mode === "build" && !model.ai.allowBuild) {
          throw new GalleyError("invalid", "Build mode is turned off for this site, so the assistant can change content only.");
        }
        const settings = await options.settings.get();
        // Placeholder artwork is always there, but only a real image service is worth rebuilding a site's pictures with.
        const imagesAvailable = settings.images.provider !== null && settings.images.provider !== PLACEHOLDER_PROVIDER;
        // Built (and so validated) before anything is written for this turn.
        const modelText = request.brief ? `${briefToPrompt(request.brief, model, { imagesAvailable })}${request.text?.trim() ? `\n\nThe person also wrote: ${request.text.trim()}` : ""}` : request.text.trim();
        const staged = await stageAttachments(site, siteId, threadId, request.attachments ?? []);
        const { viewing, editing } = await lookup(site, request);

        // The user turn: volatile context first, then images, then their words.
        const content: Anthropic.Beta.BetaContentBlockParam[] = [
          { type: "text", text: contextText({ mode, context: request.context, viewing, editing, attachments: staged.map((s) => ({ name: s.shown.name, path: s.path, url: s.url, viewable: s.viewable })) }) },
        ];
        const hydratedContent: Anthropic.Beta.BetaContentBlockParam[] = [...content];
        const refs: StoredImageRef[] = [];

        for (const file of staged) {
          if (!file.file) continue;
          const mediaType = file.mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
          const data = Buffer.from(file.data).toString("base64");

          refs.push({ block: content.length, file: file.file });
          content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: "" } });
          hydratedContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
        }
        content.push({ type: "text", text: modelText });
        hydratedContent.push({ type: "text", text: modelText });

        // Operator notes and tool changes ride in one mid-conversation system
        // message after the user turn — never an edit to the system prompt.
        // The site's brand rides in the card as one more instruction entry: a brand edit changes the
        // card's hash and reaches a running conversation as a note, never as a rewritten cached prefix.
        const card = buildSiteCard(model, [...(await loadInstructionFiles(site, model)), ...(await siteBrandInstructions(site))]);
        const cardHash = hashText(card);
        const notes = [...record.api.pendingNotes];
        const systemCard = record.api.systemCard ?? card;

        if (record.api.mode !== null && record.api.mode !== mode) notes.push(modeChangeNote(mode));
        if (record.api.systemCard !== null && record.api.cardHash !== cardHash) notes.push(siteChangedNote(card));
        const toolChanges: Array<Anthropic.Beta.BetaRequestToolAdditionBlock | Anthropic.Beta.BetaRequestToolRemovalBlock> = [];
        // Only the build-mode tools this person may use are surfaced; any surfaced for someone before them that this person may not use are withdrawn.
        const offered = mode === "build" ? offeredBuildToolNames(site.root) : [];
        const surfaced = record.api.surfacedTools ?? (record.api.buildTools ? buildToolNames(site.root) : []);

        for (const name of offered.filter((name) => !surfaced.includes(name))) toolChanges.push({ type: "tool_addition", tool: { type: "tool_reference", name } });
        for (const name of surfaced.filter((name) => !offered.includes(name))) toolChanges.push({ type: "tool_removal", tool: { type: "tool_reference", name } });
        const userParam: Anthropic.Beta.BetaMessageParam = { role: "user", content: hydratedContent };
        const opening: Array<{ stored: StoredMessage; param: Anthropic.Beta.BetaMessageParam }> = [
          { stored: { message: { role: "user", content }, ...(refs.length ? { images: refs } : {}) }, param: userParam },
        ];

        if (notes.length || toolChanges.length) {
          const system: Anthropic.Beta.BetaMessageParam = {
            role: "system",
            content: [...notes.map((text) => ({ type: "text" as const, text })), ...toolChanges],
          };

          opening.push({ stored: { message: system }, param: system });
        }

        const userMessage: ChatMessage = {
          id: randomUUID(),
          role: "user",
          text: request.text?.trim() || "Build the site from the brief.",
          at: now(),
          turnId,
          ...(staged.length ? { attachments: staged.map((s) => s.shown) } : {}),
        };
        const assistantId = randomUUID();
        const pending: ChatMessage = { id: assistantId, role: "assistant", text: "", at: now(), turnId, pending: true, mode };
        const lastAssistant = [...record.thread.messages].reverse().find((m) => m.role === "assistant");
        const askedLastTurn = Boolean(lastAssistant?.options?.length) && !lastAssistant?.undone;

        await store.update(siteId, threadId, (stored) => {
          const firstMessage = stored.thread.messages.length === 0;

          stored.thread.messages.push(userMessage, pending);
          stored.thread.mode = mode;
          stored.thread.updatedAt = now();
          if (firstMessage && stored.thread.title === "New conversation") stored.thread.title = titleFrom(userMessage.text);
          stored.turns.push({ turnId, userMessageId: userMessage.id, assistantMessageId: assistantId, request: userMessage.text, at: now() });
        });
        emitMessage(siteId, threadId, userMessage);
        emitMessage(siteId, threadId, pending);

        const hydrated = await store.hydrate(siteId, threadId, record.api.messages);
        const history = hydrated.map((param, index) => {
          const meta = record.api.messages[index]?.meta;

          return { param, ...(meta ? { meta } : {}) };
        });
        const modelId = settings.ai.model;
        const checkpoint = site.checkpoint(`Assistant: ${titleFrom(userMessage.text)}`);
        const ctx: ToolContext = {
          site,
          siteId,
          mode,
          model,
          images: options.images,
          signal: controller.signal,
          titles: new Map(),
          read: readsOf(threadKey),
          question: null,
          askedLastTurn,
        };
        const tools = new Map<string, ToolActivity>();

        const turnActor: SiteActor = currentScope() ?? { kind: "outside" };
        const notifyTurn = (phase: AssistantTurnNotice["phase"], paths?: string[]) => {
          try {
            options.onTurn?.({ siteId, threadId, turnId, phase, actor: turnActor, ...(paths ? { paths } : {}) });
          } catch {
            // An observer never fails a turn.
          }
        };

        notifyTurn("start");
        void checkpoint.run(async () => {
          let outcome: LoopResult;

          try {
            outcome = await runLoop({
              client,
              shape: {
                model: settings.ai.model,
                effort: settings.ai.effort,
                maxTokens: options.maxTokens ?? AGENT_MAX_TOKENS,
                siteRoot: site.root,
                system: [
                  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
                  { type: "text", text: `<site_card>\n${systemCard}\n</site_card>`, cache_control: { type: "ephemeral" } },
                ],
              },
              mode,
              history,
              opening,
              profile: {
                initial: pinned ?? (plainModels.has(modelId) ? "plain" : "full"),
                ladder: pinned === null,
                onLadder: (detail) => {
                  plainModels.add(modelId);
                  log(`using the plain request profile for ${modelId} from now on: the API refused the full profile (${detail})`);
                },
                thinkingFloor: record.api.plainThinkingFloor ?? 0,
                onFloor: (floor) =>
                  void store
                    .update(siteId, threadId, (stored) => {
                      stored.api.plainThinkingFloor = Math.max(stored.api.plainThinkingFloor ?? 0, floor);
                    })
                    .catch((error) => log(`couldn't save the thinking floor: ${safeDetail(error)}`)),
                ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}),
              },
              ctx,
              signal: controller.signal,
              maxSteps: options.maxSteps ?? MAX_STEPS,
              onText: (delta) => options.events.emit({ type: "chat.delta", siteId, threadId, messageId: assistantId, text: delta }),
              onTool: (activity) => {
                tools.set(activity.id, activity);
                options.events.emit({ type: "chat.tool", siteId, threadId, messageId: assistantId, tool: activity });
                if (checkpoint.paths().length > 0) notifyTurn("write", [...checkpoint.paths()]);
              },
              commit: (messages) =>
                store.update(siteId, threadId, (stored) => {
                  // The opening is in the first commit: only now does the
                  // model know about the notes, the mode and the tool changes.
                  if (messages[0] === opening[0]?.stored) {
                    stored.api.pendingNotes = [];
                    stored.api.mode = mode;
                    stored.api.buildTools = offered.length > 0;
                    stored.api.surfacedTools = offered;
                    stored.api.systemCard ??= systemCard;
                    stored.api.cardHash = cardHash;
                  }
                  stored.api.messages.push(...messages);
                }),
              log,
            });
          } catch (error) {
            log(`turn failed: ${safeDetail(error)}`);
            outcome = { end: "error", text: "", question: null, error: "The assistant stopped unexpectedly. Anything it changed is in Proof.", tools: [...tools.values()], usage: emptyUsage(settings.ai.model), profile: pinned ?? "full" };
          }
          turnProfiles.set(turnId, outcome.profile);
          if (turnProfiles.size > 500) turnProfiles.delete(turnProfiles.keys().next().value as string);
          try {
            await finishTurn({ siteId, threadId, turnId, assistantId, checkpoint, outcome, mode });
            hold(threadKey, turnId, checkpoint, mode);
          } catch (error) {
            log(`couldn't finish the turn: ${safeDetail(error)}`);
            // Never held, so never offered: let go of what it kept rather than keep it until the site closes.
            release(checkpoint);
          } finally {
            notifyTurn("end", [...checkpoint.paths()]);
            active.delete(threadKey);
            resolveDone();
          }
        });
        return { turnId };
      } catch (error) {
        active.delete(threadKey);
        resolveDone();
        throw error;
      }
    },

    working(siteId) {
      const prefix = key(siteId, "");

      for (const threadKey of active.keys()) if (threadKey.startsWith(prefix)) return true;
      return false;
    },

    async cancel(siteId, threadId) {
      const turn = active.get(key(siteId, threadId));

      if (!turn) return;
      turn.controller.abort();
      await turn.done;
    },

    async undoTurn(siteId, threadId, turnId) {
      const threadKey = key(siteId, threadId);

      if (active.has(threadKey)) throw new GalleyError("busy", "Wait for the current reply to finish before undoing.");
      const record = await store.load(siteId, threadId);
      const turn = record?.turns.find((t) => t.turnId === turnId);

      if (!record || !turn) throw new GalleyError("not-found", "That reply isn't in this conversation.", turnId);
      if (turn.undone) return { restored: [], left: [] };
      const list = held.get(threadKey) ?? [];
      const index = list.findIndex((entry) => entry.turnId === turnId);
      const entry = list[index];

      if (!entry) {
        throw new GalleyError(
          "not-found",
          `That reply can't be undone from here any more — only the last ${UNDO_DEPTH} replies in a conversation can, and not after the app restarts. You can still discard its changes in Proof.`,
          turnId
        );
      }
      // Putting a build-mode reply's files back is changing the site's code: the same level as making the change.
      if (entry.mode === "build") requireLevel(BUILD_MODE_LEVEL, UNDO_BUILD_REFUSAL);
      if (undoing.has(entry)) throw new GalleyError("busy", "That reply is being undone already.", turnId);
      // Found again by itself once it has run: a reply held or let go meanwhile shifts the list, never what is taken off it.
      undoing.add(entry);
      let restored: string[];
      let left: string[];

      try {
        // A checkpoint whose site was closed meanwhile has nothing left to put back and refuses here, in a sentence (workspace
        // UNDO_LOST). Nothing below runs then: the reply is not marked as undone, because it wasn't, and asking again says the same.
        restored = await entry.checkpoint.restore();
        left = entry.checkpoint.left();
      } finally {
        undoing.delete(entry);
      }
      const at = list.indexOf(entry);

      if (at !== -1) list.splice(at, 1);
      release(entry.checkpoint);
      let updated: ChatMessage | null = null;

      await store.update(siteId, threadId, (stored: ThreadRecord) => {
        const target = stored.turns.find((t) => t.turnId === turnId);

        if (target) target.undone = true;
        const message = stored.thread.messages.find((m) => m.id === turn.assistantMessageId);

        if (message) {
          message.undone = true;
          if (left.length) message.undoLeft = left;
          updated = message;
        }
        // Told to the model on its next turn, as an operator note.
        stored.api.pendingNotes.push(undoNote(turn.request, restored, left));
        stored.thread.updatedAt = now();
      });
      if (updated) emitMessage(siteId, threadId, updated);
      return { restored, left };
    },

    async describeChanges(siteId, changes) {
      const apiKey = await options.settings.readSecret("anthropic").catch(() => null);
      const client = apiKey ? (options.client ?? createApiClient(apiKey, env, 0)) : null;

      return describeChangeSet(changes, {
        client,
        record: (usage) => {
          // A publish summary is a request, not a conversation turn.
          const entry: UsageLine = { ...usage, requests: 1, siteId, at: now(), kind: "summary" };

          return options.settings.recordUsage(entry);
        },
        log,
      });
    },

    turnProfile(turnId: string) {
      return turnProfiles.get(turnId);
    },
  };
}
