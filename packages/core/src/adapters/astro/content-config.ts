/**
 * Astro content collections, read statically from `src/content.config.ts`
 * (or the legacy `src/content/config.ts`). The module is parsed, never run:
 * a config that does something unusual yields fewer collections and a note,
 * never an exception. Written only against the public adapter API.
 */
import type { Field } from "../../types";
import type { AdapterHelpers, ModuleExpr, ParsedModule } from "../../adapter/types";

export type AstroLoader =
  | { kind: "glob"; base: string | null; pattern: string[] }
  | { kind: "file"; path: string }
  | { kind: "legacy"; type: "content" | "data" }
  /** Starlight's `docsLoader()` / `i18nLoader()`: fixed folders under the content directory. */
  | { kind: "starlight"; loader: "docs" | "i18n" }
  | { kind: "unknown"; name: string | null };

export interface AstroCollectionDecl {
  name: string;
  loader: AstroLoader;
  /** Fields recovered from the zod schema, or null when there is none / it could not be read. */
  fields: Field[] | null;
  /** "forms" when the schema is the site kit's form schema, imported from the kit. */
  kit?: "forms";
}

export interface AstroConfigAnalysis {
  collections: AstroCollectionDecl[];
  notes: string[];
}

const UNKNOWN: ModuleExpr = { kind: "unknown" };

function strings(module: ParsedModule, expr: ModuleExpr | undefined): string[] {
  if (!expr) return [];
  const resolved = module.resolve(expr);

  if (resolved.kind === "string") return [resolved.value];
  if (resolved.kind === "array") return resolved.items.flatMap((item) => strings(module, item));
  return [];
}

/** A plain string, or the first argument of `new URL("./src/content/x", import.meta.url)` (also inside `fileURLToPath(…)`). */
function pathString(module: ParsedModule, expr: ModuleExpr | undefined): string | null {
  if (!expr) return null;
  const resolved = module.resolve(expr);

  if (resolved.kind === "string") return resolved.value;
  if (resolved.kind === "new" && module.callee(resolved) === "URL") return module.string(resolved.args[0]);
  if (resolved.kind === "call" && module.callee(resolved)?.split(".").pop() === "fileURLToPath") return pathString(module, resolved.args[0]);
  return null;
}

/** Whether a local name was imported from a module whose path starts with `prefix`. */
function importedFrom(module: ParsedModule, name: string, prefix: string): boolean {
  return module.imports.get(name)?.from.startsWith(prefix) ?? false;
}

function loaderOf(module: ParsedModule, definition: ModuleExpr, notes: string[], name: string): AstroLoader {
  const loader = module.prop(definition, "loader");

  if (!loader) {
    return { kind: "legacy", type: module.string(module.prop(definition, "type")) === "data" ? "data" : "content" };
  }
  if (loader.kind !== "call") return { kind: "unknown", name: null };
  const callee = module.callee(loader)?.split(".").pop() ?? null;

  if (callee === "glob") {
    const options = module.resolve(loader.args[0] ?? UNKNOWN);

    if (module.prop(options, "generateId")) {
      notes.push(`The “${name}” collection names its entries with its own code (generateId), so their page addresses may differ from their file names.`);
    }
    return { kind: "glob", base: pathString(module, module.prop(options, "base")), pattern: strings(module, module.prop(options, "pattern")) };
  }
  // Starlight's loaders read fixed folders; the docs are served by a route Starlight injects.
  if ((callee === "docsLoader" || callee === "i18nLoader") && importedFrom(module, callee, "@astrojs/starlight")) {
    return { kind: "starlight", loader: callee === "docsLoader" ? "docs" : "i18n" };
  }
  if (callee === "file") {
    const path = pathString(module, loader.args[0]);

    return path ? { kind: "file", path } : { kind: "unknown", name: callee };
  }
  return { kind: "unknown", name: callee };
}

/** Where the site kit's form schema can be imported from: the package, or the kit's files vendored into the site. */
const KIT_SCHEMA = /^(@galley\/astro\/schema|\.{1,2}\/(?:[^"']*\/)?galley\/schema(\.m?js)?)$/;

/**
 * Whether a collection's schema is the kit's `formSchema` — read from the
 * object as written (`schema: formSchema`), before identifiers are followed,
 * so the import itself is the evidence, never the folder's name.
 */
function kitOf(module: ParsedModule, definition: ModuleExpr): "forms" | undefined {
  if (definition.kind !== "object") return undefined;
  const raw = definition.props.find((prop) => "key" in prop && prop.key === "schema");
  const value = raw && "key" in raw ? raw.value : undefined;

  if (value?.kind !== "ident") return undefined;
  const binding = module.imports.get(value.name);

  return binding && binding.imported === "formSchema" && KIT_SCHEMA.test(binding.from) ? "forms" : undefined;
}

function schemaOf(module: ParsedModule, definition: ModuleExpr, helpers: Pick<AdapterHelpers, "fieldsFromZod">): Field[] | null {
  const schema = module.prop(definition, "schema");

  if (!schema) return null;
  // `schema: ({ image }) => z.object({...})`
  const expr = schema.kind === "arrow" ? module.resolve(schema.body) : schema;

  return helpers.fieldsFromZod(expr, module);
}

/** The object passed to defineCollection(...), following identifiers. */
function definitionOf(module: ParsedModule, expr: ModuleExpr): ModuleExpr | null {
  const resolved = module.resolve(expr);

  if (resolved.kind === "call") {
    if (module.callee(resolved)?.split(".").pop() !== "defineCollection" || !resolved.args[0]) return null;
    const arg = module.resolve(resolved.args[0]);

    return arg.kind === "object" ? arg : null;
  }
  // Some configs skip defineCollection and export plain objects.
  return resolved.kind === "object" && (module.prop(resolved, "loader") || module.prop(resolved, "schema") || module.prop(resolved, "type")) ? resolved : null;
}

export function analyzeContentConfig(module: ParsedModule, helpers: Pick<AdapterHelpers, "fieldsFromZod">): AstroConfigAnalysis {
  const notes: string[] = [];
  const object = module.exported("collections");

  if (!object) {
    return { collections: [], notes: ["The content config does not export `collections` in a form that can be read without running it."] };
  }
  if (object.kind !== "object") {
    return { collections: [], notes: ["The content config builds `collections` with code, so it was not read; folders were scanned instead."] };
  }
  const collections: AstroCollectionDecl[] = [];

  for (const prop of object.props) {
    if (!("key" in prop)) {
      notes.push("Some collections are spread in from elsewhere and were not read.");
      continue;
    }
    const definition = definitionOf(module, prop.value);

    if (!definition) {
      notes.push(`The “${prop.key}” collection is built with code, so its folder could not be read.`);
      continue;
    }
    const loader = loaderOf(module, definition, notes, prop.key);

    if (loader.kind === "unknown") {
      notes.push(`The “${prop.key}” collection uses ${loader.name ? `a custom loader (${loader.name})` : "a custom loader"}, so it is not editable here.`);
    }
    const kit = kitOf(module, definition);

    collections.push({ name: prop.key, loader, fields: schemaOf(module, definition, helpers), ...(kit ? { kit } : {}) });
  }
  return { collections, notes };
}
