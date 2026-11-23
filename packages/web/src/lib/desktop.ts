/** What the desktop shell adds to the page when it hosts the app. */
interface DesktopBridge {
  /** Native folder picker. Resolves to an absolute path, or null when cancelled. */
  pickFolder?: () => Promise<string | null>;
}

declare global {
  interface Window {
    __GALLEY_DESKTOP__?: DesktopBridge;
  }
}

/**
 * Ask the desktop shell for a folder. Returns undefined when there is no
 * native picker (a browser tab), so the caller falls back to its own dialog.
 */
export async function pickFolderNatively(): Promise<string | null | undefined> {
  const pick = window.__GALLEY_DESKTOP__?.pickFolder;
  if (!pick) return undefined;
  return pick();
}
