/**
 * "Start over": forget everything this visit did — the working copy and
 * versions (sessionStorage), the tour's place, and the app's own remembered
 * choices for this browser (preview width, panes: the `galley.` keys) — and
 * open the sample site fresh.
 */
export function startOver(win: Window = window): void {
  for (const storage of [win.sessionStorage, win.localStorage]) {
    try {
      for (const key of Object.keys(storage)) if (key.startsWith("galley.")) storage.removeItem(key);
    } catch {
      // Storage switched off: there is nothing kept to forget.
    }
  }
  win.location.replace(`${win.location.pathname}#/sites/caddow`);
  win.location.reload();
}
