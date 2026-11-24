// @vitest-environment happy-dom
/**
 * The Install page against the mock install: what it shows, and each action —
 * a new key (after a warning), the backup download's request and file,
 * restore's warning. With accounts, who can sign in is People
 * (accounts-people.test.ts) and each person's password is in Your account; a
 * server from before accounts keeps the one password and "Sign out
 * everywhere" here, as it always did.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { byText, click, field, renderApp, saved, startServer, submit, type, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

function calls(server: MockServer, method: string, path: string) {
  return server.log.filter((entry) => entry.method === method && entry.path === path);
}

async function open(options: { accounts?: boolean } = {}): Promise<MockServer> {
  const server = await startServer({ mode: "hosted", setup: "done", ...options });
  server.backend.authenticated = true;
  page = await renderApp(server, "/install");
  await until(() => expect(page?.text()).toContain("What is stored where"));
  return server;
}

function dialog(): HTMLDialogElement {
  const found = [...document.querySelectorAll("dialog")].find((element) => element.open);
  if (!found) throw new Error("No dialog is open");
  return found;
}

describe("the Install page", () => {
  it("shows the address, version, repository and key, the publishing name, and what is stored where", async () => {
    const server = await open();
    const text = page?.text() ?? "";
    expect(text).toContain("https://cms.example.com");
    expect(text).toContain("git@github.com:example/site.git");
    expect(text).toContain("This editor’s own key");
    expect((document.querySelector('textarea[aria-label="This editor’s public key"]') as HTMLTextAreaElement).value).toMatch(/^ssh-ed25519 /);
    // Each person publishes under their own name, changed in Your account.
    expect(text).toContain("the name and e-mail of the person who published it");
    expect(byText(document, "a", "Your account")?.getAttribute("href")).toBe("/account");
    expect(text).toContain("People");
    expect(text).toContain("/data");
    expect(text).toContain("Previews are the site’s own code, running on this server.");
    const rows = [...document.querySelectorAll(".install-table tbody tr")];
    expect(rows.length).toBe(server.install ? 10 : 0);
    expect(rows.some((row) => row.textContent?.includes("Not carried"))).toBe(true);
    for (const word of ["commit", "branch", "deploy", "container", "token"]) expect(text.toLowerCase()).not.toContain(word);
  });

  it("makes a new key only after saying the old one stops working", async () => {
    const server = await open();
    const before = (document.querySelector('textarea[aria-label="This editor’s public key"]') as HTMLTextAreaElement).value;
    await click(byText(document, "button", "Make a new key…"));
    await until(() => expect(dialog().textContent).toContain("stops working at once"));
    expect(calls(server, "POST", "/api/setup/deploy-key")).toHaveLength(0);
    await click(byText(dialog(), "button", "Make a new key"));
    await until(() => expect(calls(server, "POST", "/api/setup/deploy-key")[0]?.body).toEqual({ rotate: true }));
    await until(() => expect((document.querySelector('textarea[aria-label="This editor’s public key"]') as HTMLTextAreaElement).value).not.toBe(before));
  });

  it("keeps the one password and “Sign out everywhere” on a server from before accounts", async () => {
    const server = await open({ accounts: false });
    expect(byText(document, "a", "App settings › You")?.getAttribute("href")).toBe("/settings#you");
    expect(page?.text()).not.toContain("People");
  });

  it("changes the password, saying other browsers are signed out, and shows the server's sentence when the current one is wrong (a server from before accounts)", async () => {
    const server = await open({ accounts: false });
    expect(page?.text()).toContain("signs out every other browser");
    await type(field(document, "Current password"), "not it");
    await type(field(document, "New password"), "a brand new password");
    await type(field(document, "New password again"), "a brand new password");
    await submit(field(document, "Current password"));
    await until(() => expect(page?.text()).toContain("That isn’t the current password."));
    // Refused, not signed out.
    expect(window.location.pathname).toBe("/install");

    await type(field(document, "Current password"), "proof");
    await submit(field(document, "Current password"));
    await until(() => expect(server.install?.password).toBe("a brand new password"));
    expect(calls(server, "POST", "/api/install/password").at(-1)?.body).toEqual({ current: "proof", next: "a brand new password" });
  });

  it("signs out everywhere only after a confirmation, then asks for the password (a server from before accounts)", async () => {
    const server = await open({ accounts: false });
    await click(byText(document, "button", "Sign out everywhere…"));
    await until(() => expect(dialog().textContent).toContain("this one included"));
    expect(calls(server, "POST", "/api/auth/logout-all")).toHaveLength(0);
    await click(byText(dialog(), "button", "Sign out everywhere"));
    await until(() => expect(window.location.pathname).toBe("/login"));
    expect(calls(server, "POST", "/api/auth/logout-all")).toHaveLength(1);
    expect(server.backend.authenticated).toBe(false);
  });

  it("downloads a backup sealed with a passphrase typed twice, outside the JSON client", async () => {
    const server = await open();
    expect(page?.text()).toContain("No backup has been downloaded yet.");
    await click(byText(document, "button", "Download a backup…"));
    await until(() => expect(dialog().textContent).toContain("can’t be recovered"));
    expect(dialog().textContent).toContain("unpublished changes");
    expect(dialog().textContent).toContain("keys stored here");

    await type(field(dialog(), "Passphrase"), "a long backup passphrase");
    await type(field(dialog(), "The same passphrase again"), "a different one entirely");
    await click(byText(dialog(), "button", "Download backup"));
    expect(dialog().textContent).toContain("The two passphrases don’t match.");
    expect(calls(server, "POST", "/api/install/backup")).toHaveLength(0);

    await type(field(dialog(), "The same passphrase again"), "a long backup passphrase");
    saved.length = 0;
    await click(byText(dialog(), "button", "Download backup"));
    await until(() => expect(saved).toHaveLength(1));
    const [request] = calls(server, "POST", "/api/install/backup");
    expect(request?.body).toEqual({ passphrase: "a long backup passphrase" });
    expect(request?.contentType).toBe("application/json");
    expect(saved[0]?.name).toMatch(/^galley-backup-\d{4}-\d{2}-\d{2}\.bin$/);
    expect(saved[0]?.size).toBeGreaterThan(0);
    await until(() => expect(page?.text()).toContain("Last backup downloaded"));
  });

  it("warns that restoring replaces what is here before anything is uploaded", async () => {
    const server = await open();
    await click(byText(document, "button", "Restore from a backup…"));
    await until(() => expect(dialog().textContent).toContain("replaces everything this editor keeps"));
    expect(calls(server, "POST", "/api/install/restore/upload")).toHaveLength(0);
  });

  it("isn't there in local mode", async () => {
    const server = await startServer({ mode: "local" });
    page = await renderApp(server, "/install");
    await until(() => expect(page?.text()).toContain("Nothing lives at this address."));
    expect(server.log.some((entry) => entry.path === "/api/install")).toBe(false);
  });
});
