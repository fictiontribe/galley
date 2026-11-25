import { describe, expect, it } from "vitest";
import type { MediaMoveResult } from "@galley/core/media-storage/contract";
import { moveTitle, stayedLabel, stayedLine } from "@/features/media/storage/moveWords";

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
