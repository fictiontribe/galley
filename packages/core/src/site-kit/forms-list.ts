/**
 * The forms list in one answer: each form's definition, its status in the
 * working copy and the pages that show it — what the list's rows used to
 * fetch one request at a time (an entry and a search per form).
 */
import type { FormListItem } from "../api";
import { parseDocument } from "../content/document/parse";
import { formatOf } from "../content/entries/entries";
import { asFormDefinition } from "../forms/definitions";
import { formsNamedIn, isFormField, pagesUsing } from "../forms/shared";
import type { Collection, Field, SiteModel, SiteService } from "../types";

type Page = FormListItem["pages"][number];

/** Whether a collection's schema has a form field with a default somewhere: its entries can show a form without naming it. */
function hasDefaultedFormField(fields: readonly Field[], formsCollection: string): boolean {
  return fields.some(
    (field) =>
      (isFormField(field, formsCollection) && field.default !== undefined) ||
      hasDefaultedFormField([...(field.fields ?? []), ...(field.of ? [field.of] : []), ...(field.blocks ?? []).flatMap((block) => block.fields)], formsCollection)
  );
}

/**
 * The pages each form appears on, from the entries' own data. One pass over
 * the site for the whole list; a file is parsed only when it could name a
 * form (its text mentions a form id) or show one by default.
 */
async function pagesByForm(site: SiteService, model: SiteModel, forms: Collection, ids: readonly string[]): Promise<Map<string, Page[]>> {
  const byForm = new Map<string, Page[]>(ids.map((id) => [id, []]));
  const lowered = ids.map((id) => id.toLowerCase());

  for (const collection of model.collections) {
    if (collection.id === forms.id) continue;
    const defaulted = hasDefaultedFormField(collection.fields, forms.id);
    const list = await site.listEntries(collection.id, { limit: 500 }).catch(() => null);

    for (const summary of list?.items ?? []) {
      let raw: string;

      try {
        raw = (await site.readFile(summary.path)).content;
      } catch {
        continue;
      }
      const text = raw.toLowerCase();

      if (!defaulted && !lowered.some((id) => text.includes(id))) continue;
      let named: string[];

      try {
        named = formsNamedIn(parseDocument(raw, formatOf(collection, summary.path)).data, collection.fields, forms.id);
      } catch {
        continue;
      }
      for (const id of named) byForm.get(id)?.push({ path: summary.path, title: summary.title });
    }
  }
  return byForm;
}

export async function listForms(site: SiteService): Promise<FormListItem[]> {
  const model = await site.model();
  const collection = model.collections.find((candidate) => candidate.kit === "forms") ?? model.collections.find((candidate) => candidate.id === "forms" && candidate.format === "json");

  if (!collection) return [];
  const list = await site.listEntries(collection.id, { limit: 500, sort: "title", order: "asc" });
  const files = list.items.filter((summary) => summary.path.endsWith(".json")).map((summary) => ({ summary, id: summary.path.split("/").pop()!.replace(/\.json$/i, "") }));
  const fromFields = await pagesByForm(
    site,
    model,
    collection,
    files.map((file) => file.id)
  );
  const items: FormListItem[] = [];

  for (const { summary, id } of files) {
    let definition: FormListItem["definition"] = null;
    let problem: string | undefined;

    try {
      const result = asFormDefinition(JSON.parse((await site.readFile(summary.path)).content) as unknown);

      if ("definition" in result) definition = result.definition;
      else problem = result.problem;
    } catch {
      problem = "This form's file can't be read.";
    }
    // Search still finds a form named in a page's body (`<Form id="…" />` in MDX), which fields don't hold.
    const hits = await site.search(id, { limit: 50 }).catch(() => []);
    const pages = [...(fromFields.get(id) ?? [])];

    for (const hit of pagesUsing(hits, id, collection.id)) if (!pages.some((page) => page.path === hit.path)) pages.push({ path: hit.path, title: hit.title });

    items.push({ id, path: summary.path, title: summary.title, status: summary.status, definition, ...(problem ? { problem } : {}), pages });
  }
  return items;
}
