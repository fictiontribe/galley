// @vitest-environment happy-dom
/**
 * The hosted shell: one site, no way to another. Every multi-site entry is
 * gone and no multi-site route is called — while the same screens in local
 * mode still show and call them. `/` leads where first run says.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMultiSiteRequest } from "../../src/lib/hosted";
import { byText, click, renderApp, settle, startServer, type, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

const MULTI_SITE_WORDS = ["All sites", "New site", "Create a new site", "Add sites from a folder", "Clone a repository", "Open a folder", "switch site", "Switch to", "need attention", "needs attention"];

async function openPalette(): Promise<void> {

  const { act } = await import("react");
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  });
  await until(() => expect(document.querySelector('[role="listbox"][aria-label="Results"]')).not.toBeNull());
}

function paletteText(): string {
  return document.querySelector('[role="listbox"][aria-label="Results"]')?.textContent ?? "";
}

function multiSiteCalls(server: MockServer): string[] {
  return server.log.filter((entry) => isMultiSiteRequest(entry.method, entry.path)).map((entry) => `${entry.method} ${entry.path}`);
}

function siteId(server: MockServer): string {
  const id = server.install?.site.id;
  if (!id) throw new Error("The mock install has no site");
  return id;
}

describe("a hosted install's shell", () => {
  it("opens straight on the one site, with no way to another", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    server.backend.authenticated = true;
    page = await renderApp(server, "/");
    await until(() => expect(window.location.pathname).toBe(`/sites/${siteId(server)}`));
    await until(() => expect(page?.text()).toContain("Site home"));
    await settle();

    const text = page.text();
    for (const words of MULTI_SITE_WORDS) expect(text).not.toContain(words);
    expect(document.querySelector('[aria-haspopup="dialog"][title="Switch site"]')).toBeNull();
    // The sidebar leads to the Install page and App settings instead.
    expect(byText(document, "a", "Install")?.getAttribute("href")).toBe("/install");
    expect(byText(document, "a", "App settings")?.getAttribute("href")).toBe("/settings");

    await openPalette();
    const palette = paletteText();
    for (const words of ["All sites", "Create a new site", "Add sites from a folder", "Switch to", "in a new window"]) expect(palette).not.toContain(words);
    expect(palette).toContain("Install");
    expect(palette).toContain("App settings");

    // ⌘1 jumps to nothing: there are no other sites.
    const before = window.location.pathname;
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", ctrlKey: true, bubbles: true }));
    });
    expect(window.location.pathname).toBe(before);

    await settle();
    expect(multiSiteCalls(server)).toEqual([]);
    // The one site is still read from the list.
    expect(server.log.some((entry) => entry.method === "GET" && entry.path === "/api/sites")).toBe(true);
  });

  it("keeps App settings to one editor: no preview limits across sites, no talk of other sites", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    server.backend.authenticated = true;
    page = await renderApp(server, "/settings");
    await until(() => expect(page?.text()).toContain("These apply to this editor."));
    await settle();
    const text = page.text();
    expect(text).not.toContain("every site you open here");
    expect(document.querySelector('a[href="#previews"]')).toBeNull();
    expect(document.querySelector(".app-nav__label")).toBeNull();
    expect(text).not.toContain("this computer");
    for (const words of MULTI_SITE_WORDS) expect(text).not.toContain(words);
    expect(byText(document, "a", "Install")).not.toBeNull();
    expect(multiSiteCalls(server)).toEqual([]);
  });

  it("keeps Site settings to one site: no “shared key” to override", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    server.backend.authenticated = true;
    page = await renderApp(server, `/sites/${siteId(server)}/settings`);
    await until(() => expect(page?.text()).toContain("Assistant use"));
    await settle();
    const text = page.text();
    expect(text).not.toContain("shared key");
    expect(text).not.toContain("this site’s own");
    expect(server.log.some((entry) => entry.path.endsWith("/connections"))).toBe(false);
    expect(multiSiteCalls(server)).toEqual([]);
  });

  it.each(["/new", "/open", "/open?root=%2FUsers%2Fyou%2FSites%2Fx"])("shows the plain not-found screen at %s", async (path) => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    server.backend.authenticated = true;
    page = await renderApp(server, path);
    await until(() => expect(page?.text()).toContain("Nothing lives at this address."));
    expect(page.text()).toContain("Go to the site");
    await settle();
    expect(multiSiteCalls(server)).toEqual([]);
  });

  it("never shows a refusal from a multi-site route as an error", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    server.backend.authenticated = true;
    page = await renderApp(server, `/sites/${siteId(server)}/history`);
    await until(() => expect(page?.text()).toContain("Version history"));
    await openPalette();
    await settle(300);
    expect(page.text()).not.toMatch(/Couldn’t|can’t add, remove or switch/);
    expect(multiSiteCalls(server)).toEqual([]);
  });
});

describe("the same screens in local mode", () => {
  it("still show every way to other sites, and call the multi-site routes", async () => {
    const server = await startServer({ mode: "local" });
    const first = [...server.backend.sites.values()][0];
    if (!first) throw new Error("The local mock has no sites");
    page = await renderApp(server, `/sites/${first.id}`);
    await until(() => expect(page?.text()).toContain("Site home"));
    expect(document.querySelector('[title="Switch site"]')).not.toBeNull();
    expect(byText(document, "a", "Install")).toBeNull();

    await openPalette();
    const palette = paletteText();
    expect(palette).toContain("All sites");
    expect(palette).toContain("Create a new site");
    expect(palette).toContain("Add sites from a folder");
    expect(palette).not.toContain("Install");
    // A site's name finds the switch to it.
    await type(document.querySelector('input[role="combobox"]'), "handbook");
    await until(() => expect(paletteText()).toContain("Switch to Team handbook"));
    // Opening the palette loads the groups.
    await until(() => expect(multiSiteCalls(server)).toContain("GET /api/groups"));
  });

  it("still has the Sites screen, New site and the preview limits", async () => {
    const server = await startServer({ mode: "local" });
    page = await renderApp(server, "/settings");
    await until(() => expect(page?.text()).toContain("These apply to every site you open here."));
    expect(document.querySelector('a[href="#previews"]')).not.toBeNull();
    expect(document.querySelector(".app-nav__label")?.textContent).toBe("Recent");
    expect(byText(document, "a", "Sites")?.getAttribute("href")).toBe("/");
    expect(byText(document, "a", "New site")?.getAttribute("href")).toBe("/new");
    await page.unmount();

    page = await renderApp(server, "/new");
    await until(() => expect(page?.text()).toContain("What’s the site called?"));
  });
});

describe("where the address opens on a hosted install", () => {
  it("goes to first run while there is no password, and explains the setup link", async () => {
    const server = await startServer({ mode: "hosted", setup: "password" });
    page = await renderApp(server, "/");
    await until(() => expect(window.location.pathname).toBe("/setup"));
    await until(() => expect(page?.text()).toContain("Open the setup link to begin."));
    expect(server.log.some((entry) => entry.path === "/api/setup")).toBe(false);
  });

  it("goes to first run, signed in, while the site isn't connected", async () => {
    const server = await startServer({ mode: "hosted", setup: "site" });
    server.backend.authenticated = true;
    page = await renderApp(server, "/");
    await until(() => expect(window.location.pathname).toBe("/setup"));
    await until(() => expect(page?.text()).toContain("Connect the site."));
  });

  it("goes to first run's details once the site is connected", async () => {
    const server = await startServer({ mode: "hosted", setup: "details" });
    server.backend.authenticated = true;
    page = await renderApp(server, "/");
    await until(() => expect(page?.text()).toContain("A few details."));
    expect(window.location.pathname).toBe("/setup");
  });

  it("asks for the password when first run is over and nobody is signed in", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    page = await renderApp(server, "/");
    await until(() => expect(window.location.pathname).toBe("/login"));
    await until(() => expect(page?.text()).toContain("Sign in to edit."));
  });

  it("goes to the site when first run is over and someone is signed in, and /setup leads there too", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    server.backend.authenticated = true;
    page = await renderApp(server, "/setup");
    await until(() => expect(window.location.pathname).toBe(`/sites/${siteId(server)}`));
  });
});

describe("first run left half-way: the password is chosen, the site isn't connected", () => {
  const CODE = "mock-setup-code-not-a-secret";
  const LINE = "Setting up this editor isn’t finished.";

  /** A mock install whose /api/meta doesn't say whether a password exists, as a server from before `passwordSet` answers. */
  function withoutPasswordSet(server: MockServer): void {
    const install = server.install as unknown as { meta: () => Record<string, unknown> };
    const meta = install.meta.bind(install);
    install.meta = () => {
      const { passwordSet: _said, ...rest } = meta();
      return rest;
    };
  }

  async function signIn(): Promise<void> {
    await type(document.querySelector('input[type="password"]'), "proof");
    await click(byText(document, "button", "Sign in"));
  }

  it.each(["/", "/setup"])("signed out at %s: the ordinary sign-in with one line, then first run where it was left", async (path) => {
    const server = await startServer({ mode: "hosted", setup: "site" });
    page = await renderApp(server, path);
    await until(() => expect(window.location.pathname).toBe("/login"));
    expect(window.location.search).toBe("?next=%2Fsetup");
    await until(() => expect(page?.text()).toContain("Sign in to edit."));
    expect(page.text()).toContain(LINE);
    expect(page.text()).not.toContain("isn’t set up yet");
    expect(page.text()).not.toContain("Open the setup link");
    await signIn();
    await until(() => expect(window.location.pathname).toBe("/setup"));
    await until(() => expect(page?.text()).toContain("Connect the site."));
  });

  it("signed out at /login itself: the same sign-in, then first run", async () => {
    const server = await startServer({ mode: "hosted", setup: "details" });
    page = await renderApp(server, "/login");
    await until(() => expect(page?.text()).toContain("Sign in to edit."));
    expect(page.text()).toContain(LINE);
    await signIn();
    await until(() => expect(window.location.pathname).toBe("/setup"));
    await until(() => expect(page?.text()).toContain("A few details."));
  });

  it("signed out with a setup link in the address: /setup says the link is used up, and offers sign-in", async () => {
    const server = await startServer({ mode: "hosted", setup: "site" });
    page = await renderApp(server, `/setup?token=${CODE}`);
    await until(() => expect(page?.text()).toContain("This setup link can’t be used."));
    expect(window.location.pathname).toBe("/setup");
    // The harness keeps anchors' own click() for downloads, so the link is followed the way a pointer does.
    const link = byText(document, "a", "Sign in");
    const { act } = await import("react");
    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await until(() => expect(window.location.pathname).toBe("/login"));
    await until(() => expect(page?.text()).toContain(LINE));
    await signIn();
    await until(() => expect(page?.text()).toContain("Connect the site."));
  });

  it.each(["/", "/setup", `/setup?token=${CODE}`])("signed in at %s: first run where it was left", async (path) => {
    const server = await startServer({ mode: "hosted", setup: "site" });
    server.backend.authenticated = true;
    page = await renderApp(server, path);
    await until(() => expect(window.location.pathname).toBe("/setup"));
    await until(() => expect(page?.text()).toContain("Connect the site."));
  });

  it("no password yet: / and /setup explain the setup link, /login says it isn't set up, the link opens the password step", async () => {
    const server = await startServer({ mode: "hosted", setup: "password" });
    for (const path of ["/", "/setup"]) {
      page = await renderApp(server, path);
      await until(() => expect(page?.text()).toContain("Open the setup link to begin."));
      expect(window.location.pathname).toBe("/setup");
      await page.unmount();
    }
    page = await renderApp(server, "/login");
    await until(() => expect(page?.text()).toContain("This editor isn’t set up yet."));
    expect(page.text()).not.toContain(LINE);
    await page.unmount();
    page = await renderApp(server, `/setup?token=${CODE}`);
    await until(() => expect(page?.text()).toContain("Choose the password."));
  });

  it("no password yet, signed in all the same (an operator's session): first run at its first step", async () => {
    const server = await startServer({ mode: "hosted", setup: "password" });
    server.backend.authenticated = true;
    for (const path of ["/", "/setup"]) {
      page = await renderApp(server, path);
      await until(() => expect(page?.text()).toContain("Choose the password."));
      expect(window.location.pathname).toBe("/setup");
      await page.unmount();
    }
  });

  it("a server that doesn't say a password exists: everything stays as it was", async () => {
    const server = await startServer({ mode: "hosted", setup: "site" });
    withoutPasswordSet(server);
    for (const path of ["/", "/setup"]) {
      page = await renderApp(server, path);
      await until(() => expect(page?.text()).toContain("Open the setup link to begin."));
      expect(window.location.pathname).toBe("/setup");
      await page.unmount();
    }
    page = await renderApp(server, "/login");
    await until(() => expect(page?.text()).toContain("This editor isn’t set up yet."));
    expect(page.text()).not.toContain(LINE);
  });
});

describe("signing in to an install that isn't set up", () => {
  it("explains instead of asking for a password that doesn't exist yet", async () => {
    const server = await startServer({ mode: "hosted", setup: "password" });
    page = await renderApp(server, "/login");
    await until(() => expect(page?.text()).toContain("This editor isn’t set up yet."));
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(page.text()).toContain("setup link");
    // Someone who already chose it (another browser) can still sign in.
    await click(byText(document, "button", "Sign in"));
    await until(() => expect(document.querySelector('input[type="password"]')).not.toBeNull());
  });

  it("is unchanged in local mode", async () => {
    const server = await startServer({ mode: "local" });
    server.backend.authenticated = false;
    page = await renderApp(server, "/login");
    await until(() => expect(page?.text()).toContain("Open with your session link."));
  });
});
