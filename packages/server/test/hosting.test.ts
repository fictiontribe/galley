/**
 * "Host the editor online" over HTTP: bodies validated before the engine
 * sees them, nothing created or removed without `confirm: true`, keys never
 * echoed (only their status), a host refusing a key sent as a 400, hosting
 * jobs found again after a reload, and every route a 404 where there is no
 * hosting service or on a hosted install. Also: the derivation of the
 * preview and live names agrees with the install's own.
 */
import { describe, expect, it } from "vitest";
import { deriveAddresses, HostingError, type HostingService } from "@galley/core/hosting";
import type { HostedEditorPlan, HostedEditorStatus } from "@galley/core/hosting";
import type { Job } from "@galley/core/types";
import { defaultGatewayOrigins } from "../src/gateway";
import { fake, fakeSite, json, SITE_ID, testApp } from "./helpers";

const JOB: Job = { id: "job-host-1", kind: "editor-host", label: "Putting the editor online", state: "running", siteId: SITE_ID, startedAt: 1 };
const STATUS: HostedEditorStatus = { config: null, record: null, health: "unknown", runningVersion: null, currentVersion: "0.1.0", upgradeAvailable: false, job: null, pending: null, suggestedName: "site-1-editor" };
const REQUEST = { host: "fly", account: "personal", name: "acme-editor", address: "cms.example.com", handover: { repository: true, identity: true, liveAddress: false, keys: ["anthropic"] } };

function withHosting(impl: Partial<HostingService>, overrides: Parameters<typeof testApp>[1] = {}) {
  const app = testApp({ site: fakeSite() }, overrides);

  app.services.hosting = fake<HostingService>("hosting", impl);
  return app;
}

describe("hosting routes", () => {
  it("answer 404 in plain words without a hosting service", async () => {
    const { call } = testApp({ site: fakeSite() });

    for (const [method, path] of [
      ["GET", "/api/editor-hosts"],
      ["GET", `/api/sites/${SITE_ID}/editor`],
      ["POST", `/api/sites/${SITE_ID}/editor/check`],
    ] as const) {
      const response = await call(method, path);

      expect(response.status).toBe(404);
      expect((await json(response)).error.message).toBe("Hosting the editor online isn't available on this server.");
    }
  });

  it("list the hosts with key status only, and the ones that can't run an editor", async () => {
    const { call } = withHosting({
      hosts: async () => [{ id: "fly", name: "Fly.io", secrets: [{ name: "fly", configured: true, source: "stored", hint: "abcd" }] } as never],
      absent: () => [{ name: "Vercel", reason: "Vercel can't run the editor." }],
    });
    const body = await json(await call("GET", "/api/editor-hosts"));

    expect(body).toEqual({ hosts: [{ id: "fly", name: "Fly.io", secrets: [{ name: "fly", configured: true, source: "stored", hint: "abcd" }] }], absent: [{ name: "Vercel", reason: "Vercel can't run the editor." }] });
  });

  it("hand a pasted key to the engine to check, never echo it, and send a refusal as a 400", async () => {
    const key = "FlyV1 fm2_pastedKeyThatMustNotEcho0123456789";
    const seen: unknown[] = [];
    const { call } = withHosting({
      connect: async (host, input) => {
        seen.push([host, input]);
        throw new HostingError("unauthorized", "Fly.io didn't accept the access key. The key saved before is still the one in use.");
      },
    });
    const response = await call("POST", "/api/editor-hosts/fly/connect", { key, secret: "fly" });
    const text = await response.text();

    expect(seen).toEqual([["fly", { key, secret: "fly" }]]);
    expect(response.status).toBe(400);
    expect(text).not.toContain("fm2_pastedKey");
    expect(JSON.parse(text).error).toMatchObject({ code: "unconfigured", message: expect.stringContaining("still the one in use") });
    expect((await call("POST", "/api/editor-hosts/fly/connect", { key, secret: "netlify" })).status).toBe(400);
    expect((await call("POST", "/api/editor-hosts/fly/connect", { key, extra: 1 })).status).toBe(400);
  });

  it("validate a plan's request before the engine sees it", async () => {
    const plans: unknown[] = [];
    const { call } = withHosting({
      plan: async (_site, request) => {
        plans.push(request);
        return { id: "plan-1" } as HostedEditorPlan;
      },
    });

    expect(await json(await call("POST", `/api/sites/${SITE_ID}/editor/plan`, REQUEST))).toEqual({ id: "plan-1" });
    expect(plans).toEqual([REQUEST]);
    expect((await call("POST", `/api/sites/${SITE_ID}/editor/plan`, { ...REQUEST, handover: { ...REQUEST.handover, keys: ["github"] } })).status).toBe(400);
    expect((await call("POST", `/api/sites/${SITE_ID}/editor/plan`, { ...REQUEST, password: "x" })).status).toBe(400);
    expect((await call("POST", `/api/sites/${SITE_ID}/editor/plan`, { ...REQUEST, handover: undefined })).status).toBe(400);
    expect(plans).toHaveLength(1);
  });

  it("create nothing and remove nothing without confirm: true", async () => {
    const created: unknown[] = [];
    const removed: unknown[] = [];
    const { call, services } = withHosting({
      create: async (_site, plan, confirm) => {
        created.push([plan, confirm]);
        return JOB;
      },
      remove: async (_site, confirm) => {
        removed.push(confirm);
        return { ...JOB, label: "Removing the editor" };
      },
      job: (id) => (id === JOB.id ? JOB : null),
    });

    expect((await call("POST", `/api/sites/${SITE_ID}/editor`, { plan: "plan-1" })).status).toBe(400);
    expect((await call("POST", `/api/sites/${SITE_ID}/editor`, { plan: "plan-1", confirm: false })).status).toBe(400);
    expect((await call("DELETE", `/api/sites/${SITE_ID}/editor`, {})).status).toBe(400);
    expect((await call("DELETE", `/api/sites/${SITE_ID}/editor`, { confirm: "yes" })).status).toBe(400);
    expect(created).toEqual([]);
    expect(removed).toEqual([]);
    expect(await json(await call("POST", `/api/sites/${SITE_ID}/editor`, { plan: "plan-1", confirm: true }))).toEqual(JOB);
    expect((await json(await call("DELETE", `/api/sites/${SITE_ID}/editor`, { confirm: true }))).label).toBe("Removing the editor");
    expect(created).toEqual([["plan-1", true]]);
    expect(removed).toEqual([true]);
    // A hosting job is found again by id after a reload.
    services.registry.job = () => null;
    expect(await json(await call("GET", `/api/jobs/${JOB.id}`))).toEqual(JOB);
  });

  it("refuse a plan the engine didn't make, in its words", async () => {
    const { call } = withHosting({
      create: async () => {
        throw new HostingError("invalid", "That plan isn't one this app made for this site, or it was already used or is more than fifteen minutes old. Make the plan again.");
      },
    });
    const response = await call("POST", `/api/sites/${SITE_ID}/editor`, { plan: "someone-elses", confirm: true });

    expect(response.status).toBe(400);
    expect((await json(response)).error.message).toContain("Make the plan again.");
  });

  it("pass status, check, setup link, upgrade, backup and removal through", async () => {
    const { call } = withHosting({
      status: async () => STATUS,
      check: async () => ({ ...STATUS, health: "setup" }),
      setupLink: async () => ({ url: "https://cms.example.com/setup?token=abc" }),
      upgrade: async () => ({ ...JOB, label: "Upgrading the editor" }),
      backup: async () => ({ kind: "snapshot", snapshot: "vs_1", message: "Copying." }),
      removal: async () => ({ resources: [], skipped: [], kept: ["The site"], warning: "Unpublished changes go with it." }),
    });

    expect(await json(await call("GET", `/api/sites/${SITE_ID}/editor`))).toEqual(STATUS);
    expect((await json(await call("POST", `/api/sites/${SITE_ID}/editor/check`))).health).toBe("setup");
    expect(await json(await call("POST", `/api/sites/${SITE_ID}/editor/setup-link`))).toEqual({ url: "https://cms.example.com/setup?token=abc" });
    expect((await json(await call("POST", `/api/sites/${SITE_ID}/editor/upgrade`))).label).toBe("Upgrading the editor");
    expect(await json(await call("POST", `/api/sites/${SITE_ID}/editor/backup`))).toEqual({ kind: "snapshot", snapshot: "vs_1", message: "Copying." });
    expect((await json(await call("GET", `/api/sites/${SITE_ID}/editor/removal`))).kept).toEqual(["The site"]);
  });

  it("answer 404 on a hosted install, even with a hosting service", async () => {
    const { call } = withHosting({ hosts: async () => [], absent: () => [] }, { mode: "hosted" });
    const response = await call("GET", "/api/editor-hosts");

    expect(response.status).toBe(404);
  });
});

describe("the preview and live names", () => {
  it("are derived exactly as the install derives its own defaults", () => {
    const names = [
      "cms.example.com",
      "example.com",
      "edit.studio.example.co.uk",
      "localhost",
      "cms.localhost",
      "a.b.localhost",
      "intranet",
      "10.0.0.4",
      `${"a".repeat(55)}.example.com`,
      `${"a".repeat(56)}.example.com`,
      "CMS.Example.com",
    ];

    for (const name of names) {
      const install = defaultGatewayOrigins(new URL(`https://${name}`));
      const ours = deriveAddresses(name);

      expect(ours ? { preview: `https://${ours.preview}`, live: `https://${ours.live}` } : null, name).toEqual(install);
    }
  });
});
