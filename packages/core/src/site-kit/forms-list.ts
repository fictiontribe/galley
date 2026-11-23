/**
 * The forms list in one answer: each form's definition, its status in the
 * working copy and the pages that show it — what the list's rows used to
 * fetch one request at a time (an entry and a search per form).
 */
import type { FormListItem } from "../api";
import { asFormDefinition } from "../forms/definitions";
import { pagesUsing } from "../forms/shared";
import type { SiteService } from "../types";

export async function listForms(site: SiteService): Promise<FormListItem[]> {
  const model = await site.model();
  const collection = model.collections.find((candidate) => candidate.kit === "forms") ?? model.collections.find((candidate) => candidate.id === "forms" && candidate.format === "json");

  if (!collection) return [];
  const list = await site.listEntries(collection.id, { limit: 500, sort: "title", order: "asc" });
  const items: FormListItem[] = [];

  for (const summary of list.items) {
    if (!summary.path.endsWith(".json")) continue;
    const id = summary.path.split("/").pop()!.replace(/\.json$/i, "");
    let definition: FormListItem["definition"] = null;
    let problem: string | undefined;

    try {
      const result = asFormDefinition(JSON.parse((await site.readFile(summary.path)).content) as unknown);

      if ("definition" in result) definition = result.definition;
      else problem = result.problem;
    } catch {
      problem = "This form's file can't be read.";
    }
    const hits = await site.search(id, { limit: 50 }).catch(() => []);
    const pages = pagesUsing(hits, id, collection.id).map((hit) => ({ path: hit.path, title: hit.title }));

    items.push({ id, path: summary.path, title: summary.title, status: summary.status, definition, ...(problem ? { problem } : {}), pages });
  }
  return items;
}
