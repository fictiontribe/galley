/**
 * Filling in a collection from its files: how many there are, and the fields
 * they hold (merged under whatever the schema declared).
 */
import type { Collection, Field, MediaConfig, SiteModel } from "../../types";
import { listCollectionFiles, readCached } from "../entries/files";
import { inferFields, pickListFields, sample } from "../schema/infer";
import { mergeFields } from "../schema/merge";
import { withBlockSamples, type SampledEntry } from "../schema/samples";
import type { JsonObject } from "../util/json";

export async function inspectCollection(
  root: string,
  model: Pick<SiteModel, "collections">,
  collection: Collection,
  declared: Field[] | null,
  media: MediaConfig
): Promise<Collection> {
  const files = await listCollectionFiles(root, model, collection);
  const items: JsonObject[] = [];
  const entries: SampledEntry[] = [];

  for (const path of sample(files)) {
    const doc = await readCached(root, path, collection.format);

    if (doc && doc.errors.length === 0) {
      items.push(doc.data);
      entries.push({ path, data: doc.data });
    }
  }
  const inferred = inferFields(items, { mediaPublicPaths: media.roots.map((rootDir) => rootDir.publicPath) });
  const fields = withBlockSamples(mergeFields(declared, inferred), entries, collection.titleField);
  const picks = pickListFields(fields);

  return {
    ...collection,
    fields,
    count: collection.kind === "data" ? (files.length > 0 ? 1 : 0) : files.length,
    ...picks,
    ...(collection.titleField ? { titleField: collection.titleField } : {}),
    ...(collection.dateField ? { dateField: collection.dateField } : {}),
    ...(collection.imageField ? { imageField: collection.imageField } : {}),
    ...(collection.draftField ? { draftField: collection.draftField } : {}),
  };
}
