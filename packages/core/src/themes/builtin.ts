/**
 * The themes that ship with the app: Quiet (the default), Plate and Desk.
 * Their source is brand/themes/*.json, the art director's files; these are
 * copies the engine can import anywhere (server, app, command line), and
 * test/themes/builtin.test.ts fails if the two ever differ.
 */
import type { ThemeFile } from "./contract";

export const QUIET: ThemeFile = {
  contract: 1,
  id: "quiet",
  name: "Quiet",
  description: "Bond paper and printing ink; the Blue Pencil marks only the action and where you are. Galley's own look.",
  light: {
    paper: "#F6F4F0",
    ink: "#1A1712",
    pencil: "#2E2BFF",
    plate: "#1C1915",
    table: "#E3DBCD"
  },
  dark: {
    paper: "#16140F",
    ink: "#F2ECE1",
    pencil: "#2E2BFF",
    plate: "#0E0C09",
    table: "#2B2620"
  },
  switches: {
    sidebar: "sheet",
    assist: "ruled",
    icons: "one-tone",
    depth: "soft"
  }
};

export const PLATE: ThemeFile = {
  contract: 1,
  id: "plate",
  name: "Plate",
  description: "The sidebar and status line are an inked plate, the current place in Blue Pencil; the assistant works on pencil-washed paper; things stand off the page.",
  light: {
    paper: "#F6F4F0",
    ink: "#1A1712",
    pencil: "#2E2BFF",
    plate: "#1C1915",
    table: "#E3DBCD"
  },
  dark: {
    paper: "#16140F",
    ink: "#F2ECE1",
    pencil: "#2E2BFF",
    plate: "#0E0C09",
    table: "#2B2620"
  },
  switches: {
    sidebar: "plate",
    assist: "washed",
    icons: "duotone",
    depth: "lit"
  }
};

export const DESK: ThemeFile = {
  contract: 1,
  id: "desk",
  name: "Desk",
  description: "Like Plate, on a toned desk instead of the plate: the sidebar a real step darker than the page, the current place a sheet with a pencil edge.",
  light: {
    paper: "#F6F4F0",
    ink: "#1A1712",
    pencil: "#2E2BFF",
    plate: "#1C1915",
    table: "#E3DBCD"
  },
  dark: {
    paper: "#16140F",
    ink: "#F2ECE1",
    pencil: "#2E2BFF",
    plate: "#0E0C09",
    table: "#2B2620"
  },
  switches: {
    sidebar: "desk",
    assist: "washed",
    icons: "duotone",
    depth: "lit"
  }
};


export const BUILTIN_THEMES: readonly ThemeFile[] = [QUIET, PLATE, DESK];
export const DEFAULT_THEME_ID = "quiet";

export function isBuiltinTheme(id: string): boolean {
  return BUILTIN_THEMES.some((theme) => theme.id === id);
}

/**
 * The built-ins as one install shows them. A white-label brand's accent is
 * the built-in themes' pencil, in light and dark, so whichever built-in a
 * person chooses carries the brand. Themes people make keep their own
 * pencil: they chose it.
 */
export function builtinThemes(brandAccent?: string | null): ThemeFile[] {
  const accent = brandAccent && /^#[0-9A-Fa-f]{6}$/.test(brandAccent) ? brandAccent.toUpperCase() : null;

  if (!accent) return BUILTIN_THEMES.map((theme) => structuredClone(theme));
  return BUILTIN_THEMES.map((theme) => {
    const copy = structuredClone(theme);

    copy.light.pencil = accent;
    if (copy.dark) copy.dark.pencil = accent;
    return copy;
  });
}
