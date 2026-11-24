import { describe, expect, it } from "vitest";
import type { PageDrawState } from "@galley/core/types";
import { declineKind, declineWords, failureCause } from "@/features/builder/declined";

const drawn: PageDrawState = { state: "drawn", status: 200, message: null };
const failed: PageDrawState = { state: "failed", status: 500, message: "ENOENT: no such file or directory, open '/site/public/video/-poster.webp'" };
const unavailable: PageDrawState = { state: "unavailable", status: 502, message: null };
const added = { what: "adding a Film section", at: 2000, path: ["sections"], index: 3 };
const moved = { what: "moving “Hero”", at: 2000, path: ["sections"], index: null };

describe("why a page can't be arranged", () => {
  it("tells the four cases apart", () => {
    expect(declineKind("unmarked", drawn)).toBe("unmarked");
    expect(declineKind("unmarked", null)).toBe("unmarked");
    expect(declineKind("page-failed", null)).toBe("failed");
    expect(declineKind(null, failed)).toBe("failed");
    expect(declineKind("preview-unavailable", null)).toBe("unavailable");
    expect(declineKind(null, unavailable)).toBe("unavailable");
    expect(declineKind("mismatch", drawn)).toBe("other");
    expect(declineKind("page-missing", { state: "missing", status: 404, message: null })).toBe("other");
    // An older overlay that says no cause is not taken for an unmarked site.
    expect(declineKind(null, null)).toBe("other");
    expect(declineKind(undefined, drawn)).toBe("other");
  });

  it("never reports a page that failed to draw as unmarked, whatever the sections said", () => {
    expect(declineKind("unmarked", failed)).toBe("failed");
    expect(declineKind("unmarked", unavailable)).toBe("unavailable");
    expect(declineWords(declineKind("unmarked", failed)).body).not.toMatch(/marked/);
  });

  it("blames the change the failure began with, only when the page drew before it", () => {
    expect(failureCause(added, 1000)).toBe(added);
    expect(failureCause(added, 2000)).toBe(added);
    // Drawn again after the change: something later broke it, not this.
    expect(failureCause(added, 3000)).toBeNull();
    // Never seen drawn (opened already failing): nothing to blame.
    expect(failureCause(added, null)).toBeNull();
    expect(failureCause(null, 1000)).toBeNull();
  });

  it("says each case in its own plain sentences", () => {
    expect(declineWords("unmarked")).toEqual({
      title: "Sections can’t be arranged on this page.",
      body: "This site hasn’t marked its sections for arranging on the page, and they can’t be told apart for certain here. The form’s section list still works: add, move and remove them there.",
    });
    expect(declineWords("failed", { after: added })).toEqual({
      title: "This page couldn’t be drawn.",
      body: "It stopped drawing after adding a Film section. Undo takes the section away again, or fill it in using the form. Your other changes are safe.",
    });
    expect(declineWords("failed", { after: moved }).body).toBe("It stopped drawing after moving “Hero”. Undo puts the page back as it was. Your other changes are safe.");
    expect(declineWords("failed").body).toBe("The site ran into a problem drawing this page, so its sections can’t be arranged here. Your changes are safe, and the form still works.");
    expect(declineWords("unavailable").title).toBe("The preview isn’t answering.");
    expect(declineWords("other", { cause: "page-missing" }).title).toBe("This page isn’t in the preview.");
    expect(declineWords("other", { cause: "mismatch" }).body).toMatch(/don’t match/);
    // Plain words only, no exclamation marks.
    for (const kind of ["unmarked", "failed", "unavailable", "other"] as const) {
      const words = declineWords(kind, { after: added });
      expect(`${words.title} ${words.body}`).not.toMatch(/!|block|schema|commit|500/);
    }
  });
});
