import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import type { EditOp, JsonValue } from "../../src/types";
import {
  addBareRemote,
  cleanupAll,
  disposeAll,
  HERO_HEADING,
  HOME,
  makeSite,
  openSite,
  pngHeader,
  POST,
  PRICING,
  sh,
  until,
  writeTree,
} from "./helpers";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

const read = (root: string, path: string) => readFileSync(join(root, ...path.split("/")), "utf8");

/** Lines that differ between two texts (common head and tail trimmed). */
function changedLines(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;

  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;

  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  return { removed: a.slice(start, endA + 1), added: b.slice(start, endB + 1) };
}

/** Each "  - type: …" section of the page's front matter, as source text. */
function sectionTexts(raw: string): string[] {
  const front = raw.split("\n---\n")[0] ?? raw;
  const start = front.indexOf("\nsections:\n");

  return front
    .slice(start + "\nsections:\n".length)
    .split(/\n(?=  - type: )/)
    .map((text) => text.replace(/\n$/, ""));
}

async function rejects(promise: Promise<unknown>): Promise<GalleyError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GalleyError);
    return error as GalleyError;
  }
  throw new Error("expected the call to be refused");
}

describe("site model", () => {
  it("finds the starter's collections and data files, with publish settings from git", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const model = await site.model();
    const entries = model.collections.filter((collection) => collection.kind === "entries");
    const data = model.collections.filter((collection) => collection.kind === "data");
    // Counted from the starter's own folders, so a starter that grows (forms, authors) doesn't need this kept by hand.
    const files = (dir: string) => (readdirSync(join(root, dir), { recursive: true }) as string[]).filter((name) => /\.(md|mdx|json|ya?ml)$/.test(name)).length;

    for (const id of ["pages", "blog", "team"]) {
      const collection = entries.find((candidate) => candidate.id === id);

      expect(collection, id).toBeDefined();
      expect(collection!.count, id).toBe(files(collection!.path));
    }
    expect(data.map((collection) => collection.path)).toEqual(expect.arrayContaining(["src/data/navigation.json", "src/data/site.json"]));
    expect(model.name).toBe("Lowfield Studio");
    expect(model.publish).toEqual({ branch: "main", mode: "commit", remote: null, push: false });

    const detail = await site.detail();

    expect(detail).toMatchObject({ id: "test-site", name: "Lowfield Studio", branch: "main", hasConfig: true, pendingChanges: 0 });
    expect(detail.framework.id).toBe("astro");
    expect(detail.preview.state).toBe("idle");
    expect(detail.git.hasRemote).toBe(false);
  });

  it("pushes to origin when a remote exists, and never shows credentials in its address", async () => {
    const root = makeSite();

    addBareRemote(root);
    sh(root, "checkout", "-q", "-b", "trunk");
    const { site } = await openSite(root);

    // The checked-out branch, not a guess; the remote that exists.
    expect((await site.model()).publish).toEqual({ branch: "trunk", mode: "commit", remote: "origin", push: true });

    sh(root, "remote", "set-url", "origin", "https://someone:s3cret-token@example.com/acme/site.git");
    await site.refresh();
    const summary = await site.summary();

    expect(summary.remoteUrl).toBe("https://example.com/acme/site.git");
    expect(JSON.stringify(await site.detail())).not.toContain("s3cret");
  });

  it("only an explicit branch in the config file overrides the checked-out one", async () => {
    const root = makeSite();
    const config = JSON.parse(read(root, "galley.config.json")) as Record<string, unknown>;

    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ ...config, publish: { branch: "live", push: false } }));
    const { site } = await openSite(root);

    expect((await site.model()).publish).toMatchObject({ branch: "live", push: false });
  });
});

describe("entries", () => {
  it("lists and reads entries with their change status", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const pages = await site.listEntries("pages");

    expect(pages.total).toBe(8);
    expect(pages.items.every((item) => item.status === "clean")).toBe(true);

    const home = await site.readEntry(HOME);

    expect(home).toMatchObject({ collection: "pages", slug: "index", url: "/", status: "clean", format: "markdown" });
    expect(home.title).toBe("Lowfield Studio — architecture for the homes people already love");
    expect(home.issues.filter((issue) => issue.severity === "error")).toEqual([]);

    await site.updateEntry(HOME, [{ op: "set", path: ["description"], value: "A short new description." }]);
    const after = await site.listEntries("pages", { status: "modified" });

    expect(after.items.map((item) => item.path)).toEqual([HOME]);
    expect((await rejects(site.readEntry("README.md"))).code).toBe("not-found");
    const notContent = await rejects(site.readEntry("src/components/Header.astro"));

    expect(notContent.code).toBe("not-found");
    expect(notContent.message).toMatch(/isn't part of any collection/);
  });

  it("sets the hero heading: one line in the file changes, and the proof says so in the form's words", async () => {
    const root = makeSite();
    const { site, of } = await openSite(root);
    const before = read(root, HOME);
    const result = await site.updateEntry(HOME, [{ op: "set", path: ["sections", 0, "heading"], value: "Make the most of the house you have." }]);

    expect(result.applied).toBe(1);
    expect(result.refused).toEqual([]);
    expect(result.entry.status).toBe("modified");
    expect((result.entry.data.sections as Array<Record<string, JsonValue>>)[0]!.heading).toBe("Make the most of the house you have.");
    expect(changedLines(before, read(root, HOME))).toEqual({
      removed: [`    heading: ${HERO_HEADING}`],
      added: ["    heading: Make the most of the house you have."],
    });
    expect(sh(root, "diff", "--numstat")).toBe(`1\t1\t${HOME}`);

    const changes = await site.changes();

    expect(changes.files).toHaveLength(1);
    expect(changes.files[0]).toMatchObject({
      path: HOME,
      status: "modified",
      kind: "content",
      collection: "pages",
      title: "Lowfield Studio — architecture for the homes people already love",
      url: "/",
      bodyChanged: false,
      summary: "Changed the heading.",
    });
    expect(changes.files[0]!.fieldChanges).toEqual([
      { field: ["sections", 0, "heading"], label: "Sections › 1 (Hero) › Heading", kind: "changed", before: HERO_HEADING, after: "Make the most of the house you have." },
    ]);
    expect(of("changes.updated")).toEqual([{ type: "changes.updated", siteId: "test-site", paths: [HOME], origin: "user" }]);
  });

  it("refuses a stale edit with a conflict and writes nothing when every op is refused", async () => {
    const root = makeSite();
    const { site, of } = await openSite(root);
    const { hash } = await site.readEntry(HOME);

    writeFileSync(join(root, HOME), read(root, HOME).replace("Four ways we usually help", "Five ways we usually help"));
    const conflict = await rejects(site.updateEntry(HOME, [{ op: "set", path: ["title"], value: "New title" }], { baseHash: hash }));

    expect(conflict.code).toBe("conflict");
    expect(conflict.status).toBe(409);
    expect(read(root, HOME)).toContain("Five ways");
    expect(read(root, HOME)).not.toContain("New title");

    const post = makeSite();
    const second = await openSite(post);
    const mtime = statSync(join(post, POST)).mtimeMs;
    const raw = read(post, POST);
    const refused = await second.site.updateEntry(POST, [
      { op: "body-replace", find: "words that are not in this post", replace: "x" },
      { op: "set", path: [], value: "nothing" },
    ]);

    expect(refused.applied).toBe(0);
    expect(refused.refused.map((refusal) => refusal.index)).toEqual([0, 1]);
    expect(refused.refused[0]!.reason).toMatch(/isn't in the main text/);
    expect(read(post, POST)).toBe(raw);
    expect(statSync(join(post, POST)).mtimeMs).toBe(mtime);
    expect(second.of("changes.updated")).toEqual([]);
    expect(of("changes.updated")).toEqual([]);
  });

  it("serialises rapid edits to one file so both land, in order", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const [first, second, third] = await Promise.all([
      site.updateEntry(HOME, [{ op: "set", path: ["sections", 0, "heading"], value: "One" }]),
      site.updateEntry(HOME, [{ op: "set", path: ["sections", 0, "eyebrow"], value: "Two" }]),
      site.updateEntry(HOME, [{ op: "set", path: ["sections", 0, "heading"], value: "Three" }]),
    ]);

    expect([first.applied, second.applied, third.applied]).toEqual([1, 1, 1]);
    const final = await site.readEntry(HOME);
    const hero = (final.data.sections as Array<Record<string, JsonValue>>)[0]!;

    expect(hero.heading).toBe("Three");
    expect(hero.eyebrow).toBe("Two");
    expect(third.entry.hash).toBe(final.hash);
  });
});

describe("sections", () => {
  it("inserts a section from its example, moves it and removes it, leaving the other sections byte-identical", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const original = read(root, HOME);
    const untouched = sectionTexts(original);
    const pages = (await site.model()).collections.find((collection) => collection.id === "pages")!;
    const sections = pages.fields.find((field) => field.key === "sections")!;
    const cta = sections.blocks!.find((block) => block.type === "cta")!;

    expect(sections.type).toBe("blocks");
    expect(cta.example).toBeDefined();
    const count = ((await site.readEntry(HOME)).data.sections as JsonValue[]).length;
    const steps: Array<{ op: EditOp; at: number | null }> = [
      { op: { op: "insert", path: ["sections"], index: 1, value: cta.example! }, at: 1 },
      { op: { op: "move", path: ["sections"], from: 1, to: 3 }, at: 3 },
      { op: { op: "remove", path: ["sections"], index: 3 }, at: null },
    ];

    for (const step of steps) {
      const result = await site.updateEntry(HOME, [step.op]);
      const text = read(root, HOME);
      const list = result.entry.data.sections as JsonValue[];

      expect(result.applied).toBe(1);
      expect(result.entry.issues.filter((issue) => issue.code === "parse")).toEqual([]);
      expect(list).toHaveLength(step.at === null ? count : count + 1);
      if (step.at !== null) expect(list[step.at]).toEqual(cta.example);
      for (const section of untouched) expect(text).toContain(section);
      // The markdown below the fields is never touched by a section edit.
      expect(text.slice(text.indexOf("\n---\n"))).toBe(original.slice(original.indexOf("\n---\n")));
    }
    expect(read(root, HOME)).toBe(original);
    expect((await site.changes()).files).toEqual([]);
  });
});

describe("body and raw edits", () => {
  it("edits a blog post's main text and reports it as such", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const result = await site.updateEntry(POST, [{ op: "body-replace", find: "Houses are never quite square", replace: "Houses are rarely square" }]);

    expect(result.applied).toBe(1);
    expect(result.entry.body).toContain("## Houses are rarely square");
    const change = (await site.changes()).files[0]!;

    expect(change).toMatchObject({ kind: "content", collection: "blog", bodyChanged: true, fieldChanges: [], summary: "Edited the main text." });
    expect(change.title).toBe("What a measured survey tells you before anything gets knocked down");
  });

  it("refuses a whole-file replacement that breaks the fields at the top, and accepts one that parses", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const raw = read(root, POST);
    const broken = raw.replace("title: What a measured survey", "title: [What a measured survey");
    const unclosed = `---\ntitle: Just a title\n\nThe closing line is gone.\n`;
    const result = await site.updateEntry(POST, [
      { op: "raw", value: broken },
      { op: "raw", value: unclosed },
    ]);

    expect(result.applied).toBe(0);
    expect(result.refused.map((refusal) => refusal.index)).toEqual([0, 1]);
    expect(result.refused[0]!.reason).toMatch(/could not be read/);
    expect(result.refused[1]!.reason).toMatch(/never end/);
    expect(read(root, POST)).toBe(raw);

    const fine = await site.updateEntry(POST, [{ op: "raw", value: raw.replace("tags:\n  - Process", "tags:\n  - Surveys") }]);

    expect(fine.applied).toBe(1);
    expect(fine.entry.data.tags).toEqual(["Surveys", "Older homes"]);
  });
});

describe("creating and deleting", () => {
  it("creates an entry, surfaces missing required fields as issues, refuses a taken address, and deletes it again", async () => {
    const root = makeSite();
    const { site, of } = await openSite(root);
    const created = await site.createEntry({ collection: "blog", slug: "Spring Open Day!", data: { title: "Spring open day" }, body: "Come and see us." });

    expect(created).toMatchObject({ path: "src/content/blog/spring-open-day.md", slug: "spring-open-day", url: "/blog/spring-open-day/", status: "added", title: "Spring open day" });
    expect(created.body).toContain("Come and see us.");
    const required = created.issues.filter((issue) => issue.code === "required").map((issue) => issue.field?.[0]);

    expect(required).toEqual(expect.arrayContaining(["description", "date", "author", "image"]));
    expect((await site.listEntries("blog")).total).toBe(5);
    expect((await site.model()).collections.find((collection) => collection.id === "blog")!.count).toBe(5);
    expect(of("site.updated").length).toBeGreaterThan(0);

    const taken = await rejects(site.createEntry({ collection: "pages", slug: "about", data: { title: "About" } }));

    expect(taken.code).toBe("conflict");
    expect(taken.message).toMatch(/^A page with that address already exists/);
    expect((await rejects(site.createEntry({ collection: "blog", slug: "spring-open-day", data: {} }))).code).toBe("conflict");
    expect((await rejects(site.createEntry({ collection: "blog", slug: "2026/nested", data: {} }))).code).toBe("invalid");
    expect((await rejects(site.createEntry({ collection: "site", slug: "x", data: {} }))).code).toBe("forbidden");
    expect((await rejects(site.createEntry({ collection: "nope", slug: "x", data: {} }))).code).toBe("not-found");

    await site.deleteEntry(created.path);
    expect(existsSync(join(root, created.path))).toBe(false);
    expect((await site.model()).collections.find((collection) => collection.id === "blog")!.count).toBe(4);
    expect((await rejects(site.deleteEntry("src/data/site.json"))).code).toBe("forbidden");
    expect((await site.changes()).files).toEqual([]);
  });
});

describe("search and click-to-edit", () => {
  it("searches the site's content", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const hits = await site.search("measured survey");

    expect(hits[0]).toMatchObject({ path: POST, collection: "blog", url: "/blog/measured-survey/" });
    expect((await site.search("measured survey", { collection: "team" })).every((hit) => hit.collection === "team")).toBe(true);
  });

  it("resolves real on-page text without guessing", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const unique = await site.resolveText({ urlPath: "/", text: "Four ways we usually help" });

    expect(unique.status).toBe("unique");
    expect(unique.matches[0]).toMatchObject({ path: HOME, plain: true, editable: true, location: { kind: "field", field: ["sections", 2, "heading"] } });

    // The heading is stored with *emphasis*; retyping the visible text would lose it.
    const hero = await site.resolveText({ urlPath: "/", text: "Make more of the home you already have." });

    expect(hero.status).toBe("unique");
    expect(hero.matches[0]).toMatchObject({ path: HOME, value: HERO_HEADING, plain: false });

    // "from, plus VAT" appears twice on the pricing page.
    const twice = await site.resolveText({ urlPath: "/pricing/", text: "from, plus VAT" });

    expect(twice.status).toBe("ambiguous");
    expect(twice.matches).toHaveLength(2);
    const second = await site.resolveText({ urlPath: "/pricing/", text: "from, plus VAT", occurrence: 1, total: 2 });

    expect(second.status).toBe("unique");
    expect(second.matches[0]!.location).toEqual(twice.matches[1]!.location);

    const label = await site.resolveText({ urlPath: "/blog/measured-survey/", text: "Back to the journal" });

    expect(label.status).toBe("unique");
    expect(label.matches[0]).toMatchObject({ path: "src/data/site.json", collection: "site", location: { field: ["labels", "blog", "backToBlog"] } });
    expect((await site.resolveText({ urlPath: "/", text: "Nothing on this site says this" })).status).toBe("none");
  });

  it("maps URLs to entries, with live status", async () => {
    const root = makeSite();
    const { site } = await openSite(root);

    expect(await site.entryForUrl("/")).toMatchObject({ path: HOME, status: "clean" });
    expect(await site.entryForUrl("/blog/measured-survey/")).toMatchObject({ path: POST, collection: "blog" });
    expect(await site.entryForUrl("/pricing")).toMatchObject({ path: PRICING });
    expect(await site.entryForUrl("/no-such-page/")).toBeNull();
    await site.updateEntry(HOME, [{ op: "set", path: ["title"], value: "Home, retitled" }]);
    expect(await site.entryForUrl("/")).toMatchObject({ path: HOME, status: "modified", title: "Home, retitled" });
    expect((await site.search("Home, retitled"))[0]?.path).toBe(HOME);
  });
});

describe("validation", () => {
  it("reports a broken image path and a broken internal link", async () => {
    const root = makeSite();
    const { site } = await openSite(root);

    expect((await site.validate()).length).toBe(0);
    const result = await site.updateEntry(HOME, [
      { op: "set", path: ["sections", 0, "image"], value: "/images/projects/not-there.svg" },
      { op: "set", path: ["sections", 0, "cta", "href"], value: "/no-such-page/" },
    ]);
    const codes = result.entry.issues.map((issue) => [issue.code, issue.field?.join(".")]);

    expect(codes).toEqual(expect.arrayContaining([["broken-image", "sections.0.image"], ["broken-link", "sections.0.cta.href"]]));
    const pending = await site.validate();

    expect(pending.map((issue) => issue.code).sort()).toEqual(["broken-image", "broken-link"]);
    expect(await site.validate([POST])).toEqual([]);
  });
});

describe("media", () => {
  it("saves an upload into the media library and lists it after content in the proof", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const item = await site.saveMedia({ filename: "Hero Shot.PNG", data: pngHeader(1200, 800) });

    expect(item).toMatchObject({ path: "public/images/hero-shot.png", url: "/images/hero-shot.png", width: 1200, height: 800, status: "added" });
    expect((await site.listMedia()).some((media) => media.path === item.path)).toBe(true);
    await site.updateEntry(HOME, [{ op: "set", path: ["sections", 0, "image"], value: item.url }]);
    const entry = await site.readEntry(HOME);

    expect(entry.issues.filter((issue) => issue.code === "broken-image")).toEqual([]);
    const files = (await site.changes()).files;

    expect(files.map((file) => [file.kind, file.path])).toEqual([
      ["content", HOME],
      ["media", item.path],
    ]);
    expect(files[1]!.summary).toBe("Added the image hero-shot.png");
  });
});

describe("files", () => {
  it("reads text with its hash, refuses binary as text, and keeps writes inside the mode", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const header = await site.readFile("src/components/Header.astro");

    expect(header.binary).toBe(false);
    expect(header.content).toContain("<header");
    await site.saveMedia({ filename: "x.png", data: pngHeader(2, 2) });
    expect((await rejects(site.readFile("public/images/x.png"))).code).toBe("invalid");
    expect((await rejects(site.writeFile("src/components/Header.astro", "x", { origin: "agent", mode: "content" }))).code).toBe("forbidden");
    await site.writeFile("src/components/Header.astro", `${header.content}\n`, { origin: "agent", mode: "build", baseHash: header.hash });
    expect((await rejects(site.writeFile("src/components/Header.astro", "y", { origin: "agent", mode: "build", baseHash: header.hash }))).code).toBe("conflict");
    expect((await rejects(site.writeFile(".env", "SECRET=1", { origin: "agent", mode: "build" }))).code).toBe("forbidden");
    expect((await site.listFiles({ glob: "src/components/*.astro" })).length).toBeGreaterThan(5);
  });
});

describe("checkpoints", () => {
  it("restores only the edits made while the checkpoint was open", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const home = read(root, HOME);
    const post = read(root, POST);

    await site.updateEntry(PRICING, [{ op: "set", path: ["title"], value: "Fees, outside the turn" }]);
    const checkpoint = site.checkpoint("assistant turn");

    await site.updateEntry(HOME, [{ op: "set", path: ["title"], value: "Changed inside the turn" }], { origin: "agent" });
    await site.updateEntry(POST, [{ op: "body-replace", find: "Houses are never quite square", replace: "Inside the turn" }], { origin: "agent" });
    checkpoint.close();
    await site.updateEntry(PRICING, [{ op: "set", path: ["description"], value: "Also outside the turn." }]);

    expect((await checkpoint.restore()).sort()).toEqual([POST, HOME].sort());
    expect(read(root, HOME)).toBe(home);
    expect(read(root, POST)).toBe(post);
    expect(read(root, PRICING)).toContain("Fees, outside the turn");
    expect(read(root, PRICING)).toContain("Also outside the turn.");
    expect((await site.changes()).files.map((file) => file.path)).toEqual([PRICING]);
    expect(await site.search("Changed inside the turn")).toEqual([]);
    expect((await site.entryForUrl("/"))?.status).toBe("clean");
  });
});

describe("edits made outside the app", () => {
  it("reports an external edit and updates the index from it", async () => {
    const root = makeSite();
    const { site, of } = await openSite(root, { watch: true });

    await site.search("warm the index");
    writeFileSync(join(root, HOME), read(root, HOME).replace("Four ways we usually help", "Seven quite unusual ways to help"));
    await until(() => of("changes.updated").some((event) => event.origin === "external" && event.paths.includes(HOME)), 10_000);
    const resolved = await site.resolveText({ urlPath: "/", text: "Seven quite unusual ways to help" });

    expect(resolved.status).toBe("unique");
    expect((await site.resolveText({ urlPath: "/", text: "Four ways we usually help" })).status).toBe("none");
    expect((await site.entryForUrl("/"))?.status).toBe("modified");
  });

  it("coalesces a burst of 300 external files into one change event and one recount", async () => {
    const root = makeSite();
    const { site, of } = await openSite(root, { watch: true });

    await site.search("warm the index");
    for (let i = 0; i < 300; i += 1) {
      writeFileSync(join(root, "src/content/blog", `burst-${i}.md`), `---\ntitle: Burst post ${i}\n---\n\nBody ${i}.\n`);
    }
    await until(() => of("changes.updated").length > 0, 10_000);
    // Give any straggling batch time to show up before counting.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const changes = of("changes.updated");

    expect(changes).toHaveLength(1);
    expect(changes[0]!.origin).toBe("external");
    expect(changes[0]!.paths).toHaveLength(300);
    expect(of("site.updated")).toHaveLength(1);
    expect((await site.model()).collections.find((collection) => collection.id === "blog")!.count).toBe(304);
    expect((await site.search("Burst post 299"))[0]?.path).toBe("src/content/blog/burst-299.md");
  });
});

describe("page templates and section pictures", () => {
  /** The starter with a landing-page template kept inside the pages folder, and a picture for the hero section. */
  function withTemplates(root: string, extra: Record<string, unknown> = {}): void {
    const config = JSON.parse(read(root, "galley.config.json")) as Record<string, unknown>;

    writeTree(root, {
      "src/content/pages/_templates/landing.md": "---\ntitle: Landing page\ndescription: A page for one offer.\nsections:\n  - type: hero\n    heading: Say what you offer\n---\nWrite a short introduction.\n",
      "galley/sections/hero.webp": pngHeader(8, 4),
      "galley/templates/landing.webp": pngHeader(8, 4),
    });
    const collections = (config.collections as Array<Record<string, unknown>>).map((entry) =>
      entry.id === "pages" ? { ...entry, fields: [{ key: "sections", blocks: [{ type: "hero", thumbnail: "galley/sections/hero.webp" }] }] } : entry
    );

    writeFileSync(
      join(root, "galley.config.json"),
      `${JSON.stringify({ ...config, collections, templates: [{ id: "landing", label: "Landing page", collection: "pages", file: "src/content/pages/_templates/landing.md", thumbnail: "galley/templates/landing.webp" }], ...extra }, null, 2)}\n`
    );
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Templates");
  }

  it("carries templates and section pictures into the model, and keeps template files out of the collection", async () => {
    const root = makeSite();
    const countBefore = (await (await openSite(root)).site.model()).collections.find((c) => c.id === "pages")!.count;

    await disposeAll();
    withTemplates(root);
    const { site } = await openSite(root);
    const model = await site.model();
    const pages = model.collections.find((c) => c.id === "pages")!;
    const hero = pages.fields.find((field) => field.key === "sections")?.blocks?.find((block) => block.type === "hero");

    expect(model.templates).toEqual([{ id: "landing", label: "Landing page", collection: "pages", file: "src/content/pages/_templates/landing.md", thumbnail: "galley/templates/landing.webp" }]);
    expect(hero?.thumbnail).toBe("galley/sections/hero.webp");
    expect(pages.count).toBe(countBefore);
    expect((await site.listEntries("pages")).items.map((item) => item.path)).not.toContain("src/content/pages/_templates/landing.md");
    expect(await site.search("Say what you offer")).toEqual([]);
    expect(model.notes.filter((note) => /doesn't exist|left out/.test(note))).toEqual([]);
  });

  it("notes missing files and templates for collections the site doesn't have, and still opens", async () => {
    const root = makeSite();

    withTemplates(root, {
      templates: [
        { id: "landing", label: "Landing page", collection: "pages", file: "src/content/pages/_templates/gone.md", thumbnail: "galley/none.webp" },
        { id: "recipe", label: "Recipe", collection: "recipes", file: "templates/recipe.md" },
      ],
    });
    sh(root, "rm", "-q", "galley/sections/hero.webp");
    sh(root, "commit", "-q", "-m", "Lose a picture");
    const model = await (await openSite(root)).site.model();

    expect(model.templates?.map((template) => template.id)).toEqual(["landing"]);
    expect(model.notes).toEqual(
      expect.arrayContaining([
        "The template “Landing page” points at src/content/pages/_templates/gone.md, which doesn't exist; it can't be used until that file is there.",
        "The picture of the template “Landing page” (galley/none.webp) doesn't exist.",
        "The template “Recipe” is for a “recipes” collection, which this site doesn't have, so it was left out.",
        "The picture of the “Hero” section (galley/sections/hero.webp) doesn't exist.",
      ])
    );
  });

  it("creates an entry from a template, in the template's own words and order, with the given values laid over it", async () => {
    const root = makeSite();

    withTemplates(root);
    const { site } = await openSite(root);
    const entry = await site.createEntry({ collection: "pages", slug: "spring-offer", data: { title: "Spring offer" }, template: "landing" });

    expect(entry.path).toBe("src/content/pages/spring-offer.md");
    expect(read(root, entry.path)).toBe("---\ntitle: Spring offer\ndescription: A page for one offer.\nsections:\n  - type: hero\n    heading: Say what you offer\n---\nWrite a short introduction.\n");
    const withBody = await site.createEntry({ collection: "pages", slug: "autumn-offer", data: { title: "Autumn offer", description: "Book before October." }, body: "Autumn slots are open.\n", template: "landing" });

    expect(read(root, withBody.path)).toBe("---\ntitle: Autumn offer\ndescription: Book before October.\nsections:\n  - type: hero\n    heading: Say what you offer\n---\nAutumn slots are open.\n");
    expect((await rejects(site.createEntry({ collection: "pages", slug: "x", data: {}, template: "nope" }))).message).toBe("That template isn't one of this site's templates.");
    expect((await rejects(site.createEntry({ collection: "blog", slug: "x", data: {}, template: "landing" }))).message).toBe("The template “Landing page” is for a different kind of entry, not a post.");
    // The template itself is untouched.
    expect(sh(root, "status", "--porcelain", "--", "src/content/pages/_templates")).toBe("");
  });

  it("keeps templates and pictures when the settings are saved, changing only what changed", async () => {
    const root = makeSite();

    withTemplates(root);
    const { site } = await openSite(root);
    const before = read(root, "galley.config.json");
    const config = (await site.readConfig())!;

    expect(config.templates?.[0]?.thumbnail).toBe("galley/templates/landing.webp");
    await site.saveConfig({ ...config, templates: [{ ...config.templates![0]!, label: "Landing" }] });
    expect(changedLines(before, read(root, "galley.config.json"))).toEqual({ removed: ['      "label": "Landing page",'], added: ['      "label": "Landing",'] });
    expect((await rejects(site.saveConfig({ ...config, templates: [config.templates![0]!, config.templates![0]!] }))).message).toContain("is used by another template too");
  });
});

describe("site settings", () => {
  it("saves the config file, refreshes the model and says so", async () => {
    const root = makeSite();
    const { site, of } = await openSite(root);
    const config = (await site.readConfig())!;
    const model = await site.saveConfig({ ...config, name: "Renamed Studio", build: { command: "npm run build", outDir: "dist" } });

    expect(model.name).toBe("Renamed Studio");
    expect((await site.model()).name).toBe("Renamed Studio");
    expect(JSON.parse(read(root, "galley.config.json"))).toMatchObject({ name: "Renamed Studio" });
    expect(of("site.updated").length).toBeGreaterThan(0);
    expect((await site.changes()).files).toMatchObject([{ path: "galley.config.json", kind: "config" }]);
    const invalid = await rejects(site.saveConfig({ collections: "nope" } as never));

    expect(invalid.code).toBe("invalid");
    expect(JSON.parse(read(root, "galley.config.json")).name).toBe("Renamed Studio");
  });

  it("changes only the lines a setting needs: one URL in the starter's config is a one-line diff", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const before = read(root, "galley.config.json");
    const config = (await site.readConfig())!;
    const collections = config.collections!.map((entry) => (entry.id === "blog" ? { ...entry, url: "/journal/{slug}/" } : entry));

    await site.saveConfig({ ...config, collections });
    const after = read(root, "galley.config.json");

    // Whatever shape the starter's file has, the one line holding the blog's address is the only one that changes.
    const line = before.split("\n").find((text) => text.includes('"/blog/{slug}/"'))!;

    expect(line).toBeDefined();
    expect(changedLines(before, after)).toEqual({ removed: [line], added: [line.replace("/blog/{slug}/", "/journal/{slug}/")] });
    // The other compact objects are untouched, byte for byte.
    expect(after.replace("/journal/{slug}/", "/blog/{slug}/")).toBe(before);
    expect((await site.model()).collections.find((c) => c.id === "blog")?.url).toBe("/journal/{slug}/");
  });

  it("adds, removes and reorders settings without rewriting the rest of the file", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const before = read(root, "galley.config.json");
    const config = (await site.readConfig())!;

    // A new setting goes in as new lines; nothing else moves.
    await site.saveConfig({ ...config, urls: { production: "https://studio.example.org" } });
    const added = read(root, "galley.config.json");

    expect(changedLines(before, added).removed).toEqual(["  ]"]);
    expect(JSON.parse(added).urls).toEqual({ production: "https://studio.example.org" });
    // Dropping a collection removes its line and only its line.
    await site.saveConfig({ ...config, urls: { production: "https://studio.example.org" }, collections: config.collections!.filter((c) => c.id !== "team") });
    const removed = read(root, "galley.config.json");

    expect(changedLines(added, removed)).toMatchObject({ removed: expect.arrayContaining([expect.stringContaining('"id": "team"')]) });
    // The blog's own lines are exactly as they were.
    const blogLines = (text: string) => text.split("\n").filter((line) => line.includes('"id": "blog"') || line.includes('"/blog/{slug}/"'));

    expect(blogLines(removed)).toEqual(blogLines(added));
    expect(blogLines(removed).length).toBeGreaterThan(0);
    // Saving what is already there changes nothing at all.
    await site.saveConfig((await site.readConfig())!);
    expect(read(root, "galley.config.json")).toBe(removed);
  });

  it("writes a new config file in the canonical form when there is none", async () => {
    const root = makeSite();

    sh(root, "rm", "-q", "galley.config.json");
    sh(root, "commit", "-q", "-m", "No config");
    const { site } = await openSite(root);

    await site.saveConfig({ name: "Fresh Start" });
    expect(read(root, "galley.config.json")).toBe(`{\n  "$schema": "https://galley.fictiontribe.com/schema/galley.config.json",\n  "name": "Fresh Start"\n}\n`);
  });

  it("refuses site-setting changes and builds from a build-mode caller when the site turns build mode off", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const config = (await site.readConfig())!;

    // The person, from the settings screen, may always turn it off (and on).
    await site.saveConfig({ ...config, ai: { ...config.ai, allowBuild: false } });
    const offConfig = (await site.readConfig())!;
    const message = "Build mode is turned off for this site, so only its content can be changed. The site's settings (ai.allowBuild) control it.";

    expect((await rejects(site.saveConfig({ ...offConfig, name: "Agent was here" }, { mode: "build" }))).message).toBe(message);
    expect((await rejects(site.saveConfig({ ...offConfig, name: "Agent was here" }, { mode: "content" }))).code).toBe("forbidden");
    expect((await rejects(site.writeFile("src/styles/agent.css", "body{}", { origin: "agent", mode: "build" }))).message).toBe(message);
    expect((await rejects(site.deleteFile("astro.config.ts", { origin: "agent", mode: "build" }))).message).toBe(message);
    expect((await rejects(site.build({ mode: "build" }))).message).toBe(message);
    expect(existsSync(join(root, "src/styles/agent.css"))).toBe(false);
    expect((await site.readConfig())?.name).toBe(offConfig.name);
    // Content-mode writes are unaffected.
    await site.updateEntry(POST, [{ op: "set", path: ["title"], value: "Still editable" }]);
  });

  it("reports what detection finds before the config file is applied", async () => {
    const root = makeSite();
    const { site } = await openSite(root);
    const [model, detected] = await Promise.all([site.model(), site.detected()]);

    expect(model.name).toBe("Lowfield Studio");
    expect(model.media.dir).toBe("public/images");
    expect(detected.name).not.toBe("Lowfield Studio");
    expect(detected.notes).not.toContain("Applied galley.config.json.");
    expect(detected.collections.find((c) => c.id === "blog")?.label).not.toBe("Journal");
    expect(detected.publish).toEqual(model.publish);
  });

  it("refuses to build a site with no build command, in plain words", async () => {
    const root = makeSite();
    const pkg = JSON.parse(read(root, "package.json")) as { scripts: Record<string, string> };

    delete pkg.scripts.build;
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));
    const { site } = await openSite(root);
    const error = await rejects(site.build());

    expect(error.code).toBe("unconfigured");
    expect(error.message).toMatch(/no build command/);
  });
});
