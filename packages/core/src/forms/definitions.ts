/**
 * Form definitions, read from the site's own `forms` collection through
 * `SiteService` — one JSON file per form, its id the file name.
 *
 * Which version counts: a live page was built from the *published* form, so
 * a submission from a visitor is checked against the published file (an
 * unpublished edit that adds a required field must not break the live form).
 * A submission from a preview on this computer, or from the app itself, is
 * checked against the version being edited. A form that has never been
 * published is read from the working copy either way.
 */
import type { FormDefinition, FormField } from "../kit";
import type { SiteService } from "../types";
import { FORM_ID_PATTERN } from "./store";

export const FORMS_COLLECTION = "forms";

export type DefinitionSource = "published" | "working";

export interface LoadedForm {
  id: string;
  path: string;
  definition: FormDefinition;
  source: DefinitionSource;
}

export interface FormFile {
  id: string;
  path: string;
  /** Null when the file can't be read as a form; `problem` says why. */
  definition: FormDefinition | null;
  problem?: string;
}

/** Turns parsed JSON into a FormDefinition, or a plain reason it isn't one. */
export function asFormDefinition(raw: unknown): { definition: FormDefinition } | { problem: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { problem: "This form's file isn't a form." };
  const input = raw as Partial<FormDefinition> & { fields?: unknown; destinations?: unknown };

  if (typeof input.name !== "string" || !input.name.trim()) return { problem: "This form has no name." };
  if (!Array.isArray(input.fields)) return { problem: "This form has no fields." };
  const fields = input.fields.filter(
    (field): field is FormField => Boolean(field) && typeof field === "object" && typeof (field as FormField).id === "string" && typeof (field as FormField).type === "string"
  );

  return {
    definition: {
      ...(input as FormDefinition),
      name: input.name,
      fields,
      submitLabel: typeof input.submitLabel === "string" ? input.submitLabel : "Send",
      destinations: Array.isArray(input.destinations) ? input.destinations.filter((item) => item && typeof item === "object" && typeof item.provider === "string") : [],
      afterSubmit: Array.isArray(input.afterSubmit) ? input.afterSubmit : [],
    },
  };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The site's forms: the collection detection recognised as the kit's, else the one called "forms". */
async function formsCollection(site: SiteService) {
  const model = await site.model();

  return model.collections.find((collection) => collection.kit === "forms") ?? model.collections.find((collection) => collection.id === FORMS_COLLECTION) ?? null;
}

/** Every form file in the site's forms collection, as it is in the working copy. */
export async function listFormFiles(site: SiteService): Promise<FormFile[]> {
  const collection = await formsCollection(site);

  if (!collection) return [];
  const list = await site.listEntries(collection.id, { limit: 500, sort: "title", order: "asc" });
  const files: FormFile[] = [];

  for (const entry of list.items) {
    if (!FORM_ID_PATTERN.test(entry.slug) || !entry.path.endsWith(".json")) continue;
    let text: string;

    try {
      text = (await site.readFile(entry.path)).content;
    } catch {
      files.push({ id: entry.slug, path: entry.path, definition: null, problem: "This form's file can't be read." });
      continue;
    }
    const result = asFormDefinition(parse(text));

    files.push("definition" in result ? { id: entry.slug, path: entry.path, definition: result.definition } : { id: entry.slug, path: entry.path, definition: null, problem: result.problem });
  }
  return files;
}

/** One form by id, the version `prefer` names when it exists. Null for no such form. */
export async function loadForm(site: SiteService, formId: string, prefer: DefinitionSource): Promise<LoadedForm | null> {
  if (!FORM_ID_PATTERN.test(formId)) return null;
  const collection = await formsCollection(site);

  if (!collection) return null;
  const path = `${collection.path.replace(/\/+$/, "")}/${formId}.json`;

  if (prefer === "published") {
    const bytes = await site.readBase(path).catch(() => null);

    if (bytes) {
      const result = asFormDefinition(parse(Buffer.from(bytes).toString("utf8")));

      if ("definition" in result) return { id: formId, path, definition: result.definition, source: "published" };
    }
  }
  let text: string;

  try {
    text = (await site.readFile(path)).content;
  } catch {
    return null;
  }
  const result = asFormDefinition(parse(text));

  return "definition" in result ? { id: formId, path, definition: result.definition, source: "working" } : null;
}

/** Whether the form sends to the inbox at all. */
export function capturesHere(form: FormDefinition): boolean {
  return form.destinations.some((destination) => destination.provider === "galley");
}
