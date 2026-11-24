/**
 * "Host the editor online", answered from memory for `dev:mock` and the
 * app's tests: four hosts (Fly.io and Google Cloud do everything; Cloudflare
 * and "any server" hand over files to start), what a key can do, a plan with its cost
 * and handover, a create job that progresses, self-run installs that wait for
 * "check", and upgrade, backup and removal. Like the real server, a hosted
 * install answers every route with "not here".
 *
 * Words that steer it, for trying every state:
 *   a Fly.io key containing "apps"      may only manage particular apps: a blocking gap
 *   a Google Cloud key containing "off"   the Compute Engine API is off: a blocking gap
 *   a Google Cloud key containing "roles" its service account lacks Compute Security Admin: a blocking gap
 *   a Cloudflare key containing "readonly"  can't change DNS names: done by hand (a gap
 *                                        that blocks the Cloudflare host, not Fly.io)
 *   any key containing "wrong"          is refused by the host
 *   the short name "taken"              is already used on the host: the plan has a problem
 *   a short name containing "fail"      creating stops half-way, leaving two things to remove
 *   the address containing "slow"       a self-run install answers only on the second check
 *
 * GALLEY_MOCK_EDITOR sets where the second site's editor starts:
 *   here (default)  created from this computer, an upgrade waiting; one certificate
 *                   changed on the host since, so removing leaves it alone
 *   clean           the same, with nothing changed on the host
 *   other          the site's settings name an editor, created elsewhere
 *   none            no editor
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { ApiRouteKey } from "@galley/core/api";
import type { GalleyConfig, Job, SecretName } from "@galley/core/types";
import { VERSION } from "@galley/core/brand";
// Pure and dependency-free, like deploy-info: the same checks the engine makes.
import { defaultEditorName, editorNameProblem, resolveAddresses } from "@galley/core/hosting/addresses";
import type {
  CostEstimate,
  EditorAddresses,
  EditorConfig,
  EditorHostAbsent,
  EditorHostAccount,
  EditorHostGap,
  EditorHostInfo,
  HandoverLine,
  HostedEditorHealth,
  HostedEditorPlan,
  HostedEditorRecord,
  HostedEditorRequest,
  HostedEditorStatus,
  HostedResource,
  ManualStep,
  RecipeFile,
} from "@galley/core/hosting/types";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError } from "./site.ts";

type HostingRouteKey = Extract<
  ApiRouteKey,
  | "GET /api/editor-hosts"
  | "POST /api/editor-hosts/:hostId/connect"
  | "GET /api/sites/:siteId/editor"
  | "POST /api/sites/:siteId/editor/plan"
  | "POST /api/sites/:siteId/editor"
  | "POST /api/sites/:siteId/editor/setup-link"
  | "POST /api/sites/:siteId/editor/check"
  | "POST /api/sites/:siteId/editor/upgrade"
  | "POST /api/sites/:siteId/editor/backup"
  | "GET /api/sites/:siteId/editor/removal"
  | "DELETE /api/sites/:siteId/editor"
>;

const CHECKED = "2026-11-23";
const IMAGE = "ghcr.io/example/editor";
const PLAN_TTL_MS = 15 * 60_000;
/** Jobs move quickly under test, at a watchable pace in `dev:mock`. */
const STEP_MS = process.env.VITEST ? 8 : 700;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const FLY_REGIONS = [
  { id: "iad", name: "Ashburn, Virginia (US)" },
  { id: "lhr", name: "London (UK)" },
  { id: "ams", name: "Amsterdam (Netherlands)" },
  { id: "fra", name: "Frankfurt (Germany)" },
  { id: "syd", name: "Sydney (Australia)" },
];

function flyCost(memory: string, sleeps: boolean): CostEstimate {
  const machine = memory === "1024" ? 6.7 : 12.69;
  const monthly = Math.round((machine + 0.45 + 0.1) * 100) / 100;
  return {
    monthly,
    currency: "USD",
    lines: [
      { label: `Computer: 1 shared CPU, ${memory === "1024" ? "1 GB" : "2 GB"} memory, running all day`, amount: machine },
      { label: "Disk: 3 GB", amount: 0.45 },
      { label: "Outgoing data, about 5 GB", amount: 0.1 },
      { label: "Three HTTPS certificates (the first 10 are free)", amount: 0 },
    ],
    note: sleeps
      ? `Awake all day: about $${monthly.toFixed(2)} a month. It sleeps while nobody is using it, so it usually costs much less: about $2.30 a month when it is awake about 3 hours a day.`
      : `Awake all day: about $${monthly.toFixed(2)} a month. It stays awake, so it answers at once.`,
    source: "https://docs.fly.io/about/pricing/",
    checked: CHECKED,
  };
}

const GCP_REGIONS = [
  { id: "us-central1", name: "Iowa (us-central1)" },
  { id: "europe-west1", name: "Belgium (europe-west1)" },
  { id: "europe-west2", name: "London (europe-west2)" },
  { id: "us-west1", name: "Oregon (us-west1)" },
  { id: "asia-northeast1", name: "Tokyo (asia-northeast1)" },
];

/** As the engine works it out (core/src/hosting/gcp.ts): Iowa's hourly prices × 730 hours. */
function gcpCost(size: string): CostEstimate {
  const machine = size === "e2-medium" ? 24.46 : 12.23;
  return {
    monthly: Math.round((machine + 2 + 3.65) * 100) / 100,
    currency: "USD",
    lines: [
      { label: `Virtual machine: ${size === "e2-medium" ? "e2-medium, 4 GB" : "e2-small, 2 GB"} memory, running all day`, amount: machine },
      { label: "Disk: 20 GB (balanced)", amount: 2 },
      { label: "A fixed address (an external IPv4 address in use)", amount: 3.65 },
      { label: "Its network, subnet and firewall rule", amount: 0 },
      { label: "HTTPS certificates (Caddy gets them from Let's Encrypt)", amount: 0 },
    ],
    note: "On-demand prices for Iowa (us-central1); other regions cost a little more or less. Worked out at 730 hours a month from Google's hourly prices: an estimate to check on Google's pricing pages, not a quote.",
    source: "https://cloud.google.com/products/compute/pricing/general-purpose",
    checked: "2026-11-24",
  };
}

const CLOUDFLARE_COST: CostEstimate = {
  monthly: 0,
  currency: "USD",
  lines: [
    { label: "Cloudflare Tunnel (every account includes 1,000 at no cost)", amount: 0 },
    { label: "Three DNS names on your domain", amount: 0 },
  ],
  note: "Cloudflare charges nothing for this. The editor runs on a computer of yours, so what that computer costs is yours: nothing more on one you already have.",
  source: "https://www.cloudflare.com/plans/",
  checked: CHECKED,
};

const OWN_SERVER_COST: CostEstimate = {
  monthly: 12,
  currency: "USD",
  lines: [
    { label: "A server with 2 GB of memory (for example a basic one at DigitalOcean)", amount: 12 },
    { label: "HTTPS certificates (Caddy gets them from Let's Encrypt)", amount: 0 },
  ],
  note: "What a small server costs. On a server you already have, nothing more.",
  source: "https://www.digitalocean.com/pricing/droplets",
  checked: CHECKED,
};

const CF_DOCS = "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/";

const HOSTS: Array<Omit<EditorHostInfo, "secrets">> = [
  {
    id: "fly",
    name: "Fly.io",
    summary: "Runs the editor on a small computer of its own at Fly.io, with its own disk. Everything is created on your Fly.io account; your domain gives it its three addresses.",
    kind: "managed",
    credentials: [
      {
        secret: "fly",
        label: "Fly.io access key",
        help: "Fly.io calls it an organization token. It lets this app create the editor's app, disk and computer in your organization. It's kept on this computer only.",
        docsUrl: "https://docs.fly.io/security/tokens/",
        permissions: ["Organization token (Tokens › Create Organization token)"],
        required: true,
      },
      {
        secret: "cloudflare",
        label: "Cloudflare access key (optional)",
        help: "When your domain is on Cloudflare, this key lets the app add the editor's three DNS names for you. Without it, you add them by hand.",
        docsUrl: CF_DOCS,
        permissions: ["Zone › DNS › Edit", "Zone › Zone › Read"],
        required: false,
      },
    ],
    cost: flyCost("2048", true),
    options: [
      {
        key: "memory",
        label: "Memory",
        help: "The editor runs the site's own preview, which needs room.",
        choices: [
          { value: "2048", label: "2 GB", note: "Recommended: a site's preview needs it" },
          { value: "1024", label: "1 GB", note: "Cheaper; a larger site's preview may run out of room" },
        ],
        default: "2048",
      },
      {
        key: "sleep",
        label: "Sleep while nobody is using it",
        help: "It stops when nobody has it open and starts again on the next visit, which then takes a few seconds. It costs much less this way.",
        choices: [
          { value: "on", label: "Sleep while unused", note: "The first visit after a sleep takes a few seconds" },
          { value: "off", label: "Stay awake", note: "Answers at once; costs the full month" },
        ],
        default: "on",
      },
    ],
    docsUrl: "https://docs.fly.io/machines/api/",
  },
  {
    id: "gcp",
    name: "Google Cloud",
    summary: "Runs the editor on a virtual machine of its own in your Google Cloud project, with its own disk, a network of its own and a fixed address. Everything is created in your project; your domain gives it its three addresses.",
    kind: "managed",
    credentials: [
      {
        secret: "gcp",
        label: "Google Cloud key file",
        help: "A key file from Google Cloud (a service account's JSON key): paste the whole file. It lets this app create the editor's virtual machine, network and fixed address in the key's project. It's kept on this computer only.",
        docsUrl: "https://docs.cloud.google.com/iam/docs/keys-create-delete",
        permissions: [
          "Turn on the Compute Engine API in the project (APIs & Services › Library › Compute Engine API › Enable)",
          "Create a service account (IAM & Admin › Service accounts › Create service account)",
          "Give it the roles “Compute Instance Admin (v1)”, “Compute Network Admin” and “Compute Security Admin”",
          "Create its key: Keys › Add key › Create new key › JSON",
        ],
        required: true,
      },
      {
        secret: "cloudflare",
        label: "Cloudflare access key (optional)",
        help: "When your domain is on Cloudflare, this key lets the app add the editor's three DNS names for you. Without it, you add them by hand.",
        docsUrl: CF_DOCS,
        permissions: ["Zone › DNS › Edit", "Zone › Zone › Read"],
        required: false,
      },
    ],
    cost: gcpCost("e2-small"),
    options: [
      {
        key: "size",
        label: "Memory",
        help: "The editor runs the site's own preview, which needs room.",
        choices: [
          { value: "e2-small", label: "2 GB (e2-small)", note: "Recommended for most sites" },
          { value: "e2-medium", label: "4 GB (e2-medium)", note: "For a site whose repository holds much more than the site itself: its preview and package install need the room" },
        ],
        default: "e2-small",
      },
    ],
    docsUrl: "https://docs.cloud.google.com/compute/docs/instances/create-start-instance",
  },
  {
    id: "cloudflare",
    name: "Cloudflare, in front of a computer of yours",
    summary: "Runs the editor on any computer of yours with Docker and reaches it at your own addresses through Cloudflare, with no ports opened. A tunnel and three DNS names are created on your Cloudflare account.",
    kind: "self-run",
    credentials: [
      {
        secret: "cloudflare",
        label: "Cloudflare access key",
        help: "Cloudflare calls it an API token. It lets this app create the tunnel and the three DNS names. It's kept on this computer only.",
        docsUrl: CF_DOCS,
        permissions: ["Account › Cloudflare Tunnel › Edit", "Zone › DNS › Edit", "Zone › Zone › Read"],
        required: true,
      },
    ],
    cost: CLOUDFLARE_COST,
    options: [],
    docsUrl: "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/",
  },
  {
    id: "own-server",
    name: "Any server with Docker",
    summary: "Writes the files to run the editor on any server of yours with Docker, with HTTPS from Caddy. Nothing is created on an account; you start it there.",
    kind: "self-run",
    credentials: [],
    cost: OWN_SERVER_COST,
    options: [
      {
        key: "proxy",
        label: "In front of the editor",
        help: "Caddy gets the HTTPS certificates. With several editors on one server, they share one Caddy.",
        choices: [
          { value: "caddy", label: "Its own Caddy", note: "The simplest: one editor on the server" },
          { value: "shared-proxy", label: "A Caddy shared by this server's editors", note: "For several editors on one server, each with its own disk" },
        ],
        default: "caddy",
      },
    ],
    docsUrl: "https://caddyserver.com/docs/",
  },
];

const ABSENT: EditorHostAbsent[] = [
  { name: "Vercel", reason: "Vercel can't run the editor: it runs short functions that stop after a few minutes, on a disk that doesn't keep files — put the site on Vercel, and the editor on Fly.io or a server of your own." },
  { name: "Netlify", reason: "Netlify can't run the editor: its functions stop after at most 15 minutes and its servers empty their disk whenever they stop, so unpublished changes would be lost." },
  { name: "Cloudflare Containers", reason: "Cloudflare's containers can't hold the editor yet: they start again with a fresh disk after every sleep, so unpublished changes would be lost — choose “Cloudflare, in front of a computer of yours” instead." },
];

const KEY_LABEL: Record<SecretName, string> = {
  anthropic: "the assistant's key (Anthropic)",
  openai: "the OpenAI key",
  google: "the Google AI key",
  cloudflare: "the Cloudflare key",
  vercel: "the Vercel key",
  fly: "the Fly.io key",
  gcp: "the Google Cloud key file",
};

const DOMAINS = [
  { id: "zone-1", name: "example.com" },
  { id: "zone-2", name: "example.org" },
];

/** What only the mock knows about a key: the words in it that steer it (see the header). */
interface MockState {
  keys: Partial<Record<SecretName, string>>;
  plans: Map<string, { plan: HostedEditorPlan; request: HostedEditorRequest; siteId: string; expires: number }>;
  records: Map<string, HostedEditorRecord>;
  /** Sites whose settings name an editor this computer didn't create. */
  configs: Map<string, EditorConfig>;
  health: Map<string, HostedEditorHealth>;
  pending: Map<string, { steps: ManualStep[]; files: RecipeFile[] }>;
  checks: Map<string, number>;
  jobs: Map<string, string>;
  runningVersion: Map<string, string>;
}

/** A certificate renamed on the host since it was made is left alone when removing, to show that state. */
function skippedOf(record: HostedEditorRecord): Array<{ resource: HostedResource; reason: string }> {
  return record.resources
    .filter((resource) => resource.kind === "certificate" && resource.name.startsWith("handbook-live"))
    .map((resource) => ({ resource, reason: "Its note on the host was changed, so it may belong to something else now." }));
}

function notHere(): never {
  throw new MockError("not-found", "Hosting the editor online isn't available on this server.");
}

function hostOf(id: string) {
  const host = HOSTS.find((candidate) => candidate.id === id);
  if (!host) throw new MockError("not-found", "That isn't a host this app can put an editor on.");
  return host;
}

function addressesFor(request: HostedEditorRequest): EditorAddresses {
  const resolved = resolveAddresses(request);
  if ("problem" in resolved) throw new MockError("invalid", resolved.problem);
  return resolved.addresses;
}

function namesOf(addresses: EditorAddresses): string[] {
  return [addresses.editor, addresses.preview, addresses.live];
}

function dnsSteps(addresses: EditorAddresses, name: string): ManualStep[] {
  return [
    ...namesOf(addresses).map((host) => ({
      title: `Add the name ${host}`,
      detail: `At the company that holds your domain, add a record for ${host} pointing to ${name}.fly.dev (a CNAME record). If the domain is on Cloudflare, set it to “DNS only”.`,
      copy: `${host}.  CNAME  ${name}.fly.dev.`,
    })),
    { title: "Then choose Check", detail: `Once the three names lead to Fly.io (usually minutes, sometimes an hour), ${addresses.editor} answers and the site is handed over.` },
  ];
}

function selfRunSteps(hostId: string, addresses: EditorAddresses): ManualStep[] {
  const start = { title: "Start it", detail: "In the folder with the files, start the editor. The first start downloads it and takes a minute or two.", copy: "docker compose up -d" };
  const check = { title: "Then come back and choose Check", detail: `Once ${addresses.editor} answers, the site is handed over and you get the first-run link.` };
  if (hostId === "cloudflare") {
    return [{ title: "Copy the files to a computer with Docker", detail: "Any computer that stays on: a small server, a spare machine. It needs no open ports: the connector dials out to Cloudflare." }, start, check];
  }
  return [
    { title: "Point the three addresses at the server", detail: `At the company that holds your domain, add a record for each of ${namesOf(addresses).join(", ")} with the server's IP address (an A record).` },
    { title: "Copy the files to the server", detail: "Put them in a folder of their own, for example /srv/editor." },
    start,
    check,
  ];
}

function filesFor(hostId: string, addresses: EditorAddresses, name: string): RecipeFile[] {
  const env = { name: ".env", content: `GALLEY_MODE=hosted\nGALLEY_PUBLIC_URL=https://${addresses.editor}\nGALLEY_PREVIEW_URL=https://${addresses.preview}\nGALLEY_LIVE_URL=https://${addresses.live}\nGALLEY_SETUP_TOKEN_SHA256=${randomBytes(32).toString("hex")}\n` };
  const compose = { name: "compose.yaml", content: `services:\n  editor:\n    image: ${IMAGE}:${VERSION}\n    env_file: .env\n    volumes:\n      - ${name}-data:/data\n    restart: unless-stopped\nvolumes:\n  ${name}-data: {}\n` };
  if (hostId === "cloudflare") {
    // Stands in for a connector's own key: obviously not a real one.
    return [compose, env, { name: "tunnel.env", content: `TUNNEL_TOKEN=mock-tunnel-${randomBytes(12).toString("hex")}\n`, sensitive: true }];
  }
  return [compose, { name: "Caddyfile", content: `${namesOf(addresses).join(", ")} {\n  reverse_proxy editor:4400\n}\n` }, env];
}

export function hostingHandlers(mock: MockBackend): Pick<Handlers, HostingRouteKey> {
  const state: MockState = { keys: {}, plans: new Map(), records: new Map(), configs: new Map(), health: new Map(), pending: new Map(), checks: new Map(), jobs: new Map(), runningVersion: new Map() };
  const local = () => {
    if (mock.options.mode !== "local") notHere();
  };

  // The second site starts with an editor, to show that state without walking the flow.
  const seeded = [...mock.sites.values()].filter((site) => !site.seed.missing)[1];
  // "here": made from this computer, one certificate since changed on the host (left alone on removal); "clean": the same, nothing changed.
  const seedMode = process.env.GALLEY_MOCK_EDITOR ?? "here";
  const leftAlone = (record: HostedEditorRecord) => (seedMode === "clean" ? [] : skippedOf(record));
  if (seeded && (seedMode === "here" || seedMode === "clean")) {
    const addresses = { editor: "handbook.example.com", preview: "handbook-preview.example.com", live: "handbook-live.example.com" };
    state.records.set(seeded.id, {
      host: "fly",
      account: "studio",
      name: "handbook-editor",
      addresses,
      image: `${IMAGE}:0.0.9`,
      version: "0.0.9",
      createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
      // As the real engine records them (core/src/hosting/fly.ts): ids, and terse details with the account and place as codes.
      resources: [
        { kind: "app", id: "handbook-editor", name: "handbook-editor", detail: "In the organization studio" },
        { kind: "ip", id: "66.241.124.10", name: "shared IPv4" },
        { kind: "ip", id: "2a09:8280:1::2", name: "IPv6" },
        { kind: "volume", id: "vol_2b7c", name: "handbook_editor_data", detail: "3 GB in lhr" },
        { kind: "machine", id: "e286", name: "handbook-editor", detail: "2 GB in lhr" },
        ...namesOf(addresses).map((host) => ({ kind: "certificate", id: host, name: host })),
        ...namesOf(addresses).map((host, index) => ({ kind: "dns-record", id: `zone-1/rec-${index}`, name: host, detail: `${host} → handbook-editor.fly.dev, on example.com` })),
      ],
      options: { region: "lhr", memory: "2048", sleep: "on" },
      setup: "done",
      handedOver: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    });
    state.configs.set(seeded.id, { url: `https://${addresses.editor}`, host: "fly" });
    state.health.set(seeded.id, "healthy");
    state.runningVersion.set(seeded.id, "0.0.9");
  } else if (seeded && seedMode === "other") {
    state.configs.set(seeded.id, { url: "https://handbook.example.com", host: "own-server" });
    state.health.set(seeded.id, "healthy");
    state.runningVersion.set(seeded.id, VERSION);
  }

  const secrets = (host: Omit<EditorHostInfo, "secrets">) => host.credentials.map((credential) => mock.secrets[credential.secret]);
  const stored = (name: SecretName) => mock.secrets[name]?.configured === true;

  function inspect(hostId: string): EditorHostAccount {
    const gaps: EditorHostGap[] = [];
    if (hostId === "own-server") return { accounts: [], regions: [], domains: [], gaps };
    const cfReadOnly = Boolean(state.keys.cloudflare?.includes("readonly"));
    const domains = stored("cloudflare") ? DOMAINS : [];
    if (hostId === "fly") {
      if (!stored("fly")) gaps.push({ what: "There's no Fly.io access key yet.", where: "In the Fly.io dashboard, choose the organization, open Tokens and select “Create Organization token”.", url: "https://fly.io/dashboard", blocking: true });
      if (state.keys.fly?.includes("apps")) gaps.push({ what: "This Fly.io key may only manage particular apps, so it can't create the editor's own.", where: "In the Fly.io dashboard, choose the organization, open Tokens and select “Create Organization token” — not an app token.", url: "https://fly.io/dashboard", blocking: true });
      if (cfReadOnly) gaps.push({ what: "The Cloudflare key can't change DNS names (it's missing Zone › DNS › Edit), so the three names will be added by hand.", where: "Cloudflare › My Profile › API Tokens: edit the key and add Zone › DNS › Edit.", url: "https://dash.cloudflare.com/profile/api-tokens", blocking: false });
      return { accounts: [{ id: "studio", name: "Studio" }, { id: "personal", name: "Personal" }], regions: FLY_REGIONS, domains: cfReadOnly ? [] : domains, gaps };
    }
    if (hostId === "gcp") {
      const key = state.keys.gcp ?? "";
      if (!stored("gcp")) gaps.push({ what: "There's no key file from Google Cloud (a service account's JSON key) yet.", where: "In the Google Cloud console, open IAM & Admin › Service accounts, create one with the roles listed here, then Keys › Add key › Create new key › JSON.", url: "https://console.cloud.google.com/iam-admin/serviceaccounts", blocking: true });
      if (key.includes("off")) gaps.push({ what: "The Compute Engine API is off in the project “example-project”, so nothing can be created there yet.", where: "Open the page, choose Enable (it can take a minute), then check again. Turning it on may ask for a billing account on the project.", url: "https://console.cloud.google.com/apis/library/compute.googleapis.com?project=example-project", blocking: true });
      if (key.includes("roles")) gaps.push({ what: "The key can't open the web ports to the editor or close the web ports again: its service account needs the role “Compute Security Admin”.", where: "In the Google Cloud console, open IAM & Admin › IAM for the project “example-project”, find editor-maker@example-project.iam.gserviceaccount.com, choose Edit, then Add another role: “Compute Security Admin”. Save, wait a minute, then check again.", url: "https://console.cloud.google.com/iam-admin/iam?project=example-project", blocking: true });
      if (cfReadOnly) gaps.push({ what: "The Cloudflare key can't change DNS names (it's missing Zone › DNS › Edit), so the three names will be added by hand.", where: "Cloudflare › My Profile › API Tokens: edit the key and add Zone › DNS › Edit.", url: "https://dash.cloudflare.com/profile/api-tokens", blocking: false });
      return { accounts: stored("gcp") ? [{ id: "example-project", name: "example-project" }] : [], regions: stored("gcp") && !key.includes("off") ? GCP_REGIONS : [], domains: cfReadOnly ? [] : domains, gaps };
    }
    if (!stored("cloudflare")) gaps.push({ what: "There's no Cloudflare access key yet.", where: "Cloudflare › My Profile › API Tokens › Create Token.", url: "https://dash.cloudflare.com/profile/api-tokens", blocking: true });
    if (cfReadOnly) gaps.push({ what: "This Cloudflare key can't create the three DNS names: it's missing Zone › DNS › Edit.", where: "Cloudflare › My Profile › API Tokens: edit the key and add Zone › DNS › Edit, then check again.", url: "https://dash.cloudflare.com/profile/api-tokens", blocking: true });
    return { accounts: [{ id: "4f1c0a9e2b7d4c18a3e5f60718293a4b", name: "Studio account" }], regions: [], domains: cfReadOnly ? [] : domains, gaps };
  }

  function currentJob(siteId: string): Job | null {
    const id = state.jobs.get(siteId);
    return id ? (mock.jobs.get(id) ?? null) : null;
  }

  function status(siteId: string): HostedEditorStatus {
    const site = mock.site(siteId);
    const record = state.records.get(siteId) ?? null;
    const config = state.configs.get(siteId) ?? null;
    const job = currentJob(siteId);
    const running = job?.state === "running";
    const exists = Boolean(record || config);
    const health: HostedEditorHealth = !exists ? "unknown" : running && job.label !== "Removing the editor" ? "starting" : (state.health.get(siteId) ?? "unknown");
    const runningVersion = exists && (health === "healthy" || health === "setup") ? (state.runningVersion.get(siteId) ?? record?.version ?? null) : null;
    return {
      config,
      record,
      health,
      runningVersion,
      currentVersion: VERSION,
      upgradeAvailable: Boolean(record && record.version !== VERSION),
      job,
      pending: state.pending.get(siteId) ?? null,
      suggestedName: defaultEditorName(site.name),
    };
  }

  function startJob(siteId: string, label: string, work: (job: Job, update: (detail: string, progress: number) => Promise<void>) => Promise<{ detail: string; url?: string }>): Job {
    const running = currentJob(siteId);
    if (running?.state === "running") throw new MockError("busy", "Something is already being done to this site's editor. Wait for it to finish.");
    const job: Job = { id: randomUUID(), kind: "editor-host", label, state: "running", progress: 0, detail: "Getting ready…", siteId, startedAt: Date.now() };
    mock.jobs.set(job.id, job);
    state.jobs.set(siteId, job.id);
    mock.emit({ type: "job", job: { ...job } });
    const update = async (detail: string, progress: number) => {
      await sleep(STEP_MS);
      Object.assign(job, { detail, progress });
      mock.emit({ type: "job", job: { ...job } });
    };
    void work(job, update).then(
      (result) => {
        Object.assign(job, { state: "done", progress: 1, finishedAt: Date.now(), ...result });
        mock.emit({ type: "job", job: { ...job } });
        mock.emit({ type: "site.updated", siteId });
      },
      (error: unknown) => {
        const message = error instanceof MockError ? error.message : "The mock couldn't finish that.";
        Object.assign(job, { state: "error", finishedAt: Date.now(), detail: message, ...(error instanceof MockError && error.detail ? { output: error.detail } : {}) });
        mock.emit({ type: "job", job: { ...job } });
        mock.emit({ type: "site.updated", siteId });
      },
    );
    return { ...job };
  }

  /** The site's settings note the editor's address: a change that shows in Proof, like the real one. */
  function noteEditor(siteId: string, config: EditorConfig | null) {
    const site = mock.site(siteId);
    const next = { ...(site.config ?? {}) } as GalleyConfig;
    if (config) next.editor = config;
    else delete next.editor;
    site.config = next;
    site.write("galley.config.json", Buffer.from(`${JSON.stringify(next, null, 2)}\n`));
    if (config) state.configs.set(siteId, config);
    else state.configs.delete(siteId);
    mock.changed(siteId, ["galley.config.json"], "user");
  }

  function handOver(siteId: string, record: HostedEditorRecord) {
    record.handedOver = new Date().toISOString();
    state.health.set(siteId, "setup");
    state.runningVersion.set(siteId, record.version);
    state.pending.delete(siteId);
    noteEditor(siteId, { url: `https://${record.addresses.editor}`, host: record.host });
  }

  function needRecord(siteId: string): HostedEditorRecord {
    const record = state.records.get(siteId);
    if (!record) throw new MockError("not-found", "This computer didn't put this site's editor online, so it can only open it. Upgrade or remove it from the computer that did, or on the host itself.");
    return record;
  }

  return {
    "GET /api/editor-hosts": () => {
      local();
      return { hosts: HOSTS.map((host) => ({ ...host, secrets: secrets(host) })), absent: ABSENT };
    },

    "POST /api/editor-hosts/:hostId/connect": async ({ params, body }) => {
      local();
      const host = hostOf(params.hostId);
      await sleep(STEP_MS);
      const key = body?.key?.trim();
      if (key) {
        const name = body?.secret ?? host.credentials[0]?.secret;
        if (!name || !host.credentials.some((credential) => credential.secret === name)) throw new MockError("invalid", `${host.name} doesn't use that key.`);
        const label = host.credentials.find((credential) => credential.secret === name)?.label.replace(/ \(optional\)$/, "") ?? "The key";
        if (key.includes("wrong")) throw new MockError("unconfigured", `${label.replace(/ access key$/, "")} didn't accept the access key. It may have been deleted or have expired. Make a new one and paste it here.${stored(name) ? " The key saved before is still the one in use." : ""}`);
        let hint = key.slice(-4);
        // A Google Cloud key file is a JSON document, shown by its key id's last four (as the engine does).
        if (name === "gcp") {
          let id: unknown;
          try {
            const parsed = JSON.parse(key) as { type?: unknown; private_key_id?: unknown };
            id = parsed.type === "service_account" ? parsed.private_key_id : undefined;
          } catch {
            id = undefined;
          }
          if (typeof id !== "string" || !id) throw new MockError("invalid", "That isn't a key file from Google Cloud (a service account's JSON key). In the Google Cloud console, open IAM & Admin › Service accounts, choose the account, then Keys › Add key › Create new key › JSON, and paste the whole file.");
          hint = id.slice(-4);
        }
        mock.secrets[name] = { name, configured: true, source: "stored", hint };
        state.keys[name] = key;
      }
      return inspect(host.id);
    },

    "GET /api/sites/:siteId/editor": ({ params }) => {
      local();
      return status(params.siteId);
    },

    "POST /api/sites/:siteId/editor/plan": async ({ params, body }) => {
      local();
      const site = mock.site(params.siteId);
      const host = hostOf(body.host);
      const name = body.name.trim();
      const nameProblem = editorNameProblem(name);
      if (nameProblem) throw new MockError("invalid", nameProblem);
      const addresses = addressesFor(body);
      for (const credential of host.credentials) {
        if (credential.required && !stored(credential.secret)) throw new MockError("unconfigured", `Add the ${credential.label} first.`);
      }
      await sleep(STEP_MS * 2);
      const problems: HostedEditorPlan["problems"] = [];
      const steps: ManualStep[] = [];
      const handover: HandoverLine[] = [];
      if (state.records.has(site.id) || state.configs.has(site.id)) problems.push({ message: `This site already has an editor online.`, fix: "Remove it first, then put a new one online." });
      if (name === "taken") problems.push(host.id === "gcp" ? { message: "There's already a network called “taken-net” in the project “example-project”.", fix: "Choose another short name." } : { message: `There's already an app called “taken” on your ${host.id === "fly" ? "Fly.io" : "Cloudflare"} account.`, fix: "Choose another name." });
      if (host.id !== "own-server" && !body.account) problems.push({ message: "Choose the account the editor goes in." });

      const summary = site.summaryInfo();
      if (body.handover.repository) {
        if (summary.remoteUrl) {
          handover.push({ label: "Repository", value: summary.remoteUrl, secret: false });
          if (summary.branch) handover.push({ label: "Branch it publishes to", value: summary.branch, secret: false });
        } else steps.push({ title: "Connect the repository on the editor", detail: "This site has no repository address the editor could reach, so its setup screen asks for one." });
      }
      if (body.handover.identity) {
        const author = mock.settings.author;
        if (author.name && author.email) handover.push({ label: "Publishing name and e-mail", value: `${author.name} <${author.email}>`, secret: false });
        else steps.push({ title: "Give the publishing name and e-mail on the editor", detail: "None is set here, so the editor's setup screen asks for them." });
      }
      if (body.handover.liveAddress) {
        const live = site.model().urls.production;
        if (live) handover.push({ label: "Live address", value: live, secret: false });
        else steps.push({ title: "Give the live address on the editor", detail: "This site has no live address yet, so the editor's setup screen asks for it." });
      }
      for (const key of [...new Set(body.handover.keys)]) {
        const secret = mock.secrets[key];
        if (!secret?.configured) {
          problems.push({ message: `There's no ${KEY_LABEL[key].replace(/^the /, "")} on this computer to hand over.`, fix: "Leave it out, or add it first." });
          continue;
        }
        handover.push({ label: `Key: ${KEY_LABEL[key]}`, value: `…${secret.hint ?? "····"}`, secret: true });
      }

      const options = body.options ?? {};
      const region = FLY_REGIONS.find((entry) => entry.id === (options.region ?? "iad"))?.name ?? "Ashburn, Virginia (US)";
      const dns = stored("cloudflare") && !state.keys.cloudflare?.includes("readonly");
      let resources: HostedResource[] = [];
      let cost = host.cost;
      let files: RecipeFile[] = [];
      if (host.id === "fly") {
        const memory = options.memory ?? "2048";
        cost = flyCost(memory, options.sleep !== "off");
        resources = [
          { kind: "app", id: "", name, detail: `The editor's app, also reachable at ${name}.fly.dev` },
          { kind: "ip", id: "", name: "shared IPv4", detail: "A shared IPv4 address (free)" },
          { kind: "volume", id: "", name: `${name.replace(/-/g, "_")}_data`, detail: `A 3 GB disk in ${region} for everything the editor keeps; Fly.io copies it daily, keeping 7 days` },
          { kind: "machine", id: "", name, detail: `1 shared CPU, ${memory === "1024" ? "1 GB" : "2 GB"} memory, in ${region}${options.sleep === "off" ? "; always awake" : "; sleeps while nobody is using it"}` },
          ...namesOf(addresses).map((hostname) => ({ kind: "certificate", id: "", name: hostname, detail: `HTTPS certificate for ${hostname}` })),
          ...(dns ? namesOf(addresses).map((hostname) => ({ kind: "dns-record", id: "", name: hostname, detail: `${hostname} → ${name}.fly.dev, on Cloudflare` })) : []),
        ];
        if (!dns) steps.unshift(...dnsSteps(addresses, name));
      } else if (host.id === "gcp") {
        const size = options.size === "e2-medium" ? "e2-medium" : "e2-small";
        const place = GCP_REGIONS.find((entry) => entry.id === (options.region ?? "us-central1"))?.name ?? "Iowa (us-central1)";
        cost = gcpCost(size);
        resources = [
          { kind: "network", id: "", name: `${name}-net`, detail: "A network of its own for the editor, apart from anything else in the project" },
          { kind: "subnet", id: "", name: `${name}-subnet`, detail: `Its one subnet (10.20.0.0/24), in ${place}` },
          { kind: "firewall-rule", id: "", name: `${name}-web`, detail: "Lets the web in on ports 80 and 443, to the editor's virtual machine only — no other port, no SSH" },
          { kind: "address", id: "", name: `${name}-ip`, detail: `A fixed address in ${place}, so the three names keep pointing at the editor` },
          { kind: "machine", id: "", name, detail: `A virtual machine with ${size === "e2-medium" ? "4 GB" : "2 GB"} of memory (${size}), Ubuntu 24.04, in ${place}; it installs Docker and starts the editor with Caddy for HTTPS by itself` },
          { kind: "disk", id: "", name, detail: "A 20 GB disk for everything the editor keeps; it goes with the virtual machine" },
          ...(dns ? namesOf(addresses).map((hostname) => ({ kind: "dns-record", id: "", name: hostname, detail: `${hostname} → the editor's fixed address (DNS only), on Cloudflare` })) : []),
        ];
        if (!dns) {
          steps.unshift(
            ...namesOf(addresses).map((hostname) => ({ title: `Add the DNS name ${hostname}`, detail: `At the company that holds your domain, add an A record for ${hostname} with the editor's fixed address (this app shows it once it exists).`, copy: `${hostname}.  A  <the editor's fixed address, shown once it exists>` })),
            { title: "Then choose Check", detail: `Once the three names lead to the virtual machine, ${addresses.editor} answers and the site is handed over.` },
          );
        }
      } else if (host.id === "cloudflare") {
        resources = [
          { kind: "tunnel", id: "", name, detail: "A tunnel: the connector on your computer dials out to Cloudflare, so no ports are opened" },
          ...namesOf(addresses).map((hostname) => ({ kind: "dns-record", id: "", name: hostname, detail: `${hostname} → the tunnel, on Cloudflare` })),
        ];
        files = filesFor("cloudflare", addresses, name);
        steps.unshift(...selfRunSteps("cloudflare", addresses));
      } else {
        files = filesFor("own-server", addresses, name);
        steps.unshift(...selfRunSteps("own-server", addresses));
      }

      const plan: HostedEditorPlan = { id: randomUUID(), host: host.id, hostName: host.name, account: body.account, name, addresses, image: `${IMAGE}:${VERSION}`, resources, cost, handover, steps, files, problems };
      state.plans.set(plan.id, { plan, request: body, siteId: site.id, expires: Date.now() + PLAN_TTL_MS });
      return plan;
    },

    "POST /api/sites/:siteId/editor": ({ params, body }) => {
      local();
      if ((body as { confirm?: unknown }).confirm !== true) throw new MockError("invalid", "Nothing was created: the plan needs a yes first.");
      const entry = state.plans.get(body.plan);
      if (!entry || entry.siteId !== params.siteId || entry.expires < Date.now()) throw new MockError("invalid", "That plan isn't one this app made for this site, or it was already used or is more than fifteen minutes old. Make the plan again.");
      if (entry.plan.problems.length > 0) throw new MockError("invalid", `Nothing was created: ${entry.plan.problems[0]!.message}`);
      if (state.records.has(params.siteId)) throw new MockError("invalid", "This site already has an editor online. Remove it first, then put a new one online.");
      state.plans.delete(body.plan);
      const { plan, request } = entry;
      const host = hostOf(plan.host);
      const record: HostedEditorRecord = { host: plan.host, account: plan.account, name: plan.name, addresses: plan.addresses, image: plan.image, version: VERSION, createdAt: new Date().toISOString(), resources: [], setup: "pending", options: { ...(request.options ?? {}) } };
      state.records.set(params.siteId, record);
      state.health.set(params.siteId, "unreachable");
      state.checks.delete(params.siteId);
      return startJob(params.siteId, "Putting the editor online", async (_job, update) => {
        await update(`Connecting to ${host.name}…`, 0.02);
        const total = plan.resources.length;
        for (const [index, resource] of plan.resources.entries()) {
          await update(`Creating ${resource.detail?.split(/[:;,]/)[0]?.toLowerCase() ?? resource.name}…`, 0.05 + ((index + 1) / Math.max(total, 1)) * 0.55);
          record.resources.push({ ...resource, id: resource.id || `${resource.kind}_${randomBytes(3).toString("hex")}` });
          if (plan.name.includes("fail") && index === 1) {
            throw new MockError("internal", `${host.name} stopped answering while the disk was being created. Two things were made; you can remove them from the Online screen.`, "POST /v1/apps/…/volumes → 503 Service Unavailable");
          }
        }
        if (record.resources.length === 0) await update("Writing the files…", 0.6);
        const steps = plan.steps;
        if (host.kind === "self-run" || steps.length > 0) {
          state.pending.set(params.siteId, { steps, files: plan.files });
          return { detail: host.kind === "self-run" ? `Ready to start: ${steps[0]?.title ?? "start the files"}.` : `Created. Still to do: ${steps[0]?.title ?? "the steps listed"}.` };
        }
        await update(`Waiting for ${plan.addresses.editor} to answer…`, 0.7);
        await update("It answered.", 0.88);
        await update("Handing the site over…", 0.92);
        handOver(params.siteId, record);
        return { detail: "The editor is online. Open its first-run link to create the owner's account.", url: `https://${plan.addresses.editor}` };
      });
    },

    "POST /api/sites/:siteId/editor/setup-link": async ({ params }) => {
      local();
      const record = needRecord(params.siteId);
      await sleep(STEP_MS);
      if (record.setup === "done") throw new MockError("invalid", "First run on the editor is finished, so its setup link no longer works. Open it and sign in.");
      return { url: `https://${record.addresses.editor}/setup?token=${randomBytes(24).toString("base64url")}` };
    },

    "POST /api/sites/:siteId/editor/check": async ({ params }) => {
      local();
      const record = needRecord(params.siteId);
      await sleep(STEP_MS * 2);
      const tries = (state.checks.get(params.siteId) ?? 0) + 1;
      state.checks.set(params.siteId, tries);
      if (!record.handedOver && (!record.addresses.editor.includes("slow") || tries > 1)) handOver(params.siteId, record);
      return status(params.siteId);
    },

    "POST /api/sites/:siteId/editor/upgrade": ({ params }) => {
      local();
      const record = needRecord(params.siteId);
      if (record.version === VERSION) throw new MockError("invalid", `The editor already runs version ${VERSION}.`);
      return startJob(params.siteId, "Upgrading the editor", async (_job, update) => {
        await update(`Moving it to version ${VERSION}…`, 0.3);
        await update("Starting the new version on the same disk…", 0.6);
        await update(`Waiting for ${record.addresses.editor} to answer…`, 0.85);
        record.version = VERSION;
        record.image = `${IMAGE}:${VERSION}`;
        state.runningVersion.set(params.siteId, VERSION);
        state.health.set(params.siteId, record.setup === "done" ? "healthy" : "setup");
        return { detail: `The editor runs version ${VERSION}. Nothing on it changed.`, url: `https://${record.addresses.editor}` };
      });
    },

    "POST /api/sites/:siteId/editor/backup": async ({ params }) => {
      local();
      const record = needRecord(params.siteId);
      await sleep(STEP_MS * 2);
      if (record.host === "gcp") {
        const snapshot = `${record.name}-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
        return { kind: "snapshot", snapshot, message: `Google Cloud copied the editor's disk as the snapshot “${snapshot}”. It stays until you delete it (Compute Engine › Snapshots in the Google Cloud console); removing the editor here leaves it.` };
      }
      if (record.host === "fly") {
        const snapshot = `vs_${randomBytes(4).toString("hex")}`;
        return { kind: "snapshot", snapshot, message: "Fly.io copied the editor's disk. The copy is kept for 5 days; restore it from the Fly.io dashboard." };
      }
      return { kind: "page", url: `https://${record.addresses.editor}/install`, message: "This host can't copy the disk itself. Download a backup from the editor's own Install page." };
    },

    "GET /api/sites/:siteId/editor/removal": async ({ params }) => {
      local();
      const record = needRecord(params.siteId);
      await sleep(STEP_MS);
      const skipped = leftAlone(record);
      return {
        resources: record.resources.filter((resource) => !skipped.some((entry) => entry.resource === resource)),
        skipped,
        kept: ["The site, its repository and its version history", `The live site${mock.site(params.siteId).model().urls.production ? ` at ${mock.site(params.siteId).model().urls.production}` : ""}`, "This computer's copy of the site, with any changes not yet published", ...(record.host === "gcp" ? ["Copies of the editor's disk made with Back up (snapshots): they stay in the project until you delete them in Compute Engine › Snapshots"] : [])],
        warning: "Changes made on the hosted editor that were never published are deleted with it. Publish them first, or download a backup from its Install page.",
      };
    },

    "DELETE /api/sites/:siteId/editor": ({ params, body }) => {
      local();
      if ((body as { confirm?: unknown } | undefined)?.confirm !== true) throw new MockError("invalid", "Nothing was removed: removing the editor needs a yes first.");
      const record = needRecord(params.siteId);
      return startJob(params.siteId, "Removing the editor", async (_job, update) => {
        const skipped = leftAlone(record);
        const list = record.resources.filter((resource) => !skipped.some((entry) => entry.resource === resource)).reverse();
        for (const [index, resource] of list.entries()) {
          await update(`Deleting ${resource.name}…`, (index + 1) / Math.max(list.length, 1));
        }
        state.records.delete(params.siteId);
        state.pending.delete(params.siteId);
        state.health.delete(params.siteId);
        if (state.configs.has(params.siteId)) noteEditor(params.siteId, null);
        // The real engine's words (core/src/hosting/service.ts): the screen says what went.
        return { detail: skipped.length ? `Removed. ${skipped.length === 1 ? "One thing was" : `${skipped.length} things were`} left alone because ${skipped.length === 1 ? "it" : "they"} changed or had already gone.` : "Removed." };
      });
    },
  };
}
