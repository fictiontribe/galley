/**
 * Fake Google Cloud: the OAuth token endpoint, Cloud Resource Manager's
 * testIamPermissions and the Compute Engine v1 calls the `gcp` host makes —
 * strict the way Google documents them (research note: /docs/cloud-install.md
 * › Google Cloud):
 *  - the token endpoint verifies the JWT's RS256 signature against the test
 *    key, its `kid`, issuer, audience (always https://oauth2.googleapis.com/token),
 *    scope and lifetime (at most an hour), and answers 400 invalid_grant;
 *  - a missing, unknown or expired access token is a 401; an unknown path a
 *    404; a wrong method a 405; a missing or malformed field a 400; a name
 *    already taken a 409; deleting what doesn't exist a 404; deleting what
 *    something still uses (a network with a subnet or a firewall rule, a
 *    subnet with a machine, an address in use, a disk attached) a 400
 *    RESOURCE_IN_USE_BY_ANOTHER_RESOURCE; a stale metadata or label
 *    fingerprint a 412 conditionNotMet; a missing permission a 403
 *    "Required '<permission>' permission"; a disabled API a 403 with
 *    ErrorInfo SERVICE_DISABLED and its activation URL;
 *  - every change answers with an Operation that is PENDING, then RUNNING,
 *    then DONE on later polls; what it creates exists at once but can't be
 *    used by another call until its operation is DONE (400 resourceNotReady),
 *    and what it deletes goes only when its operation is DONE;
 *  - labels on an address are ignored on insert and set only by setLabels,
 *    the stricter reading of Google's words.
 * Every call is recorded — never a token, never the assertion.
 */
import { createPublicKey, createVerify, generateKeyPairSync, randomBytes, randomUUID, type KeyObject } from "node:crypto";
import { startFake, type FakeReply, type FakeServer } from "../../deploy/fakes/common";

export const FAKE_PROJECT = "example-project";
const AUDIENCE = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const LINK = "https://www.googleapis.com/compute/v1";
const NAME = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const LABEL_KEY = /^[a-z][a-z0-9_-]{0,62}$/;
const LABEL_VALUE = /^[a-z0-9_-]{0,63}$/;
const MACHINE_TYPES = ["e2-micro", "e2-small", "e2-medium", "e2-standard-2"];
const IMAGES = /^(?:https:\/\/(?:www|compute)\.googleapis\.com\/compute\/v1\/)?projects\/ubuntu-os-cloud\/global\/images\/family\/ubuntu-(?:2404|2604)-lts-amd64$/;

export interface TestServiceAccountKey {
  /** The key file's text, as Google downloads it (pretty-printed, with `\n` escapes in the private key). */
  json: string;
  publicKey: KeyObject;
  privateKeyId: string;
  email: string;
  project: string;
}

let memo: TestServiceAccountKey | null = null;

/** A made-up service account key: a fresh RSA key pair, made once per test run. */
export function testServiceAccountKey(project = FAKE_PROJECT): TestServiceAccountKey {
  if (memo && memo.project === project) return memo;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyId = `fakekeyid${randomBytes(16).toString("hex")}`;
  const email = `editor-maker@${project}.iam.gserviceaccount.com`;
  const file = {
    type: "service_account",
    project_id: project,
    private_key_id: privateKeyId,
    private_key: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    client_email: email,
    client_id: "100000000000000000001",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: AUDIENCE,
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(email)}`,
    universe_domain: "googleapis.com",
  };

  memo = { json: `${JSON.stringify(file, null, 2)}\n`, publicKey: createPublicKey(privateKey), privateKeyId, email, project };
  return memo;
}

interface Base {
  name: string;
  id: string;
  /** Its creating operation is DONE. */
  ready: boolean;
  /** A delete was accepted; it goes when that operation is DONE. */
  deleting: boolean;
  description?: string;
  creationTimestamp: string;
}

export interface FakeGcpNetwork extends Base {
  autoCreateSubnetworks: boolean;
}
export interface FakeGcpSubnet extends Base {
  region: string;
  network: string;
  ipCidrRange: string;
}
export interface FakeGcpFirewall extends Base {
  network: string;
  direction: string;
  priority: number;
  sourceRanges: string[];
  targetTags: string[];
  allowed: Array<{ IPProtocol: string; ports?: string[] }>;
}
export interface FakeGcpAddress extends Base {
  region: string;
  address: string;
  status: "RESERVED" | "IN_USE";
  users: string[];
  labels: Record<string, string>;
  labelFingerprint: string;
}
export interface FakeGcpDisk extends Base {
  zone: string;
  sizeGb: string;
  type: string;
  labels: Record<string, string>;
  users: string[];
}
export interface FakeGcpInstance extends Base {
  zone: string;
  machineType: string;
  status: "PROVISIONING" | "STAGING" | "RUNNING" | "STOPPING" | "TERMINATED";
  labels: Record<string, string>;
  tags: { items: string[]; fingerprint: string };
  metadata: { fingerprint: string; items: Array<{ key: string; value: string }> };
  disks: Array<{ source: string; boot: boolean; autoDelete: boolean; deviceName: string }>;
  networkInterfaces: Array<{ network: string; subnetwork: string; networkIP: string; accessConfigs: Array<{ type: string; name: string; natIP: string; networkTier: string }> }>;
  serviceAccounts: unknown[];
  shieldedInstanceConfig: Record<string, boolean>;
}
export interface FakeGcpSnapshot extends Base {
  sourceDisk: string;
  labels: Record<string, string>;
}

export interface FakeGcpCall {
  method: string;
  path: string;
  status: number;
  /** The JSON body sent; for the token endpoint only its grant_type. */
  body: any;
  at: number;
}

interface FakeOperation {
  name: string;
  scope: string;
  status: "PENDING" | "RUNNING" | "DONE";
  operationType: string;
  targetLink: string;
  targetId: string;
  error?: { errors: Array<{ code: string; message: string }> };
  httpErrorStatusCode?: number;
  done(): void;
}

export interface FakeGcpOptions {
  project?: string;
  key?: TestServiceAccountKey;
  /** The Compute Engine API is off in the project. */
  computeDisabled?: boolean;
  /** The Cloud Resource Manager API is off in the project. */
  resourceManagerDisabled?: boolean;
  /** The permissions the key's service account has (default: every one). */
  granted?: string[];
  /** Fail this call with a 500 (method + path pattern), to stop a create half-way. */
  failOn?: { method: string; path: RegExp };
  /** The operation whose target matches ends with this error (a zone out of room). */
  failOperation?: { target: RegExp; code: string; message: string; status: number };
  /** Echo the Authorization header back in error bodies, like a careless host. */
  echoAuth?: boolean;
  regions?: Array<{ name: string; status: "UP" | "DOWN"; zones: string[] }>;
  port?: number;
  /** Called when a machine starts running; the handle is stopped when it stops or is deleted. */
  launch?: (instance: FakeGcpInstance) => { stop(): void } | void;
}

export interface FakeGcp extends FakeServer {
  project: string;
  key: TestServiceAccountKey;
  /** For GALLEY_HOSTING_<NAME>_API / the hosting service's `api`. */
  apis: Record<"gcp-compute" | "gcp-oauth" | "gcp-resource-manager", string>;
  calls: FakeGcpCall[];
  /** Calls that change something (not reads, not waiting, not signing in, not the permission check). */
  writes(): FakeGcpCall[];
  /** Every access token issued so far (for checking nothing leaked them). */
  tokens(): string[];
  /** Expire every access token: the next call with one is a 401. */
  expireTokens(): void;
  networks: Map<string, FakeGcpNetwork>;
  subnets: Map<string, FakeGcpSubnet>;
  firewalls: Map<string, FakeGcpFirewall>;
  addresses: Map<string, FakeGcpAddress>;
  instances: Map<string, FakeGcpInstance>;
  disks: Map<string, FakeGcpDisk>;
  snapshots: Map<string, FakeGcpSnapshot>;
  /** Puts a resource there as if made by someone else (ready, not through the API). */
  seed: {
    network(name: string, description?: string): FakeGcpNetwork;
    subnet(region: string, name: string, network: string, description?: string): FakeGcpSubnet;
    address(region: string, name: string, labels?: Record<string, string>): FakeGcpAddress;
    instance(zone: string, name: string, labels: Record<string, string>, subnet?: string): FakeGcpInstance;
  };
}

const error = (code: number, message: string, reason: string, status = "", extra: Record<string, unknown> = {}): FakeReply => ({
  status: code,
  body: { error: { code, message, ...(status ? { status } : {}), errors: [{ message, domain: "global", reason }], ...extra } },
});
const notFound = (resource: string) => error(404, `The resource '${resource}' was not found`, "notFound", "NOT_FOUND", { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RESOURCE_NOT_FOUND" }] });
const exists = (resource: string) => error(409, `The resource '${resource}' already exists`, "alreadyExists", "ALREADY_EXISTS", { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RESOURCE_ALREADY_EXISTS" }] });
const inUse = (type: string, resource: string, by: string) =>
  error(400, `The ${type} resource '${resource}' is already being used by '${by}'`, "resourceInUseByAnotherResource", "", { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RESOURCE_IN_USE_BY_ANOTHER_RESOURCE" }] });
const invalid = (message: string) => error(400, message, "invalid", "INVALID_ARGUMENT");
const notReady = (resource: string) => error(400, `The resource '${resource}' is not ready`, "resourceNotReady");
const stale = () => error(412, "Supplied fingerprint does not match current metadata fingerprint.", "conditionNotMet", "FAILED_PRECONDITION");
const methodNotAllowed = () => error(405, "Method not allowed.", "methodNotAllowed");
const fingerprint = () => randomBytes(8).toString("base64");
const numericId = () => String(BigInt(`0x${randomBytes(7).toString("hex")}`));
const now = () => new Date().toISOString();

function labelsProblem(labels: unknown): string | null {
  if (labels === undefined) return null;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return "labels must be a map of strings";
  for (const [key, value] of Object.entries(labels)) {
    if (!LABEL_KEY.test(key)) return `Invalid label key '${key}'`;
    if (typeof value !== "string" || !LABEL_VALUE.test(value)) return `Invalid label value for '${key}'`;
  }
  return null;
}

function cidr(value: unknown): boolean {
  return typeof value === "string" && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.test(value) && value.split(/[./]/).slice(0, 4).every((part) => Number(part) <= 255) && Number(value.split("/")[1]) <= 32;
}

export async function startFakeGcp(options: FakeGcpOptions = {}): Promise<FakeGcp> {
  const key = options.key ?? testServiceAccountKey(options.project ?? FAKE_PROJECT);
  const project = options.project ?? key.project;
  const granted = new Set(options.granted ?? GRANTED_ALL);
  const regions = options.regions ?? [
    { name: "us-central1", status: "UP" as const, zones: ["us-central1-a", "us-central1-b", "us-central1-c", "us-central1-f"] },
    { name: "europe-west1", status: "UP" as const, zones: ["europe-west1-b", "europe-west1-c", "europe-west1-d"] },
    { name: "us-west1", status: "UP" as const, zones: ["us-west1-a", "us-west1-b", "us-west1-c"] },
    { name: "asia-east1", status: "DOWN" as const, zones: ["asia-east1-a", "asia-east1-b"] },
  ];
  const tokens = new Map<string, number>();
  const calls: FakeGcpCall[] = [];
  const networks = new Map<string, FakeGcpNetwork>();
  const subnets = new Map<string, FakeGcpSubnet>();
  const firewalls = new Map<string, FakeGcpFirewall>();
  const addresses = new Map<string, FakeGcpAddress>();
  const instances = new Map<string, FakeGcpInstance>();
  const disks = new Map<string, FakeGcpDisk>();
  const snapshots = new Map<string, FakeGcpSnapshot>();
  const operations = new Map<string, FakeOperation>();
  const running = new Map<string, { stop(): void }>();
  let nextIp = 10;

  const base = (name: string, description?: string): Base => ({ name, id: numericId(), ready: false, deleting: false, ...(description !== undefined ? { description } : {}), creationTimestamp: now() });
  const link = (path: string) => `${LINK}/projects/${project}/${path}`;
  const zoneRegion = (zone: string) => zone.replace(/-[a-z]$/, "");
  const regionOf = (name: string) => regions.find((region) => region.name === name);
  const zoneKnown = (zone: string) => regions.some((region) => region.zones.includes(zone));

  /** The part of a reference after the project, when it is this project's: "global/networks/x". */
  function ref(value: unknown, pattern: RegExp): string | null {
    if (typeof value !== "string") return null;
    const match = /(?:^|\/)projects\/([^/]+)\/(.+)$/.exec(value);
    const rest = match ? (match[1] === project ? match[2]! : null) : value;

    return rest && pattern.test(rest) ? rest : null;
  }

  const start = (instance: FakeGcpInstance) => {
    instance.status = "RUNNING";
    const handle = options.launch?.(instance);

    if (handle) running.set(`${instance.zone}/${instance.name}`, handle);
  };
  const halt = (instance: FakeGcpInstance) => {
    running.get(`${instance.zone}/${instance.name}`)?.stop();
    running.delete(`${instance.zone}/${instance.name}`);
  };

  function operation(scope: string, type: string, target: string, targetId: string, done: () => void, fail?: () => void): FakeReply {
    const op: FakeOperation = {
      name: `operation-${Date.now()}-${randomUUID().slice(0, 8)}`,
      scope,
      status: "PENDING",
      operationType: type,
      targetLink: link(target),
      targetId,
      done() {
        const failure = options.failOperation && options.failOperation.target.test(target) && type === "insert" ? options.failOperation : null;

        if (failure) {
          op.error = { errors: [{ code: failure.code, message: failure.message }] };
          op.httpErrorStatusCode = failure.status;
          fail?.();
        } else done();
      },
    };

    operations.set(op.name, op);
    return { status: 200, body: shown(op) };
  }

  function shown(op: FakeOperation) {
    const [kind, where] = op.scope.split("/");

    return {
      kind: "compute#operation",
      id: numericId(),
      name: op.name,
      operationType: op.operationType,
      status: op.status,
      targetLink: op.targetLink,
      targetId: op.targetId,
      ...(kind === "zones" ? { zone: link(`zones/${where}`) } : kind === "regions" ? { region: link(`regions/${where}`) } : {}),
      selfLink: link(`${op.scope}/operations/${op.name}`),
      ...(op.status === "DONE" && op.error ? { error: op.error, httpErrorStatusCode: op.httpErrorStatusCode, httpErrorMessage: "ERROR" } : {}),
    };
  }

  function advance(op: FakeOperation): void {
    if (op.status === "PENDING") op.status = "RUNNING";
    else if (op.status === "RUNNING") {
      op.status = "DONE";
      op.done();
    }
  }

  const permit = (permission: string, resource: string): FakeReply | null =>
    granted.has(permission) ? null : error(403, `Required '${permission}' permission for '${resource}'`, "forbidden", "PERMISSION_DENIED");

  const disabled = (service: string, title: string): FakeReply => {
    const url = `https://console.developers.google.com/apis/api/${service}/overview?project=${project}`;

    return error(403, `${title} has not been used in project ${project} before or it is disabled. Enable it by visiting ${url} then retry. If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry.`, "accessNotConfigured", "PERMISSION_DENIED", {
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com", metadata: { service, consumer: `projects/${project}`, activationUrl: url } }],
    });
  };

  // ───────────────────────────── shapes as Google returns them

  const networkView = (network: FakeGcpNetwork) => ({
    kind: "compute#network",
    id: network.id,
    name: network.name,
    description: network.description,
    autoCreateSubnetworks: network.autoCreateSubnetworks,
    subnetworks: [...subnets.values()].filter((subnet) => subnet.network === `global/networks/${network.name}`).map((subnet) => link(`regions/${subnet.region}/subnetworks/${subnet.name}`)),
    selfLink: link(`global/networks/${network.name}`),
    creationTimestamp: network.creationTimestamp,
  });
  const subnetView = (subnet: FakeGcpSubnet) => ({ kind: "compute#subnetwork", id: subnet.id, name: subnet.name, description: subnet.description, network: link(subnet.network), ipCidrRange: subnet.ipCidrRange, region: link(`regions/${subnet.region}`), selfLink: link(`regions/${subnet.region}/subnetworks/${subnet.name}`) });
  const firewallView = (rule: FakeGcpFirewall) => ({ kind: "compute#firewall", id: rule.id, name: rule.name, description: rule.description, network: link(rule.network), direction: rule.direction, priority: rule.priority, sourceRanges: rule.sourceRanges, targetTags: rule.targetTags, allowed: rule.allowed, selfLink: link(`global/firewalls/${rule.name}`) });
  const addressView = (address: FakeGcpAddress) => ({
    kind: "compute#address",
    id: address.id,
    name: address.name,
    description: address.description,
    address: address.address,
    addressType: "EXTERNAL",
    networkTier: "PREMIUM",
    status: address.ready ? address.status : "RESERVING",
    users: address.users,
    labels: address.labels,
    labelFingerprint: address.labelFingerprint,
    region: link(`regions/${address.region}`),
    selfLink: link(`regions/${address.region}/addresses/${address.name}`),
  });
  const diskView = (disk: FakeGcpDisk) => ({ kind: "compute#disk", id: disk.id, name: disk.name, sizeGb: disk.sizeGb, type: link(`zones/${disk.zone}/diskTypes/${disk.type}`), labels: disk.labels, users: disk.users, zone: link(`zones/${disk.zone}`), selfLink: link(`zones/${disk.zone}/disks/${disk.name}`), status: disk.ready ? "READY" : "CREATING" });
  const instanceView = (instance: FakeGcpInstance) => ({
    kind: "compute#instance",
    id: instance.id,
    name: instance.name,
    description: instance.description,
    zone: link(`zones/${instance.zone}`),
    machineType: link(`zones/${instance.zone}/machineTypes/${instance.machineType}`),
    status: instance.status,
    labels: instance.labels,
    tags: instance.tags,
    metadata: { kind: "compute#metadata", ...instance.metadata },
    disks: instance.disks,
    networkInterfaces: instance.networkInterfaces,
    serviceAccounts: instance.serviceAccounts,
    shieldedInstanceConfig: instance.shieldedInstanceConfig,
    selfLink: link(`zones/${instance.zone}/instances/${instance.name}`),
  });
  const snapshotView = (snapshot: FakeGcpSnapshot) => ({ kind: "compute#snapshot", id: snapshot.id, name: snapshot.name, description: snapshot.description, sourceDisk: link(snapshot.sourceDisk), labels: snapshot.labels, status: snapshot.ready ? "READY" : "CREATING", selfLink: link(`global/snapshots/${snapshot.name}`) });

  function metadataProblem(metadata: any): string | null {
    if (metadata === undefined) return null;
    if (!metadata || !Array.isArray(metadata.items ?? [])) return "metadata.items must be a list";
    const seen = new Set<string>();

    for (const item of metadata.items ?? []) {
      if (typeof item?.key !== "string" || !/^[a-zA-Z0-9-_]{1,127}$/.test(item.key)) return "metadata keys must match [a-zA-Z0-9-_]+ and be under 128 bytes";
      if (typeof item.value !== "string") return `metadata.${item.key} must be a string`;
      if (seen.has(item.key)) return `metadata key '${item.key}' is given twice`;
      seen.add(item.key);
      if (item.key === "startup-script" && Buffer.byteLength(item.value) > 256 * 1024) return "startup-script is larger than 256 KB";
    }
    return null;
  }

  // ───────────────────────────── Compute Engine

  async function compute(method: string, rest: string[], body: any, query: URLSearchParams): Promise<FakeReply> {
    if (rest[0] !== "projects" || !rest[1]) return error(404, "The requested URL was not found on this server.", "notFound");
    if (rest[1] !== project) return error(403, `Required 'compute.projects.get' permission for 'projects/${rest[1]}'`, "forbidden", "PERMISSION_DENIED");
    if (options.computeDisabled) return disabled("compute.googleapis.com", "Compute Engine API");
    const [scope, where, kind, name, action, extra] = rest.slice(2);
    const path = rest.slice(2).join("/");

    // ── operations
    if ((scope === "global" && where === "operations") || ((scope === "zones" || scope === "regions") && kind === "operations")) {
      const opName = scope === "global" ? kind : name;
      const verb = scope === "global" ? name : action;
      const opScope = scope === "global" ? "global" : `${scope}/${where}`;
      const op = opName ? operations.get(opName) : undefined;

      if (!op || op.scope !== opScope) return notFound(`projects/${project}/${opScope}/operations/${opName ?? ""}`);
      if (verb === "wait" && method === "POST") {
        advance(op);
        return { status: 200, body: shown(op) };
      }
      if (verb === undefined && method === "GET") {
        advance(op);
        return { status: 200, body: shown(op) };
      }
      return methodNotAllowed();
    }
    // ── regions
    if (scope === "regions" && where === undefined) {
      if (method !== "GET") return methodNotAllowed();
      return { status: 200, body: { kind: "compute#regionList", items: regions.map((region) => ({ kind: "compute#region", name: region.name, description: region.name, status: region.status, zones: region.zones.map((zone) => link(`zones/${zone}`)), selfLink: link(`regions/${region.name}`) })) } };
    }
    if (scope === "regions" && kind === undefined) {
      if (method !== "GET") return methodNotAllowed();
      const region = regionOf(where!);

      return region ? { status: 200, body: { kind: "compute#region", name: region.name, description: region.name, status: region.status, zones: region.zones.map((zone) => link(`zones/${zone}`)) } } : notFound(`projects/${project}/regions/${where}`);
    }
    if (scope === "aggregated" && where === "instances" && kind === undefined) {
      if (method !== "GET") return methodNotAllowed();
      const items: Record<string, { instances: unknown[] }> = {};

      for (const instance of instances.values()) (items[`zones/${instance.zone}`] ??= { instances: [] }).instances.push(instanceView(instance));
      return { status: 200, body: { kind: "compute#instanceAggregatedList", items } };
    }
    // ── networks
    if (scope === "global" && where === "networks") {
      if (kind === undefined) {
        if (method === "GET") return { status: 200, body: { items: [...networks.values()].map(networkView) } };
        if (method !== "POST") return methodNotAllowed();
        const denied = permit("compute.networks.create", `projects/${project}/global/networks/${body?.name ?? ""}`);

        if (denied) return denied;
        if (typeof body?.name !== "string" || !NAME.test(body.name)) return invalid("Invalid value for field 'resource.name': must be 1-63 characters, matching [a-z]([-a-z0-9]*[a-z0-9])?");
        if (typeof body.autoCreateSubnetworks !== "boolean") return invalid("Invalid value for field 'resource.autoCreateSubnetworks': legacy networks are not supported; set it to true or false.");
        if (networks.has(body.name)) return exists(`projects/${project}/global/networks/${body.name}`);
        const network: FakeGcpNetwork = { ...base(body.name, body.description), autoCreateSubnetworks: body.autoCreateSubnetworks };

        networks.set(network.name, network);
        return operation("global", "insert", `global/networks/${network.name}`, network.id, () => (network.ready = true), () => networks.delete(network.name));
      }
      const network = networks.get(kind);

      if (name !== undefined) return error(404, "The requested URL was not found on this server.", "notFound");
      if (!network) return notFound(`projects/${project}/global/networks/${kind}`);
      if (method === "GET") return { status: 200, body: networkView(network) };
      if (method !== "DELETE") return methodNotAllowed();
      const denied = permit("compute.networks.delete", `projects/${project}/global/networks/${kind}`);

      if (denied) return denied;
      const subnet = [...subnets.values()].find((entry) => entry.network === `global/networks/${kind}`);
      const rule = [...firewalls.values()].find((entry) => entry.network === `global/networks/${kind}`);

      if (subnet) return inUse("network", `projects/${project}/global/networks/${kind}`, `projects/${project}/regions/${subnet.region}/subnetworks/${subnet.name}`);
      if (rule) return inUse("network", `projects/${project}/global/networks/${kind}`, `projects/${project}/global/firewalls/${rule.name}`);
      network.deleting = true;
      return operation("global", "delete", `global/networks/${kind}`, network.id, () => networks.delete(network.name));
    }
    // ── firewall rules
    if (scope === "global" && where === "firewalls") {
      if (kind === undefined) {
        if (method === "GET") return { status: 200, body: { items: [...firewalls.values()].map(firewallView) } };
        if (method !== "POST") return methodNotAllowed();
        const denied = permit("compute.firewalls.create", `projects/${project}/global/firewalls/${body?.name ?? ""}`);

        if (denied) return denied;
        if (typeof body?.name !== "string" || !NAME.test(body.name)) return invalid("Invalid value for field 'resource.name'");
        const network = ref(body.network, /^global\/networks\/[^/]+$/);

        if (!network) return invalid("Invalid value for field 'resource.network': a network in this project is required (this fake doesn't fall back to the default network).");
        const target = networks.get(network.split("/")[2]!);

        if (!target || target.deleting) return notFound(`projects/${project}/${network}`);
        if (!target.ready) return notReady(`projects/${project}/${network}`);
        if (body.direction !== undefined && body.direction !== "INGRESS" && body.direction !== "EGRESS") return invalid("Invalid value for field 'resource.direction'");
        if (!Array.isArray(body.allowed) || body.allowed.length === 0) return invalid("Invalid value for field 'resource.allowed': at least one rule is required");
        for (const rule of body.allowed) {
          if (!["tcp", "udp", "icmp", "all"].includes(rule?.IPProtocol)) return invalid("Invalid value for field 'resource.allowed[].IPProtocol'");
          if (rule.ports !== undefined && (!Array.isArray(rule.ports) || rule.ports.some((port: unknown) => typeof port !== "string" || !/^\d{1,5}(?:-\d{1,5})?$/.test(port)))) return invalid("Invalid value for field 'resource.allowed[].ports[]': ports are strings like \"443\" or \"8000-8080\"");
        }
        if (body.sourceRanges !== undefined && (!Array.isArray(body.sourceRanges) || !body.sourceRanges.every(cidr))) return invalid("Invalid value for field 'resource.sourceRanges[]'");
        if (body.targetTags !== undefined && (!Array.isArray(body.targetTags) || body.targetTags.some((tag: unknown) => typeof tag !== "string" || !NAME.test(tag)))) return invalid("Invalid value for field 'resource.targetTags[]'");
        if (body.priority !== undefined && (!Number.isInteger(body.priority) || body.priority < 0 || body.priority > 65535)) return invalid("Invalid value for field 'resource.priority'");
        if (firewalls.has(body.name)) return exists(`projects/${project}/global/firewalls/${body.name}`);
        const rule: FakeGcpFirewall = { ...base(body.name, body.description), network, direction: body.direction ?? "INGRESS", priority: body.priority ?? 1000, sourceRanges: body.sourceRanges ?? [], targetTags: body.targetTags ?? [], allowed: body.allowed };

        firewalls.set(rule.name, rule);
        return operation("global", "insert", `global/firewalls/${rule.name}`, rule.id, () => (rule.ready = true), () => firewalls.delete(rule.name));
      }
      if (name !== undefined) return error(404, "The requested URL was not found on this server.", "notFound");
      const rule = firewalls.get(kind);

      if (!rule) return notFound(`projects/${project}/global/firewalls/${kind}`);
      if (method === "GET") return { status: 200, body: firewallView(rule) };
      if (method !== "DELETE") return methodNotAllowed();
      const denied = permit("compute.firewalls.delete", `projects/${project}/global/firewalls/${kind}`);

      if (denied) return denied;
      rule.deleting = true;
      return operation("global", "delete", `global/firewalls/${kind}`, rule.id, () => firewalls.delete(rule.name));
    }
    // ── snapshots
    if (scope === "global" && where === "snapshots") {
      if (kind === undefined) {
        if (method === "GET") return { status: 200, body: { items: [...snapshots.values()].map(snapshotView) } };
        if (method !== "POST") return methodNotAllowed();
        const denied = permit("compute.snapshots.create", `projects/${project}/global/snapshots/${body?.name ?? ""}`) ?? (body?.labels ? permit("compute.snapshots.setLabels", `projects/${project}/global/snapshots/${body?.name ?? ""}`) : null);

        if (denied) return denied;
        if (typeof body?.name !== "string" || !NAME.test(body.name)) return invalid("Invalid value for field 'resource.name'");
        const source = ref(body.sourceDisk, /^zones\/[^/]+\/disks\/[^/]+$/);

        if (!source) return invalid("Invalid value for field 'resource.sourceDisk'");
        const disk = disks.get(source.replace(/^zones\/([^/]+)\/disks\//, "$1/"));

        if (!disk) return notFound(`projects/${project}/${source}`);
        const problem = labelsProblem(body.labels);

        if (problem) return invalid(problem);
        const createSnapshot = permit("compute.disks.createSnapshot", `projects/${project}/${source}`);

        if (createSnapshot) return createSnapshot;
        if (snapshots.has(body.name)) return exists(`projects/${project}/global/snapshots/${body.name}`);
        const snapshot: FakeGcpSnapshot = { ...base(body.name, body.description), sourceDisk: source, labels: body.labels ?? {} };

        snapshots.set(snapshot.name, snapshot);
        return operation("global", "insert", `global/snapshots/${snapshot.name}`, snapshot.id, () => (snapshot.ready = true), () => snapshots.delete(snapshot.name));
      }
      const snapshot = snapshots.get(kind);

      if (!snapshot || name !== undefined) return notFound(`projects/${project}/global/snapshots/${kind}`);
      if (method === "GET") return { status: 200, body: snapshotView(snapshot) };
      return methodNotAllowed();
    }
    // ── regional: subnets and addresses
    if (scope === "regions" && (kind === "subnetworks" || kind === "addresses")) {
      const region = regionOf(where!);

      if (!region) return notFound(`projects/${project}/regions/${where}`);
      if (kind === "subnetworks") {
        if (name === undefined) {
          if (method === "GET") return { status: 200, body: { items: [...subnets.values()].filter((subnet) => subnet.region === region.name).map(subnetView) } };
          if (method !== "POST") return methodNotAllowed();
          const denied = permit("compute.subnetworks.create", `projects/${project}/regions/${region.name}/subnetworks/${body?.name ?? ""}`);

          if (denied) return denied;
          if (typeof body?.name !== "string" || !NAME.test(body.name)) return invalid("Invalid value for field 'resource.name'");
          const network = ref(body.network, /^global\/networks\/[^/]+$/);

          if (!network) return invalid("Invalid value for field 'resource.network'");
          const target = networks.get(network.split("/")[2]!);

          if (!target || target.deleting) return notFound(`projects/${project}/${network}`);
          if (!target.ready) return notReady(`projects/${project}/${network}`);
          if (target.autoCreateSubnetworks) return invalid("The network is in auto mode: its subnets are made for it.");
          if (!cidr(body.ipCidrRange)) return invalid("Invalid value for field 'resource.ipCidrRange'");
          if (body.region !== undefined && ref(body.region, /^regions\/[^/]+$/) !== `regions/${region.name}`) return invalid("The subnet's region doesn't match the request's.");
          if ([...subnets.values()].some((subnet) => subnet.network === network && subnet.ipCidrRange === body.ipCidrRange)) return invalid(`Invalid IPCidrRange: ${body.ipCidrRange} conflicts with an existing subnetwork.`);
          const key = `${region.name}/${body.name}`;

          if (subnets.has(key)) return exists(`projects/${project}/regions/${region.name}/subnetworks/${body.name}`);
          const subnet: FakeGcpSubnet = { ...base(body.name, body.description), region: region.name, network, ipCidrRange: body.ipCidrRange };

          subnets.set(key, subnet);
          return operation(`regions/${region.name}`, "insert", `regions/${region.name}/subnetworks/${subnet.name}`, subnet.id, () => (subnet.ready = true), () => subnets.delete(key));
        }
        const key = `${region.name}/${name}`;
        const subnet = subnets.get(key);

        if (action !== undefined) return error(404, "The requested URL was not found on this server.", "notFound");
        if (!subnet) return notFound(`projects/${project}/regions/${region.name}/subnetworks/${name}`);
        if (method === "GET") return { status: 200, body: subnetView(subnet) };
        if (method !== "DELETE") return methodNotAllowed();
        const denied = permit("compute.subnetworks.delete", `projects/${project}/regions/${region.name}/subnetworks/${name}`);

        if (denied) return denied;
        const user = [...instances.values()].find((instance) => instance.networkInterfaces.some((nic) => nic.subnetwork === link(`regions/${region.name}/subnetworks/${name}`)));

        if (user) return inUse("subnetwork", `projects/${project}/regions/${region.name}/subnetworks/${name}`, `projects/${project}/zones/${user.zone}/instances/${user.name}`);
        subnet.deleting = true;
        return operation(`regions/${region.name}`, "delete", `regions/${region.name}/subnetworks/${name}`, subnet.id, () => subnets.delete(key));
      }
      // addresses
      if (name === undefined) {
        if (method === "GET") return { status: 200, body: { items: [...addresses.values()].filter((address) => address.region === region.name).map(addressView) } };
        if (method !== "POST") return methodNotAllowed();
        const denied = permit("compute.addresses.create", `projects/${project}/regions/${region.name}/addresses/${body?.name ?? ""}`);

        if (denied) return denied;
        if (typeof body?.name !== "string" || !NAME.test(body.name)) return invalid("Invalid value for field 'resource.name'");
        if (body.addressType !== undefined && !["EXTERNAL", "INTERNAL"].includes(body.addressType)) return invalid("Invalid value for field 'resource.addressType'");
        if (body.networkTier !== undefined && !["PREMIUM", "STANDARD"].includes(body.networkTier)) return invalid("Invalid value for field 'resource.networkTier'");
        const problem = labelsProblem(body.labels);

        if (problem) return invalid(problem);
        const key = `${region.name}/${body.name}`;

        if (addresses.has(key)) return exists(`projects/${project}/regions/${region.name}/addresses/${body.name}`);
        // Labels "can only be added or modified by the setLabels method": not taken from insert.
        const address: FakeGcpAddress = { ...base(body.name, body.description), region: region.name, address: `34.118.${Math.floor(nextIp / 250)}.${(nextIp % 250) + 1}`, status: "RESERVED", users: [], labels: {}, labelFingerprint: fingerprint() };

        nextIp += 1;
        addresses.set(key, address);
        return operation(`regions/${region.name}`, "insert", `regions/${region.name}/addresses/${address.name}`, address.id, () => (address.ready = true), () => addresses.delete(key));
      }
      const key = `${region.name}/${name}`;
      const address = addresses.get(key);

      if (!address) return notFound(`projects/${project}/regions/${region.name}/addresses/${name}`);
      if (action === "setLabels" && extra === undefined) {
        if (method !== "POST") return methodNotAllowed();
        const denied = permit("compute.addresses.setLabels", `projects/${project}/regions/${region.name}/addresses/${name}`);

        if (denied) return denied;
        if (typeof body?.labelFingerprint !== "string") return invalid("Required field 'labelFingerprint' not specified");
        if (body.labelFingerprint !== address.labelFingerprint) return stale();
        const problem = labelsProblem(body.labels ?? {});

        if (problem) return invalid(problem);
        address.labels = { ...(body.labels ?? {}) };
        address.labelFingerprint = fingerprint();
        return operation(`regions/${region.name}`, "setLabels", `regions/${region.name}/addresses/${name}`, address.id, () => undefined);
      }
      if (action !== undefined) return error(404, "The requested URL was not found on this server.", "notFound");
      if (method === "GET") return { status: 200, body: addressView(address) };
      if (method !== "DELETE") return methodNotAllowed();
      const denied = permit("compute.addresses.delete", `projects/${project}/regions/${region.name}/addresses/${name}`);

      if (denied) return denied;
      if (address.users.length) return inUse("address", `projects/${project}/regions/${region.name}/addresses/${name}`, address.users[0]!.replace(`${LINK}/`, ""));
      address.deleting = true;
      return operation(`regions/${region.name}`, "delete", `regions/${region.name}/addresses/${name}`, address.id, () => addresses.delete(key));
    }
    // ── zonal: instances and disks
    if (scope === "zones" && kind === undefined) {
      if (method !== "GET") return methodNotAllowed();
      return zoneKnown(where!) ? { status: 200, body: { kind: "compute#zone", name: where, status: "UP", region: link(`regions/${zoneRegion(where!)}`) } } : notFound(`projects/${project}/zones/${where}`);
    }
    if (scope === "zones" && (kind === "instances" || kind === "disks")) {
      const zone = where!;

      if (!zoneKnown(zone)) return notFound(`projects/${project}/zones/${zone}`);
      if (kind === "disks") {
        if (name === undefined) return method === "GET" ? { status: 200, body: { items: [...disks.values()].filter((disk) => disk.zone === zone).map(diskView) } } : methodNotAllowed();
        const disk = disks.get(`${zone}/${name}`);

        if (!disk || action !== undefined) return notFound(`projects/${project}/zones/${zone}/disks/${name}`);
        if (method === "GET") return { status: 200, body: diskView(disk) };
        if (method !== "DELETE") return methodNotAllowed();
        if (disk.users.length) return inUse("disk", `projects/${project}/zones/${zone}/disks/${name}`, disk.users[0]!.replace(`${LINK}/`, ""));
        disk.deleting = true;
        return operation(`zones/${zone}`, "delete", `zones/${zone}/disks/${name}`, disk.id, () => disks.delete(`${zone}/${name}`));
      }
      if (name === undefined) {
        if (method === "GET") return { status: 200, body: { items: [...instances.values()].filter((instance) => instance.zone === zone).map(instanceView) } };
        if (method !== "POST") return methodNotAllowed();
        return insertInstance(zone, body);
      }
      const key = `${zone}/${name}`;
      const instance = instances.get(key);

      if (!instance) return notFound(`projects/${project}/zones/${zone}/instances/${name}`);
      const target = `zones/${zone}/instances/${name}`;

      if (action === undefined) {
        if (method === "GET") return { status: 200, body: instanceView(instance) };
        if (method !== "DELETE") return methodNotAllowed();
        const denied = permit("compute.instances.delete", `projects/${project}/${target}`);

        if (denied) return denied;
        instance.deleting = true;
        instance.status = "STOPPING";
        return operation(`zones/${zone}`, "delete", target, instance.id, () => {
          halt(instance);
          instances.delete(key);
          for (const attached of instance.disks) {
            const disk = disks.get(attached.source.replace(/^.*\/zones\/([^/]+)\/disks\//, "$1/"));

            if (!disk) continue;
            disk.users = disk.users.filter((user) => user !== link(target));
            if (attached.autoDelete) disks.delete(`${disk.zone}/${disk.name}`);
          }
          for (const address of addresses.values()) {
            address.users = address.users.filter((user) => user !== link(target));
            if (address.users.length === 0) address.status = "RESERVED";
          }
        });
      }
      if (extra !== undefined || method !== "POST") return action && ["setMetadata", "stop", "start", "reset", "setLabels"].includes(action) ? methodNotAllowed() : error(404, "The requested URL was not found on this server.", "notFound");
      if (instance.deleting) return notFound(`projects/${project}/${target}`);
      if (action === "setMetadata") {
        const denied = permit("compute.instances.setMetadata", `projects/${project}/${target}`);

        if (denied) return denied;
        if (typeof body?.fingerprint !== "string") return invalid("Required field 'fingerprint' not specified");
        if (body.fingerprint !== instance.metadata.fingerprint) return stale();
        const problem = metadataProblem(body);

        if (problem) return invalid(problem);
        instance.metadata = { fingerprint: fingerprint(), items: (body.items ?? []).map((item: { key: string; value: string }) => ({ key: item.key, value: item.value })) };
        return operation(`zones/${zone}`, "setMetadata", target, instance.id, () => undefined);
      }
      if (action === "stop") {
        const denied = permit("compute.instances.stop", `projects/${project}/${target}`);

        if (denied) return denied;
        if (instance.status === "RUNNING") instance.status = "STOPPING";
        return operation(`zones/${zone}`, "stop", target, instance.id, () => {
          halt(instance);
          instance.status = "TERMINATED";
        });
      }
      if (action === "start") {
        const denied = permit("compute.instances.start", `projects/${project}/${target}`);

        if (denied) return denied;
        if (instance.status !== "TERMINATED") return invalid(`The instance '${target}' is not stopped (it is ${instance.status}).`);
        instance.status = "STAGING";
        return operation(`zones/${zone}`, "start", target, instance.id, () => start(instance));
      }
      if (action === "reset") {
        return operation(`zones/${zone}`, "reset", target, instance.id, () => {
          halt(instance);
          start(instance);
        });
      }
      return error(404, "The requested URL was not found on this server.", "notFound");
    }
    void path;
    void query;
    return error(404, "The requested URL was not found on this server.", "notFound");
  }

  function insertInstance(zone: string, body: any): FakeReply {
    const target = `zones/${zone}/instances/${body?.name ?? ""}`;
    const denied =
      permit("compute.instances.create", `projects/${project}/${target}`) ??
      permit("compute.subnetworks.use", `projects/${project}/${target}`) ??
      permit("compute.subnetworks.useExternalIp", `projects/${project}/${target}`) ??
      ((body?.networkInterfaces ?? []).some((nic: any) => (nic?.accessConfigs ?? []).some((config: any) => config?.natIP)) ? permit("compute.addresses.use", `projects/${project}/${target}`) : null);

    if (denied) return denied;
    if (typeof body?.name !== "string" || !NAME.test(body.name)) return invalid("Invalid value for field 'resource.name'");
    const type = /^(?:.*\/)?zones\/([^/]+)\/machineTypes\/([^/]+)$/.exec(String(body.machineType ?? ""));

    if (!type) return invalid("Invalid value for field 'resource.machineType': a full or partial URL like zones/ZONE/machineTypes/TYPE is required");
    if (type[1] !== zone) return invalid(`Invalid value for field 'resource.machineType': the machine type's zone ${type[1]} isn't ${zone}`);
    if (!MACHINE_TYPES.includes(type[2]!)) return notFound(`projects/${project}/zones/${zone}/machineTypes/${type[2]}`);
    if (!Array.isArray(body.disks) || body.disks.length !== 1) return invalid("Exactly one disk, the boot disk, is expected here.");
    const bootDisk = body.disks[0];
    const init = bootDisk?.initializeParams;

    if (bootDisk.boot !== true || !init) return invalid("The disk must be a boot disk with initializeParams.");
    if (!IMAGES.test(String(init.sourceImage ?? ""))) return notFound(`The image '${String(init.sourceImage ?? "")}'`);
    const size = Number(init.diskSizeGb ?? 10);

    if (!Number.isInteger(size) || size < 10) return invalid("Invalid value for field 'resource.disks[0].initializeParams.diskSizeGb': at least 10 GB");
    const diskType = /^(?:.*\/)?zones\/([^/]+)\/diskTypes\/(pd-balanced|pd-standard|pd-ssd)$/.exec(String(init.diskType ?? `zones/${zone}/diskTypes/pd-standard`));

    if (!diskType || diskType[1] !== zone) return invalid("Invalid value for field 'resource.disks[0].initializeParams.diskType'");
    const diskName = init.diskName ?? body.name;

    if (!NAME.test(diskName)) return invalid("Invalid value for field 'resource.disks[0].initializeParams.diskName'");
    for (const labels of [body.labels, init.labels]) {
      const problem = labelsProblem(labels);

      if (problem) return invalid(problem);
    }
    if (body.tags !== undefined && (!Array.isArray(body.tags.items) || body.tags.items.some((tag: unknown) => typeof tag !== "string" || !NAME.test(tag)))) return invalid("Invalid value for field 'resource.tags.items[]'");
    const metadataProblemText = metadataProblem(body.metadata);

    if (metadataProblemText) return invalid(metadataProblemText);
    if (body.serviceAccounts !== undefined && !Array.isArray(body.serviceAccounts)) return invalid("Invalid value for field 'resource.serviceAccounts'");
    if (body.shieldedInstanceConfig !== undefined && Object.values(body.shieldedInstanceConfig).some((value) => typeof value !== "boolean")) return invalid("Invalid value for field 'resource.shieldedInstanceConfig'");
    if (!Array.isArray(body.networkInterfaces) || body.networkInterfaces.length !== 1) return invalid("Exactly one network interface is expected here.");
    const nic = body.networkInterfaces[0];
    const subnetRef = ref(nic?.subnetwork, /^regions\/[^/]+\/subnetworks\/[^/]+$/);

    if (!subnetRef) return invalid("Invalid value for field 'resource.networkInterfaces[0].subnetwork': in a custom-mode network the subnet is required");
    const [, subnetRegion, , subnetName] = subnetRef.split("/");
    const subnet = subnets.get(`${subnetRegion}/${subnetName}`);

    if (!subnet || subnet.deleting) return notFound(`projects/${project}/${subnetRef}`);
    if (!subnet.ready) return notReady(`projects/${project}/${subnetRef}`);
    if (subnetRegion !== zoneRegion(zone)) return invalid(`The subnet ${subnetRef} isn't in the zone's region.`);
    const configs = nic.accessConfigs ?? [];

    if (!Array.isArray(configs) || configs.length > 1) return invalid("At most one access config.");
    let address: FakeGcpAddress | undefined;

    if (configs[0]) {
      if ((configs[0].type ?? "ONE_TO_ONE_NAT") !== "ONE_TO_ONE_NAT") return invalid("Invalid value for field 'resource.networkInterfaces[0].accessConfigs[0].type'");
      if (configs[0].natIP) {
        address = [...addresses.values()].find((entry) => entry.address === configs[0].natIP && entry.region === zoneRegion(zone));
        if (!address || address.deleting) return invalid(`The IP address ${configs[0].natIP} isn't a reserved address in ${zoneRegion(zone)}.`);
        if (!address.ready) return notReady(`projects/${project}/regions/${address.region}/addresses/${address.name}`);
        if (address.users.length) return invalid(`IP address '${configs[0].natIP}' is already being used by another resource.`);
      }
    }
    const key = `${zone}/${body.name}`;

    if (instances.has(key)) return exists(`projects/${project}/${target}`);
    if (disks.has(`${zone}/${diskName}`)) return exists(`projects/${project}/zones/${zone}/disks/${diskName}`);
    const selfLink = link(target);
    const disk: FakeGcpDisk = { ...base(diskName), zone, sizeGb: String(size), type: diskType[2]!, labels: init.labels ?? {}, users: [selfLink] };
    const instance: FakeGcpInstance = {
      ...base(body.name, body.description),
      zone,
      machineType: type[2]!,
      status: "PROVISIONING",
      labels: body.labels ?? {},
      tags: { items: body.tags?.items ?? [], fingerprint: fingerprint() },
      metadata: { fingerprint: fingerprint(), items: body.metadata?.items ?? [] },
      disks: [{ source: link(`zones/${zone}/disks/${diskName}`), boot: true, autoDelete: bootDisk.autoDelete !== false, deviceName: diskName }],
      networkInterfaces: [{ network: link(subnet.network), subnetwork: link(`regions/${subnet.region}/subnetworks/${subnet.name}`), networkIP: "10.20.0.2", accessConfigs: configs[0] ? [{ type: "ONE_TO_ONE_NAT", name: configs[0].name ?? "External NAT", natIP: address?.address ?? "35.0.0.1", networkTier: configs[0].networkTier ?? "PREMIUM" }] : [] }],
      serviceAccounts: body.serviceAccounts ?? [{ email: `${numericId()}-compute@developer.gserviceaccount.com`, scopes: ["https://www.googleapis.com/auth/devstorage.read_only"] }],
      shieldedInstanceConfig: body.shieldedInstanceConfig ?? {},
    };

    disks.set(`${zone}/${diskName}`, disk);
    instances.set(key, instance);
    if (address) {
      address.users.push(selfLink);
      address.status = "IN_USE";
    }
    return operation(
      `zones/${zone}`,
      "insert",
      target,
      instance.id,
      () => {
        instance.ready = true;
        disk.ready = true;
        start(instance);
      },
      () => {
        instances.delete(key);
        disks.delete(`${zone}/${diskName}`);
        if (address) {
          address.users = [];
          address.status = "RESERVED";
        }
      }
    );
  }

  // ───────────────────────────── sign-in and the permission check

  function token(form: URLSearchParams): FakeReply {
    const refuse = (description: string) => ({ status: 400, body: { error: "invalid_grant", error_description: description } });

    if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return { status: 400, body: { error: "unsupported_grant_type", error_description: "Invalid grant_type" } };
    const parts = (form.get("assertion") ?? "").split(".");

    if (parts.length !== 3) return refuse("Invalid JWT: Token must be a short-lived token and in a reasonable timeframe");
    let header: any;
    let claims: any;

    try {
      header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
      claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    } catch {
      return refuse("Invalid JWT: can't be parsed");
    }
    if (header.alg !== "RS256" || header.typ !== "JWT") return refuse("Invalid JWT: the only algorithm is RS256");
    const verifier = createVerify("RSA-SHA256");

    verifier.update(`${parts[0]}.${parts[1]}`);
    if (header.kid !== undefined && header.kid !== key.privateKeyId) return refuse("Invalid JWT Signature.");
    if (!verifier.verify(key.publicKey, Buffer.from(parts[2]!, "base64url"))) return refuse("Invalid JWT Signature.");
    if (claims.iss !== key.email) return refuse("Invalid JWT Signature.");
    if (claims.aud !== AUDIENCE) return refuse("Invalid JWT: aud must be https://oauth2.googleapis.com/token");
    if (typeof claims.scope !== "string" || !claims.scope.split(" ").includes(SCOPE)) return { status: 400, body: { error: "invalid_scope", error_description: "Invalid OAuth scope or ID token audience provided." } };
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > nowSeconds + 60 || claims.exp <= nowSeconds || claims.exp - claims.iat > 3600) {
      return refuse("Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values in the JWT claim.");
    }
    const issued = `ya29.fake-${randomBytes(24).toString("base64url")}`;

    tokens.set(issued, Date.now() + 3600_000);
    return { status: 200, body: { access_token: issued, expires_in: 3599, token_type: "Bearer" } };
  }

  function testPermissions(method: string, resource: string, body: any): FakeReply {
    if (method !== "POST") return methodNotAllowed();
    if (options.resourceManagerDisabled) return disabled("cloudresourcemanager.googleapis.com", "Cloud Resource Manager API");
    if (resource !== project) return error(403, "The caller does not have permission", "forbidden", "PERMISSION_DENIED");
    if (!Array.isArray(body?.permissions)) return invalid("permissions is required");
    if (body.permissions.some((permission: unknown) => typeof permission !== "string" || permission.includes("*"))) return invalid("Permissions with wildcards (such as '*' or 'storage.*') are not allowed.");
    const allowed = body.permissions.filter((permission: string) => granted.has(permission));

    return { status: 200, body: allowed.length ? { permissions: allowed } : {} };
  }

  const server = await startFake(
    async (request) => {
      const path = request.url.pathname;
      const method = request.method;
      let body: any = null;
      let recorded: any = null;

      const reply = await (async (): Promise<FakeReply> => {
        if (path === "/token") {
          if (method !== "POST") return methodNotAllowed();
          if (!String(request.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) return { status: 400, body: { error: "invalid_request", error_description: "Expected application/x-www-form-urlencoded" } };
          const form = new URLSearchParams(request.body.toString("utf8"));

          recorded = { grant_type: form.get("grant_type") };
          return token(form);
        }
        if (request.body.length) {
          try {
            body = request.json();
            recorded = body;
          } catch {
            return invalid("Invalid JSON payload received.");
          }
        }
        const bearer = request.bearer;
        const expires = bearer ? tokens.get(bearer) : undefined;

        if (!bearer || expires === undefined || expires <= Date.now()) {
          return { status: 401, body: { error: { code: 401, message: "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.", status: "UNAUTHENTICATED" } } };
        }
        if (options.failOn && options.failOn.method === method && options.failOn.path.test(path)) return error(500, "Internal error. Please try again or contact Google Support.", "backendError");
        const crm = /^\/v1\/projects\/([^/:]+):testIamPermissions$/.exec(path);

        if (crm) return testPermissions(method, crm[1]!, body);
        const parts = path.split("/").filter(Boolean);

        if (parts[0] === "compute" && parts[1] === "v1") return compute(method, parts.slice(2).map(decodeURIComponent), body, request.url.searchParams);
        return error(404, "The requested URL was not found on this server.", "notFound");
      })();

      calls.push({ method, path, status: reply.status, body: recorded, at: performance.now() });
      if (options.echoAuth && reply.status >= 400 && reply.body && typeof reply.body === "object" && (reply.body as any).error?.message) {
        return { ...reply, body: { error: { ...(reply.body as any).error, message: `${(reply.body as any).error.message} (sent: ${request.headers.authorization ?? ""})` } } };
      }
      return reply;
    },
    (bearer) => (bearer === null ? "none" : tokens.has(bearer) ? "account" : "other"),
    options.port
  );

  const ready = <T extends Base>(entry: T): T => Object.assign(entry, { ready: true });

  return {
    ...server,
    project,
    key,
    apis: { "gcp-compute": `${server.url}/compute/v1`, "gcp-oauth": server.url, "gcp-resource-manager": `${server.url}/v1` },
    calls,
    writes: () => calls.filter((call) => call.method !== "GET" && !call.path.endsWith("/wait") && call.path !== "/token" && !call.path.endsWith(":testIamPermissions")),
    tokens: () => [...tokens.keys()],
    expireTokens() {
      for (const issued of tokens.keys()) tokens.set(issued, 0);
    },
    networks,
    subnets,
    firewalls,
    addresses,
    instances,
    disks,
    snapshots,
    seed: {
      network(name, description) {
        const network = ready({ ...base(name, description), autoCreateSubnetworks: false });

        networks.set(name, network);
        return network;
      },
      subnet(region, name, network, description) {
        const subnet = ready({ ...base(name, description), region, network: `global/networks/${network}`, ipCidrRange: `10.99.${subnets.size}.0/24` });

        subnets.set(`${region}/${name}`, subnet);
        return subnet;
      },
      address(region, name, labels = {}) {
        const address = ready({ ...base(name), region, address: `34.118.200.${addresses.size + 1}`, status: "RESERVED" as const, users: [], labels, labelFingerprint: fingerprint() });

        addresses.set(`${region}/${name}`, address);
        return address;
      },
      instance(zone, name, labels, subnet) {
        const region = zoneRegion(zone);
        const instance: FakeGcpInstance = ready({
          ...base(name),
          zone,
          machineType: "e2-small",
          status: "RUNNING" as const,
          labels,
          tags: { items: [], fingerprint: fingerprint() },
          metadata: { fingerprint: fingerprint(), items: [] },
          disks: [],
          networkInterfaces: subnet ? [{ network: link(subnets.get(`${region}/${subnet}`)?.network ?? "global/networks/default"), subnetwork: link(`regions/${region}/subnetworks/${subnet}`), networkIP: "10.20.0.9", accessConfigs: [] }] : [],
          serviceAccounts: [],
          shieldedInstanceConfig: {},
        });

        instances.set(`${zone}/${name}`, instance);
        return instance;
      },
    },
    async close() {
      for (const handle of running.values()) handle.stop();
      running.clear();
      await server.close();
    },
  };
}

/** Every permission the `gcp` host tests, plus the ones the fake checks on its own. */
export const GRANTED_ALL = [
  "compute.networks.create",
  "compute.networks.delete",
  "compute.subnetworks.create",
  "compute.subnetworks.delete",
  "compute.addresses.create",
  "compute.addresses.delete",
  "compute.addresses.setLabels",
  "compute.firewalls.create",
  "compute.firewalls.delete",
  "compute.instances.create",
  "compute.instances.delete",
  "compute.instances.setMetadata",
  "compute.instances.stop",
  "compute.instances.start",
  "compute.disks.createSnapshot",
  "compute.snapshots.create",
  "compute.snapshots.setLabels",
  "compute.subnetworks.use",
  "compute.subnetworks.useExternalIp",
  "compute.addresses.use",
];

/** The install's environment, read back out of a machine's startup script (its .env file), for the rehearsal's launched install. */
export function startupEnvironment(instance: Pick<FakeGcpInstance, "metadata">): Record<string, string> {
  const script = instance.metadata.items.find((item) => item.key === "startup-script")?.value ?? "";
  const env = /cat > \.env\.new <<'([A-Z_-]+)'\n([\s\S]*?)\1\n/.exec(script)?.[2] ?? "";
  const out: Record<string, string> = {};

  for (const line of env.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);

    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}
