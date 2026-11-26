/**
 * Passwords off (GALLEY_OIDC_ONLY), against real state files: the store
 * refuses every session but the provider's and a recovery link's, and once
 * passwords were off, every other session from before then for good; the
 * people refuse invitations, "forgot" and an owner's links; the server's
 * own link signs in without a password and changes nothing else.
 */
import { describe, expect, it } from "vitest";
import { GalleyError } from "../../src/errors";
import { createPeople, PASSWORDS_OFF } from "../../src/install/people";
import { openInstallState } from "../../src/install/state";
import { tempDir } from "./helpers";

const PASSWORD = "correct horse battery staple";

describe("sessions with passwords off", () => {
  it("only the provider's and a recovery link's count; after the first switch, no other from before it ever counts again", async () => {
    const home = tempDir("passwords-off-");
    const on = await openInstallState(home);
    const people = createPeople(on);
    const sam = await people.createOwner({ password: PASSWORD, name: "Sam", email: "sam@example.com" });
    const at = on.nextIssuedAt(Date.now(), sam.id);
    const session = (kind: string | undefined, issuedAt = at) => ({ id: `s-${kind}-${issuedAt}`, issuedAt, accountId: sam.id, ...(kind ? { kind } : {}) });

    for (const kind of [undefined, "password", "provider", "recovery"]) expect(on.sessionValid(session(kind)), String(kind)).toBe(true);
    const off = await openInstallState(home, { passwordsOff: true });

    await off.turnPasswordsOff(at + 10);
    expect([undefined, "password", "provider", "recovery"].map((kind) => off.sessionValid(session(kind)))).toEqual([false, false, true, false]);
    expect(off.sessionValid(session("recovery", at + 20))).toBe(true);
    // Passwords on again: a password session from after the switch counts; none from before it does.
    const again = await openInstallState(home);

    expect(again.sessionValid(session("password", at + 20))).toBe(true);
    expect(again.sessionValid(session("password"))).toBe(false);
    expect(again.sessionValid(session("provider"))).toBe(true);
    // The moment is kept from the first switch only.
    await (await openInstallState(home, { passwordsOff: true })).turnPasswordsOff(at + 1000);
    expect((await openInstallState(home)).read().oidcOnlySince).toBe(at + 10);
  });
});

describe("people with passwords off", () => {
  it("refuse invitations, \"forgot\" and an owner's links; the sign-in screen offers the provider; the server's link signs in and sets no password", async () => {
    const home = tempDir("passwords-off-");
    const store = await openInstallState(home);
    const before = createPeople(store);
    const sam = await before.createOwner({ password: PASSWORD, name: "Sam", email: "sam@example.com" });
    const { link: invitation } = await before.invite(sam.id, { email: "cy@example.com", role: "editor" });
    const people = createPeople(store, { providerConfigured: true, passwordsOff: true });
    const refused = async (work: Promise<unknown>) => {
      const error = await work.then(() => null, (caught: unknown) => caught);

      expect(error).toBeInstanceOf(GalleyError);
      expect((error as GalleyError).message).toContain(PASSWORDS_OFF);
    };

    expect(people.signInWith()).toBe("provider");
    await refused(people.invite(sam.id, { email: "ed@example.com", role: "editor" }));
    await refused(people.passwordLink(sam.id, sam.id).catch((error: unknown) => Promise.reject(error)));
    expect(await people.forgot("sam@example.com")).toBeNull();
    // An invitation from before: no way in now.
    expect(() => people.checkLink(invitation.code)).toThrow(/doesn't work any more/);
    // The server's link: a sign-in, with no password asked for or set.
    const rescued = (await people.rescue())!;
    const hash = store.read().accounts[0]!.passwordHash;

    expect(people.checkLink(rescued.link.code)).toMatchObject({ kind: "sign-in", email: "sam@example.com" });
    expect(await people.useLink(rescued.link.code, {})).toMatchObject({ kind: "sign-in", account: { id: sam.id } });
    expect(store.read().accounts[0]!.passwordHash).toBe(hash);
    expect(store.read().links).toEqual([expect.objectContaining({ id: invitation.id })]);
  });
});
