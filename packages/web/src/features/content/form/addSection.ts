/**
 * Adding a section, the one way: the form's "Add section" and Arrange on the
 * page both call this. It works out what the new section starts with
 * (scaffold.ts: blanks for words, the nearest real value where a blank
 * wouldn't draw), inserts it through the entry's queue with the same Undo as
 * any list action, and tells the person once, with that Undo, when something
 * was borrowed.
 */
import type { BlockSample, BlockType, Field, FieldPath, JsonValue, SiteModel } from "@galley/core/types";
import { collectionForPath } from "@/lib/collections";
import { useSite } from "@/lib/stores/site";
import { listActions, type ListActionResult } from "../fields/items/listActions";
import { getAt } from "./paths";
import { borrowedNote, newSection, type Borrowed, type SectionContext } from "./scaffold";
import type { FormStore } from "./store";
import { blockLabel } from "./summary";

/** Where else on the site this section type appears: other collections' samples, with what each calls an entry. */
function elsewhere(model: SiteModel | null | undefined, entryPath: string, type: string): SectionContext["elsewhere"] {
  const own = collectionForPath(model, entryPath);
  const out: Array<{ samples: readonly BlockSample[]; noun: string }> = [];
  for (const collection of model?.collections ?? []) {
    if (collection.id === own?.id) continue;
    for (const field of collection.fields) {
      const block = field.type === "blocks" ? field.blocks?.find((candidate) => candidate.type === type) : undefined;
      if (block?.samples?.length) out.push({ samples: block.samples, noun: collection.singular });
    }
  }
  return out;
}

export interface AddSection {
  store: FormStore;
  /** The blocks field and where it is in the entry. */
  field: Field;
  path: FieldPath;
  block: BlockType;
  index: number;
  entryPath: string;
  /** The site's model, for the same section type on other collections (default: the open site's). */
  model?: SiteModel | null;
}

/** Inserts the new section. Null when it couldn't be (the list changed under it). */
export function addSection({ store, field, path, block, index, entryPath, model = useSite.getState().detail?.model }: AddSection): (ListActionResult & { borrowed: Borrowed[] }) | null {
  const siblings = getAt(store.getState().data, path);
  const collection = collectionForPath(model, entryPath);
  const { value, borrowed } = newSection(block, field.discriminator ?? "type", {
    siblings: Array.isArray(siblings) ? siblings : [],
    index,
    entryPath,
    noun: collection?.singular ?? "page",
    elsewhere: elsewhere(model, entryPath, block.type),
  });
  const note = borrowedNote(block.label, borrowed);
  const result = listActions({ store, path, noun: "section", label: (item: JsonValue | undefined) => blockLabel(item, field) }).insert(index, value, {
    kind: block.label,
    ...(note ? { say: { title: `${block.label} added`, body: note } } : {}),
  });
  return result ? { ...result, borrowed } : null;
}
