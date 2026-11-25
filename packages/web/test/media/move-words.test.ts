import { describe, expect, it } from "vitest";
import type { MediaMovePlan, MediaMoveResult } from "@galley/core/media-storage/contract";
import { alsoMentionedWords, moveTitle, planWords, stayedLabel, stayedLine } from "@/features/media/storage/moveWords";

const base: MediaMoveResult = { at: 0, request: { kind: "move", from: "repository", to: "bucket" }, state: "done", summary: "", copied: 28, pages: 14, removed: 12, stayed: [], stayedFiles: 0, problems: [] };

describe("the words for how a move of the site's files ended", () => {
  it("heads a move that worked by where the files went", () => {
    expect(moveTitle(base)).toBe("The files were moved to the bucket");
    expect(moveTitle({ ...base, request: { kind: "move", from: "repository", to: "images" } })).toBe("The pictures were moved to Cloudflare Images");
    expect(moveTitle({ ...base, request: { kind: "move", from: "bucket", to: "repository" } })).toBe("The files are back in the repository");
    expect(moveTitle({ ...base, request: { kind: "address", store: "bucket", publicUrl: "https://media.example.com" } })).toBe("The files’ address was changed");
  });

  it("heads one that went wrong by what went wrong, counting only real problems", () => {
    const problem = { path: "public/images/a.png", reason: "A different file is already in Cloudflare R2 as “a.png”, so this one stays in the repository." };

    expect(moveTitle({ ...base, state: "error", problems: [problem] })).toBe("The move finished with 1 problem");
    expect(moveTitle({ ...base, state: "error", problems: [problem, problem] })).toBe("The move finished with 2 problems");
    expect(moveTitle({ ...base, state: "error" })).toBe("The move stopped");
    expect(moveTitle({ ...base, state: "error", request: { kind: "address", store: "bucket", publicUrl: "https://media.example.com" } })).toBe("The address wasn’t changed");
  });

  it("names the files that stayed and what still uses each", () => {
    expect(stayedLabel({ stayedFiles: 1 })).toBe("The file that stayed");
    expect(stayedLabel({ stayedFiles: 16 })).toBe("The 16 files that stayed");
    expect(stayedLine({ path: "public/favicon.svg", pages: ["src/layouts/Base.astro", "galley/templates/project.md"] })).toBe("public/favicon.svg: still used by src/layouts/Base.astro, galley/templates/project.md");
  });

  it("says which file reads one that is outside the folders the site is built from", () => {
    const readBy = { "data/team.json": ["src/lib/team.ts"] };

    expect(stayedLine({ path: "public/images/team/lead.webp", pages: ["data/team.json", "src/layouts/Base.astro"] }, readBy)).toBe(
      "public/images/team/lead.webp: still used by data/team.json (read by src/lib/team.ts), src/layouts/Base.astro"
    );
    expect(stayedLine({ path: "public/images/team/lead.webp", pages: ["data/team.json"] }, { "data/team.json": ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"] })).toBe(
      "public/images/team/lead.webp: still used by data/team.json (read by src/a.ts, src/b.ts and 2 more)"
    );
  });
});

describe("what a move says it will do, before it does anything", () => {
  const plan: MediaMovePlan = { kind: "move", from: "repository", to: "bucket", files: 31, bytes: 2_500_000, removes: 31, references: 40, pages: 12, done: 0, problems: [], keepCopies: false };
  const templates = ["galley/templates/about.md", "galley/templates/story.md"];
  const stay = (count: number, pages: string[]) => Array.from({ length: count }, (_, index) => ({ path: `public/images/p-${index}.webp`, pages }));

  it("removes every copy when nothing still mentions one", () => {
    expect(planWords(plan)).toBe("31 files (2.4 MB) will be copied to the bucket. 40 places in 12 pages will point at their full addresses. Then the repository’s copies are removed; they leave the site when you publish.");
  });

  it("counts the page templates it updates beside the pages", () => {
    expect(planWords({ ...plan, templates: 4 })).toContain("40 places in 12 pages and 4 page templates will point at their full addresses.");
    expect(planWords({ ...plan, references: 1, pages: 1, templates: 1 })).toContain("1 place in 1 page and 1 page template will point at their full addresses.");
  });

  it("counts what is removed and what stays, names what keeps them, and says what to do about it", () => {
    const words = planWords({ ...plan, removes: 29, stillMentioned: stay(2, ["src/layouts/Base.astro"]), leftAlone: ["src/layouts/Base.astro"] });

    expect(words).toContain(
      "Then 29 of the repository’s copies are removed (they leave the site when you publish) and 2 stay: still used by src/layouts/Base.astro. The site is built from that file and a move doesn’t change it. To move what it uses too, put the new addresses there by hand or in build mode, then run the move again."
    );
    // A file outside the site's folders that its source reads is named with the file that reads it.
    expect(planWords({ ...plan, removes: 30, stillMentioned: stay(1, ["data/team.json"]), leftAlone: ["data/team.json"], readBy: { "data/team.json": ["src/lib/team.ts"] } })).toContain(
      "and 1 stays: still used by data/team.json (read by src/lib/team.ts). The site is built from that file and a move doesn’t change it."
    );
    const using = ["src/data/shop/catalogue.json", "src/layouts/Base.astro"];

    expect(planWords({ ...plan, files: 52, removes: 30, stillMentioned: stay(22, using), leftAlone: using })).toContain(
      "and 22 stay: still used by src/data/shop/catalogue.json, src/layouts/Base.astro. The site is built from those files and a move doesn’t change them. To move what they use too, put the new addresses there by hand or in build mode, then run the move again."
    );
    // Past five, the rest are counted.
    const many = ["a.astro", "b.astro", "c.astro", "d.astro", "e.astro", "f.astro", "g.astro"].map((name) => `src/${name}`);

    expect(planWords({ ...plan, removes: 11, stillMentioned: stay(20, many), leftAlone: many })).toContain("and 20 stay: still used by src/a.astro, src/b.astro, src/c.astro, src/d.astro, src/e.astro and 2 more.");
    expect(planWords({ ...plan, removes: 1, stillMentioned: stay(1, ["src/content/pages/about.md"]) })).toContain("Then 1 of the repository’s copies is removed (it leaves the site when you publish) and 1 stays: still used by src/content/pages/about.md.");
  });

  it("lists on a line of its own the files that name a picture and that nothing the site is built from reads, and says what to do if one is read after all", () => {
    expect(alsoMentionedWords({ ...plan, alsoMentioned: ["README.md", "galley/photography/shots.json", "scripts/gallery/sections.md"] })).toBe(
      "Also mentioned in README.md, galley/photography/shots.json, scripts/gallery/sections.md. Nothing the site is built from reads them, as far as Galley can follow, so they aren’t changed and keep no copy. If the build does read one, name it in build.sources first."
    );
    expect(alsoMentionedWords({ ...plan, alsoMentioned: ["README.md"] })).toBe(
      "Also mentioned in README.md. Nothing the site is built from reads it, as far as Galley can follow, so it isn’t changed and keeps no copy. If the build does read it, name it in build.sources first."
    );
    expect(alsoMentionedWords(plan)).toBeNull();
    expect(alsoMentionedWords({ ...plan, alsoMentioned: [] })).toBeNull();
    // It is not folded into the sentences about the copies.
    expect(planWords({ ...plan, alsoMentioned: ["README.md"] })).not.toContain("README.md");
  });

  it("says so plainly when none will be removed", () => {
    const words = planWords({ ...plan, removes: 0, stillMentioned: stay(31, ["src/pages/gallery.astro"]), leftAlone: ["src/pages/gallery.astro"] });

    expect(words).toContain("None of the repository’s copies are removed: all 31 are still used by src/pages/gallery.astro. The site is built from that file and a move doesn’t change it.");
    expect(words).not.toContain("Then the repository’s copies are removed");
    expect(planWords({ ...plan, files: 1, removes: 0, stillMentioned: stay(1, ["src/content/pages/about.md"]) })).toContain("None of the repository’s copies are removed: the file is still used by src/content/pages/about.md.");
  });

  it("says what to do only when a file a move doesn't change is among those named", () => {
    expect(planWords({ ...plan, removes: 30, stillMentioned: stay(1, ["src/content/pages/about.md"]) })).not.toContain("build mode");
  });

  it("keeps the other moves' words: copies kept, back to the repository, a new address", () => {
    expect(planWords({ ...plan, keepCopies: true, removes: 0 })).toContain("The repository keeps its copies.");
    expect(planWords({ ...plan, from: "bucket", to: "repository", removes: 0, keepCopies: true })).toContain("The bucket keeps its files; remove them once the pages are published.");
    expect(planWords({ ...plan, kind: "address", store: "bucket", publicUrl: "https://media.example.com", files: 0, removes: 0, keepCopies: true })).toBe(
      "40 places in 12 pages will use https://media.example.com instead. Galley first checks the new address serves the bucket’s files; nothing changes if it doesn’t."
    );
  });
});
