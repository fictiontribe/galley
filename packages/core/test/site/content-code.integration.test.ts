/**
 * The content-code guard wired through the real write surface. A site with an
 * Astro MDX collection and a plain Markdown one is opened through the facade,
 * and `writeFile` is driven as the roles would reach it: a contributor in
 * content mode, an owner in build mode. This proves the service calls the
 * guard (src/site/content-code.ts) on the write path with the collection's
 * resolved code — the unit test proves the guard's judgement against the real
 * MDX compiler; this proves the wiring.
 */
import { afterEach, describe, expect, it } from "vitest";
import { withCaller } from "../../src/install/caller";
import { GalleyError } from "../../src/errors";
import { cleanupAll, disposeAll, openSite, sh, tempDir, writeTree } from "./helpers";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

const CONFIG = JSON.stringify(
  {
    name: "Docs",
    framework: "astro",
    ai: { allowBuild: true },
    collections: [
      { id: "docs", path: "src/content/docs", format: "mdx", pattern: "**/*.mdx" },
      { id: "pages", path: "src/content/pages", format: "markdown", pattern: "**/*.md" },
    ],
  },
  null,
  2
);

function fixture(): string {
  const root = tempDir("content-code-site-");

  writeTree(root, {
    "galley.config.json": `${CONFIG}\n`,
    "src/content/docs/intro.mdx": "---\ntitle: Intro\n---\n\nPlain prose, nothing the build runs.\n",
    "src/content/pages/about.md": "---\ntitle: About\n---\n\nAbout us.\n",
  });
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "First version");
  return root;
}

const as = <T>(role: "owner" | "contributor", run: () => Promise<T>): Promise<T> => withCaller({ accountId: `${role}-1`, role }, run);

async function refusalOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof GalleyError && (error.code === "forbidden" || error.code === "invalid")) return error.message;
    throw error;
  }
}

describe("the content-code guard through the write surface", { timeout: 120_000 }, () => {
  it("resolves each collection's code from the framework", async () => {
    const { site } = await openSite(fixture());
    const model = await site.model();

    expect(model.framework.id).toBe("astro");
    expect(model.collections.find((c) => c.id === "docs")?.format).toBe("mdx");
    expect(model.collections.find((c) => c.id === "pages")?.format).toBe("markdown");
  });

  it("lets a contributor write inert content, and refuses code and the wrong file type in content mode", async () => {
    const { site } = await openSite(fixture());
    const content = { origin: "user" as const, mode: "content" as const };

    await as("contributor", async () => {
      // Plain Markdown runs no code: a contributor may add and edit it.
      expect(await refusalOf(site.writeFile("src/content/pages/new.md", "---\ntitle: New\n---\n\nHello.\n", content))).toBeNull();
      // MDX prose with no code is fine too.
      expect(await refusalOf(site.writeFile("src/content/docs/plain.mdx", "---\ntitle: Plain\n---\n\nJust words.\n", content))).toBeNull();
      // Adding an expression, an import, or a component to MDX is a build-mode change: refused in content mode.
      expect(await refusalOf(site.writeFile("src/content/docs/expr.mdx", "---\nt: x\n---\n\n{readFileSync('/etc/passwd')}\n", content))).toMatch(/build mode/);
      expect(await refusalOf(site.writeFile("src/content/docs/imp.mdx", "---\nt: x\n---\n\nimport fs from 'node:fs'\n\ntext\n", content))).toMatch(/build mode/);
      expect(await refusalOf(site.writeFile("src/content/docs/comp.mdx", "---\nt: x\n---\n\n<Danger />\n", content))).toMatch(/build mode/);
      // A new executable or template file under a content folder is refused whatever its contents.
      expect(await refusalOf(site.writeFile("src/content/docs/evil.js", "export default () => {}\n", content))).toMatch(/build mode/);
      expect(await refusalOf(site.writeFile("src/content/pages/page.astro", "---\n---\n<h1>x</h1>\n", content))).toMatch(/build mode/);
      expect(await refusalOf(site.writeFile("src/content/docs/evil.11ty.js", "module.exports = () => 'x'\n", content))).toMatch(/build mode/);
    });
  });

  it("refuses a contributor the MDX code even in build mode (the level), and lets an owner make it in build mode", async () => {
    const { site } = await openSite(fixture());
    const build = { origin: "user" as const, mode: "build" as const };

    // A contributor is below build-mode level: refused even asking for build mode.
    expect(await as("contributor", () => refusalOf(site.writeFile("src/content/docs/c.mdx", "---\nt: x\n---\n\n{code()}\n", build)))).toMatch(/build mode/);
    // An owner has the level and the site allows build mode: the write goes through.
    expect(await as("owner", () => refusalOf(site.writeFile("src/content/docs/o.mdx", "---\nt: x\n---\n\n{code()}\n", build)))).toBeNull();
  });
});
