/**
 * How a move of the site's files is shown on the Media screen: its progress
 * while it runs, then how it ended, with what stayed and what went wrong.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { MediaMoveResult, MediaStorageStatus } from "@galley/core/media-storage/contract";
import type { Job } from "@galley/core/types";
import { MoveStatus } from "@/features/media/storage/MoveStatus";

const base: MediaMoveResult = { at: Date.now() - 60_000, request: { kind: "move", from: "repository", to: "bucket" }, state: "done", summary: "", copied: 28, pages: 14, removed: 12, stayed: [], stayedFiles: 0, problems: [] };
const status = (extra: Partial<MediaStorageStatus>): MediaStorageStatus => ({ bucket: {} as MediaStorageStatus["bucket"], images: {} as MediaStorageStatus["images"], cloudflare: { keyStored: false }, ...extra });
const shown = (extra: Partial<MediaStorageStatus>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(MoveStatus, { siteId: "site-1", status: status(extra) })))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("a move of the site's files on the Media screen", () => {
  it("shows a move that left files in the repository as done, with what stayed and no list of problems", () => {
    const summary =
      "28 files copied to Cloudflare R2, 14 pages updated, 12 removed from the repository. 16 left in the repository: still mentioned in src/layouts/Base.astro. Galley doesn't change the site's code or templates, so the files they use stay where they are. Publish to make it live.";
    const text = shown({ lastMove: { ...base, summary, stayedFiles: 16, stayed: [{ path: "public/favicon.svg", pages: ["src/layouts/Base.astro"] }] } });

    expect(text).toContain("The files were moved to the bucket");
    expect(text).toContain(summary);
    expect(text).toContain("The 16 files that stayed");
    expect(text).toContain("public/favicon.svg: still mentioned in src/layouts/Base.astro");
    expect(text).toContain("and 15 more");
    expect(text).toContain("Review in Proof");
    expect(text).not.toMatch(/problem|went wrong/i);
  });

  it("lists what went wrong right under the count", () => {
    const text = shown({ lastMove: { ...base, state: "error", summary: "27 files copied to Cloudflare R2, 14 pages updated. 1 problem — see the list. Publish to make it live.", problems: [{ path: "public/images/a.png", reason: "A different file is already in Cloudflare R2 as “a.png”, so this one stays in the repository." }] } });

    expect(text).toContain("The move finished with 1 problem");
    expect(text).toContain("1 problem — see the list.");
    expect(text).toContain("public/images/a.png: A different file is already in Cloudflare R2 as “a.png”, so this one stays in the repository.");
  });

  it("shows a move that is running instead of how the last one ended, and nothing when there has been none", () => {
    const moving: Job = { id: "job-1", kind: "media", label: "Moving media to the bucket", state: "running", progress: 0.25, detail: "Copying 7 of 28: hero-house.svg", siteId: "site-1", startedAt: Date.now() };
    const text = shown({ moving, lastMove: { ...base, summary: "An earlier move." } });

    expect(text).toContain("Moving media to the bucket");
    expect(text).toContain("Copying 7 of 28: hero-house.svg");
    expect(text).not.toContain("An earlier move.");
    expect(shown({})).toBe("");
  });
});
