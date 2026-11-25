/**
 * The content-code guard (src/site/content-code.ts). The MDX judge is checked
 * against the real MDX compiler (@mdx-js/mdx, a dev dependency): everything the
 * compiler would run — every ESM statement, `{ … }` expression and `<Jsx`
 * element — in a corpus of hostile inputs is refused. Over-refusing is fine;
 * under-refusing is the escalation this closes, so the test fails on one.
 */
import { createProcessor } from "@mdx-js/mdx";
import { describe, expect, it } from "vitest";
import { withCaller } from "../../src/install/caller";
import { addedMdxCode, contentCodeFor, contentCodeRefusal, contentTypeRefusal, mdxCodeTokens } from "../../src/site/content-code";
import type { Collection } from "../../src/types";

const processor = createProcessor({});

/** Whether the real MDX compiler marks any part of `input` as code (its mdx* node types). */
function compilerSeesCode(input: string): boolean {
  let found = false;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: unknown; children?: unknown };

    if (typeof n.type === "string" && /^mdx/i.test(n.type)) found = true;
    if (Array.isArray(n.children)) for (const child of n.children) walk(child);
  };

  walk(processor.parse(input));
  return found;
}

describe("the MDX judge against the real compiler", () => {
  const corpus = [
    "import X from 'y';\n\ntext\n",
    "import { a, b } from 'y';\n",
    "import 'side-effect';\n",
    "export const z = 1;\n",
    "export default function () {}\n",
    "{1 + 1}\n",
    "Prose with an inline {expr} in it.\n",
    "{\n  multiline.expression()\n}\n",
    "{ { nested: 1 } }\n",
    "<Foo />\n",
    "<Foo>child</Foo>\n",
    "Inline <Bar/> element.\n",
    '<div class="x">lowercase html is jsx in mdx</div>\n',
    "<Foo bar={1} baz={readFileSync('/x')} />\n",
    "A paragraph, then\n\n{dangerous()}\n",
    "---\ntitle: t\n---\nimport fs from 'node:fs'\n\n{fs.readFileSync('/x')}\n",
    "Only prose. Nothing special at all here.\n",
    "A fence hides it:\n\n```\n{notcode}\n<NotJsx/>\nimport nope\n```\n",
    "Inline code `{notcode}` and `<NotJsx/>` spans.\n",
    "Escaped \\{ and \\< are literal.\n",
    "Math: a < b when spaced.\n",
    "A list:\n- one\n- two\n",
  ];

  it("refuses everything the compiler would run (no under-refusals)", () => {
    const underRefusals = corpus.filter((input) => compilerSeesCode(input) && addedMdxCode("", input).length === 0);

    expect(underRefusals).toEqual([]);
  });

  it("lets prose be edited around code, and refuses changing the code", () => {
    const base = "Intro.\n\nimport X from 'y'\n\n{X()}\n";

    expect(addedMdxCode(base, "Intro, reworded.\n\nimport X from 'y'\n\n{X()}\n")).toEqual([]);
    expect(addedMdxCode(base, "Intro.\n\nimport X from 'y'\n\n{X() /* changed */}\n")).not.toEqual([]);
    // Removing the code adds nothing.
    expect(addedMdxCode(base, "Intro.\n")).toEqual([]);
  });

  it("does not count braces or tags inside code fences or inline code, or escaped ones, or a spaced <", () => {
    for (const inert of ["```\n{x}\n<Y/>\n```\n", "Inline `{x}` `<Y/>`.\n", "Escaped \\{x\\} and \\<Y\\>.\n", "Compare a < b and c > d.\n"]) {
      expect(mdxCodeTokens(inert), inert).toEqual([]);
    }
  });
});

const collection = (over: Partial<Collection>): Collection =>
  ({ id: "c", label: "C", singular: "c", kind: "entries", path: "src/content/c", format: "markdown", body: true, url: null, fields: [], create: true, count: 0, source: "inferred", ...over }) as Collection;

describe("the fail-closed code resolver", () => {
  it("trusts Astro and the generic model's Markdown as inert; every detected or unknown framework's content is guarded", () => {
    expect(contentCodeFor("astro", collection({ format: "markdown", pattern: "**/*.md" }))).toBe("inert");
    expect(contentCodeFor("astro", collection({ format: "mdx", pattern: "**/*.mdx" }))).toBe("mdx");
    // A {md,mdx} collection admits mdx: judged, not inert.
    expect(contentCodeFor("astro", collection({ format: "markdown", pattern: "**/*.{md,mdx}" }))).toBe("mdx");
    // Galley's own "generic" (Markdown) model renders a markdown collection statically: inert, like Astro. Its mdx is still judged.
    expect(contentCodeFor("generic", collection({ format: "markdown", pattern: "**/*.md" }))).toBe("inert");
    expect(contentCodeFor("generic", collection({ format: "mdx", pattern: "**/*.mdx" }))).toBe("mdx");
    // Docusaurus runs .md as MDX; Eleventy and the rest run templates; an unknown id ("", "something-new") is not trusted: all guarded whole-collection.
    for (const framework of ["docusaurus", "eleventy", "jekyll", "sveltekit", "nuxt", "next", "hugo", "", "something-new"]) {
      expect(contentCodeFor(framework, collection({ format: "markdown", pattern: "**/*.md" })), framework).toBe("template");
      expect(contentCodeFor(framework, collection({ format: "mdx", pattern: "**/*.mdx" })), framework).toBe("mdx");
    }
    // Data is declarative everywhere.
    for (const framework of ["astro", "eleventy"]) expect(contentCodeFor(framework, collection({ kind: "data", format: "json", path: "src/data/x.json" }))).toBe("inert");
    // An adapter may override with an explicit declaration.
    expect(contentCodeFor("eleventy", collection({ format: "markdown", code: "inert" }))).toBe("inert");
  });
});

describe("the code refusal, in content mode", () => {
  const who = { origin: "user" as const, mode: "content" as const, allowBuild: true };

  it("lets inert content through, judges mdx, and guards a template collection whole", () => {
    expect(contentCodeRefusal("inert", null, "{x}\nimport y\n", who)).toBeNull();
    expect(contentCodeRefusal("mdx", null, "Just prose.\n", who)).toBeNull();
    expect(contentCodeRefusal("mdx", null, "{dangerous()}\n", who)).toMatch(/build mode/);
    expect(contentCodeRefusal("mdx", "{a}\n", "{a}\n reworded prose\n", who)).toBeNull();
    // A template collection: even prose is build-mode.
    expect(contentCodeRefusal("template", null, "Just prose.\n", who)).toMatch(/build mode/);
    // An absent marker is guarded like a template (fail closed).
    expect(contentCodeRefusal(undefined, null, "Just prose.\n", who)).toMatch(/build mode/);
  });

  it("is build-mode even for the agent, and lets a build-mode write with the level through", () => {
    expect(contentCodeRefusal("mdx", null, "{x}\n", { origin: "agent", allowBuild: true })).toMatch(/build mode/);
    // A build-mode write needs the build level; an owner (manage) has it.
    const owner = { origin: "user" as const, mode: "build" as const, allowBuild: true };

    expect(withCaller({ accountId: "o", role: "owner", current: () => "owner", named: () => true }, () => contentCodeRefusal("mdx", null, "{x}\n", owner))).toBeNull();
    // A contributor in build mode is refused for the level.
    expect(withCaller({ accountId: "c", role: "contributor", current: () => "contributor", named: () => true }, () => contentCodeRefusal("mdx", null, "{x}\n", owner))).toMatch(/content.*not its code|build mode/i);
  });
});

describe("the file-type guard", () => {
  const model = {
    collections: [collection({ id: "posts", path: "src/content/posts", format: "mdx", pattern: "**/*.mdx" }), collection({ id: "blog", path: "src/content/blog", format: "markdown", pattern: "**/*.{md,mdx}" })],
    media: { roots: [{ dir: "public" }] },
  };
  const who = { origin: "user" as const, mode: "content" as const, allowBuild: true };

  it("admits only the collection's own formats and media, and refuses an executable or template file under a content glob", () => {
    expect(contentTypeRefusal("src/content/posts/a.mdx", model, who)).toBeNull();
    expect(contentTypeRefusal("src/content/blog/a.md", model, who)).toBeNull();
    expect(contentTypeRefusal("public/images/photo.png", model, who)).toBeNull();
    // A static file the site serves (not a collection file, not executable) is fine.
    expect(contentTypeRefusal("public/_redirects", model, who)).toBeNull();
    expect(contentTypeRefusal("public/data/list.json", model, who)).toBeNull();
    // The holes this closes:
    for (const path of ["src/content/posts/evil.js", "src/content/posts/evil.11ty.js", "src/content/blog/page.astro", "src/content/blog/x.svelte", "src/content/posts/data.json"]) {
      expect(contentTypeRefusal(path, model, who), path).toMatch(/build mode/);
    }
    // An executable file anywhere a content write reaches (even the public folder, served to browsers) is refused.
    expect(contentTypeRefusal("public/images/x.js", model, who)).toMatch(/build mode/);
    expect(contentTypeRefusal("public/app.astro", model, who)).toMatch(/build mode/);
    // A path under no collection or media directory is not the file-type concern here.
    expect(contentTypeRefusal("src/data/redirects.json", model, who)).toBeNull();
  });
});
