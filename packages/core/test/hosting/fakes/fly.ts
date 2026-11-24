/**
 * Fake Fly.io Machines API: apps, IP assignments, volumes, machines (with
 * wait, update, stop and destroy), ACME certificates, volume snapshots and
 * the token check — strict the way the real API is documented to be: a
 * missing or wrong key is a 401, an unknown path a 404, a wrong method a 405,
 * a missing required field or a value outside its range a 400/422, a taken
 * app name 422 `name_taken`, deleting what doesn't exist 404, updating a
 * machine without its current version 409, deleting a running machine
 * without `force` 412. Every call is recorded (never the key).
 *
 * `launch` lets the rehearsal turn a "created" machine into a real local
 * process: it is called when a machine starts and its handle stopped when the
 * machine stops or is destroyed.
 */
import { randomUUID } from "node:crypto";
import { startFake, type FakeReply, type FakeServer } from "../../deploy/fakes/common";

export interface FakeFlyMachine {
  id: string;
  name: string;
  region: string;
  state: "created" | "started" | "stopped" | "destroyed";
  instance_id: string;
  config: any;
}

export interface FakeFlyVolume {
  id: string;
  name: string;
  region: string;
  size_gb: number;
  state: "created" | "pending_destroy";
  attached_machine_id: string | null;
  snapshots: string[];
}

export interface FakeFlyApp {
  id: string;
  name: string;
  org: string;
  ips: Array<{ ip: string; type: string }>;
  volumes: Map<string, FakeFlyVolume>;
  machines: Map<string, FakeFlyMachine>;
  certificates: Map<string, { hostname: string; status: string }>;
}

export interface FakeFlyCall {
  method: string;
  path: string;
  status: number;
  /** The JSON body sent, when there was one. */
  body: any;
  /** When, to put two fakes' calls in one order. */
  at: number;
}

export interface FakeFly extends FakeServer {
  token: string;
  apps: Map<string, FakeFlyApp>;
  calls: FakeFlyCall[];
  /** Calls that change something (anything but GET). */
  writes(): FakeFlyCall[];
}

export interface FakeFlyOptions {
  token?: string;
  orgs?: Array<{ slug: string; name: string }>;
  /** The key may manage only these apps (an app-scoped key). */
  restrictedTo?: string[];
  /** Answer machine creation with insufficient capacity. */
  noCapacity?: boolean;
  /** Fail this call with a 500 (method + path pattern), to stop a create half-way. */
  failOn?: { method: string; path: RegExp };
  /** Echo the Authorization header back in error bodies, like a careless host. */
  echoAuth?: boolean;
  port?: number;
  /** Called when a machine starts; the handle is stopped when it stops or is destroyed. */
  launch?: (machine: FakeFlyMachine, app: FakeFlyApp) => { stop(): void } | void;
}

const json = (status: number, body?: unknown): FakeReply => ({ status, ...(body === undefined ? {} : { body }) });
const error = (status: number, message: string, code?: string): FakeReply => json(status, { error: message, ...(code ? { status: code } : {}) });
const id = (prefix: string) => `${prefix}${randomUUID().replace(/-/g, "").slice(0, 14)}`;

const AUTOSTOP = ["off", "stop", "suspend"];
const RESTART = ["no", "always", "on-failure"];
const IP_TYPES = ["v4", "v6", "shared_v4", "private_v6", "egress_v4", "egress_v6", "egress_pair"];
const WAIT_STATES = ["started", "stopped", "suspended", "destroyed", "failed", "archived", "settled"];

function durationSeconds(value: unknown): number | null {
  const match = typeof value === "string" ? /^(\d+)(ms|s|m)$/.exec(value) : null;

  if (!match) return null;
  const n = Number(match[1]);

  return match[2] === "ms" ? n / 1000 : match[2] === "m" ? n * 60 : n;
}

/** The first thing wrong with a machine config, the way the API's validation would put it. */
function configProblem(config: any, app: FakeFlyApp, machineId?: string): string | null {
  if (!config || typeof config !== "object") return "config is required";
  if (typeof config.image !== "string" || !config.image) return "config.image is required";
  if (config.env !== undefined) {
    if (typeof config.env !== "object") return "config.env must be an object";
    for (const [key, value] of Object.entries(config.env)) if (typeof value !== "string") return `config.env.${key} must be a string`;
  }
  const guest = config.guest;

  if (guest) {
    if (guest.cpu_kind !== "shared" && guest.cpu_kind !== "performance") return "guest.cpu_kind must be shared or performance";
    if (guest.cpu_kind === "shared") {
      const cpus = guest.cpus ?? 1;

      if (guest.memory_mb % 256 !== 0 || guest.memory_mb < 256 || guest.memory_mb > 2048 * cpus) return `invalid memory size ${guest.memory_mb} for ${cpus} shared cpu(s)`;
    }
  }
  for (const mount of config.mounts ?? []) {
    const volume = app.volumes.get(mount.volume);

    if (!volume || volume.state !== "created") return `volume ${mount.volume} not found`;
    if (volume.attached_machine_id && volume.attached_machine_id !== machineId) return `volume ${mount.volume} is attached to another machine`;
    if (typeof mount.path !== "string" || !mount.path.startsWith("/")) return "mounts[].path must be an absolute path";
    if (mount.extend_threshold_percent !== undefined && (mount.extend_threshold_percent < 50 || mount.extend_threshold_percent > 99)) return "extend_threshold_percent must be 50–99";
  }
  if ((config.mounts ?? []).length > 1) return "a machine can mount at most one volume";
  for (const service of config.services ?? []) {
    if (typeof service.internal_port !== "number") return "services[].internal_port is required";
    if (service.autostop !== undefined && !AUTOSTOP.includes(service.autostop)) return `services[].autostop must be one of ${AUTOSTOP.join(", ")}`;
    for (const port of service.ports ?? []) {
      if (port.force_https && !(port.handlers ?? []).includes("http")) return "force_https only works with the http handler";
    }
    for (const check of service.checks ?? []) {
      if (check.type !== "http" && check.type !== "tcp") return "checks[].type must be http or tcp";
      if (check.type === "http" && typeof check.path !== "string") return "an http check needs a path";
    }
  }
  if (config.restart && !RESTART.includes(config.restart.policy)) return `restart.policy must be one of ${RESTART.join(", ")}`;
  if (config.stop_config?.timeout !== undefined) {
    const seconds = durationSeconds(config.stop_config.timeout);

    if (seconds === null || seconds > 300) return "stop_config.timeout must be a duration of at most 5m";
  }
  if (config.metadata !== undefined && (typeof config.metadata !== "object" || Object.values(config.metadata).some((value) => typeof value !== "string"))) return "metadata values must be strings";
  return null;
}

export async function startFakeFly(options: FakeFlyOptions = {}): Promise<FakeFly> {
  const token = options.token ?? "FlyV1 fm2_fakeflykey0123456789abcdefghijklmnopqrstuv,fm2_secondpartABCDEFGHIJKLMNOPQRSTUV";
  const orgs = options.orgs ?? [{ slug: "personal", name: "Sam's organization" }];
  const apps = new Map<string, FakeFlyApp>();
  const calls: FakeFlyCall[] = [];
  const running = new Map<string, { stop(): void }>();

  const start = (machine: FakeFlyMachine, app: FakeFlyApp) => {
    machine.state = "started";
    const handle = options.launch?.(machine, app);

    if (handle) running.set(machine.id, handle);
  };
  const halt = (machine: FakeFlyMachine) => {
    running.get(machine.id)?.stop();
    running.delete(machine.id);
  };
  const destroyApp = (app: FakeFlyApp) => {
    for (const machine of app.machines.values()) halt(machine);
    apps.delete(app.name);
  };

  const server = await startFake(
    async (request) => {
      const path = request.url.pathname;
      const method = request.method;
      let body: any = null;

      if (request.body.length) {
        try {
          body = request.json();
        } catch {
          return error(400, "the body isn't JSON");
        }
      }
      const reply = await (async (): Promise<FakeReply> => {
        // The whole key, after "Bearer" or as "FlyV1 …" on its own.
        const auth = String(request.headers.authorization ?? "");
        const key = /^Bearer (.+)$/.exec(auth)?.[1] ?? (auth.startsWith("FlyV1 ") ? auth : null);

        if (key !== token) return error(401, "The API key used was missing or invalid");
        if (options.failOn && options.failOn.method === method && options.failOn.path.test(path)) return error(500, "internal error");
        const parts = path.split("/").filter(Boolean);

        if (parts[0] !== "v1") return error(404, "not found");
        if (parts[1] === "tokens" && parts[2] === "current" && parts.length === 3) {
          if (method !== "GET") return error(405, "method not allowed");
          return json(200, { tokens: orgs.map((org) => ({ org_slug: org.slug, organization: org.name, token_id: "tok_1", user: "sam@example.com", ...(options.restrictedTo ? { apps: options.restrictedTo } : {}) })) });
        }
        if (parts[1] !== "apps") return error(404, "not found");
        const allowed = (name: string) => !options.restrictedTo || options.restrictedTo.includes(name);

        if (parts.length === 2) {
          if (method === "GET") {
            const org = request.url.searchParams.get("org_slug");

            if (!org) return error(400, "org_slug is required");
            if (!orgs.some((entry) => entry.slug === org)) return error(403, "you don't have access to that organization");
            const list = [...apps.values()].filter((app) => app.org === org && allowed(app.name));

            return json(200, { total_apps: list.length, apps: list.map((app) => ({ id: app.id, name: app.name, machine_count: app.machines.size, network: "default" })) });
          }
          if (method === "POST") {
            const name = body?.app_name ?? body?.name;

            if (!body?.org_slug) return error(400, "org_slug is required");
            if (typeof name !== "string" || !/^[a-z0-9-]{2,63}$/.test(name)) return error(422, "app name is required: lowercase letters, numbers and dashes");
            if (!orgs.some((org) => org.slug === body.org_slug)) return error(403, "you don't have access to that organization");
            if (options.restrictedTo) return error(403, "this token can't create apps");
            if (apps.has(name)) return error(422, `Name has already been taken`, "name_taken");
            const app: FakeFlyApp = { id: id("app_"), name, org: body.org_slug, ips: [], volumes: new Map(), machines: new Map(), certificates: new Map() };

            apps.set(name, app);
            return json(201, { id: app.id, created_at: Date.now() });
          }
          return error(405, "method not allowed");
        }
        const app = apps.get(decodeURIComponent(parts[2]!));
        // Another organization's app is invisible, exactly like one that doesn't exist.
        const visible = app && orgs.some((org) => org.slug === app.org) && allowed(app.name) ? app : null;
        const rest = parts.slice(3);

        if (rest.length === 0) {
          if (method === "GET") return visible ? json(200, { id: visible.id, name: visible.name, organization: { slug: visible.org }, status: "deployed" }) : error(404, "app not found");
          if (method === "DELETE") {
            if (!visible) return error(404, "app not found");
            destroyApp(visible);
            return json(202);
          }
          return error(405, "method not allowed");
        }
        if (!visible) return error(404, "app not found");
        const [kind, child, action, extra] = rest;

        if (kind === "ip_assignments") {
          if (child === undefined) {
            if (method === "GET") return json(200, { ips: visible.ips.map((ip) => ({ ip: ip.ip, type: ip.type, region: "global" })) });
            if (method !== "POST") return error(405, "method not allowed");
            if (!IP_TYPES.includes(body?.type)) return error(400, `type must be one of ${IP_TYPES.join(", ")}`);
            if (body.type === "shared_v4" && body.region && body.region !== "global") return error(400, "shared_v4 takes no region");
            const ip = body.type === "v6" ? `2a09:8280:1::${visible.ips.length + 1}` : `66.241.124.${visible.ips.length + 10}`;

            visible.ips.push({ ip, type: body.type });
            return json(200, { ip, type: body.type, region: "global", created_at: new Date().toISOString() });
          }
          if (action !== undefined) return error(404, "not found");
          if (method !== "DELETE") return error(405, "method not allowed");
          const at = visible.ips.findIndex((ip) => ip.ip === decodeURIComponent(child));

          if (at < 0) return error(404, "ip not found");
          visible.ips.splice(at, 1);
          return json(200, {});
        }
        if (kind === "volumes") {
          if (child === undefined) {
            if (method === "GET") return json(200, [...visible.volumes.values()].filter((volume) => volume.state === "created").map(({ snapshots: _s, ...volume }) => volume));
            if (method !== "POST") return error(405, "method not allowed");
            if (typeof body?.name !== "string" || !/^[a-z0-9_]{1,30}$/.test(body.name)) return error(400, "name is required: at most 30 lowercase letters, digits and underscores");
            if (typeof body.region !== "string" || !body.region) return error(400, "region is required");
            if (!Number.isInteger(body.size_gb) || body.size_gb < 1 || body.size_gb > 500) return error(400, "size_gb must be 1–500");
            if (body.snapshot_retention !== undefined && (body.snapshot_retention < 1 || body.snapshot_retention > 60)) return error(400, "snapshot_retention must be 1–60");
            const volume: FakeFlyVolume = { id: id("vol_"), name: body.name, region: body.region, size_gb: body.size_gb, state: "created", attached_machine_id: null, snapshots: [] };

            visible.volumes.set(volume.id, volume);
            const { snapshots: _s, ...shown } = volume;

            return json(200, shown);
          }
          const volume = visible.volumes.get(child);

          if (!volume || volume.state !== "created") return error(404, "volume not found");
          if (action === undefined) {
            if (method === "GET") {
              const { snapshots: _s, ...shown } = volume;

              return json(200, shown);
            }
            if (method === "DELETE") {
              if (volume.attached_machine_id && visible.machines.get(volume.attached_machine_id)?.state !== "destroyed") return error(400, `volume is attached to machine ${volume.attached_machine_id}`);
              volume.state = "pending_destroy";
              return json(200, { id: volume.id, state: "pending_destroy" });
            }
            return error(405, "method not allowed");
          }
          if (action === "snapshots" && extra === undefined) {
            if (method === "POST") {
              const snapshot = id("vs_");

              volume.snapshots.push(snapshot);
              return json(200, { id: snapshot });
            }
            if (method === "GET") return json(200, volume.snapshots.map((snapshot) => ({ id: snapshot })));
            return error(405, "method not allowed");
          }
          return error(404, "not found");
        }
        if (kind === "machines") {
          if (child === undefined) {
            if (method === "GET") return json(200, [...visible.machines.values()].filter((machine) => machine.state !== "destroyed"));
            if (method !== "POST") return error(405, "method not allowed");
            if (options.noCapacity) return error(412, "insufficient resources to create new machine", "insufficient_capacity");
            const problem = configProblem(body?.config, visible);

            if (problem) return error(400, problem);
            const machine: FakeFlyMachine = { id: id("m_"), name: body.name ?? "machine", region: body.region ?? "iad", state: "created", instance_id: id("01H"), config: body.config };

            for (const mount of body.config.mounts ?? []) visible.volumes.get(mount.volume)!.attached_machine_id = machine.id;
            visible.machines.set(machine.id, machine);
            if (!body.skip_launch) start(machine, visible);
            return json(200, machine);
          }
          const machine = visible.machines.get(child);

          if (!machine || machine.state === "destroyed") return error(404, "machine not found");
          if (action === undefined) {
            if (method === "GET") return json(200, machine);
            if (method === "DELETE") {
              if (machine.state === "started" && request.url.searchParams.get("force") !== "true") return error(412, "machine is running; stop it first or use force=true");
              halt(machine);
              machine.state = "destroyed";
              for (const volume of visible.volumes.values()) if (volume.attached_machine_id === machine.id) volume.attached_machine_id = null;
              return json(200, { ok: true });
            }
            if (method === "POST") {
              if (!body?.current_version) return error(400, "current_version is required");
              if (body.current_version !== machine.instance_id) return error(409, "machine version changed");
              const problem = configProblem(body.config, visible, machine.id);

              if (problem) return error(400, problem);
              if (JSON.stringify(body.config.mounts?.map((mount: any) => mount.volume)) !== JSON.stringify(machine.config.mounts?.map((mount: any) => mount.volume))) return error(400, "a machine's volume can't be changed by an update");
              halt(machine);
              machine.config = body.config;
              machine.instance_id = id("01H");
              if (!body.skip_launch) start(machine, visible);
              return json(200, machine);
            }
            return error(405, "method not allowed");
          }
          if (action === "wait" && extra === undefined) {
            if (method !== "GET") return error(405, "method not allowed");
            const states = (request.url.searchParams.get("state") ?? "").split(",").filter(Boolean);

            if (states.length === 0 || states.some((state) => !WAIT_STATES.includes(state))) return error(400, `state must be one of ${WAIT_STATES.join(", ")}`);
            const version = request.url.searchParams.get("version") ?? request.url.searchParams.get("instance_id");

            if (version && version !== machine.instance_id) return error(400, "that version isn't the machine's");
            return states.includes(machine.state) ? json(200, { ok: true }) : error(408, "deadline exceeded");
          }
          if ((action === "stop" || action === "start") && extra === undefined) {
            if (method !== "POST") return error(405, "method not allowed");
            if (action === "stop") {
              halt(machine);
              machine.state = "stopped";
            } else start(machine, visible);
            return json(200, { ok: true });
          }
          return error(404, "not found");
        }
        if (kind === "certificates") {
          if (child === undefined) {
            if (method === "GET") return json(200, [...visible.certificates.values()]);
            return error(405, "method not allowed");
          }
          if (child === "acme" && action === undefined) {
            if (method !== "POST") return error(405, "method not allowed");
            const hostname = body?.hostname;

            if (typeof hostname !== "string" || !hostname) return error(400, "hostname is required");
            if (hostname.endsWith(".fly.dev")) return error(422, "Hostnames under fly.dev are not allowed");
            if (visible.certificates.has(hostname)) return error(422, "a certificate for that hostname already exists");
            const certificate = { hostname, status: "pending_validation" };

            visible.certificates.set(hostname, certificate);
            return json(201, { ...certificate, dns_requirements: { cname: `${visible.name}.fly.dev`, a: visible.ips.filter((ip) => ip.type !== "v6").map((ip) => ip.ip), aaaa: visible.ips.filter((ip) => ip.type === "v6").map((ip) => ip.ip) } });
          }
          const certificate = visible.certificates.get(decodeURIComponent(child));

          if (!certificate) return error(404, "certificate not found");
          if (action === undefined && method === "GET") return json(200, certificate);
          if (action === undefined && method === "DELETE") {
            visible.certificates.delete(certificate.hostname);
            return json(200, {});
          }
          if (action === "check" && method === "POST") return json(200, certificate);
          return error(405, "method not allowed");
        }
        return error(404, "not found");
      })();

      calls.push({ method, path, status: reply.status, body, at: performance.now() });
      if (options.echoAuth && reply.status >= 400 && reply.body && typeof reply.body === "object") {
        return { ...reply, body: { ...(reply.body as object), error: `${(reply.body as { error?: string }).error ?? ""} (sent: ${request.headers.authorization ?? ""})` } };
      }
      return reply;
    },
    (bearer) => (bearer === null ? "none" : bearer === token ? "account" : "other"),
    options.port
  );

  return {
    ...server,
    token,
    apps,
    calls,
    writes: () => calls.filter((call) => call.method !== "GET"),
    async close() {
      for (const handle of running.values()) handle.stop();
      running.clear();
      await server.close();
    },
  };
}
