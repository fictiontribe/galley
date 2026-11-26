/**
 * Reading documents: markdown/MDX with front matter, and JSON / YAML / TOML
 * data files. Parsing never throws for bad content — problems come back in
 * `errors` so one broken file cannot take a listing down with it.
 */
import { parse as parseToml } from "smol-toml";
import { parseAllDocuments, parseDocument as parseYamlDocument } from "yaml";

import type { EntryFormat, JsonValue } from "../../types";
import type { ParsedDocument } from "../model";
import { isObject, toJsonValue, type JsonObject } from "../util/json";
import { bomLength, findFrontMatter } from "./front-matter";

/** The key a top-level list is presented under. */
export const ROOT_LIST_KEY = "items";

const EXTENSIONS: Record<string, EntryFormat> = {
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  mkd: "markdown",
  mdx: "mdx",
  svx: "markdown",
  markdoc: "markdown",
  mdoc: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
};

export function formatForPath(path: string): EntryFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";

  return Object.hasOwn(EXTENSIONS, ext) ? (EXTENSIONS[ext] ?? null) : null;
}

export function isBodyFormat(format: EntryFormat): boolean {
  return format === "markdown" || format === "mdx";
}

/** The first line of a parser's message, which is the part a person can act on. */
function firstLine(message: string): string {
  return message.split("\n")[0]!.trim();
}

export interface DataParse {
  value: JsonValue;
  errors: string[];
}

export function parseYamlText(text: string): DataParse {
  // Multi-document streams are rare in content; only the first document is
  // content, and saying so beats silently dropping the rest.
  const docs = text.includes("\n---") ? parseAllDocuments(text) : null;
  const doc = Array.isArray(docs) && docs.length > 0 ? docs[0]! : parseYamlDocument(text);
  const errors = doc.errors.map((error) => firstLine(error.message));

  if (Array.isArray(docs) && docs.length > 1) {
    errors.push("The file holds more than one set of fields (separated by ---); only the first is used.");
  }
  let value: unknown = null;

  try {
    value = doc.toJS({ maxAliasCount: 1000 });
  } catch (error) {
    errors.push(firstLine(error instanceof Error ? error.message : String(error)));
  }
  return { value: toJsonValue(value), errors };
}

export function parseJsonText(text: string): DataParse {
  if (text.trim() === "") return { value: null, errors: [] };
  try {
    return { value: toJsonValue(JSON.parse(text)), errors: [] };
  } catch (error) {
    return { value: null, errors: [firstLine(error instanceof Error ? error.message : String(error))] };
  }
}

export function parseTomlText(text: string): DataParse {
  try {
    return { value: toJsonValue(parseToml(text)), errors: [] };
  } catch (error) {
    return { value: null, errors: [firstLine(error instanceof Error ? error.message : String(error))] };
  }
}

function parseData(text: string, syntax: "yaml" | "json" | "toml"): DataParse {
  if (syntax === "yaml") return parseYamlText(text);
  if (syntax === "json") return parseJsonText(text);
  return parseTomlText(text);
}

function asObject(
  value: JsonValue,
  errors: string[],
  what: string,
  allowList: boolean
): { data: JsonObject; rootList?: boolean } {
  if (value === null) return { data: {} };
  if (isObject(value)) return { data: value };
  if (allowList && Array.isArray(value)) return { data: { [ROOT_LIST_KEY]: value }, rootList: true };
  errors.push(`${what} is a single value rather than a set of fields.`);
  return { data: {} };
}

export function parseDocument(raw: string, format: EntryFormat): ParsedDocument {
  const offset = bomLength(raw);

  if (format === "markdown" || format === "mdx") {
    const region = findFrontMatter(raw);

    if (!region) return { data: {}, body: raw.slice(offset), bodyStart: offset, errors: [] };
    const parsed = parseData(region.text, region.syntax);
    const errors = parsed.errors.map((message) => `The fields at the top of the file could not be read: ${message}`);
    const { data } = asObject(parsed.value, errors, "The top of the file", false);

    return {
      data,
      body: raw.slice(region.bodyStart),
      frontMatter: { syntax: region.syntax, start: region.start, end: region.end, text: region.text },
      bodyStart: region.bodyStart,
      errors,
    };
  }

  const parsed = parseData(raw.slice(offset), format === "toml" ? "toml" : format);
  const errors = parsed.errors.map((message) => `The file could not be read: ${message}`);
  const { data, rootList } = asObject(parsed.value, errors, "The file", true);

  return { data, body: null, bodyStart: raw.length, errors, ...(rootList ? { rootList } : {}) };
}
