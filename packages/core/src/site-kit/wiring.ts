/**
 * The two edits "Set it up for me" makes to a site's own code, as pure
 * functions of the file's text: the forms collection in the content config,
 * and the three `<Scripts />` placements in the base layout.
 *
 * Each edit happens only when the file has the plain, standard shape and
 * the result is unambiguous; otherwise it returns `left` with the reason in
 * plain words and changes nothing (Principle 4). An edit inserts whole lines
 * and touches no other byte (Principle 3).
 */
import { posix } from "node:path";
import { parseModule } from "../adapter/context";
import { analyzeContentConfig } from "../adapters/astro/content-config";
import { KIT_DIR } from "./detect";

export type WiringResult = { state: "done" } | { state: "edited"; text: string } | { state: "left"; reason: string };

/** The collection the kit's runtime reads forms from (its vendored runtime looks in this folder). */
export const FORMS_COLLECTION_LINE = 'defineCollection({ loader: glob({ pattern: "*.json", base: "./src/content/forms" }), schema: formSchema })';

/** Import path from `file` to a file under the kit, in the style Astro sites write ("./galley/schema.js"). */
export function kitImport(file: string, target: string): string {
  const relative = posix.relative(posix.dirname(file), `${KIT_DIR}/${target}`);

  return relative.startsWith(".") ? relative : `./${relative}`;
}

/**
 * Skips over a string, template literal or comment starting at `index`, or
 * returns `index` unchanged. Template literals are skipped without looking
 * into their `${}` — a config that builds code in one is not "standard".
 */
function skip(text: string, index: number): number {
  const char = text[index];

  if (char === '"' || char === "'" || char === "`") {
    for (let at = index + 1; at < text.length; at += 1) {
      if (text[at] === "\\") at += 1;
      else if (text[at] === char) return at + 1;
    }
    return text.length;
  }
  if (char === "/" && text[index + 1] === "/") {
    const end = text.indexOf("\n", index);

    return end === -1 ? text.length : end;
  }
  if (char === "/" && text[index + 1] === "*") {
    const end = text.indexOf("*/", index + 2);

    return end === -1 ? text.length : end + 2;
  }
  return index;
}

/** The index of the `}` closing the `{` at `open`, or -1. */
function closingBrace(text: string, open: number): number {
  let depth = 0;

  for (let at = open; at < text.length; ) {
    const next = skip(text, at);

    if (next !== at) {
      at = next;
      continue;
    }
    const char = text[at];

    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") {
      depth -= 1;
      if (depth === 0) return char === "}" ? at : -1;
    }
    at += 1;
  }
  return -1;
}

/** Where the last top-level import statement ends (the index after its line), or 0 when there is none. */
function afterImports(text: string, from = 0, to = text.length): number {
  const pattern = /^import\b[^;]*?(?:["'][^"'\n]+["'])[ \t]*;?[ \t]*$/gm;
  let end = from;

  pattern.lastIndex = from;
  for (let match = pattern.exec(text); match && match.index < to; match = pattern.exec(text)) {
    end = match.index + match[0].length;
    if (text[end] === "\n") end += 1;
    else if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
  }
  return end;
}

function insertAt(text: string, index: number, insert: string): string {
  return text.slice(0, index) + insert + text.slice(index);
}

function eol(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Adds the forms collection to a content config (`src/content.config.ts` or
 * the legacy `src/content/config.ts`) when it exports
 * `export const collections = { … }` as a plain object literal.
 */
export function wireContentConfig(text: string, file: string): WiringResult {
  const module = parseModule(text);
  const collections = module.exported("collections");
  const nl = eol(text);

  if (!collections) return { state: "left", reason: `${file} doesn’t export its collections as \`export const collections = { … }\`.` };
  if (collections.kind !== "object") return { state: "left", reason: `${file} builds its collections with code, so where the forms collection goes isn’t clear.` };
  // Wired already when some collection uses the kit's form schema, whatever it is called.
  if (analyzeContentConfig(module, { fieldsFromZod: () => null }).collections.some((collection) => collection.kit === "forms")) return { state: "done" };
  if (collections.props.some((prop) => !("key" in prop))) return { state: "left", reason: `${file} spreads collections in from elsewhere, so where the forms collection goes isn’t clear.` };
  const existing = collections.props.find((prop) => "key" in prop && prop.key === "forms");

  if (existing) {
    const binding = module.imports.get("formSchema");

    return binding?.imported === "formSchema" && /galley\/schema|@galley\/astro\/schema/.test(binding.from)
      ? { state: "done" }
      : { state: "left", reason: `${file} already has a collection called “forms” that isn’t the site kit’s.` };
  }
  const declarations = [...text.matchAll(/export\s+const\s+collections\s*(?::[^=]+)?=\s*\{/g)];

  if (declarations.length !== 1) return { state: "left", reason: `${file} doesn’t have exactly one \`export const collections = {\`.` };
  for (const name of ["forms", "formSchema"]) {
    if (module.scope.has(name) || (module.imports.has(name) && !(name === "formSchema" && /galley\/schema/.test(module.imports.get(name)!.from)))) {
      return { state: "left", reason: `${file} already uses the name “${name}” for something else.` };
    }
  }
  const imports: string[] = [];
  const need = (name: string, from: string) => {
    const binding = module.imports.get(name);

    if (binding && binding.from === from && binding.imported === name) return null;
    if (binding || module.scope.has(name)) return `${file} uses the name “${name}” for something other than Astro’s ${name}.`;
    imports.push(`import { ${name} } from "${from}";`);
    return null;
  };
  const clash = need("defineCollection", "astro:content") ?? need("glob", "astro/loaders");

  if (clash) return { state: "left", reason: clash };
  if (!module.imports.has("formSchema")) imports.push(`import { formSchema } from "${kitImport(file, "schema.js")}";`);

  const declaration = declarations[0]!;
  const open = declaration.index + declaration[0].length - 1;
  const close = closingBrace(text, open);

  if (close === -1) return { state: "left", reason: `${file}'s collections couldn’t be read to the end.` };
  const inner = text.slice(open + 1, close);
  let out: string;

  if (!inner.includes("\n")) {
    // `export const collections = { pages, blog };` — declare the collection above, add its name to the list.
    const lineStart = text.lastIndexOf("\n", declaration.index) + 1;
    const trimmed = inner.replace(/\s+$/, "");
    const tail = trimmed.trim() === "" ? " forms " : trimmed.endsWith(",") ? " forms" : ", forms";
    const list = `${trimmed}${tail}${inner.slice(trimmed.length) || " "}`;

    out = text.slice(0, open + 1) + list + text.slice(close);
    out = insertAt(out, lineStart, `const forms = ${FORMS_COLLECTION_LINE};${nl}${nl}`);
  } else {
    // A multi-line object: the new collection goes first, so no other line (and no trailing comma) changes.
    const indent = /\n([ \t]+)\S/.exec(inner)?.[1] ?? "  ";

    out = insertAt(text, open + 1, `${nl}${indent}forms: ${FORMS_COLLECTION_LINE},`);
  }
  if (imports.length > 0) {
    const at = afterImports(out);

    out = insertAt(out, at, `${imports.join(nl)}${nl}${at === 0 ? nl : ""}`);
  }
  return { state: "edited", text: out };
}

const PLACEMENTS = ["head", "body-start", "body-end"] as const;

/** Whether a layout's text is a whole page: one `<html>`, one `<head>`, one `<body>`. */
export function isBaseLayout(text: string): boolean {
  const template = text.startsWith("---") ? text.slice(Math.max(0, text.indexOf("\n---", 3) + 4)) : text;

  return /<html[\s>]/i.test(template) && /<head[\s>]/i.test(template) && /<body[\s>]/i.test(template);
}

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function indentOfLineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1;

  return /^[ \t]*/.exec(text.slice(start))?.[0] ?? "";
}

/** The indentation of the first non-empty line after `index`. */
function indentAfter(text: string, index: number): string | null {
  const match = /\n([ \t]*)\S/.exec(text.slice(index));

  return match ? match[1]! : null;
}

/**
 * Adds `<Scripts placement="head" />` (after `<meta charset>`, else right
 * after `<head>`), `"body-start"` (right after `<body>`) and `"body-end"`
 * (right before `</body>`) to the site's one base layout, with the import in
 * its frontmatter. Placements it already has are left as they are.
 */
export function wireLayout(text: string, file: string): WiringResult {
  const nl = eol(text);
  const hasFrontmatter = /^---\r?\n/.test(text);
  const fmEnd = hasFrontmatter ? text.search(/\r?\n---[ \t]*(\r?\n|$)/) : -1;

  if (hasFrontmatter && fmEnd === -1) return { state: "left", reason: `${file}'s frontmatter has no closing ---.` };
  const bodyStart = hasFrontmatter ? text.indexOf("\n", text.indexOf("\n---", fmEnd) + 1) + 1 || text.length : 0;
  const template = text.slice(bodyStart);

  if (count(template, /<head[\s>]/gi) !== 1 || count(template, /<\/head>/gi) !== 1) return { state: "left", reason: `${file} doesn’t have exactly one <head> written in it.` };
  if (count(template, /<body[\s>]/gi) !== 1 || count(template, /<\/body>/gi) !== 1) return { state: "left", reason: `${file} doesn’t have exactly one <body> written in it.` };
  const present = new Set(PLACEMENTS.filter((placement) => new RegExp(`<Scripts\\s+placement=["']${placement}["']`).test(template)));
  const frontmatter = hasFrontmatter ? text.slice(0, bodyStart) : "";
  const imported = /import\s*\{[^}]*\bScripts\b[^}]*\}\s*from\s*["'][^"']*galley\/components(\/index\.js)?["']/.test(frontmatter);

  if (present.size === PLACEMENTS.length && imported) return { state: "done" };
  if (!imported && /\bScripts\b/.test(frontmatter)) return { state: "left", reason: `${file} already uses the name “Scripts” for something else.` };

  let out = template;
  const lowerOut = () => out.toLowerCase();

  if (!present.has("head")) {
    const head = lowerOut().search(/<head[\s>]/);
    const headClose = out.indexOf(">", head) + 1;
    const charset = /<meta\s+charset[^>]*>/i.exec(out.slice(headClose));
    const anchor = charset ? headClose + charset.index + charset[0].length : headClose;
    const indent = charset ? indentOfLineAt(out, headClose + charset.index) : (indentAfter(out, headClose) ?? `${indentOfLineAt(out, head)}  `);

    out = insertAt(out, anchor, `${nl}${indent}<Scripts placement="head" />`);
  }
  if (!present.has("body-start")) {
    const body = lowerOut().search(/<body[\s>]/);
    const bodyClose = out.indexOf(">", body) + 1;
    const indent = indentAfter(out, bodyClose) ?? `${indentOfLineAt(out, body)}  `;

    out = insertAt(out, bodyClose, `${nl}${indent}<Scripts placement="body-start" />`);
  }
  if (!present.has("body-end")) {
    const close = lowerOut().lastIndexOf("</body>");
    const lineStart = out.lastIndexOf("\n", close - 1) + 1;
    const own = /^[ \t]*$/.test(out.slice(lineStart, close));
    const inner = indentAfter(out, lowerOut().indexOf(">", lowerOut().search(/<body[\s>]/)) + 1) ?? `${indentOfLineAt(out, close)}  `;

    // `</body>` on a line of its own: a new line above it; otherwise right before it.
    out = own ? insertAt(out, lineStart, `${inner}<Scripts placement="body-end" />${nl}`) : insertAt(out, close, `<Scripts placement="body-end" />`);
  }
  let head = frontmatter;

  if (!imported) {
    const line = `import { Scripts } from "${kitImport(file, "components/index.js")}";`;

    if (!hasFrontmatter) head = `---${nl}${line}${nl}---${nl}`;
    else {
      const end = frontmatter.search(/\r?\n---[ \t]*(\r?\n|$)/) + 1;
      const at = afterImports(frontmatter, 0, end);

      head = at > 0 ? insertAt(frontmatter, at, `${line}${nl}`) : insertAt(frontmatter, frontmatter.indexOf("\n") + 1, `${line}${nl}`);
    }
  }
  return { state: "edited", text: head + out };
}

/** Whether a name is imported as the kit's integration (vendored, or the package). */
function kitIntegrationImport(module: ReturnType<typeof parseModule>, name: string): boolean {
  const binding = module.imports.get(name);

  return binding !== undefined && binding.imported === "default" && /(^@galley\/astro$|(^|\/)galley\/integration(\.m?js)?$)/.test(binding.from);
}

/** Where a top-level key of the object whose `{` is at `open` starts its value, or -1. */
function keyValueAt(text: string, open: number, close: number, key: string): number {
  let depth = 0;
  const pattern = new RegExp(`^${key}\\s*:\\s*`);

  for (let at = open + 1; at < close; ) {
    const next = skip(text, at);

    if (next !== at) {
      at = next;
      continue;
    }
    const char = text[at]!;

    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") depth -= 1;
    else if (depth === 0 && /[A-Za-z_$]/.test(char) && !/[A-Za-z0-9_$.]/.test(text[at - 1] ?? "")) {
      const match = pattern.exec(text.slice(at, close));

      if (match) return at + match[0].length;
      while (at < close && /[A-Za-z0-9_$]/.test(text[at]!)) at += 1;
      continue;
    }
    at += 1;
  }
  return -1;
}

/**
 * Turns on the kit's build step (the agent-readable version of the site) in
 * astro.config: `import galley from "./src/galley/integration.js";` after the
 * last import, and `galley()` first in `integrations: [ … ]` — or a new
 * `integrations: [galley()],` when the config has none. Only for
 * `export default defineConfig({ … })` (or a plain exported object) written
 * as a literal; anything else is left, with the reason.
 */
export function wireAstroConfig(text: string, file: string): WiringResult {
  const module = parseModule(text);
  const config = module.configObject();
  const nl = eol(text);

  if (!config || config.kind !== "object") return { state: "left", reason: `${file} doesn’t export its settings as \`export default defineConfig({ … })\`, so where the kit’s build step goes isn’t clear.` };
  if (config.props.some((prop) => !("key" in prop))) return { state: "left", reason: `${file} spreads its settings in from elsewhere, so where the kit’s build step goes isn’t clear.` };
  const integrations = config.props.find((prop) => "key" in prop && prop.key === "integrations");
  const value = integrations && "key" in integrations ? integrations.value : undefined;

  if (value && value.kind !== "array") return { state: "left", reason: `${file} builds its integrations with code, so where the kit’s build step goes isn’t clear.` };
  const calls = (value?.kind === "array" ? value.items : []).flatMap((item) => (item.kind === "call" && item.callee.kind === "ident" ? [item.callee.name] : []));

  if (calls.some((name) => kitIntegrationImport(module, name))) return { state: "done" };
  if (module.scope.has("galley") || module.imports.has("galley")) return { state: "left", reason: `${file} already uses the name “galley” for something else.` };
  const declarations = [...text.matchAll(/export\s+default\s+(?:defineConfig\s*\(\s*)?\{/g)];

  if (declarations.length !== 1) return { state: "left", reason: `${file} doesn’t have exactly one \`export default defineConfig({\`.` };
  const open = declarations[0]!.index + declarations[0]![0].length - 1;
  const close = closingBrace(text, open);

  if (close === -1) return { state: "left", reason: `${file}'s settings couldn’t be read to the end.` };
  let out: string;

  if (value) {
    const start = keyValueAt(text, open, close, "integrations");

    if (start === -1 || text[start] !== "[") return { state: "left", reason: `${file}'s integrations couldn’t be found as written.` };
    const end = closingBracket(text, start);

    if (end === -1) return { state: "left", reason: `${file}'s integrations couldn’t be read to the end.` };
    const inner = text.slice(start + 1, end);

    if (inner.trim() === "") out = `${text.slice(0, start + 1)}galley()${text.slice(end)}`;
    else if (!inner.includes("\n")) {
      const lead = /^\s*/.exec(inner)?.[0] ?? "";

      out = `${text.slice(0, start + 1)}${lead}galley(), ${inner.slice(lead.length)}${text.slice(end)}`;
    }
    else {
      // A multi-line list: the kit goes first, on its own line, so no other line changes.
      const indent = /\n([ \t]+)\S/.exec(inner)?.[1] ?? "    ";

      out = insertAt(text, start + 1, `${nl}${indent}galley(),`);
    }
  } else {
    const inner = text.slice(open + 1, close);

    if (!inner.includes("\n")) return { state: "left", reason: `${file} keeps its settings on one line, so where the kit’s build step goes isn’t clear.` };
    const indent = /\n([ \t]+)\S/.exec(inner)?.[1] ?? "  ";
    const trimmed = inner.replace(/\s+$/, "");

    // After the last setting when it already ends with a comma; else first, so no other line changes.
    out = trimmed.endsWith(",") ? insertAt(text, open + 1 + trimmed.length, `${nl}${indent}integrations: [galley()],`) : insertAt(text, open + 1, `${nl}${indent}integrations: [galley()],`);
  }
  const at = afterImports(out);

  out = insertAt(out, at, `import galley from "${kitImport(file, "integration.js")}";${nl}${at === 0 ? nl : ""}`);
  return { state: "edited", text: out };
}

/** The index of the `]` closing the `[` at `open`, or -1. */
function closingBracket(text: string, open: number): number {
  let depth = 0;

  for (let at = open; at < text.length; ) {
    const next = skip(text, at);

    if (next !== at) {
      at = next;
      continue;
    }
    const char = text[at];

    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") {
      depth -= 1;
      if (depth === 0) return char === "]" ? at : -1;
    }
    at += 1;
  }
  return -1;
}
