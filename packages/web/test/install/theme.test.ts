// @vitest-environment happy-dom
/**
 * The theme switch in the app's frame and the palette. In local mode one
 * click shows the other theme at once and saves it with the server's
 * settings, so every window agrees. On a hosted install the theme is each
 * person's own, kept in their browser: a Contributor can switch, nothing is
 * sent, and the install's setting is only where a new browser starts. The
 * small screens outside the shell carry the switch in a corner.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { byText, click, refusals, renderApp, settle, startServer, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

function calls(server: MockServer, method: string, path: string) {
  return server.log.filter((entry) => entry.method === method && entry.path === path);
}

function shownTheme(): string | undefined {
  return document.documentElement.dataset.theme;
}

function themeSwitch(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(".app-theme-switch");
  if (!found) throw new Error("No theme switch on the page");
  return found;
}

function stored(): { theme?: string; themeChosen?: boolean } {
  return (JSON.parse(localStorage.getItem("galley.ui") ?? "{}") as { state?: { theme?: string; themeChosen?: boolean } }).state ?? {};
}

async function openPalette(): Promise<void> {
  const { act } = await import("react");
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  });
  await until(() => expect(document.querySelector('[role="listbox"][aria-label="Results"]')).not.toBeNull());
}

function paletteOptions(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="listbox"][aria-label="Results"] [role="option"]')];
}

describe("the theme switch, local mode", () => {
  it("sits at the foot of the sidebar, says what it will do, and saves one click with the server's settings", async () => {
    const server = await startServer({ mode: "local" });
    page = await renderApp(server, "/");
    await until(() => expect(document.querySelector(".app-sidebar__foot .app-theme-switch")).not.toBeNull());
    await until(() => expect(calls(server, "GET", "/api/settings").length).toBeGreaterThan(0));
    await settle();
    // The computer is light here, and the setting matches it: a click goes dark.
    expect(themeSwitch().getAttribute("aria-label")).toBe("Switch to dark appearance");
    await click(themeSwitch());
    expect(shownTheme()).toBe("dark");
    await until(() => expect(calls(server, "PATCH", "/api/settings").at(-1)?.body).toEqual({ appearance: { theme: "dark" } }));
    expect(themeSwitch().getAttribute("aria-label")).toBe("Switch to light appearance");
    // No corner copy inside the shell.
    expect(document.querySelector(".app-theme-corner")).toBeNull();
  });

  it("is in the command palette, which offers the themes not in use", async () => {
    const server = await startServer({ mode: "local" });
    page = await renderApp(server, "/");
    await until(() => expect(calls(server, "GET", "/api/settings").length).toBeGreaterThan(0));
    await settle();
    await openPalette();
    const labels = paletteOptions().map((option) => option.textContent ?? "");
    expect(labels).toContain("Switch to dark appearance");
    expect(labels).toContain("Switch to light appearance");
    expect(labels.some((label) => label.includes("Match my system"))).toBe(false);
    await click(paletteOptions().find((option) => option.textContent === "Switch to dark appearance") ?? null);
    expect(shownTheme()).toBe("dark");
    await until(() => expect(calls(server, "PATCH", "/api/settings").at(-1)?.body).toEqual({ appearance: { theme: "dark" } }));
    await openPalette();
    expect(paletteOptions().map((option) => option.textContent)).toContain("Match my system’s appearance");
  });

  it("follows another window of this app at once, without asking the server", async () => {
    const server = await startServer({ mode: "local" });
    page = await renderApp(server, "/");
    await until(() => expect(calls(server, "GET", "/api/settings").length).toBeGreaterThan(0));
    await settle();
    const before = server.log.length;
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "galley.ui", newValue: JSON.stringify({ state: { theme: "dark", themeChosen: true }, version: 2 }) }));
    });
    expect(shownTheme()).toBe("dark");
    await settle();
    expect(server.log.slice(before).filter((entry) => entry.path === "/api/settings")).toEqual([]);
  });
});

describe("the theme switch, hosted install", () => {
  it("is a Contributor's own: it switches, stays in this browser, and sends nothing", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role: "contributor" });
    page = await renderApp(server, `/sites/${server.install?.site.id ?? ""}`);
    await until(() => expect(document.querySelector(".app-sidebar__foot .app-theme-switch")).not.toBeNull());
    await until(() => expect(calls(server, "GET", "/api/settings").length).toBeGreaterThan(0));
    await settle();
    await click(themeSwitch());
    expect(shownTheme()).toBe("dark");
    expect(stored()).toMatchObject({ theme: "dark", themeChosen: true });
    // Coming back to the window leaves this person's theme alone and avoids redundant /api/settings fetches.
    const settingsBeforeFocus = calls(server, "GET", "/api/settings").length;
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(calls(server, "GET", "/api/settings").length).toBe(settingsBeforeFocus);
    expect(shownTheme()).toBe("dark");
    expect(calls(server, "PATCH", "/api/settings")).toHaveLength(0);
    expect(refusals(server)).toEqual([]);
  });

  it("starts a new browser on the install's theme, and an owner's own choice doesn't change it for anyone else", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role: "owner" });
    // The install's theme for someone new: dark.
    const saved = await server.handle({ method: "PATCH", url: "/api/settings", headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ appearance: { theme: "dark" } })) });
    expect(saved.status).toBe(200);
    page = await renderApp(server, `/sites/${server.install?.site.id ?? ""}`);
    await until(() => expect(shownTheme()).toBe("dark"));
    expect(stored().themeChosen).toBe(false);
    const before = calls(server, "PATCH", "/api/settings").length;
    await click(themeSwitch());
    expect(shownTheme()).toBe("light");
    await settle();
    expect(calls(server, "PATCH", "/api/settings")).toHaveLength(before);
  });

  it("opens the three choices from the same control, Match my system among them", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role: "editor" });
    page = await renderApp(server, `/sites/${server.install?.site.id ?? ""}`);
    await until(() => expect(document.querySelector(".app-theme-switch")).not.toBeNull());
    const { act } = await import("react");
    await act(async () => {
      themeSwitch().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await until(() => expect(document.querySelector('[role="menu"][aria-label="Appearance"]')).not.toBeNull());
    const items = [...document.querySelectorAll('[role="menu"][aria-label="Appearance"] [role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(["Light", "Dark", "Match my system"]);
    await click(byText(document, '[role="menuitem"]', "Match my system"));
    expect(shownTheme()).toBe("system");
    expect(stored()).toMatchObject({ theme: "system", themeChosen: true });
  });

  it("is in the corner of the sign-in screen, outside the shell", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    page = await renderApp(server, "/login");
    await until(() => expect(document.querySelector(".app-theme-corner .app-theme-switch")).not.toBeNull());
    await click(themeSwitch());
    expect(shownTheme()).toBe("dark");
    expect(calls(server, "PATCH", "/api/settings")).toHaveLength(0);
  });
});
