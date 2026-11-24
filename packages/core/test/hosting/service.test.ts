/**
 * The whole life of a hosted editor on each built-in host, against strict
 * fake hosts and a fake install on real local ports, with a real site in a
 * temporary git repository: inspect (with a missing permission said exactly),
 * plan (nothing written), no create without a yes, create (every resource
 * tagged, the install's environment holding only the setup code's hash), a
 * failure half-way that `remove` still cleans up, the handover carrying
 * exactly what the plan listed, the site's settings, upgrade, backup, and a
 * removal that deletes exactly what was created — leaving alone look-alikes
 * and anything whose tag was changed. Distinctive fake keys are looked for in
 * every job, record, error and event.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { gapSentence, tunnelGap } from "../../src/hosting/cloudflare-api";
import { createHostingService, type HostingService } from "../../src/hosting/service";
import { recordPath } from "../../src/hosting/record";
import { recordComment, TAG_KEY } from "../../src/hosting/tag";
import type { HostedEditorPlan, HostedEditorRequest } from "../../src/hosting/types";
import { createEventBus } from "../../src/site/index";
import type { Job, ServerEvent, Settings } from "../../src/types";
import { disposeAll, openSite, type Harness } from "../site/helpers";
import { cleanupAll, sh, tempDir, writeTree } from "../workspace/helpers";
import { startFakeCloudflareHosting, type FakeCloudflareHosting, type FakeCloudflareHostingOptions } from "./fakes/cloudflare";
import { startFakeFly, type FakeFly, type FakeFlyOptions } from "./fakes/fly";
import { startFakeInstall, type FakeInstall } from "./fakes/install";

const ACCOUNT = "acc0123456789abcdef0123456789abc";
const ZONE = "zone0123456789abcdef0123456789ab";
const ADDRESSES = { editor: "cms.example.com", preview: "cms-preview.example.com", live: "cms-live.example.com" };
/** Distinctive fake keys: none of them may ever show up anywhere but where they belong. */
const ASSISTANT_KEY = "sk-ant-handover-chosen-key-0123456789abcdefWXYZ";
const OPENAI_KEY = "sk-openai-never-chosen-key-0123456789abcdefQRST";
const REMOTE_SECRET = "ghp_remotePasswordInTheUrl0123456789";

let fly: FakeFly | null = null;
let cf: FakeCloudflareHosting | null = null;
let install: FakeInstall | null = null;

afterEach(async () => {
  await disposeAll();
  await fly?.close();
  await cf?.close();
  await install?.close();
  fly = cf = install = null;
});
afterAll(cleanupAll);

function makeSite(): string {
  const root = tempDir("hosting-site-");

  writeTree(root, {
    "galley.config.json": `{\n  "name": "Lowfield Studio",\n  "urls": { "production": "https://www.example.com" }\n}\n`,
    "content/about.md": "---\ntitle: About\n---\nWho we are.\n",
  });
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "First version");
  sh(root, "remote", "add", "origin", `https://sam:${REMOTE_SECRET}@github.com/example/site.git`);
  return root;
}

interface Rig {
  hosting: HostingService;
  harness: Harness;
  home: string;
  env: NodeJS.ProcessEnv;
  secrets: Record<string, string | undefined>;
  events: ServerEvent[];
  jobs(): Job[];
  /** Every text this test could see: events, the record, the site's settings. */
  everything(): string;
}

async function rig(options: { fly?: FakeFlyOptions; cf?: FakeCloudflareHostingOptions | null; hash?: () => string | null | undefined; installUp?: boolean; now?: () => number } = {}): Promise<Rig> {
  fly = await startFakeFly({ echoAuth: true, ...options.fly });
  cf = options.cf === null ? null : await startFakeCloudflareHosting(options.cf ?? {});
  const home = tempDir("hosting-home-");
  const root = makeSite();
  const recordHash = () => {
    try {
      return JSON.parse(readFileSync(recordPath(home, "test-site"), "utf8")).environment?.GALLEY_SETUP_TOKEN_SHA256;
    } catch {
      return null;
    }
  };

  install = await startFakeInstall({ editor: ADDRESSES.editor, hash: options.hash ?? recordHash, ...(options.installUp === false ? { up: false } : {}) });
  const bus = createEventBus();
  const events: ServerEvent[] = [];

  bus.subscribe((event) => events.push(event));
  const secrets: Record<string, string | undefined> = { fly: fly.token, ...(cf ? { cloudflare: cf.token } : {}), anthropic: ASSISTANT_KEY, openai: OPENAI_KEY };
  const env: NodeJS.ProcessEnv = {};
  const hosting = createHostingService({
    home,
    settings: {
      readSecret: async (name) => secrets[name] ?? null,
      get: async () => ({ author: { name: "Sam Example", email: "sam@example.com" } }) as Settings,
      setSecret: async (name, value) => {
        secrets[name] = value ?? undefined;
        return { name, configured: Boolean(value), source: value ? "stored" : null };
      },
    },
    events: bus,
    api: { fly: fly.url, ...(cf ? { cloudflare: cf.api } : {}), install: install.url },
    env,
    wait: { timeoutMs: 1500, intervalMs: 20, maxIntervalMs: 60 },
    ...(options.now ? { now: options.now } : {}),
  });
  const harness = await openSite(root, { events: bus });
  const jobs = () => events.filter((event): event is Extract<ServerEvent, { type: "job" }> => event.type === "job").map((event) => event.job);

  return {
    hosting,
    harness,
    home,
    env,
    secrets,
    events,
    jobs,
    everything: () => {
      let record = "";

      try {
        record = readFileSync(recordPath(home, "test-site"), "utf8");
      } catch {
        record = "";
      }
      return [JSON.stringify(events), record, readFileSync(join(root, "galley.config.json"), "utf8")].join("\n");
    },
  };
}

/** Every key and the setup code, whole and in parts, must be absent from `text`. */
function expectNoSecrets(text: string, extra: string[] = []): void {
  for (const secret of [fly?.token, cf?.token, ASSISTANT_KEY, OPENAI_KEY, REMOTE_SECRET, ...extra]) {
    if (!secret) continue;
    for (const part of [secret, ...secret.split(/[\s,]+/).filter((piece) => piece.length >= 8)]) expect(text).not.toContain(part);
  }
}

const request = (host: string, extra: Partial<HostedEditorRequest> = {}): HostedEditorRequest => ({
  host,
  account: host === "fly" ? "personal" : host === "cloudflare" ? ACCOUNT : "",
  name: "acme-editor",
  address: ADDRESSES.editor,
  handover: { repository: true, identity: true, liveAddress: true, keys: ["anthropic"] },
  ...extra,
});

async function finished(hosting: HostingService, job: Job): Promise<Job> {
  return hosting.wait(job.id);
}

const record = (home: string) => JSON.parse(readFileSync(recordPath(home, "test-site"), "utf8"));
const config = (harness: Harness) => JSON.parse(readFileSync(join(harness.site.root, "galley.config.json"), "utf8"));

describe("hosting the editor on Fly.io", () => {
  it("inspects what the keys can do, plans without writing anything, and creates nothing without a yes", async () => {
    const { hosting, harness } = await rig();
    const account = await hosting.connect("fly");

    expect(account.accounts).toEqual([{ id: "personal", name: "Sam's organization" }]);
    expect(account.regions.map((region) => region.id)).toContain("iad");
    expect(account.domains).toEqual([{ id: ZONE, name: "example.com" }]);
    expect(account.gaps).toEqual([]);
    const plan = await hosting.plan(harness.site, request("fly", { options: { region: "fra" } }));

    expect(fly!.writes()).toEqual([]);
    expect(cf!.writes()).toEqual([]);
    expect(plan.addresses).toEqual(ADDRESSES);
    expect(plan.problems).toEqual([]);
    expect(plan.steps).toEqual([]);
    expect(plan.resources.map((resource) => `${resource.kind}:${resource.name}`)).toEqual([
      "app:acme-editor",
      "ip:shared IPv4",
      "ip:IPv6",
      "volume:acme_editor_data",
      "machine:acme-editor",
      "certificate:cms.example.com",
      "certificate:cms-preview.example.com",
      "certificate:cms-live.example.com",
      "dns-record:cms.example.com",
      "dns-record:cms-preview.example.com",
      "dns-record:cms-live.example.com",
    ]);
    expect(plan.resources.find((resource) => resource.kind === "machine")!.detail).toBe("1 shared CPU, 2 GB memory, in Frankfurt (Germany); sleeps while nobody is using it");
    expect(plan.cost).toMatchObject({ monthly: 13.24, currency: "USD", source: "https://docs.fly.io/about/pricing/", checked: "2026-11-23" });
    expect(plan.cost.lines.reduce((sum, line) => sum + line.amount, 0)).toBeCloseTo(13.24, 2);
    expect(plan.cost.note).toContain("about $2.27 a month when it is awake about 3 hours a day");
    // The handover: the repository without its password, the publishing identity, the live address, the one chosen key by its last four.
    expect(plan.handover).toEqual([
      { label: "Repository", value: "https://github.com/example/site.git", secret: false },
      { label: "Branch it publishes to", value: "main", secret: false },
      { label: "Publishing name and e-mail", value: "Sam Example <sam@example.com>", secret: false },
      { label: "Live address", value: "https://www.example.com", secret: false },
      { label: "Key: the assistant's key (Anthropic)", value: "…WXYZ", secret: true },
    ]);
    expectNoSecrets(JSON.stringify(plan));
    await expect(hosting.create(harness.site, plan.id, false)).rejects.toThrow("Nothing was created: the plan needs a yes first.");
    await expect(hosting.create(harness.site, "not-a-plan", true)).rejects.toThrow("Make the plan again.");
    expect(fly!.writes()).toEqual([]);
    expect(cf!.writes()).toEqual([]);
  });

  it("the whole life: create, hand over, settings, setup link, upgrade, back up, remove exactly what was made", async () => {
    const { hosting, harness, home, env, everything } = await rig({ hash: () => [...fly!.apps.values()].find((app) => app.name === "acme-editor")?.machines.values().next().value?.config.env.GALLEY_SETUP_TOKEN_SHA256 });
    // Look-alikes that aren't this install's: an app in the same organization, a DNS record with a similar name.
    fly!.apps.set("acme-editor-old", { id: "app_foreign", name: "acme-editor-old", org: "personal", ips: [], volumes: new Map(), machines: new Map(), certificates: new Map() });
    cf!.records.set("foreign", { id: "foreign", zone: ZONE, type: "CNAME", name: "cms-old.example.com", content: "elsewhere.example.net", proxied: false, ttl: 1, comment: "made by hand" });
    const plan = await hosting.plan(harness.site, request("fly"));
    const job = await finished(hosting, await hosting.create(harness.site, plan.id, true));

    expect(job).toMatchObject({ kind: "editor-host", state: "done", url: "https://cms.example.com", siteId: "test-site" });
    // The plan was for one use.
    await expect(hosting.create(harness.site, plan.id, true)).rejects.toThrow("Make the plan again.");
    const app = fly!.apps.get("acme-editor")!;
    const machine = [...app.machines.values()][0]!;

    expect(fly!.calls.find((call) => call.method === "POST" && call.path === "/v1/apps")!.body).toEqual({ app_name: "acme-editor", name: "acme-editor", org_slug: "personal" });
    expect(app.ips.map((ip) => ip.type)).toEqual(["shared_v4", "v6"]);
    expect([...app.volumes.values()].map((volume) => [volume.name, volume.size_gb, volume.region])).toEqual([["acme_editor_data", 3, "iad"]]);
    expect(machine.config.metadata).toEqual({ [TAG_KEY]: "acme-editor" });
    expect(machine.config.guest).toEqual({ cpu_kind: "shared", cpus: 1, memory_mb: 2048 });
    expect(machine.config.services[0]).toMatchObject({ internal_port: 4400, autostop: "stop", autostart: true, ports: [{ port: 80, handlers: ["http"], force_https: true }, { port: 443, handlers: ["tls", "http"] }] });
    expect(machine.config.services[0].checks[0]).toMatchObject({ type: "http", path: "/healthz" });
    expect(machine.config.restart).toEqual({ policy: "on-failure", max_retries: 5 });
    expect(machine.config.stop_config).toEqual({ signal: "SIGTERM", timeout: "30s" });
    // The environment: three addresses, the proxy, the setup code's hash — no key, no setup code.
    expect(Object.keys(machine.config.env)).toEqual(["GALLEY_PUBLIC_URL", "GALLEY_PREVIEW_URL", "GALLEY_LIVE_VIEW_URL", "GALLEY_TRUST_PROXY", "GALLEY_SETUP_TOKEN_SHA256", "GALLEY_PREVIEW_MEMORY_MB"]);
    expect(machine.config.env).toMatchObject({ GALLEY_PUBLIC_URL: "https://cms.example.com", GALLEY_PREVIEW_URL: "https://cms-preview.example.com", GALLEY_LIVE_VIEW_URL: "https://cms-live.example.com", GALLEY_TRUST_PROXY: "1", GALLEY_PREVIEW_MEMORY_MB: "1024" });
    expect(machine.config.env.GALLEY_SETUP_TOKEN_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect([...app.certificates.keys()]).toEqual([ADDRESSES.editor, ADDRESSES.preview, ADDRESSES.live]);
    const ours = [...cf!.records.values()].filter((entry) => entry.comment === recordComment("acme-editor"));

    expect(ours.map((entry) => [entry.name, entry.type, entry.content, entry.proxied])).toEqual([
      [ADDRESSES.editor, "CNAME", "acme-editor.fly.dev", false],
      [ADDRESSES.preview, "CNAME", "acme-editor.fly.dev", false],
      [ADDRESSES.live, "CNAME", "acme-editor.fly.dev", false],
    ]);
    // The record: every resource with its id, readable by this user only, no secret.
    const saved = record(home);

    expect(statSync(recordPath(home, "test-site")).mode & 0o777).toBe(0o600);
    expect(saved.resources.map((resource: { kind: string }) => resource.kind)).toEqual(plan.resources.map((resource) => resource.kind));
    expect(saved.resources.every((resource: { id: string }) => resource.id)).toBe(true);
    expect(saved).toMatchObject({ host: "fly", account: "personal", name: "acme-editor", addresses: ADDRESSES, setup: "pending", options: {} });
    expect(saved.handedOver).toEqual(expect.any(String));
    expect(saved.handover).toBeUndefined();
    // The handover: exactly what the plan listed — the one chosen key and no other.
    expect(install!.handovers).toEqual([
      { site: { repository: "https://github.com/example/site.git", branch: "main", access: "deploy-key" }, author: { name: "Sam Example", email: "sam@example.com" }, liveUrl: "https://www.example.com", keys: { anthropic: ASSISTANT_KEY } },
    ]);
    expect(JSON.stringify(install!.handovers)).not.toContain(OPENAI_KEY);
    expect(install!.log.filter((line) => !line.startsWith("GET /healthz")).every((line) => line.endsWith(` ${ADDRESSES.editor}`))).toBe(true);
    // The site's settings say where its editor lives, and nothing else in them moved.
    expect(config(harness)).toEqual({ name: "Lowfield Studio", urls: { production: "https://www.example.com" }, editor: { url: "https://cms.example.com", host: "fly" } });
    let status = await hosting.status(harness.site);

    expect(status).toMatchObject({ health: "setup", config: { url: "https://cms.example.com", host: "fly" }, upgradeAvailable: false, pending: null, suggestedName: "lowfield-studio-editor", job: { state: "done" } });
    const link = (await hosting.setupLink(harness.site)).url;
    const code = new URL(link).searchParams.get("token")!;

    expect(link.startsWith("https://cms.example.com/setup?token=")).toBe(true);
    expect(createHash("sha256").update(code).digest("hex")).toBe(machine.config.env.GALLEY_SETUP_TOKEN_SHA256);
    // Upgrade: a newer image, the same disk.
    env.GALLEY_HOSTING_IMAGE = "ghcr.io/example/editor:9.9.9";
    expect((await hosting.status(harness.site)).upgradeAvailable).toBe(true);
    const before = machine.instance_id;
    const upgraded = await finished(hosting, await hosting.upgrade(harness.site));

    expect(upgraded).toMatchObject({ state: "done", url: "https://cms.example.com" });
    expect(app.machines.get(machine.id)!.config.image).toBe("ghcr.io/example/editor:9.9.9");
    expect(app.machines.get(machine.id)!.config.mounts).toEqual(machine.config.mounts);
    expect(app.machines.get(machine.id)!.instance_id).not.toBe(before);
    expect(fly!.calls.find((call) => call.method === "POST" && call.path === `/v1/apps/acme-editor/machines/${machine.id}`)!.body.current_version).toBe(before);
    expect(record(home).image).toBe("ghcr.io/example/editor:9.9.9");
    expect((await hosting.status(harness.site)).upgradeAvailable).toBe(false);
    // Back up: a copy of the disk on Fly.io.
    const backup = await hosting.backup(harness.site);

    expect(backup).toMatchObject({ kind: "snapshot", snapshot: expect.stringMatching(/^vs_/) });
    expect([...app.volumes.values()][0]!.snapshots).toEqual([backup.snapshot]);
    // First run finished on the install: the setup link is forgotten.
    install!.state = "ready";
    status = await hosting.status(harness.site);
    expect(status).toMatchObject({ health: "healthy", record: { setup: "done" } });
    await expect(hosting.setupLink(harness.site)).rejects.toThrow("its setup link no longer works");
    // Removal: shown first, then exactly that is deleted.
    const removal = await hosting.removal(harness.site);

    expect(removal.skipped).toEqual([]);
    expect(removal.resources.map((resource) => resource.kind)).toEqual(saved.resources.map((resource: { kind: string }) => resource.kind));
    expect(removal.warning).toContain("never published are deleted with it");
    expect(removal.kept).toContain("The live site at https://www.example.com");
    await expect(hosting.remove(harness.site, false)).rejects.toThrow("removing needs a yes first");
    const removed = await finished(hosting, await hosting.remove(harness.site, true));

    expect(removed).toMatchObject({ state: "done", detail: "Removed." });
    expect(fly!.apps.has("acme-editor")).toBe(false);
    expect([...cf!.records.values()].filter((entry) => entry.comment === recordComment("acme-editor"))).toEqual([]);
    // Deleted newest first: the DNS names, the certificates, the machine, the disk, the addresses, the app.
    const kindOf = (path: string) => (path.includes("/dns_records/") ? "dns-record" : path.includes("/certificates/") ? "certificate" : path.includes("/machines/") ? "machine" : path.includes("/volumes/") ? "volume" : path.includes("/ip_assignments/") ? "ip" : "app");
    const deletes = [...fly!.calls, ...cf!.calls].filter((call) => call.method === "DELETE").sort((a, b) => a.at - b.at).map((call) => kindOf(call.path));

    expect(deletes).toEqual(["dns-record", "dns-record", "dns-record", "certificate", "certificate", "certificate", "machine", "volume", "ip", "ip", "app"]);
    // Untouched: the look-alikes.
    expect(fly!.apps.has("acme-editor-old")).toBe(true);
    expect(cf!.records.has("foreign")).toBe(true);
    expect(config(harness)).toEqual({ name: "Lowfield Studio", urls: { production: "https://www.example.com" } });
    expect((await hosting.status(harness.site)).record).toBeNull();
    expectNoSecrets(everything(), [code]);
  });

  it("a failure half-way leaves a record that removing cleans up completely", async () => {
    const { hosting, harness, home, everything } = await rig({ fly: { failOn: { method: "POST", path: /\/certificates\/acme$/ } } });
    const plan = await hosting.plan(harness.site, request("fly"));
    const job = await finished(hosting, await hosting.create(harness.site, plan.id, true));

    expect(job.state).toBe("error");
    expect(job.detail).toContain("Fly.io couldn't ask for the certificate for cms.example.com");
    expect(record(home).resources.map((resource: { kind: string }) => resource.kind)).toEqual(["app", "ip", "ip", "volume", "machine"]);
    expect(install!.handovers).toEqual([]);
    expect(config(harness).editor).toBeUndefined();
    const status = await hosting.status(harness.site);

    expect(status).toMatchObject({ record: { name: "acme-editor" }, job: { state: "error" } });
    expect((await hosting.removal(harness.site)).resources.map((resource) => resource.kind)).toEqual(["app", "ip", "ip", "volume", "machine"]);
    expect(await finished(hosting, await hosting.remove(harness.site, true))).toMatchObject({ state: "done", detail: "Removed." });
    expect(fly!.apps.size).toBe(0);
    expect((await hosting.status(harness.site)).record).toBeNull();
    // The fake echoed the Authorization header into its error: none of it got through.
    expectNoSecrets(everything());
  });

  it("leaves alone what was changed since it was created, and the app holding it", async () => {
    const { hosting, harness } = await rig();
    const plan = await hosting.plan(harness.site, request("fly", { handover: { repository: true, identity: false, liveAddress: false, keys: [] } }));

    await finished(hosting, await hosting.create(harness.site, plan.id, true));
    const app = fly!.apps.get("acme-editor")!;
    const machine = [...app.machines.values()][0]!;

    machine.config.metadata[TAG_KEY] = "someone-else";
    const retagged = [...cf!.records.values()].find((entry) => entry.name === ADDRESSES.preview)!;

    retagged.comment = "kept by hand for the staging site";
    const removal = await hosting.removal(harness.site);

    expect(removal.skipped.map(({ resource, reason }) => `${resource.kind} ${resource.name}: ${reason}`)).toEqual([
      "machine acme-editor: Its label on Fly.io was changed, so it may belong to something else now.",
      "volume acme_editor_data: The editor's computer that uses it was left alone, so its disk is too.",
      `dns-record ${ADDRESSES.preview}: Its note on Cloudflare was changed, so it may belong to something else now.`,
      "app acme-editor: Something in it was changed since it was created; deleting the app would delete that too.",
    ]);
    const job = await finished(hosting, await hosting.remove(harness.site, true));

    expect(job).toMatchObject({ state: "done", detail: "Removed. 4 things were left alone because they changed or had already gone." });
    expect(job.output).toContain("machine “acme-editor”");
    expect(fly!.apps.has("acme-editor")).toBe(true);
    expect(app.machines.get(machine.id)!.state).toBe("started");
    expect([...app.volumes.values()].filter((volume) => volume.state === "created")).toHaveLength(1);
    expect(app.certificates.size).toBe(0);
    expect(app.ips).toEqual([]);
    expect([...cf!.records.values()].map((entry) => entry.name)).toEqual([ADDRESSES.preview]);
  });

  it("leaves the app alone when it now holds something that wasn't created here", async () => {
    const { hosting, harness } = await rig();
    const plan = await hosting.plan(harness.site, request("fly"));

    await finished(hosting, await hosting.create(harness.site, plan.id, true));
    const app = fly!.apps.get("acme-editor")!;

    app.machines.set("m_added", { id: "m_added", name: "worker", region: "iad", state: "started", instance_id: "01Hadded", config: { image: "example/worker" } });
    const removal = await hosting.removal(harness.site);

    expect(removal.skipped).toEqual([{ resource: expect.objectContaining({ kind: "app" }), reason: "It now also holds a computer (worker), which wasn't created here; deleting the app would delete it too." }]);
    await finished(hosting, await hosting.remove(harness.site, true));
    expect(fly!.apps.has("acme-editor")).toBe(true);
    expect(app.machines.get("m_added")!.state).toBe("started");
  });

  it("asks for the DNS names by hand without a Cloudflare key, and hands over once they work", async () => {
    const { hosting, harness } = await rig({ cf: null, installUp: false });
    const account = await hosting.connect("fly");

    expect(account.domains).toEqual([]);
    const plan = await hosting.plan(harness.site, request("fly", { options: { memory: "1024", sleep: "off" } }));

    expect(plan.resources.some((resource) => resource.kind === "dns-record")).toBe(false);
    expect(plan.steps.map((step) => step.copy ?? step.title)).toEqual([
      "cms.example.com.  CNAME  acme-editor.fly.dev.",
      "cms-preview.example.com.  CNAME  acme-editor.fly.dev.",
      "cms-live.example.com.  CNAME  acme-editor.fly.dev.",
      "Then choose Check",
    ]);
    expect(plan.cost).toMatchObject({ monthly: 7.25 });
    expect(plan.cost.note).toContain("It stays awake");
    const job = await finished(hosting, await hosting.create(harness.site, plan.id, true));
    const machine = [...fly!.apps.get("acme-editor")!.machines.values()][0]!;

    expect(job).toMatchObject({ state: "done", detail: "Created. Still to do: Add the DNS name cms.example.com." });
    expect(machine.config.guest.memory_mb).toBe(1024);
    expect(machine.config.env.GALLEY_PREVIEW_MEMORY_MB).toBe("512");
    expect(machine.config.services[0].autostop).toBe("off");
    let status = await hosting.status(harness.site);

    expect(status).toMatchObject({ health: "unreachable", pending: { files: [] } });
    expect(status.pending!.steps).toHaveLength(4);
    expect(config(harness).editor).toBeUndefined();
    // Not yet answering: Check looks and changes nothing.
    status = await hosting.check(harness.site);
    expect(status.health).toBe("unreachable");
    expect(install!.handovers).toEqual([]);
    install!.up = true;
    status = await hosting.check(harness.site);
    expect(status).toMatchObject({ health: "setup", pending: null, config: { url: "https://cms.example.com", host: "fly" } });
    expect(install!.handovers).toHaveLength(1);
  });

  it("says exactly what a key is missing, and keeps a key that works when a pasted one is refused", async () => {
    const { hosting, secrets } = await rig({ fly: { restrictedTo: ["some-other-app"] } });
    const account = await hosting.connect("fly");

    expect(account.gaps).toEqual([
      {
        what: "This Fly.io key may only manage particular apps, so it can't create the editor's own.",
        where: "In the Fly.io dashboard, choose the organization, open Tokens and select “Create Organization token”; paste the whole key it shows, “FlyV1” included.",
        url: "https://fly.io/dashboard",
        blocking: true,
      },
    ]);
    const stored = secrets.fly;
    const wrong = "FlyV1 fm2_thisKeyIsNotKnown0123456789abcdef,fm2_alsoNotKnownABCDEFGHIJ";
    const refusal = await hosting.connect("fly", { key: wrong }).catch((error: Error) => error);

    expect(refusal).toMatchObject({ reason: "unauthorized", message: "Fly.io didn't accept the access key. It may have been deleted or have expired. Create a new one and paste it here. The key saved before is still the one in use." });
    expect(JSON.stringify({ message: (refusal as Error).message, detail: (refusal as { detail?: string }).detail })).not.toContain("fm2_thisKeyIsNotKnown");
    expect(secrets.fly).toBe(stored);
    // A key the host accepts is stored.
    await hosting.connect("fly", { key: fly!.token });
    expect(secrets.fly).toBe(fly!.token);
  });

  it("a plan is good for fifteen minutes, and refuses to go ahead with a problem", async () => {
    let clock = 1_000_000;
    const { hosting, harness } = await rig({ now: () => clock });
    const plan = await hosting.plan(harness.site, request("fly"));

    clock += 16 * 60_000;
    await expect(hosting.create(harness.site, plan.id, true)).rejects.toThrow("more than fifteen minutes old");
    fly!.apps.set("acme-editor", { id: "app_taken", name: "acme-editor", org: "personal", ips: [], volumes: new Map(), machines: new Map(), certificates: new Map() });
    const taken = await hosting.plan(harness.site, request("fly"));

    expect(taken.problems).toEqual([{ message: "There's already an app called “acme-editor” on your Fly.io account.", fix: "Choose another name." }]);
    await expect(hosting.create(harness.site, taken.id, true)).rejects.toThrow("Nothing was created: There's already an app called “acme-editor”");
    expect(fly!.writes()).toEqual([]);
    await expect(hosting.plan(harness.site, request("fly", { address: "https://cms.example.com" }))).rejects.toThrow("without “https://”");
    await expect(hosting.plan(harness.site, request("fly", { name: "Acme" }))).rejects.toThrow("lowercase letters");
    expect((await hosting.plan(harness.site, request("fly", { name: "other-editor", handover: { repository: false, identity: false, liveAddress: false, keys: ["vercel"] } }))).problems).toEqual([
      { message: "There's no Vercel key on this computer to hand over.", fix: "Leave it out, or add it first." },
    ]);
  });

  it("a name taken by someone else on Fly.io is said plainly, and nothing is left to remove", async () => {
    const { hosting, harness, home } = await rig();

    // Another organization's app: invisible to this key, but its name is taken.
    fly!.apps.set("acme-editor", { id: "app_foreign", name: "acme-editor", org: "someone-else", ips: [], volumes: new Map(), machines: new Map(), certificates: new Map() });
    const plan = await hosting.plan(harness.site, request("fly"));

    expect(plan.problems).toEqual([]);
    const job = await finished(hosting, await hosting.create(harness.site, plan.id, true));

    expect(job).toMatchObject({ state: "error", detail: "The name “acme-editor” is taken on Fly.io — app names there are shared by everyone. Choose another name." });
    expect(() => record(home)).toThrow();
    expect(fly!.apps.get("acme-editor")!.org).toBe("someone-else");
  });
});

describe("hosting the editor behind Cloudflare, on a computer of yours", () => {
  it("the whole life: a tunnel and three names, the files to run, check, hand over, remove", async () => {
    const { hosting, harness, home, everything } = await rig();
    const foreign = { id: "tunnel-foreign", account: ACCOUNT, name: "acme-editor-staging", token: "eyJ-foreign-token", config_src: "cloudflare", deleted_at: null, connections: 4, ingress: null };

    cf!.tunnels.set(foreign.id, foreign);
    const account = await hosting.connect("cloudflare");

    expect(account.accounts).toEqual([{ id: ACCOUNT, name: "Studio account" }]);
    expect(account.domains).toEqual([{ id: ZONE, name: "example.com" }]);
    expect(account.gaps.every((gap) => !gap.blocking)).toBe(true);
    const plan = await hosting.plan(harness.site, request("cloudflare"));

    expect(cf!.writes()).toEqual([]);
    expect(plan.problems).toEqual([]);
    expect(plan.cost).toMatchObject({ monthly: 0, source: "https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/" });
    expect(plan.resources.map((resource) => `${resource.kind}:${resource.name}`)).toEqual(["tunnel:acme-editor", "dns-record:cms.example.com", "dns-record:cms-preview.example.com", "dns-record:cms-live.example.com"]);
    expect(plan.files.map((file) => file.name)).toEqual(["compose.yaml", ".env", "tunnel.env"]);
    const job = await finished(hosting, await hosting.create(harness.site, plan.id, true));

    expect(job).toMatchObject({ state: "done", detail: "Ready to start: Copy the files to a computer with Docker." });
    const tunnel = [...cf!.tunnels.values()].find((entry) => entry.name === "acme-editor")!;

    expect(tunnel).toMatchObject({ config_src: "cloudflare", ingress: [{ hostname: ADDRESSES.editor, service: "http://editor:4400" }, { hostname: ADDRESSES.preview, service: "http://editor:4400" }, { hostname: ADDRESSES.live, service: "http://editor:4400" }, { service: "http_status:404" }] });
    expect([...cf!.records.values()].filter((entry) => entry.comment === recordComment("acme-editor")).map((entry) => [entry.name, entry.content, entry.proxied])).toEqual([
      [ADDRESSES.editor, `${tunnel.id}.cfargotunnel.com`, true],
      [ADDRESSES.preview, `${tunnel.id}.cfargotunnel.com`, true],
      [ADDRESSES.live, `${tunnel.id}.cfargotunnel.com`, true],
    ]);
    // The files to run, with the connector's key fetched fresh — and never kept in the record.
    const status = await hosting.status(harness.site);
    const tunnelEnv = status.pending!.files.find((file) => file.name === "tunnel.env")!;

    expect(tunnelEnv).toMatchObject({ sensitive: true, content: expect.stringContaining(`TUNNEL_TOKEN=${tunnel.token}`) });
    expect(status.pending!.files.find((file) => file.name === ".env")!.content).toContain(`GALLEY_SETUP_TOKEN_SHA256=${record(home).environment.GALLEY_SETUP_TOKEN_SHA256}`);
    expect(readFileSync(recordPath(home, "test-site"), "utf8")).not.toContain(tunnel.token);
    expect(JSON.stringify(everything())).not.toContain(tunnel.token);
    // The person started it: Check hands the site over.
    const checked = await hosting.check(harness.site);

    expect(checked).toMatchObject({ health: "setup", pending: null, config: { url: "https://cms.example.com", host: "cloudflare" } });
    expect(install!.handovers).toHaveLength(1);
    expect(await hosting.backup(harness.site)).toMatchObject({ kind: "page", url: "https://cms.example.com/install" });
    await expect(hosting.upgrade(harness.site)).rejects.toThrow("it is upgraded there");
    // The connector is still connected: removing clears the connections first.
    tunnel.connections = 4;
    const removal = await hosting.removal(harness.site);

    expect(removal.kept).toContain("The editor on your computer and its disk: stop it there with “docker compose down” (add -v to delete its disk too)");
    expect(await finished(hosting, await hosting.remove(harness.site, true))).toMatchObject({ state: "done", detail: "Removed." });
    expect(tunnel.deleted_at).not.toBeNull();
    expect([...cf!.records.values()].filter((entry) => entry.comment === recordComment("acme-editor"))).toEqual([]);
    expect(foreign.deleted_at).toBeNull();
    expect(config(harness).editor).toBeUndefined();
    expectNoSecrets(everything());
  });

  it("refuses a name deeper than one level below the domain, with the fix", async () => {
    const { hosting, harness } = await rig();
    const plan = await hosting.plan(harness.site, request("cloudflare", { address: "cms.team.example.com" }));

    expect(plan.problems).toEqual([
      {
        message: "cms.team.example.com is more than one level below example.com, and Cloudflare's free certificate covers only one level (like cms.example.com).",
        fix: "Use names one level below example.com, like cms.example.com — or order an Advanced Certificate for these names on Cloudflare (from $10 a month).",
      },
    ]);
    // The preview and live names are checked too, when they are typed.
    const typed = await hosting.plan(harness.site, request("cloudflare", { previewAddress: "preview.cms.example.com", liveAddress: "cms-live.example.com" }));

    expect(typed.problems[0]!.message).toContain("preview.cms.example.com is more than one level below example.com");
    expect(cf!.writes()).toEqual([]);
  });

  it("says exactly which permission is missing — on inspection, and in the same words when a write is refused", async () => {
    let { hosting } = await rig({ cf: { noTunnels: true } });
    const account = await hosting.connect("cloudflare");

    expect(account.gaps).toEqual([
      {
        what: "The Cloudflare key can't make tunnels in the account “Studio account”: it needs Account › Cloudflare Tunnel › Edit.",
        where: "On Cloudflare, open My Profile › API Tokens, edit the key, add Account › Cloudflare Tunnel › Edit under Permissions and include that account under Account Resources.",
        url: "https://dash.cloudflare.com/profile/api-tokens",
        blocking: true,
      },
    ]);
    await disposeAll();
    await fly!.close();
    await cf!.close();
    await install!.close();
    ({ hosting } = await rig({ cf: { tunnelReadOnly: true } }));
    const site = (await openSite(makeSite())).site;
    const readable = await hosting.connect("cloudflare");

    // Reads work, so the write can only be proven by trying: said as such.
    expect(readable.gaps).toEqual([expect.objectContaining({ blocking: false, what: expect.stringContaining("not that it may also make them") })]);
    const plan = await hosting.plan(site, request("cloudflare"));
    const job = await finished(hosting, await hosting.create(site, plan.id, true));

    expect(job).toMatchObject({ state: "error", detail: gapSentence(tunnelGap("Studio account")) });
    expect(job.detail).toBe("The Cloudflare key can't make tunnels in the account “Studio account”: it needs Account › Cloudflare Tunnel › Edit. On Cloudflare, open My Profile › API Tokens, edit the key, add Account › Cloudflare Tunnel › Edit under Permissions and include that account under Account Resources. Then try again.");
    expect(cf!.tunnels.size).toBe(0);
  });

  it("names the DNS permission for a key that can't read the domain's records", async () => {
    const { hosting, harness } = await rig({ cf: { noDns: true } });
    const account = await hosting.connect("cloudflare");

    expect(account.gaps[0]).toEqual({
      what: "The Cloudflare key can't change the DNS of example.com: it needs Zone › DNS › Edit.",
      where: "On Cloudflare, open My Profile › API Tokens, edit the key, add Zone › DNS › Edit under Permissions and include example.com under Zone Resources.",
      url: "https://dash.cloudflare.com/profile/api-tokens",
      blocking: true,
    });
    expect((await hosting.plan(harness.site, request("cloudflare"))).problems).toEqual([{ message: account.gaps[0]!.what, fix: account.gaps[0]!.where }]);
    // Fly.io with the same key: the names are simply added by hand.
    expect((await hosting.connect("fly")).gaps).toEqual([expect.objectContaining({ what: account.gaps[0]!.what, blocking: false })]);
    expect((await hosting.plan(harness.site, request("fly"))).steps).toHaveLength(4);
  });
});

describe("hosting the editor on any server with Docker", () => {
  it("writes the files, waits for the person to start them, hands over on Check, removes only its own note", async () => {
    const { hosting, harness, home } = await rig();
    const plan = await hosting.plan(harness.site, request("own-server", { handover: { repository: true, identity: true, liveAddress: false, keys: [] } }));

    expect(plan).toMatchObject({ host: "own-server", resources: [], problems: [], cost: { monthly: 12, currency: "USD", source: "https://www.digitalocean.com/pricing/droplets" } });
    expect(plan.files.map((file) => file.name)).toEqual(["compose.yaml", "Caddyfile", ".env"]);
    expect(plan.steps.map((step) => step.title)).toEqual(["Point the three addresses at the server", "Copy the files to the server", "Start it", "Then come back and choose Check"]);
    const hash = plan.files.find((file) => file.name === ".env")!.content.match(/GALLEY_SETUP_TOKEN_SHA256=([0-9a-f]{64})/)![1];
    const job = await finished(hosting, await hosting.create(harness.site, plan.id, true));

    expect(job).toMatchObject({ state: "done", detail: "Ready to start: Point the three addresses at the server." });
    expect(record(home).environment.GALLEY_SETUP_TOKEN_SHA256).toBe(hash);
    expect((await hosting.status(harness.site)).pending!.files).toEqual(plan.files);
    const checked = await hosting.check(harness.site);

    expect(checked).toMatchObject({ health: "setup", config: { url: "https://cms.example.com", host: "own-server" }, pending: null });
    expect(install!.handovers).toEqual([{ site: { repository: "https://github.com/example/site.git", branch: "main", access: "deploy-key" }, author: { name: "Sam Example", email: "sam@example.com" } }]);
    expect(await hosting.removal(harness.site)).toMatchObject({ resources: [], skipped: [] });
    expect(await finished(hosting, await hosting.remove(harness.site, true))).toMatchObject({ state: "done" });
    expect(config(harness).editor).toBeUndefined();
  });

  it("lists the hosts with their keys' status, and the ones that can't run an editor", async () => {
    const { hosting } = await rig();
    const hosts = await hosting.hosts();

    expect(hosts.map((host) => [host.id, host.kind, host.secrets.map((secret) => `${secret.name}:${secret.configured}:${secret.hint ?? ""}`)])).toEqual([
      ["fly", "managed", [`fly:true:${fly!.token.slice(-4)}`, `cloudflare:true:${cf!.token.slice(-4)}`]],
      ["gcp", "managed", ["gcp:false:", `cloudflare:true:${cf!.token.slice(-4)}`]],
      ["cloudflare", "self-run", [`cloudflare:true:${cf!.token.slice(-4)}`]],
      ["own-server", "self-run", []],
    ]);
    expectNoSecrets(JSON.stringify(hosts).replace(/"hint":"[^"]{4}"/g, ""));
    expect(hosting.absent().map((entry) => entry.name)).toEqual(["Vercel", "Netlify", "Cloudflare Containers"]);
    for (const entry of hosting.absent()) expect(entry.reason.split(/(?<=[.!?])\s/)).toHaveLength(1);
  });
});

describe("a site inside a larger repository", () => {
  it("hands over the site's folder with the repository's address", async () => {
    const { hosting, home } = await rig();
    const repository = tempDir("hosting-monorepo-");

    writeTree(repository, {
      "README.md": "The whole project.\n",
      "apps/site/galley.config.json": `{ "name": "Project site" }\n`,
      "apps/site/content/index.md": "---\ntitle: Home\n---\nHello.\n",
    });
    sh(repository, "init", "-q", "-b", "main");
    sh(repository, "add", "-A");
    sh(repository, "commit", "-q", "-m", "First version");
    sh(repository, "remote", "add", "origin", "git@github.com:example/monorepo.git");
    const site = (await openSite(join(repository, "apps/site"))).site;
    const plan = await hosting.plan(site, request("own-server", { handover: { repository: true, identity: false, liveAddress: false, keys: [] } }));

    expect(plan.handover).toEqual([
      { label: "Repository", value: "git@github.com:example/monorepo.git", secret: false },
      { label: "Branch it publishes to", value: "main", secret: false },
      { label: "The site's folder in the repository", value: "apps/site", secret: false },
    ]);
    await finished(hosting, await hosting.create(site, plan.id, true));
    expect(JSON.parse(readFileSync(recordPath(home, "test-site"), "utf8")).handover.site).toEqual({ repository: "git@github.com:example/monorepo.git", branch: "main", folder: "apps/site" });
    await hosting.check(site);
    expect(install!.handovers).toEqual([{ site: { repository: "git@github.com:example/monorepo.git", branch: "main", folder: "apps/site", access: "deploy-key" } }]);
  });

  it("sends no folder for a site at the top of its repository", async () => {
    const { hosting, harness } = await rig();
    const plan = await hosting.plan(harness.site, request("own-server", { handover: { repository: true, identity: false, liveAddress: false, keys: [] } }));

    expect(plan.handover.map((line) => line.label)).toEqual(["Repository", "Branch it publishes to"]);
  });
});
