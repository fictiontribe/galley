import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { roleMayCall, ACCOUNT_ROLES } from "../../src/install";
import { QUIET, PLATE, checkTheme, communityShareUrl, defaultTheme, knownThemes, themeFileText } from "../../src/themes";
import { createThemeStore } from "../../src/themes/store";
import { FOG, HARBOUR } from "./fixtures";

const homes: string[] = [];
afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));
const home = () => {
  const dir = mkdtempSync(join(tmpdir(), "galley-theme-store-"));
  homes.push(dir);
  return dir;
};

describe("the theme store", () => {
  it("keeps themes in the data folder's themes/, adjusted, one file each", async () => {
    const dir = home();
    const store = createThemeStore({ home: dir });
    const check = await store.save(FOG);
    expect(readdirSync(join(dir, "themes"))).toEqual(["fog.json"]);
    expect(await store.get("fog")).toEqual(check.theme);
    expect((await store.get("fog"))?.light.paper).not.toBe(FOG.light.paper);
    expect(await store.list()).toEqual([check.theme]);
  });

  it("refuses built-in ids, refused themes and a mismatched id, and never reads outside its folder", async () => {
    const store = createThemeStore({ home: home() });
    await expect(store.save({ ...FOG, id: "plate" })).rejects.toMatchObject({ code: "conflict" });
    await expect(store.save({ ...FOG, light: { ...FOG.light, pencil: "#808080" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(store.save(FOG, { id: "other" })).rejects.toMatchObject({ code: "invalid" });
    expect(await store.get("../settings")).toBeNull();
    expect(await store.remove("../settings")).toBe(false);
  });

  it("leaves out a file that no longer passes, or whose name isn't its id", async () => {
    const dir = home();
    const store = createThemeStore({ home: dir });
    await store.save(HARBOUR);
    writeFileSync(join(dir, "themes", "broken.json"), "{ not json");
    writeFileSync(join(dir, "themes", "elsewhere.json"), themeFileText({ ...HARBOUR, id: "harbour" }));
    expect((await store.list()).map((theme) => theme.id)).toEqual(["harbour"]);
    expect(await store.remove("harbour")).toBe(true);
    expect(await store.list()).toEqual([]);
  });
});

describe("which themes an install has, and its default", () => {
  const saved = [checkTheme(FOG).theme!];
  it("lists built-ins first, then saved, then plugins', each id once", () => {
    const known = knownThemes({ saved: [...saved, { ...QUIET, name: "Not Quiet" }], plugins: [{ plugin: "p", theme: { ...HARBOUR } }, { plugin: "q", theme: { ...saved[0]!, name: "Shadow" } }] });
    expect(known.map((entry) => `${entry.source}:${entry.theme.id}`)).toEqual(["builtin:quiet", "builtin:plate", "builtin:desk", "saved:fog", "plugin:harbour"]);
    expect(known[0]!.theme.name).toBe("Quiet");
  });
  it("is App settings' choice, else the brand's, else Quiet; a choice that is gone falls through", () => {
    expect(defaultTheme("fog", { saved }).theme.id).toBe("fog");
    expect(defaultTheme("gone", { saved, brand: { theme: "plate" } }).theme.id).toBe("plate");
    expect(defaultTheme(null, { saved, brand: { theme: "gone" } }).theme.id).toBe("quiet");
    expect(defaultTheme(null, { saved, brand: { accent: "#0F766E" } }).theme.light.pencil).toBe("#0F766E");
  });
});

describe("Share with the community", () => {
  it("is GitHub's new-file page for the themes folder, with the name and the file filled in", () => {
    const theme = checkTheme(PLATE).theme!;
    const url = new URL(communityShareUrl({ ...theme, id: "my-plate", name: "My Plate & co" }));
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/fictiontribe/galley/new/main/themes");
    expect(url.searchParams.get("filename")).toBe("my-plate.json");
    const file = JSON.parse(url.searchParams.get("value")!);
    expect(file.name).toBe("My Plate & co");
    expect(checkTheme(file).ok).toBe(true);
    expect(communityShareUrl(theme)).not.toContain("+");
    expect(communityShareUrl(theme).length).toBeLessThan(2000);
  });
});

describe("who may do what with themes (hosted)", () => {
  const rows: Array<[string, Record<(typeof ACCOUNT_ROLES)[number], boolean>]> = [
    ["GET /api/themes", { owner: true, editor: true, contributor: true }],
    ["PUT /api/themes/:themeId", { owner: true, editor: false, contributor: false }],
    ["DELETE /api/themes/:themeId", { owner: true, editor: false, contributor: false }],
    // The default theme is a setting of the install.
    ["PATCH /api/settings", { owner: true, editor: false, contributor: false }],
  ];
  for (const [route, expected] of rows) {
    for (const role of ACCOUNT_ROLES) {
      it(`${role}: ${route} ${expected[role] ? "allowed" : "refused"}`, () => {
        expect(roleMayCall(role, route as Parameters<typeof roleMayCall>[1])).toBe(expected[role]);
      });
    }
  }
});

describe("the default theme in settings.json", () => {
  it("a value that isn't a theme's id is ignored on its own: the rest of the file is kept, and stays after the next save", async () => {
    const { createSettingsService } = await import("../../src/ai/settings");
    const dir = home();
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ ai: { effort: "high" }, author: { name: "Sam", email: "sam@example.com" }, appearance: { theme: "dark", look: "Not An Id!" } }));
    const settings = createSettingsService({ home: dir, env: {} });
    const read = await settings.get();
    expect(read.ai.effort).toBe("high");
    expect(read.appearance).toEqual({ theme: "dark" });
    expect(await settings.look!()).toBeUndefined();
    await settings.update({ ai: { effort: "low" } });
    const after = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(after.author).toEqual({ name: "Sam", email: "sam@example.com" });
    expect(after.appearance.theme).toBe("dark");
    for (const look of ["con", "x".repeat(40)]) await expect(settings.update({ appearance: { look } })).rejects.toMatchObject({ code: "invalid" });
  });
});
