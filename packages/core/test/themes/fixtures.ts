/**
 * The README's test themes (brand/themes/README.md → The five test themes,
 * and Harbour from "Making a theme by hand"), beside the three built-ins.
 */
import { QUIET, type ThemeFile } from "../../src/themes";

export const FOG: ThemeFile = { ...structuredClone(QUIET), id: "fog", name: "Fog", light: { ...QUIET.light, paper: "#CFCBC4", ink: "#6E6A64" } };

export const LEMON: ThemeFile = { ...structuredClone(QUIET), id: "lemon", name: "Lemon", light: { ...QUIET.light, pencil: "#F2E35C" }, dark: { ...QUIET.dark!, pencil: "#F2E35C" } };

export const HARBOUR: ThemeFile = {
  contract: 1,
  id: "harbour",
  name: "Harbour",
  light: { paper: "#F3F5F5", ink: "#16202A", pencil: "#00857A", plate: "#121A20", table: "#D7DDD9" },
  switches: { sidebar: "sheet", assist: "ruled", icons: "one-tone", depth: "soft" },
};

export const TEST_THEMES = { fog: FOG, lemon: LEMON, harbour: HARBOUR };
