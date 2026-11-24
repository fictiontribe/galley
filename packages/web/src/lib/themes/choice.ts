/**
 * Which theme is on screen, decided in small pure steps (the same pattern
 * as the appearance in lib/theme.ts):
 *
 * - Local mode and the desktop app: one person, one theme for the app,
 *   kept in the server's settings (the install's default) so every window
 *   agrees. Choosing one saves it there.
 * - A hosted install: each person chooses their own, kept in their browser;
 *   until they do, they see the install's default (App settings, for people
 *   who can manage).
 * - While a theme is being edited, this browser shows the edit, and nothing
 *   is saved until the person saves it.
 */
import { checkTheme, type AppliedTheme } from "@galley/core/themes";
import type { ThemeKeeper } from "../theme";
import type { ListedTheme } from "./catalog";

export interface LookInputs {
  keeper: ThemeKeeper;
  /** The theme being edited, shown in this browser only. */
  preview: AppliedTheme | null;
  /** This browser's record (ui store). */
  local: { look: string | null; chosen: boolean };
  /** The install's default, as the server puts it on the page. Null before /api/meta (or from a server from before themes). */
  fallback: AppliedTheme | null;
  /** Every theme this app knows (lib/themes/catalog.ts). */
  themes: ListedTheme[];
}

/** The id whose theme should show, or null for the install's default. */
export function chosenLookId(keeper: ThemeKeeper, local: { look: string | null; chosen: boolean }): string | null {
  if (keeper === "browser") return local.chosen ? local.look : null;
  return local.look;
}

/** The theme on screen: an edit in progress, else the chosen theme, else the install's default. */
export function shownLook(inputs: LookInputs): AppliedTheme | null {
  if (inputs.preview) return inputs.preview;
  const id = chosenLookId(inputs.keeper, inputs.local);

  if (!id || id === inputs.fallback?.id) return inputs.fallback;
  const listed = inputs.themes.find((entry) => entry.theme.id === id);
  const applied = listed ? checkTheme(listed.theme).applied : null;

  // A theme that is gone (deleted, a plugin turned off) gives way to the default.
  return applied ?? inputs.fallback;
}

/**
 * The server's default arrived (at start, on `themes.updated`, on coming
 * back to the window). Where the server keeps the theme, its default is the
 * one to show; where the browser keeps it, only until the person chooses.
 * Null means "leave this browser's record as it is".
 */
export function lookFromServer(keeper: ThemeKeeper, serverId: string | null, local: { look: string | null; chosen: boolean }): string | null | undefined {
  if (keeper === "browser") return undefined;
  return serverId === local.look ? undefined : serverId;
}

/** Whether choosing a theme is a request to the server: only where the server keeps it. */
export function lookSavesToServer(keeper: ThemeKeeper, signedIn: boolean): boolean {
  return keeper === "server" && signedIn;
}
