import { describe, expect, it } from "vitest";
import { versionNote } from "../../src/screens/history/note";

describe("a version's note", () => {
  it("keeps an undo's version id out of sight, for Technical details", () => {
    const note = versionNote("Undo “Update the home page”\n\nThis reverts commit 3f2a9c1d0e8b7a6f5e4d3c2b1a0f9e8d7c6b5a49.");

    expect(note).toEqual({ title: "Undo “Update the home page”", body: "", technical: ["This reverts commit 3f2a9c1d0e8b7a6f5e4d3c2b1a0f9e8d7c6b5a49."] });
  });

  it("shows any other lines of the note under its title", () => {
    expect(versionNote("New prices\n\nSpring rates for every plan.")).toEqual({ title: "New prices", body: "Spring rates for every plan.", technical: [] });
    expect(versionNote("Just a title")).toEqual({ title: "Just a title", body: "", technical: [] });
  });
});
