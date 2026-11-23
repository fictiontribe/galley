import { defineCollection, reference, z } from "astro:content";
import { file, glob } from "astro/loaders";

const seo = z.object({
  metaTitle: z.string().optional(),
  noindex: z.boolean().default(false),
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      pubDate: z.coerce.date(),
      cover: image().optional(),
      author: reference("authors"),
      tags: z.array(z.string()).default([]),
      status: z.enum(["draft", "review", "live"]).default("draft"),
      draft: z.boolean().optional(),
      seo: seo.optional(),
    }),
});

// Pages are built from sections; the schema only says "a list of objects".
const pageSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  sections: z.array(z.object({ type: z.string() }).passthrough()).optional(),
});

const pagesCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: pageSchema,
});

const guides = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages/guides" }),
  schema: z.object({ title: z.string(), level: z.enum(["intro", "advanced"]) }),
});

const authors = defineCollection({
  loader: file("src/data/authors.json"),
  schema: z.object({ id: z.string(), name: z.string(), role: z.string().optional() }),
});

export const collections = { blog, pages: pagesCollection, guides, authors };
