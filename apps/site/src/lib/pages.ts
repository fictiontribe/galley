import { getEntry } from "astro:content";
import { renderMarkdown } from "./markdown";

/**
 * A page's front matter and rendered body. Page-specific sections are read as
 * written in the file (the schema declares only the shared fields), so they
 * are typed loosely here; each page template knows its own shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PageData = Record<string, any> & { title: string; description: string };

export async function getPage(id: string): Promise<{ data: PageData; html: string; body: string }> {
  const entry = await getEntry("pages", id);
  if (!entry) throw new Error(`Missing page src/content/pages/${id}.md`);
  const body = entry.body ?? "";
  return { data: entry.data as PageData, html: body.trim() ? renderMarkdown(body).html : "", body };
}
