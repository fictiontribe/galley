/**
 * Noticing where the page is: in-site navigation (links, client-side
 * routers, back/forward, hash changes) and scrolling, reported without
 * touching the site's own handlers.
 */

/** "/pricing/?plan=team#faq" — what the host shows and navigates by. */
export function currentPath(win: Window): string {
  const { pathname, search, hash } = win.location;
  return `${pathname}${search}${hash}`;
}

/**
 * Calls `onChange(path)` whenever the page's address changes without a full
 * load. history.pushState/replaceState are wrapped (the originals still run
 * first, with the site's own arguments), so router transitions are seen.
 */
export function watchNavigation(win: Window, onChange: (path: string) => void): () => void {
  let last = currentPath(win);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    // Routers set the title just after changing the address; report once both settle.
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const path = currentPath(win);
      if (path === last) return;
      last = path;
      onChange(path);
    }, 40);
  };

  const history = win.history;
  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function pushState(this: History, ...args: Parameters<History["pushState"]>) {
    push.apply(this, args);
    check();
  };
  history.replaceState = function replaceState(this: History, ...args: Parameters<History["replaceState"]>) {
    replace.apply(this, args);
    check();
  };
  win.addEventListener("popstate", check);
  win.addEventListener("hashchange", check);

  return () => {
    if (timer) clearTimeout(timer);
    if (history.pushState.name === "pushState") history.pushState = push;
    if (history.replaceState.name === "replaceState") history.replaceState = replace;
    win.removeEventListener("popstate", check);
    win.removeEventListener("hashchange", check);
  };
}

/**
 * Reports the scroll position at most every `interval` ms (and once more when
 * scrolling stops). Scrolls the host asked for are not echoed back.
 */
export function watchScroll(win: Window, onScroll: (y: number) => void, interval = 60): { suppress(ms?: number): void; dispose(): void } {
  let lastSent = -1;
  let lastAt = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let quietUntil = 0;

  const send = () => {
    const y = Math.round(win.scrollY);
    lastAt = Date.now();
    if (y === lastSent) return;
    lastSent = y;
    onScroll(y);
  };
  const onEvent = () => {
    if (Date.now() < quietUntil) {
      lastSent = Math.round(win.scrollY);
      return;
    }
    if (trailing) clearTimeout(trailing);
    const wait = interval - (Date.now() - lastAt);
    if (wait <= 0) send();
    trailing = setTimeout(send, Math.max(wait, interval));
  };
  win.addEventListener("scroll", onEvent, { passive: true });
  return {
    suppress(ms = 160) {
      quietUntil = Date.now() + ms;
    },
    dispose() {
      if (trailing) clearTimeout(trailing);
      win.removeEventListener("scroll", onEvent);
    },
  };
}
