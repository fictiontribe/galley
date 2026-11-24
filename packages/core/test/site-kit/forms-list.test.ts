import { describe, expect, it } from "vitest";
import { formIdOf, formsNamedIn, namesThisForm } from "../../src/forms/shared";
import { listForms } from "../../src/site-kit/forms-list";
import type { Collection, EntrySummary, Field, SearchHit, SiteModel, SiteService } from "../../src/types";

const ref = (key: string, extra: Partial<Field> = {}): Field => ({ key, label: key, type: "reference", required: false, source: "schema", collection: "forms", ...extra });
const text = (key: string): Field => ({ key, label: key, type: "string", required: false, source: "schema" });

/** The editorial starter's page sections: a Form section (any form), a Contact and a Newsletter section with defaults. */
const sections: Field = {
  key: "sections",
  label: "Sections",
  type: "blocks",
  required: false,
  source: "schema",
  discriminator: "type",
  blocks: [
    { type: "statement", label: "Statement", count: 1, fields: [text("heading"), text("text")] },
    { type: "form", label: "Form", count: 1, fields: [text("heading"), ref("form", { required: true })] },
    { type: "contact", label: "Contact", count: 1, fields: [text("heading"), ref("form", { default: "contact" })] },
    { type: "newsletter", label: "Newsletter", count: 1, fields: [text("heading"), ref("form", { default: "newsletter" })] },
  ],
};

describe("which forms an entry shows", () => {
  it("reads the form a section names, as a string or as an object", () => {
    expect(formsNamedIn({ sections: [{ type: "form", heading: "Shops", form: "stockist" }] }, [sections])).toEqual(["stockist"]);
    expect(formsNamedIn({ sections: [{ type: "form", form: { id: "stockist", collection: "forms" } }] }, [sections])).toEqual(["stockist"]);
    expect(formsNamedIn({ sections: [{ type: "form", form: "forms/stockist.json" }] }, [sections])).toEqual(["stockist"]);
  });

  it("counts a section that names no form as showing its field's default", () => {
    expect(formsNamedIn({ sections: [{ type: "contact", heading: "Write to us" }] }, [sections])).toEqual(["contact"]);
    expect(formsNamedIn({ sections: [{ type: "newsletter", heading: "Letters" }, { type: "statement", heading: "x" }] }, [sections])).toEqual(["newsletter"]);
    // A form named overrides the default.
    expect(formsNamedIn({ sections: [{ type: "newsletter", form: "letters" }] }, [sections])).toEqual(["letters"]);
  });

  it("without a schema, any form or formId key counts, and other text never does", () => {
    expect(formsNamedIn({ blocks: [{ kind: "x", formId: "demo" }], hero: { form: { id: "contact" } } })).toEqual(["demo", "contact"]);
    expect(formsNamedIn({ title: "Contact", sections: [{ type: "statement", text: "contact us" }] }, [sections])).toEqual([]);
    expect(formIdOf(42)).toBeNull();
  });

  it("a page body that uses the site kit's component names its form", () => {
    const hit: SearchHit = { path: "p.mdx", collection: "pages", title: "P", url: "/p/", excerpt: '<Form id="contact" />', location: { kind: "body", start: 0, end: 1, block: "" } };

    expect(namesThisForm(hit, "contact")).toBe(true);
    expect(namesThisForm({ ...hit, excerpt: '<Form id="contact-old" />' }, "contact")).toBe(false);
  });
});

describe("the forms list", () => {
  const forms: Collection = { id: "forms", label: "Forms", kind: "entries", path: "src/content/forms", format: "json", fields: [], kit: "forms" } as unknown as Collection;
  const pages: Collection = { id: "pages", label: "Pages", kind: "entries", path: "src/content/pages", format: "markdown", fields: [sections] } as unknown as Collection;
  const files: Record<string, string> = {
    "src/content/forms/contact.json": JSON.stringify({ name: "Write to the workroom", fields: [{ id: "email", type: "email", label: "Email" }], submitLabel: "Send" }),
    "src/content/forms/newsletter.json": JSON.stringify({ name: "Letters", fields: [{ id: "email", type: "email", label: "Email" }], submitLabel: "Subscribe" }),
    "src/content/forms/stockist.json": JSON.stringify({ name: "Become a stockist", fields: [{ id: "email", type: "email", label: "Email" }], submitLabel: "Send" }),
    // Three mentions of "stockists" before the section that names the form: the search's three hits per file ran out here.
    "src/content/pages/stockists.md": "---\ntitle: Stockists\nsections:\n  - type: statement\n    heading: Stockists\n    text: Our stockists, and how to become one of the stockists.\n  - type: form\n    heading: For shops\n    form: stockist\n---\n",
    "src/content/pages/contact.md": "---\ntitle: Contact\nsections:\n  - type: contact\n    heading: Write to the workroom\n---\n",
    "src/content/pages/index.md": "---\ntitle: Home\nsections:\n  - type: newsletter\n    heading: Letters\n---\n",
    "src/content/pages/about.md": "---\ntitle: About\nsections:\n  - type: statement\n    heading: Contact the stockist\n---\n",
  };
  const summary = (path: string, collection: string): EntrySummary => ({
    path,
    collection,
    slug: path.split("/").pop()!.replace(/\.\w+$/, ""),
    title: (/title: (.+)/.exec(files[path]!)?.[1] ?? JSON.parse(files[path]!).name) as string,
    titleSource: "field",
    url: null,
    status: "clean",
    modifiedAt: 0,
  });
  const site = {
    model: async () => ({ collections: [forms, pages] }) as unknown as SiteModel,
    listEntries: async (collection: string) => {
      const items = Object.keys(files)
        .filter((path) => path.startsWith(collection === "forms" ? "src/content/forms/" : "src/content/pages/"))
        .map((path) => summary(path, collection));

      return { collection, total: items.length, items };
    },
    readFile: async (path: string) => ({ path, content: files[path]!, hash: "", binary: false }),
    // As the index does: the title and the first mentions, never the section's form field.
    search: async (): Promise<SearchHit[]> => [],
  } as unknown as SiteService;

  it("lists every page a form appears on, named or by default", async () => {
    const items = await listForms(site);
    const used = Object.fromEntries(items.map((item) => [item.id, item.pages.map((page) => page.title)]));

    expect(used).toEqual({ contact: ["Contact"], newsletter: ["Home"], stockist: ["Stockists"] });
  });
});
