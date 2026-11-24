// @vitest-environment happy-dom
/**
 * "Host the editor online" on the Online screen, against the mock: the card
 * in local mode and nothing at all on a hosted install; the guided flow for a
 * host that creates everything (Fly.io) and for one the person starts
 * themselves (any server with Docker), read from the request log — nothing
 * created before the yes, the yes and the plan sent, unticked keys left out,
 * the setup link asked for only on the click and never put on the page; a
 * key that can't do the job stops the flow; a plan with problems can't be
 * created; removing needs the address typed.
 */
import { VERSION } from "@galley/core/brand";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { byText, click, field, renderApp, settle, startServer, type, until, type MockServer, type Rendered } from "../install/harness";

let page: Rendered | null = null;
/** Where the app sent the new tabs it opened. */
let tabs: string[] = [];

beforeEach(() => {
  tabs = [];
  delete process.env.GALLEY_MOCK_EDITOR;
});

afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
  delete process.env.GALLEY_MOCK_EDITOR;
});

/** A new tab the app opens itself: where it was sent is recorded, nothing is navigated. */
function stubTabs(): void {
  vi.stubGlobal("open", () => ({ opener: window, location: { replace: (url: string) => tabs.push(url) }, close: () => undefined }));
}

function editorCalls(server: MockServer): string[] {
  return server.log.filter((entry) => entry.path.startsWith("/api/editor-hosts") || /^\/api\/sites\/[^/]+\/editor(\/|$)/.test(entry.path)).map((entry) => `${entry.method} ${entry.path}`);
}

function calls(server: MockServer, method: string, path: string) {
  return server.log.filter((entry) => entry.method === method && entry.path === path);
}

function sites(server: MockServer): string[] {
  return [...server.backend.sites.values()].map((site) => site.id);
}

function storeKey(server: MockServer, name: string, hint: string): void {
  (server.backend as unknown as { secrets: Record<string, unknown> }).secrets[name] = { name, configured: true, source: "stored", hint };
}

function dialog(): HTMLElement {
  const open = [...document.querySelectorAll("dialog")].find((element) => element.hasAttribute("open"));
  if (!open) throw new Error("No dialog is open");
  return open as HTMLElement;
}

function dialogText(): string {
  return dialog().textContent ?? "";
}

function dialogButton(label: string | RegExp): HTMLButtonElement | null {
  return byText<HTMLButtonElement>(dialog(), "button", label);
}

async function choose(select: Element | null, value: string): Promise<void> {
  if (!select) throw new Error("No select");
  const { act } = await import("react");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The radio inside the choice whose text includes `text`. */
function radio(text: string): HTMLInputElement {
  const label = [...dialog().querySelectorAll("label")].find((element) => element.textContent?.includes(text));
  const input = label?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!input) throw new Error(`No choice “${text}”`);
  return input;
}

async function openOnline(server: MockServer, siteId: string): Promise<Rendered> {
  const rendered = await renderApp(server, `/sites/${siteId}/online`);
  await until(() => expect(rendered.text()).toContain("Editor online"));
  return rendered;
}

async function startFlow(): Promise<void> {
  await until(() => expect(byText(document, "button", "Host the editor online")).not.toBeNull());
  await click(byText(document, "button", "Host the editor online"));
  await until(() => expect(dialogText()).toContain("Choose where the editor runs."));
}

describe("the Online screen's editor card", () => {
  it("offers to host the editor in local mode", async () => {
    const server = await startServer({ mode: "local" });
    page = await openOnline(server, sites(server)[0]!);
    await until(() => expect(page?.text()).toContain("Edit this site from any browser, not just this computer."));
    expect(page.text()).toContain("with its own password");
    expect(byText(document, "button", "Host the editor online")).not.toBeNull();
    // Nothing is asked of the hosts until the person starts.
    expect(editorCalls(server)).toEqual([`GET /api/sites/${sites(server)[0]}/editor`]);
  });

  it("isn't there on a hosted install, and none of its routes are called", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    server.backend.authenticated = true;
    const siteId = server.install?.site.id;
    if (!siteId) throw new Error("The mock install has no site");
    page = await renderApp(server, `/sites/${siteId}/online`);
    await until(() => expect(page?.text()).toContain("Deployments"));
    await settle(300);
    expect(page.text()).not.toContain("Host the editor online");
    expect(page.text()).not.toContain("Editor online");
    expect(editorCalls(server)).toEqual([]);
  });

  it("says when the editor was set up from another computer, and offers no upgrade or removal", async () => {
    process.env.GALLEY_MOCK_EDITOR = "other";
    const server = await startServer({ mode: "local" });
    page = await openOnline(server, sites(server)[1]!);
    await until(() => expect(page?.text()).toContain("This site also has an editor online"));
    expect(page.text()).toContain("handbook.example.com");
    expect(page.text()).toContain("Running");
    expect(page.text()).toContain("set up from another computer");
    expect(byText(document, "button", "Remove the hosted editor")).toBeNull();
    expect(byText(document, "button", /^Upgrade/)).toBeNull();
  });
});

describe("hosting the editor on Google Cloud", () => {
  it("takes the key file pasted whole into the one-line field, and plans a virtual machine with its network and fixed address", async () => {
    const server = await startServer({ mode: "local" });
    storeKey(server, "cloudflare", "cf01");
    const siteId = sites(server)[0]!;
    page = await openOnline(server, siteId);
    await startFlow();

    await click(radio("Google Cloud"));
    expect(dialogText()).toMatch(/About \$18 a month · prices read/);
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("Give it the roles “Compute Instance Admin (v1)”, “Compute Network Admin” and “Compute Security Admin”"));
    expect(dialogText()).toContain("A key file from Google Cloud (a service account's JSON key)");
    // A password field drops line breaks: the key file still arrives whole, and is never put on the page.
    const keyFile = JSON.stringify({ type: "service_account", project_id: "example-project", private_key_id: "0123456789abcdef0123456789abcdefk3y9", private_key: "-----BEGIN PRIVATE KEY-----\\nMIIEnotarealkey\\n-----END PRIVATE KEY-----\\n", client_email: "editor-maker@example-project.iam.gserviceaccount.com" }, null, 2).replace(/\n/g, "");
    await type(field(dialog(), "Google Cloud key file"), keyFile);
    await click(dialogButton("Check"));
    await until(() => expect(dialogText()).toContain("The key can create the editor on Google Cloud."));
    expect(calls(server, "POST", "/api/editor-hosts/gcp/connect")[0]?.body).toEqual({ key: keyFile, secret: "gcp" });
    expect(document.body.innerHTML).not.toContain("MIIEnotarealkey");
    await click(dialogButton("Continue"));

    await until(() => expect(dialogText()).toContain("On your domains:"));
    await click(byText(dialog(), "button", "cms.example.com"));
    await type(field(dialog(), "Short name"), "acme-editor");
    expect(dialogText()).toContain("Created in “example-project” on Google Cloud.");
    await choose(field(dialog(), "Where it runs"), "europe-west1");
    await click(radio("4 GB (e2-medium)"));
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("Nothing else leaves this computer."));
    await click(dialogButton("See the plan"));

    await until(() => expect(dialogText()).toContain("What will be created on Google Cloud"));
    expect(dialogText()).toContain("Nothing has been created yet.");
    expect(dialogText()).toContain("About $30 a month");
    for (const words of ["A network of its own", "Its subnet", "A firewall rule", "A fixed address", "The disk", "no SSH", "in Belgium (europe-west1)"]) expect(dialogText()).toContain(words);
    const [planned] = calls(server, "POST", `/api/sites/${siteId}/editor/plan`);
    expect(planned?.body).toMatchObject({ host: "gcp", account: "example-project", name: "acme-editor", options: { size: "e2-medium", region: "europe-west1" } });
    expect(calls(server, "POST", `/api/sites/${siteId}/editor`)).toHaveLength(0);
    await click(dialogButton("Create the editor"));
    await until(() => expect(dialogText()).toContain("Open first run"), 8000);
  });

  it("refuses something that isn't a key file, and stops at an API that is off", async () => {
    const server = await startServer({ mode: "local" });
    page = await openOnline(server, sites(server)[0]!);
    await startFlow();
    await click(radio("Google Cloud"));
    await click(dialogButton("Continue"));
    await until(() => expect(field(dialog(), "Google Cloud key file")).not.toBeNull());
    await type(field(dialog(), "Google Cloud key file"), "AIzaSyNotAServiceAccountKey0123456789");
    await click(dialogButton("Check"));
    await until(() => expect(dialogText()).toContain("That isn't a key file from Google Cloud (a service account's JSON key)."));
    await type(field(dialog(), "Google Cloud key file"), JSON.stringify({ type: "service_account", private_key_id: "api-is-off-0001" }));
    await click(dialogButton("Check"));
    await until(() => expect(dialogText()).toContain("The Compute Engine API is off in the project “example-project”"));
    expect(dialogText()).toContain("This has to be fixed before the editor can be created:");
  });
});

describe("hosting the editor on Fly.io", () => {
  it("creates nothing before the yes, sends the plan and only the ticked keys, and asks for the setup link only on the click", async () => {
    stubTabs();
    const server = await startServer({ mode: "local" });
    // A Cloudflare key is stored: the three names are made on Cloudflare, so nothing is left to do by hand.
    storeKey(server, "cloudflare", "cf01");
    const siteId = sites(server)[0]!;
    page = await openOnline(server, siteId);
    await startFlow();

    // 1. Where: the first host is chosen; the hosts that can't are explained.
    expect(radio("Fly.io").checked).toBe(true);
    expect(dialogText()).toContain("Created for you on your account");
    expect(dialogText()).toContain("You start it on a computer of your own");
    expect(dialogText()).toMatch(/About \$13 a month · prices read/);
    expect(dialogText()).toContain("Why not Vercel, Netlify or Cloudflare Containers?");
    await click(dialogButton("Continue"));

    // 2. Connect: the Fly.io key, checked with the host; the stored Cloudflare key is said by its last four.
    await until(() => expect(dialogText()).toContain("Organization token (Tokens › Create Organization token)"));
    expect(dialogText()).toContain("A key is saved, ending in cf01.");
    expect(dialogButton("Continue")?.disabled).toBe(true);
    await type(field(dialog(), "Fly.io access key"), "fly-mock-key-0001");
    await click(dialogButton("Check"));
    await until(() => expect(dialogText()).toContain("The key can create the editor on Fly.io."));
    const connects = calls(server, "POST", "/api/editor-hosts/fly/connect");
    expect(connects[0]?.body).toEqual({ key: "fly-mock-key-0001", secret: "fly" });
    expect(document.body.innerHTML).not.toContain("fly-mock-key-0001");
    await click(dialogButton("Continue"));

    // 3. The address (a name on the person's domain), the three names, the account and the host's choices.
    await until(() => expect(dialogText()).toContain("On your domains:"));
    await click(byText(dialog(), "button", "cms.example.com"));
    await until(() => expect(dialogText()).toContain("cms-preview.example.com"));
    expect(dialogText()).toContain("cms-live.example.com");
    expect(dialogText()).toContain("All three must be on a domain that’s yours.");
    // Prefilled from the site's name.
    expect(field(dialog(), "Short name")?.value).toMatch(/^[a-z][a-z0-9-]*-editor$/);
    await type(field(dialog(), "Short name"), "acme-editor");
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("Choose the account the editor goes in."));
    await choose(field(dialog(), "Account"), "studio");
    await click(radio("Stay awake"));
    await click(dialogButton("Continue"));

    // 4. The handover: keys are never pre-ticked; one is ticked on purpose.
    await until(() => expect(dialogText()).toContain("Nothing else leaves this computer."));
    expect(dialogText()).toContain("its own key for the repository");
    const boxes = [...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not([role="switch"])')];
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    expect(boxes.every((box) => !box.checked)).toBe(true);
    const assistant = [...dialog().querySelectorAll("label")].find((label) => label.textContent?.startsWith("The assistant’s key"))?.querySelector("input");
    await click(assistant ?? null);
    await click(dialogButton("See the plan"));

    // 5. The plan: everything that will be made, what it costs, what it's handed — and still nothing created.
    await until(() => expect(dialogText()).toContain("What will be created on Fly.io"));
    expect(dialogText()).toContain("Nothing has been created yet.");
    expect(dialogText()).toContain("About $13 a month");
    expect(dialogText()).toContain("Key: the assistant's key (Anthropic)");
    expect(dialogText()).toContain("…9f3a");
    expect(dialogText()).not.toContain("OpenAI key");
    const [planned] = calls(server, "POST", `/api/sites/${siteId}/editor/plan`);
    expect(planned?.body).toMatchObject({ host: "fly", account: "studio", name: "acme-editor", address: "cms.example.com", options: { memory: "2048", sleep: "off", region: "iad" }, handover: { repository: true, identity: true, liveAddress: true, keys: ["anthropic"] } });
    expect(calls(server, "POST", `/api/sites/${siteId}/editor`)).toHaveLength(0);

    // 6. The yes: the plan's id and confirm, then the job.
    await click(dialogButton("Create the editor"));
    await until(() => expect(dialogText()).toContain("Open first run"), 8000);
    const [created] = calls(server, "POST", `/api/sites/${siteId}/editor`);
    expect(created?.status).toBe(200);
    expect(created?.body).toEqual({ plan: expect.stringMatching(/^[0-9a-f-]{36}$/), confirm: true });
    expect(dialogText()).toContain("cms.example.com");
    expect(dialogText()).toContain("That change shows in Proof");

    // 7. The setup link: asked for at the click, sent to the new tab, never on the page.
    expect(calls(server, "POST", `/api/sites/${siteId}/editor/setup-link`)).toHaveLength(0);
    await click(dialogButton("Open first run"));
    await until(() => expect(tabs).toHaveLength(1));
    expect(calls(server, "POST", `/api/sites/${siteId}/editor/setup-link`)).toHaveLength(1);
    expect(tabs[0]).toMatch(/^https:\/\/cms\.example\.com\/setup\?token=/);
    const token = new URL(tabs[0]!).searchParams.get("token")!;
    expect(document.body.innerHTML).not.toContain(token);
    const stored = [localStorage, sessionStorage].flatMap((storage) => Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? "") ?? ""));
    expect(stored.some((value) => value.includes(token))).toBe(false);

    // The card now shows the editor.
    await click(dialogButton("Done"));
    await until(() => expect(page?.text()).toContain("This site also has an editor online"));
    expect(page.text()).toContain("Waiting for first run");
    expect(page.text()).toContain("On Fly.io");
    expect(document.body.innerHTML).not.toContain(token);
  });

  it("stops at a permission the key doesn't have, and says where to add it", async () => {
    const server = await startServer({ mode: "local" });
    const siteId = sites(server)[0]!;
    page = await openOnline(server, siteId);
    await startFlow();
    await click(dialogButton("Continue"));
    await until(() => expect(field(dialog(), "Fly.io access key")).not.toBeNull());
    await type(field(dialog(), "Fly.io access key"), "fly-mock-key-apps-only");
    await click(dialogButton("Check"));
    await until(() => expect(dialogText()).toContain("This Fly.io key may only manage particular apps"));
    expect(dialogText()).toContain("This has to be fixed before the editor can be created:");
    expect(dialogText()).toContain("Create Organization token");
    expect(dialogButton("Continue")?.disabled).toBe(true);
    await click(dialogButton("Continue"));
    await settle();
    expect(dialogText()).not.toContain("The editor’s address");
    expect(calls(server, "POST", `/api/sites/${siteId}/editor/plan`)).toHaveLength(0);
  });

  it("can't create a plan with problems", async () => {
    const server = await startServer({ mode: "local" });
    storeKey(server, "fly", "fly1");
    const siteId = sites(server)[0]!;
    page = await openOnline(server, siteId);
    await startFlow();
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("The key can create the editor on Fly.io."));
    await click(dialogButton("Continue"));
    await until(() => expect(field(dialog(), "The editor’s address")).not.toBeNull());
    await type(field(dialog(), "The editor’s address"), "cms.example.com");
    await type(field(dialog(), "Short name"), "taken");
    await choose(field(dialog(), "Account"), "studio");
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("What it will be handed"));
    await click(dialogButton("See the plan"));
    await until(() => expect(dialogText()).toContain("There's already an app called “taken”"));
    expect(dialogText()).toContain("Choose another name.");
    // No DNS key: the three names are added by hand, and said so.
    expect(dialogText()).toContain("What you’ll do by hand");
    expect(dialogButton("Create the editor")?.disabled).toBe(true);
    expect(dialogText()).not.toContain("Nothing has been created yet.");
    expect(calls(server, "POST", `/api/sites/${siteId}/editor`)).toHaveLength(0);
  });
});

describe("hosting the editor on a server of your own", () => {
  it("asks for no key, hands over the files, and finishes when the editor answers", async () => {
    stubTabs();
    const server = await startServer({ mode: "local" });
    const siteId = sites(server)[0]!;
    page = await openOnline(server, siteId);
    await startFlow();
    await click(radio("Any server with Docker"));
    await click(dialogButton("Continue"));

    // No key to connect: straight to the address.
    await until(() => expect(field(dialog(), "The editor’s address")).not.toBeNull());
    expect(dialogText()).toContain("Step 2 of 4");
    expect(calls(server, "POST", "/api/editor-hosts/own-server/connect")[0]?.body).toEqual({});
    await type(field(dialog(), "The editor’s address"), "edit.example.org");
    await type(field(dialog(), "Short name"), "own-editor");
    expect(radio("Its own Caddy").checked).toBe(true);
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("What it will be handed"));
    await click(dialogButton("See the plan"));

    await until(() => expect(dialogText()).toContain("The files"));
    expect(dialogText()).toContain("compose.yaml");
    expect(dialogText()).toContain("Caddyfile");
    expect(dialogText()).toContain("Nothing is created on an account.");
    const [planned] = calls(server, "POST", `/api/sites/${siteId}/editor/plan`);
    expect(planned?.body).toMatchObject({ host: "own-server", account: "", name: "own-editor", address: "edit.example.org", options: { proxy: "caddy" }, handover: { keys: [] } });
    expect(calls(server, "POST", `/api/sites/${siteId}/editor`)).toHaveLength(0);

    await click(dialogButton("Get the files"));
    await until(() => expect(dialogText()).toContain("Start it on your computer"), 8000);
    expect(calls(server, "POST", `/api/sites/${siteId}/editor`)[0]?.body).toEqual({ plan: expect.any(String), confirm: true });
    expect(dialogText()).toContain("docker compose up -d");
    expect(dialogText()).toContain(".env");

    await click(dialogButton("I’ve started it — check"));
    await until(() => expect(dialogText()).toContain("Open first run"));
    expect(calls(server, "POST", `/api/sites/${siteId}/editor/check`)).toHaveLength(1);
    expect(calls(server, "POST", `/api/sites/${siteId}/editor/setup-link`)).toHaveLength(0);
  });

  it("keeps a file with a one-time code hidden until Show", async () => {
    const server = await startServer({ mode: "local" });
    storeKey(server, "cloudflare", "cf02");
    const siteId = sites(server)[0]!;
    page = await openOnline(server, siteId);
    await startFlow();
    await click(radio("Cloudflare, in front of a computer of yours"));
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("The key can create the editor on Cloudflare"));
    await click(dialogButton("Continue"));
    await until(() => expect(field(dialog(), "The editor’s address")).not.toBeNull());
    await type(field(dialog(), "The editor’s address"), "cms.example.com");
    await type(field(dialog(), "Short name"), "tunnel-editor");
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("What it will be handed"));
    await click(dialogButton("See the plan"));
    await until(() => expect(dialogText()).toContain("tunnel.env"));
    expect(dialogText()).toContain("It holds a one-time code");
    expect(document.body.innerHTML).not.toContain("TUNNEL_TOKEN=");
    await click(dialogButton("Show"));
    await until(() => expect(dialog().querySelector<HTMLTextAreaElement>('textarea[aria-label="tunnel.env"]')?.value).toContain("TUNNEL_TOKEN="));
    expect(dialogButton("Get the files")).not.toBeNull();
  });
});

describe("removing the hosted editor", () => {
  it("shows what goes and what stays, and needs the address typed", async () => {
    const server = await startServer({ mode: "local" });
    const siteId = sites(server)[1]!;
    page = await openOnline(server, siteId);
    await until(() => expect(page?.text()).toContain("This site also has an editor online"));
    expect(page.text()).toContain("handbook.example.com");
    // The mock's editor runs 0.0.9; "current" is whatever version this app is.
    expect(page.text()).toContain(`Version 0.0.9 → ${VERSION}`);
    expect(byText(document, "button", `Upgrade to ${VERSION}`)).not.toBeNull();

    await click(byText(document, "button", "Remove the hosted editor"));
    await until(() => expect(dialogText()).toContain("Deleted from Fly.io"));
    expect(dialogText()).toContain("Left alone");
    expect(dialogText()).toContain("Kept");
    expect(dialogText()).toContain("Changes made on the hosted editor that were never published are deleted with it.");
    const remove = () => dialogButton("Remove the hosted editor");
    expect(remove()?.disabled).toBe(true);
    await type(field(dialog(), "Type handbook.example.com to confirm"), "handbook.example");
    expect(remove()?.disabled).toBe(true);
    await click(remove());
    expect(calls(server, "DELETE", `/api/sites/${siteId}/editor`)).toHaveLength(0);

    await type(field(dialog(), "Type handbook.example.com to confirm"), "handbook.example.com");
    expect(remove()?.disabled).toBe(false);
    await click(remove());
    await until(() => expect(dialogText()).toContain("The hosted editor is removed"), 8000);
    expect(calls(server, "DELETE", `/api/sites/${siteId}/editor`)).toHaveLength(1);
    expect(calls(server, "DELETE", `/api/sites/${siteId}/editor`).map((entry) => [entry.status, entry.body])).toEqual([[200, { confirm: true }]]);
    await click(dialogButton("Close"));
    await until(() => expect(byText(document, "button", "Host the editor online")).not.toBeNull());
  }, 20_000);
});

describe("the removal's yes", () => {
  it("is read by the mock: no removal without confirm: true, a removal with it", async () => {
    const server = await startServer({ mode: "local" });
    const siteId = sites(server)[1]!;
    const remove = (body?: unknown) => server.handle({ method: "DELETE", url: `/api/sites/${siteId}/editor`, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)) });

    for (const body of [undefined, {}, { confirm: false }]) {
      const refused = await remove(body);
      expect(refused.status).toBe(400);
      expect(JSON.parse(String(refused.body)).error.message).toContain("Nothing was removed");
    }
    const accepted = await remove({ confirm: true });
    expect(accepted.status).toBe(200);
    expect(JSON.parse(String(accepted.body))).toMatchObject({ kind: "editor-host", state: "running" });
  });

  it("is sent by api() as the DELETE's JSON body, and only where the route has one", async () => {
    const server = await startServer({ mode: "local" });
    const siteId = sites(server)[1]!;
    const sent: Array<{ method: string; body: unknown; type: string | null }> = [];
    const reach = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ method: init?.method ?? "GET", body: init?.body ?? null, type: new Headers(init?.headers).get("content-type") });
      return reach(input, init);
    });
    vi.resetModules();
    const { api } = await import("../../src/lib/api");
    const job = await api("DELETE /api/sites/:siteId/editor", { params: { siteId }, body: { confirm: true } });
    expect(job.kind).toBe("editor-host");
    await api("DELETE /api/sites/:siteId/threads/:threadId", { params: { siteId, threadId: "none" } }).catch(() => undefined);
    expect(sent).toEqual([
      { method: "DELETE", body: JSON.stringify({ confirm: true }), type: "application/json" },
      { method: "DELETE", body: null, type: null },
    ]);
  });
});

describe("what removing says", () => {
  /** The section of the open dialog headed `title`, as text. */
  function section(title: string): string {
    const heading = [...dialog().querySelectorAll("h3")].find((element) => element.textContent === title);
    return heading?.parentElement?.textContent ?? "";
  }

  it("lists each thing by where it lives and what it is, with names for codes, takes the focus at the confirm field, and offers the backup from here", async () => {
    process.env.GALLEY_MOCK_EDITOR = "clean";
    const server = await startServer({ mode: "local" });
    const siteId = sites(server)[1]!;
    page = await openOnline(server, siteId);
    await until(() => expect(page?.text()).toContain("This site also has an editor online"));
    await click(byText(document, "button", "Remove the hosted editor"));
    await until(() => expect(dialogText()).toContain("Deleted from Fly.io"));

    // The DNS names are Cloudflare's, not Fly.io's.
    const fly = section("Deleted from Fly.io");
    const cloudflare = section("Deleted from Cloudflare");
    expect(fly).not.toContain("A name at your domain’s provider");
    expect(cloudflare).toContain("A name at your domain’s provider");
    expect(cloudflare).toContain("handbook.example.com → handbook-editor.fly.dev, on example.com");
    expect(cloudflare).not.toContain("The app");

    // What each thing is, before its name; a place and an account by name once the host has said them.
    await until(() => expect(section("Deleted from Fly.io")).toContain("In the organization “Studio”"));
    const named = section("Deleted from Fly.io");
    for (const what of ["The app", "An address", "The disk", "The computer", "A certificate"]) expect(named).toContain(what);
    expect(named).toContain("3 GB in London (UK)");
    expect(named).toContain("2 GB in London (UK)");
    expect(named).not.toMatch(/\bin lhr\b/);
    expect(named).not.toContain("shared IPv4shared IPv4");
    expect(calls(server, "POST", "/api/editor-hosts/fly/connect")[0]?.body).toEqual({});

    // The confirm field has the focus, not "Keep it".
    await until(() => expect(document.activeElement).toBe(field(dialog(), "Type handbook.example.com to confirm")));
    // The backup the warning speaks of is one click away.
    expect(byText<HTMLAnchorElement>(dialog(), "a", "Open its Install page")?.href).toBe("https://handbook.example.com/install");

    await type(field(dialog(), "Type handbook.example.com to confirm"), "handbook.example.com");
    await click(dialogButton("Remove the hosted editor"));
    await until(() => expect(dialogText()).toContain("The hosted editor is removed"), 8000);
    expect(dialogText()).toContain("Deleted 8 things from Fly.io and 3 from Cloudflare.");
    expect(section("Kept")).toContain("The site, its repository and its version history");
  });

  it("says what the server said when something was left alone at the last check", async () => {
    const server = await startServer({ mode: "local" });
    const siteId = sites(server)[1]!;
    page = await openOnline(server, siteId);
    await until(() => expect(page?.text()).toContain("This site also has an editor online"));
    await click(byText(document, "button", "Remove the hosted editor"));
    await until(() => expect(dialogText()).toContain("Left alone"));
    expect(section("Left alone")).toContain("A certificate");
    await type(field(dialog(), "Type handbook.example.com to confirm"), "handbook.example.com");
    await click(dialogButton("Remove the hosted editor"));
    await until(() => expect(dialogText()).toContain("The hosted editor is removed"), 8000);
    expect(dialogText()).toContain("Removed. One thing was left alone because it changed or had already gone.");
    expect(dialogText()).not.toContain("Deleted 7 things");
  });
});

describe("the connect step", () => {
  it("says optional once, and names what the keys can reach", async () => {
    const server = await startServer({ mode: "local" });
    storeKey(server, "fly", "fly1");
    storeKey(server, "cloudflare", "cf01");
    page = await openOnline(server, sites(server)[0]!);
    await startFlow();
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("The key can create the editor on Fly.io."));
    expect(dialogText()).not.toContain("(optional)");
    expect(dialogText()).toContain("Cloudflare access key");
    const reach = dialog().querySelector('[aria-label="What the keys can reach"]')?.textContent ?? "";
    expect(reach).toContain("On Fly.io it can create the editor in “Studio” or “Personal”.");
    expect(reach).toContain("On Cloudflare it can add the editor’s names to example.com and example.org.");
  });
});

describe("the plan's cost", () => {
  it("leads with what is true for a computer that sleeps while unused", async () => {
    const server = await startServer({ mode: "local" });
    storeKey(server, "fly", "fly1");
    const siteId = sites(server)[0]!;
    page = await openOnline(server, siteId);
    await startFlow();
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("The key can create the editor on Fly.io."));
    await click(dialogButton("Continue"));
    await until(() => expect(field(dialog(), "The editor’s address")).not.toBeNull());
    await type(field(dialog(), "The editor’s address"), "cms.example.com");
    await type(field(dialog(), "Short name"), "acme-editor");
    await choose(field(dialog(), "Account"), "studio");
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("What it will be handed"));
    await click(dialogButton("See the plan"));
    await until(() => expect(dialogText()).toContain("What will be created on Fly.io"));
    expect(dialog().querySelector(".host-cost__total")?.textContent).toBe("Up to about $13 a month — it sleeps while nobody is using it, so it usually costs much less");
    // Rows in the plan read the same way as in removal.
    expect(dialogText()).toContain("The disk");
    expect(dialogText()).toContain("A 3 GB disk in Ashburn, Virginia (US)");
  });
});

async function openPalette(): Promise<string> {
  const { act } = await import("react");
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  });
  await until(() => expect(document.querySelector('[role="listbox"][aria-label="Results"]')).not.toBeNull());
  return document.querySelector('[role="listbox"][aria-label="Results"]')?.textContent ?? "";
}

describe("other ways in", () => {
  it("the command palette opens the flow on the site's Online screen, in local mode only", async () => {
    const server = await startServer({ mode: "local" });
    const siteId = sites(server)[0]!;
    page = await renderApp(server, `/sites/${siteId}`);
    await until(() => expect(page?.text()).toContain("Site home"));
    expect(await openPalette()).toContain("Host the editor online");
    const option = [...document.querySelectorAll('[role="listbox"][aria-label="Results"] [role="option"]')].find((element) => element.textContent?.includes("Host the editor online"));
    await click(option ?? null);
    await until(() => expect(window.location.pathname).toBe(`/sites/${siteId}/online`));
    await until(() => expect(dialogText()).toContain("Choose where the editor runs."));
    await page.unmount();

    const hosted = await startServer({ mode: "hosted", setup: "done" });
    hosted.backend.authenticated = true;
    page = await renderApp(hosted, `/sites/${hosted.install?.site.id}`);
    await until(() => expect(page?.text()).toContain("Site home"));
    expect(await openPalette()).not.toContain("Host the editor online");
    await settle();
    expect(editorCalls(hosted)).toEqual([]);
  });

  it("a new site's last screen can lead to its Online screen with the flow open", async () => {
    const server = await startServer({ mode: "local" });
    page = await renderApp(server, "/new");
    await until(() => expect(page?.text()).toContain("What’s the site called?"));
    await type(field(document, "Site name"), "Harbour Dental");
    await click(byText(document, "button", "Continue"));
    await until(() => expect(page?.text()).toContain("Start from…"));
    await click(byText(document, "button", "Continue"));
    await until(() => expect(field(document, "What it is and does")).not.toBeNull());
    await type(field(document, "What it is and does"), "A family dental practice in the town centre.");
    await click(byText(document, "button", "Continue"));
    await until(() => expect(page?.text()).toContain("How should it sound and look?"));
    await click(byText(document, "button", "Continue"));
    await until(() => expect(byText<HTMLButtonElement>(document, "button", "Create site")?.disabled).toBe(false));
    await click(byText(document, "button", "Create site"));

    await until(() => expect(page?.text()).toContain("Setting up Harbour Dental…"));
    const action = byText<HTMLButtonElement>(document, "button", "Host the editor online");
    expect(action?.getAttribute("aria-pressed")).toBe("false");
    await click(action);
    expect(action?.getAttribute("aria-pressed")).toBe("true");
    await until(() => expect(window.location.pathname).toMatch(/^\/sites\/[^/]+\/online$/), 15_000);
    await until(() => expect(dialogText()).toContain("Choose where the editor runs."));
  }, 25_000);
});

describe("when creating stops half-way", () => {
  it("says what happened in the server's words, keeps the raw text behind Technical details, and offers to remove what was made", async () => {
    const server = await startServer({ mode: "local" });
    storeKey(server, "fly", "fly1");
    storeKey(server, "cloudflare", "cf01");
    const siteId = sites(server)[0]!;
    page = await openOnline(server, siteId);
    await startFlow();
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("The key can create the editor on Fly.io."));
    await click(dialogButton("Continue"));
    await until(() => expect(field(dialog(), "The editor’s address")).not.toBeNull());
    await type(field(dialog(), "The editor’s address"), "cms.example.com");
    await type(field(dialog(), "Short name"), "acme-fail");
    await choose(field(dialog(), "Account"), "personal");
    await click(dialogButton("Continue"));
    await until(() => expect(dialogText()).toContain("What it will be handed"));
    await click(dialogButton("See the plan"));
    await until(() => expect(dialogButton("Create the editor")?.disabled).toBe(false));
    await click(dialogButton("Create the editor"));

    await until(() => expect(dialogText()).toContain("stopped answering while the disk was being created"), 8000);
    expect(dialogText()).toContain("Anything already created is listed on the Online screen, where you can remove it.");
    expect(dialog().querySelector("details summary")?.textContent).toBe("Technical details");
    await click(dialogButton("Close"));
    await until(() => expect(page?.text()).toContain("Putting the editor online didn’t finish"));
    expect(byText(document, "button", "Remove what was created")).not.toBeNull();
  }, 15_000);
});
