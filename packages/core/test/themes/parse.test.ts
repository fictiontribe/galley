import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, QUIET, THEME_MAX_BYTES, checkTheme, isAppliedTheme, parseTheme, themeFileText, themeIdFrom, themeOnPage } from "../../src/themes";

const base = () => structuredClone(QUIET) as unknown as Record<string, unknown>;

/** Values that must never reach a style, whichever field they arrive in. */
const HOSTILE = [
  "url(https://example.com/x.png)",
  "var(--accent)",
  "#FFF; background: red",
  "red}body{display:none",
  "{}",
  "</style><script>alert(1)</script>",
  "expression(alert(1))",
  "#F6F4F0 !important",
  "#F6F4F0\n",
  " #F6F4F0",
  "#F6F4F0FF",
  "#FFF",
  "rgb(0 0 0)",
  "oklch(0.5 0.1 200)",
  "red",
  "",
  "x".repeat(10_000),
  42,
  null,
  true,
  ["#F6F4F0"],
  { r: 1 },
];

describe("parseTheme", () => {
  it("reads the three built-ins as they are", () => {
    for (const theme of BUILTIN_THEMES) expect(parseTheme(structuredClone(theme))).toEqual({ ok: true, theme });
  });

  it("refuses a hostile value in every colour of both modes", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const seed of ["paper", "ink", "pencil", "plate", "table"]) {
        for (const value of HOSTILE) {
          const theme = base();
          (theme[mode] as Record<string, unknown>)[seed] = value;
          const parsed = parseTheme(theme);
          expect(parsed.ok, `${mode}.${seed} = ${JSON.stringify(value).slice(0, 40)}`).toBe(false);
        }
      }
    }
  });

  it("refuses a hostile value in every switch", () => {
    for (const name of ["sidebar", "assist", "icons", "depth"]) {
      for (const value of [...HOSTILE, "Plate", "plate ", "inherit"]) {
        const theme = base();
        (theme.switches as Record<string, unknown>)[name] = value;
        expect(parseTheme(theme).ok, `${name} = ${JSON.stringify(value).slice(0, 40)}`).toBe(false);
      }
    }
  });

  it("refuses an id that isn't a slug", () => {
    for (const id of ["Quiet", "-quiet", "qu iet", "quiet;", "../quiet", "q".repeat(33), "", "quiet\u0000", "étoile", 7, null, "__proto__"]) {
      expect(parseTheme({ ...base(), id }).ok, String(id)).toBe(false);
    }
  });

  it("keeps names as bounded text and refuses unprintable characters", () => {
    expect(parseTheme({ ...base(), name: "x".repeat(41) }).ok).toBe(false);
    expect(parseTheme({ ...base(), name: "   " }).ok).toBe(false);
    expect(parseTheme({ ...base(), name: "Bad‮eman" }).ok).toBe(false);
    expect(parseTheme({ ...base(), name: "Tab\tname" }).ok).toBe(false);
    expect(parseTheme({ ...base(), description: "d".repeat(241) }).ok).toBe(false);
    expect(parseTheme({ ...base(), author: "a".repeat(81) }).ok).toBe(false);
    expect(parseTheme({ ...base(), name: 12 }).ok).toBe(false);
    // Markup is text: it is kept as written and never interpreted anywhere it is shown.
    const markup = parseTheme({ ...base(), name: "<b>Bold</b> & “quotes”" });
    expect(markup.ok && markup.theme.name).toBe("<b>Bold</b> & “quotes”");
  });

  it("refuses keys the contract doesn't have, anywhere", () => {
    expect(parseTheme({ ...base(), css: "body{}" }).ok).toBe(false);
    expect(parseTheme({ ...base(), light: { ...QUIET.light, accent: "#000000" } }).ok).toBe(false);
    expect(parseTheme({ ...base(), switches: { ...QUIET.switches, radius: "round" } }).ok).toBe(false);
    expect(parseTheme(JSON.parse(`{"contract":1,"id":"x","name":"X","light":${JSON.stringify(QUIET.light)},"switches":{},"__proto__":{"polluted":true}}`)).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses another contract, a missing light, and things that aren't objects", () => {
    expect(parseTheme({ ...base(), contract: 2 }).ok).toBe(false);
    const noLight = base();
    delete noLight.light;
    expect(parseTheme(noLight).ok).toBe(false);
    for (const value of [null, 1, "x", [], [QUIET], undefined]) expect(parseTheme(value).ok).toBe(false);
  });

  it("refuses a file over the size limit before reading it", () => {
    const text = JSON.stringify({ ...base(), description: "x".repeat(200) }) + " ".repeat(THEME_MAX_BYTES);
    const parsed = parseTheme(text);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.problems[0]).toMatch(/few hundred bytes/);
    expect(parseTheme("{not json").ok).toBe(false);
  });

  it("normalises colours to upper case and leaves an absent dark absent", () => {
    const theme = base();
    delete theme.dark;
    (theme.light as Record<string, string>).paper = "#f6f4f0";
    const parsed = parseTheme(theme);
    expect(parsed.ok && parsed.theme.light.paper).toBe("#F6F4F0");
    expect(parsed.ok && parsed.theme.dark).toBeUndefined();
  });
});

describe("export and import", () => {
  it("round-trips: a theme written out and read back is the same theme", () => {
    for (const theme of [QUIET, { ...QUIET, id: "mine", name: "Mine", author: "Someone", description: "A test." }]) {
      const checked = checkTheme(theme);
      const text = themeFileText(checked.theme!);
      const back = checkTheme(text);
      expect(back.ok).toBe(true);
      expect(back.theme).toEqual(checked.theme);
      expect(back.applied).toEqual(checked.applied);
      expect(JSON.parse(text).$schema).toMatch(/theme\.schema\.json$/);
    }
  });

  it("makes ids from names", () => {
    expect(themeIdFrom("Harbour at dusk")).toBe("harbour-at-dusk");
    expect(themeIdFrom("Café Noir!")).toBe("cafe-noir");
    expect(themeIdFrom("???")).toBe("theme");
    expect(themeIdFrom("x".repeat(50))).toHaveLength(32);
  });
});

describe("what a theme puts on the page", () => {
  it("puts nothing on the page for Quiet as it ships", () => {
    expect(themeOnPage(checkTheme(QUIET).applied, "light")).toEqual({ attributes: {}, properties: {} });
  });

  it("sets only the contract's names, with colours that are exactly #RRGGBB", () => {
    const applied = checkTheme({ ...QUIET, id: "fog", name: "Fog", light: { ...QUIET.light, paper: "#CFCBC4", ink: "#6E6A64" } }).applied;
    const shown = themeOnPage(applied, "light");
    expect(Object.keys(shown.attributes).sort()).toEqual(["data-look", "data-look-assist", "data-look-depth", "data-look-icons", "data-look-sidebar"]);
    for (const [name, value] of Object.entries(shown.properties)) {
      expect(name).toMatch(/^--(theme-(dark-)?(paper|ink|pencil|plate|table)|proof-(insert|delete|change)|success|warning|danger|info)$/);
      expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
    // The delete ink tuned for light is set in light only.
    expect(shown.properties["--proof-delete"]).toBe("#B53216");
    expect(themeOnPage(applied, "dark").properties["--proof-delete"]).toBeUndefined();
  });

  it("knows an applied theme from anything else read back from storage", () => {
    const applied = checkTheme(QUIET).applied!;
    expect(isAppliedTheme(applied)).toBe(true);
    expect(isAppliedTheme({ ...applied, light: { ...applied.light, paper: "url(x)" } })).toBe(false);
    expect(isAppliedTheme({ ...applied, switches: { ...applied.switches, depth: "deep" } })).toBe(false);
    expect(isAppliedTheme({ ...applied, tuned: { light: { delete: "red" }, dark: {} } })).toBe(false);
    expect(isAppliedTheme({ ...applied, tuned: { light: { "--x": "#000000" }, dark: {} } })).toBe(false);
    expect(isAppliedTheme({ ...applied, id: "../x" })).toBe(false);
    expect(isAppliedTheme(null)).toBe(false);
  });
});
