// @vitest-environment happy-dom
/**
 * People, on the Install page, as an owner: the list, inviting (the link
 * shown once, with Copy), taking an invitation back, changing a role,
 * switching someone off, a new-password link (not shown when it was
 * e-mailed), changing someone's e-mail, removing someone, the
 * server's refusals in its own words, the line about outgoing e-mail, and
 * signing everyone out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { byText, click, field, refusals, renderApp, settle, startServer, type, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

const NO_EMAIL = "This server doesn’t e-mail links, so copy each one and send it yourself.";

function calls(server: MockServer, method: string, path: string | RegExp) {
  return server.log.filter((entry) => entry.method === method && (typeof path === "string" ? entry.path === path : path.test(entry.path)));
}

function openDialog(): HTMLDialogElement {
  const found = [...document.querySelectorAll("dialog")].find((element) => element.open);
  if (!found) throw new Error("No dialog is open");
  return found;
}

function row(name: string): HTMLTableRowElement {
  const found = [...document.querySelectorAll<HTMLTableRowElement>(".accounts-table tbody tr")].find((candidate) => candidate.textContent?.includes(name));
  if (!found) throw new Error(`No row for ${name}`);
  return found;
}

/** Choose an item from a person's "What to do about …" menu. */
async function act(name: string, item: string): Promise<void> {
  await click(row(name).querySelector('button[aria-haspopup="menu"]'));
  await until(() => expect(byText(document, '[role="menuitem"]', item)).not.toBeNull());
  await click(byText(document, '[role="menuitem"]', item));
}

async function open(options: { email?: boolean; publicAddress?: boolean; provider?: { name: string; passwordsOff?: boolean; people?: string[] } } = {}): Promise<MockServer> {
  const server = await startServer({ mode: "hosted", setup: "done", role: "owner", ...options });
  page = await renderApp(server, "/install");
  await until(() => expect(document.querySelector(".accounts-table tbody tr")).not.toBeNull());
  return server;
}

describe("People", () => {
  it("lists everyone with their role, when they last signed in, “you” and who is switched off — and open invitations", async () => {
    const server = await open();
    const text = page?.text() ?? "";
    expect(row("Sam Rivera").textContent).toContain("You");
    expect(row("Sam Rivera").textContent).toContain("sam@example.com");
    expect((row("Robin Park").querySelector("select") as HTMLSelectElement).value).toBe("editor");
    expect((row("Jo Chen").querySelector("select") as HTMLSelectElement).value).toBe("contributor");
    expect(row("Kim Lee").textContent).toContain("Switched off");
    expect(row("Kim Lee").textContent).toContain("Not yet");
    expect(text).toContain("Open invitations");
    expect(text).toContain("new@example.com");
    // This mock e-mails no links: one line saying links go by hand, and where whoever runs the server reads how to change that.
    expect(text).toContain(NO_EMAIL);
    expect(text).toContain("the guide to running this editor");
    const people = document.querySelector("#people")?.textContent?.toLowerCase() ?? "";
    for (const word of ["user", "token", "session", "revoke", "permission"]) expect(people).not.toContain(word);
    expect(refusals(server)).toEqual([]);
  });

  it("says nothing about sending by hand when the server e-mails links", async () => {
    await open({ email: true });
    expect(page?.text()).not.toContain(NO_EMAIL);
  });

  it("says links go by hand when the server has outgoing e-mail but no public address — and e-mails none", async () => {
    const server = await open({ email: true, publicAddress: false });
    expect(page?.text()).toContain(NO_EMAIL);
    expect(page?.text()).toContain("the guide to running this editor");
    await type(field(document, "E-mail of the person to invite"), "ana@example.com");
    await click(byText(document, "button", "Invite"));
    await until(() => expect(openDialog().textContent).toContain("Send this link to ana@example.com yourself"));
    expect((openDialog().querySelector('input[aria-label="The link"]') as HTMLInputElement).value).toMatch(/\/join#.+/);
    expect(server.accounts?.outbox).toEqual([]);
  });

  it("invites someone: each role explained, the link shown once with Copy, then listed as an open invitation", async () => {
    const server = await open();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    for (const words of ["Everything, including the people who can sign in", "Edits the site, checks changes in Proof, publishes, and reads the inbox.", "Edits the site and sees changes in Proof. An editor or owner publishes them."]) {
      expect(page?.text()).toContain(words);
    }
    await type(field(document, "E-mail of the person to invite"), "not an address");
    await click(byText(document, "button", "Invite"));
    expect(page?.text()).toContain("That e-mail address is missing something.");
    expect(calls(server, "POST", "/api/people/invitations")).toHaveLength(0);

    await type(field(document, "E-mail of the person to invite"), "Ana@Example.com");
    await click(document.querySelector('input[name="invite-role"][value="contributor"]'));
    await click(byText(document, "button", "Invite"));
    await until(() => expect(openDialog().textContent).toContain("An invitation for ana@example.com"));
    expect(calls(server, "POST", "/api/people/invitations")[0]?.body).toEqual({ email: "ana@example.com", role: "contributor" });
    const shown = (openDialog().querySelector('input[aria-label="The link"]') as HTMLInputElement).value;
    expect(shown).toMatch(/^https:\/\/cms\.example\.com\/join#.+/);
    expect(openDialog().textContent).toContain("Send this link to ana@example.com yourself");
    expect(openDialog().textContent).toContain("stops working in 7 days");
    expect(openDialog().textContent).toContain("take this invitation back and invite them again");
    await click(byText(openDialog(), "button", "Copy link"));
    expect(writeText).toHaveBeenCalledWith(shown);

    // Once: closed, it is nowhere on the page, and the list has the invitation.
    await click(byText(openDialog(), "button", "Done"));
    await until(() => expect([...document.querySelectorAll("dialog")].some((element) => element.open)).toBe(false));
    expect(document.body.innerHTML).not.toContain(shown.split("#")[1]);
    await until(() => expect(document.querySelector(".accounts-invitations")?.textContent).toContain("ana@example.com"));
    expect(document.querySelector(".accounts-invitations")?.textContent).toContain("Contributor");
    expect(document.querySelector(".accounts-invitations")?.textContent).toContain("sent by hand");

    // Inviting the same address again is the server's to refuse, in its words.
    await type(field(document, "E-mail of the person to invite"), "ana@example.com");
    await click(byText(document, "button", "Invite"));
    await until(() => expect(page?.text()).toContain("That e-mail has an open invitation already."));
  });

  it("says when an invitation was e-mailed too", async () => {
    const server = await open({ email: true });
    await type(field(document, "E-mail of the person to invite"), "ana@example.com");
    await click(byText(document, "button", "Invite"));
    await until(() => expect(openDialog().textContent).toContain("This link was e-mailed to ana@example.com."));
    expect(server.accounts?.outbox.at(-1)?.to).toBe("ana@example.com");
  });

  it("takes an invitation back: its link stops working", async () => {
    const server = await open();
    const item = [...document.querySelectorAll(".accounts-invitation")].find((element) => element.textContent?.includes("new@example.com"));
    await click(byText(item ?? document, "button", "Take back"));
    await until(() => expect(calls(server, "DELETE", /^\/api\/people\/invitations\//)).toHaveLength(1));
    await until(() => expect(page?.text()).not.toContain("new@example.com"));
    expect(server.accounts?.invitations).toHaveLength(0);
  });

  it("changes a role at once", async () => {
    const server = await open();
    const select = row("Jo Chen").querySelector("select") as HTMLSelectElement;
    const { act: reactAct } = await import("react");
    await reactAct(async () => {
      select.value = "editor";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(() => expect(calls(server, "PATCH", /^\/api\/people\//).at(-1)?.body).toEqual({ role: "editor" }));
    await until(() => expect(server.accounts?.accounts.find((person) => person.name === "Jo Chen")?.role).toBe("editor"));
  });

  it("switches someone off and on again", async () => {
    const server = await open();
    await act("Robin Park", "Switch off");
    await until(() => expect(row("Robin Park").textContent).toContain("Switched off"));
    expect(calls(server, "PATCH", /^\/api\/people\//).at(-1)?.body).toEqual({ disabled: true });
    await act("Robin Park", "Switch on");
    await until(() => expect(row("Robin Park").textContent).not.toContain("Switched off"));
  });

  it("makes a new-password link, shown once", async () => {
    const server = await open();
    await act("Robin Park", "New-password link");
    await until(() => expect(openDialog().textContent).toContain("A new-password link for Robin Park"));
    const shown = (openDialog().querySelector('input[aria-label="The link"]') as HTMLInputElement).value;
    expect(shown).toMatch(/^https:\/\/cms\.example\.com\/new-password#.+/);
    expect(openDialog().textContent).toContain("stops working in 1 hour");
    expect(calls(server, "POST", /\/password-link$/)).toHaveLength(1);
    await click(byText(openDialog(), "button", "Done"));
    await until(() => expect(document.body.innerHTML).not.toContain(shown.split("#")[1]));
  });

  it("a new-password link the server e-mailed isn't shown: the dialog says where it went, with nothing to copy", async () => {
    const server = await open({ email: true });
    await act("Robin Park", "New-password link");
    await until(() => expect(openDialog().textContent).toContain("A new-password link for Robin Park"));
    expect(openDialog().textContent).toContain("The link was e-mailed to Robin Park, and isn’t shown here.");
    expect(openDialog().textContent).toContain("stops working in 1 hour");
    expect(openDialog().querySelector("input")).toBeNull();
    expect(byText(openDialog(), "button", "Copy link")).toBeNull();
    const mailed = server.accounts?.outbox.at(-1);
    expect(mailed).toMatchObject({ to: "robin@example.com", kind: "password" });
    expect(document.body.innerHTML).not.toContain((mailed?.url ?? "#").split("#")[1]);
    expect(calls(server, "POST", /\/password-link$/)).toHaveLength(1);
  });

  it("changes someone else's e-mail, showing the server's refusals in its words", async () => {
    const server = await open();
    await act("Jo Chen", "Change e-mail…");
    await until(() => expect(openDialog().textContent).toContain("Change Jo Chen’s e-mail"));
    const input = () => openDialog().querySelector<HTMLInputElement>('input[type="email"]');
    expect(input()?.value).toBe("jo@example.com");

    // Already someone else's: the server says so, and nothing changes.
    await type(input(), "robin@example.com");
    await click(byText(openDialog(), "button", "Change e-mail"));
    await until(() => expect(openDialog().textContent).toContain("Someone with that e-mail already has an account here."));
    expect(server.accounts?.accounts.find((person) => person.name === "Jo Chen")?.email).toBe("jo@example.com");

    await type(input(), "Jo.Chen@Example.org");
    await click(byText(openDialog(), "button", "Change e-mail"));
    await until(() => expect(server.accounts?.accounts.find((person) => person.name === "Jo Chen")?.email).toBe("jo.chen@example.org"));
    expect(calls(server, "PATCH", /^\/api\/people\//).at(-1)?.body).toEqual({ email: "jo.chen@example.org" });
    await until(() => expect([...document.querySelectorAll("dialog")].some((element) => element.open)).toBe(false));
    await until(() => expect(row("Jo Chen").textContent).toContain("jo.chen@example.org"));
    expect(refusals(server)).toEqual([]);
  });

  it("says what an e-mail is missing before asking the server", async () => {
    const server = await open();
    await act("Jo Chen", "Change e-mail…");
    await until(() => expect(openDialog().textContent).toContain("Change Jo Chen’s e-mail"));
    await type(openDialog().querySelector('input[type="email"]'), "not an address");
    await click(byText(openDialog(), "button", "Change e-mail"));
    await until(() => expect(openDialog().textContent).toContain("That e-mail address is missing something."));
    expect(calls(server, "PATCH", /^\/api\/people\//)).toHaveLength(0);
  });

  it("signs one person out", async () => {
    const server = await open();
    await act("Robin Park", "Sign out");
    await until(() => expect(calls(server, "POST", /^\/api\/people\/[^/]+\/sign-out$/)).toHaveLength(1));
    expect(window.location.pathname).toBe("/install");
  });

  it("removes someone only after saying what they published keeps their name", async () => {
    const server = await open();
    await act("Jo Chen", "Remove…");
    await until(() => expect(openDialog().textContent).toContain("Remove Jo Chen?"));
    expect(openDialog().textContent).toContain("What they published keeps their name");
    expect(calls(server, "DELETE", /^\/api\/people\/(?!invitations)/)).toHaveLength(0);
    await click(byText(openDialog(), "button", "Remove Jo Chen"));
    await until(() => expect(page?.text()).not.toContain("Jo Chen"));
    expect(server.accounts?.accounts.some((person) => person.name === "Jo Chen")).toBe(false);
  });

  it("doesn't offer you changes to your own account: another owner makes those", async () => {
    await open();
    const mine = row("Sam Rivera");
    expect(mine.querySelector("select")).toBeNull();
    expect(mine.querySelector('button[aria-haspopup="menu"]')).toBeNull();
    expect(mine.textContent).toContain("Owner");
    expect(byText(mine, "a", "Your account")?.getAttribute("href")).toBe("/account");
  });

  it("shows the server's refusals in its own words", async () => {
    const server = await open();
    // A switched-off person can't be sent a new-password link until they are switched on.
    await act("Kim Lee", "New-password link");
    await until(() => expect(page?.text()).toContain("This account is switched off, so it can't sign in. Switch it on first."));
    expect([...document.querySelectorAll("dialog")].some((element) => element.open)).toBe(false);

    // Someone another owner removed meanwhile.
    const accounts = server.accounts as unknown as { accounts: Array<{ name: string }> };
    accounts.accounts = accounts.accounts.filter((person) => person.name !== "Jo Chen");
    await act("Jo Chen", "Switch off");
    await until(() => expect(page?.text()).toContain("That person isn't on this editor any more. Reload the list."));
    // The list is read again, so they are gone from it.
    await until(() => expect([...document.querySelectorAll(".accounts-table tbody tr")].some((candidate) => candidate.textContent?.includes("Jo Chen"))).toBe(false));

    // Refused inside the confirmation when removing: nothing else changes.
    accounts.accounts = accounts.accounts.filter((person) => person.name !== "Robin Park");
    await act("Robin Park", "Remove…");
    await click(byText(openDialog(), "button", "Remove Robin Park"));
    await until(() => expect(openDialog().textContent).toContain("That person isn't on this editor any more."));
  });

  it("signs everyone out after a confirmation, this browser included", async () => {
    const server = await open();
    await click(byText(document, "button", "Sign everyone out…"));
    await until(() => expect(openDialog().textContent).toContain("yours included"));
    expect(calls(server, "POST", "/api/people/sign-out")).toHaveLength(0);
    await click(byText(openDialog(), "button", "Sign everyone out"));
    await until(() => expect(window.location.pathname).toBe("/login"));
    expect(server.backend.authenticated).toBe(false);
  });

  it("a new owner sees the Install page, and the editor they were does not", async () => {
    const server = await open();
    const select = row("Robin Park").querySelector("select") as HTMLSelectElement;
    const { act: reactAct } = await import("react");
    await reactAct(async () => {
      select.value = "owner";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(() => expect(server.accounts?.accounts.find((person) => person.name === "Robin Park")?.role).toBe("owner"));
    // Robin, now an owner, signs in and finds People.
    await page?.unmount();
    const accounts = server.accounts as unknown as { signedIn: string | null; accounts: Array<{ id: string; name: string }> };
    accounts.signedIn = accounts.accounts.find((person) => person.name === "Robin Park")?.id ?? null;
    page = await renderApp(server, "/install");
    await until(() => expect(row("Robin Park").textContent).toContain("You"));
    expect(refusals(server)).toEqual([]);
  });
});

describe("People, with an identity provider", () => {
  /** The labels of a person's menu, as it opens. */
  async function menu(name: string): Promise<string[]> {
    await click(row(name).querySelector('button[aria-haspopup="menu"]'));
    await until(() => expect(document.querySelector('[role="menuitem"]')).not.toBeNull());
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim() ?? "");

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    return labels;
  }

  it("offers nothing the server refuses for someone who signs in through it: no role picker, no new-password link, no e-mail change; Remove switches them off, Delete comes after", async () => {
    await open({ provider: { name: "Acme ID", people: ["robin@example.com", "kim@example.com"] } });

    expect(row("Robin Park").textContent).toContain("Signs in with Acme ID (robin-at-provider)");
    expect(row("Robin Park").querySelector("select")).toBeNull();
    expect(row("Robin Park").textContent).toContain("Editor, set at Acme ID");
    const robin = await menu("Robin Park");

    expect(robin).not.toContain("New-password link");
    expect(robin).not.toContain("Change e-mail…");
    expect(robin).toContain("Remove (switch off)");
    expect(robin).not.toContain("Delete…");
    // Kim is switched off: deleting is offered now.
    const kim = await menu("Kim Lee");

    expect(kim).toEqual(expect.arrayContaining(["Switch on", "Delete…"]));
    // Someone who signs in with a password is offered everything, as before.
    expect(row("Jo Chen").querySelector("select")).not.toBeNull();
    expect(await menu("Jo Chen")).toEqual(expect.arrayContaining(["New-password link", "Change e-mail…", "Remove…"]));
    expect(page?.text()).toContain("Invite someone");
  });

  it("with passwords off, offers no invitation and no new-password link for anyone", async () => {
    await open({ provider: { name: "Acme ID", passwordsOff: true, people: ["robin@example.com"] } });

    expect(page?.text()).not.toContain("Invite someone");
    expect(page?.text()).toContain("Passwords are off: nobody is invited here.");
    expect(await menu("Jo Chen")).not.toContain("New-password link");
  });
});

