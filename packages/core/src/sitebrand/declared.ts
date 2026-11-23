/**
 * What a site's code declares about its look, read statically (nothing is
 * run): CSS custom properties and where each is defined, Tailwind themes
 * (v4 `@theme` blocks and the colours/fonts plainly written in a v3 config),
 * `@font-face` rules, font packages imported in CSS or code, and Sass/Less
 * variables. Pure: it is handed the files' text and a way to read a font
 * package's own stylesheet.
 */
import { normalizeColor, parseColor } from "./color";

export interface SiteFile {
  path: string;
  content: string;
}

export interface DeclaredVar {
  name: string;
  /** The value as written. */
  raw: string;
  /** With var() references resolved, when they could be. */
  resolved: string;
  file: string;
  line: number;
  /** Byte offsets of `raw` in the file, for surgical edits. */
  start: number;
  end: number;
  /** ":root", "@theme", "[data-theme=\"dark\"]", ".dark", … */
  context: string;
  kind: "color" | "font" | "size" | "space" | "radius" | "shadow" | "weight" | "leading" | "tracking" | "other";
}

export interface DeclaredFontFace {
  family: string;
  weight: string;
  style: string;
  /** Repo-relative path, or "pkg:<package>/<file>" for a font package's file. */
  file: string;
  unicodeRange?: string;
  /** Where the rule was found. */
  declaredIn: string;
}

export interface DeclaredFont {
  family: string;
  fallbacks: string[];
  token?: string;
  file: string;
  line: number;
  /** "package" with the package name when one provides it. */
  source: { kind: "package" | "file" | "system" | "unknown"; ref?: string };
}

export interface DeclaredScan {
  tokensFile: string | null;
  /** Other complete token files with the same property names: alternative looks. */
  looks: string[];
  variables: DeclaredVar[];
  fonts: DeclaredFont[];
  fontFaces: DeclaredFontFace[];
  fontPackages: string[];
  /** Colours outside custom properties: Sass/Less variables, a Tailwind v3 config. */
  otherColors: Array<{ name: string; value: string; file: string; line: number }>;
  notes: string[];
}

export interface FontPackageReader {
  /** The stylesheets a font package's import names ("wght.css"), or null when it isn't installed. */
  (specifier: string): Array<{ file: string; content: string }> | null;
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "-apple-system", "blinkmacsystemfont", "emoji", "math", "inherit", "initial"]);

function lineAt(text: string, offset: number): number {
  let line = 1;

  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Comments become spaces, so every offset still points at the same byte. */
function blankComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function kindOf(name: string, value: string): DeclaredVar["kind"] {
  const n = name.toLowerCase();

  if (/shadow/.test(n)) return "shadow";
  if (/radius|rounded/.test(n)) return "radius";
  if (/font|family|typeface/.test(n) && !/size|weight|leading/.test(n) && /["',]|[a-z]{3,}/i.test(value) && !/^\d/.test(value.trim())) return "font";
  if (/weight/.test(n)) return "weight";
  if (/leading|line-height/.test(n)) return "leading";
  if (/tracking|letter-spacing/.test(n)) return "tracking";
  if (parseColor(value) || /^(color|colour|bg|fg|ink|paper|surface|accent|brand|primary|secondary|border|text|shot|positive|negative|notice|success|warning|danger|info)/.test(n.replace(/^-+/, "")) && /^(#|rgb|hsl|oklch|oklab|color\()/.test(value.trim())) return "color";
  if (/space|gap|gutter|section|padding|margin|inset/.test(n)) return "space";
  if (/text|step|size|fs|display|heading|h\d/.test(n) && /(rem|px|em|clamp|vw)/.test(value)) return "size";
  return "other";
}

/** The selector or at-rule a declaration sits in. */
function contextAt(text: string, offset: number): string {
  let depth = 0;

  for (let i = offset; i >= 0; i -= 1) {
    const c = text[i];

    if (c === "}") depth += 1;
    else if (c === "{") {
      if (depth === 0) {
        const head = text.slice(Math.max(0, text.lastIndexOf("}", i - 1) + 1, text.lastIndexOf(";", i - 1) + 1), i).trim();

        return head.replace(/\s+/g, " ").slice(0, 120) || ":root";
      }
      depth -= 1;
    }
  }
  return ":root";
}

function styleBlocks(file: SiteFile): Array<{ text: string; offset: number }> {
  if (/\.(css|scss|sass|less|pcss|postcss)$/i.test(file.path)) return [{ text: file.content, offset: 0 }];
  const blocks: Array<{ text: string; offset: number }> = [];

  for (const match of file.content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    blocks.push({ text: match[1]!, offset: match.index! + match[0].indexOf(">") + 1 });
  }
  return blocks;
}

export function splitFamilies(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

/** "Geist Variable" from "@fontsource-variable/geist"; the name its stylesheet gives wins when it is read. */
function packageOfFamily(family: string, packages: string[]): string | undefined {
  const slug = family.toLowerCase().replace(/\s+variable$/, "").replace(/\s+/g, "-");

  return packages.find((pkg) => pkg.split("/")[1] === slug);
}

function parseFontFaces(css: string, file: string, declaredIn: string): DeclaredFontFace[] {
  const faces: DeclaredFontFace[] = [];

  for (const match of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const body = match[1]!;
    const get = (prop: string) => new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`, "i").exec(body)?.[1]?.trim();
    const family = splitFamilies(get("font-family") ?? "")[0];
    const src = get("src") ?? "";
    const url = /url\(\s*["']?([^"')]+\.(?:woff2|woff|ttf|otf))["']?\s*\)/i.exec(src)?.[1];

    if (!family || !url || /^(https?:|data:|\/\/)/i.test(url)) continue;
    faces.push({ family, weight: get("font-weight") ?? "400", style: get("font-style") ?? "normal", file: file.startsWith("pkg:") ? `${file.slice(0, file.lastIndexOf("/") + 1)}${url.replace(/^\.\//, "")}` : joinPath(file, url), ...(get("unicode-range") ? { unicodeRange: get("unicode-range")! } : {}), declaredIn });
  }
  return faces;
}

function joinPath(from: string, relative: string): string {
  if (relative.startsWith("/")) return `public${relative}`;
  const parts = from.split("/").slice(0, -1);

  for (const segment of relative.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

export function scanDeclared(files: SiteFile[], readPackage: FontPackageReader, options: { tokensFile?: string | null; dependencies?: string[] } = {}): DeclaredScan {
  const variables: DeclaredVar[] = [];
  const fontFaces: DeclaredFontFace[] = [];
  const otherColors: DeclaredScan["otherColors"] = [];
  const notes: string[] = [];
  const imports = new Set<string>();

  for (const file of files) {
    for (const match of file.content.matchAll(/(?:@import\s+(?:url\()?|import\s+)["'](@fontsource(?:-variable)?\/[a-z0-9-]+)(\/[^"']*)?["']/gi)) {
      imports.add(`${match[1]}${match[2] ?? ""}`);
    }
    for (const block of styleBlocks(file)) {
      const text = blankComments(block.text);

      for (const match of text.matchAll(/(?<![\w-])(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+?)\s*(?=;|}|$)/gm)) {
        const raw = match[2]!.trim();

        if (!raw || raw.length > 400) continue;
        const valueStart = block.offset + match.index! + match[0].indexOf(match[2]!) + (match[2]!.length - match[2]!.trimStart().length);

        variables.push({
          name: match[1]!,
          raw,
          resolved: raw,
          file: file.path,
          line: lineAt(file.content, valueStart),
          start: valueStart,
          end: valueStart + raw.length,
          context: contextAt(text, match.index!),
          kind: "other",
        });
      }
      fontFaces.push(...parseFontFaces(text, file.path, file.path));
      if (/\.(scss|sass|less)$/i.test(file.path)) {
        for (const match of text.matchAll(/^\s*([$@][A-Za-z0-9_-]+)\s*:\s*([^;\n]+)/gm)) {
          const hex = normalizeColor(match[2]!.replace(/!default/, "").trim());

          if (hex) otherColors.push({ name: match[1]!, value: hex, file: file.path, line: lineAt(file.content, block.offset + match.index!) });
        }
      }
    }
    if (/(^|\/)tailwind\.config\.(c|m)?(j|t)s$/.test(file.path)) {
      // Only what is written plainly: `name: "#hex"` pairs. Anything computed is left alone.
      for (const match of file.content.matchAll(/["']?([A-Za-z0-9_-]+)["']?\s*:\s*["'](#[0-9a-fA-F]{3,8}|rgb[^"']+|hsl[^"']+|oklch[^"']+)["']/g)) {
        const hex = normalizeColor(match[2]!);

        if (hex) otherColors.push({ name: `tailwind:${match[1]}`, value: hex, file: file.path, line: lineAt(file.content, match.index!) });
      }
      notes.push(`Read the colours written plainly in ${file.path}; anything it computes isn't read.`);
    }
  }
  // Resolve var() chains (at most five deep) — the latest :root-level declaration of a name wins, as in the cascade.
  const byName = new Map<string, DeclaredVar>();

  for (const variable of variables) {
    if (/^(:root|html|@theme|:host)/.test(variable.context) || !byName.has(variable.name)) byName.set(variable.name, variable);
  }
  const resolve = (value: string, depth: number): string =>
    depth > 5 ? value : value.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]+))?\)/g, (whole, name: string, fallback?: string) => {
      const target = byName.get(name);

      return target ? resolve(target.raw, depth + 1) : (fallback?.trim() ?? whole);
    });

  for (const variable of variables) {
    variable.resolved = resolve(variable.raw, 0);
    variable.kind = kindOf(variable.name, variable.resolved);
  }
  // The tokens file: the one named, else the stylesheet declaring the most colour properties on :root.
  const counts = new Map<string, number>();

  for (const variable of variables) {
    if (variable.kind === "color" && /^(:root|@theme|html)/.test(variable.context)) counts.set(variable.file, (counts.get(variable.file) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  const named = options.tokensFile && files.some((file) => file.path === options.tokensFile) ? options.tokensFile : null;
  let tokensFile = named ?? ranked.find(([file]) => !/\/themes?\//.test(file))?.[0] ?? ranked[0]?.[0] ?? null;

  if (tokensFile && (counts.get(tokensFile) ?? 0) < 3 && !named) tokensFile = null;
  const namesIn = (file: string) => new Set(variables.filter((v) => v.file === file).map((v) => v.name));
  const tokenNames = tokensFile ? namesIn(tokensFile) : new Set<string>();
  const looks = tokensFile
    ? [...counts.keys()].filter((file) => file !== tokensFile && [...namesIn(file)].filter((name) => tokenNames.has(name)).length >= tokenNames.size * 0.9)
    : [];

  if (looks.length) notes.push(`${looks.length === 1 ? "One other file has" : `${looks.length} other files have`} the same properties as ${tokensFile} (alternative looks); only ${tokensFile} is read as the site's look.`);
  // Font packages: imported in CSS/code, or listed as dependencies.
  const packages = new Set<string>([...imports].map((spec) => spec.split("/").slice(0, 2).join("/")));

  for (const dep of options.dependencies ?? []) if (/^@fontsource(-variable)?\//.test(dep)) packages.add(dep);
  for (const spec of [...imports].sort()) {
    const sheets = readPackage(spec.includes("/", spec.indexOf("/") + 1) ? spec : `${spec}/index.css`);

    for (const sheet of sheets ?? []) fontFaces.push(...parseFontFaces(sheet.content, sheet.file, spec));
  }
  const kept = (variable: DeclaredVar) => !looks.includes(variable.file);
  const fonts: DeclaredFont[] = [];

  for (const variable of variables.filter((v) => v.kind === "font" && kept(v))) {
    const families = splitFamilies(variable.resolved);
    const first = families[0];

    if (!first || GENERIC.has(first.toLowerCase())) continue;
    const pkg = packageOfFamily(first, [...packages]) ?? fontFaces.find((face) => face.family === first && face.file.startsWith("pkg:"))?.file.slice(4).split("/").slice(0, 2).join("/");
    const ownFile = fontFaces.some((face) => face.family === first && !face.file.startsWith("pkg:"));

    fonts.push({
      family: first,
      fallbacks: families.slice(1),
      token: variable.name,
      file: variable.file,
      line: variable.line,
      source: pkg ? { kind: "package", ref: pkg } : ownFile ? { kind: "file" } : { kind: "unknown" },
    });
  }
  return { tokensFile, looks, variables: variables.filter(kept), fonts, fontFaces, fontPackages: [...packages].sort(), otherColors, notes };
}
