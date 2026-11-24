/**
 * Putting a theme on the page: exactly the names the contract lists
 * (core themes/apply.ts), every other one of them taken off, so switching
 * from Plate to Quiet leaves nothing of Plate behind. And the copy
 * public/theme.js reads before the next first paint.
 */
import { THEME_ATTRIBUTES, THEME_PROPERTIES, themeOnPage, type AppliedTheme, type ThemeMode } from "@galley/core/themes";
import { LOOK_COPY_KEY } from "../stores/themes";

export function putLookOnPage(look: AppliedTheme | null, shown: ThemeMode, root: HTMLElement = document.documentElement): void {
  const next = themeOnPage(look, shown);

  for (const name of THEME_ATTRIBUTES) {
    const value = next.attributes[name];
    if (value === undefined) root.removeAttribute(name);
    else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }
  for (const name of THEME_PROPERTIES) {
    const value = next.properties[name];
    if (value === undefined) root.style.removeProperty(name);
    else if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
}

/**
 * Keep this browser's copy for the next start (never an edit in progress).
 * Only a person's own choice is kept: the install's default comes in front of
 * the start-up script from the server (themes-routes.ts), so nothing is
 * written for someone who hasn't chosen (the sign-in and first-run screens
 * store nothing).
 */
export function rememberLook(look: AppliedTheme | null, chosen: boolean): void {
  try {
    if (!chosen || !look) {
      if (localStorage.getItem(LOOK_COPY_KEY) !== null) localStorage.removeItem(LOOK_COPY_KEY);
      return;
    }
    const text = JSON.stringify({ chosen, look });
    if (localStorage.getItem(LOOK_COPY_KEY) !== text) localStorage.setItem(LOOK_COPY_KEY, text);
  } catch {
    // Storage full or off: the next start shows the default, then this theme.
  }
}
