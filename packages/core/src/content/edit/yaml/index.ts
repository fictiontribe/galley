/**
 * One data edit on YAML text: compute what the data should become, make the
 * smallest text change that gets there, and prove it by parsing the result.
 *
 * Order of attempts:
 *   1. a surgical splice (scalar in place, or the item's/key's own lines);
 *   2. the `yaml` Document API, accepted only when everything outside the
 *      edited container is byte-identical to before;
 *   3. a refusal that says why.
 */
import { isMap, isScalar, isSeq, type Document, type Node, type Scalar, type YAMLSeq } from "yaml";

import type { FieldPath, JsonValue } from "../../../types";
import { ROOT_LIST_KEY } from "../../document/parse";
import { lineBreakOf } from "../../document/front-matter";
import { deepEqual, isObject, isScalarValue, toJsonValue } from "../../util/json";
import { expectedAfter, type DataOp } from "../expected";
import { detectLayout, endOf, hasAnchor, inFlow, lineStart, nextLineStart, parseYaml, startOf, walk, type Step } from "./locate";
import { addKey, insertItem, moveItem, removeItem, removeKey, replaceNode, scalarCandidates, spliceScalar } from "./splice";

export type OpOutcome = { ok: true; text: string; changed: boolean } | { ok: false; reason: string };

const SYNTAX_REASON = "The fields in this file have a formatting mistake, so it can't be changed safely. Fix it in the source view first.";
const LOCALITY_REASON =
  "This change can't be made without reformatting other parts of the file, so it was not applied. Try editing the file's source instead.";

function rootValue(doc: Document): JsonValue {
  return toJsonValue(doc.toJS({ maxAliasCount: 1000 }));
}

/** Parses candidate text and checks it holds exactly the expected data. */
function verified(text: string, expected: JsonValue): boolean {
  const doc = parseYaml(text);

  if (doc.errors.length > 0) return false;
  const value = rootValue(doc);

  return deepEqual(value ?? {}, expected ?? {}) || (value === null && isObject(expected) && Object.keys(expected).length === 0);
}

/** Builds { a: { b: value } } for the part of a path that doesn't exist yet. */
function nest(path: FieldPath, value: JsonValue): JsonValue {
  return path.reduceRight<JsonValue>((inner, segment) => ({ [String(segment)]: inner }), value);
}

function surgical(text: string, doc: Document, op: DataOp, expected: JsonValue, steps: Step[], missingFrom: number | null): string[] {
  const layout = detectLayout(doc, text, lineBreakOf(text));
  const target = steps[steps.length - 1]!;
  const attempts: Array<string | null> = [];

  switch (op.op) {
    case "set": {
      if (missingFrom !== null) {
        const holder = steps[missingFrom]!;
        const rest = op.path.slice(missingFrom + 1);
        const key = op.path[missingFrom]!;
        const holderNode = holder.node;

        if (holderNode === null && missingFrom === 0) {
          attempts.push(addKey(text, steps, null, String(key), nest(rest, op.value), layout));
        } else if (holderNode && isMap(holderNode)) {
          attempts.push(addKey(text, steps.slice(0, missingFrom + 1), holderNode, String(key), nest(rest, op.value), layout));
        } else if (holderNode && isSeq(holderNode) && typeof key === "number" && rest.length === 0) {
          attempts.push(insertItem(text, holderNode, key, op.value, layout));
        } else if (holderNode && isScalar(holderNode) && holderNode.value === null) {
          // "seo:" with nothing after it: the empty value becomes the new structure.
          attempts.push(replaceNode(text, steps.slice(0, missingFrom + 1), nest(op.path.slice(missingFrom), op.value), layout));
        }
        break;
      }
      const node = target.node;

      if (node && isScalar(node) && isScalarValue(op.value)) {
        const flow = inFlow(steps, steps.length - 2);

        for (const rendered of scalarCandidates(text, node as Scalar, op.value, target, layout, flow)) {
          attempts.push(spliceScalar(text, node as Scalar, rendered));
        }
        break;
      }
      if (node && hasAnchor(node)) break;
      attempts.push(replaceNode(text, steps, op.value, layout));
      break;
    }
    case "unset": {
      if (target.node && hasAnchor(target.node)) break;
      attempts.push(removeKey(text, steps, layout));
      break;
    }
    case "insert":
    case "move":
    case "remove": {
      const node = target.node;

      if (missingFrom !== null || !node || !isSeq(node)) {
        if (op.op === "insert" && (missingFrom !== null || (node && isScalar(node) && node.value === null))) {
          return surgical(text, doc, { op: "set", path: op.path, value: [op.value] }, expected, steps, missingFrom);
        }
        break;
      }
      const seq = node as YAMLSeq;

      if (op.op === "insert") attempts.push(insertItem(text, seq, op.index, op.value, layout));
      else if (op.op === "remove") {
        if (hasAnchor(seq.items[op.index])) break;
        attempts.push(removeItem(text, steps, seq, op.index, layout));
      } else attempts.push(moveItem(text, op.path, seq, op.from, op.to, layout));
      break;
    }
  }
  return attempts.filter((attempt): attempt is string => attempt !== null && attempt !== text);
}

/**
 * The Document API route. Comments survive, but the whole document is
 * re-emitted, so the result is only accepted when every byte before and
 * after the edited container's lines is unchanged.
 */
function viaDocument(text: string, op: DataOp, steps: Step[], expected: JsonValue): string | null {
  const doc = parseYaml(text);
  const layout = detectLayout(doc, text, lineBreakOf(text));

  try {
    switch (op.op) {
      case "set":
        doc.setIn(op.path, doc.createNode(op.value));
        break;
      case "unset":
        doc.deleteIn(op.path);
        break;
      case "insert":
      case "move":
      case "remove": {
        const seq = (op.path.length === 0 ? doc.contents : doc.getIn(op.path, true)) as YAMLSeq | null;

        if (!seq || !isSeq(seq)) return null;
        if (op.op === "insert") seq.items.splice(op.index, 0, doc.createNode(op.value));
        else if (op.op === "remove") seq.items.splice(op.index, 1);
        else {
          const [item] = seq.items.splice(op.from, 1);

          seq.items.splice(op.to, 0, item);
        }
        break;
      }
    }
  } catch {
    return null;
  }
  const out = doc.toString({ lineWidth: 0, minContentWidth: 0, indent: layout.unit, indentSeq: layout.seqIndented, flowCollectionPadding: true });
  const normalised = layout.eol === "\r\n" ? out.replace(/\r?\n/g, "\r\n") : out;

  if (!verified(normalised, expected)) return null;
  // The container whose lines may change: the deepest existing node below the root.
  const existing = steps.slice(1).filter((step) => step.node && (step.node as { range?: unknown }).range);
  const node = (existing[existing.length - 1]?.node ?? null) as Node | null;

  if (!node || !(node as { range?: unknown }).range) return null;
  const from = lineStart(text, startOf(node));
  const to = nextLineStart(text, endOf(text, node)!);
  const tail = text.length - to;

  if (normalised.slice(0, from) !== text.slice(0, from)) return null;
  if (normalised.length < tail || normalised.slice(normalised.length - tail) !== text.slice(to)) return null;
  return normalised;
}

/** Applies one data op to YAML text (a front-matter block or a whole .yaml file). */
export function applyYamlOp(text: string, op: DataOp, rootList: boolean): OpOutcome {
  const doc = parseYaml(text);

  if (doc.errors.length > 0) return { ok: false, reason: SYNTAX_REASON };
  let path = op.path;

  if (rootList && isSeq(doc.contents)) {
    if (path[0] !== ROOT_LIST_KEY) return { ok: false, reason: `This file is a list; edit paths start with “${ROOT_LIST_KEY}”.` };
    path = path.slice(1);
  } else if (doc.contents !== null && !isMap(doc.contents)) {
    return { ok: false, reason: "This file does not hold a set of fields, so its fields can't be edited one by one." };
  }
  const localOp = { ...op, path } as DataOp;
  const before = rootValue(doc);
  const expected = expectedAfter(before, localOp);

  if (!expected.ok) return expected;
  if (!expected.changed) return { ok: true, text, changed: false };
  if (localOp.op === "set" && localOp.path.length === 0) return { ok: false, reason: "Say which field to change." };

  const walked = walk(doc, localOp.path);

  if (!walked.ok) return walked;
  for (const candidate of surgical(text, doc, localOp, expected.value, walked.steps, walked.missingFrom)) {
    if (verified(candidate, expected.value)) return { ok: true, text: candidate, changed: true };
  }
  const fallback = viaDocument(text, localOp, walked.steps, expected.value);

  if (fallback !== null) return { ok: true, text: fallback, changed: true };
  return { ok: false, reason: LOCALITY_REASON };
}

