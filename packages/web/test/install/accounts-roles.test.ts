// @vitest-environment happy-dom
/**
 * What each role sees, against a mock that enforces the role-access table
 * the way the real server does: the navigation and the Proof/Publish area
 * show exactly what the table allows, a walk through the main screens makes
 * no refused call, and a direct visit to a hidden page says plainly it isn't
 * part of the account. In local mode nothing about accounts appears.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROLE_REFUSAL, roleMayCall } from "@galley/core/install/route-access";
import { byText, click, refusals, renderApp, settle, startServer, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

type Role = "owner" | "editor" | "contributor";

const NOT_YOURS = "This isn’t part of your account.";
/** Words that tell the reader they publish: never on a screen for someone whose role doesn't. */
const YOU_PUBLISH = /\byou publish|you’ve published/;
const NO_PUBLISH = "You can change the site and see Proof. An editor or owner publishes.";
const NO_PUBLISH_SHORT = "An editor or owner publishes.";

/** The bar's line where Publish would be: the short words it shows, and the whole sentence for a tooltip and a screen reader. */
function noPublishLine(): { shown: string; title: string | null; read: string } | null {
  const line = topBar().querySelector(".accounts-no-publish");
  if (!line) return null;
  return { shown: line.querySelector('[aria-hidden="true"]')?.textContent ?? "", title: line.getAttribute("title"), read: line.querySelector(".g-sr")?.textContent ?? "" };
}

function siteId(server: MockServer): string {
  const id = server.install?.site.id;
  if (!id) throw new Error("The mock install has no site");
  return id;
}

/** Follow an address inside the app, the way a link does. */
async function go(path: string): Promise<void> {
  const { act } = await import("react");
  await act(async () => {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

/** A sidebar link by its label (its title: a count may follow the words). */
function navLink(label: string): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>(`nav.app-sidebar a[title="${label}"]`);
}

function topBar(): HTMLElement {
  const bar = document.querySelector("header.app-toolbar");
  if (!bar) throw new Error("No top bar");
  return bar as HTMLElement;
}

function calledInbox(server: MockServer): boolean {
  return server.log.some((entry) => /\/inbox(\/|$)/.test(entry.path) || entry.path.endsWith("/capture"));
}

async function openAs(role: Role, path?: string): Promise<{ server: MockServer; base: string }> {
  const server = await startServer({ mode: "hosted", setup: "done", role });
  const base = `/sites/${siteId(server)}`;
  page = await renderApp(server, path ?? base);
  if (!path) await until(() => expect(page?.text()).toContain("Site home"));
  return { server, base };
}

describe.each<Role>(["owner", "editor", "contributor"])("signed in as the %s", (role) => {
  const mayPublish = roleMayCall(role, "POST /api/sites/:siteId/publish");
  const mayManage = roleMayCall(role, "GET /api/install");
  const mayInbox = roleMayCall(role, "GET /api/sites/:siteId/inbox");

  it("shows the navigation and the Proof/Publish area the table allows", async () => {
    const { server, base } = await openAs(role);
    await settle(300);

    // Every role: the site, Proof, Discard, and who is signed in.
    expect(navLink("Proof")?.getAttribute("href")).toBe(`${base}/proof`);
    expect(byText(topBar(), "button", /^Proof/)).not.toBeNull();
    expect(byText(topBar(), "button", "Discard")).not.toBeNull();
    expect(navLink("Your account")?.getAttribute("href")).toBe("/account");
    expect(topBar().querySelector(".accounts-menu")?.getAttribute("aria-label")).toMatch(/^Signed in as /);

    expect(Boolean(byText(topBar(), "button", "Publish"))).toBe(mayPublish);
    expect(noPublishLine()).toEqual(mayPublish ? null : { shown: NO_PUBLISH_SHORT, title: NO_PUBLISH, read: NO_PUBLISH });
    expect(Boolean(navLink("Inbox"))).toBe(mayInbox);
    expect(calledInbox(server)).toBe(mayInbox);
    expect(Boolean(navLink("Settings"))).toBe(mayManage);
    expect(Boolean(navLink("Install"))).toBe(mayManage);
    expect(Boolean(navLink("App settings"))).toBe(mayManage);

    // The palette offers the same.
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });
    await until(() => expect(document.querySelector('[role="listbox"][aria-label="Results"]')).not.toBeNull());
    const palette = document.querySelector('[role="listbox"][aria-label="Results"]')?.textContent ?? "";
    expect(palette.includes("Install")).toBe(mayManage);
    expect(palette.includes("Site settings")).toBe(mayManage);
    expect(palette).toContain("Your account");
    expect(refusals(server)).toEqual([]);
  });

  it("walks the main screens without a single refused call", async () => {
    const { server, base } = await openAs(role);
    const screens = [`${base}/proof`, `${base}/media`, `${base}/forms`, `${base}/scripts`, `${base}/brand`, `${base}/visibility`, `${base}/history`, `${base}/online`, `${base}/redirects`, `${base}/import`, base, "/account"];
    for (const path of screens) {
      await go(path);
      await until(() => expect(window.location.pathname).toBe(path));
      await settle(400);
      expect(page?.text()).not.toContain("This screen ran into a problem");
      if (!mayPublish) expect(page?.text()).not.toMatch(YOU_PUBLISH);
    }
    // A collection, an entry in the editor, and each form (one of them sends to the inbox).
    await go(base);
    await until(() => expect(document.querySelector(`nav.app-sidebar a[href^="${base}/c/"]`)).not.toBeNull());
    const collection = document.querySelector<HTMLAnchorElement>(`nav.app-sidebar a[href^="${base}/c/"]`);
    expect(collection).not.toBeNull();
    await go(collection?.getAttribute("href") ?? base);
    await settle(400);
    const entry = document.querySelector<HTMLAnchorElement>(`main a[href^="${base}/edit?path="]`);
    if (entry) {
      await go(entry.getAttribute("href") ?? base);
      await settle(600);
    }
    await go(`${base}/forms`);
    await settle(400);
    const forms = [...new Set([...document.querySelectorAll<HTMLAnchorElement>(`main a[href^="${base}/forms/"]`)].map((link) => link.getAttribute("href") ?? ""))];
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      await go(form);
      await settle(500);
      expect(page?.text()).not.toContain("This screen ran into a problem");
      if (!mayPublish) expect(page?.text()).not.toMatch(YOU_PUBLISH);
    }
    if (mayManage) {
      for (const path of ["/install", "/settings", "/plugins", `${base}/settings`, `${base}/plugins`, `${base}/inbox`]) {
        await go(path);
        await settle(400);
        expect(page?.text()).not.toContain(NOT_YOURS);
      }
    }
    await settle(300);
    expect(refusals(server)).toEqual([]);
  });

  it("Proof, history and Online show only what the role may do", async () => {
    const { server, base } = await openAs(role);
    await go(`${base}/proof`);
    await until(() => expect(page?.text()).toContain("Check each one."));
    await settle(300);
    expect(page?.text()).toContain(mayPublish ? "Nothing goes live until you publish." : "Nothing goes live until an editor or owner publishes.");
    if (!mayPublish) expect(byText(document, "button", "Share a preview link")).toBeNull();
    await go(`${base}/history`);
    await until(() => expect(page?.text()).toContain("Every published version of this site"));
    await settle(300);
    expect(Boolean(byText(document, "button", "Undo this publish"))).toBe(mayPublish);
    expect(Boolean(byText(document, "button", "Get latest"))).toBe(mayPublish);
    await go(`${base}/online`);
    await until(() => expect(page?.text()).toContain("Where the site lives on the internet."));
    await settle(300);
    if (!mayManage) {
      expect(byText(document, "button", "Put this site online")).toBeNull();
      expect(byText(document, "button", /^Change host or project/)).toBeNull();
    }
    if (!mayPublish) expect(byText(document, "button", "Put live")).toBeNull();
    expect(refusals(server)).toEqual([]);
  });
});

describe("the site's home page says who publishes", () => {
  it.each<[Role, string]>([
    ["contributor", "an editor or owner publishes"],
    ["editor", "you publish"],
  ])("as the %s: under the ask box and in “Waiting to publish”, “%s”", async (role, words) => {
    const server = await startServer({ mode: "hosted", setup: "done", role });
    // Nothing pending, so "Waiting to publish" shows its empty line.
    expect((await server.handle({ method: "POST", url: `/api/sites/${siteId(server)}/discard`, headers: { "content-type": "application/json", origin: "http://localhost" }, body: Buffer.from("{}") })).status).toBe(200);
    page = await renderApp(server, `/sites/${siteId(server)}`);
    await until(() => expect(page?.text()).toContain("Nothing to publish."));
    expect(page.text()).toContain(`opens the editor with your request · nothing changes until ${words}`);
    expect(page.text()).toContain(`Changes you make wait here until ${words}.`);
    expect(refusals(server)).toEqual([]);
  });
});

describe("a direct visit to a page the account doesn't include", () => {
  it.each<[Role, string[]]>([
    ["contributor", ["/install", "/settings", "/plugins", "settings", "plugins", "inbox"]],
    ["editor", ["/install", "/settings", "/plugins", "settings", "plugins"]],
  ])("as the %s: a plain page, and nothing is asked of the server", async (role, paths) => {
    const server = await startServer({ mode: "hosted", setup: "done", role });
    for (const path of paths) {
      const full = path.startsWith("/") ? path : `/sites/${siteId(server)}/${path}`;
      page = await renderApp(server, full);
      await until(() => expect(page?.text()).toContain(NOT_YOURS));
      expect(page.text()).toContain("ask an owner of this editor");
      expect(page.text()).not.toMatch(/Couldn’t/);
      expect(page.text()).not.toContain(ROLE_REFUSAL);
      await page.unmount();
      page = null;
    }
    expect(refusals(server)).toEqual([]);
  });
});

describe("/setup for someone who isn't an owner", () => {
  const SETUP_WORDS = /setup link|Open the setup link|Create your account/;

  it.each<Role>(["editor", "contributor"])("first run over, as the %s (with or without an old setup link): straight into the app", async (role) => {
    const server = await startServer({ mode: "hosted", setup: "done", role });
    for (const path of ["/setup", "/setup?token=an-old-setup-code"]) {
      page = await renderApp(server, path);
      await until(() => expect(page?.text()).toContain("Site home"));
      expect(window.location.pathname).toBe(`/sites/${siteId(server)}`);
      expect(page.text()).not.toMatch(SETUP_WORDS);
      await page.unmount();
      page = null;
    }
    expect(refusals(server)).toEqual([]);
    expect(server.log.some((entry) => entry.path === "/api/setup")).toBe(false);
  });

  it.each<Role>(["editor", "contributor"])("first run left half-way, as the %s: the plain “not part of your account” page, and nothing is asked of the server", async (role) => {
    const server = await startServer({ mode: "hosted", setup: "details" });
    const accounts = server.accounts!;
    const owner = accounts.accounts[0]!;
    accounts.accounts.push({ ...owner, id: "someone", name: "Jo Chen", email: "jo@example.com", role });
    accounts.signedIn = "someone";
    server.backend.authenticated = true;
    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain(NOT_YOURS));
    expect(page.text()).toContain("ask an owner of this editor");
    expect(page.text()).not.toMatch(SETUP_WORDS);
    expect(byText(document, "a", "Go to the site")?.getAttribute("href")).toBe("/");
    expect(server.log.some((entry) => entry.path === "/api/setup")).toBe(false);
  });

  it("an owner made an editor while the page loads: the server's refusal shows the same page, not the setup link's words", async () => {
    const server = await startServer({ mode: "hosted", setup: "details" });
    const handle = server.handle.bind(server);
    server.handle = async (request) => {
      if (new URL(request.url, "http://localhost").pathname === "/api/setup") {
        const me = server.accounts?.current();
        if (me) me.role = "editor";
      }
      return handle(request);
    };
    server.accounts!.signedIn = server.accounts!.accounts[0]!.id;
    server.backend.authenticated = true;
    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain(NOT_YOURS));
    expect(refusals(server)).toEqual(["GET /api/setup"]);
    expect(page.text()).not.toMatch(SETUP_WORDS);
  });
});

describe("when the server refuses anyway", () => {
  it("shows its sentence and asks again who is signed in, so the page follows the new role", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role: "editor" });
    page = await renderApp(server, `/sites/${siteId(server)}/history`);
    await until(() => expect(byText(document, "button", "Undo this publish")).not.toBeNull());
    // An owner makes this editor a contributor while the page is open.
    const me = server.accounts?.current();
    if (!me) throw new Error("Not signed in");
    me.role = "contributor";
    const metaCalls = () => server.log.filter((entry) => entry.path === "/api/meta").length;
    const before = metaCalls();
    await click(byText(document, "button", "Undo this publish"));
    const dialog = [...document.querySelectorAll("dialog")].find((element) => element.open);
    await click(byText(dialog ?? document, "button", "Undo this publish"));
    await until(() => expect(page?.text()).toContain(ROLE_REFUSAL));
    await until(() => expect(metaCalls()).toBeGreaterThan(before));
    // The page now shows what a contributor sees.
    await until(() => expect(noPublishLine()).toEqual({ shown: NO_PUBLISH_SHORT, title: NO_PUBLISH, read: NO_PUBLISH }));
  });
});

describe("local mode", () => {
  it("shows nothing about accounts anywhere", async () => {
    const server = await startServer({ mode: "local" });
    const first = [...server.backend.sites.values()][0];
    if (!first) throw new Error("The local mock has no sites");
    page = await renderApp(server, `/sites/${first.id}`);
    await until(() => expect(page?.text()).toContain("Site home"));
    await settle(300);
    expect(document.querySelector(".accounts-menu")).toBeNull();
    expect(navLink("Your account")).toBeNull();
    expect(byText(topBar(), "button", "Publish")).not.toBeNull();
    expect(navLink("Inbox")).not.toBeNull();
    expect(page.text()).not.toMatch(/Your account|Owner|Contributor|sign out everywhere|Invite/);
    await go("/account");
    await settle(300);
    expect(page.text()).toContain("Nothing lives at this address.");
    expect(server.log.some((entry) => entry.path.startsWith("/api/account") || entry.path.startsWith("/api/people"))).toBe(false);
  });
});
