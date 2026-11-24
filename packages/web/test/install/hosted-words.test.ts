// @vitest-environment happy-dom
/**
 * Where things are kept, said truly on a hosted install: the server, in this
 * editor's own data — never "this computer", which there is the visitor's
 * own machine. The inbox's note says why visitors can or can't reach it:
 * nothing when they can, the editor's own address when it is a private name.
 * Every local-mode string stays exactly as it was.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeWords } from "../../src/lib/where";
import { publishOutcome } from "../../src/features/proof/publishOutcome";
import { authorLine } from "../../src/features/proof/authorLine";
import { editorAddress, inboxReach } from "../../src/features/inbox/reach";
import { renderApp, settle, startServer, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

function siteOf(server: MockServer): string {
  const id = server.install?.site.id ?? [...server.backend.sites.values()][0]?.id;
  if (!id) throw new Error("The mock has no site");
  return id;
}

function withoutAssistantKey(server: MockServer): void {
  (server.backend as unknown as { secrets: Record<string, unknown> }).secrets.anthropic = { name: "anthropic", configured: false, source: null };
}

describe("the words for where things are kept", () => {
  it("are this computer's locally, exactly as before, and the server's on a hosted install", () => {
    expect(placeWords(false)).toEqual({ recorded: "on this computer", keyStore: "on this computer only", machines: "this computer’s" });
    expect(placeWords(true)).toEqual({ recorded: "in this editor", keyStore: "on the server, in this editor’s own data", machines: "the server’s" });
    for (const words of Object.values(placeWords(true))) expect(words).not.toContain("computer");
  });

  it("name where a version went when it wasn't sent anywhere", () => {
    const result = { ok: true, files: ["a.md", "b.md"], pushed: false } as Parameters<typeof publishOutcome>[0];
    expect(publishOutcome(result, { message: "x", mode: "commit" }).title).toBe("Published on this computer");
    expect(publishOutcome(result, { message: "x", mode: "commit", hosted: true }).title).toBe("Published in this editor");
  });

  it("name whose settings chose the publishing name", () => {
    const who = { name: "Sam", email: "sam@example.com", from: "machine" as const };
    expect(authorLine(who, "s1").text).toBe("Recorded as Sam (sam@example.com), from this computer’s settings.");
    expect(authorLine(who, "s1", true).text).toBe("Recorded as Sam (sam@example.com), from the server’s settings.");
  });

  it("say why visitors can't reach the inbox from where the app runs", () => {
    expect(inboxReach(true, true)).toBe("reachable");
    expect(inboxReach(true, false)).toBe("reachable");
    expect(inboxReach(false, true)).toBe("private-address");
    expect(inboxReach(false, false)).toBe("this-computer");
    // What the server says wins over what the mode suggests.
    expect(inboxReach(false, true, { kind: "this-computer" })).toBe("this-computer");
    expect(inboxReach(false, false, { kind: "private-address" })).toBe("private-address");
    expect(inboxReach(true, true, { kind: "public" })).toBe("reachable");
    expect(editorAddress("https://cms.localhost/f/site-1")).toBe("https://cms.localhost");
  });
});

describe("the assistant without a key", () => {
  const ENTRY = "src%2Fcontent%2Fpages%2Findex.md";

  it("says the key is stored on the server on a hosted install", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    server.backend.authenticated = true;
    withoutAssistantKey(server);
    page = await renderApp(server, `/sites/${siteOf(server)}/edit?path=${ENTRY}`);
    await until(() => expect(page?.text()).toContain("Connect the assistant."));
    expect(page.text()).toContain("Paste an API key in Settings. It’s stored on the server, in this editor’s own data. Until then you can still edit in the form and on the page.");
    expect(page.text()).not.toContain("this computer");
  });

  it("keeps its words locally", async () => {
    const server = await startServer({ mode: "local" });
    withoutAssistantKey(server);
    page = await renderApp(server, `/sites/${siteOf(server)}/edit?path=${ENTRY}`);
    await until(() => expect(page?.text()).toContain("Connect the assistant."));
    expect(page.text()).toContain("Paste an API key in Settings. It’s stored on this computer only. Until then you can still edit in the form and on the page.");
  });
});

describe("the inbox's note about visitors", () => {
  const LOCAL_LEAD = "Submissions can only arrive when this app runs on a server visitors can reach. On this computer it works for testing.";

  it("is not there on a hosted install visitors can reach", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    server.backend.authenticated = true;
    page = await renderApp(server, `/sites/${siteOf(server)}/inbox`);
    await until(() => expect(page?.text()).toContain("Contact us"));
    await settle(300);
    expect(page.text()).not.toContain("can’t reach");
    expect(page.text()).not.toContain("this computer");
    expect(document.querySelector(".app-reach--warning")).toBeNull();
  });

  it("names the editor's own address on a hosted install whose address is a private name", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", address: "https://cms.localhost" });
    server.backend.authenticated = true;
    page = await renderApp(server, `/sites/${siteOf(server)}/inbox`);
    await until(() => expect(document.querySelector(".app-reach--warning")).not.toBeNull());
    const note = document.querySelector(".app-reach--warning")?.textContent ?? "";
    expect(note).toContain("This editor’s address, https://cms.localhost, isn’t one visitors’ browsers can reach, so the live site’s forms can’t send to this inbox.");
    expect(note).toContain("Give the editor a public address, or send the form to a webhook or your CRM instead.");
    expect(page.text()).not.toContain("this computer");
    expect(page.text()).not.toContain("hosted mode");
  });

  it("keeps its words locally", async () => {
    const server = await startServer({ mode: "local" });
    page = await renderApp(server, `/sites/${siteOf(server)}/inbox`);
    await until(() => expect(document.querySelector(".app-reach--warning")).not.toBeNull());
    expect(document.querySelector(".app-reach--warning")?.textContent).toContain(LOCAL_LEAD);
  });
});

describe("the Forms screen's “Where should the live site send submissions?”", () => {
  const LOCAL = "This app runs on this computer, so visitors’ browsers can’t reach its inbox. In the preview, forms still send here, so you can test them. For the live site, run this app on a server with a public address, or send each form somewhere else under “Where it goes” — a webhook, HubSpot or another service.";

  it("names the editor's own address on a hosted install whose address is a private name", async () => {
    const server = await startServer({ mode: "hosted", setup: "done", address: "https://cms.localhost" });
    server.backend.authenticated = true;
    page = await renderApp(server, `/sites/${siteOf(server)}/forms`);
    await until(() => expect(page?.text()).toContain("Where should the live site send submissions?"));
    expect(page.text()).toContain("This editor’s address, https://cms.localhost, isn’t one visitors’ browsers can reach, so the live site can’t send its forms here.");
    expect(page.text()).toContain("give the editor a public address, or send each form somewhere else under “Where it goes”");
    expect(page.text()).not.toContain("this computer");
  });

  it("offers the inbox on a hosted install visitors can reach", async () => {
    const server = await startServer({ mode: "hosted", setup: "done" });
    server.backend.authenticated = true;
    page = await renderApp(server, `/sites/${siteOf(server)}/forms`);
    await until(() => expect(page?.text()).toContain("Where should the live site send submissions?"));
    expect(page.text()).toContain("Visitors’ browsers can reach this app’s inbox at https://cms.example.com/f/");
    expect(page.text()).not.toContain("can’t reach");
  });

  it("keeps its words locally", async () => {
    const server = await startServer({ mode: "local" });
    page = await renderApp(server, `/sites/${siteOf(server)}/forms`);
    await until(() => expect(page?.text()).toContain("Where should the live site send submissions?"));
    expect(page.text()).toContain(LOCAL);
  });
});
