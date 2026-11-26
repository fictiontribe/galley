/**
 * "Use your own domain": the plan (read-only), attaching on yes, waiting for
 * the address to answer over HTTPS, the saved live address (the person's
 * choice, never replaced by the host's), and stopping — which detaches only
 * what Galley attached.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createDeployService, configuredDomains, hostnameProblem, normalizeHostname, type DeployService } from "../../src/deploy/index";
import { validateConfig } from "../../src/content/index";
import { createEventBus } from "../../src/site/index";
import type { Job, ServerEvent, Settings } from "../../src/types";
import { disposeAll, openSite } from "../site/helpers";
import { cleanupAll, sh, tempDir, until, writeTree } from "../workspace/helpers";
import { startFakeCloudflare, type FakeCloudflare, type FakeCloudflareOptions } from "./fakes/cloudflare";
import { startFakeVercel, type FakeVercel } from "./fakes/vercel";

const ACCOUNT = "acc0123456789abcdef0123456789abc";
const TEAM = "team_0123456789abcdef";
let cf: FakeCloudflare | null = null;
let vercel: FakeVercel | null = null;

afterEach(async () => {
  await disposeAll();
  await cf?.close();
  await vercel?.close();
  cf = vercel = null;
});
afterAll(cleanupAll);

function makeSite(): string {
  const root = tempDir("deploy-domain-");

  writeTree(root, {
    "galley.config.json": JSON.stringify({ name: "Lowfield Studio", build: { command: "node build.mjs", outDir: "dist" } }, null, 2),
    "build.mjs": 'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("dist", { recursive: true }); writeFileSync("dist/index.html", "<h1>Home</h1>");',
    ".gitignore": "dist/\n",
    "content/about.md": "---\ntitle: About\n---\n",
    "content/contact.md": "---\ntitle: Contact\n---\n",
  });
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "First version");
  return root;
}

async function rig(host: "cloudflare" | "vercel", fakeOptions: FakeCloudflareOptions = {}, waitMs = 3_000) {
  cf = await startFakeCloudflare(fakeOptions);
  vercel = host === "vercel" ? await startFakeVercel() : null;
  const bus = createEventBus();
  const events: ServerEvent[] = [];

  bus.subscribe((event) => events.push(event));
  const deploy: DeployService = createDeployService({
    home: tempDir("deploy-domain-home-"),
    settings: {
      readSecret: async (name) => (name === "cloudflare" ? cf!.token : (vercel?.token ?? null)),
      get: async () => ({ author: { name: "Test Editor", email: "e@example.com" } }) as Settings,
      setSecret: async (name) => ({ name, configured: true, source: "stored" }),
    },
    events: bus,
    apiBase: { cloudflare: cf.api, ...(vercel ? { vercel: vercel.url } : {}) },
    probe: async (hostname) => (await fetch(`${(host === "vercel" ? vercel! : cf!).url}/__probe?host=${hostname}`)).ok,
    domainPollMs: 20,
    domainWaitMs: waitMs,
    env: {},
  });
  const root = makeSite();
  const { site } = await openSite(root, { events: bus });

  await deploy.configure(site, host === "vercel" ? { target: "vercel", account: TEAM, project: "lowfield-studio" } : { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" });
  await deploy.run(site, { kind: "production" });
  return { deploy, site, root, events };
}

/** The job as its last event left it, once it has finished. */
async function finished(events: ServerEvent[], job: Job): Promise<Job> {
  const last = () => events.filter((event): event is Extract<ServerEvent, { type: "job" }> => event.type === "job" && event.job.id === job.id).at(-1)?.job ?? job;

  await until(() => last().state !== "running", 10_000, 20);
  return last();
}

const config = (root: string) => JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8"));

describe("addresses people type", () => {
  it("normalises and refuses in plain words", () => {
    expect(normalizeHostname(" https://Galley.Example.com/about?x=1 ")).toBe("galley.example.com");
    expect(hostnameProblem("galley.example.com")).toBeNull();
    expect(hostnameProblem("localhost")).toMatch(/doesn't look like an address/);
    expect(hostnameProblem("*.example.com")).toMatch(/Wildcard/);
    expect(hostnameProblem("site.studio.workers.dev")).toMatch(/host's own addresses/);
  });
});

describe("Cloudflare: use your own domain", { timeout: 90_000 }, () => {
  it("first deploy saves the host's address; attach saves the custom one; deploying again keeps it; stopping puts the default back", async () => {
    const { deploy, site, root, events } = await rig("cloudflare");
    const workersDev = "https://lowfield-studio.studio.workers.dev";

    expect(config(root).deploy).toMatchObject({ productionUrl: workersDev, defaultUrl: workersDev });
    const plan = await deploy.planDomain(site, "https://Galley.Example.com/");

    expect(plan).toEqual({ hostname: "galley.example.com", status: "ready", canAttach: true, summary: "Cloudflare will answer galley.example.com with this site and set up its certificate. Nothing else on example.com changes." });
    // The plan changed nothing.
    expect(cf!.domains).toHaveLength(0);

    const done = await finished(events, await deploy.attachDomain(site, "galley.example.com"));

    expect(done).toMatchObject({ kind: "domain", state: "done", url: "https://galley.example.com", detail: "galley.example.com answers" });
    expect(cf!.domains).toEqual([expect.objectContaining({ hostname: "galley.example.com", service: "lowfield-studio", zone_id: "zone0123456789abcdef0123456789ab" })]);
    expect(config(root).deploy).toMatchObject({ productionUrl: "https://galley.example.com", defaultUrl: workersDev, domain: { hostname: "galley.example.com", attached: true } });

    await deploy.run(site, { kind: "production" });
    expect(config(root).deploy).toMatchObject({ productionUrl: "https://galley.example.com", defaultUrl: workersDev });
    const status = await deploy.status(site);

    expect(status.production?.url).toBe("https://galley.example.com");
    expect((await deploy.deployments(site))[0]!.url).toBe("https://galley.example.com");
    // Offered after it answers: the custom address becomes what Proof compares against.
    expect((await deploy.useLiveAddress(site)).liveAddressSet).toBe(true);
    expect(config(root).urls.production).toBe("https://galley.example.com");

    await deploy.detachDomain(site);
    expect(cf!.domains).toHaveLength(0);
    expect(config(root).deploy.domain).toBeUndefined();
    expect(config(root).deploy.productionUrl).toBe(workersDev);
    expect(config(root).urls.production).toBe(workersDev);
  });

  it("refuses, read-only, an address another Worker shows, one with a DNS record, and a domain outside the account", async () => {
    const { deploy, site, events } = await rig("cloudflare");

    cf!.domains.push({ id: "dom-other", hostname: "shop.example.com", service: "storefront", zone_id: "z", zone_name: "example.com" });
    cf!.dnsRecords.add("mail.example.com");
    expect(await deploy.planDomain(site, "shop.example.com")).toMatchObject({ status: "taken", canAttach: false, summary: expect.stringContaining("another Worker in this account (“storefront”)") });
    expect(await deploy.planDomain(site, "mail.example.com")).toMatchObject({ status: "dns-conflict", canAttach: false, summary: expect.stringContaining("This app never replaces DNS records") });
    expect(await deploy.planDomain(site, "www.elsewhere.org")).toMatchObject({ status: "not-in-account", canAttach: false, summary: expect.stringContaining("elsewhere.org isn't a domain in this Cloudflare account"), helpUrl: expect.stringContaining("add-site") });
    // Attaching anyway is refused the same way, and touches nothing.
    const refused = await finished(events, await deploy.attachDomain(site, "mail.example.com"));

    expect(refused).toMatchObject({ state: "error", detail: expect.stringContaining("never replaces DNS records") });
    expect(cf!.domains.map((domain) => domain.hostname)).toEqual(["shop.example.com"]);
    expect(cf!.dnsRecords.has("mail.example.com")).toBe(true);
  });

  it("an address already pointing at this Worker (attached by hand) is used, but never detached", async () => {
    const { deploy, site, root, events } = await rig("cloudflare");

    cf!.domains.push({ id: "dom-hand", hostname: "galley.example.com", service: "lowfield-studio", zone_id: "z", zone_name: "example.com" });
    expect(await deploy.planDomain(site, "galley.example.com")).toMatchObject({ status: "already" });
    await finished(events, await deploy.attachDomain(site, "galley.example.com"));
    expect(config(root).deploy).toMatchObject({ productionUrl: "https://galley.example.com", domain: { hostname: "galley.example.com", attached: false } });
    await deploy.detachDomain(site);
    expect(cf!.domains).toHaveLength(1);
    expect(config(root).deploy.productionUrl).toBe("https://lowfield-studio.studio.workers.dev");
  });

  it("waits for a slow certificate; past the wait it says so and keeps the old live address", async () => {
    const slow = await rig("cloudflare", { certificatePolls: 4 }, 3_000);
    const waited = await finished(slow.events, await slow.deploy.attachDomain(slow.site, "galley.example.com"));

    expect(waited.state).toBe("done");
    expect(slow.events.some((event) => event.type === "job" && event.job.detail?.startsWith("Waiting for galley.example.com to answer"))).toBe(true);
    await disposeAll();
    await cf!.close();

    const slower = await rig("cloudflare", { certificatePolls: 1_000 }, 100);
    const timedOut = await finished(slower.events, await slower.deploy.attachDomain(slower.site, "galley.example.com"));

    expect(timedOut).toMatchObject({ state: "error", detail: expect.stringContaining("isn't answering over HTTPS yet") });
    expect(config(slower.root).deploy).toMatchObject({ productionUrl: "https://lowfield-studio.studio.workers.dev", domain: { hostname: "galley.example.com", attached: true, pending: true } });
    // A deploy while it is pending still records the host's address as live.
    await slower.deploy.run(slower.site, { kind: "production" });
    expect(config(slower.root).deploy.productionUrl).toBe("https://lowfield-studio.studio.workers.dev");
  });

  it("a key without the Workers permission is told which permission, before anything changes", async () => {
    cf = await startFakeCloudflare({ noWorkersPermission: true });
    const { createCloudflareTarget } = await import("../../src/deploy/index");

    await expect(createCloudflareTarget().planDomain!({ token: cf.token, fetch, apiBase: cf.api }, { account: ACCOUNT, project: "lowfield-studio", hostname: "galley.example.com" })).rejects.toMatchObject({
      reason: "permission",
      message: expect.stringContaining("Account › Workers Scripts › Edit"),
    });
  });
});

describe("Vercel: use your own domain", { timeout: 90_000 }, () => {
  it("adds the address, shows the DNS record to create, and finishes once it exists", async () => {
    const { deploy, site, root, events } = await rig("vercel");

    expect(config(root).deploy).toMatchObject({ productionUrl: "https://lowfield-studio.vercel.app", defaultUrl: "https://lowfield-studio.vercel.app" });
    const plan = await deploy.planDomain(site, "www.example.com");

    expect(plan).toMatchObject({ status: "needs-dns", canAttach: true, records: [{ type: "CNAME", name: "www.example.com", value: "cname.vercel-dns-fake.com" }] });
    const added = await finished(events, await deploy.attachDomain(site, "www.example.com"));

    expect(added).toMatchObject({ state: "done", detail: "Create the DNS record for www.example.com, then check again." });
    expect(vercel!.domains.get("www.example.com")).toEqual({ project: "lowfield-studio", verified: true });
    expect((await deploy.status(site)).domainRecords).toEqual([{ type: "CNAME", name: "www.example.com", value: "cname.vercel-dns-fake.com" }]);
    expect(config(root).deploy).toMatchObject({ productionUrl: "https://lowfield-studio.vercel.app", domain: { hostname: "www.example.com", attached: true, pending: true } });

    vercel!.dnsReady.add("www.example.com");
    const checked = await finished(events, await deploy.checkDomain(site));

    expect(checked).toMatchObject({ state: "done", url: "https://www.example.com" });
    expect(config(root).deploy).toMatchObject({ productionUrl: "https://www.example.com", domain: { hostname: "www.example.com", attached: true } });
    await deploy.run(site, { kind: "production" });
    expect(config(root).deploy.productionUrl).toBe("https://www.example.com");
    await deploy.detachDomain(site);
    expect(vercel!.domains.size).toBe(0);
    expect(config(root).deploy.productionUrl).toBe("https://lowfield-studio.vercel.app");
  });

  it("an address another Vercel project uses is refused in plain words", async () => {
    const { deploy, site, events } = await rig("vercel");

    vercel!.elsewhere.add("taken.example.com");
    const refused = await finished(events, await deploy.attachDomain(site, "taken.example.com"));

    expect(refused).toMatchObject({ state: "error", detail: expect.stringContaining("already used by another Vercel project") });
    expect(vercel!.domains.size).toBe(0);
  });

  it("supports multiple custom domains per site while keeping legacy `domain` synced as primary", async () => {
    const { deploy, site, root, events } = await rig("cloudflare");
    const workersDev = "https://lowfield-studio.studio.workers.dev";

    await finished(events, await deploy.attachDomain(site, "example.com"));
    expect(config(root).deploy).toMatchObject({
      productionUrl: "https://example.com",
      domain: { hostname: "example.com", attached: true },
      domains: [{ hostname: "example.com", attached: true }],
    });

    // Attach a second custom domain: primary stays example.com, both are stored in domains[].
    await finished(events, await deploy.attachDomain(site, "www.example.com"));
    expect(config(root).deploy).toMatchObject({
      productionUrl: "https://example.com",
      domain: { hostname: "example.com", attached: true },
      domains: [
        { hostname: "example.com", attached: true },
        { hostname: "www.example.com", attached: true },
      ],
    });
    expect(validateConfig(config(root)).ok).toBe(true);
    expect(configuredDomains(config(root).deploy).map((d) => d.hostname)).toEqual(["example.com", "www.example.com"]);

    // Detaching the secondary domain keeps primary untouched.
    await deploy.detachDomain(site, "www.example.com");
    expect(cf!.domains.map((d) => d.hostname)).toEqual(["example.com"]);
    expect(config(root).deploy).toMatchObject({
      productionUrl: "https://example.com",
      domain: { hostname: "example.com", attached: true },
      domains: [{ hostname: "example.com", attached: true }],
    });

    // Re-attach secondary, then detach primary: secondary is promoted to primary (`domain` + `productionUrl`).
    await finished(events, await deploy.attachDomain(site, "blog.example.com"));
    await deploy.detachDomain(site, "example.com");
    expect(cf!.domains.map((d) => d.hostname)).toEqual(["blog.example.com"]);
    expect(config(root).deploy).toMatchObject({
      productionUrl: "https://blog.example.com",
      domain: { hostname: "blog.example.com", attached: true },
      domains: [{ hostname: "blog.example.com", attached: true }],
    });

    // Detaching the last domain restores the host's default address and clears both `domain` and `domains`.
    await deploy.detachDomain(site);
    expect(cf!.domains).toHaveLength(0);
    expect(config(root).deploy.domain).toBeUndefined();
    expect(config(root).deploy.domains).toBeUndefined();
    expect(config(root).deploy.productionUrl).toBe(workersDev);
  });

  it("checks a specific pending domain by hostname and tracks per-host DNS records", async () => {
    const { deploy, site, root, events } = await rig("vercel");

    vercel!.dnsReady.add("example.com");
    await finished(events, await deploy.attachDomain(site, "example.com"));
    await finished(events, await deploy.attachDomain(site, "www.example.com"));
    const pendingStatus = await deploy.status(site);

    expect(pendingStatus.domainRecordsByHost?.["www.example.com"]).toEqual([{ type: "CNAME", name: "www.example.com", value: "cname.vercel-dns-fake.com" }]);
    expect(config(root).deploy.productionUrl).toBe("https://example.com");
    vercel!.dnsReady.add("www.example.com");
    const checked = await finished(events, await deploy.checkDomain(site, "www.example.com"));

    expect(checked).toMatchObject({ state: "done", url: "https://www.example.com" });
    expect(config(root).deploy.domains).toEqual([
      { hostname: "example.com", attached: true },
      { hostname: "www.example.com", attached: true },
    ]);
    expect(config(root).deploy.productionUrl).toBe("https://example.com");
  });
});
