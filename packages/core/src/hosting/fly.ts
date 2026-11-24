/**
 * Fly.io, through the Machines REST API (https://api.machines.dev; docs read
 * 2026-11-23 at docs.fly.io/machines/api/ and docs.fly.io/api/machines/openapi.json).
 *
 * `create`, in order, recording each thing the moment it exists:
 *   1. POST /v1/apps { app_name, name, org_slug } — the docs' example says
 *      `app_name`, the OpenAPI schema says `name`; both are sent
 *   2. POST /v1/apps/:app/ip_assignments { type: "shared_v4" }, then { type: "v6" }
 *      (a new app has no public address until it has these)
 *   3. POST /v1/apps/:app/volumes — the install's disk
 *   4. POST /v1/apps/:app/machines — the image, its environment (no secret:
 *      the setup code only as its SHA-256), the disk at /data, one service on
 *      port 4400 behind 80 (to HTTPS) and 443, an http check on /healthz,
 *      restart on failure, a stop timeout, and `metadata` naming the install;
 *      then GET …/machines/:id/wait?state=started
 *   5. POST /v1/apps/:app/certificates/acme { hostname } × 3
 *   6. with a Cloudflare key that may edit the domain: three DNS-only CNAMEs
 *      to <app>.fly.dev, each with a comment naming the install; otherwise the
 *      person adds them by hand (the plan's steps) and `check` finishes later.
 * Removing deletes, newest first: the DNS records, the certificates, the
 * machine (force), the disk, the addresses, the app (force) — after checking
 * each still is what was created, and leaving the app alone when anything in
 * it was changed or added since.
 */
import { depthBelow } from "./addresses";
import { canReadDns, CLOUDFLARE_API, createRecord, deleteRecord, listZones, readRecord, recordResourceId, recordsNamed, splitRecordId, zoneFor, type CfZone } from "./cloudflare-api";
import { inspectCloudflare } from "./cloudflare";
import { HostingError } from "./errors";
import { apiRequest, describe, type ApiResponse } from "./http";
import { INSTALL_PORT } from "./recipe";
import { recordComment, TAG_KEY } from "./tag";
import type { CostEstimate, EditorAddresses, EditorHost, EditorHostContext, EditorHostGap, HostedResource, ManualStep } from "./types";

export const FLY_API = "https://api.machines.dev";
const NAME = "Fly.io";
const DISK_GB = 3;
const DISK_LIMIT_GB = 10;
const WAIT_ROUNDS = 5;
const DASHBOARD = "https://fly.io/dashboard";
const ORG_TOKEN_STEPS = "In the Fly.io dashboard, choose the organization, open Tokens and select “Create Organization token”; paste the whole key it shows, “FlyV1” included.";

/**
 * Places the install can run. Fly.io's API has no list the docs reviewed for
 * this feature describe, so this is a fixed list of its long-standing
 * regions; prices are quoted for iad and ewr, the cheapest.
 */
export const FLY_REGIONS: Array<{ id: string; name: string }> = [
  { id: "iad", name: "Ashburn, Virginia (US)" },
  { id: "ewr", name: "Secaucus, New Jersey (US)" },
  { id: "ord", name: "Chicago (US)" },
  { id: "sjc", name: "San Jose, California (US)" },
  { id: "lax", name: "Los Angeles (US)" },
  { id: "yyz", name: "Toronto (Canada)" },
  { id: "gru", name: "São Paulo (Brazil)" },
  { id: "lhr", name: "London (UK)" },
  { id: "ams", name: "Amsterdam (Netherlands)" },
  { id: "fra", name: "Frankfurt (Germany)" },
  { id: "cdg", name: "Paris (France)" },
  { id: "arn", name: "Stockholm (Sweden)" },
  { id: "bom", name: "Mumbai (India)" },
  { id: "sin", name: "Singapore" },
  { id: "nrt", name: "Tokyo (Japan)" },
  { id: "syd", name: "Sydney (Australia)" },
  { id: "jnb", name: "Johannesburg (South Africa)" },
];
export const FLY_DEFAULT_REGION = "iad";

// ─────────────────────────────────────────────────────────────── cost

/**
 * Fly.io's rates (docs.fly.io/about/pricing, read 2026-11-23), per 30 days in
 * its cheapest regions: shared-cpu-1x with 1 GB $6.70; 256 MB $2.19 plus
 * $6.00 for each further GB, so 2 GB is $2.19 + 1.75 × $6.00 = $12.69 (worked
 * out: no 2 GB price is printed); a disk $0.15 per GB; a stopped machine
 * $0.15 per GB of its image; outgoing data $0.02 per GB in North America and
 * Europe; shared IPv4 and IPv6 free; the first 10 certificates free.
 */
const RATES = { machine: { 1024: 6.7, 2048: 12.69 }, diskGb: 0.15, stoppedImageGb: 0.15, dataGb: 0.02 } as const;
const AWAKE_HOURS = 90;
const MONTH_HOURS = 720;
const ASSUMED_DATA_GB = 5;
const ASSUMED_IMAGE_GB = 1;
const cents = (value: number) => Math.round(value * 100) / 100;

export function flyCost(memory: 1024 | 2048, sleeps: boolean): CostEstimate {
  const machine = RATES.machine[memory];
  const disk = cents(DISK_GB * RATES.diskGb);
  const data = cents(ASSUMED_DATA_GB * RATES.dataGb);
  const awake = cents(machine + disk + data);
  const asleep = cents(cents((machine * AWAKE_HOURS) / MONTH_HOURS) + cents((ASSUMED_IMAGE_GB * RATES.stoppedImageGb * (MONTH_HOURS - AWAKE_HOURS)) / MONTH_HOURS) + disk + data);
  const size = memory === 2048 ? "2 GB" : "1 GB";
  const money = (value: number) => `$${value.toFixed(2)}`;

  return {
    monthly: awake,
    currency: "USD",
    lines: [
      { label: `Computer: 1 shared CPU, ${size} memory, running all day`, amount: machine },
      { label: `Disk: ${DISK_GB} GB`, amount: disk },
      { label: `Outgoing data, about ${ASSUMED_DATA_GB} GB`, amount: data },
      { label: "Three HTTPS certificates (the first 10 are free)", amount: 0 },
      { label: "Shared IPv4 and IPv6 addresses", amount: 0 },
    ],
    note: [
      `Awake all day: about ${money(awake)} a month.`,
      sleeps
        ? `It sleeps while nobody is using it, so it usually costs much less: about ${money(asleep)} a month when it is awake about 3 hours a day. The first visit after a sleep takes a few seconds.`
        : "It stays awake, so it answers at once.",
      `Prices for Ashburn, Virginia; other regions cost a little more.${memory === 2048 ? " The 2 GB price is worked out from Fly.io's rates ($2.19 for 256 MB, $6.00 for each further GB)." : ""}`,
      "Fly.io needs a card on the account; it covers $5 of use a month on its free plan. The disk grows by itself up to 10 GB, at $0.15 a month for each further GB.",
    ].join(" "),
    source: "https://docs.fly.io/about/pricing/",
    checked: "2026-11-23",
  };
}

// ─────────────────────────────────────────────────────────────── the API

interface FlyError {
  error?: string;
  status?: string;
}

interface FlyMachine {
  id: string;
  name?: string;
  state?: string;
  region?: string;
  instance_id?: string;
  version?: string;
  config?: Record<string, unknown> & { image?: string; metadata?: Record<string, string>; mounts?: Array<{ volume?: string }> };
}

interface FlyVolume {
  id: string;
  name?: string;
  state?: string;
  attached_machine_id?: string | null;
}

function flyFailure(response: ApiResponse<FlyError>, method: string, path: string, doing: string, name?: string): HostingError {
  const detail = describe(method, path, response);
  const status = response.body?.status;

  if (response.status === 401) return new HostingError("unauthorized", "Fly.io didn't accept the access key. It may have been deleted or have expired. Create a new one and paste it here.", detail);
  if (response.status === 403) return new HostingError("permission", `Fly.io didn't let the access key ${doing}. It needs an organization key: ${ORG_TOKEN_STEPS}`, detail);
  if (status === "name_taken") return new HostingError("taken", `The name “${name ?? ""}” is taken on Fly.io — app names there are shared by everyone. Choose another name.`, detail);
  if (status === "insufficient_capacity" || status === "volume_placement_capacity") return new HostingError("capacity", "Fly.io has no room in that region right now. Choose another region and try again.", detail);
  if (response.status === 429) return new HostingError("rate-limited", "Fly.io is asking for a pause. Wait a minute, then try again.", detail);
  const message = response.body?.error;

  return new HostingError("host", `Fly.io couldn't ${doing}${message ? `: “${message.slice(0, 200)}”` : ""}. Try again in a moment.`, detail);
}

function fly<T>(ctx: EditorHostContext, key: string, method: string, path: string, init: { json?: unknown; query?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<ApiResponse<T & FlyError>> {
  return apiRequest<T & FlyError>(ctx, "fly", NAME, { method, path, key, ...init });
}

async function flyOk<T>(ctx: EditorHostContext, key: string, method: string, path: string, doing: string, init: { json?: unknown; query?: Record<string, string | undefined>; name?: string } = {}): Promise<T> {
  const response = await fly<T>(ctx, key, method, path, init);

  if (!response.ok) throw flyFailure(response, method, path, doing, init.name);
  return (response.body ?? ({} as T)) as T;
}

/** Deletes, treating "already gone" as done. */
async function flyDelete(ctx: EditorHostContext, key: string, path: string, doing: string, query?: Record<string, string>): Promise<void> {
  const response = await fly<unknown>(ctx, key, "DELETE", path, query ? { query } : {});

  if (response.status === 404) return;
  if (!response.ok) throw flyFailure(response, "DELETE", path, doing);
}

const app = (name: string) => `v1/apps/${encodeURIComponent(name)}`;

async function keyOf(ctx: EditorHostContext): Promise<string> {
  const key = await ctx.secret("fly");

  if (!key) throw new HostingError("no-key", "Add a Fly.io access key first. Paste it in the setup, or start the app with FLY_API_TOKEN set.");
  return key;
}

/** Whether Fly.io knows the key (GET /v1/tokens/current). Creates nothing. */
export async function checkFlyKey(ctx: EditorHostContext, key: string): Promise<Array<{ org_slug?: string; organization?: unknown; apps?: unknown[] }>> {
  const body = await flyOk<{ tokens?: Array<{ org_slug?: string; organization?: unknown; apps?: unknown[] }> }>(ctx, key, "GET", "v1/tokens/current", "check the access key");

  return body.tokens ?? [];
}

/** The volume's name: at most 30 lowercase letters, digits and underscores. */
export function volumeName(name: string): string {
  return `${name.replace(/-/g, "_")}_data`.slice(0, 30);
}

/** The Cloudflare domain the three names can be added to by this app, or null (they are added by hand). */
export async function cloudflareDns(ctx: EditorHostContext, addresses: EditorAddresses): Promise<{ key: string; zone: CfZone } | null> {
  const key = await ctx.secret("cloudflare");

  if (!key) return null;
  try {
    const zones = await listZones(ctx, key);
    const zone = zones ? zoneFor(zones, addresses.editor) : null;

    if (!zone || [addresses.preview, addresses.live].some((host) => depthBelow(host, zone.name) < 1)) return null;
    return (await canReadDns(ctx, key, zone.id)) ? { key, zone } : null;
  } catch (error) {
    // A Cloudflare key that doesn't work only means the names are added by hand.
    if (error instanceof HostingError && (error.reason === "unauthorized" || error.reason === "permission")) return null;
    throw error;
  }
}

function dnsSteps(addresses: EditorAddresses, appName: string): ManualStep[] {
  const names = [addresses.editor, addresses.preview, addresses.live];

  return [
    ...names.map((host) => ({
      title: `Add the DNS name ${host}`,
      detail: `At the company that holds your domain, add a CNAME record for ${host} pointing to ${appName}.fly.dev. If the domain is on Cloudflare, set it to “DNS only” (the grey cloud), so Fly.io can make its certificate.`,
      copy: `${host}.  CNAME  ${appName}.fly.dev.`,
    })),
    { title: "Then choose Check", detail: `Once the three names lead to Fly.io (usually minutes, sometimes an hour), ${addresses.editor} answers, the site is handed over and you get the first-run link.` },
  ];
}

function machineConfig(input: { image: string; environment: Record<string, string>; volume: string; memory: 1024 | 2048; sleeps: boolean; name: string }): Record<string, unknown> {
  return {
    image: input.image,
    // Half the memory for the site's own preview and build, so a runaway build ends itself instead of the whole editor.
    env: { ...input.environment, GALLEY_PREVIEW_MEMORY_MB: String(input.memory / 2) },
    guest: { cpu_kind: "shared", cpus: 1, memory_mb: input.memory },
    mounts: [{ volume: input.volume, path: "/data", extend_threshold_percent: 80, add_size_gb: 1, size_gb_limit: DISK_LIMIT_GB }],
    services: [
      {
        protocol: "tcp",
        internal_port: INSTALL_PORT,
        autostop: input.sleeps ? "stop" : "off",
        autostart: true,
        min_machines_running: 0,
        ports: [
          { port: 80, handlers: ["http"], force_https: true },
          { port: 443, handlers: ["tls", "http"] },
        ],
        checks: [{ type: "http", method: "GET", path: "/healthz", interval: "15s", timeout: "5s", grace_period: "30s" }],
      },
    ],
    restart: { policy: "on-failure", max_retries: 5 },
    stop_config: { signal: "SIGTERM", timeout: "30s" },
    metadata: { [TAG_KEY]: input.name },
  };
}

function memoryOf(options: Record<string, string> | undefined): 1024 | 2048 {
  return options?.memory === "1024" ? 1024 : 2048;
}

const sleepsOf = (options: Record<string, string> | undefined) => options?.sleep !== "off";

/** Waits for the machine to reach `started` (at the given version), a minute at a time. */
async function waitStarted(ctx: EditorHostContext, key: string, appName: string, machine: string, version?: string): Promise<void> {
  const path = `${app(appName)}/machines/${encodeURIComponent(machine)}/wait`;

  for (let round = 0; round < WAIT_ROUNDS; round += 1) {
    const response = await fly<unknown>(ctx, key, "GET", path, { query: { state: "started", timeout: "60", ...(version ? { version } : {}) }, timeoutMs: 90_000 });

    if (response.ok) return;
    // 408: still not there after the minute the call waits.
    if (response.status !== 408) throw flyFailure(response, "GET", path, "wait for the editor's computer to start");
  }
  throw new HostingError("host", "Fly.io made the editor's computer, but it didn't start within five minutes. Its log in the Fly.io dashboard says why; remove it here and try again, or choose another region.");
}

export function createFlyHost(): EditorHost {
  const defaults = flyCost(2048, true);

  return {
    id: "fly",
    name: NAME,
    apis: { fly: FLY_API, cloudflare: CLOUDFLARE_API },
    info: {
      id: "fly",
      name: NAME,
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
          docsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
          permissions: ["Zone › DNS › Edit", "Zone › Zone › Read"],
          required: false,
        },
      ],
      cost: defaults,
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

    async inspect(ctx) {
      const key = await ctx.secret("fly");
      const gaps: EditorHostGap[] = [];
      const accounts: Array<{ id: string; name: string }> = [];

      if (!key) gaps.push({ what: "There's no Fly.io access key yet.", where: ORG_TOKEN_STEPS, url: DASHBOARD, blocking: true });
      else {
        for (const token of await checkFlyKey(ctx, key)) {
          if (!token.org_slug) continue;
          if (Array.isArray(token.apps) && token.apps.length > 0) {
            gaps.push({ what: "This Fly.io key may only manage particular apps, so it can't create the editor's own.", where: ORG_TOKEN_STEPS, url: DASHBOARD, blocking: true });
            continue;
          }
          const name = typeof token.organization === "string" && token.organization.trim() ? token.organization.trim() : token.org_slug;

          if (!accounts.some((account) => account.id === token.org_slug)) accounts.push({ id: token.org_slug, name });
        }
        for (const account of accounts) {
          const response = await fly<unknown>(ctx, key, "GET", "v1/apps", { query: { org_slug: account.id } });

          if (response.status === 403) gaps.push({ what: `This Fly.io key can't see the apps of “${account.name}”, so it can't create one there.`, where: ORG_TOKEN_STEPS, url: DASHBOARD, blocking: true });
          else if (!response.ok) throw flyFailure(response, "GET", "v1/apps", "list the organization's apps");
        }
      }
      const cfKey = await ctx.secret("cloudflare");
      let domains: Array<{ id: string; name: string }> = [];

      if (cfKey) {
        try {
          const cloudflare = await inspectCloudflare(ctx, cfKey, false);

          domains = cloudflare.domains;
          gaps.push(...cloudflare.gaps.map((gap) => ({ ...gap, blocking: false })));
        } catch (error) {
          if (!(error instanceof HostingError) || (error.reason !== "unauthorized" && error.reason !== "permission")) throw error;
          gaps.push({ what: "Cloudflare didn't accept its key, so the three DNS names will be added by hand.", where: "Paste a new Cloudflare key with Zone › DNS › Edit to have them added for you.", url: "https://dash.cloudflare.com/profile/api-tokens", blocking: false });
        }
      }
      return { accounts, regions: FLY_REGIONS, domains, gaps };
    },

    async plan(ctx, request, input) {
      const key = await keyOf(ctx);
      const problems: Array<{ message: string; fix?: string }> = [];
      const region = request.options?.region?.trim() || FLY_DEFAULT_REGION;
      const memory = memoryOf(request.options);
      const sleeps = sleepsOf(request.options);
      const regionName = FLY_REGIONS.find((entry) => entry.id === region)?.name ?? region;

      if (!request.account) problems.push({ message: "Choose the Fly.io organization the editor goes in." });
      if (!/^[a-z]{3}$/.test(region)) problems.push({ message: `“${region}” isn't a Fly.io region.`, fix: "Choose one from the list." });
      const existing = await fly<{ organization?: { slug?: string } }>(ctx, key, "GET", app(request.name));

      if (existing.ok) problems.push({ message: `There's already an app called “${request.name}” on your Fly.io account.`, fix: "Choose another name." });
      else if (existing.status !== 404) throw flyFailure(existing, "GET", app(request.name), "look up the name");
      const dns = await cloudflareDns(ctx, input.addresses);
      const names = [input.addresses.editor, input.addresses.preview, input.addresses.live];

      if (dns) {
        for (const host of names) {
          if ((await recordsNamed(ctx, dns.key, dns.zone.id, host)).length > 0) problems.push({ message: `There's already a DNS record for ${host} on Cloudflare.`, fix: "Choose another address, or delete that record on Cloudflare first." });
        }
      }
      const resources: HostedResource[] = [
        { kind: "app", id: "", name: request.name, detail: `The editor's app, also reachable at ${request.name}.fly.dev` },
        { kind: "ip", id: "", name: "shared IPv4", detail: "A shared IPv4 address (free)" },
        { kind: "ip", id: "", name: "IPv6", detail: "An IPv6 address of its own (free)" },
        { kind: "volume", id: "", name: volumeName(request.name), detail: `A ${DISK_GB} GB disk in ${regionName} for everything the editor keeps; it grows by itself up to ${DISK_LIMIT_GB} GB, and Fly.io copies it daily, keeping 7 days` },
        { kind: "machine", id: "", name: request.name, detail: `1 shared CPU, ${memory === 2048 ? "2 GB" : "1 GB"} memory, in ${regionName}${sleeps ? "; sleeps while nobody is using it" : "; always awake"}` },
        ...names.map((host) => ({ kind: "certificate", id: "", name: host, detail: `HTTPS certificate for ${host}` })),
        ...(dns ? names.map((host) => ({ kind: "dns-record", id: "", name: host, detail: `${host} → ${request.name}.fly.dev (DNS only), on Cloudflare` })) : []),
      ];

      return { resources, cost: flyCost(memory, sleeps), steps: dns ? [] : dnsSteps(input.addresses, request.name), files: [], problems };
    },

    async create(ctx, input) {
      const key = await keyOf(ctx);
      const { request, plan } = input;
      const name = request.name;
      const region = request.options?.region?.trim() || FLY_DEFAULT_REGION;
      const memory = memoryOf(request.options);
      const sleeps = sleepsOf(request.options);

      input.onProgress({ detail: "Creating the app on Fly.io…", progress: 0.05 });
      const created = await flyOk<{ id?: string }>(ctx, key, "POST", "v1/apps", "create the app", { json: { app_name: name, name, org_slug: request.account }, name });

      await input.onResource({ kind: "app", id: created.id ?? name, name, detail: `In the organization ${request.account}` });
      input.onProgress({ detail: "Giving it its public addresses…", progress: 0.15 });
      for (const [type, label] of [["shared_v4", "shared IPv4"], ["v6", "IPv6"]] as const) {
        const ip = await flyOk<{ ip?: string; address?: string }>(ctx, key, "POST", `${app(name)}/ip_assignments`, "give the app a public address", { json: { type } });
        const address = ip.ip ?? ip.address;

        if (!address) throw new HostingError("host", "Fly.io didn't say which address it gave the app. Remove it here and try again.", `POST ip_assignments ${type} returned no ip`);
        await input.onResource({ kind: "ip", id: address, name: label });
      }
      input.onProgress({ detail: "Creating its disk…", progress: 0.25 });
      const volume = await flyOk<FlyVolume>(ctx, key, "POST", `${app(name)}/volumes`, "create the disk", {
        json: { name: volumeName(name), region, size_gb: DISK_GB, encrypted: true, snapshot_retention: 7, auto_backup_enabled: true },
      });

      if (!volume.id) throw new HostingError("host", "Fly.io didn't say which disk it made. Remove it here and try again.", "POST volumes returned no id");
      await input.onResource({ kind: "volume", id: volume.id, name: volumeName(name), detail: `${DISK_GB} GB in ${region}` });
      input.onProgress({ detail: "Starting the editor's computer…", progress: 0.4 });
      const machine = await flyOk<FlyMachine>(ctx, key, "POST", `${app(name)}/machines`, "start the editor's computer", {
        json: { name, region, config: machineConfig({ image: plan.image, environment: input.environment, volume: volume.id, memory, sleeps, name }) },
      });

      if (!machine.id) throw new HostingError("host", "Fly.io didn't say which computer it made. Remove it here and try again.", "POST machines returned no id");
      await input.onResource({ kind: "machine", id: machine.id, name, detail: `${memory === 2048 ? "2 GB" : "1 GB"} in ${region}` });
      await waitStarted(ctx, key, name, machine.id);
      const names = [plan.addresses.editor, plan.addresses.preview, plan.addresses.live];

      for (const [index, host] of names.entries()) {
        input.onProgress({ detail: `Asking for the HTTPS certificate for ${host}…`, progress: 0.6 + index * 0.05 });
        await flyOk(ctx, key, "POST", `${app(name)}/certificates/acme`, `ask for the certificate for ${host}`, { json: { hostname: host } });
        await input.onResource({ kind: "certificate", id: host, name: host });
      }
      if (plan.resources.some((resource) => resource.kind === "dns-record")) {
        const dns = await cloudflareDns(ctx, plan.addresses);

        if (!dns) throw new HostingError("permission", "The Cloudflare key can no longer add the DNS names. Add them by hand (see the steps), or paste a key with Zone › DNS › Edit and remove and create again.");
        for (const [index, host] of names.entries()) {
          input.onProgress({ detail: `Adding the DNS name ${host} on Cloudflare…`, progress: 0.8 + index * 0.05 });
          const record = await createRecord(ctx, dns.key, dns.zone, { name: host, content: `${name}.fly.dev`, proxied: false, comment: recordComment(name) });

          await input.onResource({ kind: "dns-record", id: recordResourceId(dns.zone.id, record.id), name: host, detail: `${host} → ${name}.fly.dev, on ${dns.zone.name}` });
        }
      }
      input.onProgress({ detail: "Everything is created on Fly.io.", progress: 1 });
    },

    async pending(_ctx, record) {
      const steps = record.resources.some((resource) => resource.kind === "dns-record") ? [] : dnsSteps(record.addresses, record.name);

      return { steps, files: [] };
    },

    async upgrade(ctx, record, input) {
      const key = await keyOf(ctx);
      const machineId = record.resources.find((resource) => resource.kind === "machine")?.id;

      if (!machineId) throw new HostingError("not-found", "The editor's computer isn't in this computer's record, so it can't be upgraded from here.");
      const path = `${app(record.name)}/machines/${encodeURIComponent(machineId)}`;

      input.onProgress({ detail: "Reading the editor's settings on Fly.io…", progress: 0.1 });
      const current = await flyOk<FlyMachine>(ctx, key, "GET", path, "read the editor's computer");
      const version = current.version ?? current.instance_id;

      if (!current.config) throw new HostingError("host", "Fly.io didn't send the editor's settings, so nothing was changed. Try again.", "GET machine returned no config");
      input.onProgress({ detail: `Moving it to ${input.image}…`, progress: 0.3 });
      // The config is replaced whole: everything as it is, with the new image. `current_version` refuses if it changed meanwhile.
      const updated = await flyOk<FlyMachine>(ctx, key, "POST", path, "move the editor to the new version", { json: { config: { ...current.config, image: input.image }, ...(version ? { current_version: version } : {}) } });

      input.onProgress({ detail: "Waiting for it to start again…", progress: 0.6 });
      await waitStarted(ctx, key, record.name, machineId, updated.version ?? updated.instance_id);
    },

    async backup(ctx, record) {
      const key = await keyOf(ctx);
      const volume = record.resources.find((resource) => resource.kind === "volume");

      if (!volume) throw new HostingError("not-found", "The editor's disk isn't in this computer's record, so it can't be copied from here.");
      const snapshot = await flyOk<{ id?: string; snapshot_id?: string }>(ctx, key, "POST", `${app(record.name)}/volumes/${encodeURIComponent(volume.id)}/snapshots`, "copy the editor's disk", { json: {} });

      return {
        kind: "snapshot",
        snapshot: snapshot.id ?? snapshot.snapshot_id ?? "",
        message: "Fly.io is copying the editor's disk now. It keeps the copy for 7 days, next to its daily ones; a copy is put back on Fly.io. To keep one of your own, download a backup from the editor's Install page.",
      };
    },

    async removal(ctx, record) {
      const key = await keyOf(ctx);
      const resources: HostedResource[] = [];
      const skipped: Array<{ resource: HostedResource; reason: string }> = [];
      const ours = { machines: new Set<string>(), volumes: new Set<string>() };
      const changedInside: string[] = [];
      /** Machines that will go (or are gone): a disk attached to any other one must stay. */
      const leaving = new Set<string>();
      let appResource: HostedResource | null = null;
      const appGone = { value: false };

      for (const resource of record.resources) {
        if (resource.kind === "machine") ours.machines.add(resource.id);
        if (resource.kind === "volume") ours.volumes.add(resource.id);
      }
      const appInfo = await fly<{ id?: string; name?: string; organization?: { slug?: string } }>(ctx, key, "GET", app(record.name));

      if (appInfo.status === 404) appGone.value = true;
      else if (!appInfo.ok) throw flyFailure(appInfo, "GET", app(record.name), "look up the app");
      // Machines first: whether a disk can go depends on the machine using it.
      const checkOrder = [...record.resources].sort((a, b) => Number(b.kind === "machine") - Number(a.kind === "machine"));

      for (const resource of checkOrder) {
        const gone = (reason = "It's already gone.") => skipped.push({ resource, reason });

        if (resource.kind === "app") {
          appResource = resource;
          continue;
        }
        if (resource.kind === "dns-record") {
          const ids = splitRecordId(resource.id);
          const cfKey = await ctx.secret("cloudflare");

          if (!ids || !cfKey) {
            skipped.push({ resource, reason: "There's no Cloudflare key on this computer to check it with, so it was left alone." });
            continue;
          }
          const found = await readRecord(ctx, cfKey, ids.zoneId, ids.recordId);

          if (!found) gone();
          else if (found.comment !== recordComment(record.name)) skipped.push({ resource, reason: "Its note on Cloudflare was changed, so it may belong to something else now." });
          else if (found.content !== `${record.name}.fly.dev` || found.name !== resource.name) skipped.push({ resource, reason: "It points somewhere else now." });
          else resources.push(resource);
          continue;
        }
        if (appGone.value) {
          gone("It went with the app, which is already gone.");
          continue;
        }
        if (resource.kind === "machine") {
          const response = await fly<FlyMachine>(ctx, key, "GET", `${app(record.name)}/machines/${encodeURIComponent(resource.id)}`);

          if (response.status === 404 || response.body?.state === "destroyed") {
            leaving.add(resource.id);
            gone();
          } else if (!response.ok) throw flyFailure(response, "GET", "machines/:id", "read the editor's computer");
          else if (response.body?.config?.metadata?.[TAG_KEY] !== record.name) {
            skipped.push({ resource, reason: "Its label on Fly.io was changed, so it may belong to something else now." });
            changedInside.push(resource.kind);
          } else {
            leaving.add(resource.id);
            resources.push(resource);
          }
        } else if (resource.kind === "volume") {
          const response = await fly<FlyVolume>(ctx, key, "GET", `${app(record.name)}/volumes/${encodeURIComponent(resource.id)}`);

          if (response.status === 404 || response.body?.state === "destroyed" || response.body?.state === "pending_destroy") gone();
          else if (!response.ok) throw flyFailure(response, "GET", "volumes/:id", "read the editor's disk");
          else if (response.body?.name !== resource.name) {
            skipped.push({ resource, reason: `It's called “${response.body?.name ?? ""}” now, so it was changed after it was created.` });
            changedInside.push(resource.kind);
          } else if (response.body?.attached_machine_id && !leaving.has(response.body.attached_machine_id)) {
            skipped.push({ resource, reason: ours.machines.has(response.body.attached_machine_id) ? "The editor's computer that uses it was left alone, so its disk is too." : "Another computer uses it now." });
            changedInside.push(resource.kind);
          } else resources.push(resource);
        } else if (resource.kind === "ip") {
          const response = await fly<{ ips?: Array<{ ip?: string }> }>(ctx, key, "GET", `${app(record.name)}/ip_assignments`);

          if (!response.ok) throw flyFailure(response, "GET", "ip_assignments", "list the app's addresses");
          if ((response.body?.ips ?? []).some((entry) => entry.ip === resource.id)) resources.push(resource);
          else gone();
        } else if (resource.kind === "certificate") {
          const response = await fly<unknown>(ctx, key, "GET", `${app(record.name)}/certificates/${encodeURIComponent(resource.id)}`);

          if (response.status === 404) gone();
          else if (!response.ok) throw flyFailure(response, "GET", "certificates/:hostname", "read a certificate");
          else resources.push(resource);
        } else {
          skipped.push({ resource, reason: "This app doesn't know how to check it, so it was left alone." });
        }
      }
      if (appResource) {
        if (appGone.value) skipped.push({ resource: appResource, reason: "It's already gone." });
        else {
          // Deleting the app deletes everything in it: only when it holds nothing but what was created here.
          const [machines, volumes] = await Promise.all([
            fly<FlyMachine[]>(ctx, key, "GET", `${app(record.name)}/machines`),
            fly<FlyVolume[]>(ctx, key, "GET", `${app(record.name)}/volumes`),
          ]);

          if (!machines.ok) throw flyFailure(machines as ApiResponse<FlyError>, "GET", "machines", "list the app's computers");
          if (!volumes.ok) throw flyFailure(volumes as ApiResponse<FlyError>, "GET", "volumes", "list the app's disks");
          const foreign = [
            ...((Array.isArray(machines.body) ? machines.body : []) as FlyMachine[]).filter((machine) => machine.state !== "destroyed" && !ours.machines.has(machine.id)).map((machine) => `a computer (${machine.name ?? machine.id})`),
            ...((Array.isArray(volumes.body) ? volumes.body : []) as FlyVolume[]).filter((volume) => volume.state !== "destroyed" && volume.state !== "pending_destroy" && !ours.volumes.has(volume.id)).map((volume) => `a disk (${volume.name ?? volume.id})`),
          ];

          if (appInfo.body?.organization?.slug && appInfo.body.organization.slug !== record.account) skipped.push({ resource: appResource, reason: "It's in another organization now." });
          else if (appInfo.body?.id && appResource.id !== appResource.name && appInfo.body.id !== appResource.id) skipped.push({ resource: appResource, reason: "An app with that name exists, but it isn't the one created here." });
          else if (foreign.length > 0) skipped.push({ resource: appResource, reason: `It now also holds ${foreign.join(" and ")}, which ${foreign.length === 1 ? "wasn't" : "weren't"} created here; deleting the app would delete ${foreign.length === 1 ? "it" : "them"} too.` });
          else if (changedInside.length > 0) skipped.push({ resource: appResource, reason: "Something in it was changed since it was created; deleting the app would delete that too." });
          else resources.unshift(appResource);
        }
      }
      // Keep the record's order (oldest first), so removing can go newest first.
      const order = new Map(record.resources.map((resource, index) => [resource, index]));

      return { resources: resources.sort((a, b) => order.get(a)! - order.get(b)!), skipped };
    },

    async remove(ctx, record, input) {
      const key = await keyOf(ctx);
      const appName = record.name;

      for (const resource of [...record.resources].reverse()) {
        if (resource.kind === "dns-record") {
          const ids = splitRecordId(resource.id);
          const cfKey = await ctx.secret("cloudflare");

          input.onProgress({ detail: `Deleting the DNS name ${resource.name} on Cloudflare…` });
          if (ids && cfKey) await deleteRecord(ctx, cfKey, ids.zoneId, ids.recordId, resource.name);
        } else if (resource.kind === "certificate") {
          input.onProgress({ detail: `Deleting the certificate for ${resource.name}…` });
          await flyDelete(ctx, key, `${app(appName)}/certificates/${encodeURIComponent(resource.id)}`, `delete the certificate for ${resource.name}`);
        } else if (resource.kind === "machine") {
          input.onProgress({ detail: "Stopping and deleting the editor's computer…" });
          await flyDelete(ctx, key, `${app(appName)}/machines/${encodeURIComponent(resource.id)}`, "delete the editor's computer", { force: "true" });
        } else if (resource.kind === "volume") {
          input.onProgress({ detail: "Deleting the editor's disk…" });
          await flyDelete(ctx, key, `${app(appName)}/volumes/${encodeURIComponent(resource.id)}`, "delete the editor's disk");
        } else if (resource.kind === "ip") {
          input.onProgress({ detail: `Giving back the ${resource.name} address…` });
          await flyDelete(ctx, key, `${app(appName)}/ip_assignments/${encodeURIComponent(resource.id)}`, "give back an address");
        } else if (resource.kind === "app") {
          input.onProgress({ detail: "Deleting the app…" });
          await flyDelete(ctx, key, app(appName), "delete the app", { force: "true" });
        } else continue;
        await input.onRemoved(resource);
      }
    },
  };
}
