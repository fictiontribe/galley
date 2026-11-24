/**
 * Google Cloud: a Compute Engine virtual machine with its own disk, on the
 * person's own project, running the same hardened compose recipe "Any server
 * with Docker" writes (the editor and Caddy for HTTPS) — made through
 * Google's API with a service account's JSON key (gcp-api.ts). The facts
 * this relies on, and the pages they come from, are in docs/cloud-install.md.
 *
 * `create`, in order, each thing recorded the moment Google accepts it:
 *   1. POST global/networks            a network of its own (custom subnets)
 *   2. POST regions/:r/subnetworks     its one subnet
 *   3. POST global/firewalls           ports 80 and 443 (tcp; udp 443) to the
 *                                      machine's network tag; no SSH rule
 *   4. POST regions/:r/addresses       a fixed address (then setLabels: Google
 *                                      documents labels on addresses as set
 *                                      only that way)
 *   5. POST zones/:z/instances         Ubuntu 24.04, a balanced boot disk,
 *                                      the fixed address, the tag, labels, no
 *                                      service account, Shielded VM, and a
 *                                      `startup-script` that installs Docker,
 *                                      writes the recipe's `caddy` files and
 *                                      starts them — on every boot, holding
 *                                      no secret; then wait until RUNNING
 *   6. with a Cloudflare key that may edit the domain: three DNS-only A
 *      records to the fixed address, each with a comment naming the install;
 *      otherwise the person adds them (the plan's steps) and `check` finishes.
 * Every operation is waited on until DONE before the next step.
 *
 * Networks, subnets and firewall rules can't carry labels: their name and a
 * description naming the install tag them. Everything else is labelled
 * `<slug>-install=<name>`. Removing deletes, newest first in an order Google
 * accepts: the DNS records, the machine (its disk goes with it), the disk if
 * it stayed, the address, the firewall rule, the subnet, the network — each
 * only after checking it still is what was created; snapshots made by Back up
 * are kept.
 */
import { PRODUCT } from "../brand";
import { CLOUDFLARE_API, createRecord, deleteRecord, readRecord, recordResourceId, recordsNamed, splitRecordId } from "./cloudflare-api";
import { inspectCloudflare } from "./cloudflare";
import { scrubHostingError, HostingError } from "./errors";
import { cloudflareDns } from "./fly";
import {
  checkGcpKey,
  disabledApi,
  GCP_APIS,
  GCP_PERMISSIONS,
  GCP_ROLES,
  gcpClient,
  gcpFailure,
  gcpSecrets,
  grantSteps,
  iamPage,
  lastPart,
  waitOperation,
  type GcpClient,
  type GcpOperation,
  type GoogleError,
} from "./gcp-api";
import type { ApiResponse } from "./http";
import { recipeFiles } from "./recipe";
import { recordComment } from "./tag";
import type { CostEstimate, EditorAddresses, EditorHost, EditorHostContext, EditorHostGap, HostedEditorRecord, HostedResource, ManualStep, RecipeFile } from "./types";

export { checkGcpKey };

const NAME = "Google Cloud";
/** The label every labelled resource carries: `<slug>-install=<name>`. */
export const GCP_LABEL = `${PRODUCT.slug}-install`;
export const GCP_DEFAULT_REGION = "us-central1";
export const GCP_DISK_GB = 20;
const SUBNET_RANGE = "10.20.0.0/24";
/** Ubuntu 24.04 LTS, the family the owner's hand-made VM ran the recipe on (compute/docs/images/os-details, read 2026-11-24). */
export const GCP_IMAGE = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64";
/** Where the startup script writes the recipe's files on the machine. */
export const GCP_FOLDER = `/opt/${PRODUCT.slug}`;
const CONSOLE = "https://console.cloud.google.com";
const KEY_DOCS = "https://docs.cloud.google.com/iam/docs/keys-create-delete";
const MACHINE_PATIENCE_MS = 10 * 60_000;
const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

export type GcpSize = "e2-small" | "e2-medium";

/**
 * The two sizes, with Google's on-demand hourly price in Iowa (us-central1)
 * (cloud.google.com/products/compute/pricing/general-purpose, read
 * 2026-11-24) and the editor's own memory limit inside the machine — less
 * than the machine has, so the system and Caddy keep room.
 */
export const GCP_SIZES: Record<GcpSize, { memory: string; hourly: number; container: string }> = {
  "e2-small": { memory: "2 GB", hourly: 0.016752855, container: "1536m" },
  "e2-medium": { memory: "4 GB", hourly: 0.03350571, container: "3g" },
};

/** Balanced persistent disk, per GiB-hour, Iowa (cloud.google.com/compute/disks-image-pricing, read 2026-11-24). */
const DISK_GB_HOUR = 0.000136986;
/** An external IPv4 address in use on a standard VM, per hour (cloud.google.com/vpc/network-pricing, read 2026-11-24). */
const ADDRESS_HOUR = 0.005;
const MONTH_HOURS = 730;
const cents = (value: number) => Math.round(value * 100) / 100;

export function gcpCost(size: GcpSize): CostEstimate {
  const machine = cents(GCP_SIZES[size].hourly * MONTH_HOURS);
  const disk = cents(DISK_GB_HOUR * MONTH_HOURS * GCP_DISK_GB);
  const address = cents(ADDRESS_HOUR * MONTH_HOURS);

  return {
    monthly: cents(machine + disk + address),
    currency: "USD",
    lines: [
      { label: `Virtual machine: ${size}, ${GCP_SIZES[size].memory} memory, running all day`, amount: machine },
      { label: `Disk: ${GCP_DISK_GB} GB (balanced)`, amount: disk },
      { label: "A fixed address (an external IPv4 address in use)", amount: address },
      { label: "Its network, subnet and firewall rule", amount: 0 },
      { label: "HTTPS certificates (Caddy gets them from Let's Encrypt)", amount: 0 },
    ],
    note: [
      "On-demand prices for Iowa (us-central1); other regions cost a little more or less.",
      "Worked out at 730 hours a month from Google's hourly prices (the machine, the disk at $0.000136986 per GB an hour, the address at $0.005 an hour): an estimate to check on Google's pricing pages, not a quote.",
      "Outgoing data and copies made with Back up are charged by size and aren't included.",
    ].join(" "),
    source: "https://cloud.google.com/products/compute/pricing/general-purpose",
    checked: "2026-11-24",
  };
}

/** Plain names for the regions Google's pricing pages name (read 2026-11-24); any other is shown by its id. */
const REGION_NAMES: Record<string, string> = {
  "us-central1": "Iowa",
  "us-east1": "South Carolina",
  "us-east4": "Northern Virginia",
  "us-east5": "Columbus",
  "us-south1": "Dallas",
  "us-west1": "Oregon",
  "us-west2": "Los Angeles",
  "us-west3": "Salt Lake City",
  "us-west4": "Las Vegas",
  "northamerica-northeast1": "Montréal",
  "northamerica-northeast2": "Toronto",
  "southamerica-east1": "São Paulo",
  "europe-west1": "Belgium",
  "europe-west2": "London",
  "europe-west3": "Frankfurt",
  "europe-west4": "Netherlands",
  "europe-west6": "Zurich",
  "europe-west8": "Milan",
  "europe-west9": "Paris",
  "europe-north1": "Finland",
  "europe-central2": "Warsaw",
  "europe-southwest1": "Madrid",
  "asia-east1": "Taiwan",
  "asia-east2": "Hong Kong",
  "asia-northeast1": "Tokyo",
  "asia-northeast3": "Seoul",
  "asia-south1": "Mumbai",
  "asia-southeast1": "Singapore",
  "australia-southeast1": "Sydney",
  "me-west1": "Tel Aviv",
  "africa-south1": "Johannesburg",
};

export const regionName = (id: string) => (REGION_NAMES[id] ? `${REGION_NAMES[id]} (${id})` : id);

/** The names everything gets, from the install's short name (at most 25 characters, so each fits Google's 63). */
export function gcpNames(name: string) {
  return { network: `${name}-net`, subnet: `${name}-subnet`, firewall: `${name}-web`, address: `${name}-ip`, machine: name, disk: name, tag: name };
}

function sizeOf(options: Record<string, string> | undefined): GcpSize {
  return options?.size === "e2-medium" ? "e2-medium" : "e2-small";
}

// ─────────────────────────────────────────────────────────────── the startup script

/** Ends each file written by the startup script. Checked against the files, so a file can never end the heredoc early. */
const END_OF_FILE = `${PRODUCT.slug.toUpperCase()}-END-OF-FILE`;

/** The recipe's `caddy` files for this install, exactly as "Any server with Docker" writes them. */
export function gcpRecipeFiles(input: { name: string; addresses: EditorAddresses; image: string; environment?: Record<string, string>; size: GcpSize }): RecipeFile[] {
  const hash = input.environment?.GALLEY_SETUP_TOKEN_SHA256;

  return recipeFiles({ name: input.name, addresses: input.addresses, image: input.image, proxy: "caddy", memory: GCP_SIZES[input.size].container, ...(hash ? { setupTokenSha256: hash } : {}) });
}

/**
 * The machine's `startup-script`: it runs as root on every boot, so every
 * step is safe to repeat — Docker installed only when missing, the swap file
 * made once, the files written whole each time (an upgrade changes the image
 * in them), then `docker compose up -d`, which leaves a running editor alone
 * unless its files changed. It holds nothing secret: the setup code is only
 * its SHA-256, in the .env the recipe writes.
 */
export function gcpStartupScript(input: { name: string; addresses: EditorAddresses; image: string; environment?: Record<string, string>; size: GcpSize }): string {
  const files = gcpRecipeFiles(input);

  for (const file of files) {
    if (file.sensitive || file.content.split("\n").includes(END_OF_FILE)) throw new HostingError("invalid", "The editor's files can't be put in the virtual machine's startup script.", file.name);
  }
  return [
    "#!/bin/bash",
    `# ${PRODUCT.name}: the editor “${input.name}” at https://${input.addresses.editor}.`,
    `# Runs on every start of this virtual machine: installs Docker when it is missing, writes the editor's files`,
    `# to ${GCP_FOLDER} and starts them. Nothing here is secret: the setup code is only its SHA-256.`,
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then",
    "  for attempt in 1 2 3 4 5; do",
    "    if apt-get update -y && apt-get install -y --no-install-recommends docker.io docker-compose-v2 ca-certificates; then break; fi",
    "    sleep 15",
    "  done",
    "fi",
    "systemctl enable --now docker",
    "# Room for the site's own package install beside the editor.",
    "if [ ! -f /swapfile ]; then",
    "  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null",
    '  echo "/swapfile none swap sw 0 0" >> /etc/fstab',
    "fi",
    "swapon /swapfile 2>/dev/null || true",
    `install -d -m 0755 ${GCP_FOLDER}`,
    `cd ${GCP_FOLDER}`,
    ...files.flatMap((file) => [`cat > ${file.name}.new <<'${END_OF_FILE}'`, `${file.content}${END_OF_FILE}`, `mv ${file.name}.new ${file.name}`]),
    "docker compose up -d --remove-orphans",
    "",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────── calls

interface GcpInstance {
  name?: string;
  status?: string;
  labels?: Record<string, string>;
  description?: string;
  metadata?: { fingerprint?: string; items?: Array<{ key: string; value: string }> };
  disks?: Array<{ source?: string; boot?: boolean; autoDelete?: boolean }>;
  networkInterfaces?: Array<{ subnetwork?: string; network?: string; accessConfigs?: Array<{ natIP?: string }> }>;
}

interface GcpNamed {
  name?: string;
  description?: string;
  labels?: Record<string, string>;
  labelFingerprint?: string;
  network?: string;
  address?: string;
  status?: string;
  users?: string[];
  subnetworks?: string[];
  zones?: string[];
}

const project = (client: GcpClient, id: string) => `projects/${encodeURIComponent(client.project)}/${id}`;

/** One call that must succeed. */
async function ok<T>(client: GcpClient, method: string, id: string, doing: string, init: { json?: unknown; query?: Record<string, string | undefined>; name?: string; what?: string } = {}): Promise<T> {
  const path = project(client, id);
  const response = await client.call<T>("gcp-compute", method, path, { ...(init.json !== undefined ? { json: init.json } : {}), ...(init.query ? { query: init.query } : {}) });

  if (!response.ok) throw gcpFailure(response, method, path, doing, { project: client.project, email: client.key.client_email, ...(init.name ? { name: init.name } : {}), ...(init.what ? { what: init.what } : {}) });
  return (response.body ?? {}) as T;
}

/** A read where "not there" is an answer: null. */
async function find<T>(client: GcpClient, id: string, doing: string): Promise<T | null> {
  const path = project(client, id);
  const response = await client.call<T>("gcp-compute", "GET", path);

  if (response.status === 404) return null;
  if (!response.ok) throw gcpFailure(response, "GET", path, doing, { project: client.project, email: client.key.client_email });
  return (response.body ?? {}) as T;
}

/** A change, waited on until Google says it is done. */
async function change(ctx: EditorHostContext, client: GcpClient, method: string, id: string, doing: string, init: { json?: unknown; name?: string; what?: string; onAccepted?: () => Promise<void> } = {}): Promise<GcpOperation> {
  const operation = await ok<GcpOperation>(client, method, id, doing, init);

  await init.onAccepted?.();
  return waitOperation(ctx, client, operation, doing, { ...(init.name ? { name: init.name } : {}), ...(init.what ? { what: init.what } : {}) });
}

/** Deletes, treating "already gone" as done. */
async function remove(ctx: EditorHostContext, client: GcpClient, id: string, doing: string): Promise<void> {
  const path = project(client, id);
  const response = await client.call<GcpOperation>("gcp-compute", "DELETE", path);

  if (response.status === 404) return;
  if (!response.ok) throw gcpFailure(response, "DELETE", path, doing, { project: client.project, email: client.key.client_email });
  await waitOperation(ctx, client, response.body ?? {}, doing, {});
}

/** The region's first zone, by name: where the machine and its disk go. */
function zoneOf(region: GcpNamed, regionId: string): string {
  const zones = (region.zones ?? []).map(lastPart).filter((zone) => zone.startsWith(`${regionId}-`)).sort();

  if (!zones[0]) throw new HostingError("host", `Google Cloud didn't list any zone in ${regionName(regionId)}. Choose another region.`);
  return zones[0];
}

async function regionsOf(client: GcpClient): Promise<{ regions: Array<{ id: string; name: string }>; off: string | null }> {
  const found: Array<{ id: string; name: string }> = [];
  let pageToken: string | undefined;

  do {
    const path = project(client, "regions");
    const response = await client.call<{ items?: Array<{ name?: string; status?: string }>; nextPageToken?: string }>("gcp-compute", "GET", path, { query: { pageToken } });
    const off = disabledApi(response as ApiResponse<GoogleError>, "compute.googleapis.com", client.project);

    if (off) return { regions: [], off };
    if (!response.ok) throw gcpFailure(response, "GET", path, "list the regions", { project: client.project, email: client.key.client_email });
    for (const region of response.body?.items ?? []) if (region.name && region.status === "UP") found.push({ id: region.name, name: regionName(region.name) });
    pageToken = response.body?.nextPageToken || undefined;
  } while (pageToken);
  // The priced region first: it's the default.
  found.sort((a, b) => Number(b.id === GCP_DEFAULT_REGION) - Number(a.id === GCP_DEFAULT_REGION) || a.id.localeCompare(b.id));
  return { regions: found, off: null };
}

/** What the key may not do, grouped by the role that would allow it. Null when the check itself couldn't be made. */
async function missingRoles(client: GcpClient): Promise<{ roles: Array<{ role: string; does: string[] }> } | { off: string }> {
  const path = `projects/${encodeURIComponent(client.project)}:testIamPermissions`;
  const response = await client.call<{ permissions?: string[] }>("gcp-resource-manager", "POST", path, { json: { permissions: GCP_PERMISSIONS.map((entry) => entry.permission) } });
  const off = disabledApi(response as ApiResponse<GoogleError>, "cloudresourcemanager.googleapis.com", client.project);

  if (off) return { off };
  if (!response.ok) throw gcpFailure(response, "POST", path, "check what the key may do", { project: client.project, email: client.key.client_email });
  const allowed = new Set(response.body?.permissions ?? []);
  const roles: Array<{ role: string; does: string[] }> = [];

  for (const entry of GCP_PERMISSIONS) {
    if (allowed.has(entry.permission)) continue;
    const role = GCP_ROLES[entry.role];
    let group = roles.find((candidate) => candidate.role === role);

    if (!group) roles.push((group = { role, does: [] }));
    if (!group.does.includes(entry.does)) group.does.push(entry.does);
  }
  return { roles };
}

function roleGap(client: GcpClient, missing: { role: string; does: string[] }): EditorHostGap {
  return {
    what: `The key can't ${missing.does.length > 1 ? `${missing.does.slice(0, -1).join(", ")} or ${missing.does.at(-1)}` : missing.does[0]}: its service account needs the role “${missing.role}”.`,
    where: grantSteps(client.project, client.key.client_email, [missing.role]),
    url: iamPage(client.project),
    blocking: true,
  };
}

function computeOffGap(projectId: string, url: string): EditorHostGap {
  return {
    what: `The Compute Engine API is off in the project “${projectId}”, so nothing can be created there yet.`,
    where: "Open the page, choose Enable (it can take a minute), then check again. Turning it on may ask for a billing account on the project.",
    url,
    blocking: true,
  };
}

function dnsSteps(addresses: EditorAddresses, ip: string | null): ManualStep[] {
  const names = [addresses.editor, addresses.preview, addresses.live];
  const target = ip ?? "<the editor's fixed address, shown once it exists>";

  return [
    ...names.map((host) => ({
      title: `Add the DNS name ${host}`,
      detail: `At the company that holds your domain, add an A record for ${host} with ${ip ? `the editor's fixed address, ${ip}` : "the editor's fixed address (this app shows it once it exists)"}. If the domain is on Cloudflare, set it to “DNS only” (the grey cloud): Caddy on the virtual machine makes the certificate itself.`,
      copy: `${host}.  A  ${target}`,
    })),
    { title: "Then choose Check", detail: `Once the three names lead to the virtual machine (usually minutes, sometimes an hour), ${addresses.editor} answers, the site is handed over and you get the first-run link.` },
  ];
}

/** The fixed address, as the machine's record says it. */
function addressOf(record: Pick<HostedEditorRecord, "resources">): string | null {
  for (const resource of record.resources) {
    const found = (resource.kind === "address" || resource.kind === "machine") && IPV4.exec(resource.detail ?? "")?.[1];

    if (found) return found;
  }
  return null;
}

const labelled = (labels: Record<string, string> | undefined, name: string) => labels?.[GCP_LABEL] === name;

/** Runs a host call with the key, its private key and any access token cut out of whatever it throws. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw scrubHostingError(error, gcpSecrets(), "Google Cloud stopped unexpectedly. Try again.");
  }
}

/** Waits until the machine says RUNNING. */
async function waitRunning(ctx: EditorHostContext, client: GcpClient, id: string): Promise<void> {
  const started = Date.now();
  let delay = 50;

  for (;;) {
    const machine = await ok<GcpInstance>(client, "GET", id, "read the virtual machine");

    if (machine.status === "RUNNING") return;
    if (machine.status === "TERMINATED" || machine.status === "SUSPENDED") throw new HostingError("host", `The virtual machine stopped (${machine.status.toLowerCase()}) instead of starting. Its serial port log in the Google Cloud console says why; remove it here and try again.`);
    if (Date.now() - started > MACHINE_PATIENCE_MS) throw new HostingError("host", "The virtual machine didn't start within ten minutes. Look at it in the Google Cloud console; remove it here and try again, or choose another region.");
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 5000);
  }
}

// ─────────────────────────────────────────────────────────────── the host

export function createGcpHost(): EditorHost {
  const defaults = gcpCost("e2-small");

  return {
    id: "gcp",
    name: NAME,
    apis: { ...GCP_APIS, cloudflare: CLOUDFLARE_API },
    info: {
      id: "gcp",
      name: NAME,
      summary: "Runs the editor on a virtual machine of its own in your Google Cloud project, with its own disk, a network of its own and a fixed address. Everything is created in your project; your domain gives it its three addresses.",
      kind: "managed",
      credentials: [
        {
          secret: "gcp",
          label: "Google Cloud key file",
          help: "A key file from Google Cloud (a service account's JSON key): paste the whole file. It lets this app create the editor's virtual machine, network and fixed address in the key's project. It's kept on this computer only.",
          docsUrl: KEY_DOCS,
          permissions: [
            "Turn on the Compute Engine API in the project (APIs & Services › Library › Compute Engine API › Enable)",
            "Create a service account (IAM & Admin › Service accounts › Create service account)",
            `Give it the roles “${GCP_ROLES.instance}”, “${GCP_ROLES.network}” and “${GCP_ROLES.security}”`,
            "Create its key: Keys › Add key › Create new key › JSON",
          ],
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

    inspect(ctx) {
      return guarded(async () => {
        const gaps: EditorHostGap[] = [];
        const raw = await ctx.secret("gcp");
        let accounts: Array<{ id: string; name: string }> = [];
        let regions: Array<{ id: string; name: string }> = [];

        if (!raw) {
          gaps.push({ what: "There's no key file from Google Cloud (a service account's JSON key) yet.", where: "In the Google Cloud console, open IAM & Admin › Service accounts, create one with the roles listed here, then Keys › Add key › Create new key › JSON.", url: `${CONSOLE}/iam-admin/serviceaccounts`, blocking: true });
        } else {
          const client = await gcpClient(ctx, raw);

          accounts = [{ id: client.project, name: client.project }];
          const listed = await regionsOf(client);

          if (listed.off) gaps.push(computeOffGap(client.project, listed.off));
          regions = listed.regions;
          const missing = await missingRoles(client);

          if ("off" in missing) {
            gaps.push({
              what: `This app couldn't check what the key may do: the Cloud Resource Manager API is off in the project “${client.project}”.`,
              where: "Turn it on at the page so the app can check before anything is made; otherwise a missing role is said when Google refuses a step.",
              url: missing.off,
              blocking: false,
            });
          } else gaps.push(...missing.roles.map((entry) => roleGap(client, entry)));
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
        return { accounts, regions, domains, gaps };
      });
    },

    plan(ctx, request, input) {
      return guarded(async () => {
        const client = await gcpClient(ctx);
        const problems: Array<{ message: string; fix?: string }> = [];
        const region = request.options?.region?.trim() || GCP_DEFAULT_REGION;
        const size = sizeOf(request.options);
        const names = gcpNames(request.name);
        const hosts = [input.addresses.editor, input.addresses.preview, input.addresses.live];
        const place = regionName(region);

        if (request.account && request.account !== client.project) problems.push({ message: `The key belongs to the project “${client.project}”, not “${request.account}”.`, fix: "Choose that project, or paste a key from the other one." });
        if (!request.account) problems.push({ message: "Choose the Google Cloud project the editor goes in." });
        for (const host of hosts) {
          if (host === "localhost" || host.endsWith(".localhost")) problems.push({ message: `${host} is a name only this computer knows, so the editor's virtual machine can't get a certificate for it.`, fix: "Use names on a domain that's yours, like cms.example.com." });
        }
        let zone: string | null = null;
        const regionPath = project(client, `regions/${encodeURIComponent(region)}`);
        const regionAnswer = await client.call<GcpNamed>("gcp-compute", "GET", regionPath);
        const off = disabledApi(regionAnswer as ApiResponse<GoogleError>, "compute.googleapis.com", client.project);

        if (off) problems.push({ message: `The Compute Engine API is off in the project “${client.project}”.`, fix: `Turn it on at ${off}, wait a minute, then make the plan again.` });
        else if (regionAnswer.status === 404 || regionAnswer.status === 400) problems.push({ message: `“${region}” isn't a Google Cloud region.`, fix: "Choose one from the list." });
        else if (!regionAnswer.ok) throw gcpFailure(regionAnswer, "GET", regionPath, "look up the region", { project: client.project, email: client.key.client_email });
        else if (regionAnswer.body?.status !== "UP") problems.push({ message: `Google Cloud says ${place} is down right now.`, fix: "Choose another region." });
        else zone = zoneOf(regionAnswer.body, region);
        // The names are looked up only in a region that can be used: elsewhere there is nothing to compare with.
        if (zone) {
          const taken: Array<[string, string, string]> = [
            ["a network", names.network, "global/networks"],
            ["a subnet", names.subnet, `regions/${region}/subnetworks`],
            ["a firewall rule", names.firewall, "global/firewalls"],
            ["a fixed address", names.address, `regions/${region}/addresses`],
            ["a virtual machine", names.machine, `zones/${zone}/instances`],
            ["a disk", names.disk, `zones/${zone}/disks`],
          ];

          for (const [what, name, collection] of taken) {
            if (await find(client, `${collection}/${encodeURIComponent(name)}`, `look up the name ${name}`)) problems.push({ message: `There's already ${what} called “${name}” in the project “${client.project}”.`, fix: "Choose another short name." });
          }
        }
        const dns = await cloudflareDns(ctx, input.addresses);

        if (dns) {
          for (const host of hosts) {
            if ((await recordsNamed(ctx, dns.key, dns.zone.id, host)).length > 0) problems.push({ message: `There's already a DNS record for ${host} on Cloudflare.`, fix: "Choose another address, or delete that record on Cloudflare first." });
          }
        }
        const resources: HostedResource[] = [
          { kind: "network", id: "", name: names.network, detail: "A network of its own for the editor, apart from anything else in the project" },
          { kind: "subnet", id: "", name: names.subnet, detail: `Its one subnet (${SUBNET_RANGE}), in ${place}` },
          { kind: "firewall-rule", id: "", name: names.firewall, detail: "Lets the web in on ports 80 and 443, to the editor's virtual machine only — no other port, no SSH" },
          { kind: "address", id: "", name: names.address, detail: `A fixed address in ${place}, so the three names keep pointing at the editor` },
          {
            kind: "machine",
            id: "",
            name: names.machine,
            detail: `A virtual machine with ${GCP_SIZES[size].memory} of memory (${size}), Ubuntu 24.04, in ${place}; it installs Docker and starts the editor with Caddy for HTTPS by itself`,
          },
          { kind: "disk", id: "", name: names.disk, detail: `A ${GCP_DISK_GB} GB disk for everything the editor keeps; it goes with the virtual machine` },
          ...(dns ? hosts.map((host) => ({ kind: "dns-record", id: "", name: host, detail: `${host} → the editor's fixed address (DNS only), on Cloudflare` })) : []),
        ];

        return { resources, cost: gcpCost(size), steps: dns ? [] : dnsSteps(input.addresses, null), files: [], problems };
      });
    },

    create(ctx, input) {
      return guarded(async () => {
        const client = await gcpClient(ctx);
        const { request, plan } = input;
        const region = request.options?.region?.trim() || GCP_DEFAULT_REGION;
        const size = sizeOf(request.options);
        const names = gcpNames(request.name);
        const description = recordComment(request.name);
        const labels = { [GCP_LABEL]: request.name };
        const place = regionName(region);
        const networkId = `global/networks/${names.network}`;
        const subnetId = `regions/${region}/subnetworks/${names.subnet}`;

        input.onProgress({ detail: "Looking up the region on Google Cloud…", progress: 0.02 });
        const zone = zoneOf(await ok<GcpNamed>(client, "GET", `regions/${encodeURIComponent(region)}`, "look up the region"), region);

        input.onProgress({ detail: "Making the editor's network…", progress: 0.05 });
        await change(ctx, client, "POST", "global/networks", "make the editor's network", {
          json: { name: names.network, description, autoCreateSubnetworks: false },
          name: names.network,
          what: "a network",
          onAccepted: () => input.onResource({ kind: "network", id: networkId, name: names.network, detail: "A network of its own" }),
        });
        input.onProgress({ detail: "Making its subnet…", progress: 0.15 });
        await change(ctx, client, "POST", `regions/${encodeURIComponent(region)}/subnetworks`, "make the editor's subnet", {
          json: { name: names.subnet, description, network: project(client, networkId), ipCidrRange: SUBNET_RANGE },
          name: names.subnet,
          what: "a subnet",
          onAccepted: () => input.onResource({ kind: "subnet", id: subnetId, name: names.subnet, detail: `${SUBNET_RANGE} in ${region}` }),
        });
        input.onProgress({ detail: "Opening the web ports to it…", progress: 0.25 });
        await change(ctx, client, "POST", "global/firewalls", "open the web ports to the editor", {
          json: {
            name: names.firewall,
            description,
            network: project(client, networkId),
            direction: "INGRESS",
            priority: 1000,
            sourceRanges: ["0.0.0.0/0"],
            targetTags: [names.tag],
            allowed: [
              { IPProtocol: "tcp", ports: ["80", "443"] },
              { IPProtocol: "udp", ports: ["443"] },
            ],
          },
          name: names.firewall,
          what: "a firewall rule",
          onAccepted: () => input.onResource({ kind: "firewall-rule", id: `global/firewalls/${names.firewall}`, name: names.firewall, detail: "Ports 80 and 443, to the editor only" }),
        });
        input.onProgress({ detail: "Reserving its fixed address…", progress: 0.35 });
        const addressId = `regions/${region}/addresses/${names.address}`;

        await change(ctx, client, "POST", `regions/${encodeURIComponent(region)}/addresses`, "reserve the editor's fixed address", {
          json: { name: names.address, description, addressType: "EXTERNAL", networkTier: "PREMIUM", labels },
          name: names.address,
          what: "a fixed address",
          onAccepted: () => input.onResource({ kind: "address", id: addressId, name: names.address, detail: `Reserved in ${region}` }),
        });
        let reserved = await ok<GcpNamed>(client, "GET", addressId, "read the editor's fixed address");

        // Google documents labels on an address as set with setLabels only: set them so when insert didn't.
        if (!labelled(reserved.labels, request.name)) {
          await change(ctx, client, "POST", `${addressId}/setLabels`, "label the editor's fixed address", { json: { labels: { ...(reserved.labels ?? {}), ...labels }, labelFingerprint: reserved.labelFingerprint } });
          reserved = await ok<GcpNamed>(client, "GET", addressId, "read the editor's fixed address");
        }
        const ip = reserved.address;

        if (!ip || !IPV4.test(ip)) throw new HostingError("host", "Google Cloud didn't say which address it reserved. Remove what was made here and try again.", "GET address returned no address");
        input.onProgress({ detail: "Making the virtual machine…", progress: 0.45 });
        const machineId = `zones/${zone}/instances/${names.machine}`;
        const script = gcpStartupScript({ name: request.name, addresses: plan.addresses, image: plan.image, environment: input.environment, size });

        await change(ctx, client, "POST", `zones/${encodeURIComponent(zone)}/instances`, "make the virtual machine", {
          json: {
            name: names.machine,
            description,
            machineType: `zones/${zone}/machineTypes/${size}`,
            labels,
            tags: { items: [names.tag] },
            disks: [
              {
                boot: true,
                autoDelete: true,
                initializeParams: { diskName: names.disk, sourceImage: GCP_IMAGE, diskSizeGb: String(GCP_DISK_GB), diskType: `zones/${zone}/diskTypes/pd-balanced`, labels },
              },
            ],
            networkInterfaces: [{ subnetwork: project(client, subnetId), accessConfigs: [{ type: "ONE_TO_ONE_NAT", name: "External NAT", natIP: ip, networkTier: "PREMIUM" }] }],
            metadata: { items: [{ key: "startup-script", value: script }] },
            // No service account: nothing on the machine may act on the project.
            serviceAccounts: [],
            shieldedInstanceConfig: { enableSecureBoot: true, enableVtpm: true, enableIntegrityMonitoring: true },
          },
          name: names.machine,
          what: "a virtual machine",
          onAccepted: async () => {
            await input.onResource({ kind: "machine", id: machineId, name: names.machine, detail: `${size} in ${zone}, at ${ip}` });
            await input.onResource({ kind: "disk", id: `zones/${zone}/disks/${names.disk}`, name: names.disk, detail: `${GCP_DISK_GB} GB in ${zone}` });
          },
        });
        input.onProgress({ detail: `Waiting for the virtual machine to start in ${place}…`, progress: 0.7 });
        await waitRunning(ctx, client, machineId);
        if (plan.resources.some((resource) => resource.kind === "dns-record")) {
          const dns = await cloudflareDns(ctx, plan.addresses);

          if (!dns) throw new HostingError("permission", "The Cloudflare key can no longer add the DNS names. Add them by hand (see the steps), or paste a key with Zone › DNS › Edit and remove and create again.");
          for (const [index, host] of [plan.addresses.editor, plan.addresses.preview, plan.addresses.live].entries()) {
            input.onProgress({ detail: `Adding the DNS name ${host} on Cloudflare…`, progress: 0.8 + index * 0.05 });
            const record = await createRecord(ctx, dns.key, dns.zone, { type: "A", name: host, content: ip, proxied: false, comment: recordComment(request.name) });

            await input.onResource({ kind: "dns-record", id: recordResourceId(dns.zone.id, record.id), name: host, detail: `${host} → ${ip}, on ${dns.zone.name}` });
          }
        }
        input.onProgress({ detail: "Everything is created on Google Cloud. The virtual machine is installing Docker and starting the editor (a few minutes).", progress: 1 });
      });
    },

    async pending(_ctx, record) {
      return { steps: record.resources.some((resource) => resource.kind === "dns-record") ? [] : dnsSteps(record.addresses, addressOf(record)), files: [] };
    },

    upgrade(ctx, record, input) {
      return guarded(async () => {
        const client = await gcpClient(ctx);
        const machine = record.resources.find((resource) => resource.kind === "machine");

        if (!machine) throw new HostingError("not-found", "The editor's virtual machine isn't in this computer's record, so it can't be upgraded from here.");
        const script = gcpStartupScript({ name: record.name, addresses: record.addresses, image: input.image, ...(record.environment ? { environment: record.environment } : {}), size: sizeOf(record.options) });

        input.onProgress({ detail: `Putting ${input.image} into the virtual machine's startup script…`, progress: 0.1 });
        for (let attempt = 0; ; attempt += 1) {
          const current = await ok<GcpInstance>(client, "GET", machine.id, "read the virtual machine");

          if (!labelled(current.labels, record.name)) throw new HostingError("invalid", "The virtual machine's label in Google Cloud was changed, so it may belong to something else now. Nothing was changed.");
          const items = [...(current.metadata?.items ?? []).filter((item) => item.key !== "startup-script"), { key: "startup-script", value: script }];
          const path = project(client, `${machine.id}/setMetadata`);
          const response = await client.call<GcpOperation>("gcp-compute", "POST", path, { json: { fingerprint: current.metadata?.fingerprint, items } });

          // A stale fingerprint: someone changed the metadata meanwhile. Read it again, once.
          if ((response.status === 412 || response.status === 409) && attempt === 0) continue;
          if (!response.ok) throw gcpFailure(response, "POST", path, "move the editor to the new version", { project: client.project, email: client.key.client_email });
          await waitOperation(ctx, client, response.body ?? {}, "move the editor to the new version", {});
          break;
        }
        // Stop, then start: a stop shuts the machine down cleanly; a reset would cut off a publish in progress.
        input.onProgress({ detail: "Stopping the virtual machine…", progress: 0.3 });
        await change(ctx, client, "POST", `${machine.id}/stop`, "stop the virtual machine");
        input.onProgress({ detail: "Starting it again with the new version, on the same disk…", progress: 0.6 });
        await change(ctx, client, "POST", `${machine.id}/start`, "start the virtual machine");
        await waitRunning(ctx, client, machine.id);
      });
    },

    backup(ctx, record) {
      return guarded(async () => {
        const client = await gcpClient(ctx);
        const machine = record.resources.find((resource) => resource.kind === "machine");

        if (!machine) throw new HostingError("not-found", "The editor's virtual machine isn't in this computer's record, so its disk can't be copied from here.");
        const current = await ok<GcpInstance>(client, "GET", machine.id, "read the virtual machine");
        const disk = current.disks?.find((entry) => entry.boot)?.source;

        if (!disk) throw new HostingError("host", "Google Cloud didn't say which disk the virtual machine uses, so nothing was copied.", "GET instance returned no boot disk");
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15).toLowerCase();
        const name = `${record.name}-${stamp}`;

        await change(ctx, client, "POST", "global/snapshots", "copy the editor's disk", {
          json: { name, description: recordComment(record.name), sourceDisk: `projects/${client.project}/${disk.slice(disk.indexOf("zones/"))}`, labels: { [GCP_LABEL]: record.name } },
          name,
          what: "a snapshot",
        });
        return {
          kind: "snapshot",
          snapshot: name,
          message: `Google Cloud copied the editor's disk as the snapshot “${name}”. It stays until you delete it (Compute Engine › Snapshots in the Google Cloud console) and costs a little each month for its size; removing the editor here leaves it. To keep a copy of your own, download a backup from the editor's Install page.`,
        };
      });
    },

    removal(ctx, record) {
      return guarded(async () => {
        const client = await gcpClient(ctx);
        const resources: HostedResource[] = [];
        const skipped: Array<{ resource: HostedResource; reason: string }> = [];
        const keep = (resource: HostedResource, reason: string): void => {
          skipped.push({ resource, reason });
        };
        const gone = (resource: HostedResource) => keep(resource, "It's already gone.");
        const name = record.name;
        const description = recordComment(name);
        const ip = addressOf(record);
        const ours = (kind: string) => record.resources.find((resource) => resource.kind === kind);
        const kept = new Set<string>();
        const leavingMachine = { value: false };
        const machine = ours("machine");
        const subnet = ours("subnet");
        const network = ours("network");

        const check = async (resource: HostedResource): Promise<void> => {
          if (resource.kind === "dns-record") {
            const ids = splitRecordId(resource.id);
            const cfKey = await ctx.secret("cloudflare");

            if (!ids || !cfKey) return keep(resource, "There's no Cloudflare key on this computer to check it with, so it was left alone.");
            const found = await readRecord(ctx, cfKey, ids.zoneId, ids.recordId);

            if (!found) return gone(resource);
            if (found.comment !== recordComment(name)) return keep(resource, "Its note on Cloudflare was changed, so it may belong to something else now.");
            if (found.name !== resource.name || (ip && found.content !== ip)) return keep(resource, "It points somewhere else now.");
            return void resources.push(resource);
          }
          const current = await find<GcpNamed & GcpInstance>(client, resource.id, `read ${resource.name}`);

          if (!current) return gone(resource);
          if (current.name !== resource.name) return keep(resource, `It's called “${current.name ?? ""}” now, so it was changed after it was created.`);
          if (resource.kind === "machine") {
            if (!labelled(current.labels, name)) return keep(resource, "Its label in Google Cloud was changed, so it may belong to something else now.");
            leavingMachine.value = true;
          } else if (resource.kind === "disk") {
            if (!labelled(current.labels, name)) return keep(resource, "Its label in Google Cloud was changed, so it may belong to something else now.");
            const others = (current.users ?? []).filter((user) => !(machine && leavingMachine.value && user.endsWith(`/${machine.id}`)));

            if (others.length) return keep(resource, machine && others.some((user) => user.endsWith(`/${machine.id}`)) ? "The virtual machine that uses it was left alone, so its disk is too." : "Another virtual machine uses it now.");
          } else if (resource.kind === "address") {
            if (!labelled(current.labels, name)) return keep(resource, "Its label in Google Cloud was changed, so it may belong to something else now.");
            const others = (current.users ?? []).filter((user) => !(machine && leavingMachine.value && user.endsWith(`/${machine.id}`)));

            if (others.length) return keep(resource, machine && others.some((user) => user.endsWith(`/${machine.id}`)) ? "The virtual machine that uses it was left alone, so its address is too." : "Something else uses it now.");
          } else if (resource.kind === "firewall-rule") {
            if (kept.has("machine")) return keep(resource, "The virtual machine it lets the web in to was left alone, so this rule is too.");
            if (current.description !== description) return keep(resource, "Its description in Google Cloud was changed, so it may belong to something else now.");
            if (network && !current.network?.endsWith(`/${network.id}`)) return keep(resource, "It belongs to another network now.");
          } else if (resource.kind === "subnet") {
            if (kept.has("machine")) return keep(resource, "The virtual machine in it was left alone, so the subnet is too.");
            if (current.description !== description) return keep(resource, "Its description in Google Cloud was changed, so it may belong to something else now.");
            const aggregated = await ok<{ items?: Record<string, { instances?: GcpInstance[] }> }>(client, "GET", "aggregated/instances", "list the project's virtual machines");
            const strangers = Object.values(aggregated.items ?? {})
              .flatMap((scope) => scope.instances ?? [])
              .filter((instance) => (instance.networkInterfaces ?? []).some((nic) => nic.subnetwork?.endsWith(`/${resource.id}`)))
              .filter((instance) => !(leavingMachine.value && instance.name === machine?.name));

            if (strangers.length) return keep(resource, `It now also holds ${strangers.map((instance) => `the virtual machine “${instance.name ?? ""}”`).join(" and ")}, which wasn't created here.`);
          } else if (resource.kind === "network") {
            if (current.description !== description) return keep(resource, "Its description in Google Cloud was changed, so it may belong to something else now.");
            if (kept.has("subnet") || kept.has("firewall-rule") || kept.has("machine")) return keep(resource, "Something in it was left alone, so the network is too: it can only go once everything in it is gone.");
            const ourRule = ours("firewall-rule");
            const foreignSubnets = (current.subnetworks ?? []).filter((url) => !(subnet && url.endsWith(`/${subnet.id}`)));
            const firewalls = await ok<{ items?: Array<{ name?: string; network?: string }> }>(client, "GET", "global/firewalls", "list the project's firewall rules");
            const foreignRules = (firewalls.items ?? []).filter((rule) => rule.network?.endsWith(`/${resource.id}`) && rule.name !== ourRule?.name);
            const parts = [...foreignSubnets.map((url) => `a subnet (${lastPart(url)})`), ...foreignRules.map((rule) => `a firewall rule (${rule.name ?? ""})`)];

            if (parts.length) return keep(resource, `It now also holds ${parts.join(" and ")}, which ${parts.length === 1 ? "wasn't" : "weren't"} created here; it can only go once ${parts.length === 1 ? "that is" : "those are"} gone.`);
          } else return keep(resource, "This app doesn't know how to check it, so it was left alone.");
          resources.push(resource);
        };

        // The machine first (whether its disk and address can go depends on it), the network last (it depends on everything in it).
        const order = ["machine", "disk", "address", "dns-record", "firewall-rule", "subnet", "network"];
        const checkOrder = [...record.resources].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

        for (const resource of checkOrder) {
          const before = skipped.length;

          await check(resource);
          if (skipped.length > before && skipped.at(-1)!.reason !== "It's already gone.") kept.add(resource.kind);
        }
        const positions = new Map(record.resources.map((resource, index) => [resource, index]));

        return {
          resources: resources.sort((a, b) => positions.get(a)! - positions.get(b)!),
          skipped,
          kept: [
            "Copies of the editor's disk made with Back up (snapshots): they stay in the project until you delete them in Compute Engine › Snapshots",
            "The Compute Engine API stays on in the project",
          ],
        };
      });
    },

    remove(ctx, record, input) {
      return guarded(async () => {
        const client = await gcpClient(ctx);
        // Newest first, in an order Google accepts: nothing is deleted while something still uses it.
        const order = ["dns-record", "machine", "disk", "address", "firewall-rule", "subnet", "network"];
        const sorted = [...record.resources].reverse().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
        const words: Record<string, string> = {
          machine: "Stopping and deleting the virtual machine (its disk goes with it)…",
          disk: "Deleting the editor's disk…",
          address: "Giving back the fixed address…",
          "firewall-rule": "Closing the web ports (the firewall rule)…",
          subnet: "Deleting the subnet…",
          network: "Deleting the network…",
        };

        for (const resource of sorted) {
          if (resource.kind === "dns-record") {
            const ids = splitRecordId(resource.id);
            const cfKey = await ctx.secret("cloudflare");

            input.onProgress({ detail: `Deleting the DNS name ${resource.name} on Cloudflare…` });
            if (ids && cfKey) await deleteRecord(ctx, cfKey, ids.zoneId, ids.recordId, resource.name);
          } else if (words[resource.kind]) {
            input.onProgress({ detail: words[resource.kind]! });
            await remove(ctx, client, resource.id, `delete ${resource.name}`);
          } else continue;
          await input.onRemoved(resource);
        }
      });
    },
  };
}
