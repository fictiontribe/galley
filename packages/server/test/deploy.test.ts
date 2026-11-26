import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeployError, type DeployService } from "@galley/core/deploy";
import { createPeople, openInstallState, type Account, type AccountRole, type Install } from "@galley/core/install";
import type { DeployStatus, Deployment, Job, SecretStatus } from "@galley/core/types";
import { ROLE_REFUSAL } from "../src/app";
import { signSession } from "../src/auth";
import { secretName } from "../src/validate";
import { fake, fakeSite, json, SITE_ID, testApp, TOKEN } from "./helpers";

const STATUS: DeployStatus = { config: null, production: null, preview: null, job: null, behind: null, liveAddressSet: false, suggestedProject: "site-1" };
const JOB: Job = { id: "job-1", kind: "deploy", label: "Putting the site online", state: "running", siteId: SITE_ID, startedAt: 1 };

function withDeploy(impl: Partial<DeployService>) {
  const app = testApp({ site: fakeSite() });

  app.services.deploy = fake<DeployService>("deploy", impl);
  return app;
}

describe("deploy routes", () => {
  it("answer 404 in plain words when the server has no deploy service", async () => {
    const { call } = testApp({ site: fakeSite() });
    const response = await call("GET", `/api/sites/${SITE_ID}/deploy`);

    expect(response.status).toBe(404);
    expect((await json(response)).error.message).toBe("Putting sites online isn't available on this server.");
  });

  it("list targets with secret status only", async () => {
    const { call } = withDeploy({
      targets: async () => [{ id: "cloudflare", name: "Cloudflare", secrets: [{ name: "cloudflare", configured: true, source: "stored", hint: "abcd" }] } as never],
    });
    const body = await json(await call("GET", "/api/deploy/targets"));

    expect(body.targets[0].secrets).toEqual([{ name: "cloudflare", configured: true, source: "stored", hint: "abcd" }]);
  });

  it("turn a host refusing the key into a 400, so the UI doesn't think its own session ended", async () => {
    const { call } = withDeploy({
      connect: async () => {
        throw new DeployError("unauthorized", "Cloudflare didn't accept the access key.", "GET accounts → 400");
      },
    });
    const response = await call("POST", "/api/deploy/targets/cloudflare/connect");

    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({ code: "unconfigured", message: "Cloudflare didn't accept the access key." });
  });

  it("hand a pasted key to the engine to check before saving, and never echo it", async () => {
    const key = "cf-pasted-key-that-must-not-echo-0123";
    const seen: unknown[] = [];
    const { call } = withDeploy({
      connect: async (target, options) => {
        seen.push([target, options]);
        throw new DeployError("unauthorized", "Cloudflare didn't accept the access key. The key saved before is still the one in use.");
      },
    });
    const response = await call("POST", "/api/deploy/targets/cloudflare/connect", { key });
    const text = await response.text();

    expect(seen).toEqual([["cloudflare", { key }]]);
    expect(response.status).toBe(400);
    expect(text).not.toContain(key);
    expect(JSON.parse(text).error.message).toContain("still the one in use");
    expect((await call("POST", "/api/deploy/targets/cloudflare/connect", { key, extra: 1 })).status).toBe(400);
  });

  it("start a deploy as a job, and find it again by id after a reload", async () => {
    const started: unknown[] = [];
    const { call, services } = withDeploy({
      start: async (_site, options) => {
        started.push(options);
        return JOB;
      },
      job: (id) => (id === JOB.id ? JOB : null),
    });

    services.registry.job = () => null;
    const response = await call("POST", `/api/sites/${SITE_ID}/deploy`, { kind: "preview", label: "For Sam" });

    expect(await json(response)).toEqual(JOB);
    expect(started).toEqual([{ kind: "preview", label: "For Sam" }]);
    expect(await json(await call("GET", `/api/jobs/${JOB.id}`))).toEqual(JOB);
  });

  it("validate bodies before the engine sees them", async () => {
    const { call } = withDeploy({ configure: async () => STATUS, start: async () => JOB });

    expect((await call("POST", `/api/sites/${SITE_ID}/deploy`, { kind: "everything" })).status).toBe(400);
    expect((await call("PUT", `/api/sites/${SITE_ID}/deploy`, { target: "cloudflare", token: "x" })).status).toBe(400);
    expect((await call("PUT", `/api/sites/${SITE_ID}/deploy`, { target: "cloudflare", account: "a", project: "p", autoDeploy: true })).status).toBe(200);
  });

  it("pass status, checks, live address and the deployment list through", async () => {
    const { call } = withDeploy({
      status: async () => STATUS,
      checkProject: async (input) => ({ name: input.name, available: true, existing: false }),
      useLiveAddress: async () => ({ ...STATUS, liveAddressSet: true }),
      deployments: async (_site, limit) => [{ id: `d-${limit}` } as never],
    });

    expect(await json(await call("GET", `/api/sites/${SITE_ID}/deploy`))).toEqual(STATUS);
    expect(await json(await call("POST", `/api/sites/${SITE_ID}/deploy/check`, { target: "vercel", account: "team_1", project: "my-site" }))).toEqual({ name: "my-site", available: true, existing: false });
    expect((await json(await call("POST", `/api/sites/${SITE_ID}/deploy/live-address`))).liveAddressSet).toBe(true);
    expect(await json(await call("GET", `/api/sites/${SITE_ID}/deployments?limit=5`))).toEqual({ items: [{ id: "d-5" }] });
  });

  it("plan, use, check and stop an own domain through the engine, with input validated first", async () => {
    const calls: unknown[] = [];
    const domainJob: Job = { ...JOB, id: "job-d", kind: "domain", label: "Using galley.example.com" };
    const { call } = withDeploy({
      planDomain: async (_site, hostname) => {
        calls.push(["plan", hostname]);
        return { hostname, status: "ready", summary: "Cloudflare will answer it.", canAttach: true };
      },
      attachDomain: async (_site, hostname) => {
        calls.push(["attach", hostname]);
        return domainJob;
      },
      checkDomain: async () => domainJob,
      detachDomain: async () => STATUS,
    });

    expect(await json(await call("POST", `/api/sites/${SITE_ID}/deploy/domain/plan`, { hostname: "galley.example.com" }))).toMatchObject({ status: "ready", canAttach: true });
    expect(await json(await call("POST", `/api/sites/${SITE_ID}/deploy/domain`, { hostname: "galley.example.com" }))).toEqual(domainJob);
    expect(await json(await call("POST", `/api/sites/${SITE_ID}/deploy/domain/check`))).toEqual(domainJob);
    expect(await json(await call("POST", `/api/sites/${SITE_ID}/deploy/domain/check`, { hostname: "www.example.com" }))).toEqual(domainJob);
    expect(await json(await call("DELETE", `/api/sites/${SITE_ID}/deploy/domain`))).toEqual(STATUS);
    expect(await json(await call("DELETE", `/api/sites/${SITE_ID}/deploy/domain?hostname=www.example.com`))).toEqual(STATUS);
    expect((await call("POST", `/api/sites/${SITE_ID}/deploy/domain`, {})).status).toBe(400);
    expect(calls).toEqual([["plan", "galley.example.com"], ["attach", "galley.example.com"]]);
  });

  it("promotes a deployment for owner and editor roles and refuses contributors with 403", async () => {
    const promoted: Deployment = { id: "dep-1", kind: "production", target: "cloudflare", project: "site-1", url: "https://site-1.workers.dev", commit: "abc1234", createdAt: "2026-10-01T00:00:00.000Z", files: 3, bytes: 120 };
    const calls: string[] = [];
    const home = realpathSync(mkdtempSync(join(tmpdir(), "galley-deploy-promote-")));

    try {
      const store = await openInstallState(home);
      const engine = createPeople(store);
      const owner = await engine.createOwner({ password: "correct horse battery staple", name: "Owner", email: "owner@example.com" });
      const people: Record<AccountRole, Account> = { owner } as Record<AccountRole, Account>;

      for (const role of ["editor", "contributor"] as const) {
        const { link } = await engine.invite(owner.id, { email: `${role}@example.com`, role });

        people[role] = (await engine.useLink(link.code, { password: "correct horse battery staple", name: role })).account;
      }
      const install = fake<Install>("install", { store, people: engine, home, meta: () => ({ singleSite: true, setupNeeded: false, passwordSet: true, siteId: null, signInWith: "email" }) });
      const key = randomBytes(32);
      const host = "https://cms.example.com";
      const app = testApp({ site: fakeSite() }, { mode: "hosted", token: TOKEN, install, cookieKey: key, allowedHosts: ["cms.example.com"], publicOrigin: host });

      app.services.deploy = fake<DeployService>("deploy", {
        promote: async (_site, id) => {
          calls.push(id);
          return promoted;
        },
      });
      const asRole = (role: AccountRole) =>
        app.raw("POST", `${host}/api/sites/${SITE_ID}/deployments/dep-1/promote`, {
          headers: { origin: host, cookie: `galley_session_test=${signSession(key, store.nextIssuedAt(Date.now(), people[role].id), undefined, people[role].id)}` },
        });

      const ownerRes = await asRole("owner");
      const editorRes = await asRole("editor");
      const contributorRes = await asRole("contributor");

      expect(ownerRes.status).toBe(200);
      expect(await json(ownerRes)).toEqual(promoted);
      expect(editorRes.status).toBe(200);
      expect(await json(editorRes)).toEqual(promoted);
      expect(contributorRes.status).toBe(403);
      expect((await json(contributorRes)).error.message).toBe(ROLE_REFUSAL);
      expect(calls).toEqual(["dep-1", "dep-1"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("store host keys through the secrets route and never echo them", async () => {
    const value = "cf-key-that-must-not-echo-0123456789abcd";
    const status: SecretStatus = { name: "cloudflare", configured: true, source: "stored", hint: value.slice(-4) };
    const { call } = testApp({
      settings: {
        setSecret: async (name) => {
          expect(name).toBe("cloudflare");
          return status;
        },
      },
    });
    const response = await call("PUT", "/api/secrets/cloudflare", { value });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain(value);
    expect(JSON.parse(text)).toEqual(status);
    expect(secretName.safeParse("vercel").success).toBe(true);
    expect(secretName.safeParse("netlify").success).toBe(false);
  });
});
