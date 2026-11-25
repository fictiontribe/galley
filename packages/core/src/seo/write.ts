/**
 * Assistant-written fixes: descriptions, alt text (written by looking at the
 * image), clearer titles, a plain opening, questions and answers. One model
 * request per page, with a purpose-written instruction and a structured
 * answer, so the number of requests is known before a batch starts.
 *
 * The rule that matters: nothing is invented. The model may only use what the
 * page (and, for an opening, the site) already says; a figure, price or
 * address in its answer that the page doesn't contain is caught here and the
 * answer is dropped with the reason. Results are ordinary edits waiting in
 * Proof — nothing is published.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { labelForFieldPath } from "../content/diff/fields";
import { getIn, isObject } from "../content/util/json";
import { safeDetail } from "../ai/errors";
import { costFor } from "../ai/models";
import type { EditOp, Entry, EventBus, JsonValue, MediaItem, SiteService } from "../types";
import { createJobTracker } from "../site/jobs";
import { contentWriteRefusal, heldBelowBuild } from "../site/content-code";
import { readContentPage, type ContentPage } from "./content";
import { auditSite, lastFindings } from "./audit";
import { collapse, cut, DISPLAY, textWidth } from "./text";
import type { WriteBatchStatus, WriteItemResult, WriteKind, WritePlan, WritePlanItem } from "./types";

export const WRITE_MAX_BATCH = 200;
/** Why a writing batch leaves a page alone on a hosted install: it works outside build mode, held like the assistant in a content conversation. */
export const WRITE_BATCH_HELD =
  "The writing batch works outside build mode, so it leaves alone a page an account without build mode couldn't change (MDX, or another framework's templates). Change this one yourself in the form, or ask the assistant in build mode.";
const PAGE_TEXT_CHARS = 6_000;
const SVG_CHARS = 20_000;
const VIEWABLE_BYTES = 3_700_000;
const VISION: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** Each instruction says what to write, where the facts come from, and when to write nothing. */
export const WRITE_INSTRUCTIONS: Record<WriteKind, string> = {
  description:
    "You write the short description that search results show under a web page's title. Use only facts stated in the page text you are given: never add a claim, number, price, date, name, place or promise the page doesn't state. Write one or two plain sentences, about 110 to 155 characters, in the page's own language and voice. No keyword lists, no quotation marks, no \"Welcome to\", no exclamation marks. If the page doesn't say enough to describe it honestly, answer with value null and say in reason what is missing.",
  alt: "You write alt text for one image on a web page: a short description, read aloud by screen readers and used by search engines, of what the image shows that matters on this page. Look at the image itself. One phrase or short sentence, under 125 characters, without \"image of\" or \"picture of\". Don't name people, places, products or brands unless the page text names them. If the image is purely decorative (a texture, a divider, a background pattern), answer with value \"\" and reason \"decorative\". If you can't see the image, answer with value null.",
  title:
    "You propose a clearer title for a web page, as it appears in search results and browser tabs. Under 60 characters; say what the page is about in the page's own words; use only facts on the page. Leave out the site's name when the site adds it itself (you are told whether it does). No keyword stuffing, no clickbait, no all caps. If the current title is already clear and specific, answer with value null and say so in reason.",
  intro:
    "You rewrite the opening paragraph of a web page so its first sentence says plainly who this is, what they offer and for whom. Use only facts already on the site, which you are given: never add a claim, figure, name, place or promise that isn't there. Keep the page's voice, language and any markdown emphasis; keep it about the same length (never more than a third longer). If the facts don't say who, what and for whom, answer with value null and say in reason what is missing.",
  faq:
    "You draft questions and answers for a web page from its existing text. Write three to six questions a visitor would really ask, each answered only with facts the page states (closely paraphrased, one to three sentences). Never invent prices, dates, policies, guarantees or names. Give the section a short heading. If the page doesn't answer at least three real questions, answer with items null and say why in reason.",
};

const VALUE_SCHEMA = {
  type: "object",
  properties: { value: { type: ["string", "null"] }, reason: { type: "string" } },
  required: ["value", "reason"],
  additionalProperties: false,
};
const FAQ_SCHEMA = {
  type: "object",
  properties: {
    heading: { type: ["string", "null"] },
    items: { anyOf: [{ type: "null" }, { type: "array", items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"], additionalProperties: false } }] },
    reason: { type: "string" },
  },
  required: ["heading", "items", "reason"],
  additionalProperties: false,
};

export interface WriterDeps {
  /** The API client, or null when no key is configured. */
  client(): Promise<Anthropic | null>;
  model(): Promise<string>;
  record(usage: { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number | null; siteId: string }): Promise<void>;
  events: EventBus;
  log(line: string): void;
}

/** The pages (or images) a batch would write for: findings of the last audit that offer this kind of writing. */
export async function planWrite(site: SiteService, kind: WriteKind, deps: Pick<WriterDeps, "client" | "model">, paths?: string[]): Promise<WritePlan> {
  let findings = lastFindings(site);

  if (!findings.length) findings = (await auditSite(site)).findings;
  const wanted = paths ? new Set(paths) : null;
  const items: WritePlanItem[] = [];
  const seen = new Set<string>();

  for (const item of findings) {
    if (item.write !== kind || !item.path || (wanted && !wanted.has(item.path))) continue;
    if (kind !== "faq" && kind !== "intro" && !item.field) continue;
    const field = kind === "faq" || kind === "intro" ? (item.field ?? []) : item.field!;
    const key = `${item.path}\u0000${field.join(".")}`;

    if (seen.has(key)) continue;
    seen.add(key);
    const current = kind === "alt" ? (item.code === "image-alt-missing" ? "" : (item.evidence.value ?? "")) : kind === "description" ? (item.code === "description-missing" ? "" : undefined) : undefined;
    const image = kind === "alt" ? (item.code === "image-alt-missing" ? item.evidence.value : /^For (\S+)\.$/.exec(item.evidence.note ?? "")?.[1]) : undefined;

    items.push({ path: item.path, title: item.pageTitle ?? item.path, url: item.url ?? null, field, fieldLabel: item.fieldLabel ?? field.join(" › "), ...(image ? { image } : {}), ...(current !== undefined ? { current } : {}) });
  }
  const client = await deps.client().catch(() => null);

  return {
    kind,
    items: items.slice(0, WRITE_MAX_BATCH),
    requests: Math.min(items.length, WRITE_MAX_BATCH),
    model: await deps.model(),
    connected: client !== null,
    note: "One request per page. The assistant uses only what the page already says; anything it can't write from the page is left as it is and the reason is listed. Everything lands in Proof for review; nothing is published.",
  };
}

function textOf(page: ContentPage): string {
  return cut(page.text, PAGE_TEXT_CHARS);
}

/** Figures, money, percentages, addresses and links in `answer` that `source` doesn't contain. */
export function inventedFacts(answer: string, source: string): string[] {
  const haystack = source.toLowerCase().replace(/[\s,]/g, "");
  const tokens = [
    ...(answer.match(/[£$€¥]\s?\d[\d,.]*|\d[\d,.]*\s?%|\b\d[\d,.:]*\b/g) ?? []),
    ...(answer.match(/\b[\w.+-]+@[\w-]+\.[\w.]+\b|https?:\/\/\S+/g) ?? []),
  ];

  return [...new Set(tokens.map((token) => token.replace(/[.,:]+$/, "")))].filter((token) => token && !haystack.includes(token.toLowerCase().replace(/[\s,]/g, "")));
}

async function imageInput(site: SiteService, src: string): Promise<Anthropic.ContentBlockParam | { refused: string }> {
  if (!/^\/(?!\/)/.test(src)) return { refused: "The image isn't one of the site's own files, so it can't be looked at here." };
  const item = (await site.listMedia().catch(() => [] as MediaItem[])).find((media) => media.url === src.split(/[?#]/)[0]);

  if (!item) return { refused: "The image file isn't in the site's media." };
  const ext = item.path.split(".").pop()?.toLowerCase() ?? "";
  const bytes = await readFile(site.resolvePath(item.path));

  if (ext === "svg") return { type: "text", text: `The image is an SVG drawing. Its source:\n${bytes.toString("utf8").slice(0, SVG_CHARS)}` };
  const mediaType = VISION[ext];

  if (!mediaType) return { refused: "This kind of image file can't be looked at by the assistant." };
  if (bytes.length > VIEWABLE_BYTES) return { refused: "The image file is too large to send to the assistant." };
  return { type: "image", source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") } };
}

interface Prepared {
  content: Anthropic.ContentBlockParam[];
  /** Text the answer's facts must come from. */
  facts: string;
}

async function prepareRequest(site: SiteService, kind: WriteKind, entry: Entry, page: ContentPage, item: WritePlanItem): Promise<Prepared | { refused: string }> {
  const model = await site.model();
  const header = [`Site: ${model.name}`, `Page: ${page.title?.value ?? entry.title}${page.url ? ` (${page.url})` : ""}`];

  switch (kind) {
    case "description": {
      const facts = `${page.title?.value ?? ""}\n${page.text}`;

      return { facts, content: [{ type: "text", text: `${header.join("\n")}\n\nThe page's text:\n${textOf(page)}` }] };
    }
    case "title": {
      const facts = `${model.name}\n${page.title?.value ?? ""}\n${page.description?.value ?? ""}\n${page.text}`;

      return { facts, content: [{ type: "text", text: `${header.join("\n")}\nCurrent title: ${page.title?.value ?? "(none)"}\nThe site adds its name to titles itself: unknown — leave the site's name out.\n\nThe page's text:\n${textOf(page)}` }] };
    }
    case "alt": {
      if (!item.image) return { refused: "No image was named." };
      const image = await imageInput(site, item.image);

      if ("refused" in image) return image;
      return { facts: page.text, content: [image, { type: "text", text: `${header.join("\n")}\nImage: ${item.image}\n\nThe page's text, for context:\n${cut(page.text, 2_000)}` }] };
    }
    case "intro": {
      if (!page.opening) return { refused: "The page has no opening paragraph to rewrite." };
      const about = (await site.entryForUrl("/about/").catch(() => null)) ?? null;
      const aboutText = about && about.path !== page.path ? cut(readContentPage(await site.readEntry(about.path), model.collections.find((c) => c.id === about.collection)!).text, 3_000) : "";
      const facts = `${model.name}\n${page.text}\n${aboutText}`;

      return { facts, content: [{ type: "text", text: `${header.join("\n")}\n\nThe opening paragraph to rewrite:\n${page.opening.value}\n\nFacts on this page:\n${textOf(page)}${aboutText ? `\n\nFacts on the about page:\n${aboutText}` : ""}` }] };
    }
    case "faq": {
      if (!page.faqBlock) return { refused: "This kind of page has no question-and-answer section to put them in." };
      if (page.sections.includes(page.faqBlock.type)) return { refused: "The page already has a question-and-answer section." };
      return { facts: page.text, content: [{ type: "text", text: `${header.join("\n")}\n\nThe page's text:\n${textOf(page)}` }] };
    }
  }
}

type Answer = { kind: "value"; value: string | null; reason: string } | { kind: "faq"; heading: string | null; items: Array<{ question: string; answer: string }> | null; reason: string };

/** One request, one structured answer. Refusals and cut-off answers are reported, never applied. */
async function ask(client: Anthropic, modelId: string, kind: WriteKind, prepared: Prepared, signal: AbortSignal): Promise<{ answer: Answer | null; problem?: string; usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } }> {
  const message = await client.messages.create(
    {
      model: modelId,
      max_tokens: 4_000,
      system: WRITE_INSTRUCTIONS[kind],
      output_config: { effort: "low", format: { type: "json_schema", schema: kind === "faq" ? FAQ_SCHEMA : VALUE_SCHEMA } },
      messages: [{ role: "user", content: prepared.content }],
    },
    { signal }
  );
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };

  if (message.stop_reason === "refusal") return { answer: null, problem: "The assistant declined to write this one.", usage };
  if (message.stop_reason === "max_tokens") return { answer: null, problem: "The answer was cut off.", usage };
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;

    if (kind === "faq") return { answer: { kind: "faq", heading: typeof parsed.heading === "string" ? parsed.heading : null, items: Array.isArray(parsed.items) ? (parsed.items as Array<{ question: string; answer: string }>) : null, reason: String(parsed.reason ?? "") }, usage };
    return { answer: { kind: "value", value: typeof parsed.value === "string" ? parsed.value : null, reason: String(parsed.reason ?? "") }, usage };
  } catch {
    return { answer: null, problem: "The answer couldn't be read.", usage };
  }
}

/** Checks an answer against the rules and turns it into edits, or says why not. */
export function answerToOps(kind: WriteKind, answer: Answer, page: ContentPage, entry: Entry, item: WritePlanItem, facts: string): { ops: EditOp[]; value: string } | { reason: string } {
  if (answer.kind === "faq") {
    if (!answer.items || answer.items.length < 3) return { reason: answer.reason || "The page doesn't answer enough questions." };
    const invented = inventedFacts(answer.items.map((qa) => `${qa.question} ${qa.answer}`).join(" "), facts);

    if (invented.length) return { reason: `It included ${invented.slice(0, 3).join(", ")}, which the page doesn't state.` };
    const block = page.faqBlock!;
    const collection = entry.fields.find((field) => field.key === block.field);
    const discriminator = collection?.discriminator ?? "type";
    const list = Array.isArray(entry.data[block.field]) ? (entry.data[block.field] as JsonValue[]) : [];
    const last = list[list.length - 1];
    // Before a closing call to action, where the site has one; otherwise at the end.
    const index = isObject(last) && /cta|call|contact|newsletter/i.test(String(last[discriminator] ?? "")) ? list.length - 1 : list.length;
    const value: JsonValue = { [discriminator]: block.type, ...(answer.heading ? { heading: answer.heading } : {}), items: answer.items.map((qa) => ({ [block.itemKeys.question]: collapse(qa.question), [block.itemKeys.answer]: collapse(qa.answer) })) };

    return { ops: [{ op: "insert", path: [block.field], index, value }], value: answer.items.map((qa) => qa.question).join(" · ") };
  }
  if (answer.value === null) return { reason: answer.reason || "Nothing to write from what the page says." };
  const value = collapse(answer.value);

  if (kind === "alt") {
    if (value.length > 250) return { reason: "The description was too long for alt text." };
    if (/^(an? )?(image|picture|photo) of\b/i.test(value)) return { reason: "The description started with “image of”." };
    return { ops: [{ op: "set", path: item.field, value }], value };
  }
  const invented = inventedFacts(value, facts);

  if (invented.length) return { reason: `It included ${invented.slice(0, 3).join(", ")}, which the page doesn't state.` };
  if (kind === "description" && (value.length < 50 || value.length > 320)) return { reason: `It was ${value.length} characters long; descriptions here are kept between 50 and 320.` };
  if (kind === "title" && textWidth(value, DISPLAY.title.fontPx) > DISPLAY.title.limit) return { reason: "The proposed title was still too long." };
  if (kind === "intro") {
    if (!page.opening) return { reason: "The page has no opening paragraph." };
    if (value.length > page.opening.value.length * 1.35 + 40) return { reason: "The rewrite was much longer than the original." };
    if (page.opening.field) return { ops: [{ op: "set", path: page.opening.field, value }], value };
    return { ops: [{ op: "body-replace", find: page.opening.value, replace: value }], value };
  }
  return { ops: [{ op: "set", path: item.field, value }], value };
}

/** Whether the target still needs writing: someone may have changed it since it was checked. */
function stillNeeded(kind: WriteKind, entry: Entry, item: WritePlanItem): boolean {
  if (kind === "intro" || kind === "faq" || item.current === undefined) return true;
  const value = getIn(entry.data, item.field);

  return (typeof value === "string" ? value : "") === item.current;
}

export interface WriteBatches {
  start(site: SiteService, kind: WriteKind, options?: { paths?: string[]; limit?: number }): Promise<WriteBatchStatus>;
  status(jobId: string): WriteBatchStatus | null;
  cancel(jobId: string): void;
  dispose(): void;
}

export function createWriteBatches(deps: WriterDeps): WriteBatches {
  const jobs = createJobTracker(deps.events);
  const batches = new Map<string, { status: WriteBatchStatus; controller: AbortController }>();

  return {
    async start(site, kind, options = {}) {
      const client = await deps.client();

      if (!client) {
        const { noKeyError } = await import("../ai/errors");

        throw noKeyError();
      }
      const plan = await planWrite(site, kind, deps, options.paths);
      const limit = Math.max(0, Math.min(options.limit ?? plan.items.length, WRITE_MAX_BATCH));
      const items: WriteItemResult[] = plan.items.slice(0, limit).map((item) => ({ ...item, state: "pending" }));
      const label = { description: "Writing descriptions", alt: "Writing alt text", title: "Proposing clearer titles", intro: "Rewriting the opening", faq: "Drafting questions and answers" }[kind];
      const job = jobs.start("visibility", `${label} · ${items.length} ${items.length === 1 ? "page" : "pages"}`);
      const controller = new AbortController();
      const status: WriteBatchStatus = { job: { ...job.snapshot(), siteId: site.id }, kind, items, requests: items.length };

      job.update({ siteId: site.id, progress: 0, detail: `0 of ${items.length}` });
      batches.set(job.id, { status, controller });
      const modelId = await deps.model();

      void (async () => {
        let done = 0;

        for (const item of items) {
          if (controller.signal.aborted) {
            item.state = "skipped";
            item.reason = "Stopped before this one.";
            continue;
          }
          try {
            const entry = await site.readEntry(item.path);
            const collection = (await site.model()).collections.find((c) => c.id === entry.collection);

            if (!collection) throw new Error("not a content entry");
            const page = readContentPage(entry, collection);

            // Asked before the model is paid for: a page this write may not change (outside build mode, the assistant may
            // change only what an account without build mode could, on a hosted install) is skipped, with the reason.
            const held = contentWriteRefusal(item.path, await site.model(), { origin: "agent" });

            if (held) {
              item.state = "skipped";
              item.reason = heldBelowBuild({ origin: "agent" }) === "assistant" ? WRITE_BATCH_HELD : held;
            } else if (!stillNeeded(kind, entry, item)) {
              item.state = "skipped";
              item.reason = "It was changed since it was checked.";
            } else {
              const prepared = await prepareRequest(site, kind, entry, page, item);

              if ("refused" in prepared) {
                item.state = "skipped";
                item.reason = prepared.refused;
              } else {
                const reply = await ask(client, modelId, kind, prepared, controller.signal);

                await deps.record({ model: modelId, ...reply.usage, cost: costFor(modelId, reply.usage), siteId: site.id }).catch(() => undefined);
                if (!reply.answer) {
                  item.state = "failed";
                  item.reason = reply.problem ?? "No answer.";
                } else {
                  const planned = answerToOps(kind, reply.answer, page, entry, item, prepared.facts);

                  if ("reason" in planned) {
                    item.state = "skipped";
                    item.reason = planned.reason;
                  } else {
                    const result = await site.updateEntry(item.path, planned.ops, { origin: "agent", baseHash: entry.hash });

                    if (result.applied > 0) {
                      item.state = "written";
                      item.value = planned.value;
                      item.fieldLabel = item.field.length ? labelForFieldPath(collection, entry.data, item.field) : item.fieldLabel;
                    } else {
                      item.state = "failed";
                      item.reason = result.refused[0]?.reason ?? "The edit wasn't accepted.";
                    }
                  }
                }
              }
            }
          } catch (error) {
            item.state = "failed";
            item.reason = controller.signal.aborted ? "Stopped." : error instanceof Error && "status" in error ? "The assistant couldn't be reached." : safeDetail(error, 200);
            deps.log(`visibility write failed for ${item.path}: ${safeDetail(error, 300)}`);
          }
          done += 1;
          job.update({ progress: done / items.length, detail: `${done} of ${items.length}` });
          status.job = { ...job.snapshot(), siteId: site.id };
        }
        const written = items.filter((item) => item.state === "written").length;

        job.finish(controller.signal.aborted ? "error" : "done", { progress: 1, siteId: site.id, detail: controller.signal.aborted ? `Stopped. ${written} written; they're in Proof.` : `${written} of ${items.length} written. They're waiting in Proof.` });
        status.job = { ...job.snapshot(), siteId: site.id };
      })();
      return status;
    },
    status(jobId) {
      const held = batches.get(jobId);

      if (!held) return null;
      return { ...held.status, job: jobs.get(jobId) ?? held.status.job, items: held.status.items.map((item) => ({ ...item })) };
    },
    cancel(jobId) {
      batches.get(jobId)?.controller.abort();
    },
    dispose() {
      for (const held of batches.values()) held.controller.abort();
      jobs.dispose();
    },
  };
}
