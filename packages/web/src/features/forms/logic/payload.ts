/**
 * What a submission would send to each destination — the "Test" run's table.
 * Nothing here sends anything: it lists names and values the way the site's
 * runtime builds them (visible fields only, under their mapped names, then
 * the fixed values).
 */
import type { FormDefinition, FormDestination, FormField } from "@galley/core/kit";
import { ruleHolds, shownIds, type Answers } from "./conditions";
import { isLayout } from "./fieldTypes";
import { mappedName } from "./mapping";
import { describeAutofill } from "./tracking";

export interface PayloadRow {
  /** The name the destination receives. */
  name: string;
  value: string;
  /** Where the value comes from: the field's label, "Fixed value", or how a hidden field is filled. */
  source: string;
  /** Hidden fields are filled on the page; the test can only describe them. */
  filledOnPage?: boolean;
}

export interface DestinationPayload {
  index: number;
  provider: string;
  /** False when the destination's "only when…" doesn't hold. */
  sent: boolean;
  rows: PayloadRow[];
}

function answerText(field: FormField, answers: Answers): string {
  const value = answers[field.id];
  if (value === undefined) return field.defaultValue ?? "";
  return Array.isArray(value) ? value.join(", ") : value;
}

/** The fields that would be sent for these answers: visible, not layout. */
export function sentFields(form: FormDefinition, answers: Answers): FormField[] {
  const shown = shownIds(form.fields, answers);
  return form.fields.filter((field) => !isLayout(field) && shown.has(field.id));
}

export function payloadFor(form: FormDefinition, destination: FormDestination, index: number, answers: Answers): DestinationPayload {
  const sent = destination.when ? ruleHolds({ field: destination.when.field, equals: destination.when.equals }, answers) : true;
  const rows: PayloadRow[] = sentFields(form, answers).map((field) => {
    if (field.type === "hidden" && field.autofill) {
      return { name: mappedName(destination, field), value: field.defaultValue ?? "", source: describeAutofill(field) ?? "Filled on the page", filledOnPage: true };
    }
    return { name: mappedName(destination, field), value: answerText(field, answers), source: field.label?.trim() || field.id };
  });
  for (const [name, value] of Object.entries(destination.constants ?? {})) rows.push({ name, value, source: "Fixed value" });
  return { index, provider: destination.provider, sent, rows };
}

/** Every destination's table, in order (the first decides success). */
export function payloads(form: FormDefinition, answers: Answers): DestinationPayload[] {
  return form.destinations.map((destination, index) => payloadFor(form, destination, index, answers));
}
