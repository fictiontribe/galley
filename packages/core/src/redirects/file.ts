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

const JSON_WORD = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

/**
 * The place a text first stops being JSON, counted in characters from its
 * start; null when this reader finds no such place, or can't follow the text
 * that far (brackets nested thousands deep). Used only to say where a
 * mistake is, after JSON.parse has refused the text.
 */
export function firstMistake(text: string): number | null {
  let at = 0;
  const space = () => {
    while (at < text.length && " \t\n\r".includes(text[at]!)) at += 1;
  };
  const stop = (): never => {
    throw at;
  };
  const string = () => {
    if (text[at] !== '"') stop();
    at += 1;
    for (;;) {
      const ch = text[at];

      if (ch === undefined || ch < " ") stop();
      if (ch === '"') {
        at += 1;
        return;
      }
      if (ch === "\\") {
        const escaped = text[at + 1];

        if (escaped === "u" ? !/^[0-9a-fA-F]{4}$/.test(text.slice(at + 2, at + 6)) : escaped === undefined || !'"\\/bfnrt'.includes(escaped)) stop();
        at += escaped === "u" ? 6 : 2;
        continue;
      }
      at += 1;
    }
  };
  const value = (): void => {
    space();
    const opened = text[at];

    if (opened === "{" || opened === "[") {
      const closing = opened === "{" ? "}" : "]";

      at += 1;
      space();
      if (text[at] === closing) {
        at += 1;
        return;
      }
      for (;;) {
        if (opened === "{") {
          space();
          string();
          space();
          if (text[at] !== ":") stop();
          at += 1;
        }
        value();
        space();
        if (text[at] === ",") {
          at += 1;
          continue;
        }
        if (text[at] !== closing) stop();
        at += 1;
        return;
      }
    }
    if (opened === '"') return string();
    JSON_WORD.lastIndex = at;
    const word = JSON_WORD.exec(text);

    if (!word) stop();
    at += word![0].length;
  };

  try {
    value();
    space();
    return at < text.length ? at : null;
  } catch (thrown) {
    // A place, or nothing: this only says where, after the text has been refused already. Brackets nested deeper
    // than this reader can follow end here, and are no reason to fail whoever asked what is wrong with the list.
    return typeof thrown === "number" ? thrown : null;
  }
}

/** Reads the list file. Anything that isn't plainly a redirect is a problem to fix by hand; nothing is dropped quietly. */
export function readList(text: string): ReadList {
  let value: unknown;

  if (text.trim() === "") return { ok: true, redirects: [] };
  // Without the byte order mark some editors put first: it is no part of what a person sees or counts from.
  const body = text.replace(/^﻿/, "");

  try {
    value = JSON.parse(body);
  } catch {
    // Where it goes wrong, never what is written there: the parser's own message quotes the file, and this sentence
    // is shown to the assistant and to anyone who may look at the redirects.
    const at = firstMistake(body);
    const where = at === null ? "" : ` near line ${body.slice(0, at).split("\n").length}, column ${at - body.lastIndexOf("\n", at - 1)}`;

    return { ok: false, redirects: [], problem: `The redirects file has a formatting mistake${where}, so it can't be read. Look there for a missing comma, quote or bracket.` };
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
