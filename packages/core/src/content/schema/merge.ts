/**
 * Precedence: config > schema > inferred. This file joins the last two — a
 * declared schema is authoritative about what exists and what is required,
 * while the corpus contributes what a schema leaves vague (a `z.string()`
 * that every file fills with an image path is an image field).
 */
import type { BlockType, Field, FieldType } from "../../types";

/** Types a declared plain string may be refined to by the evidence in the files. */
const STRING_REFINEMENTS: FieldType[] = ["text", "markdown", "image", "url", "color", "date", "datetime"];

function mergeField(declared: Field, seen: Field | undefined): Field {
  if (!seen) return declared;
  const out: Field = { ...declared };

  if (seen.examples && !out.examples) out.examples = seen.examples;
  if (declared.type === "json") {
    // The schema names the field but its type could not be read statically.
    return { ...seen, key: declared.key, label: declared.label, required: declared.required, source: declared.source, ...(declared.description ? { description: declared.description } : {}), ...(declared.default !== undefined ? { default: declared.default } : {}) };
  }
  if (declared.type === "string" && STRING_REFINEMENTS.includes(seen.type)) out.type = seen.type;
  if (declared.type === "tags" && !out.options && seen.options) out.options = seen.options;
  if (declared.type === "list" && declared.of && seen.of) out.of = mergeField(declared.of, seen.of);
  if (declared.type === "list" && declared.of?.type === "string" && seen.type === "tags") {
    out.type = "tags";
    if (seen.options) out.options = seen.options;
    delete out.of;
  }
  if (declared.type === "list" && (declared.of?.type === "object" || declared.of?.type === "json") && seen.type === "blocks") {
    // A schema that only says "a list of objects" (often passthrough) while
    // every item carries a type key: the files show it is a block list.
    out.type = "blocks";
    delete out.of;
    if (seen.discriminator) out.discriminator = seen.discriminator;
    if (seen.blocks) out.blocks = seen.blocks;
  }
  if (declared.type === "object" && declared.fields) out.fields = mergeFields(declared.fields, seen.fields ?? []);
  if (declared.type === "blocks" && declared.blocks) out.blocks = mergeBlocks(declared.blocks, seen.blocks ?? []);
  return out;
}

function mergeBlocks(declared: BlockType[], seen: BlockType[]): BlockType[] {
  return declared.map((block) => {
    const match = seen.find((candidate) => candidate.type === block.type);

    if (!match) return block;
    return {
      ...block,
      fields: mergeFields(block.fields, match.fields),
      count: match.count,
      ...(match.example ? { example: match.example } : {}),
      ...(match.samples ? { samples: match.samples } : {}),
    };
  });
}

/** Declared fields first (in declared order), then keys the files carry that the schema lacks. */
export function mergeFields(declared: Field[] | null, inferred: Field[]): Field[] {
  if (!declared) return inferred;
  const merged = declared.map((field) => mergeField(field, inferred.find((candidate) => candidate.key === field.key)));
  const extras = inferred.filter((field) => !declared.some((candidate) => candidate.key === field.key));

  return [...merged, ...extras];
}
