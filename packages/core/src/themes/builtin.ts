/**
 * The themes that ship with the app: Quiet (the default), Plate and Desk.
 * Their source is brand/themes/*.json, the art director's files; these are
 * copies the engine can import anywhere (server, app, command line), and
 * test/themes/builtin.test.ts fails if the two ever differ.
 */
import { checkTheme } from "./check";
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

/** A brand accent as `#RRGGBB` (the brand file also allows #RGB and a trailing alpha), or null. */
function accentHex(accent: string): string | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(accent.trim());

  if (!match) return null;
  const digits = match[1]!;
  const six = digits.length <= 4 ? [...digits.slice(0, 3)].map((digit) => digit + digit).join("") : digits.slice(0, 6);

  return `#${six.toUpperCase()}`;
}

/**
 * Whether a white-label brand's accent can be the built-in themes' pencil.
 * It goes through the same check as any theme: an accent too close to grey
 * (most near-black and grey brand colours) can't mark the action, where you
 * are and focus, so the built-ins keep their own pencil and `problem` says
 * so in words. An accent that can be used may still have its lightness
 * adjusted for legibility, like any pencil.
 */
export function brandPencil(accent?: string | null): { pencil: string | null; problem?: string } {
  if (!accent) return { pencil: null };
  const hex = accentHex(accent);

  if (!hex) return { pencil: null, problem: `The brand's accent (${accent.slice(0, 20)}) isn't a color written like #1A2B3C, so the editing app's built-in themes keep their own pencil.` };
  const check = checkTheme({ ...QUIET, light: { ...QUIET.light, pencil: hex }, dark: { ...QUIET.dark!, pencil: hex } });

  if (!check.ok) {
    return {
      pencil: null,
      problem: `The brand's accent ${hex} can't be the editing app's pencil: it is too close to grey to mark the action, where you are and focus. The built-in themes keep their own pencil. Choose an accent with more color to carry the brand into the app.`,
    };
  }
  return { pencil: hex };
}

/**
 * The built-ins as one install shows them. A white-label brand's accent is
 * the built-in themes' pencil, in light and dark, so whichever built-in a
 * person chooses carries the brand, when the accent can be a pencil at all
 * (`brandPencil`); otherwise they keep their own. Themes people make keep
 * their own pencil: they chose it.
 */
export function builtinThemes(brandAccent?: string | null): ThemeFile[] {
  const { pencil } = brandPencil(brandAccent);

  if (!pencil) return BUILTIN_THEMES.map((theme) => structuredClone(theme));
  return BUILTIN_THEMES.map((theme) => {
    const copy = structuredClone(theme);

    copy.light.pencil = pencil;
    if (copy.dark) copy.dark.pencil = pencil;
    return copy;
  });
}
