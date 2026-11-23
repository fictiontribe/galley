/**
 * Checking a site-kit file — a form, or the scripts setup — as what it is:
 * with the kit's own schema (the same one the site's build runs, so what
 * Proof calls a problem is what would stop the build), plus the few things
 * the engine can say that a build can't: a pattern too slow to run safely, a
 * redirect with no address, a page address that matches no page, code the
 * site's settings leave out.
 *
 * Every message names its place in the builder's words —
 * "Fields › Work email › Required", "Destinations › HubSpot › Hub ID" — so a
 * person can find it without knowing the file's layout.
 */
import type { z } from "zod";
import { FORM_PROVIDERS, SCRIPT_INTEGRATIONS } from "../kit-catalog";
import type { Field, FieldPath, JsonValue, ValidationIssue } from "../types";
import { compilePattern, patternRisk, PATTERN_RISK_MESSAGE } from "../forms/shared";
import { FORM_FIELDS, SCRIPTS_FIELDS } from "./fields";
import { checkForm, checkScripts, formSchema, scriptsSchema } from "./schema";

export type KitKind = "forms" | "scripts";

export interface KitCheckContext {
  /** Whether the site lets forms run custom code (`forms.allowFormScripts`). */
  allowFormScripts?: boolean;
  /** Whether a page address exists on the site. */
  routeExists?: (urlPath: string) => boolean;
}

type Json = { [key: string]: JsonValue };

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const clip = (value: string) => (value.length > 40 ? `${value.slice(0, 39)}…` : value);

/** What one item of a list is called in a trail. */
function itemName(listKey: string, item: unknown, index: number): string {
  const record = isObject(item) ? item : {};

  switch (listKey) {
    case "fields":
      return clip(text(record.label) || text(record.text) || text(record.id) || `Field ${index + 1}`);
    case "options":
      return clip(text(record.label) || text(record.value) || `Option ${index + 1}`);
    case "steps":
      return clip(text(record.title) || `Step ${index + 1}`);
    case "destinations": {
      const provider = text(record.provider);

      return FORM_PROVIDERS.find((entry) => entry.id === provider)?.name ?? (provider || `Destination ${index + 1}`);
    }
    case "scripts": {
      const kindOf = text(record.kind);

      return clip(text(record.label) || SCRIPT_INTEGRATIONS.find((entry) => entry.kind === kindOf)?.name || text(record.id) || `Script ${index + 1}`);
    }
    default:
      return `${index + 1}`;
  }
}

/**
 * A path in a kit file as the builder names it: ["fields", 2, "required"] →
 * ["Fields", "Work email", "Required"].
 */
export function kitTrail(kind: KitKind, data: unknown, path: FieldPath): string[] {
  const out: string[] = [];
  let fields: Field[] | undefined = kind === "forms" ? FORM_FIELDS : SCRIPTS_FIELDS;
  let current: Field | undefined;
  let value: unknown = data;
  /** The list item a "settings" key belongs to, to name settings from the catalogue. */
  let owner: { list: string; item: unknown } | null = null;
  let listKey = "";

  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index]!;

    if (typeof segment === "number") {
      const item = Array.isArray(value) ? value[segment] : undefined;

      if (current?.type === "blocks") {
        const type = isObject(item) ? text(item.type) : "";
        const block = current.blocks?.find((candidate) => candidate.type === type);

        out.push(block?.label ?? `${segment + 1}`);
        fields = block?.fields;
      } else {
        out.push(itemName(listKey, item, segment));
        fields = current?.of?.fields;
      }
      if (listKey === "destinations" || listKey === "scripts") owner = { list: listKey, item };
      current = undefined;
      value = item;
      continue;
    }
    const parent = current;

    // Settings, mappings and fixed values are keyed by what the provider or integration calls them.
    if (parent && (parent.key === "settings" || parent.key === "mapping" || parent.key === "constants") && owner) {
      const record = isObject(owner.item) ? owner.item : {};

      if (parent.key === "settings") {
        const known =
          owner.list === "destinations"
            ? FORM_PROVIDERS.find((entry) => entry.id === record.provider)?.settings
            : SCRIPT_INTEGRATIONS.find((entry) => entry.kind === record.kind)?.settings;

        out.push(known?.find((setting) => setting.key === segment)?.label ?? segment);
      } else if (parent.key === "mapping" && isObject(data) && Array.isArray(data.fields)) {
        const field = data.fields.find((candidate) => isObject(candidate) && candidate.id === segment);

        out.push(isObject(field) ? itemName("fields", field, 0) : segment);
      } else {
        out.push(segment);
      }
      current = undefined;
      fields = undefined;
      value = isObject(value) ? value[segment] : undefined;
      continue;
    }
    const field = fields?.find((candidate) => candidate.key === segment);

    // "Destinations › HubSpot › Hub ID": a setting is named by itself, not under "Settings".
    if (!(segment === "settings" && owner && index < path.length - 1)) out.push(field?.label ?? segment);
    current = field;
    listKey = segment;
    fields = field?.type === "object" ? field.fields : undefined;
    value = isObject(value) ? value[segment] : undefined;
  }
  return out;
}

function valueAt(data: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let value = data;

  for (const segment of path) {
    if (Array.isArray(value) && typeof segment === "number") value = value[segment];
    else if (isObject(value) && typeof segment === "string") value = value[segment];
    else return undefined;
  }
  return value;
}

const EXPECTED: Record<string, string> = {
  string: "text",
  number: "a number",
  int: "a whole number",
  boolean: "on or off (true or false)",
  array: "a list",
  object: "a group of settings",
  record: "a group of settings",
};

/** A zod issue in plain words, after its place in the builder. */
function describe(issue: z.core.$ZodIssue, data: unknown, place: string): string {
  const at = place ? `“${place}”` : "This file";

  switch (issue.code) {
    case "custom":
      return place ? `${place}: ${issue.message}` : issue.message;
    case "invalid_type": {
      if (valueAt(data, issue.path) === undefined) return `${at} is missing.`;
      return `${at} should be ${EXPECTED[issue.expected] ?? issue.expected}.`;
    }
    case "invalid_value": {
      const given = valueAt(data, issue.path);
      const values = issue.values.map((item) => String(item));

      return `${at} is “${String(given)}”, which isn't one of: ${values.join(", ")}.`;
    }
    case "invalid_union": {
      const given = valueAt(data, issue.path[issue.path.length - 1] === "type" ? issue.path : [...issue.path, "type"]);

      return typeof given === "string" ? `${at} is a “${given}” action, which the site kit doesn't have.` : `${at} doesn't say what kind of action it is.`;
    }
    case "too_small":
      return issue.origin === "string" ? `${at} can't be empty.` : `${at} should be ${String(issue.minimum)} or more.`;
    case "invalid_format": {
      const given = valueAt(data, issue.path);

      return `${at} is “${String(given)}”. ${issue.message}`;
    }
    default:
      return place ? `${place}: ${issue.message}` : issue.message;
  }
}

function toPath(path: ReadonlyArray<PropertyKey>): FieldPath {
  return path.filter((segment): segment is string | number => typeof segment === "string" || typeof segment === "number");
}

/** Problems in a kit file, as Proof lists them. `entryPath` is the file's repo path. */
export function validateKitFile(kind: KitKind, data: unknown, entryPath: string, ctx: KitCheckContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (severity: ValidationIssue["severity"], code: string, field: FieldPath, message: string) => issues.push({ severity, code, message, path: entryPath, field });
  const place = (field: FieldPath) => kitTrail(kind, data, field).join(" › ");
  const parsed = (kind === "forms" ? formSchema : scriptsSchema).safeParse(data);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      // A wrong action kind is reported on the action, not on its "type" key.
      const field = toPath(issue.code === "invalid_union" && issue.path[issue.path.length - 1] === "type" ? issue.path.slice(0, -1) : issue.path);

      add("error", issue.code === "custom" ? "kit" : issue.code === "invalid_type" && valueAt(data, issue.path) === undefined ? "required" : "type", field, describe(issue, data, place(field)));
    }
    // zod skips the checks across fields once the shape is wrong, but they are
    // still worth saying: run them on what can be read (they stop at the first
    // part they can't), so one mistake doesn't hide another.
    if (!parsed.error.issues.some((issue) => issue.code === "custom")) {
      const custom: Array<{ path: FieldPath; message: string }> = [];
      const ctx = { addIssue: (issue: { path?: Array<string | number>; message?: string }) => custom.push({ path: issue.path ?? [], message: issue.message ?? "" }) } as unknown as z.RefinementCtx;

      try {
        if (kind === "forms") checkForm(data as never, ctx);
        else checkScripts(data as never, ctx);
      } catch {
        // The rest of the file is too far from a form to check across it.
      }
      for (const issue of custom) {
        if (!issues.some((known) => JSON.stringify(known.field) === JSON.stringify(issue.path))) add("error", "kit", issue.path, `${place(issue.path)}: ${issue.message}`);
      }
    }
  }
  if (kind === "forms" && isObject(data)) issues.push(...formExtras(data, entryPath, ctx, place));
  return issues;
}

/** What the engine adds to the schema's checks for a form. */
function formExtras(form: Json, entryPath: string, ctx: KitCheckContext, place: (field: FieldPath) => string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (severity: ValidationIssue["severity"], code: string, field: FieldPath, message: string) => issues.push({ severity, code, message, path: entryPath, field });

  (Array.isArray(form.fields) ? form.fields : []).forEach((field, index) => {
    const pattern = isObject(field) && isObject(field.validation) ? field.validation.pattern : undefined;

    // A pattern a browser can't compile is the schema's problem; one that compiles but could stall the server is ours.
    if (typeof pattern === "string" && pattern !== "" && compilePattern(pattern) && patternRisk(pattern)) {
      const at: FieldPath = ["fields", index, "validation", "pattern"];

      add("error", "slow-pattern", at, `${place(at)}: ${PATTERN_RISK_MESSAGE}`);
    }
  });
  const needs: Record<string, [key: string, what: string]> = {
    redirect: ["url", "the address to go to"],
    download: ["url", "the file to offer"],
    webhook: ["url", "the address to send to"],
    event: ["name", "the event's name"],
  };

  (Array.isArray(form.afterSubmit) ? form.afterSubmit : []).forEach((action, index) => {
    if (!isObject(action) || typeof action.type !== "string") return;
    const need = needs[action.type];

    if (need && typeof action[need[0]] === "string" && text(action[need[0]]) === "") {
      add("error", "required", ["afterSubmit", index, need[0]], `${place(["afterSubmit", index])}: it needs ${need[1]}.`);
    }
    if (action.type === "redirect" && typeof action.url === "string" && /^\/(?!\/)/.test(action.url) && ctx.routeExists) {
      const target = action.url.split(/[?#]/)[0] ?? action.url;

      if (target !== "/" && !ctx.routeExists(target)) add("warning", "broken-link", ["afterSubmit", index, "url"], `${place(["afterSubmit", index])}: no page lives at ${target}.`);
    }
    if (action.type === "script" && !ctx.allowFormScripts) {
      add(
        "warning",
        "form-scripts-off",
        ["afterSubmit", index],
        `${place(["afterSubmit", index])}: the site leaves this code out of its pages, because its site kit settings don't allow form code (forms.allowFormScripts).`,
      );
    }
  });
  return issues;
}
