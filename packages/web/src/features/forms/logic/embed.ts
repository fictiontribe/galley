/**
 * Where a form can go and where it is: the site's section types that take a
 * form (a field named `form` / `formId`, or a reference to the forms
 * collection), and the pages whose content names a form.
 */
import type { Field, SiteModel } from "@galley/core/types";
import { formIdOf, isFormField } from "@galley/core/forms/shared";
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
  /** The form the section shows when it names none (a Newsletter section's "newsletter"): it was made for that form. */
  formDefault?: string;
}

/** Whether a field names a form: the engine's rule, which the forms list's "used on" reads with. */
export function namesForm(field: Field): boolean {
  return isFormField(field, FORMS_COLLECTION);
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
          ...(typeof formField.default === "string" ? { formDefault: formField.default } : {}),
        });
      }
    }
  }
  return slots;
}

/**
 * The site's form sections, best first for one form. A section made for this
 * form (its field defaults to it) is how the site already shows it; then a
 * section that takes any form; a section made for another form (a Newsletter
 * section for the contact form) last. Within each group the site's own order.
 */
export function slotsFor(slots: readonly FormSlot[], formId: string): FormSlot[] {
  const rank = (slot: FormSlot) => (slot.formDefault === undefined ? 1 : formIdOf(slot.formDefault) === formId ? 0 : 2);

  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => rank(a.slot) - rank(b.slot) || a.index - b.index)
    .map(({ slot }) => slot);
}

/** Why the first of the ranked sections is offered, in a sentence. */
export function slotAdvice(ranked: readonly FormSlot[], formId: string): string {
  const first = ranked[0];

  if (!first) return "";
  const why = first.formDefault !== undefined && formIdOf(first.formDefault) === formId ? "is made for this form" : first.formDefault === undefined ? "shows any form" : `is made for the “${first.formDefault}” form`;

  return ranked.length === 1 ? `One kind of section on this site shows a form: “${first.blockLabel}”, which ${why}.` : `${ranked.length} kinds of section on this site show a form. “${first.blockLabel}” ${why}; you can choose another.`;
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
