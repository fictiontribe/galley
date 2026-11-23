/**
 * The list file in the site: `{ "redirects": [ … ] }`, one redirect per line
 * in the canonical order, keys always in the same order. A bulk import is
 * then a readable Proof — one added line per redirect — and two people
 * adding redirects rarely touch the same lines.
 */
import { canonicalOrder } from "./match";
import { REDIRECT_STATUSES } from "./info";
import type { Redirect } from "./types";

const KEYS = ["from", "to", "status", "note", "source"] as const;

function ordered(redirect: Redirect): Redirect {
  const out: Record<string, unknown> = {};

  for (const key of KEYS) if (redirect[key] !== undefined && redirect[key] !== "") out[key] = redirect[key];
  return out as unknown as Redirect;
}

export function serializeList(list: Redirect[]): string {
  const items = canonicalOrder(list).map((redirect) => `    ${JSON.stringify(ordered(redirect))}`);

  return items.length ? `{\n  "redirects": [\n${items.join(",\n")}\n  ]\n}\n` : `{\n  "redirects": []\n}\n`;
}

export type ReadList = { ok: true; redirects: Redirect[] } | { ok: false; problem: string; redirects: Redirect[] };

/** Reads the list file. Anything that isn't plainly a redirect is a problem to fix by hand; nothing is dropped quietly. */
export function readList(text: string): ReadList {
  let value: unknown;

  if (text.trim() === "") return { ok: true, redirects: [] };
  try {
    value = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    return { ok: false, redirects: [], problem: `The redirects file has a formatting mistake, so it can't be read: ${error instanceof Error ? error.message : String(error)}.` };
  }
  const list = (value as { redirects?: unknown })?.redirects;

  if (!Array.isArray(list)) return { ok: false, redirects: [], problem: "The redirects file should hold a “redirects” list." };
  const redirects: Redirect[] = [];
  const problems: string[] = [];

  list.forEach((raw, index) => {
    const item = raw as Partial<Redirect> | null;
    const where = `Redirect ${index + 1}`;

    if (!item || typeof item !== "object") return void problems.push(`${where} isn't a redirect.`);
    if (typeof item.from !== "string" || !item.from.startsWith("/")) return void problems.push(`${where}: the old address must be a path starting with “/”.`);
    if (typeof item.to !== "string" || item.to.trim() === "") return void problems.push(`${where} (${item.from}) has no new address.`);
    if (!REDIRECT_STATUSES.includes(item.status as never)) return void problems.push(`${where} (${item.from}): the status must be 301, 302, 307 or 308.`);
    redirects.push(ordered({ from: item.from, to: item.to, status: item.status!, ...(typeof item.note === "string" ? { note: item.note } : {}), ...(typeof item.source === "string" ? { source: item.source } : {}) }));
  });
  if (problems.length) return { ok: false, redirects, problem: problems.length === 1 ? problems[0]! : `${problems[0]} (and ${problems.length - 1} more)` };
  return { ok: true, redirects };
}

export { defaultListFile } from "./locate";
