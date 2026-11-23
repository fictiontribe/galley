// @ts-check
// The Dev Toolbar app. It runs in the browser during `astro dev` only: it asks
// the dev server's status route whether Galley is running, and either offers
// to open the current page in Galley or shows the command that starts it.
// Built with DOM APIs (never innerHTML with data) and the toolbar's own
// `astro-dev-toolbar-*` elements, so it looks like the rest of the toolbar.

import { ICON, PRODUCT_NAME, START_COMMAND, STATUS_PATH } from "./constants.js";

/** @typedef {import("./status.js").GalleyStatus} GalleyStatus */

const DEFAULT_PORT = "4400";

/** Base path of the site in development, without a trailing slash ("" at the root). */
function basePath() {
  /** @type {{ env?: { BASE_URL?: string } }} */
  const meta = /** @type {any} */ (import.meta);
  return (meta.env?.BASE_URL ?? "/").replace(/\/+$/, "");
}

/**
 * The address that opens `pathname` of the project at `root` in Galley.
 *
 * @param {string} galleyUrl
 * @param {string} root
 * @param {string} pathname
 */
export function openUrl(galleyUrl, root, pathname) {
  const query = new URLSearchParams({ root, url: pathname });
  return `${galleyUrl}/open?${query.toString()}`;
}

/**
 * The command that starts Galley where the integration looks for it: the
 * plain command for the default port, with `--port` for any other local port.
 *
 * @param {string} galleyUrl
 */
export function startCommand(galleyUrl) {
  try {
    const { hostname, port } = new URL(galleyUrl);
    const local = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";

    return local && port && port !== DEFAULT_PORT ? `${START_COMMAND} --port ${port}` : START_COMMAND;
  } catch {
    return START_COMMAND;
  }
}

/**
 * @param {string} tag
 * @param {Record<string, string>} [attributes]
 * @param {Array<Node | string>} [children]
 * @returns {HTMLElement}
 */
function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  for (const child of children) node.append(child);
  return node;
}

const STYLES = `
  astro-dev-toolbar-window { width: min(380px, calc(100vw - 32px)); }
  .galley { display: grid; gap: 12px; font-size: 14px; line-height: 1.45; }
  .galley__head { display: flex; align-items: center; gap: 8px; }
  .galley__head svg { width: 18px; height: 18px; flex: none; }
  .galley__title { margin: 0; font-size: 15px; font-weight: 600; }
  .galley__head astro-dev-toolbar-badge { margin-inline-start: auto; }
  .galley p { margin: 0; }
  .galley__muted { color: rgba(204, 206, 216, 0.8); font-size: 13px; }
  .galley__command { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; border: 1px solid rgba(52, 56, 65, 1); border-radius: 6px; background: rgba(255, 255, 255, 0.04); }
  .galley__command code { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; user-select: all; }
  .galley__actions { display: flex; flex-wrap: wrap; gap: 8px; }
`;

/**
 * Renders the window's contents for one state.
 *
 * @param {HTMLElement} body
 * @param {{ kind: "checking" } | { kind: "error" } | { kind: "status", status: GalleyStatus }} state
 * @param {{ refresh: () => void, pathname: () => string }} actions
 */
export function render(body, state, actions) {
  body.replaceChildren();
  const icon = el("span", { "aria-hidden": "true" });
  // ICON is a constant from this package, never data.
  icon.innerHTML = ICON;
  const badge = el("astro-dev-toolbar-badge", { "badge-style": "gray", "data-galley": "badge" });
  const head = el("header", { class: "galley__head" }, [icon, el("h1", { class: "galley__title" }, [PRODUCT_NAME]), badge]);

  body.append(head);

  if (state.kind === "checking") {
    badge.textContent = "Checking";
    body.append(el("p", { class: "galley__muted" }, [`Looking for ${PRODUCT_NAME}…`]));
    return;
  }
  if (state.kind === "error") {
    badge.textContent = "Unknown";
    body.append(
      el("p", {}, [`Couldn't check whether ${PRODUCT_NAME} is running: the dev server didn't answer. Restart \`astro dev\`, then check again.`]),
      el("div", { class: "galley__actions" }, [button("Check again", "outline", actions.refresh, "refresh")]),
    );
    return;
  }

  const { status } = state;

  if (status.running) {
    badge.textContent = "Running";
    badge.setAttribute("badge-style", "green");
    const edit = button(`Edit this page in ${PRODUCT_NAME}`, "purple", () => {
      window.open(openUrl(status.url, status.root, actions.pathname()), "_blank", "noopener");
    }, "edit");

    body.append(
      el("p", { class: "galley__muted" }, [`${PRODUCT_NAME} is running at ${status.url}.`]),
      el("div", { class: "galley__actions" }, [edit]),
      el("p", { class: "galley__muted" }, [`Opens ${actions.pathname()} in a new tab.`]),
    );
    return;
  }

  badge.textContent = "Not running";
  const command = startCommand(status.url);
  const code = el("code", { "data-galley": "command" }, [command]);
  const copy = button("Copy", "outline", () => {
    const done = () => {
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy"), 1500);
    };
    const select = () => {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      copy.textContent = "Selected";
    };

    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(command).then(done, select);
    else select();
  }, "copy");

  body.append(
    el("p", {}, [`${PRODUCT_NAME} isn't running. Start it in this project's folder:`]),
    el("div", { class: "galley__command" }, [code, copy]),
    el("div", { class: "galley__actions" }, [button("Check again", "outline", actions.refresh, "refresh")]),
    el("p", { class: "galley__muted" }, [`Looked for it at ${status.url}.`]),
  );
}

/**
 * @param {string} label
 * @param {string} style
 * @param {() => void} onClick
 * @param {string} name
 */
function button(label, style, onClick, name) {
  const node = el("astro-dev-toolbar-button", { "button-style": style, size: "medium", "data-galley": name }, [label]);
  node.addEventListener("click", onClick);
  return node;
}

/**
 * Asks the dev server for Galley's status.
 *
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<GalleyStatus | null>}
 */
export async function fetchStatus(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${basePath()}${STATUS_PATH}`, { cache: "no-store", headers: { accept: "application/json" } });

    if (!response.ok) return null;
    const body = /** @type {GalleyStatus} */ (await response.json());

    return typeof body.running === "boolean" && typeof body.url === "string" && typeof body.root === "string" ? body : null;
  } catch {
    return null;
  }
}

/** @type {Parameters<typeof import("astro/toolbar").defineToolbarApp>[0]} */
const app = {
  init(canvas, toolbar) {
    const style = document.createElement("style");
    style.textContent = STYLES;
    const win = document.createElement("astro-dev-toolbar-window");
    const body = el("div", { class: "galley" });

    win.append(body);
    canvas.append(style, win);

    const actions = {
      pathname: () => window.location.pathname,
      refresh: () => void refresh(),
    };
    let seq = 0;

    async function refresh() {
      const mine = ++seq;

      render(body, { kind: "checking" }, actions);
      const status = await fetchStatus();

      if (mine !== seq) return;
      render(body, status ? { kind: "status", status } : { kind: "error" }, actions);
    }

    void refresh();
    toolbar.onToggled(({ state }) => {
      if (state) void refresh();
    });
  },
};

export default app;
