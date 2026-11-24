// @vitest-environment happy-dom
/**
 * Getting in on a hosted install with accounts: signing in with an e-mail
 * and password (or the password alone, on an install from before accounts),
 * "Forgot your password?" with and without outgoing e-mail, the pages a
 * one-time link opens (an invitation, a new password — the code leaves the
 * address bar at once), and the question an owner from before accounts is
 * asked once after signing in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { byText, click, field, refusals, renderApp, settle, startServer, submit, type, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

const WRONG = "That e-mail and password don’t match an account here. Try again.";
const SENT = "If that address has an account here, a link is on its way.";
const NEW_PASSWORD = "a long new password";

function calls(server: MockServer, method: string, path: string) {
  return server.log.filter((entry) => entry.method === method && entry.path === path);
}

/** A link an owner made, read from the mock as the person would receive it. */
async function inviteLink(server: MockServer, role: "editor" | "contributor" = "editor"): Promise<string> {
  const accounts = server.accounts as unknown as { inviteBy: (body: { email: string; role: string }) => { link: { url: string } } };
  // The mock makes an invitation as the signed-in owner; nobody is signed in in these tests, so stand in for the owner for a moment.
  const before = { authenticated: server.backend.authenticated };
  server.backend.authenticated = true;
  const { link } = accounts.inviteBy({ email: "ana@example.com", role });
  server.backend.authenticated = before.authenticated;
  return link.url;
}

function pathOf(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.hash;
}

describe("signing in", () => {
  it("asks for an e-mail and password, gives one answer for either being wrong, then opens the site as that person", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    page = await renderApp(server, "/login");
    await until(() => expect(page?.text()).toContain("Sign in to edit."));
    expect(field(document, "E-mail")).not.toBeNull();
    expect(page.text()).toContain("ask an owner of this editor for an invitation");

    // Nothing typed: said at once, nothing sent.
    await submit(field(document, "Password"));
    expect(page.text()).toContain("Enter your e-mail and password.");
    expect(calls(server, "POST", "/api/auth/login")).toHaveLength(0);

    // A wrong password, and an e-mail nobody has: the same sentence.
    await type(field(document, "E-mail"), "robin@example.com");
    await type(field(document, "Password"), "not it");
    await submit(field(document, "Password"));
    await until(() => expect(page?.text()).toContain(WRONG));
    await type(field(document, "E-mail"), "nobody@example.com");
    await type(field(document, "Password"), "proof");
    await submit(field(document, "Password"));
    await until(() => expect(calls(server, "POST", "/api/auth/login")).toHaveLength(2));
    await settle();
    expect(page.text()).toContain(WRONG);

    // A switched-off person can't get in either, with the same words.
    await type(field(document, "E-mail"), "kim@example.com");
    await submit(field(document, "Password"));
    await until(() => expect(calls(server, "POST", "/api/auth/login")).toHaveLength(3));
    expect(page.text()).toContain(WRONG);

    await type(field(document, "E-mail"), " Robin@Example.com ");
    await type(field(document, "Password"), "proof");
    await submit(field(document, "Password"));
    await until(() => expect(window.location.pathname).toMatch(/^\/sites\//));
    expect(calls(server, "POST", "/api/auth/login").at(-1)?.body).toEqual({ email: "robin@example.com", password: "proof" });
    await until(() => expect(document.querySelector(".accounts-menu")?.getAttribute("aria-label")).toBe("Signed in as Robin Park. Your account"));
  });

  it("asks for the password alone on an install from before accounts", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", legacy: true });
    page = await renderApp(server, "/login");
    await until(() => expect(page?.text()).toContain("Sign in to edit."));
    expect(field(document, "E-mail")).toBeNull();
    expect(byText(document, "button", "Forgot your password?")).toBeNull();
    await type(field(document, "Password"), "wrong");
    await submit(field(document, "Password"));
    await until(() => expect(page?.text()).toContain("That password isn’t right. Try again."));
    await type(field(document, "Password"), "proof");
    await submit(field(document, "Password"));
    await until(() => expect(window.location.pathname).toMatch(/^\/sites\//));
    expect(calls(server, "POST", "/api/auth/login").at(-1)?.body).toEqual({ password: "proof" });
  });
});

describe("forgot your password", () => {
  it("with outgoing e-mail: always ends on the same sentence, sent or not", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", email: true });
    for (const address of ["robin@example.com", "nobody@example.com"]) {
      page = await renderApp(server, "/login");
      await until(() => expect(byText(document, "button", "Forgot your password?")).not.toBeNull());
      await click(byText(document, "button", "Forgot your password?"));
      await until(() => expect(page?.text()).toContain("Give the e-mail you sign in with."));
      await type(field(document, "E-mail"), address);
      await click(byText(document, "button", "Send the link"));
      await until(() => expect(page?.text()).toContain(SENT));
      await page.unmount();
      page = null;
    }
    expect(calls(server, "POST", "/api/auth/forgot").map((entry) => entry.body)).toEqual([{ email: "robin@example.com" }, { email: "nobody@example.com" }]);
    // Only the person who has an account got a link.
    expect(server.accounts?.outbox.filter((mail) => mail.kind === "password").map((mail) => mail.to)).toEqual(["robin@example.com"]);
  });

  it("without outgoing e-mail: one line, ask an owner, and nothing is sent", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    page = await renderApp(server, "/login");
    await until(() => expect(byText(document, "button", "Forgot your password?")).not.toBeNull());
    await click(byText(document, "button", "Forgot your password?"));
    await until(() => expect(page?.text()).toContain("Ask an owner of this editor for a new-password link."));
    expect(field(document, "E-mail")).toBeNull();
    expect(calls(server, "POST", "/api/auth/forgot")).toHaveLength(0);
    await click(byText(document, "button", "Back to sign in"));
    await until(() => expect(page?.text()).toContain("Sign in to edit."));
  });
});

describe("a one-time link", () => {
  it("an invitation: the code leaves the address bar at once, the page says what it is for, and joining signs this browser in as the new person", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    const url = await inviteLink(server, "editor");
    const code = new URL(url).hash.slice(1);
    page = await renderApp(server, pathOf(url));
    // Gone before the page has even checked it, and never in the history either.
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(code);
    await until(() => expect(page?.text()).toContain("You’re invited."));
    expect(page.text()).toContain("Sam Rivera invited ana@example.com to edit this site as Editor.");
    expect(page.text()).toContain("Editor: Edits the site, checks changes in Proof, publishes, and reads the inbox.");
    expect(calls(server, "POST", "/api/auth/link/check")[0]?.body).toEqual({ code });
    // The code went in a request body, never in an address.
    expect(server.log.some((entry) => entry.path.includes(code) || entry.search.includes(code))).toBe(false);

    // A name and a password typed twice, with the usual rules.
    await type(field(document, "Password"), "short");
    await type(field(document, "The same password again"), "short");
    await submit(field(document, "Password"));
    expect(page.text()).toContain("Enter a name.");
    expect(page.text()).toContain("Use at least 12 characters.");
    expect(calls(server, "POST", "/api/auth/link")).toHaveLength(0);

    await type(field(document, "Your name"), "Ana Ruiz");
    await type(field(document, "Password"), NEW_PASSWORD);
    await type(field(document, "The same password again"), NEW_PASSWORD);
    await submit(field(document, "Password"));
    await until(() => expect(window.location.pathname).toMatch(/^\/sites\//));
    expect(calls(server, "POST", "/api/auth/link")[0]?.body).toEqual({ code, password: NEW_PASSWORD, name: "Ana Ruiz" });
    expect(server.accounts?.current()?.email).toBe("ana@example.com");
    expect(server.accounts?.current()?.role).toBe("editor");
    await until(() => expect(document.querySelector(".accounts-menu")?.getAttribute("aria-label")).toBe("Signed in as Ana Ruiz. Your account"));
    await settle();
    expect(refusals(server)).toEqual([]);

    // Used: the same link now gets the calm page.
    await page.unmount();
    page = await renderApp(server, pathOf(url));
    await until(() => expect(page?.text()).toContain("This link can’t be used."));
    expect(page.text()).toContain("Ask whoever sent it for a new one.");
  });

  it("a new-password link: says whose it is, sets the password, signs in", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    const accounts = server.accounts as unknown as { passwordLink: (id: string) => { url: string }; accounts: Array<{ id: string; email: string; password: string }> };
    const robin = accounts.accounts.find((person) => person.email === "robin@example.com");
    if (!robin) throw new Error("No Robin in the mock");
    const url = accounts.passwordLink(robin.id).url;
    expect(new URL(url).pathname).toBe("/new-password");
    page = await renderApp(server, pathOf(url));
    expect(window.location.hash).toBe("");
    await until(() => expect(page?.text()).toContain("Choose a new password."));
    expect(page.text()).toContain("For robin@example.com.");
    expect(field(document, "Your name")).toBeNull();
    await type(field(document, "New password"), NEW_PASSWORD);
    await type(field(document, "The same password again"), NEW_PASSWORD);
    await submit(field(document, "New password"));
    await until(() => expect(window.location.pathname).toMatch(/^\/sites\//));
    expect(robin.password).toBe(NEW_PASSWORD);
    expect(server.accounts?.current()?.email).toBe("robin@example.com");
  });

  it.each(["/join#not-a-real-code", "/new-password#not-a-real-code", "/join"])("a bad link (%s): one calm page that says what to do", async (path) => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    page = await renderApp(server, path);
    await until(() => expect(page?.text()).toContain("This link can’t be used."));
    expect(page.text()).toContain("It may have been used already, taken back, or run out of time. Ask whoever sent it for a new one.");
    expect(window.location.hash).toBe("");
    expect(page.text()).not.toMatch(/Couldn’t|404|token|invalid/i);
    expect(window.location.pathname).toBe(path.split("#")[0]);
  });

  it("too many tries from here (429, the mock's limit as the server's): says to wait, never that the link is bad, and the link still works after", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    const accounts = server.accounts!;
    const url = await inviteLink(server, "editor");
    /** Five bad codes from this browser, as someone guessing would send: the sixth try of anything waits out the minute. */
    const guess = async () => {
      for (let i = 0; i < 5; i += 1) {
        const answer = await server.handle({ method: "POST", url: "/api/auth/link/check", headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ code: `guess-${i}` })) });
        expect(answer.status).toBe(404);
      }
    };
    let later = 0;
    const minuteOn = () => {
      later += 61_000;
      accounts.now = () => Date.now() + later;
    };

    await guess();
    page = await renderApp(server, pathOf(url));
    await until(() => expect(page?.text()).toContain("Wait a minute."));
    expect(page.text()).toContain("Too many tries from here. Wait a minute, then try again.");
    expect(page.text()).not.toContain("This link can’t be used.");
    expect(calls(server, "POST", "/api/auth/link/check").at(-1)?.status).toBe(429);
    minuteOn();
    await click(byText(document, "button", "Try again"));
    await until(() => expect(page?.text()).toContain("You’re invited."));

    await guess();
    await type(field(document, "Your name"), "Ana Ruiz");
    await type(field(document, "Password"), NEW_PASSWORD);
    await type(field(document, "The same password again"), NEW_PASSWORD);
    await submit(field(document, "Password"));
    await until(() => expect(page?.text()).toContain("Too many tries from here. Wait a minute, then try again."));
    expect(calls(server, "POST", "/api/auth/link").at(-1)?.status).toBe(429);
    expect(page.text()).not.toContain("This link can’t be used.");
    expect(page.text()).toContain("You’re invited.");
    minuteOn();
    await submit(field(document, "Password"));
    await until(() => expect(window.location.pathname).toMatch(/^\/sites\//));
    expect(accounts.current()?.email).toBe("ana@example.com");
  });

  it("an invitation as a contributor: the name's hint doesn't say it goes on what they publish", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    page = await renderApp(server, pathOf(await inviteLink(server, "contributor")));
    await until(() => expect(page?.text()).toContain("You’re invited."));
    expect(page.text()).toContain("The others who use this editor see it");
    expect(page.text()).not.toMatch(/you publish/);
  });

  it("an invitation as an editor: the name goes with everything they publish", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    page = await renderApp(server, pathOf(await inviteLink(server, "editor")));
    await until(() => expect(page?.text()).toContain("You’re invited."));
    expect(page.text()).toContain("It goes with everything you publish");
  });

  it("is not there in local mode", async () => {
    const server = await startServer({ mode: "local" });
    page = await renderApp(server, "/join#whatever");
    await until(() => expect(page?.text()).toContain("Nothing lives at this address."));
    expect(server.log.some((entry) => entry.path.startsWith("/api/auth/link"))).toBe(false);
  });
});

describe("an owner from before accounts", () => {
  it("is asked once, right after signing in, for a name and e-mail — can skip it, and is asked again next time", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", legacy: true });
    page = await renderApp(server, "/login");
    await until(() => expect(page?.text()).toContain("Sign in to edit."));
    await type(field(document, "Password"), "proof");
    await submit(field(document, "Password"));
    await until(() => expect(page?.text()).toContain("Add your name and e-mail"));
    expect(page.text()).toContain("People now sign in to this editor with their own e-mail and password");
    await click(byText(document, "button", "Not now"));
    await until(() => expect([...document.querySelectorAll("dialog")].some((element) => element.open)).toBe(false));
    expect(calls(server, "PATCH", "/api/account")).toHaveLength(0);

    // Next time the app opens, it asks again.
    await page.unmount();
    page = await renderApp(server, "/");
    await until(() => expect(page?.text()).toContain("Add your name and e-mail"));
    const dialog = [...document.querySelectorAll("dialog")].find((element) => element.open) as HTMLElement;
    await type(field(dialog, "Name"), "Sam Rivera");
    await type(field(dialog, "E-mail"), "sam@example.com");
    await click(byText(dialog, "button", "Save"));
    expect(dialog.textContent).toContain("Enter the password you signed in with.");
    expect(calls(server, "PATCH", "/api/account")).toHaveLength(0);
    await type(field(dialog, "Current password"), "not it");
    await click(byText(dialog, "button", "Save"));
    await until(() => expect(dialog.textContent).toContain("That isn't your current password."));
    await type(field(dialog, "Current password"), "proof");
    await click(byText(dialog, "button", "Save"));
    await until(() => expect([...document.querySelectorAll("dialog")].some((element) => element.open)).toBe(false));
    expect(calls(server, "PATCH", "/api/account").at(-1)?.body).toEqual({ name: "Sam Rivera", email: "sam@example.com", password: "proof" });
    expect(server.accounts?.current()?.incomplete).toBeUndefined();

    // From now on the sign-in page asks for the e-mail.
    await page.unmount();
    server.backend.authenticated = false;
    page = await renderApp(server, "/login");
    await until(() => expect(field(document, "E-mail")).not.toBeNull());
  });
});
