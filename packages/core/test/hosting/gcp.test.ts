/**
 * The whole life of a hosted editor on Google Cloud, against a strict fake
 * of Google's token endpoint, testIamPermissions and Compute Engine (and the
 * fake Cloudflare and install the other hosts' tests use), with a real site
 * in a temporary git repository: inspect (the API off, a missing permission
 * said exactly, all good), plan (nothing written), no create without a yes,
 * create (everything listed exists, labelled or described; the startup
 * script holds the recipe's files byte for byte and only the setup code's
 * hash), a failure half-way that `remove` cleans up, the handover, DNS by
 * Cloudflare and by hand, upgrade, backup, and a removal that deletes exactly
 * what was made — leaving look-alikes and anything changed alone. The
 * private key, every access token and the setup code are looked for in every
 * job, record, error and event.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { envSecret, normalizeSecret, secretHint, statusFor } from "../../src/ai/secrets";
import { GCP_LABEL, gcpRecipeFiles, gcpStartupScript } from "../../src/hosting/gcp";
import { parseServiceAccountKey } from "../../src/hosting/gcp-api";
import { recordPath } from "../../src/hosting/record";
import { createHostingService, type HostingService } from "../../src/hosting/service";
import { recordComment } from "../../src/hosting/tag";
import type { HostedEditorRequest } from "../../src/hosting/types";
import { createEventBus } from "../../src/site/index";
import type { Job, ServerEvent, Settings } from "../../src/types";
import { disposeAll, openSite, type Harness } from "../site/helpers";
import { cleanupAll, sh, tempDir, writeTree } from "../workspace/helpers";
import { startFakeCloudflareHosting, type FakeCloudflareHosting } from "./fakes/cloudflare";
import { FAKE_PROJECT, GRANTED_ALL, startFakeGcp, startupEnvironment, testServiceAccountKey, type FakeGcp, type FakeGcpOptions } from "./fakes/gcp";
import { startFakeInstall, type FakeInstall } from "./fakes/install";

const ZONE_ID = "zone0123456789abcdef0123456789ab";
const ADDRESSES = { editor: "cms.example.com", preview: "cms-preview.example.com", live: "cms-live.example.com" };
const ASSISTANT_KEY = "sk-ant-handover-chosen-key-0123456789abcdefWXYZ";
const MACHINE = "zones/us-central1-a/instances/acme-editor";

let gcp: FakeGcp | null = null;
let cf: FakeCloudflareHosting | null = null;
let install: FakeInstall | null = null;

afterEach(async () => {
  await disposeAll();
  await gcp?.close();
  await cf?.close();
  await install?.close();
  gcp = cf = install = null;
});
afterAll(cleanupAll);

function makeSite(): string {
  const root = tempDir("gcp-site-");

  writeTree(root, {
    "galley.config.json": `{\n  "name": "Lowfield Studio",\n  "urls": { "production": "https://www.example.com" }\n}\n`,
    "content/about.md": "---\ntitle: About\n---\nWho we are.\n",
  });
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "First version");
  sh(root, "remote", "add", "origin", "https://github.com/example/site.git");
  return root;
}

interface Rig {
  hosting: HostingService;
  harness: Harness;
  home: string;
  env: NodeJS.ProcessEnv;
  secrets: Record<string, string | undefined>;
  events: ServerEvent[];
  everything(): string;
}

async function rig(options: { gcp?: FakeGcpOptions; cloudflare?: boolean; installUp?: boolean; fetch?: typeof fetch } = {}): Promise<Rig> {
  gcp = await startFakeGcp({ echoAuth: true, ...options.gcp });
  cf = options.cloudflare === false ? null : await startFakeCloudflareHosting();
  const home = tempDir("gcp-home-");
  const root = makeSite();
  // The install checks the code against the hash its machine was really given: the one in its startup script.
  const hash = () => {
    const machine = gcp?.instances.get("us-central1-a/acme-editor");

    return machine ? startupEnvironment(machine).GALLEY_SETUP_TOKEN_SHA256 : null;
  };

  install = await startFakeInstall({ editor: ADDRESSES.editor, hash, ...(options.installUp === false ? { up: false } : {}) });
  const bus = createEventBus();
  const events: ServerEvent[] = [];

  bus.subscribe((event) => events.push(event));
  const secrets: Record<string, string | undefined> = { gcp: gcp.key.json, ...(cf ? { cloudflare: cf.token } : {}), anthropic: ASSISTANT_KEY };
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
    api: { ...gcp.apis, ...(cf ? { cloudflare: cf.api } : {}), install: install.url },
    env,
    wait: { timeoutMs: 1500, intervalMs: 20, maxIntervalMs: 60 },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const harness = await openSite(root, { events: bus });

  return {
    hosting,
    harness,
    home,
    env,
    secrets,
    events,
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

/** The private key (whole, its base64 body and each of its lines), every access token and any extra value: absent from `text`. */
function expectNoSecrets(text: string, extra: string[] = []): void {
  const pem = JSON.parse(gcp!.key.json).private_key as string;
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const lines = pem.split("\n").filter((line) => line.length >= 16 && !line.startsWith("-----"));

  expect(lines.length).toBeGreaterThan(10);
  for (const secret of [pem, JSON.stringify(pem), body, ...lines, ...gcp!.tokens(), cf?.token, ...extra]) {
    if (secret) expect(text).not.toContain(secret);
  }
  expect(text).not.toContain("ya29.fake-");
}

const request = (extra: Partial<HostedEditorRequest> = {}): HostedEditorRequest => ({
  host: "gcp",
  account: FAKE_PROJECT,
  name: "acme-editor",
  address: ADDRESSES.editor,
  handover: { repository: true, identity: true, liveAddress: true, keys: ["anthropic"] },
  ...extra,
});

const finished = (hosting: HostingService, job: Job) => hosting.wait(job.id);
const record = (home: string) => JSON.parse(readFileSync(recordPath(home, "test-site"), "utf8"));
const config = (harness: Harness) => JSON.parse(readFileSync(join(harness.site.root, "galley.config.json"), "utf8"));
const scriptOf = () => gcp!.instances.get("us-central1-a/acme-editor")!.metadata.items.find((item) => item.key === "startup-script")!.value;

describe("hosting the editor on Google Cloud", () => {
  it("says the Compute Engine API is off, with the place to turn it on, and plans nothing past it", async () => {
    const { hosting, harness } = await rig({ gcp: { computeDisabled: true } });
    const account = await hosting.connect("gcp");

    expect(account.accounts).toEqual([{ id: FAKE_PROJECT, name: FAKE_PROJECT }]);
    expect(account.regions).toEqual([]);
    expect(account.gaps).toEqual([
      {
        what: "The Compute Engine API is off in the project “example-project”, so nothing can be created there yet.",
        where: "Open the page, choose Enable (it can take a minute), then check again. Turning it on may ask for a billing account on the project.",
        url: "https://console.developers.google.com/apis/api/compute.googleapis.com/overview?project=example-project",
        blocking: true,
      },
    ]);
    const plan = await hosting.plan(harness.site, request());

    expect(plan.problems[0]).toEqual({
      message: "The Compute Engine API is off in the project “example-project”.",
      fix: "Turn it on at https://console.developers.google.com/apis/api/compute.googleapis.com/overview?project=example-project, wait a minute, then make the plan again.",
    });
    await expect(hosting.create(harness.site, plan.id, true)).rejects.toThrow("Nothing was created: The Compute Engine API is off");
    expect(gcp!.writes()).toEqual([]);
  });

  it("says exactly which role a missing permission needs, and where to add it", async () => {
    const { hosting } = await rig({ gcp: { granted: GRANTED_ALL.filter((permission) => !permission.startsWith("compute.firewalls.")) } });
    const account = await hosting.connect("gcp");

    expect(account.gaps).toEqual([
      {
        what: "The key can't open the web ports to the editor or close the web ports again: its service account needs the role “Compute Security Admin”.",
        where: `In the Google Cloud console, open IAM & Admin › IAM for the project “example-project”, find ${gcp!.key.email} (choose Grant access and type it if it isn't listed), choose Edit, then Add another role: “Compute Security Admin”. Save, wait a minute, then check again.`,
        url: "https://console.cloud.google.com/iam-admin/iam?project=example-project",
        blocking: true,
      },
    ]);
    // The check is a read: nothing was changed.
    expect(gcp!.writes()).toEqual([]);
    expect([...gcp!.calls.find((call) => call.path.endsWith(":testIamPermissions"))!.body.permissions].sort()).toEqual([...GRANTED_ALL].sort());
  });

  it("says it couldn't check the permissions when Cloud Resource Manager is off, without blocking", async () => {
    const { hosting } = await rig({ gcp: { resourceManagerDisabled: true } });
    const account = await hosting.connect("gcp");

    expect(account.gaps).toEqual([
      expect.objectContaining({ blocking: false, url: "https://console.developers.google.com/apis/api/cloudresourcemanager.googleapis.com/overview?project=example-project", what: expect.stringContaining("couldn't check what the key may do") }),
    ]);
  });

  it("inspects, plans without writing anything, with the cost, and creates nothing without a yes", async () => {
    const { hosting, harness } = await rig();
    const account = await hosting.connect("gcp");

    expect(account).toMatchObject({ accounts: [{ id: FAKE_PROJECT, name: FAKE_PROJECT }], domains: [{ id: ZONE_ID, name: "example.com" }], gaps: [] });
    // The regions that are up, the priced one first; a region that is down isn't offered.
    expect(account.regions).toEqual([
      { id: "us-central1", name: "Iowa (us-central1)" },
      { id: "europe-west1", name: "Belgium (europe-west1)" },
      { id: "us-west1", name: "Oregon (us-west1)" },
    ]);
    const plan = await hosting.plan(harness.site, request({ options: { region: "europe-west1", size: "e2-medium" } }));

    expect(gcp!.writes()).toEqual([]);
    expect(cf!.writes()).toEqual([]);
    expect(plan.problems).toEqual([]);
    expect(plan.steps).toEqual([]);
    expect(plan.resources.map((resource) => `${resource.kind}:${resource.name}`)).toEqual([
      "network:acme-editor-net",
      "subnet:acme-editor-subnet",
      "firewall-rule:acme-editor-web",
      "address:acme-editor-ip",
      "machine:acme-editor",
      "disk:acme-editor",
      "dns-record:cms.example.com",
      "dns-record:cms-preview.example.com",
      "dns-record:cms-live.example.com",
    ]);
    expect(plan.resources.find((resource) => resource.kind === "machine")!.detail).toBe(
      "A virtual machine with 4 GB of memory (e2-medium), Ubuntu 24.04, in Belgium (europe-west1); it installs Docker and starts the editor with Caddy for HTTPS by itself"
    );
    expect(plan.resources.find((resource) => resource.kind === "firewall-rule")!.detail).toContain("no SSH");
    expect(plan.cost).toMatchObject({ monthly: 30.11, currency: "USD", source: "https://cloud.google.com/products/compute/pricing/general-purpose", checked: "2026-11-24" });
    expect(plan.cost.lines.map((line) => line.amount)).toEqual([24.46, 2, 3.65, 0, 0]);
    expect(plan.cost.note).toContain("an estimate to check on Google's pricing pages");
    const small = await hosting.plan(harness.site, request());

    expect(small.cost.monthly).toBe(17.88);
    await expect(hosting.create(harness.site, plan.id, false)).rejects.toThrow("Nothing was created: the plan needs a yes first.");
    expect(gcp!.writes()).toEqual([]);
    expectNoSecrets(JSON.stringify([account, plan, small]));
  });

  it("the whole life: create, hand over, upgrade, back up, remove exactly what was made and nothing like it", async () => {
    const { hosting, harness, home, env, everything } = await rig();
    // Look-alikes that aren't this install's: a network, an address and a machine with similar names, and a DNS record.
    gcp!.seed.network("acme-editor-net-old", "made by hand");
    gcp!.seed.address("us-central1", "acme-editor-ip-old", { team: "web" });
    gcp!.seed.instance("us-central1-a", "acme-editor-old", { [GCP_LABEL]: "acme-editor-old" });
    cf!.records.set("foreign", { id: "foreign", zone: ZONE_ID, type: "A", name: "cms-old.example.com", content: "203.0.113.9", proxied: false, ttl: 1, comment: "made by hand" });
    const plan = await hosting.plan(harness.site, request());
    const job = await finished(hosting, await hosting.create(harness.site, plan.id, true));

    expect(job).toMatchObject({ kind: "editor-host", state: "done", url: "https://cms.example.com" });
    const description = recordComment("acme-editor");
    const labels = { [GCP_LABEL]: "acme-editor" };
    const network = gcp!.networks.get("acme-editor-net")!;
    const subnet = gcp!.subnets.get("us-central1/acme-editor-subnet")!;
    const rule = gcp!.firewalls.get("acme-editor-web")!;
    const address = gcp!.addresses.get("us-central1/acme-editor-ip")!;
    const machine = gcp!.instances.get("us-central1-a/acme-editor")!;
    const disk = gcp!.disks.get("us-central1-a/acme-editor")!;

    // Networks, subnets and firewall rules can't carry labels: their description names the install.
    expect([network.description, subnet.description, rule.description]).toEqual([description, description, description]);
    expect(network.autoCreateSubnetworks).toBe(false);
    expect(subnet).toMatchObject({ network: "global/networks/acme-editor-net", ipCidrRange: "10.20.0.0/24" });
    // The web ports, to the machine's tag only; no SSH.
    expect(rule).toMatchObject({ network: "global/networks/acme-editor-net", direction: "INGRESS", sourceRanges: ["0.0.0.0/0"], targetTags: ["acme-editor"] });
    expect(rule.allowed).toEqual([{ IPProtocol: "tcp", ports: ["80", "443"] }, { IPProtocol: "udp", ports: ["443"] }]);
    expect(JSON.stringify(rule.allowed)).not.toContain('"22"');
    // Labelled: the address (through setLabels), the machine and its disk.
    expect(address).toMatchObject({ labels, status: "IN_USE", users: [expect.stringMatching(new RegExp(`/${MACHINE}$`))] });
    expect(gcp!.calls.some((call) => call.method === "POST" && call.path.endsWith("/addresses/acme-editor-ip/setLabels"))).toBe(true);
    expect(machine).toMatchObject({ status: "RUNNING", machineType: "e2-small", labels, tags: { items: ["acme-editor"] }, serviceAccounts: [], shieldedInstanceConfig: { enableSecureBoot: true, enableVtpm: true, enableIntegrityMonitoring: true } });
    expect(machine.networkInterfaces[0]!.accessConfigs[0]!.natIP).toBe(address.address);
    expect(disk).toMatchObject({ labels, sizeGb: "20", type: "pd-balanced" });
    expect(machine.disks).toEqual([expect.objectContaining({ boot: true, autoDelete: true })]);
    // The startup script: the recipe's files byte for byte, the setup code only as its hash, nothing secret.
    const script = scriptOf();
    const saved = record(home);
    const files = gcpRecipeFiles({ name: "acme-editor", addresses: ADDRESSES, image: plan.image, environment: saved.environment, size: "e2-small" });

    expect(files.map((file) => file.name)).toEqual(["compose.yaml", "Caddyfile", ".env"]);
    for (const file of files) expect(script).toContain(`cat > ${file.name}.new <<'GALLEY-END-OF-FILE'\n${file.content}GALLEY-END-OF-FILE\nmv ${file.name}.new ${file.name}\n`);
    expect(script).toBe(gcpStartupScript({ name: "acme-editor", addresses: ADDRESSES, image: plan.image, environment: saved.environment, size: "e2-small" }));
    expect(files[0]!.content).toContain("mem_limit: 1536m");
    expect(startupEnvironment(machine).GALLEY_SETUP_TOKEN_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(script).toContain("docker compose up -d");
    expect(script).not.toMatch(/ssh|PRIVATE KEY|ya29\./i);
    // The three names: DNS-only A records to the fixed address, each noting the install.
    const ours = [...cf!.records.values()].filter((entry) => entry.comment === description);

    expect(ours.map((entry) => [entry.name, entry.type, entry.content, entry.proxied])).toEqual([
      [ADDRESSES.editor, "A", address.address, false],
      [ADDRESSES.preview, "A", address.address, false],
      [ADDRESSES.live, "A", address.address, false],
    ]);
    // Every operation was followed until DONE: more waits than changes.
    expect(gcp!.calls.filter((call) => call.path.endsWith("/wait")).length).toBeGreaterThan(gcp!.writes().length);
    // The record: every resource with its id, this user's only.
    expect(statSync(recordPath(home, "test-site")).mode & 0o777).toBe(0o600);
    expect(saved.resources.map((resource: { kind: string }) => resource.kind)).toEqual(plan.resources.map((resource) => resource.kind));
    expect(saved.resources.every((resource: { id: string }) => resource.id)).toBe(true);
    expect(saved).toMatchObject({ host: "gcp", account: FAKE_PROJECT, name: "acme-editor", addresses: ADDRESSES });
    // The handover: exactly what the plan listed.
    expect(install!.handovers).toEqual([
      { site: { repository: "https://github.com/example/site.git", branch: "main", access: "deploy-key" }, author: { name: "Sam Example", email: "sam@example.com" }, liveUrl: "https://www.example.com", keys: { anthropic: ASSISTANT_KEY } },
    ]);
    expect(plan.handover.map((line) => line.label)).toEqual(["Repository", "Branch it publishes to", "Publishing name and e-mail", "Live address", "Key: the assistant's key (Anthropic)"]);
    expect(config(harness).editor).toEqual({ url: "https://cms.example.com", host: "gcp" });
    const link = (await hosting.setupLink(harness.site)).url;
    const code = new URL(link).searchParams.get("token")!;

    expect(createHash("sha256").update(code).digest("hex")).toBe(startupEnvironment(machine).GALLEY_SETUP_TOKEN_SHA256);
    expect(script).not.toContain(code);
    // Upgrade: the new image in the startup script, a clean stop and start, the same disk.
    env.GALLEY_HOSTING_IMAGE = "ghcr.io/example/editor:9.9.9";
    const before = gcp!.calls.length;
    const upgraded = await finished(hosting, await hosting.upgrade(harness.site));

    expect(upgraded).toMatchObject({ state: "done", url: "https://cms.example.com" });
    const upgrade = gcp!.calls.slice(before).filter((call) => call.method !== "GET" && !call.path.endsWith("/wait")).map((call) => `${call.method} ${call.path.split("/").slice(-1)[0]}`);

    expect(upgrade).toEqual(["POST setMetadata", "POST stop", "POST start"]);
    expect(scriptOf()).toContain('image: "ghcr.io/example/editor:9.9.9"');
    expect(scriptOf()).toBe(gcpStartupScript({ name: "acme-editor", addresses: ADDRESSES, image: "ghcr.io/example/editor:9.9.9", environment: saved.environment, size: "e2-small" }));
    expect(gcp!.instances.get("us-central1-a/acme-editor")!.status).toBe("RUNNING");
    expect(gcp!.disks.get("us-central1-a/acme-editor")).toBe(disk);
    expect(record(home).image).toBe("ghcr.io/example/editor:9.9.9");
    // Back up: a labelled snapshot of the machine's disk.
    const backup = await hosting.backup(harness.site);

    expect(backup).toMatchObject({ kind: "snapshot", snapshot: expect.stringMatching(/^acme-editor-\d{8}-\d{6}$/) });
    expect(gcp!.snapshots.get(backup.snapshot!)).toMatchObject({ sourceDisk: "zones/us-central1-a/disks/acme-editor", labels, ready: true });
    // Removal: shown first — everything made, the snapshot kept — then exactly that is deleted.
    const removal = await hosting.removal(harness.site);

    expect(removal.skipped).toEqual([]);
    expect(removal.resources.map((resource) => resource.kind)).toEqual(saved.resources.map((resource: { kind: string }) => resource.kind));
    expect(removal.kept).toEqual(expect.arrayContaining([expect.stringContaining("made with Back up (snapshots)")]));
    const deletesFrom = gcp!.calls.length;
    const cfDeletesFrom = cf!.calls.length;
    const removed = await finished(hosting, await hosting.remove(harness.site, true));

    expect(removed).toMatchObject({ state: "done", detail: "Removed." });
    const deletes = [...gcp!.calls.slice(deletesFrom), ...cf!.calls.slice(cfDeletesFrom)].filter((call) => call.method === "DELETE").sort((a, b) => a.at - b.at).map((call) => call.path.split("/").slice(-2).join("/"));

    expect(deletes).toEqual([
      expect.stringMatching(/^dns_records\//),
      expect.stringMatching(/^dns_records\//),
      expect.stringMatching(/^dns_records\//),
      "instances/acme-editor",
      "disks/acme-editor",
      "addresses/acme-editor-ip",
      "firewalls/acme-editor-web",
      "subnetworks/acme-editor-subnet",
      "networks/acme-editor-net",
    ]);
    expect([...gcp!.networks.keys()]).toEqual(["acme-editor-net-old"]);
    expect([...gcp!.subnets.keys()]).toEqual([]);
    expect([...gcp!.firewalls.keys()]).toEqual([]);
    expect([...gcp!.addresses.keys()]).toEqual(["us-central1/acme-editor-ip-old"]);
    expect([...gcp!.instances.keys()]).toEqual(["us-central1-a/acme-editor-old"]);
    expect([...gcp!.disks.keys()]).toEqual([]);
    expect([...gcp!.snapshots.keys()]).toEqual([backup.snapshot]);
    expect([...cf!.records.keys()]).toEqual(["foreign"]);
    expect(config(harness)).toEqual({ name: "Lowfield Studio", urls: { production: "https://www.example.com" } });
    expect((await hosting.status(harness.site)).record).toBeNull();
    expectNoSecrets(everything(), [code]);
  });

  it("a failure half-way leaves a record that removing cleans up completely", async () => {
    const { hosting, harness, home, everything } = await rig({ gcp: { failOn: { method: "POST", path: /\/zones\/[^/]+\/instances$/ } } });
    const plan = await hosting.plan(harness.site, request());
    const job = await finished(hosting, await hosting.create(harness.site, plan.id, true));

    expect(job.state).toBe("error");
    expect(job.detail).toContain("Google Cloud couldn't make the virtual machine");
    expect(record(home).resources.map((resource: { kind: string }) => resource.kind)).toEqual(["network", "subnet", "firewall-rule", "address"]);
    expect(install!.handovers).toEqual([]);
    expect(config(harness).editor).toBeUndefined();
    expect((await hosting.removal(harness.site)).resources.map((resource) => resource.kind)).toEqual(["network", "subnet", "firewall-rule", "address"]);
    expect(await finished(hosting, await hosting.remove(harness.site, true))).toMatchObject({ state: "done", detail: "Removed." });
    expect([gcp!.networks.size, gcp!.subnets.size, gcp!.firewalls.size, gcp!.addresses.size, gcp!.instances.size, gcp!.disks.size]).toEqual([0, 0, 0, 0, 0, 0]);
    expect((await hosting.status(harness.site)).record).toBeNull();
    // The fake echoed the Authorization header into its errors: none of it got through.
    expectNoSecrets(everything());
  });

  it("a machine Google couldn't place is said plainly, and what was made is still removed", async () => {
    const { hosting, harness, home } = await rig({ gcp: { failOperation: { target: /instances\/acme-editor$/, code: "ZONE_RESOURCE_POOL_EXHAUSTED", message: "The zone 'projects/example-project/zones/us-central1-a' does not have enough resources available to fulfill the request.", status: 503 } } });
    const plan = await hosting.plan(harness.site, request());
    const job = await finished(hosting, await hosting.create(harness.site, plan.id, true));

    expect(job).toMatchObject({ state: "error", detail: "Google Cloud has no room for this virtual machine in that region right now. Remove what was made here, then try again with another region." });
    expect(record(home).resources.map((resource: { kind: string }) => resource.kind)).toEqual(["network", "subnet", "firewall-rule", "address", "machine", "disk"]);
    const removal = await hosting.removal(harness.site);

    expect(removal.skipped.map(({ resource, reason }) => `${resource.kind}: ${reason}`)).toEqual(["machine: It's already gone.", "disk: It's already gone."]);
    await finished(hosting, await hosting.remove(harness.site, true));
    expect([gcp!.networks.size, gcp!.subnets.size, gcp!.firewalls.size, gcp!.addresses.size]).toEqual([0, 0, 0, 0]);
  });

  it("leaves alone what was changed or is used by something else, and what holds it", async () => {
    const { hosting, harness } = await rig();
    const plan = await hosting.plan(harness.site, request({ handover: { repository: true, identity: false, liveAddress: false, keys: [] } }));

    await finished(hosting, await hosting.create(harness.site, plan.id, true));
    gcp!.instances.get("us-central1-a/acme-editor")!.labels[GCP_LABEL] = "someone-else";
    const retagged = [...cf!.records.values()].find((entry) => entry.name === ADDRESSES.preview)!;

    retagged.comment = "kept by hand for the staging site";
    const removal = await hosting.removal(harness.site);

    expect(removal.skipped.map(({ resource, reason }) => `${resource.kind} ${resource.name}: ${reason}`)).toEqual([
      "machine acme-editor: Its label in Google Cloud was changed, so it may belong to something else now.",
      "disk acme-editor: The virtual machine that uses it was left alone, so its disk is too.",
      "address acme-editor-ip: The virtual machine that uses it was left alone, so its address is too.",
      `dns-record ${ADDRESSES.preview}: Its note on Cloudflare was changed, so it may belong to something else now.`,
      "firewall-rule acme-editor-web: The virtual machine it lets the web in to was left alone, so this rule is too.",
      "subnet acme-editor-subnet: The virtual machine in it was left alone, so the subnet is too.",
      "network acme-editor-net: Something in it was left alone, so the network is too: it can only go once everything in it is gone.",
    ]);
    const job = await finished(hosting, await hosting.remove(harness.site, true));

    expect(job).toMatchObject({ state: "done", detail: "Removed. 7 things were left alone because they changed or had already gone." });
    // Deleted: only the two DNS names still ours. Everything else stays.
    expect(gcp!.instances.get("us-central1-a/acme-editor")!.status).toBe("RUNNING");
    expect([gcp!.networks.size, gcp!.subnets.size, gcp!.firewalls.size, gcp!.addresses.size, gcp!.disks.size]).toEqual([1, 1, 1, 1, 1]);
    expect([...cf!.records.values()].map((entry) => entry.name)).toEqual([ADDRESSES.preview]);
  });

  it("leaves the network alone when someone added a subnet or a firewall rule to it", async () => {
    const { hosting, harness } = await rig();
    const plan = await hosting.plan(harness.site, request());

    await finished(hosting, await hosting.create(harness.site, plan.id, true));
    gcp!.seed.subnet("europe-west1", "added-by-hand", "acme-editor-net", "a colleague's");
    const removal = await hosting.removal(harness.site);

    expect(removal.skipped).toEqual([{ resource: expect.objectContaining({ kind: "network" }), reason: "It now also holds a subnet (added-by-hand), which wasn't created here; it can only go once that is gone." }]);
    await finished(hosting, await hosting.remove(harness.site, true));
    expect([...gcp!.networks.keys()]).toEqual(["acme-editor-net"]);
    expect([...gcp!.subnets.keys()]).toEqual(["europe-west1/added-by-hand"]);
    expect(gcp!.instances.size).toBe(0);
  });

  it("asks for the DNS names by hand without a Cloudflare key, with the fixed address once it exists, and Check finishes", async () => {
    const { hosting, harness } = await rig({ cloudflare: false, installUp: false });
    const plan = await hosting.plan(harness.site, request());

    expect(plan.resources.some((resource) => resource.kind === "dns-record")).toBe(false);
    expect(plan.steps.map((step) => step.copy ?? step.title)).toEqual([
      "cms.example.com.  A  <the editor's fixed address, shown once it exists>",
      "cms-preview.example.com.  A  <the editor's fixed address, shown once it exists>",
      "cms-live.example.com.  A  <the editor's fixed address, shown once it exists>",
      "Then choose Check",
    ]);
    const job = await finished(hosting, await hosting.create(harness.site, plan.id, true));
    const ip = gcp!.addresses.get("us-central1/acme-editor-ip")!.address;

    expect(job).toMatchObject({ state: "done", detail: "Created. Still to do: Add the DNS name cms.example.com." });
    let status = await hosting.status(harness.site);

    expect(status.pending!.steps.map((step) => step.copy ?? step.title)).toEqual([`cms.example.com.  A  ${ip}`, `cms-preview.example.com.  A  ${ip}`, `cms-live.example.com.  A  ${ip}`, "Then choose Check"]);
    expect(status.health).toBe("unreachable");
    install!.up = true;
    status = await hosting.check(harness.site);
    expect(status).toMatchObject({ health: "setup", pending: null, config: { url: "https://cms.example.com", host: "gcp" } });
    expect(install!.handovers).toHaveLength(1);
  });

  it("an upgrade that meets metadata changed meanwhile reads it again, keeps the other items, and goes on", async () => {
    let raced = false;
    const racing: typeof fetch = async (input, init) => {
      // Someone changes the machine's metadata between this app's read and its write.
      if (!raced && String(input).endsWith("/setMetadata")) {
        raced = true;
        const machine = gcp!.instances.get("us-central1-a/acme-editor")!;

        machine.metadata = { fingerprint: "Y2hhbmdlZA==", items: [...machine.metadata.items, { key: "added-by-hand", value: "kept" }] };
      }
      return fetch(input, init);
    };
    const { hosting, harness, env } = await rig({ fetch: racing });
    const plan = await hosting.plan(harness.site, request());

    await finished(hosting, await hosting.create(harness.site, plan.id, true));
    env.GALLEY_HOSTING_IMAGE = "ghcr.io/example/editor:9.9.9";
    expect(await finished(hosting, await hosting.upgrade(harness.site))).toMatchObject({ state: "done" });
    const tries = gcp!.calls.filter((call) => call.path.endsWith("/setMetadata")).map((call) => call.status);

    expect(tries).toEqual([412, 200]);
    const items = gcp!.instances.get("us-central1-a/acme-editor")!.metadata.items;

    expect(items.map((item) => item.key)).toEqual(["added-by-hand", "startup-script"]);
    expect(scriptOf()).toContain('image: "ghcr.io/example/editor:9.9.9"');
  });

  it("signs in again when an access token expired, and plans a name already taken as a problem", async () => {
    const { hosting, harness } = await rig();

    gcp!.seed.network("acme-editor-net", "someone else's");
    await hosting.connect("gcp");
    gcp!.expireTokens();
    const plan = await hosting.plan(harness.site, request());

    expect(plan.problems).toEqual([{ message: "There's already a network called “acme-editor-net” in the project “example-project”.", fix: "Choose another short name." }]);
    expect(gcp!.calls.filter((call) => call.status === 401)).toHaveLength(1);
    expect(gcp!.calls.filter((call) => call.path === "/token")).toHaveLength(2);
    expect(gcp!.writes()).toEqual([]);
  });

  it("refuses a key Google doesn't know, keeps the one that works, and never shows the private key", async () => {
    const { hosting, secrets } = await rig();
    const stored = secrets.gcp;
    // Another key pair under the same key id: its signature can't be verified.
    const other = testServiceAccountKey("other-project");
    const forged = JSON.stringify({ ...JSON.parse(other.json), project_id: FAKE_PROJECT, private_key_id: gcp!.key.privateKeyId, client_email: gcp!.key.email });
    const refusal = await hosting.connect("gcp", { key: forged }).catch((error: Error & { detail?: string; reason?: string }) => error);

    expect(refusal).toMatchObject({ reason: "unauthorized" });
    expect((refusal as Error).message).toContain("Google Cloud didn't accept the key.");
    expect((refusal as Error).message).toContain("The key saved before is still the one in use.");
    expect((refusal as { detail?: string }).detail).toContain("invalid_grant: Invalid JWT Signature.");
    const otherPem = JSON.parse(other.json).private_key as string;

    for (const line of otherPem.split("\n").filter((entry) => entry.length >= 16)) expect(JSON.stringify({ message: (refusal as Error).message, detail: (refusal as { detail?: string }).detail })).not.toContain(line);
    expect(secrets.gcp).toBe(stored);
    await expect(hosting.connect("gcp", { key: '{"type":"authorized_user"}' })).rejects.toThrow("That isn't a key file from Google Cloud (a service account's JSON key).");
    // The key, pasted into a one-line field (its line breaks gone): checked with Google and stored.
    await hosting.connect("gcp", { key: gcp!.key.json.replace(/\n/g, "") });
    expect(secrets.gcp).toBe(gcp!.key.json.replace(/\n/g, ""));
    const hosts = await hosting.hosts();
    const listed = hosts.find((host) => host.id === "gcp")!;

    expect(listed.secrets[0]).toEqual({ name: "gcp", configured: true, source: "stored", hint: gcp!.key.privateKeyId.slice(-4) });
    expect(hosts.map((host) => host.id)).toEqual(["fly", "gcp", "cloudflare", "own-server"]);
    expectNoSecrets(JSON.stringify(hosts));
  });
});

describe("the Google Cloud key file as a stored key", () => {
  const key = testServiceAccountKey();

  it("is saved compact, whatever happened to its line breaks, and shown by its key id's last four", () => {
    const oneLine = key.json.replace(/\n/g, "");
    const saved = normalizeSecret("gcp", oneLine);

    expect(saved).toBe(JSON.stringify(JSON.parse(key.json)));
    expect(normalizeSecret("gcp", key.json)).toBe(saved);
    expect(parseServiceAccountKey(saved)).toMatchObject({ project_id: FAKE_PROJECT, private_key_id: key.privateKeyId, client_email: key.email });
    expect(secretHint("gcp", saved)).toBe(key.privateKeyId.slice(-4));
    expect(statusFor("gcp", saved, "stored")).toEqual({ name: "gcp", configured: true, source: "stored", hint: key.privateKeyId.slice(-4) });
    for (const wrong of ["AIzaSyNotAServiceAccountKey0123456789", '{"type":"authorized_user","client_id":"x"}', `{${"x".repeat(20_000)}}`]) {
      expect(() => normalizeSecret("gcp", wrong)).toThrow("That doesn't look like a key file from Google Cloud (a service account's JSON key).");
    }
  });

  it("is read from GOOGLE_APPLICATION_CREDENTIALS_JSON", () => {
    expect(envSecret({ GOOGLE_APPLICATION_CREDENTIALS_JSON: key.json }, "gcp")).toBe(key.json.trim());
    expect(envSecret({}, "gcp")).toBeNull();
  });
});

describe("the fake Google API is strict", () => {
  async function signedIn(): Promise<{ fake: FakeGcp; call: (method: string, path: string, body?: unknown, token?: string) => Promise<{ status: number; body: any }> }> {
    gcp = await startFakeGcp();
    const fake = gcp;
    const { gcpClient } = await import("../../src/hosting/gcp-api");
    const client = await gcpClient({ secret: async () => fake.key.json, fetch, api: (name) => fake.apis[name as keyof typeof fake.apis] ?? "" });
    const token = fake.tokens()[0]!;

    void client;
    return {
      fake,
      call: async (method, path, body, bearer = token) => {
        const response = await fetch(`${fake.url}${path}`, { method, headers: { authorization: `Bearer ${bearer}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

        return { status: response.status, body: await response.json().catch(() => null) };
      },
    };
  }

  it("answers wrong calls the way Google documents them", async () => {
    const { fake, call } = await signedIn();
    const p = `/compute/v1/projects/${FAKE_PROJECT}`;

    expect((await call("GET", `${p}/global/nothing-here`)).status).toBe(404);
    expect((await call("PUT", `${p}/global/networks`)).status).toBe(405);
    expect((await call("GET", `${p}/regions`, undefined, "ya29.not-a-token")).status).toBe(401);
    expect((await call("POST", `${p}/global/networks`, { name: "Bad_Name", autoCreateSubnetworks: false })).status).toBe(400);
    expect((await call("POST", `${p}/global/networks`, { name: "legacy" })).status).toBe(400);
    const created = await call("POST", `${p}/global/networks`, { name: "net-a", autoCreateSubnetworks: false });

    expect(created.body).toMatchObject({ status: "PENDING", operationType: "insert" });
    // Not usable until its operation is done.
    expect((await call("POST", `${p}/regions/us-central1/subnetworks`, { name: "sub-a", network: "global/networks/net-a", ipCidrRange: "10.1.0.0/24" })).body.error.errors[0].reason).toBe("resourceNotReady");
    expect((await call("POST", `${p}/global/operations/${created.body.name}/wait`)).body.status).toBe("RUNNING");
    expect((await call("POST", `${p}/global/operations/${created.body.name}/wait`)).body.status).toBe("DONE");
    expect((await call("POST", `${p}/global/networks`, { name: "net-a", autoCreateSubnetworks: false })).status).toBe(409);
    const subnet = await call("POST", `${p}/regions/us-central1/subnetworks`, { name: "sub-a", network: `https://www.googleapis.com/compute/v1/projects/${FAKE_PROJECT}/global/networks/net-a`, ipCidrRange: "10.1.0.0/24" });

    expect(subnet.status).toBe(200);
    // A network with a subnet can't be deleted.
    expect((await call("DELETE", `${p}/global/networks/net-a`)).body.error.message).toContain("is already being used by");
    expect((await call("DELETE", `${p}/global/firewalls/no-such-rule`)).status).toBe(404);
    // A stale label fingerprint is refused.
    const address = await call("POST", `${p}/regions/us-central1/addresses`, { name: "ip-a", labels: { a: "b" } });

    await call("POST", `${p}/regions/us-central1/operations/${address.body.name}/wait`);
    await call("POST", `${p}/regions/us-central1/operations/${address.body.name}/wait`);
    const read = await call("GET", `${p}/regions/us-central1/addresses/ip-a`);

    expect(read.body.labels).toEqual({});
    expect((await call("POST", `${p}/regions/us-central1/addresses/ip-a/setLabels`, { labels: { a: "b" }, labelFingerprint: "c3RhbGU=" })).status).toBe(412);
    expect((await call("POST", `${p}/regions/us-central1/addresses/ip-a/setLabels`, { labels: { a: "b" }, labelFingerprint: read.body.labelFingerprint })).status).toBe(200);
    // The permission check refuses wildcards.
    expect((await call("POST", `/v1/projects/${FAKE_PROJECT}:testIamPermissions`, { permissions: ["compute.*"] })).status).toBe(400);
    // The token endpoint refuses an assertion that isn't signed by the key.
    const response = await fetch(`${fake.url}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=a.b.c" });

    expect(response.status).toBe(400);
    expect(fake.calls.find((entry) => entry.path === "/token")!.body).toEqual({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer" });
  });

  it("refuses a stale metadata fingerprint", async () => {
    const { call, fake } = await signedIn();
    const machine = fake.seed.instance("us-central1-a", "vm-a", {});
    const path = `/compute/v1/projects/${FAKE_PROJECT}/zones/us-central1-a/instances/vm-a/setMetadata`;

    expect((await call("POST", path, { fingerprint: "c3RhbGU=", items: [] })).body.error.errors[0].reason).toBe("conditionNotMet");
    expect((await call("POST", path, { fingerprint: machine.metadata.fingerprint, items: [{ key: "startup-script", value: "#!/bin/bash" }] })).status).toBe(200);
  });
});
