/**
 * Entry validation: required fields, types, allowed values, dates, block
 * types, images that are not in the media library and internal links that
 * match no page. Rules that came from inference are warnings — inference can
 * be wrong — while schema and config rules are errors. Unknown extra keys are
 * only ever warnings.
 */
import type { Entry, Field, FieldPath, JsonValue, SiteModel, ValidationIssue } from "../../types";
import type { ValidationContext } from "../model";
import { isRedirectsFile } from "../../redirects/locate";
import { validateKitFile } from "../../site-kit/validate";
import { isObject } from "../util/json";

const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(.+\)|hsla?\(.+\)|[a-z]+)$/i;
const LOCAL_LINK = /^\/(?!\/)/;

interface Walk {
  ctx: ValidationContext;
  path: string;
  issues: ValidationIssue[];
  /** Off for the redirects list: its addresses are old and new addresses, not links (see isRedirectsFile). */
  links: boolean;
}

function severity(field: Field): ValidationIssue["severity"] {
  return field.source === "inferred" ? "warning" : "error";
}

function isEmpty(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function quoted(label: string): string {
  return `“${label}”`;
}

/** Strips query and hash so "/pricing/#plans" checks "/pricing/". */
function linkTarget(href: string): string {
  return href.split(/[?#]/)[0] ?? href;
}

function looksLikeFile(path: string): boolean {
  return /\.[a-z0-9]{2,5}$/i.test(path);
}

function checkLink(walk: Walk, href: string, label: string, field?: FieldPath): void {
  if (!walk.links || !LOCAL_LINK.test(href)) return;
  const target = linkTarget(href);

  if (target === "" || target === "/") return;
  if (walk.ctx.routeExists(target) || (looksLikeFile(target) && walk.ctx.mediaExists(target))) return;
  walk.issues.push({
    severity: "warning",
    code: "broken-link",
    message: `The link to ${target} in ${label} doesn't match any page on the site.`,
    path: walk.path,
    ...(field ? { field } : {}),
  });
}

function checkImage(walk: Walk, src: string, label: string, field?: FieldPath): void {
  if (!LOCAL_LINK.test(src)) return;
  const target = linkTarget(src);

  if (walk.ctx.mediaExists(target)) return;
  walk.issues.push({
    severity: "warning",
    code: "broken-image",
    message: `${label} uses ${target}, which isn't in the site's media folders.`,
    path: walk.path,
    ...(field ? { field } : {}),
  });
}

/** Links and images written in markdown or HTML inside a string. */
function checkMarkup(walk: Walk, text: string, label: string, field?: FieldPath): void {
  for (const match of text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) checkImage(walk, match[1]!, label, field);
  for (const match of text.matchAll(/(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) checkLink(walk, match[1]!, label, field);
  for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) checkImage(walk, match[1]!, label, field);
  for (const match of text.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) checkLink(walk, match[1]!, label, field);
}

function issue(walk: Walk, field: Field, code: string, message: string, path: FieldPath, forced?: ValidationIssue["severity"]): void {
  walk.issues.push({ severity: forced ?? severity(field), code, message, path: walk.path, field: path });
}

function checkObject(walk: Walk, fields: Field[], value: { [key: string]: JsonValue }, path: FieldPath, trail: string, reportExtras: boolean): void {
  for (const field of fields) checkValue(walk, field, value[field.key], [...path, field.key], trail ? `${trail} › ${field.label}` : field.label);
  if (!reportExtras) return;
  for (const key of Object.keys(value)) {
    if (fields.some((field) => field.key === key)) continue;
    walk.issues.push({ severity: "warning", code: "unknown-field", message: `${quoted(key)} isn't one of the fields this content type defines. It is kept as it is.`, path: walk.path, field: [...path, key] });
  }
}

function checkValue(walk: Walk, field: Field, value: JsonValue | undefined, path: FieldPath, label: string): void {
  if (isEmpty(value)) {
    if (field.required && !(field.type === "boolean" && value === false)) issue(walk, field, "required", `${quoted(label)} is required.`, path, field.source === "inferred" ? "warning" : "error");
    return;
  }
  const wrongType = (expected: string) => issue(walk, field, "type", `${quoted(label)} should be ${expected}.`, path);

  switch (field.type) {
    case "number":
      if (typeof value !== "number") wrongType("a number");
      return;
    case "boolean":
      if (typeof value !== "boolean") wrongType("on or off (true or false)");
      return;
    case "date":
    case "datetime":
      if (typeof value !== "string" || !DATE.test(value.trim()) || Number.isNaN(Date.parse(value))) {
        issue(walk, field, "date", `${quoted(label)} should be a date like 2026-03-14.`, path);
      }
      return;
    case "select":
      if (typeof value !== "string") wrongType("one of the listed choices");
      else if (field.options && !field.options.includes(value)) {
        issue(walk, field, "enum", `${quoted(label)} is “${value}”, which isn't one of: ${field.options.join(", ")}.`, path);
      }
      return;
    case "color":
      if (typeof value !== "string" || !COLOR.test(value.trim())) issue(walk, field, "type", `${quoted(label)} should be a colour like #1a2b3c.`, path, "warning");
      return;
    case "image":
      if (typeof value === "string") checkImage(walk, value, quoted(label), path);
      else if (!isObject(value)) wrongType("an image path");
      return;
    case "url":
      if (typeof value === "string") checkLink(walk, value, quoted(label), path);
      else wrongType("a link");
      return;
    case "string":
    case "text":
    case "markdown":
    case "reference":
      if (typeof value !== "string") {
        if (typeof value === "number" || typeof value === "boolean") return; // read back as text; harmless
        wrongType("text");
        return;
      }
      if (field.type === "markdown" || field.type === "text") checkMarkup(walk, value, quoted(label), path);
      return;
    case "tags":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) wrongType("a list of words");
      return;
    case "list":
      if (!Array.isArray(value)) {
        wrongType("a list");
        return;
      }
      if (field.of) value.forEach((item, index) => checkValue(walk, field.of!, item, [...path, index], `${label} › ${index + 1}`));
      return;
    case "object":
      if (!isObject(value)) {
        wrongType("a group of fields");
        return;
      }
      if (field.fields) checkObject(walk, field.fields, value, path, label, field.source !== "inferred");
      return;
    case "blocks": {
      if (!Array.isArray(value)) {
        wrongType("a list of sections");
        return;
      }
      const key = field.discriminator ?? "type";

      value.forEach((item, index) => {
        const at = [...path, index];

        if (!isObject(item)) {
          issue(walk, field, "type", `${label} › ${index + 1} should be a section with fields.`, at);
          return;
        }
        const type = item[key];
        const block = typeof type === "string" ? field.blocks?.find((candidate) => candidate.type === type) : undefined;

        if (!block) {
          issue(walk, field, "unknown-block", typeof type === "string" ? `${label} › ${index + 1} is a “${type}” section, which this site doesn't define.` : `${label} › ${index + 1} doesn't say what kind of section it is.`, at);
          return;
        }
        checkObject(walk, block.fields, item, at, `${label} › ${index + 1} (${block.label})`, false);
      });
      return;
    }
    default:
      return;
  }
}

export function validateEntry(model: SiteModel, entry: Entry, ctx: ValidationContext): ValidationIssue[] {
  const collection = model.collections.find((candidate) => candidate.id === entry.collection);
  // An old address in the redirects list is meant to match no page; the Redirects screen reports the ones that lead nowhere.
  const walk: Walk = { ctx, path: entry.path, issues: [], links: !isRedirectsFile(model, entry.path) };

  if (!collection) return [];
  // Site-kit files (forms, the scripts setup) are checked with the kit's own schema, in its own words.
  if (collection.kit) return validateKitFile(collection.kit, entry.data, entry.path, { allowFormScripts: model.kit?.allowFormScripts === true, routeExists: (url) => ctx.routeExists(url) });
  const declared = collection.fields.some((field) => field.source !== "inferred");

  checkObject(walk, collection.fields, entry.data, [], "", false);
  if (declared) {
    for (const key of Object.keys(entry.data)) {
      if (collection.fields.some((field) => field.key === key)) continue;
      walk.issues.push({ severity: "warning", code: "unknown-field", message: `${quoted(key)} isn't one of the fields this content type defines. It is kept as it is.`, path: entry.path, field: [key] });
    }
  }
  if (entry.body) checkMarkup(walk, entry.body, "the main text");
  return walk.issues;
}
