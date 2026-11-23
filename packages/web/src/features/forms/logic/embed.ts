/**
 * Where a form can go and where it is: the site's section types that take a
 * form (a field named `form` / `formId`, or a reference to the forms
 * collection), and the pages whose content names a form.
 */
import type { Field, SiteModel } from "@galley/core/types";
import { FORMS_COLLECTION } from "./locate";

export interface FormSlot {
  /** The collection whose entries can hold the section (e.g. pages). */
  collection: string;
  collectionLabel: string;
  /** The blocks field the section goes into, e.g. "sections". */
  listKey: string;
  /** The key naming the section type, e.g. "type". */
  discriminator: string;
  /** The section type, e.g. "form". */
  blockType: string;
  blockLabel: string;
  /** The field inside the section that names the form. */
  formKey: string;
}

const FORM_KEYS = /^form(_?id)?$/i;

/** Whether a field names a form. */
export function namesForm(field: Field): boolean {
  if (field.type === "reference") return field.collection === FORMS_COLLECTION;
  return FORM_KEYS.test(field.key) && (field.type === "string" || field.type === "select");
}

/** Every section type on the site that takes a form. */
export function formSlots(model: SiteModel | null | undefined): FormSlot[] {
  if (!model) return [];
  const slots: FormSlot[] = [];
  for (const collection of model.collections) {
    if (collection.kind !== "entries" || collection.id === FORMS_COLLECTION) continue;
    for (const field of collection.fields) {
      if (field.type !== "blocks" || !field.blocks) continue;
      for (const block of field.blocks) {
        const formField = block.fields.find(namesForm);
        if (!formField) continue;
        slots.push({
          collection: collection.id,
          collectionLabel: collection.label,
          listKey: field.key,
          discriminator: field.discriminator ?? "type",
          blockType: block.type,
          blockLabel: block.label,
          formKey: formField.key,
        });
      }
    }
  }
  return slots;
}

/** The section to insert for a form: its type, the form's id, and whatever the type's example starts with. */
export function sectionFor(slot: FormSlot, formId: string): { [key: string]: string } {
  return { [slot.discriminator]: slot.blockType, [slot.formKey]: formId };
}

/** Which search hits are pages showing a form: the engine's rule, which the forms list uses on the server too. */
export { namesThisForm, pagesUsing } from "@galley/core/forms/shared";

/** For developers: how a page template shows this form, with the site kit's Astro component. */
export function embedSnippet(formId: string): string {
  return `---\nimport { Form } from "@galley/astro/components";\n---\n<Form id="${formId}" />`;
}
