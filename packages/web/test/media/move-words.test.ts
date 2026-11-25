import { describe, expect, it } from "vitest";
import type { MediaMovePlan, MediaMoveResult } from "@galley/core/media-storage/contract";
import { moveTitle, planWords, stayedLabel, stayedLine } from "@/features/media/storage/moveWords";

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

  it("names the files that stayed and where each is still mentioned", () => {
    expect(stayedLabel({ stayedFiles: 1 })).toBe("The file that stayed");
    expect(stayedLabel({ stayedFiles: 16 })).toBe("The 16 files that stayed");
    expect(stayedLine({ path: "public/favicon.svg", pages: ["src/layouts/Base.astro", "galley/templates/project.md"] })).toBe("public/favicon.svg: still mentioned in src/layouts/Base.astro, galley/templates/project.md");
  });
});

describe("what a move says it will do, before it does anything", () => {
  const plan: MediaMovePlan = { kind: "move", from: "repository", to: "bucket", files: 31, bytes: 2_500_000, removes: 31, references: 40, pages: 12, done: 0, problems: [], keepCopies: false };
  const templates = ["galley/templates/about.md", "galley/templates/story.md"];
  const stay = (count: number, pages: string[]) => Array.from({ length: count }, (_, index) => ({ path: `public/images/p-${index}.webp`, pages }));

  it("removes every copy when nothing still mentions one", () => {
    expect(planWords(plan)).toBe("31 files (2.4 MB) will be copied to the bucket. 40 places in 12 pages will point at their full addresses. Then the repository’s copies are removed; they leave the site when you publish.");
  });

  it("counts what is removed and what stays, and names every file that keeps them, as the result will", () => {
    const mentioning = ["README.md", "galley/photography/shots.json", ...templates, "scripts/gallery/sections.md", "src/layouts/Base.astro", "src/z.astro"];
    const words = planWords({ ...plan, removes: 11, stillMentioned: stay(20, mentioning), leftAlone: [...templates, "src/layouts/Base.astro"] });

    expect(words).toContain(
      "Then 11 of the repository’s copies are removed (they leave the site when you publish) and 20 stay: still mentioned in README.md, galley/photography/shots.json, galley/templates/about.md, galley/templates/story.md, scripts/gallery/sections.md and 2 more. Galley doesn’t change the site’s code or templates, so the files they use stay where they are."
    );
    expect(planWords({ ...plan, removes: 1, stillMentioned: stay(1, ["README.md"]) })).toContain("Then 1 of the repository’s copies is removed (it leaves the site when you publish) and 1 stays: still mentioned in README.md.");
  });

  it("says so plainly when none will be removed", () => {
    const words = planWords({ ...plan, removes: 0, stillMentioned: stay(31, ["galley/templates/about.md"]), leftAlone: ["galley/templates/about.md"] });

    expect(words).toContain("None of the repository’s copies are removed: all 31 are still mentioned in galley/templates/about.md. Galley doesn’t change the site’s code or templates, so the files they use stay where they are.");
    expect(words).not.toContain("Then the repository’s copies are removed");
    expect(planWords({ ...plan, files: 1, removes: 0, stillMentioned: stay(1, ["notes.md"]) })).toContain("None of the repository’s copies are removed: the file is still mentioned in notes.md.");
  });

  it("gives the reason only when code or templates are among the files named", () => {
    expect(planWords({ ...plan, removes: 30, stillMentioned: stay(1, ["src/content/pages/about.md"]) })).not.toContain("code or templates");
  });

  it("keeps the other moves' words: copies kept, back to the repository, a new address", () => {
    expect(planWords({ ...plan, keepCopies: true, removes: 0 })).toContain("The repository keeps its copies.");
    expect(planWords({ ...plan, from: "bucket", to: "repository", removes: 0, keepCopies: true })).toContain("The bucket keeps its files; remove them once the pages are published.");
    expect(planWords({ ...plan, kind: "address", store: "bucket", publicUrl: "https://media.example.com", files: 0, removes: 0, keepCopies: true })).toBe(
      "40 places in 12 pages will use https://media.example.com instead. Galley first checks the new address serves the bucket’s files; nothing changes if it doesn’t."
    );
  });
});
