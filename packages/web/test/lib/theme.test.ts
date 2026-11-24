import { describe, expect, it } from "vitest";
import { THEME_ACTION, THEME_OPTIONS, oneClickTheme, savesToServer, shownTheme, themeCommands, themeFromSettings, themeFromStorage, themeKeeper, type ThemeSetting } from "../../src/lib/theme";

describe("one click on the theme switch", () => {
  it("goes from light to dark and from dark to light, whatever the computer is set to", () => {
    for (const systemDark of [false, true]) {
      expect(oneClickTheme("light", systemDark)).toBe("dark");
      expect(oneClickTheme("dark", systemDark)).toBe("light");
    }
  });

  it("from match my system, goes to the opposite of what is showing", () => {
    expect(oneClickTheme("system", false)).toBe("dark");
    expect(oneClickTheme("system", true)).toBe("light");
  });

  it("always changes what the person sees", () => {
    for (const setting of ["light", "dark", "system"] as ThemeSetting[]) {
      for (const systemDark of [false, true]) expect(shownTheme(oneClickTheme(setting, systemDark), systemDark)).not.toBe(shownTheme(setting, systemDark));
    }
  });

  it("is named for what it will do", () => {
    expect(THEME_ACTION[oneClickTheme("light", false)]).toBe("Switch to dark theme");
    expect(THEME_ACTION[oneClickTheme("system", true)]).toBe("Switch to light theme");
  });
});

describe("whose choice the theme is", () => {
  it("is the server's in local mode and the desktop app, and the browser's on a hosted install", () => {
    expect(themeKeeper({ mode: "local" })).toBe("server");
    expect(themeKeeper({ mode: "hosted" })).toBe("browser");
    // Before the app knows where it is, nothing is sent anywhere it shouldn't be: the server keeps it, as it always has.
    expect(themeKeeper(null)).toBe("server");
  });

  it("follows the server's setting in local mode, so another window's change shows here", () => {
    expect(themeFromSettings("server", "dark", { theme: "light", chosen: true })).toBe("dark");
    expect(themeFromSettings("server", "dark", { theme: "light", chosen: false })).toBe("dark");
    expect(themeFromSettings("server", "light", { theme: "light", chosen: true })).toBeNull();
  });

  it("on a hosted install, starts from the install's setting until the person chooses, and never overrides their choice", () => {
    expect(themeFromSettings("browser", "dark", { theme: "system", chosen: false })).toBe("dark");
    expect(themeFromSettings("browser", "dark", { theme: "light", chosen: true })).toBeNull();
    expect(themeFromSettings("browser", "system", { theme: "dark", chosen: true })).toBeNull();
  });

  it("saves to the server only where the server keeps it, once signed in, and only a change to what was showing", () => {
    expect(savesToServer("server", true, "dark", "light")).toBe(true);
    expect(savesToServer("server", true, "dark", "system")).toBe(true);
    expect(savesToServer("server", true, "dark", "dark")).toBe(false);
    expect(savesToServer("server", false, "dark", "light")).toBe(false);
    // A Contributor on a hosted install may not change the install's settings, and doesn't need to.
    expect(savesToServer("browser", true, "dark", "light")).toBe(false);
  });
});

describe("the command palette's theme rows", () => {
  it("offers every theme but the one in use", () => {
    expect(themeCommands("light").map((command) => command.label)).toEqual(["Switch to dark theme", "Match my system’s theme"]);
    expect(themeCommands("dark").map((command) => command.label)).toEqual(["Switch to light theme", "Match my system’s theme"]);
    expect(themeCommands("system").map((command) => command.label)).toEqual(["Switch to dark theme", "Switch to light theme"]);
  });

  it("runs the theme it names", () => {
    for (const command of themeCommands("system")) expect(THEME_ACTION[command.theme]).toBe(command.label);
  });
});

describe("the theme in another window's preferences", () => {
  it("reads the theme and whether it was chosen", () => {
    expect(themeFromStorage(JSON.stringify({ state: { theme: "dark", themeChosen: true }, version: 2 }))).toEqual({ theme: "dark", chosen: true });
    expect(themeFromStorage(JSON.stringify({ state: { theme: "system" }, version: 1 }))).toEqual({ theme: "system", chosen: false });
  });

  it("ignores what holds no theme", () => {
    expect(themeFromStorage(null)).toBeNull();
    expect(themeFromStorage("not json")).toBeNull();
    expect(themeFromStorage(JSON.stringify({ state: { theme: "sepia" } }))).toBeNull();
  });
});

it("lists the three choices in one order, Match my system included", () => {
  expect(THEME_OPTIONS.map((option) => option.label)).toEqual(["Light", "Dark", "Match my system"]);
});
