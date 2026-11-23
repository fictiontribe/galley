/**
 * Usage accounting: one JSON line per assistant turn (or image generation)
 * appended to `<home>/usage.jsonl`, rolled up on demand. Costs are list-price
 * estimates so a team can see what the app spends — never a bill.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TurnUsage, UsageSummary, UsageTotals } from "../types";

export type UsageLine = TurnUsage & {
  siteId: string;
  at: number;
  images?: number;
  /** Videos made (a video generation's line). */
  videos?: number;
  /** "summary": a one-off request (a publish message), counted in requests but not as a turn. */
  kind?: "turn" | "summary";
};

export function usageFile(home: string): string {
  return join(home, "usage.jsonl");
}

export async function appendUsage(home: string, line: UsageLine): Promise<void> {
  await mkdir(home, { recursive: true });
  await appendFile(usageFile(home), `${JSON.stringify(line)}\n`);
}

export async function readUsage(home: string): Promise<UsageLine[]> {
  let raw: string;

  try {
    raw = await readFile(usageFile(home), "utf8");
  } catch {
    return [];
  }
  const lines: UsageLine[] = [];

  for (const text of raw.split("\n")) {
    if (text.trim() === "") continue;
    try {
      const line = JSON.parse(text) as UsageLine;

      if (typeof line.at === "number" && typeof line.model === "string") lines.push(line);
    } catch {
      // A torn last line from a crash mid-append — skip it, keep the rest.
    }
  }
  return lines;
}

function empty(): UsageTotals {
  return { turns: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, images: 0, cost: 0, videos: 0, media: { images: 0, videos: 0, unpriced: 0 } };
}

/** An image or video generation's line: no assistant requests. Lines from before videos were counted carry neither count. */
function mediaOf(line: UsageLine): "image" | "video" | null {
  if (line.requests !== 0 || line.kind === "summary") return null;
  if ((line.images ?? 0) > 0) return "image";
  return "video";
}

function add(totals: UsageTotals, line: UsageLine): void {
  totals.images += line.images ?? 0;
  const media = mediaOf(line);

  if (media) {
    // What the image or video service reported its work cost, labelled apart; a service that didn't say adds nothing.
    const parts = (totals.media ??= { images: 0, videos: 0, unpriced: 0 });

    if (media === "video") totals.videos = (totals.videos ?? 0) + (line.videos ?? 1);
    // The built-in placeholder generator ("mock") makes its pictures here, for nothing — older lines recorded no price for it.
    const cost = typeof line.cost === "number" ? line.cost : line.model.startsWith("mock:") ? 0 : null;

    if (cost !== null) {
      parts[media === "image" ? "images" : "videos"] += cost;
      if (totals.cost !== null) totals.cost += cost;
    } else {
      parts.unpriced += 1;
    }
    return;
  }
  totals.turns += line.requests > 0 && line.kind !== "summary" ? 1 : 0;
  totals.requests += line.requests;
  totals.inputTokens += line.inputTokens;
  totals.outputTokens += line.outputTokens;
  totals.cacheReadTokens += line.cacheReadTokens;
  totals.cacheWriteTokens += line.cacheWriteTokens;
  // One unpriced model makes the total an under-estimate, so it is withheld
  // rather than shown quietly wrong.
  totals.cost = line.cost === null || totals.cost === null ? null : totals.cost + line.cost;
}

/** Local YYYY-MM-DD: usage buckets by the person's day, not UTC's. */
export function localDay(at: number): string {
  const date = new Date(at);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Local midnight `daysAgo` days before `now`. Calendar arithmetic, so DST days are 23 or 25 hours. */
function startOfLocalDay(now: number, daysAgo: number): number {
  const date = new Date(now);

  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.getTime();
}

export function summarizeUsage(lines: UsageLine[], now: number): UsageSummary {
  const today = empty();
  const last7 = empty();
  const last30 = empty();
  const allTime = empty();
  const byModel = new Map<string, UsageTotals>();
  const todayStart = startOfLocalDay(now, 0);
  const weekStart = startOfLocalDay(now, 6);
  const monthStart = startOfLocalDay(now, 29);
  const dayKeys: string[] = [];

  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) dayKeys.push(localDay(startOfLocalDay(now, daysAgo)));
  const days = new Map(dayKeys.map((date) => [date, { date, requests: 0, cost: 0 as number | null }]));

  for (const line of lines) {
    add(allTime, line);
    if (line.at >= todayStart) add(today, line);
    if (line.at >= weekStart) add(last7, line);
    if (line.at >= monthStart) add(last30, line);
    // The by-model table is the assistant's (requests and tokens); images and videos are in the totals, labelled.
    if (!mediaOf(line)) {
      const totals = byModel.get(line.model) ?? empty();

      add(totals, line);
      byModel.set(line.model, totals);
    }
    const day = days.get(localDay(line.at));

    if (day) {
      day.requests += line.requests;
      if (mediaOf(line)) {
        if (typeof line.cost === "number" && day.cost !== null) day.cost += line.cost;
      } else {
        day.cost = day.cost === null || line.cost === null ? null : day.cost + line.cost;
      }
    }
  }
  return {
    today,
    last7,
    last30,
    allTime,
    byModel: [...byModel.entries()]
      .map(([model, totals]) => ({ model, ...totals }))
      .sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model)),
    days: [...days.values()],
  };
}
