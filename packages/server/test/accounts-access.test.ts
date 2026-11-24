/**
 * Who may call what, driven by the one table itself (core
 * install/route-access.ts): for every route in it and each of owner, editor,
 * contributor and signed out, the server either lets the request through to
 * the handler or refuses it exactly as the table says. No list of routes is
 * kept here — a route added to the API is checked the moment it is in the
 * table.
 *
 * Against a real install state (real accounts, real cookies); the engine
 * behind the routes is a fake that throws, so "through" means "the guard let
 * it reach the handler", whatever the handler then answered.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiRouteKey } from "@galley/core/api";
import { ACCOUNT_ROLES, createPeople, levelFor, openInstallState, ROLE_REFUSAL as CORE_ROLE_REFUSAL, ROUTE_ACCESS, roleMayCall, type Account, type AccountRole, type Install, type InstallStore } from "@galley/core/install";
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROLE_REFUSAL } from "../src/app";
import { signSession } from "../src/auth";
import { isEditorHostRoute, isMultiSiteRoute } from "../src/hosted-refusals";
import { fake, json, testApp, TOKEN, type TestApp } from "./helpers";

const PASSWORD = "correct horse battery staple";
const HOST = "https://cms.example.com";
const home = realpathSync(mkdtempSync(join(tmpdir(), "galley-access-")));
let store: InstallStore;
let app: TestApp;
let key: Uint8Array;
const people: Record<AccountRole, Account> = {} as Record<AccountRole, Account>;

beforeAll(async () => {
  store = await openInstallState(home);
  const engine = createPeople(store);
  const owner = await engine.createOwner({ password: PASSWORD, name: "Sam Owner", email: "sam@example.com" });

  people.owner = owner;
  for (const role of ["editor", "contributor"] as const) {
    const { link } = await engine.invite(owner.id, { email: `${role}@example.com`, role });

    people[role] = (await engine.useLink(link.code, { password: PASSWORD, name: role })).account;
  }
  // Only what the guards read is real: the state and the people. Anything a handler asks of the install beyond that throws ("not faked").
  const install = fake<Install>("install", { store, people: engine, home, meta: () => ({ singleSite: true, setupNeeded: false, passwordSet: true, siteId: null, signInWith: "email" }) });

  key = randomBytes(32);
  app = testApp({}, { mode: "hosted", token: TOKEN, install, cookieKey: key, allowedHosts: ["cms.example.com"], publicOrigin: HOST });
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

/** A fresh cookie for this person, as signing in would make it (made per request: a route like "sign out everywhere" ends the ones before). */
function cookieFor(role: AccountRole): string {
  const id = people[role].id;

  return `galley_session_test=${signSession(key, store.nextIssuedAt(Date.now(), id), undefined, id)}`;
}

function urlOf(route: ApiRouteKey): { method: string; path: string } {
  const [method, path] = route.split(" ") as [string, string];

  return { method, path: path.replace(/:([A-Za-z]+)/g, (_match, name: string) => `x-${name.toLowerCase()}`) };
}

async function ask(route: ApiRouteKey, who: AccountRole | "nobody" | "token"): Promise<{ status: number; message: string }> {
  const { method, path } = urlOf(route);
  const headers: Record<string, string> = method === "GET" ? {} : { origin: HOST };

  if (who === "token") headers.authorization = `Bearer ${TOKEN}`;
  else if (who !== "nobody") headers.cookie = cookieFor(who);
  const response = await app.raw(method, `${HOST}${path}`, { headers, ...(method === "GET" || method === "DELETE" ? {} : { body: {} }) });
  const type = response.headers.get("content-type") ?? "";

  // The event stream never ends by itself: what counts is that it opened.
  if (type.startsWith("text/event-stream")) {
    await response.body?.cancel();
    return { status: response.status, message: "" };
  }
  const body = type.includes("json") ? ((await json(response).catch(() => null)) as { error?: { message?: string } } | null) : (await response.text(), null);

  return { status: response.status, message: body?.error?.message ?? "" };
}

/** A refusal made by the guard (as opposed to whatever the handler said). */
function refusedBy(answer: { status: number; message: string }): "signed-out" | "role" | null {
  if (answer.status === 401 && /^(Sign in to continue\.|Open the setup link to continue|The setup link has been used already)/.test(answer.message)) return "signed-out";
  if (answer.status === 403 && answer.message === ROLE_REFUSAL) return "role";
  return null;
}

const routes = Object.keys(ROUTE_ACCESS) as ApiRouteKey[];

describe("who may call what: every route in the table", () => {
  it("the table names every route (a route without a level doesn't compile, and this catches one added at run time)", () => {
    expect(routes.length).toBeGreaterThan(200);
    for (const route of routes) expect(["public", "setup", "restore", "edit", "publish", "manage"]).toContain(ROUTE_ACCESS[route]);
  });

  it.each(routes)("%s", async (route) => {
    const { method, path } = urlOf(route);

    // The existing hosted refusals answer before anyone is asked who they are: the same for everyone.
    if (isEditorHostRoute(path) || isMultiSiteRoute(method, path)) {
      for (const who of [...ACCOUNT_ROLES, "nobody"] as const) {
        const answer = await ask(route, who);

        expect(answer.status, `${who}: ${answer.message}`).toBe(isEditorHostRoute(path) ? 404 : 403);
        expect(refusedBy(answer)).toBeNull();
      }
      return;
    }
    const stranger = await ask(route, "nobody");

    if (ROUTE_ACCESS[route] === "public") expect(refusedBy(stranger), `nobody: ${stranger.status} ${stranger.message}`).toBeNull();
    else expect(refusedBy(stranger), `nobody: ${stranger.status} ${stranger.message}`).toBe("signed-out");
    for (const role of ACCOUNT_ROLES) {
      const answer = await ask(route, role);

      expect(refusedBy(answer), `${role} (needs ${levelFor(route) ?? "nothing"}): ${answer.status} ${answer.message}`).toBe(roleMayCall(role, route) ? null : "role");
    }
  });

  it("a role refusal is one plain sentence with 403 — never a 404, never a crash", async () => {
    const answer = await ask("POST /api/sites/:siteId/publish", "contributor");

    expect(answer).toEqual({ status: 403, message: "Your account can't do that. Ask an owner of this editor." });
  });

  it("the refusal's whole body is the error shape with code \"forbidden\" and the table's sentence — what the web app's mock sends too", async () => {
    const response = await app.raw("POST", `${HOST}/api/sites/x-siteid/publish`, { headers: { origin: HOST, cookie: cookieFor("contributor") }, body: {} });

    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: { code: "forbidden", message: CORE_ROLE_REFUSAL } });
    expect(ROLE_REFUSAL).toBe(CORE_ROLE_REFUSAL);
  });
});

describe("the operator's access token keeps the reach it had", () => {
  it("passes every guard except the few that need a person's browser", async () => {
    for (const route of routes) {
      const { method, path } = urlOf(route);

      if (ROUTE_ACCESS[route] === "public" || isEditorHostRoute(path) || isMultiSiteRoute(method, path)) continue;
      const answer = await ask(route, "token");

      expect(refusedBy(answer), `${route}: ${answer.status} ${answer.message}`).toBeNull();
      if (ROUTE_ACCESS[route] === "restore") expect(answer).toEqual({ status: 403, message: "A backup can only be put back from a signed-in browser." });
    }
    // Your own account and the People list are a person's: a script has none.
    for (const route of ["GET /api/account", "GET /api/people", "POST /api/people/invitations"] as const) {
      expect((await ask(route, "token")).message).toMatch(/needs someone signed in to this editor in a browser/);
    }
  });
});

describe("local mode", () => {
  it("has no accounts: every account route answers 404, and any session may call the rest as before", async () => {
    const local = testApp();
    const accountRoutes = routes.filter((route) => /^\S+ \/api\/(account|people|auth\/link|auth\/forgot)/.test(route));

    expect(accountRoutes).toHaveLength(14);
    for (const route of accountRoutes) {
      const { method, path } = urlOf(route);
      const response = await local.call(method, path, method === "GET" || method === "DELETE" ? undefined : {});

      expect(response.status, route).toBe(404);
      expect((await json(response)).error.message).toBe("This app isn't a hosted install, so there are no accounts here.");
    }
    // "manage" routes are open to the one person on their own computer.
    expect((await local.call("GET", "/api/install")).status).toBe(404);
    expect((await local.raw("GET", "/api/install")).status).toBe(401);
  });
});
