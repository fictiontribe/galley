import { forgetPersonalThemes } from "./stores/themes";
import { useUi } from "./stores/ui";
import { api } from "./api";
import { disconnectEvents } from "./events";
import { clearQueries } from "./query";
import { useMeta } from "./stores/meta";

/**
 * Local-mode session hand-off. The CLI opens the app with `?token=…`; any
 * request carrying the token gets the session cookie back, after which the
 * token is stripped from the address bar so it isn't bookmarked or shared.
 */

/** Exchange a session token for the cookie. Resolves true when the server accepted it. */
export async function exchangeToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/meta?token=${encodeURIComponent(token)}`, { credentials: "same-origin" });
    if (!response.ok) return false;
    const meta = (await response.json()) as { authenticated?: boolean };
    return meta.authenticated !== false;
  } catch {
    return false;
  }
}

/** Read `?token=` from the current URL and remove it without a navigation. */
export function takeTokenFromUrl(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (!token) return null;
  url.searchParams.delete("token");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  return token;
}

/** Hosted mode: end the session, drop every cached answer and stop live updates. */
export async function signOut(): Promise<void> {
  await api("POST /api/auth/logout");
  // A shared browser: nothing of this person's themes stays for the next one.
  forgetPersonalThemes();
  useUi.getState().setLook(null);
  disconnectEvents();
  clearQueries();
  await useMeta.getState().load();
}
