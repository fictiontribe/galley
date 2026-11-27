/**
 * Page-address patterns for `include` / `exclude`, matched exactly as the
 * site runtime matches them (`@galleycms/astro` src/shared/glob.js — keep the
 * two in step): the path only (no domain, query or hash); a trailing slash
 * makes no difference; `*` stays within one part of the path; `**` crosses
 * parts, and "/blog/**" also matches /blog itself; `?` is one character.
 * Everything else is literal. An empty pattern is the home page.
 */
/** "https://site.test/Pricing/?a=1#x" → "/Pricing" — the path, with no trailing slash (except the home page). */
export function normalizePath(address: string): string {
  let path = address.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(path);
  if (scheme) path = path.slice(scheme[0].length);
  path = path.split(/[?#]/)[0] ?? "";
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path;
}

/** A pattern as a regular expression over normalised paths (the runtime's `compile`). */
export function patternToRegExp(glob: string): RegExp {
  let source = "";
  let pattern = glob.trim();
  if (!pattern.startsWith("/")) pattern = `/${pattern}`;
  pattern = pattern.replace(/\/+$/, "");
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;
    if (char === "*" && pattern[index + 1] === "*") {
      if (source.endsWith("/")) source = `${source.slice(0, -1)}(?:/.*)?`;
      else source += ".*";
      index += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}/?$`);
}

/** Whether a page address matches a pattern (the runtime's `matchGlob`). */
export function matchesPattern(pattern: string, address: string): boolean {
  const path = normalizePath(address);
  return patternToRegExp(pattern).test(path) || (pattern.trim().replace(/\/+$/, "") === "" && path === "/");
}

export interface PageRule {
  include?: string[];
  exclude?: string[];
}

export interface PageVerdict {
  loads: boolean;
  /** The pattern that decided, when one did. */
  because?: { list: "include" | "exclude"; pattern: string };
}

/** Whether a script with these page rules loads on this page, and which pattern decided. */
export function pageVerdict(rule: PageRule, address: string): PageVerdict {
  const include = rule.include ?? [];
  const exclude = rule.exclude ?? [];
  const excluded = exclude.find((pattern) => matchesPattern(pattern, address));
  if (excluded) return { loads: false, because: { list: "exclude", pattern: excluded } };
  if (include.length === 0) return { loads: true };
  const included = include.find((pattern) => matchesPattern(pattern, address));
  return included ? { loads: true, because: { list: "include", pattern: included } } : { loads: false };
}

export type PageScope = "everywhere" | "only" | "except";

/** How the rules read: every page, only some pages, or every page but some. */
export function scopeOf(rule: PageRule): PageScope {
  if ((rule.include ?? []).length > 0) return "only";
  if ((rule.exclude ?? []).length > 0) return "except";
  return "everywhere";
}

/** "Every page", "Only /pricing/*", "Every page except /admin/**" */
export function describePages(rule: PageRule): string {
  const scope = scopeOf(rule);
  const list = (patterns: string[] | undefined) => (patterns ?? []).map((pattern) => pattern.trim() || "/").join(", ");
  if (scope === "only") return `Only ${list(rule.include)}${(rule.exclude ?? []).length ? `, not ${list(rule.exclude)}` : ""}`;
  if (scope === "except") return `Every page except ${list(rule.exclude)}`;
  return "Every page";
}
