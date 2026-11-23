/**
 * Plain-language names for the things tools act on, for activity lines.
 * People see "Updating the About page", never a tool name or a file path.
 */
import { collectionForPath, slugForPath } from "../../content/entries/paths";
import { titleFromFilename } from "../../content/util/text";
import type { SiteModel } from "../../types";

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** "the About page", "the post “Measured survey”", "the site settings". */
export function entryName(path: string, model: SiteModel, titles: Map<string, string>): string {
  const collection = collectionForPath(model, path);
  const known = titles.get(path);

  if (!collection) return known ? `“${known}”` : "a content file";
  if (collection.kind === "data") return `the ${lower(collection.label)}`;
  const slug = slugForPath(collection, path);
  const isPages = collection.id === "pages" || collection.singular.toLowerCase() === "page";

  if (isPages && (slug === "index" || slug === "")) return "the home page";
  const title = known ?? titleFromFilename(slug.split("/").pop() ?? slug);

  return isPages ? `the ${title} page` : `the ${lower(collection.singular)} “${title}”`;
}

const COMPONENT_EXT = /\.(astro|tsx|jsx|vue|svelte|njk|liquid|hbs|html)$/i;

/** "the “Header” component", "the “tokens” stylesheet", "the site configuration". */
export function fileName(path: string): string {
  const name = path.split("/").pop() ?? path;
  const stem = name.replace(/\.[^.]+$/, "");
  const segments = path.toLowerCase().split("/");

  if (/^galley\.config\.json$|^(astro|next|nuxt|svelte|vite|tailwind|eleventy|docusaurus)\.config\./i.test(name) || name === ".eleventy.js") {
    return "the site configuration";
  }
  if (name === "package.json") return "the site's package list";
  if (/\.(css|scss|sass|less)$/i.test(name)) return `the “${stem}” stylesheet`;
  if (COMPONENT_EXT.test(name)) {
    if (segments.includes("layouts")) return `the “${stem}” layout`;
    if (segments.includes("pages")) return `the “${stem}” page template`;
    return `the “${stem}” component`;
  }
  if (/\.(md|mdx)$/i.test(name)) return `the “${titleFromFilename(stem)}” document`;
  if (/\.(json|ya?ml|toml)$/i.test(name)) return `the “${stem}” settings`;
  if (/\.(ts|js|mjs|cjs)$/i.test(name)) return `the “${stem}” script`;
  return "a source file";
}

export function quoted(text: string, max = 40): string {
  const clean = text.replace(/\s+/g, " ").trim();

  return `“${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}”`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
