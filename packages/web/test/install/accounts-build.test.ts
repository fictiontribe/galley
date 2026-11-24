// @vitest-environment happy-dom
/**
 * Build mode and the site's settings file, by role, on a site that allows
 * build mode: the assistant's build mode, the site kit's set-up and the
 * redirects' host are offered only to a role that has the level
 * (BUILD_MODE_LEVEL, SITE_SETTINGS_LEVEL); everyone else reads one plain
 * line saying who can do it, and no screen makes a refused call. When the
 * server refuses anyway, its sentence is shown. Local mode: as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILD_MODE_LEVEL, SITE_SETTINGS_LEVEL } from "@galley/core/install/route-access";
import { roleMay } from "@galley/core/install/accounts";
import { byText, click, refusals, renderApp, settle, startServer, type, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

type Role = "owner" | "editor" | "contributor";

const BUILD_TOGGLE = '[role="radiogroup"][aria-label="What the assistant may change"]';
const SET_UP_BY_OTHERS = "Setting it up changes the site’s code. An editor or owner can do it.";
const HOST_BY_OTHERS = "An owner of this editor chooses where the site is hosted.";
const BUILD_REFUSAL = "Your account can change the site's content, but not its code and templates";

interface MockSiteLike {
  config: Record<string, unknown> | null;
  collections(): Array<{ id: string }>;
}

function siteOf(server: MockServer): { id: string; site: MockSiteLike } {
  const id = server.install?.site.id;
  if (!id) throw new Error("The mock install has no site");
  const site = (server.backend.sites as unknown as Map<string, MockSiteLike>).get(id);
  if (!site) throw new Error("The mock has no such site");
  return { id, site };
}

/** The site's settings turn build mode on, as an owner would in Site settings. */
function allowBuild(server: MockServer): string {
  const { id, site } = siteOf(server);
  site.config = { ...(site.config ?? {}), ai: { allowBuild: true } };
  return id;
}

/** A site without the site kit yet: no forms in the site, and the kit's set-up all still to do — so Forms offers "Set it up for me". */
function withoutKit(server: MockServer): void {
  const { id, site } = siteOf(server);
  const collections = site.collections.bind(site);
  site.collections = () => collections().filter((collection) => collection.id !== "forms");
  const handle = server.handle.bind(server);
  server.handle = async (request) => {
    const answer = await handle(request);
    if (new URL(request.url, "http://localhost").pathname !== `/api/sites/${id}/kit` || answer.status !== 200) return answer;
    const status = JSON.parse(String(answer.body)) as { kit: unknown; steps: Array<{ state: string }>; ready: boolean };
    return { ...answer, body: JSON.stringify({ ...status, kit: null, ready: false, steps: status.steps.map((step) => ({ ...step, state: "ready" })) }) };
  };
}

async function go(path: string): Promise<void> {
  const { act } = await import("react");
  await act(async () => {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

async function openEditor(server: MockServer, base: string): Promise<void> {
  await go(base);
  await until(() => expect(document.querySelector(`nav.app-sidebar a[href^="${base}/c/"]`)).not.toBeNull());
  await go(document.querySelector<HTMLAnchorElement>(`nav.app-sidebar a[href^="${base}/c/"]`)?.getAttribute("href") ?? base);
  await until(() => expect(document.querySelector(`main a[href^="${base}/edit?path="]`)).not.toBeNull());
  await go(document.querySelector<HTMLAnchorElement>(`main a[href^="${base}/edit?path="]`)?.getAttribute("href") ?? base);
  await until(() => expect(document.querySelector('section[aria-label="Assistant"]')).not.toBeNull());
  await settle(400);
}

describe.each<Role>(["owner", "editor", "contributor"])("on a site that allows build mode, signed in as the %s", (role) => {
  const mayBuild = roleMay(role, BUILD_MODE_LEVEL);
  const maySettings = roleMay(role, SITE_SETTINGS_LEVEL);

  it("offers the assistant's build mode only to a role that has the level", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role });
    const id = allowBuild(server);
    page = await renderApp(server, `/sites/${id}`);
    await until(() => expect(page?.text()).toContain("Site home"));
    await openEditor(server, `/sites/${id}`);
    expect(Boolean(document.querySelector(BUILD_TOGGLE))).toBe(mayBuild);
    expect(Boolean(document.querySelector('[role="radio"][title="Can also change the site’s design and code"]'))).toBe(mayBuild);
    expect(refusals(server)).toEqual([]);
  });

  it("offers the site kit's set-up only to a role that has the level; otherwise one line says who can", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role });
    const id = allowBuild(server);
    withoutKit(server);
    page = await renderApp(server, `/sites/${id}/forms`);
    await until(() => expect(page?.text()).toContain("This site doesn’t have forms yet."));
    await settle(300);
    expect(Boolean(byText(document, "button", "Set it up for me"))).toBe(mayBuild);
    expect(page.text().includes(SET_UP_BY_OTHERS)).toBe(!mayBuild);
    expect(byText(document, "button", "Ask the assistant to finish it")).toBeNull();
    expect(refusals(server)).toEqual([]);
  });

  it("asks where the site is hosted only of a role that may change the site's settings", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role });
    const { id } = siteOf(server);
    page = await renderApp(server, `/sites/${id}/redirects`);
    await until(() => expect(page?.text()).toContain("Where is this site hosted?"));
    await settle(300);
    expect(Boolean(byText(document, "button", /^Netlify/))).toBe(maySettings);
    expect(page.text().includes(HOST_BY_OTHERS)).toBe(!maySettings);
    if (maySettings) {
      await click(byText(document, "button", /^Netlify/));
      await until(() => expect(server.log.some((entry) => entry.path.endsWith("/redirects/settings") && entry.status === 200)).toBe(true));
    }
    expect(refusals(server)).toEqual([]);
  });
});

/** Rewrite one JSON answer of the mock on its way to the app. */
function rewrite(server: MockServer, path: string, change: (body: Record<string, unknown>) => Record<string, unknown>): void {
  const handle = server.handle.bind(server);
  server.handle = async (request) => {
    const answer = await handle(request);
    if (request.method !== "GET" || new URL(request.url, "http://localhost").pathname !== path || answer.status !== 200) return answer;
    return { ...answer, body: JSON.stringify(change(JSON.parse(String(answer.body)) as Record<string, unknown>)) };
  };
}

describe.each<Role>(["owner", "editor", "contributor"])("more of the site's code and settings, as the %s", (role) => {
  const mayBuild = roleMay(role, BUILD_MODE_LEVEL);
  const maySettings = roleMay(role, SITE_SETTINGS_LEVEL);

  it("robots.txt rules are changed only by a role that may change the site's code; the kit's choices by anyone", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role });
    const id = allowBuild(server);
    rewrite(server, `/api/sites/${id}/visibility`, (audit) => ({ ...audit, crawlers: { ...(audit.crawlers as object), where: { kind: "static", path: "public/robots.txt" }, editable: true } }));
    page = await renderApp(server, `/sites/${id}/visibility`);
    await until(() => expect(page?.text()).toContain("AI crawlers"));
    await settle(300);
    const panel = document.querySelector(".seo-panel--crawlers");
    expect(Boolean(panel?.querySelector('[role="radiogroup"]'))).toBe(mayBuild);
    expect(panel?.textContent?.includes("An editor or owner can change these rules.")).toBe(!mayBuild);
    expect(refusals(server)).toEqual([]);
  });

  it("the kit's crawler choices stay anyone's to change", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role });
    const { id } = siteOf(server);
    page = await renderApp(server, `/sites/${id}/visibility`);
    await until(() => expect(page?.text()).toContain("AI crawlers"));
    await settle(300);
    expect(document.querySelector('.seo-panel--crawlers [role="radiogroup"]')).not.toBeNull();
  });

  it("the redirects' host, once chosen, is changed only by a role that may change the site's settings", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role });
    const { id } = siteOf(server);
    // An owner chose it earlier.
    const accounts = server.accounts!;
    const signedIn = accounts.signedIn;
    accounts.signedIn = accounts.accounts.find((person) => person.role === "owner")!.id;
    expect((await server.handle({ method: "PUT", url: `/api/sites/${id}/redirects/settings`, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ host: "netlify" })) })).status).toBe(200);
    accounts.signedIn = signedIn;
    page = await renderApp(server, `/sites/${id}/redirects`);
    await until(() => expect(page?.text()).toContain("Where they take effect"));
    await settle(300);
    expect(Boolean(byText(document.querySelector(".redir-where__host") ?? document, "button", "Change"))).toBe(maySettings);
    expect(refusals(server)).toEqual([]);
  });
});

/** What offers build-mode work (the site's code), by its visible words. */
const BUILD_OFFERS = ["Set it up for me", "Ask the assistant to finish it", "Turn it on", "Send them to this inbox", "Remove it", "Rebuild this page", "Rebuild again", "Rebuild all…", "Use build mode"];

/** Everything on the page that would offer build mode, or a change to the site's settings file, to this person. */
function offered(): { build: string[]; settings: string[] } {
  const buttons = [...document.querySelectorAll<HTMLElement>("button, a")].map((element) => (element.textContent ?? "").trim());
  const build = [...BUILD_OFFERS.filter((words) => buttons.includes(words)), ...(document.querySelector(BUILD_TOGGLE) ? ["the assistant's build mode"] : [])];
  const settings = [
    ...(document.querySelector(".redir-host") ? ["where the site is hosted"] : []),
    ...(byText(document.querySelector(".redir-where__host") ?? document.createElement("div"), "button", "Change") ? ["changing the host"] : []),
    ...buttons.filter((words) => words === "Open Site settings › Assistant"),
  ];
  return { build, settings };
}

describe.each<Role>(["editor", "contributor"])("a walk through every screen as the %s, on a site that allows build mode", (role) => {
  it("offers only what the role's levels include, and makes no refused call", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role });
    const id = allowBuild(server);
    const base = `/sites/${id}`;
    page = await renderApp(server, base);
    await until(() => expect(page?.text()).toContain("Site home"));
    const seen: Array<{ path: string; build: string[]; settings: string[] }> = [];
    for (const path of [base, `${base}/proof`, `${base}/media`, `${base}/forms`, `${base}/scripts`, `${base}/brand`, `${base}/visibility`, `${base}/history`, `${base}/online`, `${base}/redirects`, `${base}/import`, "/account"]) {
      await go(path);
      await until(() => expect(window.location.pathname).toBe(path));
      await settle(400);
      seen.push({ path, ...offered() });
    }
    await openEditor(server, base);
    seen.push({ path: "the editor", ...offered() });
    await go(`${base}/forms`);
    await settle(400);
    for (const form of [...new Set([...document.querySelectorAll<HTMLAnchorElement>(`main a[href^="${base}/forms/"]`)].map((link) => link.getAttribute("href") ?? ""))]) {
      await go(form);
      await settle(500);
      seen.push({ path: form, ...offered() });
    }
    for (const screen of seen) {
      if (!roleMay(role, BUILD_MODE_LEVEL)) expect(screen.build, screen.path).toEqual([]);
      if (!roleMay(role, SITE_SETTINGS_LEVEL)) expect(screen.settings, screen.path).toEqual([]);
    }
    // The editor may: the assistant's build mode is there for them.
    if (roleMay(role, BUILD_MODE_LEVEL)) expect(seen.find((screen) => screen.path === "the editor")?.build).toContain("the assistant's build mode");
    await settle(300);
    expect(refusals(server)).toEqual([]);
  });
});

describe("when the server refuses build mode anyway", () => {
  it("shows its sentence, and the panel then offers content mode only", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role: "editor" });
    const id = allowBuild(server);
    page = await renderApp(server, `/sites/${id}`);
    await until(() => expect(page?.text()).toContain("Site home"));
    await openEditor(server, `/sites/${id}`);
    // Build mode, as this editor may: the first time asks first.
    await click(byText(document.querySelector(BUILD_TOGGLE) ?? document, '[role="radio"]', "Build"));
    const confirm = [...document.querySelectorAll("dialog")].find((element) => element.open);
    await click(byText(confirm ?? document, "button", "Use build mode"));
    await until(() => expect(document.querySelector(`${BUILD_TOGGLE} [aria-checked="true"]`)?.textContent).toBe("Build"));
    // An owner makes this editor a contributor while the panel is open.
    const me = server.accounts?.current();
    if (!me) throw new Error("Not signed in");
    me.role = "contributor";
    await type(document.querySelector('section[aria-label="Assistant"] textarea'), "Make the header sticky");
    await click(byText(document.querySelector('section[aria-label="Assistant"]') ?? document, "button", /^Send/));
    await until(() => expect(page?.text()).toContain(BUILD_REFUSAL));
    expect(refusals(server).some((call) => call.endsWith("/threads") || call.endsWith("/messages"))).toBe(true);
    // Who is signed in is asked again: the toggle goes, and the next request is in content mode.
    await until(() => expect(document.querySelector(BUILD_TOGGLE)).toBeNull());
  });
});

describe("local mode", () => {
  it("offers build mode as before when the site allows it", async () => {
    const server = await startServer({ mode: "local" });
    const first = [...server.backend.sites.values()][0];
    if (!first) throw new Error("The local mock has no sites");
    const site = (server.backend.sites as unknown as Map<string, MockSiteLike>).get(first.id)!;
    site.config = { ...(site.config ?? {}), ai: { allowBuild: true } };
    page = await renderApp(server, `/sites/${first.id}`);
    await until(() => expect(page?.text()).toContain("Site home"));
    await openEditor(server, `/sites/${first.id}`);
    expect(document.querySelector(BUILD_TOGGLE)).not.toBeNull();
    expect(page.text()).not.toMatch(/An editor or owner|An owner of this editor/);
  });
});
