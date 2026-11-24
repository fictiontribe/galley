import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, DESK, PLATE, QUIET, builtinThemes, checkTheme, darkFromLight, isBuiltinTheme, type ThemeCheck } from "../../src/themes";
import { FOG, HARBOUR, LEMON } from "./fixtures";

const lowest = (check: ThemeCheck, mode: "light" | "dark", label: string) => check.measures.find((m) => m.mode === mode && m.label === label)?.ratio ?? 0;

describe("checkTheme: the README's test themes", () => {
  for (const theme of [QUIET, PLATE, DESK]) {
    it(`${theme.name} passes untouched`, () => {
      const check = checkTheme(theme);
      expect(check.ok).toBe(true);
      expect(check.adjusted).toEqual([]);
      expect(check.warnings).toEqual([]);
      expect(check.theme).toEqual({ ...theme });
      expect(check.measures.every((m) => m.ratio >= m.min)).toBe(true);
    });
  }

  it("measures Quiet's lowest pairs where the README says they are", () => {
    const check = checkTheme(QUIET);
    // README: ink-3 on the well 5.07, strong edge on the well 3.56, on the desk 4.63 (dark 4.93).
    expect(lowest(check, "light", "hints and labels on a well")).toBeCloseTo(5.07, 1);
    expect(lowest(check, "light", "the edges of fields on a well")).toBeCloseTo(3.56, 1);
    expect(lowest(check, "light", "hints and labels on the desk")).toBeCloseTo(4.63, 1);
    expect(lowest(check, "dark", "hints and labels on the desk")).toBeCloseTo(4.93, 1);
  });

  it("Fog: paper lightened, ink darkened, two status inks tuned, each said in words", () => {
    const check = checkTheme(FOG);
    expect(check.ok).toBe(true);
    const paper = check.adjusted.find((a) => a.colour === "paper");
    expect(paper?.reason).toBe(`Your paper was too dark for a light theme, so it was lightened from #CFCBC4 to ${paper?.to}.`);
    // The README's #EBE7E0 is a hair under the range once rounded to a hex colour; the check lands inside it.
    expect(["#EBE7E0", "#ECE8E0"]).toContain(paper?.to);
    const inkRange = check.adjusted.find((a) => a.colour === "ink" && a.kind === "range");
    expect(inkRange).toMatchObject({ from: "#6E6A64", to: "#36322D" });
    expect(inkRange?.reason).toBe("Your ink was too light to read as text, so it was darkened from #6E6A64 to #36322D.");
    // #36322D alone leaves hints and labels faint (3.1 on the well): the README's reference moved the ink on without saying so; this check says so.
    const inkLegible = check.adjusted.find((a) => a.colour === "ink" && a.kind === "legibility");
    expect(inkLegible?.from).toBe("#36322D");
    expect(inkLegible?.reason).toMatch(/^Your ink was darkened from #36322D to #[0-9A-F]{6} so that hints and labels on the paper, a well/);
    const tuned = check.adjusted.filter((a) => a.kind === "tuned");
    expect(tuned.map((a) => a.colour)).toContain("delete");
    expect(tuned.find((a) => a.colour === "delete")).toMatchObject({ from: "#B8361A", to: "#B53216" });
    expect(tuned.find((a) => a.colour === "delete")?.reason).toBe(
      "The delete color was darkened slightly, from #B8361A to #B53216, so it reads on a well in this theme. Its hue is kept, so a deletion still looks like a deletion."
    );
    expect(check.applied?.tuned.light.delete).toBe("#B53216");
    // The file keeps the adjusted colours; tuned inks are re-derived when it is applied.
    expect(check.theme?.light.paper).toBe(paper?.to);
    expect(check.measures.every((m) => m.ratio >= m.min)).toBe(true);
  });

  it("Lemon: nothing refused or adjusted; text and lines drawn olive, and the editor is told why", () => {
    const check = checkTheme(LEMON);
    expect(check.ok).toBe(true);
    expect(check.adjusted).toEqual([]);
    expect(check.colours?.light.accentText).toBe("#665600");
    expect(check.colours?.light.accentFill).toBe("#F2E35C");
    // tokens.css's near-black on-accent is srgb-linear 0.0103, which is #1A1A1A (the README's reference used #030303).
    expect(check.colours?.light.accentOn).toBe("#1A1A1A");
    expect(lowest(check, "light", "text and focus in the pencil color on a sheet")).toBeCloseTo(7.06, 1);
    expect(lowest(check, "light", "pencil text on a selected row on a selected row")).toBeGreaterThan(4.5);
    expect(lowest(check, "light", "a selected row against a sheet")).toBeCloseTo(1.16, 1);
    expect(check.warnings.find((w) => w.code === "pale-pencil")?.message).toBe(
      "Your pencil color is pale, so text, lines and tints drawn in it use a darker shade (#665600) to stay readable. Buttons keep the color itself."
    );
  });

  it("Harbour: the ink is nudged, and the teal is said to be close to the insert green", () => {
    const check = checkTheme(HARBOUR);
    expect(check.ok).toBe(true);
    expect(check.derivedDark).toBe(true);
    const ink = check.adjusted.find((a) => a.colour === "ink");
    expect(ink).toMatchObject({ mode: "light", from: "#16202A", to: "#101A24", kind: "legibility" });
    // The pencil is not moved: tokens.css darkens the button's fill out of the dead band itself (#00857A → #008378), so white on it is 4.62.
    expect(check.adjusted.find((a) => a.colour === "pencil")).toBeUndefined();
    expect(check.colours?.light.accentFill).toBe("#008378");
    expect(lowest(check, "light", "the words on a button on a button")).toBeGreaterThanOrEqual(4.5);
    expect(check.warnings.map((w) => w.message)).toContain("Your pencil color is close to the insert color; selected things may look like insertions. The marks still carry the meaning.");
    // The derived dark passes as it is.
    expect(check.adjusted.filter((a) => a.mode === "dark")).toEqual([]);
    expect(check.theme?.dark).toBeUndefined();
    expect(check.applied?.dark).toEqual(darkFromLight(check.theme!.light));
  });
});

describe("checkTheme: rules", () => {
  it("refuses a grey pencil, in words", () => {
    const check = checkTheme({ ...QUIET, light: { ...QUIET.light, pencil: "#777777" } });
    expect(check.ok).toBe(false);
    expect(check.refused[0]).toMatch(/^Your pencil color \(#777777\) is too close to grey/);
  });

  it("keeps every seed in its range, hue kept", () => {
    const check = checkTheme({ ...QUIET, light: { ...QUIET.light, paper: "#FFFFFF", plate: "#666666", table: "#FFFFFF", ink: "#5A1010" } });
    expect(check.ok).toBe(true);
    const moved = Object.fromEntries(check.adjusted.filter((a) => a.kind === "range").map((a) => [a.colour, a.reason]));
    expect(moved.paper).toMatch(/too bright to rest the eyes on/);
    expect(moved.plate).toMatch(/too light for words to read on it/);
    expect(moved.table).toMatch(/too close to white/);
    expect(moved.ink).toMatch(/too strongly colored for text/);
  });

  it("is settled: checking a checked theme changes nothing", () => {
    for (const theme of [QUIET, FOG, LEMON, HARBOUR, { ...QUIET, light: { ...QUIET.light, paper: "#FFFFFF", plate: "#666666", table: "#FFFFFF", ink: "#5A1010" } }]) {
      const first = checkTheme(theme);
      const second = checkTheme(first.theme);
      expect(second.applied).toEqual(first.applied);
      expect(second.adjusted.filter((a) => a.kind !== "tuned" && a.mode === "light")).toEqual([]);
    }
  });

  it("warns about a pencil close to a colour that means something, without changing it", () => {
    const check = checkTheme({ ...QUIET, light: { ...QUIET.light, pencil: "#B8361A" } });
    expect(check.ok).toBe(true);
    expect(check.warnings.map((w) => w.ink)).toContain("delete");
    expect(check.theme?.light.pencil).toBe("#B8361A");
  });

  it("moves dark colors given the wrong way round into range", () => {
    const check = checkTheme({ ...QUIET, dark: { ...QUIET.dark!, ink: "#000000", paper: "#FFFFFF" } });
    expect(check.ok).toBe(true);
    expect(check.adjusted.filter((a) => a.mode === "dark").length).toBeGreaterThan(0);
  });

  it("gives white-label installs their accent as the built-ins' pencil, and nothing else", () => {
    const branded = builtinThemes("#0f766e");
    expect(branded.map((t) => [t.light.pencil, t.dark?.pencil])).toEqual([
      ["#0F766E", "#0F766E"],
      ["#0F766E", "#0F766E"],
      ["#0F766E", "#0F766E"],
    ]);
    expect(branded[0]!.light.paper).toBe(QUIET.light.paper);
    expect(builtinThemes("url(x)")[0]!.light.pencil).toBe(QUIET.light.pencil);
    expect(isBuiltinTheme("desk")).toBe(true);
    expect(isBuiltinTheme("harbour")).toBe(false);
  });
});

describe("the built-ins are the art director's files", () => {
  const folder = fileURLToPath(new URL("../../../../brand/themes/", import.meta.url));
  it("match brand/themes/*.json exactly", () => {
    for (const theme of BUILTIN_THEMES) {
      const file = JSON.parse(readFileSync(`${folder}${theme.id}.json`, "utf8")) as Record<string, unknown>;
      delete file.$schema;
      expect(theme).toEqual(file);
    }
  });
});

/** Every theme in brand/themes and the community folder must pass the check: a theme that isn't legible can't be merged. */
describe("every theme file in the repository passes the check", () => {
  for (const folder of ["../../../../brand/themes/", "../../../../themes/"]) {
    const path = fileURLToPath(new URL(folder, import.meta.url));
    let files: string[] = [];
    try {
      files = readdirSync(path).filter((name) => name.endsWith(".json") && name !== "theme.schema.json");
    } catch {
      files = [];
    }
    for (const name of files) {
      it(`${folder.replace("../../../../", "")}${name}`, () => {
        const text = readFileSync(`${path}${name}`, "utf8");
        const check = checkTheme(text);
        expect(check.refused).toEqual([]);
        expect(check.ok).toBe(true);
        // The file holds the colours as they will be shown: a contributor commits the adjusted values.
        expect(check.adjusted.filter((a) => a.kind !== "tuned" && !(a.mode === "dark" && check.derivedDark))).toEqual([]);
        expect(`${check.theme!.id}.json`).toBe(name);
      });
    }
  }
});
