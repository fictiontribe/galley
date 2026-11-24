/**
 * Hostile files at every way in: a switch key that names something every
 * object inherits, and control characters (a terminal's escape sequences)
 * in keys and values. Nothing throws, one bad file hides nothing else, and
 * no message carries an escape sequence.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validatePlugin } from "../../src/plugins";
import { QUIET, checkTheme, isThemeId, parseTheme, printable, themeFileText, themeIdFrom } from "../../src/themes";
import { createThemeStore } from "../../src/themes/store";
import { HARBOUR } from "./fixtures";

const homes: string[] = [];
afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

const INHERITED = ["constructor", "__proto__", "toString"];
/** A switch key that names an inherited property, as JSON text (so "__proto__" is an own key, as it would be in a file). */
const withSwitchKey = (key: string) => `{"contract":1,"id":"odd","name":"Odd","light":${JSON.stringify(QUIET.light)},"switches":{"${key}":"x"}}`;
const ESCAPES = "\u001b]0;title\u0007\u001b[2J\u001b[31m\u009b1m\u202e\u2028\u200b";
// Characters a terminal or a log would act on, or hide text with.
const DANGEROUS = new RegExp("[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u061C\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]");

describe("a switch key that names an inherited property", () => {
  for (const key of INHERITED) {
    it(`“${key}” is refused in words by the reader and the check, never thrown`, () => {
      const parsed = parseTheme(withSwitchKey(key));
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.problems.join(" ")).toContain("The switches have one a theme can’t hold");
      expect(checkTheme(withSwitchKey(key)).ok).toBe(false);
      expect(checkTheme(JSON.parse(withSwitchKey(key))).ok).toBe(false);
    });

    it(`“${key}” in a plugin's theme is a problem, not a crash`, () => {
      const check = validatePlugin({ name: "galley-plugin-odd", apiVersion: 1, themes: [JSON.parse(withSwitchKey(key))] });
      expect(check.ok).toBe(false);
      expect(!check.ok && check.problems.join(" ")).toMatch(/themes\[0\] isn't a theme the app can use/);
    });
  }

  it("one such file in the themes folder is left out and reported; the others are still listed", async () => {
    const home = mkdtempSync(join(tmpdir(), "galley-hostile-"));
    homes.push(home);
    const store = createThemeStore({ home });
    await store.save(HARBOUR);
    mkdirSync(join(home, "themes"), { recursive: true });
    for (const [index, key] of INHERITED.entries()) writeFileSync(join(home, "themes", `odd-${index}.json`), withSwitchKey(key).replace('"id":"odd"', `"id":"odd-${index}"`));
    writeFileSync(join(home, "themes", "huge.json"), " ".repeat(20_000));
    expect((await store.list()).map((theme) => theme.id)).toEqual(["harbour"]);
    const { skipped } = await store.scan();
    expect(skipped.map((skip) => skip.file).sort()).toEqual(["huge.json", "odd-0.json", "odd-1.json", "odd-2.json"]);
    expect(skipped.find((skip) => skip.file === "huge.json")?.reason).toMatch(/over 8 KB/);
  });
});

describe("control characters never reach a message", () => {
  it("are all removed from a key quoted in a problem, however many there are", () => {
    const parsed = parseTheme(JSON.stringify({ ...QUIET, [`k${ESCAPES}${ESCAPES}`]: 1, switches: { [`s${ESCAPES}`]: "x" } }));
    expect(parsed.ok).toBe(false);
    for (const problem of !parsed.ok ? parsed.problems : []) expect(problem).not.toMatch(DANGEROUS);
  });

  it("are refused in a name, a description or an author, and never echoed", () => {
    for (const field of ["name", "description", "author"]) {
      const parsed = parseTheme({ ...QUIET, [field]: `Fine${ESCAPES}` });
      expect(parsed.ok, field).toBe(false);
      for (const problem of !parsed.ok ? parsed.problems : []) expect(problem).not.toMatch(DANGEROUS);
    }
    // Zero-width and separator characters on their own, too.
    for (const character of ["\u200b", "\u2028", "\u2029", "\u061c", "\ufeff", "\u2066"]) expect(parseTheme({ ...QUIET, name: `A${character}B` }).ok).toBe(false);
  });

  it("printable() removes every one, keeping line breaks", () => {
    expect(printable(`a${ESCAPES}b${ESCAPES}c\nd`)).toBe("a]0;title[2J[31m1mb]0;title[2J[31m1mc\nd");
  });
});

describe("ids", () => {
  it("can't be a name a file system reserves", () => {
    for (const id of ["con", "nul", "aux", "prn", "com1", "lpt9"]) {
      expect(isThemeId(id), id).toBe(false);
      expect(parseTheme({ ...QUIET, id }).ok, id).toBe(false);
    }
    expect(isThemeId("console")).toBe(true);
    expect(themeIdFrom("Con")).toBe("con-theme");
    expect(themeFileText(checkTheme(HARBOUR).theme!)).toContain('"id": "harbour"');
  });
});
