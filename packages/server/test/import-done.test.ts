/** The line a finished WordPress import ends on. */
import { describe, expect, it } from "vitest";
import { doneMessage } from "../src/import";

const arrived = { posts: 0, pages: 6, images: 0, updated: 0, unchanged: 0, embeds: 0 };

describe("the import's last line", () => {
  it("says what is waiting in Proof", () => {
    expect(doneMessage({ arrived, notImported: [] })).toBe("Done. 0 posts, 6 pages and 0 images are waiting in Proof.");
  });

  it("says when entries were left out, and that the report says why", () => {
    const left = [1, 2, 3].map((n) => ({ title: `Post ${n}`, note: "Every post in Journal needs an image." }));

    expect(doneMessage({ arrived, notImported: left })).toBe("Done. 0 posts, 6 pages and 0 images are waiting in Proof. 3 entries were left out; the report says why.");
    expect(doneMessage({ arrived, notImported: left.slice(0, 1) })).toMatch(/ 1 entry was left out; the report says why\.$/);
  });
});
