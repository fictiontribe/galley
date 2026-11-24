import { describe, expect, it } from "vitest";
import { DESK, PLATE, QUIET, checkTheme, darkFromLight } from "@galley/core/themes";
import { listThemes } from "@/lib/themes/catalog";
import { chosenLookId, lookFromServer, lookSavesToServer, shownLook } from "@/lib/themes/choice";
import { freeId, freeName, readColour, themeFrom, withOwnDark, withSeed } from "@/features/themes/model";

const applied = (theme: typeof QUIET) => checkTheme(theme).applied!;
const themes = listThemes({ saved: [], plugins: [], mine: [], community: [] });

describe("which theme shows", () => {
  it("in local mode: the server's (this browser's copy of it)", () => {
    expect(chosenLookId("server", { look: "plate", chosen: false })).toBe("plate");
    expect(shownLook({ keeper: "server", preview: null, local: { look: "plate", chosen: false }, fallback: applied(QUIET), themes })?.id).toBe("plate");
  });
  it("on a hosted install: the install's default until the person chooses, then theirs", () => {
    const fallback = applied(DESK);
    expect(shownLook({ keeper: "browser", preview: null, local: { look: "plate", chosen: false }, fallback, themes })?.id).toBe("desk");
    expect(shownLook({ keeper: "browser", preview: null, local: { look: "plate", chosen: true }, fallback, themes })?.id).toBe("plate");
  });
  it("an edit in progress, in this browser, over everything", () => {
    const preview = applied({ ...QUIET, id: "draft", name: "Draft" });
    expect(shownLook({ keeper: "browser", preview, local: { look: "plate", chosen: true }, fallback: null, themes })?.id).toBe("draft");
  });
  it("a chosen theme that is gone gives way to the default", () => {
    expect(shownLook({ keeper: "browser", preview: null, local: { look: "deleted", chosen: true }, fallback: applied(PLATE), themes })?.id).toBe("plate");
  });
  it("follows the server's default only where the server keeps the theme", () => {
    expect(lookFromServer("server", "desk", { look: "plate", chosen: false })).toBe("desk");
    expect(lookFromServer("server", "plate", { look: "plate", chosen: false })).toBeUndefined();
    expect(lookFromServer("browser", "desk", { look: "plate", chosen: true })).toBeUndefined();
    expect(lookSavesToServer("server", true)).toBe(true);
    expect(lookSavesToServer("browser", true)).toBe(false);
  });
  it("lists every theme once, built-ins first and the community's last", () => {
    const listed = listThemes({ saved: [{ ...QUIET, id: "mine-too", name: "Saved" }], plugins: [], mine: [{ ...QUIET, id: "mine-too", name: "Mine" }, { ...QUIET, id: "only-mine", name: "Only mine" }], community: [{ ...QUIET, id: "harbour", name: "Harbour" }, { ...QUIET, id: "quiet", name: "Fake Quiet" }] });
    expect(listed.map((entry) => `${entry.origin}:${entry.theme.id}`)).toEqual(["builtin:quiet", "builtin:plate", "builtin:desk", "saved:mine-too", "mine:only-mine", "community:harbour"]);
  });
});

describe("the editor's model", () => {
  it("reads a typed colour in the forms people write, and nothing else", () => {
    expect(readColour("#f6f4f0")).toBe("#F6F4F0");
    expect(readColour("f6f4f0")).toBe("#F6F4F0");
    expect(readColour("rgb(246 244 240)")).toBe("#F6F4F0");
    expect(readColour("oklch(0.5 0.1 200)")).toMatch(/^#[0-9A-F]{6}$/);
    for (const bad of ["var(--x)", "url(x)", "red; x", "#12345", "#F6F4F080", "", "calc(1)"]) expect(readColour(bad), bad).toBeNull();
  });
  it("makes a theme from another: same colours and switches, a free name and id, no author", () => {
    const made = themeFrom({ ...PLATE, author: "Someone" }, { ids: ["quiet", "plate", "plate-copy"], names: ["Plate copy"] });
    expect(made.name).toBe("Plate copy 2");
    expect(made.id).toBe("plate-copy-2");
    expect(made.author).toBeUndefined();
    expect(made.light).toEqual(PLATE.light);
    expect(made.switches).toEqual(PLATE.switches);
    expect(freeId("Plate", ["plate"])).toBe("plate-2");
    expect(freeName("x".repeat(40), [])).toHaveLength(40);
  });
  it("moves a dark pencil that was the same as the light one, and leaves one set apart", () => {
    expect(withSeed(QUIET, "light", "pencil", "#0F766E").dark?.pencil).toBe("#0F766E");
    expect(withSeed({ ...QUIET, dark: { ...QUIET.dark!, pencil: "#FF0000" } }, "light", "pencil", "#0F766E").dark?.pencil).toBe("#FF0000");
    expect(withSeed(QUIET, "light", "paper", "#FFFFFF").dark?.paper).toBe(QUIET.dark?.paper);
  });
  it("turns own dark colours on from the derived ones, and off again", () => {
    const { dark: _dark, ...noDark } = QUIET;
    expect(withOwnDark(noDark, true).dark).toEqual(darkFromLight(QUIET.light));
    expect(withOwnDark(QUIET, false).dark).toBeUndefined();
  });
});
