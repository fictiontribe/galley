/** One-line descriptions of a site model, shared by init and doctor. */
import type { Collection, SiteModel } from "@galley/core/types";
import { plural } from "./args";

export function frameworkLine(model: SiteModel): string {
  const parts = [`${model.framework.name}${model.framework.version ? ` ${model.framework.version}` : ""}`];

  if (model.packageManager) parts.push(model.packageManager);
  if (model.dev) parts.push(`dev: ${model.dev.command}${model.dev.port ? ` (port ${model.dev.port})` : ""}`);
  return parts.join(" · ");
}

function collectionCount(collection: Collection): string {
  return collection.kind === "data" ? `${collection.id} (data)` : `${collection.id} (${collection.count})`;
}

export function collectionsLine(model: SiteModel): string {
  const visible = model.collections;

  return `${plural(visible.length, "collection")}: ${visible.map(collectionCount).join(", ")}`;
}

function countFields(collection: Collection): number {
  return collection.fields.filter((field) => !field.hidden).length;
}

export function collectionDetail(collection: Collection): string {
  const fields = collection.fields.filter((field) => !field.hidden).map((field) => field.key);
  const shown = fields.slice(0, 6).join(", ") + (fields.length > 6 ? ", …" : "");
  const where = collection.kind === "data" ? collection.path : `${collection.path}${collection.pattern ? `/${collection.pattern}` : ""}`;

  return `${collection.id}: “${collection.label}” · ${plural(countFields(collection), "field")}${shown ? ` (${shown})` : ""} · ${where}${collection.url ? ` → ${collection.url}` : ""}`;
}

export function mediaLine(model: SiteModel): string {
  const extra = model.media.roots.filter((root) => root.dir !== model.media.dir).length;

  return `media: ${model.media.dir} → ${model.media.publicPath}${extra ? ` (+${plural(extra, "more folder")})` : ""}`;
}
