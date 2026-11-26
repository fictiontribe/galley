/**
 * The preview's viewer cookie is bound to a person's session (gateway-auth.ts),
 * against a real install state: it dies when that person is signed out,
 * switched off, removed or changes their password — and a session that names
 * nobody (from before accounts) never gets one.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createPeople, openInstallState } from "@galley/core/install";
import { SESSION_MAX_AGE_S, type SessionInfo } from "../src/auth";
import { createGatewayTickets } from "../src/gateway-auth";

const PASSWORD = "correct horse battery staple";
const home = realpathSync(mkdtempSync(join(tmpdir(), "galley-viewer-")));

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("the viewer cookie and the person's session", () => {
  it("ends with a sign-out everywhere, a switch-off, a removal and a new password; never made for a session without a person", async () => {
    const store = await openInstallState(home);
    const people = createPeople(store);
    const owner = await people.createOwner({ password: PASSWORD, name: "Sam", email: "sam@example.com" });
    const invited = async (email: string) => (await people.useLink((await people.invite(owner.id, { email, role: "editor" })).link.code, { password: PASSWORD, name: email })).account;
    const tickets = createGatewayTickets({ key: randomBytes(32), store });
    const session = (accountId: string): SessionInfo => {
      const issuedAt = store.nextIssuedAt(Date.now(), accountId);

      return { id: randomBytes(16).toString("base64url"), issuedAt, expiresAt: issuedAt + SESSION_MAX_AGE_S * 1000, kind: "password", accountId };
    };
    const viewer = (stamp: SessionInfo) => tickets.redeem(tickets.issue(stamp));
    const ed = await invited("ed@example.com");
    const cy = await invited("cy@example.com");
    const sams = viewer(session(owner.id))!;
    const eds = viewer(session(ed.id))!;
    const cys = viewer(session(cy.id))!;

    expect([tickets.check(sams), tickets.check(eds), tickets.check(cys)]).toEqual([true, true, true]);
    // A session from before accounts, with no person in it, gets nothing.
    expect(tickets.redeem(tickets.issue({ id: "no-person", issuedAt: Date.now(), expiresAt: Date.now() + 60_000 }))).toBeNull();
    // Switched off, removed: theirs end; nobody else's.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await people.change(owner.id, ed.id, { disabled: true });
    await people.remove(owner.id, cy.id);
    expect([tickets.check(sams), tickets.check(eds), tickets.check(cys)]).toEqual([true, false, false]);
    // Signed out everywhere, and a new password, end the person's own.
    const again = viewer(session(owner.id))!;

    await people.signOut(owner.id);
    expect([tickets.check(sams), tickets.check(again)]).toEqual([false, false]);
    const fresh = viewer(session(owner.id))!;

    expect(tickets.check(fresh)).toBe(true);
    expect(await people.changePassword(owner.id, PASSWORD, "a brand new password")).toBe(true);
    expect(tickets.check(fresh)).toBe(false);
    // A ticket waiting for a session that ended is dropped too.
    const waiting = tickets.issue(session(owner.id));

    await people.signOut(owner.id);
    expect(tickets.redeem(waiting)).toBeNull();
    tickets.dispose();
  });
});
