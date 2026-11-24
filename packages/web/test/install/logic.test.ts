import { afterEach, describe, expect, it, vi } from "vitest";
import type { MetaInfo } from "@galley/core/types";
import { api, setSetupCode, setUnauthorizedHandler, setupCodeHeaders } from "../../src/lib/api";
import { carriesSetupCode, hostedHome, isMultiSiteRequest, keyPageFor, looksLikeRepository, resumesAfterSignIn } from "../../src/lib/hosted";
import { backupFileName, connectRequest, describeCheck, detailsProblems, detailsRequest, emptySiteDraft, passwordProblem, setupBlock, siteDraftProblem } from "../../src/features/install/logic";

const brand = { productName: "Editor" } as MetaInfo["brand"];
function meta(patch: Partial<MetaInfo>): MetaInfo {
  return { version: "1", brand, mode: "hosted", authenticated: false, desktop: false, platform: "linux", ...patch };
}

describe("where / leads", () => {
  it("is the Sites screen locally (no answer here) and the desktop app", () => {
    expect(hostedHome(meta({ mode: "local", authenticated: true }))).toBeNull();
    expect(hostedHome(null)).toBeNull();
  });

  it("is first run while it isn't over, signed in or not", () => {
    const install = { singleSite: true as const, setupNeeded: true, siteId: null };
    expect(hostedHome(meta({ install }))).toBe("/setup");
    expect(hostedHome(meta({ install, authenticated: true }))).toBe("/setup");
  });

  it("is sign-in, then first run, when first run was left half-way with the password chosen", () => {
    const install = { singleSite: true as const, setupNeeded: true, siteId: null };
    expect(hostedHome(meta({ install: { ...install, passwordSet: true } }))).toBe("/login?next=%2Fsetup");
    expect(resumesAfterSignIn(meta({ install: { ...install, passwordSet: true } }))).toBe(true);
    expect(hostedHome(meta({ install: { ...install, passwordSet: true }, authenticated: true }))).toBe("/setup");
    expect(hostedHome(meta({ install: { ...install, passwordSet: false } }))).toBe("/setup");
    expect(resumesAfterSignIn(meta({ install }))).toBe(false);
    expect(resumesAfterSignIn(meta({ install: { ...install, setupNeeded: false, passwordSet: true } }))).toBe(false);
    expect(resumesAfterSignIn(meta({ mode: "local", install: { ...install, passwordSet: true } }))).toBe(false);
  });

  it("is the one site once signed in, and sign-in before that", () => {
    const install = { singleSite: true as const, setupNeeded: false, siteId: "site one" };
    expect(hostedHome(meta({ install, authenticated: true }))).toBe("/sites/site%20one");
    expect(hostedHome(meta({ install: { ...install, siteId: null } }))).toBe("/login");
  });
});

describe("the routes a hosted install refuses", () => {
  it.each([
    ["GET", "/api/groups"],
    ["PATCH", "/api/groups/g1"],
    ["PUT", "/api/groups/order"],
    ["POST", "/api/sites/scan"],
    ["POST", "/api/sites/scan/cancel"],
    ["POST", "/api/sites/add"],
    ["POST", "/api/sites/open"],
    ["POST", "/api/sites/clone"],
    ["POST", "/api/sites/create"],
    ["GET", "/api/fs/list?path=%2F"],
    ["GET", "/api/open?root=%2Fx"],
    ["PATCH", "/api/sites/s1/listing"],
    ["DELETE", "/api/sites/s1"],
  ])("%s %s is multi-site", (method, url) => {
    expect(isMultiSiteRequest(method, url)).toBe(true);
  });

  it.each([
    ["GET", "/api/sites"],
    ["GET", "/api/sites/s1"],
    ["DELETE", "/api/sites/s1/threads/t1"],
    ["POST", "/api/sites/s1/presence"],
    ["GET", "/api/sites/s1/connections"],
  ])("%s %s is not", (method, url) => {
    expect(isMultiSiteRequest(method, url)).toBe(false);
  });
});

describe("the setup code", () => {
  afterEach(() => {
    setSetupCode(null);
    setUnauthorizedHandler(null);
    vi.unstubAllGlobals();
  });

  it("goes to first-run routes only", () => {
    for (const url of ["/api/setup", "/api/setup/password", "/api/setup/site/check", "/api/install/restore", "/api/install/restore/upload", "/api/jobs/j1"]) expect(carriesSetupCode(url)).toBe(true);
    for (const url of ["/api/meta", "/api/sites", "/api/settings", "/api/secrets/anthropic", "/api/install", "/api/install/password", "/api/install/backup", "/api/setupx", "/api/auth/login"]) expect(carriesSetupCode(url)).toBe(false);
  });

  it("is sent as Authorization: Bearer by the JSON client while held, and never otherwise", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setSetupCode("fake-code");
    await api("GET /api/setup");
    await api("GET /api/meta");
    setSetupCode(null);
    await api("GET /api/setup");
    const headers = fetchMock.mock.calls.map((call) => ((call as unknown as [string, RequestInit])[1].headers as Record<string, string>).authorization ?? null);
    expect(headers).toEqual(["Bearer fake-code", null, null]);
    expect(setupCodeHeaders("/api/setup")).toEqual({});
  });

  it("refused on a first-run route is the setup screen's to explain, not a lost session", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "No." } }), { status: 401 }));
    const lost = vi.fn();
    setUnauthorizedHandler(lost);
    setSetupCode("fake-code");
    await expect(api("GET /api/setup")).rejects.toMatchObject({ status: 401 });
    await expect(api("POST /api/install/password", { body: { current: "a", next: "b" } })).rejects.toMatchObject({ status: 401 });
    expect(lost).not.toHaveBeenCalled();
    await expect(api("GET /api/settings")).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("reads a refusal as no link or a bad one", () => {
    expect(setupBlock(401, false)).toBe("no-link");
    expect(setupBlock(403, true)).toBe("bad-link");
    expect(setupBlock(500, true)).toBeNull();
  });
});

describe("first run's forms", () => {
  it("wants a long password typed the same twice", () => {
    expect(passwordProblem("short", "short")).toMatch(/at least 12/);
    expect(passwordProblem("long enough pass", "long enough pasS")).toMatch(/don’t match/);
    expect(passwordProblem("long enough pass", "long enough pass")).toBeNull();
  });

  it("builds the connect request, with the token only for token access and the starter only for a starter", () => {
    const draft = { ...emptySiteDraft(), repository: " git@github.com:example/site.git ", starter: "astro", name: "Sam’s site" };
    expect(connectRequest(draft, "ignored")).toEqual({ repository: "git@github.com:example/site.git", access: "deploy-key" });
    expect(connectRequest({ ...draft, access: "token", source: "starter" }, " fake-token ")).toEqual({ repository: "git@github.com:example/site.git", access: "token", token: "fake-token", starter: { id: "astro", name: "Sam’s site" } });
  });

  it("says what's missing before checking", () => {
    expect(siteDraftProblem(emptySiteDraft(), "", looksLikeRepository)).toMatch(/Paste the repository/);
    expect(siteDraftProblem({ ...emptySiteDraft(), repository: "my site" }, "", looksLikeRepository)).toMatch(/doesn’t look like a repository address/);
    expect(siteDraftProblem({ ...emptySiteDraft(), repository: "https://gitlab.com/a/b", access: "token" }, "", looksLikeRepository)).toMatch(/access token/);
    expect(siteDraftProblem({ ...emptySiteDraft(), repository: "https://gitlab.com/a/b" }, "", looksLikeRepository)).toBeNull();
  });

  it("stops only what can never be an address; the server judges the rest", () => {
    for (const address of ["", "   ", "my site", "site", "git@github.com:you/my site.git"]) expect(looksLikeRepository(address)).toBe(false);
    for (const address of ["git@github.com:you/site.git", "ssh://git@example.com/you/site.git", "https://github.com/you/site", "/repos/site.git", "file:///repos/site.git", "  /repos/site.git  ", "git.example.com:site.git"]) {
      expect(looksLikeRepository(address)).toBe(true);
    }
    expect(siteDraftProblem({ ...emptySiteDraft(), repository: "site" }, "", looksLikeRepository)).toContain("git@github.com:you/site.git");
    expect(siteDraftProblem({ ...emptySiteDraft(), repository: "/repos/site.git" }, "", looksLikeRepository)).toBeNull();
    expect(siteDraftProblem({ ...emptySiteDraft(), repository: "file:///repos/site.git" }, "", looksLikeRepository)).toBeNull();
  });

  it("says what a check found in plain words", () => {
    const base = { reachable: true, writable: true, empty: false, defaultBranch: "main", message: null };
    expect(describeCheck({ ...base, reachable: false }, "existing", "deploy-key")).toMatchObject({ tone: "danger", canConnect: false, text: expect.stringContaining("write access") });
    expect(describeCheck({ ...base, writable: false }, "existing", "token")).toMatchObject({ canConnect: false });
    expect(describeCheck(base, "starter", "deploy-key")).toMatchObject({ canConnect: false, text: expect.stringContaining("empty repository") });
    expect(describeCheck({ ...base, empty: true }, "existing", "deploy-key")).toMatchObject({ tone: "warning", canConnect: false });
    expect(describeCheck(base, "existing", "deploy-key")).toMatchObject({ tone: "success", canConnect: true });
    expect(describeCheck({ ...base, writable: null }, "existing", "deploy-key").text).toContain("first time you publish");
    for (const said of [describeCheck(base, "existing", "token"), describeCheck({ ...base, reachable: false }, "existing", "token")]) expect(said.text).not.toMatch(/commit|branch|deploy|push/i);
  });

  it("finds the code host's key page from the address", () => {
    expect(keyPageFor("git@github.com:example/site.git")).toBe("https://github.com/example/site/settings/keys/new");
    expect(keyPageFor("https://github.com/example/site")).toBe("https://github.com/example/site/settings/keys/new");
    expect(keyPageFor("https://gitlab.com/example/site.git")).toBe("https://gitlab.com/example/site/-/settings/repository");
    expect(keyPageFor("git@bitbucket.org:example/site.git")).toBe("https://bitbucket.org/example/site/admin/access-keys/");
    expect(keyPageFor("git@git.example.com:example/site.git")).toBeNull();
  });

  it("sends only the details that aren't fixed and that changed", () => {
    const form = { name: " Sam ", email: "sam@example.com", liveUrl: "" };
    expect(detailsRequest({ fixed: [], liveUrl: null }, form)).toEqual({ author: { name: "Sam", email: "sam@example.com" } });
    expect(detailsRequest({ fixed: [], liveUrl: "https://www.example.com" }, form)).toEqual({ author: { name: "Sam", email: "sam@example.com" }, liveUrl: null });
    expect(detailsRequest({ fixed: ["author", "liveUrl"], liveUrl: null }, { ...form, liveUrl: "https://x.example.com" })).toEqual({});
    expect(detailsProblems({ fixed: [] }, { name: "", email: "nope", liveUrl: "www.example.com" })).toEqual({ name: expect.any(String), email: expect.stringContaining("name@example.com"), liveUrl: expect.stringContaining("https://") });
    expect(detailsProblems({ fixed: ["author"] }, { name: "", email: "", liveUrl: "" })).toEqual({});
  });

  it("names a downloaded backup by the server's word, or by the date", () => {
    expect(backupFileName('attachment; filename="site-2026-11-23.backup"', "editor")).toBe("site-2026-11-23.backup");
    expect(backupFileName(null, "editor", new Date("2026-11-23T10:00:00Z"))).toBe("editor-backup-2026-11-23.bin");
  });
});
