/**
 * Before a publish: every product or collection handle the changed pages
 * name (in fields that pick from this plugin's data sources) is looked up,
 * and a handle the store no longer has comes back as a warning — shown in
 * Proof and in the Publish dialog under the plugin's name, and kept in the
 * plugin's log. It never refuses the publish: a page that names a gone
 * product still builds (the starter shows nothing for it).
 */
import type { BeforePublishResult, ChangeSet, JsonValue, SitePluginContext } from "@galleycms/plugin-kit";
import { ShopifyError } from "./client";
import { resolveSource } from "./source";
import { existingHandles } from "./store";

/** The parts of an entry's field list this check reads (the engine's Field, structurally). */
interface Field {
  key: string;
  label: string;
  type: string;
  dataSource?: string;
  discriminator?: string;
  of?: Field;
  fields?: Field[];
  blocks?: Array<{ type: string; label: string; fields: Field[] }>;
}

const SOURCES = { "shopify-products": "product", "shopify-collections": "collection" } as const;

type Kind = (typeof SOURCES)[keyof typeof SOURCES];

/** Every handle the entry's data holds in a field that picks from one of our sources, with where it is. */
export function referencedHandles(fields: readonly Field[], data: { [key: string]: JsonValue } | JsonValue): Array<{ kind: Kind; handle: string; field: string }> {
  const out: Array<{ kind: Kind; handle: string; field: string }> = [];
  const kindOf = (field: Field | undefined) => (field?.dataSource && field.dataSource in SOURCES ? SOURCES[field.dataSource as keyof typeof SOURCES] : null);

  const visit = (list: readonly Field[], value: JsonValue | undefined, at: string): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const field of list) {
      const item = (value as { [key: string]: JsonValue })[field.key];
      const where = at ? `${at} › ${field.label}` : field.label;

      collect(field, item, where);
    }
  };
  const collect = (field: Field, value: JsonValue | undefined, where: string): void => {
    const kind = kindOf(field);

    if (kind && typeof value === "string" && value.trim()) {
      out.push({ kind, handle: value.trim(), field: where });
      return;
    }
    if (Array.isArray(value)) {
      if (field.type === "blocks") {
        const key = field.discriminator ?? "type";

        value.forEach((block, index) => {
          if (!block || typeof block !== "object" || Array.isArray(block)) return;
          const type = field.blocks?.find((candidate) => candidate.type === (block as { [key: string]: JsonValue })[key]);

          if (type) visit(type.fields, block, `${where} ${index + 1} (${type.label})`);
        });
        return;
      }
      if (field.of) value.forEach((item, index) => collect(field.of!, item, `${where} ${index + 1}`));
      return;
    }
    if (field.fields && value && typeof value === "object") visit(field.fields, value, where);
  };

  visit(fields, data as JsonValue, "");
  return out;
}

export async function beforePublish(ctx: SitePluginContext, changes: ChangeSet): Promise<BeforePublishResult | void> {
  const references: Array<{ kind: Kind; handle: string; field: string; page: string }> = [];

  for (const file of changes.files) {
    if (file.kind !== "content" || file.status === "deleted") continue;
    try {
      const entry = await ctx.site.readEntry(file.path);

      for (const reference of referencedHandles(entry.fields, entry.data)) references.push({ ...reference, page: entry.title || file.path });
    } catch {
      // Not an entry (a data file the model doesn't map): nothing to check.
    }
  }
  if (!references.length) return;
  let source;

  try {
    source = await resolveSource(ctx.settings, ctx.site);
  } catch (error) {
    return couldNotCheck(ctx, error);
  }
  const known: Record<Kind, Set<string>> = { product: new Set(), collection: new Set() };

  try {
    for (const kind of ["product", "collection"] as const) {
      const handles = references.filter((reference) => reference.kind === kind).map((reference) => reference.handle);

      if (!handles.length) continue;
      if (source.kind === "demo") {
        const list = kind === "product" ? source.catalogue.products.map((product) => product.handle) : (source.catalogue.collections ?? []).map((collection) => collection.handle);

        known[kind] = new Set(list.filter((handle) => handles.includes(handle)));
      } else {
        known[kind] = await existingHandles(ctx, source.connection, kind, handles);
      }
    }
  } catch (error) {
    return couldNotCheck(ctx, error);
  }
  const missing = references.filter((reference) => !known[reference.kind].has(reference.handle));
  const where = source.kind === "demo" ? "the demo catalogue" : source.connection.host;

  const warnings = missing.map((reference) => `“${reference.page}” shows the ${reference.kind} “${reference.handle}” (${reference.field}), which ${where} doesn't have any more. The page will leave it out until it is changed.`);

  for (const warning of warnings) ctx.log.warn(warning);
  return warnings.length ? { warnings } : undefined;
}

/** A check that couldn't run says so, so nobody takes silence for "all fine". */
function couldNotCheck(ctx: SitePluginContext, error: unknown): BeforePublishResult {
  const warning = `Couldn't check the products these pages show: ${error instanceof ShopifyError ? error.message : "the store couldn't be read"}`;

  ctx.log.warn(warning);
  return { warnings: [warning] };
}
