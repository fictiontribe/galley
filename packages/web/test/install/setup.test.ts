// @vitest-environment happy-dom
/**
 * First run, step by step, against the mock install: the setup code leaves
 * the address bar at once and goes only to first-run routes; the owner's
 * account (name, e-mail, password);
 * connecting the site (waiting for the key, a failure, a reload mid-way);
 * the details, with what the operator fixed; done; and restoring a backup
 * instead.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIN_INSTALL_PASSWORD_LENGTH } from "@galley/core/install/types";
import { ACCOUNTS_PUBLISHING_LINE } from "../../src/features/install/setup/DetailsStep";
import { byText, click, field, renderApp, settle, startServer, submit, type, until, type MockServer, type Rendered } from "./harness";

const CODE = "mock-setup-code-not-a-secret";
const PASSWORD = "correct horse battery";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

function calls(server: MockServer, method: string, path: string) {
  return server.log.filter((entry) => entry.method === method && entry.path === path);
}

async function choosePassword(): Promise<void> {
  await type(field(document, "Your name"), "Sam Rivera");
  await type(field(document, "E-mail"), "Sam@Example.com");
  await type(field(document, "Password"), PASSWORD);
  await type(field(document, "The same password again"), PASSWORD);
  await submit(field(document, "Password"));
}

describe("first run", () => {
  it("takes the code out of the address bar at once and sends it only to first-run routes, until the password signs this browser in", async () => {
    const server = await startServer({ mode: "hosted", setup: "password" });
    page = await renderApp(server, `/setup?token=${CODE}`);
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain(CODE);
    await until(() => expect(page?.text()).toContain("Create your account."));
    expect(localStorage.length + sessionStorage.length).toBe(0);

    // Too short, then not the same twice: said under the form, nothing sent.
    await type(field(document, "Password"), "short");
    await type(field(document, "The same password again"), "short");
    await submit(field(document, "Password"));
    expect(page.text()).toContain(`Use at least ${MIN_INSTALL_PASSWORD_LENGTH} characters.`);
    await type(field(document, "Password"), PASSWORD);
    await type(field(document, "The same password again"), `${PASSWORD}!`);
    await submit(field(document, "Password"));
    expect(page.text()).toContain("The two passwords don’t match.");
    expect(calls(server, "POST", "/api/setup/password")).toHaveLength(0);

    await choosePassword();
    await until(() => expect(page?.text()).toContain("Connect the site."));
    const [sent] = calls(server, "POST", "/api/setup/password");
    expect(sent?.body).toEqual({ name: "Sam Rivera", email: "sam@example.com", password: PASSWORD });
    // The owner exists, and this browser is signed in as them.
    expect(server.accounts?.current()?.email).toBe("sam@example.com");
    expect(server.accounts?.current()?.role).toBe("owner");
    expect(server.backend.authenticated).toBe(true);
    await settle();

    const withCode = server.log.filter((entry) => entry.authorization === `Bearer ${CODE}`).map((entry) => `${entry.method} ${entry.path}`);
    expect(withCode).toEqual(["GET /api/setup", "POST /api/setup/password"]);
    // Nothing else ever carried it — not /api/meta, not the site list, not settings.
    expect(server.log.filter((entry) => entry.authorization !== null && !entry.path.startsWith("/api/setup"))).toEqual([]);
    expect(page.text()).not.toContain(PASSWORD);
  });

  it("explains a missing link, and a used or wrong one", async () => {
    let server = await startServer({ mode: "hosted", setup: "password" });
    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain("Open the setup link to begin."));
    expect(page.text()).toContain("printed when it started");
    await page.unmount();
    vi.unstubAllGlobals();

    server = await startServer({ mode: "hosted", setup: "password" });
    page = await renderApp(server, "/setup?token=not-the-code");
    await until(() => expect(page?.text()).toContain("This setup link can’t be used."));
    expect(page.text()).toContain("make a new setup link");
    expect(window.location.pathname).toBe("/setup");
  });

  it("connects an existing repository with the editor's own key, waiting for the key as a normal state", async () => {
    const server = await startServer({ mode: "hosted", setup: "password" });
    page = await renderApp(server, `/setup?token=${CODE}`);
    await until(() => expect(page?.text()).toContain("Create your account."));
    await choosePassword();
    await until(() => expect(page?.text()).toContain("Connect the site."));

    // The recommended way is chosen: the key's public half, Copy, where to add it, "allow write access".
    await until(() => expect(document.querySelector('textarea[aria-label="This editor’s public key"]')).not.toBeNull());
    const key = (document.querySelector('textarea[aria-label="This editor’s public key"]') as HTMLTextAreaElement).value;
    expect(key).toMatch(/^ssh-ed25519 /);
    expect(byText(document, "button", "Copy key")).not.toBeNull();
    expect(page.text()).toContain("Allow write access");
    expect(calls(server, "POST", "/api/setup/deploy-key")[0]?.body).toEqual({});

    await type(field(document, "Repository address"), "git@github.com:example/site.git");
    expect(byText<HTMLAnchorElement>(document, "a", "Open GitHub’s key settings")?.href).toBe("https://github.com/example/site/settings/keys/new");
    await click(byText(document, "button", "Connect"));
    expect(calls(server, "POST", "/api/setup/site")[0]?.body).toEqual({ repository: "git@github.com:example/site.git", folder: "", access: "deploy-key" });

    // The key wasn't added yet: a state to wait in, with Check again — not an error.
    await until(() => expect(page?.text()).toContain("Waiting for the key."));
    expect(page.text()).not.toContain("Couldn’t");
    await click(byText(document, "button", "Check again"));
    await until(() => expect(page?.text()).toContain("A few details."));
    expect(calls(server, "POST", "/api/setup/site/check")).toHaveLength(1);
    expect(calls(server, "POST", "/api/setup/site")).toHaveLength(2);
  });

  it("says what a check found, in plain words, before connecting", async () => {
    const server = await startServer({ mode: "hosted", setup: "site" });
    server.backend.authenticated = true;
    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain("Connect the site."));
    await click(document.querySelector('input[name="setup-access"][value="token"]'));
    await type(field(document, "Repository address"), "https://github.com/example/readonly-site");
    await type(field(document, "Access token"), "fake-access-token-for-tests");
    await click(byText(document, "button", "Check"));
    await until(() => expect(page?.text()).toContain("can’t send changes to it"));
    expect(calls(server, "POST", "/api/setup/site/check")[0]?.body).toEqual({ repository: "https://github.com/example/readonly-site", folder: "", access: "token", token: "fake-access-token-for-tests" });
    expect((byText<HTMLButtonElement>(document, "button", "Connect") as HTMLButtonElement).disabled).toBe(true);

    // A starter needs an empty repository.
    await click(document.querySelector('input[name="setup-source"][value="starter"]'));
    await until(() => expect(document.querySelector('input[name="setup-starter"]')).not.toBeNull());
    await type(field(document, "Repository address"), "https://github.com/example/full-site");
    await click(byText(document, "button", "Check"));
    await until(() => expect(page?.text()).toContain("A starter needs an empty repository"));
  });

  it("sends a folder on the server or a file:// address to the server, and shows the server's own sentence when it refuses", async () => {
    const server = await startServer({ mode: "hosted", setup: "site" });
    server.backend.authenticated = true;
    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain("Connect the site."));

    // Only what can never be an address is stopped before sending.
    await type(field(document, "Repository address"), "site");
    await click(byText(document, "button", "Check"));
    expect(page.text()).toContain("It should look like git@github.com:you/site.git");
    expect(calls(server, "POST", "/api/setup/site/check")).toHaveLength(0);

    const refusal = "Folders on this server can’t be used.";
    await type(field(document, "Repository address"), "/repos/site.git");
    await click(byText(document, "button", "Check"));
    await until(() => expect(page?.text()).toContain(refusal));
    expect(page.text()).not.toContain("doesn’t look like a repository address");
    expect(calls(server, "POST", "/api/setup/site/check").map((entry) => [entry.status, entry.body])).toEqual([[400, { repository: "/repos/site.git", folder: "", access: "deploy-key" }]]);

    await type(field(document, "Repository address"), "file:///repos/site.git");
    await click(byText(document, "button", "Connect"));
    await until(() => expect(page?.text()).toContain(refusal));
    expect(calls(server, "POST", "/api/setup/site").map((entry) => [entry.status, entry.body])).toEqual([[400, { repository: "file:///repos/site.git", folder: "", access: "deploy-key" }]]);
    expect(server.install?.site.state).toBe("none");
  });

  it("connects a folder on the server when the server allows one", async () => {
    const server = await startServer({ mode: "hosted", setup: "site", allowLocalRepositories: true });
    server.backend.authenticated = true;
    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain("Connect the site."));
    await type(field(document, "Repository address"), "file:///repos/site.git");
    await click(byText(document, "button", "Check"));
    await until(() => expect(page?.text()).toContain("The repository answered."));
    expect(calls(server, "POST", "/api/setup/site/check").map((entry) => [entry.status, entry.body])).toEqual([[200, { repository: "file:///repos/site.git", folder: "", access: "deploy-key" }]]);

    await type(field(document, "Repository address"), "/repos/site.git");
    await click(byText(document, "button", "Connect"));
    await until(() => expect(page?.text()).toContain("A few details."));
    expect(calls(server, "POST", "/api/setup/site").map((entry) => [entry.status, entry.body])).toEqual([[200, { repository: "/repos/site.git", folder: "", access: "deploy-key" }]]);
    expect(server.install?.site).toMatchObject({ state: "connected", repository: "/repos/site.git" });
  });

  it("shows a failed connect with what to do, and lets it be tried again", async () => {
    const server = await startServer({ mode: "hosted", setup: "site" });
    server.backend.authenticated = true;
    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain("Connect the site."));
    await click(document.querySelector('input[name="setup-access"][value="token"]'));
    await type(field(document, "Repository address"), "https://github.com/example/fail-site.git");
    await type(field(document, "Access token"), "fake-access-token-for-tests");
    await click(byText(document, "button", "Connect"));
    await until(() => expect(page?.text()).toContain("Couldn’t connect the site."));
    expect(page.text()).toContain("the code host stopped answering part-way");
    expect(page.text()).toContain("Technical details");
    await click(byText(document, "button", "Try again"));
    await until(() => expect(field(document, "Repository address")).not.toBeNull());
    expect((field(document, "Repository address") as HTMLInputElement).value).toBe("https://github.com/example/fail-site.git");
    // The token is never kept: it has to be pasted again.
    expect((field(document, "Access token") as HTMLInputElement).value).toBe("");
    expect(sessionStorage.getItem("galley.setup.site")).not.toContain("fake-access-token");
  });

  it("picks the connect job up again after a reload", async () => {
    // Slow enough that the screen asks for the job itself, not only hears about it.
    const server = await startServer({ mode: "hosted", setup: "site", stepMs: 400 });
    server.backend.authenticated = true;
    if (server.install) server.install.keyAccepted = true;
    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain("Connect the site."));
    await type(field(document, "Repository address"), "git@github.com:example/site.git");
    await click(byText(document, "button", "Connect"));
    await until(() => expect(page?.text()).toContain("Connecting the site…"));
    await page.unmount();

    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain("Connecting the site…"));
    expect(server.install?.site.state).toBe("connecting");
    await until(() => expect(page?.text()).toContain("A few details."), 5000);
    expect(server.log.some((entry) => entry.method === "GET" && entry.path.startsWith("/api/jobs/"))).toBe(true);
  });

  it("asks for the details on one screen, sends only what's needed, and finishes on the site", async () => {
    const server = await startServer({ mode: "hosted", setup: "details" });
    server.backend.authenticated = true;
    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain("A few details."));
    // The install's name, said for what it is now that each person publishes under their own.
    expect(page.text()).toContain(ACCOUNTS_PUBLISHING_LINE);
    await type(field(document, "Name"), "");
    await submit(field(document, "Name"));
    expect(page.text()).toContain("Enter the name to publish under.");
    await type(field(document, "Name"), "Sam");
    await type(field(document, "Email"), "sam@example.com");
    // The site's own settings already name its live address: offered.
    await until(() => expect((field(document, "Live address") as HTMLInputElement).value).toMatch(/^https:\/\//));
    await type(field(document, "Live address"), "https://www.example.com");
    await type(field(document, "Anthropic API key"), "sk-ant-fake-key-for-tests");
    await submit(field(document, "Name"));
    await until(() => expect(page?.text()).toContain("The editor is ready."));

    expect(calls(server, "PUT", "/api/setup/details")[0]?.body).toEqual({ author: { name: "Sam", email: "sam@example.com" }, liveUrl: "https://www.example.com" });
    expect(calls(server, "PUT", "/api/secrets/anthropic")[0]?.body).toEqual({ value: "sk-ant-fake-key-for-tests" });
    expect(calls(server, "POST", "/api/setup/finish")).toHaveLength(1);

    await click(byText(document, "button", "Open the site"));
    await until(() => expect(window.location.pathname).toBe(`/sites/${server.install?.site.id}`));
  });

  it("shows what whoever runs the server set as set there, and doesn't send it", async () => {
    const server = await startServer({ mode: "hosted", setup: "details", fixed: ["author", "liveUrl", "assistantKey"] });
    server.backend.authenticated = true;
    if (server.install) Object.assign(server.install, { author: { name: "Sam", email: "sam@example.com" } });
    page = await renderApp(server, "/setup");
    await until(() => expect(page?.text()).toContain("A few details."));
    expect(page.text()).toContain("Set on the server");
    expect(page.text()).toContain("sam@example.com");
    expect(field(document, "Name")).toBeNull();
    expect(field(document, "Live address")).toBeNull();
    expect(field(document, "Anthropic API key")).toBeNull();
    await click(byText(document, "button", "Finish"));
    await until(() => expect(page?.text()).toContain("The editor is ready."));
    expect(calls(server, "PUT", "/api/setup/details")).toHaveLength(0);
    expect(calls(server, "PUT", "/api/secrets/anthropic")).toHaveLength(0);
  });

  it("can start from a backup instead, with the setup code, then signs in", async () => {
    const server = await startServer({ mode: "hosted", setup: "password" });
    page = await renderApp(server, `/setup?token=${CODE}`);
    await until(() => expect(page?.text()).toContain("Create your account."));
    await click(byText(document, "button", "Restore from a backup instead"));
    await until(() => expect(page?.text()).toContain("Restore from a backup."));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(2048)], "site-backup.bin", { type: "application/octet-stream" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    const { act } = await import("react");
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(() => expect(page?.text()).toContain("uploaded"));
    const [upload] = calls(server, "POST", "/api/install/restore/upload");
    expect(upload?.authorization).toBe(`Bearer ${CODE}`);
    expect(upload?.contentType).toBe("application/octet-stream");
    expect(upload?.body).toEqual({ bytes: 2048 });

    await type(field(document, "Passphrase"), "the passphrase it was sealed with");
    await click(byText(document, "button", "Restore"));
    await until(() => expect(page?.text()).toContain("The backup is back in place."), 5000);
    const [restore] = calls(server, "POST", "/api/install/restore");
    expect(restore?.authorization).toBe(`Bearer ${CODE}`);
    expect(restore?.body).toMatchObject({ passphrase: "the passphrase it was sealed with" });
    await click(byText(document, "button", "Sign in"));
    await until(() => expect(window.location.pathname).toBe("/login"));
    await until(() => expect(page?.text()).toContain("Sign in to edit."));
  });

  it("says when a backup's passphrase is wrong", async () => {
    const server = await startServer({ mode: "hosted", setup: "password" });
    page = await renderApp(server, `/setup?token=${CODE}`);
    await until(() => expect(page?.text()).toContain("Create your account."));
    await click(byText(document, "button", "Restore from a backup instead"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array(16)], "b.bin")], configurable: true });
    const { act } = await import("react");
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(() => expect(field(document, "Passphrase")).not.toBeNull());
    await type(field(document, "Passphrase"), "a wrong passphrase");
    await click(byText(document, "button", "Restore"));
    await until(() => expect(page?.text()).toContain("Couldn’t restore the backup"), 5000);
    expect(page.text()).toContain("doesn’t open this backup");
  });
});
