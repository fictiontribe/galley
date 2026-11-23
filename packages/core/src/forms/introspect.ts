/**
 * Reading the field list of a form that already exists on a provider's side,
 * so the form builder can add matching fields and their mapping in one go.
 * Only what the provider publishes without credentials is read — the same
 * definition its own embed script fetches in a visitor's browser:
 *
 * - HubSpot: `https://forms.hsforms.com/embed/v3/form/<portalId>/<formId>/json`
 *   (`forms-<region>.hsforms.com` outside North America) — the definition the
 *   v2 embed script loads for legacy-editor forms. Forms made in HubSpot's
 *   newer editor answer "Not an Embed version 2 or 3 form"; those are said so.
 * - Marketo: `<host>/index.php/form/getForm?munchkinId=<id>&form=<formId>` —
 *   the form descriptor `forms2.js` (MktoForms2.loadForm) loads from the
 *   instance or landing-page host; without a `callback` it answers plain JSON.
 *
 * Every request goes through the SSRF guards in net.ts: HubSpot only to its
 * own hosts; Marketo to the configured host, which must resolve to a public
 * address; https, default port, no redirects to other hosts, 8 s, 1 MB.
 */
import { GalleyError } from "../errors";
import type { FormIntrospectField, FormIntrospectResult } from "../api";
import type { JsonValue } from "../types";
import { createGuardedFetch, OutboundRefused, type GuardedFetch, type OutboundResponse } from "./net";

export const INTROSPECTABLE_PROVIDERS = ["hubspot", "marketo"] as const;

const HUBSPOT_HOST = /^forms(?:-[a-z]{2}[0-9])?\.hsforms\.com$/;

function text(value: JsonValue | undefined): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function cantRead(message: string, detail?: string): GalleyError {
  return new GalleyError("invalid", message, detail);
}

function parseJson(response: OutboundResponse, provider: string): unknown {
  // Marketo's descriptor is served as application/javascript and is JSONP when a callback is named.
  const body = response.body.trim().replace(/^[A-Za-z_$][\w$.]*\(([\s\S]*)\);?$/, "$1");

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw cantRead(`${provider} answered with something that isn't a form definition.`, body.slice(0, 200));
  }
}

function plainLabel(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const label = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[:*]+\s*$/, "");

  return label || undefined;
}

function options(raw: unknown, labelKey: string, valueKey: string): FormIntrospectField["options"] {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && (item as { hidden?: unknown }).hidden !== true)
    .map((item) => ({ value: String(item[valueKey] ?? ""), label: plainLabel(item[labelKey]) ?? String(item[valueKey] ?? "") }))
    .filter((item) => item.value !== "");

  return list.length ? list : undefined;
}

// ─────────────────────────────────────────────────────────────── HubSpot

const HUBSPOT_TYPES: Record<string, string> = {
  // Embed/v2 shape (formFieldGroups)
  text: "text",
  textarea: "textarea",
  select: "select",
  radio: "radio",
  checkbox: "checkboxes",
  booleancheckbox: "checkbox",
  number: "number",
  date: "date",
  file: "file",
  phonenumber: "tel",
  // v3 shape (fieldGroups)
  single_line_text: "text",
  multi_line_text: "textarea",
  email: "email",
  phone: "tel",
  mobile_phone: "tel",
  dropdown: "select",
  multiple_checkboxes: "checkboxes",
  single_checkbox: "checkbox",
  datepicker: "date",
};

export function hubspotFields(json: unknown): FormIntrospectField[] {
  const root = (json ?? {}) as Record<string, unknown>;
  const form = (root.form && typeof root.form === "object" ? root.form : root) as Record<string, unknown>;
  const groups = (form.formFieldGroups ?? form.fieldGroups ?? []) as Array<Record<string, unknown>>;
  const out: FormIntrospectField[] = [];
  const seen = new Set<string>();

  const add = (field: Record<string, unknown>) => {
    const name = text(field.name as JsonValue);

    if (!name || seen.has(name)) return;
    seen.add(name);
    const raw = text(field.fieldType as JsonValue).toLowerCase();
    let type = field.hidden === true ? "hidden" : (HUBSPOT_TYPES[raw] ?? (raw || undefined));

    if (type === "text" && name === "email") type = "email";
    const entry: FormIntrospectField = { name };
    const label = plainLabel(field.label);
    const choices = options(field.options, "label", "value");

    if (label) entry.label = label;
    if (type) entry.type = type;
    if (field.required === true) entry.required = true;
    if (choices) entry.options = choices;
    out.push(entry);
    // Fields shown only after another answer (legacy dependentFieldFilters; v3 dependentFields).
    for (const dependent of [...asArray(field.dependentFieldFilters), ...asArray(field.dependentFields)]) {
      const inner = (dependent as Record<string, unknown>).dependentFormField ?? (dependent as Record<string, unknown>).dependentField;

      if (inner && typeof inner === "object") add(inner as Record<string, unknown>);
    }
  };

  for (const group of Array.isArray(groups) ? groups : []) for (const field of asArray(group?.fields)) if (field && typeof field === "object") add(field as Record<string, unknown>);
  return out;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function introspectHubspot(settings: { [key: string]: JsonValue }, fetcher: GuardedFetch): Promise<FormIntrospectResult> {
  const portalId = text(settings.portalId);
  const formId = text(settings.formId).toLowerCase();
  const region = text(settings.region).toLowerCase();

  if (!/^[0-9]{4,12}$/.test(portalId)) throw cantRead("Enter the HubSpot Hub ID first: the number in your HubSpot account menu.");
  if (!/^[0-9a-f-]{36}$/.test(formId)) throw cantRead("Enter the HubSpot form ID first: the long code in the form's address in HubSpot.");
  if (region && !/^[a-z]{2}[0-9]$/.test(region)) throw cantRead("The data region looks like “eu1” or “na1”.");
  const host = !region || region === "na1" ? "forms.hsforms.com" : `forms-${region}.hsforms.com`;
  const response = await fetcher(`https://${host}/embed/v3/form/${portalId}/${formId}/json`, { headers: { accept: "application/json" } }, {
    allowHost: (name) => HUBSPOT_HOST.test(name),
    defaultPortOnly: true,
  });
  const json = parseJson(response, "HubSpot") as { status?: unknown; message?: unknown };
  const message = typeof json?.message === "string" ? json.message : "";

  if (response.status === 404 || /not found/i.test(message)) {
    throw cantRead(`HubSpot has no form with that ID in account ${portalId}. Check the Hub ID, the form ID and the data region.`, message);
  }
  if (/embed version 2 or 3/i.test(message)) {
    throw cantRead("This HubSpot form was made in HubSpot's newer form editor, which doesn't share its fields publicly. Add the fields here by hand, then map them.", message);
  }
  if (response.status >= 400 || json?.status === "error") throw cantRead("HubSpot didn't share this form's fields. Add them here by hand, then map them.", `HTTP ${response.status} ${message}`);
  const fields = hubspotFields(json);

  if (!fields.length) throw cantRead("This HubSpot form has no fields to copy.");
  return { fields };
}

// ─────────────────────────────────────────────────────────────── Marketo

const MARKETO_TYPES: Record<string, string> = {
  string: "text",
  email: "email",
  phone: "tel",
  telephone: "tel",
  url: "url",
  number: "number",
  integer: "number",
  float: "number",
  currency: "number",
  range: "number",
  date: "date",
  text: "textarea",
  textarea: "textarea",
  picklist: "select",
  select: "select",
  checkbox: "checkboxes",
  checkboxes: "checkboxes",
  single_checkbox: "checkbox",
  radiobuttons: "radio",
  radio: "radio",
  hidden: "hidden",
};
const MARKETO_LAYOUT = new Set(["htmltext", "richtext", "profiling", "fieldset"]);

export function marketoFields(json: unknown): FormIntrospectField[] {
  const out: FormIntrospectField[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const field = node as Record<string, unknown>;
    const datatype = text(field.Datatype as JsonValue).toLowerCase();

    if (datatype && !MARKETO_LAYOUT.has(datatype)) {
      const name = text((field.Name ?? field.Id) as JsonValue);

      if (name && !seen.has(name)) {
        seen.add(name);
        let type = MARKETO_TYPES[datatype] ?? datatype;

        if (type === "select" && field.IsMultiselect === true) type = "checkboxes";
        // A Marketo checkbox with one choice is a single yes/no box.
        if (type === "checkboxes" && asArray(field.PicklistValues).length <= 1) type = "checkbox";
        const entry: FormIntrospectField = { name, type };
        // A lone tick box often carries its wording in its one choice rather than its label.
        const label = plainLabel(field.InputLabel ?? field.Label) ?? (type === "checkbox" ? plainLabel((asArray(field.PicklistValues)[0] as { label?: unknown } | undefined)?.label) : undefined);
        const choices = type === "checkbox" ? undefined : options(asArray(field.PicklistValues).filter((item) => text((item as { value?: JsonValue })?.value) !== ""), "label", "value");

        if (label) entry.label = label;
        if (field.IsRequired === true) entry.required = true;
        if (choices) entry.options = choices;
        out.push(entry);
      }
    }
    for (const key of ["rows", "fieldList", "Fields", "fieldsetRows"]) if (key in field) visit(field[key]);
  };

  visit((json as Record<string, unknown> | null)?.rows ?? json);
  return out;
}

async function introspectMarketo(settings: { [key: string]: JsonValue }, fetcher: GuardedFetch): Promise<FormIntrospectResult> {
  const munchkinId = text(settings.munchkinId).toUpperCase();
  const formId = text(settings.formId);
  const rawHost = text(settings.host);

  if (!/^[0-9]{3}-[A-Z]{3}-[0-9]{3}$/.test(munchkinId)) throw cantRead("Enter the Marketo Munchkin ID first, like 123-ABC-456.");
  if (!/^[0-9]{1,10}$/.test(formId)) throw cantRead("Enter the Marketo form ID first: the number in the form's embed code.");
  let host: URL;

  try {
    host = new URL(/^https?:\/\//i.test(rawHost) ? rawHost : `https://${rawHost}`);
  } catch {
    throw cantRead("Enter the address your Marketo forms are served from, like https://go.example.com.");
  }
  if (!rawHost) throw cantRead("Enter the address your Marketo forms are served from, like https://go.example.com.");
  const url = new URL("/index.php/form/getForm", host.origin);

  url.searchParams.set("munchkinId", munchkinId);
  url.searchParams.set("form", formId);
  const response = await fetcher(url.toString(), { headers: { accept: "application/json, text/javascript" } }, { defaultPortOnly: true });
  const json = parseJson(response, "Marketo") as { error?: unknown; message?: unknown; errorCode?: unknown };
  const message = typeof json?.message === "string" ? json.message : "";

  if (json?.error === true || response.status >= 400) {
    if (/subscription not found/i.test(message) || json?.errorCode === "614") {
      throw cantRead(`Marketo doesn't know Munchkin ID ${munchkinId} at ${host.hostname}. Check both.`, message);
    }
    if (/form/i.test(message) && /not found|doesn't exist|does not exist/i.test(message)) {
      throw cantRead(`Marketo has no approved form ${formId} for this Munchkin ID. Check the form ID, and that the form is approved.`, message);
    }
    throw cantRead("Marketo didn't share this form's fields. Check the form is approved, or add the fields here by hand.", `HTTP ${response.status} ${message}`);
  }
  const fields = marketoFields(json);

  if (!fields.length) throw cantRead("This Marketo form has no fields to copy.");
  return { fields };
}

// ─────────────────────────────────────────────────────────────── entry point

export async function introspectForm(provider: string, settings: { [key: string]: JsonValue }, deps: { fetch?: GuardedFetch } = {}): Promise<FormIntrospectResult> {
  const fetcher = deps.fetch ?? createGuardedFetch();

  try {
    if (provider === "hubspot") return await introspectHubspot(settings, fetcher);
    if (provider === "marketo") return await introspectMarketo(settings, fetcher);
  } catch (error) {
    if (error instanceof OutboundRefused) throw cantRead(`The form couldn't be read: ${error.message}`, error.detail);
    if (error instanceof GalleyError) throw error;
    throw cantRead("The provider couldn't be reached. Check the settings and your connection, then try again.", error instanceof Error ? error.message : String(error));
  }
  throw cantRead("Fields can't be read from this kind of form. Add them here by hand.", provider);
}
