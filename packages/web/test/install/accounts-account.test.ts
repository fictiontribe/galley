// @vitest-environment happy-dom
/**
 * Your account, for everyone on a hosted install: reached from the account
 * menu in the header (which says who is signed in); name and e-mail (an
 * owner's new e-mail asks for the current password; everyone else's is an
 * owner's to change, in People); the role in words; the password;
 * signing yourself out everywhere; and, for someone who doesn't look after
 * the editor's settings, the theme kept in this browser. Publishes carry the
 * signed-in person's own name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { byText, click, field, refusals, renderApp, settle, startServer, submit, type, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

function calls(server: MockServer, method: string, path: string) {
  return server.log.filter((entry) => entry.method === method && entry.path === path);
}

function openDialog(): HTMLDialogElement {
  const found = [...document.querySelectorAll("dialog")].find((element) => element.open);
  if (!found) throw new Error("No dialog is open");
  return found;
}

async function open(role: "owner" | "editor" | "contributor"): Promise<MockServer> {
  const server = await startServer({ mode: "hosted", setup: "done", role });
  page = await renderApp(server, "/account");
  await until(() => expect(page?.text()).toContain("Your account"));
  await until(() => expect(field(document, "Name")).not.toBeNull());
  return server;
}

describe("Your account", () => {
  it("is in the account menu, which says who is signed in", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role: "contributor" });
    page = await renderApp(server, `/sites/${server.install?.site.id ?? ""}`);
    await until(() => expect(document.querySelector(".accounts-menu")).not.toBeNull());
    const button = document.querySelector(".accounts-menu") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Signed in as Jo Chen. Your account");
    expect(button.textContent).toContain("JC");
    await click(button);
    await until(() => expect(document.querySelector('[role="menu"]')?.textContent).toContain("Jo Chen · Contributor"));
    await click(byText(document, '[role="menuitem"]', "Your account"));
    await until(() => expect(window.location.pathname).toBe("/account"));
    await until(() => expect(page?.text()).toContain("Signed in as jo@example.com."));
  });

  it("shows the role in words, with what it allows", async () => {
    await open("contributor");
    expect(page?.text()).toContain("Contributor");
    expect(page?.text()).toContain("Edits the site and sees changes in Proof. An editor or owner publishes them.");
  });

  it("says what the name is for, true to the role: on every publish, or what the others see", async () => {
    await open("contributor");
    expect(page?.text()).toContain("Your name is how the others who use this editor know you.");
    expect(page?.text()).not.toContain("every version you publish");
    await page?.unmount();
    page = null;
    await open("editor");
    // `open` sets `page` again; the compiler can't see that through the call.
    expect((page as Rendered | null)?.text()).toContain("Your name and e-mail go with every version you publish, in Version history.");
  });

  it("changes the name at once; an owner changes their own e-mail only with the current password", async () => {
    const editor = await open("editor");
    await type(field(document, "Name"), "Robin P. Park");
    await submit(field(document, "Name"));
    await until(() => expect(calls(editor, "PATCH", "/api/account")).toHaveLength(1));
    expect(calls(editor, "PATCH", "/api/account")[0]?.body).toEqual({ name: "Robin P. Park" });
    await until(() => expect(document.querySelector(".accounts-menu")?.getAttribute("aria-label")).toBe("Signed in as Robin P. Park. Your account"));
    await page?.unmount();
    page = null;

    const server = await open("owner");
    await type(field(document, "E-mail"), "sam@example.org");
    await until(() => expect(field(document, "Current password")).not.toBeNull());
    await submit(field(document, "E-mail"));
    // `open` sets `page` again; the compiler can't see that through the call.
    expect((page as Rendered | null)?.text()).toContain("Enter your current password to change your e-mail.");
    expect(calls(server, "PATCH", "/api/account")).toHaveLength(0);
    await type(field(document, "Current password"), "not it");
    await submit(field(document, "E-mail"));
    await until(() => expect(page?.text()).toContain("That isn't your current password."));
    await type(field(document, "Current password"), "proof");
    await submit(field(document, "E-mail"));
    await until(() => expect(server.accounts?.current()?.email).toBe("sam@example.org"));
    expect(calls(server, "PATCH", "/api/account").at(-1)?.body).toEqual({ name: "Sam Rivera", email: "sam@example.org", password: "proof" });
  });

  it.each<"editor" | "contributor">(["editor", "contributor"])("as the %s: the e-mail is shown, not editable, with who can change it — and saving sends no e-mail", async (role) => {
    const server = await open(role);
    const email = field(document, "E-mail");
    expect(email?.readOnly).toBe(true);
    expect(email?.value).toBe(server.accounts?.current()?.email);
    expect(page?.text()).toContain("An owner of this editor can change it");
    await type(field(document, "Name"), "A new name");
    await submit(field(document, "Name"));
    await until(() => expect(calls(server, "PATCH", "/api/account")).toHaveLength(1));
    expect(calls(server, "PATCH", "/api/account")[0]?.body).toEqual({ name: "A new name" });
    expect(refusals(server)).toEqual([]);
  });

  it("changes the password, saying other browsers are signed out", async () => {
    const server = await open("contributor");
    expect(page?.text()).toContain("signs you out of your other browsers");
    await type(field(document, "Current password"), "not it");
    await type(field(document, "New password"), "a brand new password");
    await type(field(document, "New password again"), "a brand new password");
    await submit(field(document, "Current password"));
    await until(() => expect(page?.text()).toContain("That isn't the current password."));
    expect(window.location.pathname).toBe("/account");
    await type(field(document, "Current password"), "proof");
    await submit(field(document, "Current password"));
    await until(() => expect(server.accounts?.current()?.password).toBe("a brand new password"));
    expect(calls(server, "POST", "/api/account/password").at(-1)?.body).toEqual({ current: "proof", next: "a brand new password" });
  });

  it("signs you out everywhere after a confirmation that says others stay signed in", async () => {
    const server = await open("editor");
    await click(byText(document, "button", "Sign out everywhere…"));
    await until(() => expect(openDialog().textContent).toContain("Other people stay signed in."));
    await click(byText(openDialog(), "button", "Sign out everywhere"));
    await until(() => expect(window.location.pathname).toBe("/login"));
    expect(calls(server, "POST", "/api/auth/logout-all")).toHaveLength(1);
  });

  it("keeps the theme in this browser for someone who doesn't look after the settings, and saves nothing", async () => {
    const server = await open("contributor");
    const dark = byText(document, '[role="radio"]', "Dark") ?? byText(document, "button", "Dark");
    await click(dark);
    await settle();
    expect(JSON.parse(localStorage.getItem("galley.ui") ?? "{}").state?.theme).toBe("dark");
    // Coming back to the window reads the editor's settings again, and leaves this person's theme alone.
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await until(() => expect(server.log.filter((entry) => entry.path === "/api/settings").length).toBeGreaterThan(1));
    await settle();
    expect(JSON.parse(localStorage.getItem("galley.ui") ?? "{}").state?.theme).toBe("dark");
    expect(calls(server, "PATCH", "/api/settings")).toHaveLength(0);
    expect(refusals(server)).toEqual([]);
  });

  it("leaves the theme to App settings for an owner", async () => {
    await open("owner");
    expect(byText(document, '[role="radio"]', "Dark") ?? byText(document, "button", "Dark")).toBeNull();
  });
});

describe("a publish", () => {
  it("carries the name of whoever published it", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", role: "editor" });
    const siteId = server.install?.site.id ?? "";
    // Publish straight through the mock as the signed-in editor, then read Version history.
    const answer = await server.handle({ method: "POST", url: `/api/sites/${siteId}/publish`, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ message: "Fix the footer" })) });
    expect(answer.status).toBe(200);
    expect(JSON.parse(String(answer.body)).ok).toBe(true);
    page = await renderApp(server, `/sites/${siteId}/history`);
    await until(() => expect(document.querySelector(".app-version .app-version__meta")?.textContent).toContain("Robin Park"));
    // And the publish dialog says so before anything is published.
    const git = await server.handle({ method: "GET", url: `/api/sites/${siteId}/git`, headers: {} });
    expect(JSON.parse(String(git.body)).author).toEqual({ name: "Robin Park", email: "robin@example.com", from: "account" });
  });
});
