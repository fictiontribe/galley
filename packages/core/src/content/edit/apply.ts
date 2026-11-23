/**
 * applyEdits: the one entry point for changing a document's text. Ops apply
 * in order, each to the result of the previous one. An op that would not
 * change anything is skipped (not counted, file untouched); an op that cannot
 * be done safely is refused with a reason a person can act on.
 */
import type { EditOp, EditRefusal, EntryFormat } from "../../types";
import { bomLength, findFrontMatter, lineBreakOf } from "../document/front-matter";
import { applyJsonOp } from "./json";
import type { DataOp } from "./expected";
import { applyYamlOp, type OpOutcome } from "./yaml/index";

export interface ApplyResult {
  content: string;
  applied: number;
  refused: EditRefusal[];
}

const TOML_REASON =
  "The fields in this file are written in a format the form can't change yet, so nothing was changed. Use the source view to edit this file.";
const NO_BODY_REASON = "This file has no main text, only fields.";

function isBodyFormat(format: EntryFormat): boolean {
  return format === "markdown" || format === "mdx";
}

/** Converts a value's line breaks to the file's own style. */
function withLineBreaks(value: string, eol: string): string {
  return eol === "\r\n" ? value.replace(/\r?\n/g, "\r\n") : value.replace(/\r\n/g, "\n");
}

function bodyOf(raw: string): { start: number; body: string } {
  const region = findFrontMatter(raw);
  const start = region ? region.bodyStart : bomLength(raw);

  return { start, body: raw.slice(start) };
}

function applyBody(raw: string, op: Extract<EditOp, { op: "body" | "body-replace" }>): OpOutcome {
  const { start, body } = bodyOf(raw);
  const eol = lineBreakOf(raw);

  if (op.op === "body") {
    let next = withLineBreaks(op.value, eol);

    // Keep the file's own conventions: the blank line after the front matter
    // and the final line break, so replacing the text doesn't churn them.
    const lead = /^(\r?\n)+/.exec(body)?.[0] ?? "";

    if (start > bomLength(raw) && lead !== "" && !/^\r?\n/.test(next) && next !== "") next = lead + next;
    if (/\n$/.test(body) && !/\n$/.test(next) && next !== "") next += eol;
    if (next === body) return { ok: true, text: raw, changed: false };
    return { ok: true, text: raw.slice(0, start) + next, changed: true };
  }
  if (op.find === "") return { ok: false, reason: "Say which text to replace." };
  if (op.find === op.replace) return { ok: true, text: raw, changed: false };
  let find = op.find;
  let replace = op.replace;

  if (!body.includes(find) && eol === "\r\n") {
    find = withLineBreaks(find, eol);
    replace = withLineBreaks(replace, eol);
  }
  const count = find === "" ? 0 : body.split(find).length - 1;

  if (count === 0) return { ok: false, reason: "That text isn't in the main text of this page, so nothing was replaced." };
  if (count > 1 && !op.all) {
    return {
      ok: false,
      reason: `That text appears ${count} times in the main text. Include more of the surrounding words so it is clear which one to change, or replace all of them.`,
    };
  }
  const next = op.all ? body.split(find).join(replace) : body.replace(find, () => replace);

  return { ok: true, text: raw.slice(0, start) + next, changed: next !== body };
}

function applyData(raw: string, format: EntryFormat, op: DataOp): OpOutcome {
  const bom = raw.slice(0, bomLength(raw));

  if (format === "toml") return { ok: false, reason: TOML_REASON };
  if (format === "json" || format === "yaml") {
    const text = raw.slice(bom.length);
    const outcome = format === "json" ? applyJsonOp(text, op, true) : applyYamlOp(text, op, true);

    return outcome.ok ? { ...outcome, text: bom + outcome.text } : outcome;
  }
  const region = findFrontMatter(raw);

  if (!region) {
    // No front matter yet: a new block is written above the text.
    const outcome = applyYamlOp("", op, false);

    if (!outcome.ok || !outcome.changed) return outcome.ok ? { ...outcome, text: raw } : outcome;
    const eol = lineBreakOf(raw);
    const yamlText = withLineBreaks(outcome.text, eol);

    return { ok: true, changed: true, text: `${bom}---${eol}${yamlText}---${eol}${raw.slice(bom.length)}` };
  }
  if (region.syntax === "toml") return { ok: false, reason: TOML_REASON };
  const outcome = region.syntax === "json" ? applyJsonOp(region.text, op, false) : applyYamlOp(region.text, op, false);

  if (!outcome.ok || !outcome.changed) return outcome.ok ? { ...outcome, text: raw } : outcome;
  return { ok: true, changed: true, text: raw.slice(0, region.start) + outcome.text + raw.slice(region.end) };
}

function applyOne(raw: string, format: EntryFormat, op: EditOp): OpOutcome {
  switch (op.op) {
    case "raw":
      return { ok: true, text: op.value, changed: op.value !== raw };
    case "body":
    case "body-replace":
      if (!isBodyFormat(format)) return { ok: false, reason: NO_BODY_REASON };
      return applyBody(raw, op);
    default:
      if (!Array.isArray(op.path)) return { ok: false, reason: "The edit did not say which field to change." };
      return applyData(raw, format, op);
  }
}

export function applyEdits(raw: string, format: EntryFormat, ops: EditOp[]): ApplyResult {
  let content = raw;
  let applied = 0;
  const refused: EditRefusal[] = [];

  ops.forEach((op, index) => {
    let outcome: OpOutcome;

    try {
      outcome = applyOne(content, format, op);
    } catch (error) {
      // A bug here must never write a half-made change; report it as a refusal.
      outcome = {
        ok: false,
        reason: `This change could not be made safely (${error instanceof Error ? error.message : String(error)}).`,
      };
    }
    if (!outcome.ok) {
      refused.push({ index, op, reason: outcome.reason });
      return;
    }
    if (outcome.changed) {
      content = outcome.text;
      applied += 1;
    }
  });
  return { content, applied, refused };
}
