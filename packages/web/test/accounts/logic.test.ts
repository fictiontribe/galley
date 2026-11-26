import { describe, expect, it } from "vitest";
import type { MetaInfo } from "@galley/core/types";
import { ACCOUNT_ROLES, ROLE_ACCESS, type AccountRole, type AccountSession } from "@galley/core/install/accounts";
import { ROUTE_ACCESS, roleMayCall } from "@galley/core/install/route-access";
import type { ApiRouteKey } from "@galley/core/api";
import { BUILD_MODE_LEVEL, SITE_SETTINGS_LEVEL } from "@galley/core/install/route-access";
import { BUILD_BY_OTHERS, SETTINGS_BY_OTHERS, accountOf, mayCall, mayLevel, ROLE_LINES, whoMay, whoMayFirst, whoPublishes } from "../../src/lib/may";
import { codeFromHash, completeKind, emailProblem, initials, linkKindAt, loginBody, loginProblem, nameProblem, personLabel, providerRefusal, takeLinkCode, timeLeft } from "../../src/features/accounts/logic";

function meta(role: AccountRole | null, mode: "local" | "hosted" = "hosted"): MetaInfo {
  const account: AccountSession | undefined = role
    ? { id: "a1", name: "Sam", email: "sam@example.com", role, createdAt: "2026-01-01T00:00:00Z", lastSeenAt: null, disabled: false, access: ROLE_ACCESS[role] }
    : undefined;
  return { mode, authenticated: true, account } as unknown as MetaInfo;
}

describe("may this person do that", () => {
  it("answers from the one table, for every route and role", () => {
    for (const role of ACCOUNT_ROLES) {
      for (const route of Object.keys(ROUTE_ACCESS) as ApiRouteKey[]) expect(mayCall(meta(role), route)).toBe(roleMayCall(role, route));
    }
  });

  it("follows the roles the owner decided", () => {
    expect(mayCall(meta("contributor"), "PATCH /api/sites/:siteId/entry")).toBe(true);
    expect(mayCall(meta("contributor"), "GET /api/sites/:siteId/changes")).toBe(true);
    expect(mayCall(meta("contributor"), "POST /api/sites/:siteId/publish")).toBe(false);
    expect(mayCall(meta("contributor"), "POST /api/sites/:siteId/revert")).toBe(false);
    expect(mayCall(meta("contributor"), "GET /api/sites/:siteId/inbox")).toBe(false);
    expect(mayCall(meta("editor"), "POST /api/sites/:siteId/publish")).toBe(true);
    expect(mayCall(meta("editor"), "GET /api/sites/:siteId/inbox")).toBe(true);
    expect(mayCall(meta("editor"), "GET /api/install")).toBe(false);
    expect(mayCall(meta("editor"), "GET /api/people")).toBe(false);
    expect(mayCall(meta("owner"), "GET /api/people")).toBe(true);
  });

  it("is always yes where there are no accounts: local mode, the desktop app, a server from before accounts", () => {
    expect(accountOf(meta(null, "local"))).toBeNull();
    expect(mayCall(meta(null, "local"), "GET /api/install")).toBe(true);
    expect(mayCall(meta(null, "hosted"), "POST /api/sites/:siteId/publish")).toBe(true);
    expect(mayCall(null, "PATCH /api/settings")).toBe(true);
    // An account on a local server is never trusted to narrow anything.
    expect(mayCall(meta("contributor", "local"), "POST /api/sites/:siteId/publish")).toBe(true);
  });

  it("says who puts a change live: you, or for a role that doesn't publish, an editor or owner", () => {
    expect(whoPublishes(true)).toBe("you publish");
    expect(whoPublishes(false)).toBe("an editor or owner publishes");
    // Decided by the table, so a role's words follow what it may do.
    for (const role of ACCOUNT_ROLES) expect(whoPublishes(mayCall(meta(role), "POST /api/sites/:siteId/publish"))).toBe(role === "contributor" ? "an editor or owner publishes" : "you publish");
    expect(whoPublishes(mayCall(meta(null, "local"), "POST /api/sites/:siteId/publish"))).toBe("you publish");
  });

  it("answers build mode and the site's settings by level, never by role name", () => {
    for (const role of ACCOUNT_ROLES) {
      expect(mayLevel(meta(role), BUILD_MODE_LEVEL)).toBe(ROLE_ACCESS[role].includes(BUILD_MODE_LEVEL));
      expect(mayLevel(meta(role), SITE_SETTINGS_LEVEL)).toBe(ROLE_ACCESS[role].includes(SITE_SETTINGS_LEVEL));
    }
    expect(mayLevel(meta("contributor"), BUILD_MODE_LEVEL)).toBe(false);
    expect(mayLevel(meta("editor"), BUILD_MODE_LEVEL)).toBe(true);
    expect(mayLevel(meta("editor"), SITE_SETTINGS_LEVEL)).toBe(false);
    // No accounts: everything, as before.
    expect(mayLevel(meta(null, "local"), SITE_SETTINGS_LEVEL)).toBe(true);
    expect(mayLevel(meta("contributor", "local"), BUILD_MODE_LEVEL)).toBe(true);
    expect(mayLevel(null, BUILD_MODE_LEVEL)).toBe(true);
  });

  it("says who may, from the roles that have the level", () => {
    expect(whoMay("publish")).toBe("an editor or owner");
    expect(whoMay("manage")).toBe("an owner");
    expect(whoMay("edit")).toBe("anyone signed in");
    expect(whoMayFirst(BUILD_MODE_LEVEL)).toBe("An editor or owner");
    expect(BUILD_BY_OTHERS).toBe("An editor or owner can do this.");
    expect(SETTINGS_BY_OTHERS).toBe("An owner of this editor can change this.");
  });

  it("has a line for every role, in plain words", () => {
    for (const role of ACCOUNT_ROLES) expect(ROLE_LINES[role]).toMatch(/\.$/);
    for (const line of Object.values(ROLE_LINES)) expect(line).not.toMatch(/user|permission|token|session/i);
  });
});

describe("signing in", () => {
  it("sends the e-mail only when the install signs in with one", () => {
    expect(loginBody("email", " Sam@Example.com ", "pw")).toEqual({ email: "sam@example.com", password: "pw" });
    expect(loginBody("password", "sam@example.com", "pw")).toEqual({ password: "pw" });
    expect(loginBody(undefined, "sam@example.com", "pw")).toEqual({ password: "pw" });
  });

  it("says what is missing before sending", () => {
    expect(loginProblem("email", "", "pw")).toBe("Enter your e-mail and password.");
    expect(loginProblem("email", "a@b.co", "")).toBe("Enter your e-mail and password.");
    expect(loginProblem("password", "", "")).toBe("Enter the password.");
    expect(loginProblem("email", "a@b.co", "pw")).toBeNull();
  });

  it("checks a name and an e-mail", () => {
    expect(nameProblem("  ")).toMatch(/^Enter a name/);
    expect(nameProblem("Sam")).toBeNull();
    expect(emailProblem("")).toBe("Enter an e-mail address.");
    expect(emailProblem("sam@example")).toMatch(/missing something/);
    expect(emailProblem("sam@example.com")).toBeNull();
  });
});

describe("one-time links", () => {
  it("knows its pages and reads the code from the fragment", () => {
    expect(linkKindAt("/join")).toBe("invitation");
    expect(linkKindAt("/new-password")).toBe("password");
    expect(linkKindAt("/login")).toBeNull();
    expect(codeFromHash("#abc-123")).toBe("abc-123");
    expect(codeFromHash("#")).toBeNull();
    expect(codeFromHash("")).toBeNull();
  });

  it("takes the code out of the address once, keeping the rest, and gives the same code when asked again on that page", () => {
    const replaced: string[] = [];
    const history = { state: { idx: 1 }, replaceState: (_state: unknown, _title: string, url: string) => void replaced.push(url) };
    expect(takeLinkCode({ pathname: "/join", search: "?x=1", hash: "#the-code" }, history)).toBe("the-code");
    expect(replaced).toEqual(["/join?x=1"]);
    expect(takeLinkCode({ pathname: "/join", search: "?x=1", hash: "" }, history)).toBe("the-code");
    expect(takeLinkCode({ pathname: "/new-password", search: "", hash: "" }, history)).toBeNull();
    expect(replaced).toHaveLength(1);
  });

  it("says how long a link has left in words", () => {
    const now = Date.parse("2026-11-24T12:00:00Z");
    expect(timeLeft("2026-12-01T12:00:00Z", now)).toBe("in 7 days");
    expect(timeLeft("2026-11-24T13:00:00Z", now)).toBe("in 1 hour");
    expect(timeLeft("2026-11-24T12:45:00Z", now)).toBe("in 45 minutes");
    expect(timeLeft("2026-11-24T12:00:30Z", now)).toBe("in 1 minute");
    expect(timeLeft("2026-11-24T11:00:00Z", now)).toBe("now");
  });
});

describe("who someone is, in a line", () => {
  it("is their name, else their e-mail; and two letters for the button", () => {
    expect(personLabel({ name: "Robin Park", email: "robin@example.com" })).toBe("Robin Park");
    expect(personLabel({ name: "", email: "robin@example.com" })).toBe("robin@example.com");
    expect(initials({ name: "Robin Park", email: "" })).toBe("RP");
    expect(initials({ name: "Robin de la Park", email: "" })).toBe("RP");
    expect(initials({ name: "Jo", email: "" })).toBe("JO");
    expect(initials({ name: "", email: "kim@example.com" })).toBe("K");
  });
});

describe("an account that isn't complete", () => {
  it("is asked for a name alone when it has an e-mail, and for both details when it has neither", () => {
    expect(completeKind({ name: "", email: "ed@example.com" })).toBe("name");
    expect(completeKind({ name: "", email: "" })).toBe("details");
    // Someone who signs in through the identity provider is asked only for a name, e-mail or not: no password, and the e-mail is the provider's.
    expect(completeKind({ name: "", email: "", viaProvider: true })).toBe("name");
    expect(completeKind({ name: "", email: "pat@example.com", viaProvider: true })).toBe("name");
    expect(completeKind({ name: "Sam Owner", email: "" })).toBe("details");
  });
});

describe("a sign-in through the identity provider that was refused", () => {
  it("is said in a sentence chosen by its code, never the provider's own words; an unknown code says nothing", () => {
    for (const code of ["provider-unreachable", "provider-no-pkce", "provider-misconfigured", "refused-state", "another-tab", "provider-error", "provider-cancelled", "refused-token", "no-role", "bad-role", "removed", "switched-off", "signed-out", "full", "too-many"]) {
      const sentence = providerRefusal(code, "Example Sign-in");

      expect(sentence, code).toMatch(/^[A-Z].*\.$/);
      expect(sentence, code).not.toMatch(/<|undefined|null/);
    }
    expect(providerRefusal("another-tab", "Example Sign-in")).toBe("Another sign-in was started in this browser. Start again.");
    expect(providerRefusal("removed", "Example Sign-in")).toBe("You were removed from this editor. Ask one of its owners.");
    expect(providerRefusal("provider-cancelled", "Example Sign-in")).toBe("The sign-in was cancelled at Example Sign-in.");
    expect(providerRefusal("signed-out", "X", String(Date.UTC(2026, 10, 25, 16, 40)))).toMatch(/^You were signed out at \d{1,2}[:.]\d{2}.*\. Sign in again\.$/);
    expect(providerRefusal("signed-out", "X", "<b>")).toBe("You were signed out. Sign in again.");
    for (const code of [null, "", "constructor", "toString", "__proto__", "<script>"]) expect(providerRefusal(code, "X")).toBeNull();
  });
});
