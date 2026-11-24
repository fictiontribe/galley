/**
 * Fake Cloudflare for "Host the editor online": the key check, accounts,
 * zones, DNS records (with comments), and remotely managed tunnels with their
 * routing, token and connections — strict the way the real API is documented
 * to be: every answer is the { success, errors, result } envelope; a missing
 * or wrong key is a 401 with code 10000; a permission the key lacks is a 403
 * with code 10000 (reads and writes separately, since a read that works
 * doesn't prove the write); an unknown path a 404 with code 7003; a record
 * whose name is already used 400 code 81053; a tunnel name already used 409;
 * routing without the final catch-all 400; deleting a tunnel with live
 * connections 400; deleting what doesn't exist 404. Every call is recorded
 * (never the key).
 */
import { randomUUID } from "node:crypto";
import { startFake, type FakeReply, type FakeServer } from "../../deploy/fakes/common";

export interface FakeCfRecord {
  id: string;
  zone: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
  comment: string | null;
}

export interface FakeCfTunnel {
  id: string;
  account: string;
  name: string;
  token: string;
  config_src: string;
  deleted_at: string | null;
  connections: number;
  ingress: Array<{ hostname?: string; service: string }> | null;
}

export interface FakeCfCall {
  method: string;
  path: string;
  status: number;
  body: any;
  /** When, to put two fakes' calls in one order. */
  at: number;
}

export interface FakeCloudflareHosting extends FakeServer {
  /** The API base to give the engine: `${url}/client/v4`. */
  api: string;
  token: string;
  records: Map<string, FakeCfRecord>;
  tunnels: Map<string, FakeCfTunnel>;
  calls: FakeCfCall[];
  writes(): FakeCfCall[];
}

export interface FakeCloudflareHostingOptions {
  token?: string;
  accounts?: Array<{ id: string; name: string }>;
  zones?: Array<{ id: string; name: string; account: string }>;
  /** GET /accounts answers 403 (no Account Settings › Read). */
  hideAccounts?: boolean;
  /** GET /zones answers 403 (no Zone › Zone › Read). */
  hideZones?: boolean;
  /** The key may read but not change DNS records. */
  dnsReadOnly?: boolean;
  /** The key may neither read nor change DNS records. */
  noDns?: boolean;
  /** The key may read but not create tunnels. */
  tunnelReadOnly?: boolean;
  /** The key may neither read nor create tunnels. */
  noTunnels?: boolean;
  port?: number;
}

const ok = (result: unknown, status = 200): FakeReply => ({ status, body: { success: true, errors: [], messages: [], result } });
const fail = (status: number, code: number, message: string): FakeReply => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

export async function startFakeCloudflareHosting(options: FakeCloudflareHostingOptions = {}): Promise<FakeCloudflareHosting> {
  const token = options.token ?? "cf-hosting-test-key-0123456789abcdefghijkl";
  const accounts = options.accounts ?? [{ id: "acc0123456789abcdef0123456789abc", name: "Studio account" }];
  const zones = options.zones ?? [{ id: "zone0123456789abcdef0123456789ab", name: "example.com", account: accounts[0]!.id }];
  const records = new Map<string, FakeCfRecord>();
  const tunnels = new Map<string, FakeCfTunnel>();
  const calls: FakeCfCall[] = [];
  const denied = () => fail(403, 10000, "Authentication error");

  const server = await startFake(
    async (request) => {
      const path = request.url.pathname.replace(/^\/client\/v4/, "");
      const method = request.method;
      let body: any = null;

      if (request.body.length) {
        try {
          body = request.json();
        } catch {
          return fail(400, 6007, "Malformed JSON in request body");
        }
      }
      const reply = ((): FakeReply => {
        if (request.bearer !== token) return fail(401, 10000, "Authentication error");
        const parts = path.split("/").filter(Boolean);
        const query = request.url.searchParams;

        if (parts[0] === "user" && parts[1] === "tokens" && parts[2] === "verify" && parts.length === 3) {
          return method === "GET" ? ok({ id: "tok_1", status: "active" }) : fail(405, 10405, "Method not allowed");
        }
        if (parts[0] === "accounts" && parts.length === 1) {
          if (method !== "GET") return fail(405, 10405, "Method not allowed");
          return options.hideAccounts ? denied() : ok(accounts);
        }
        if (parts[0] === "zones") {
          if (parts.length === 1) {
            if (method !== "GET") return fail(405, 10405, "Method not allowed");
            if (options.hideZones) return denied();
            const name = query.get("name");

            return ok(zones.filter((zone) => !name || zone.name === name).map((zone) => ({ id: zone.id, name: zone.name, status: "active", account: { id: zone.account, name: accounts.find((account) => account.id === zone.account)?.name ?? zone.account } })));
          }
          const zone = zones.find((entry) => entry.id === parts[1]);

          if (!zone) return fail(404, 7003, "Could not route to /zones, perhaps your object identifier is invalid?");
          if (parts[2] !== "dns_records") return fail(404, 7003, "No route for that URI");
          if (options.noDns) return denied();
          if (parts.length === 3) {
            if (method === "GET") {
              const name = query.get("name");

              return ok([...records.values()].filter((record) => record.zone === zone.id && (!name || record.name === name)));
            }
            if (method !== "POST") return fail(405, 10405, "Method not allowed");
            if (options.dnsReadOnly) return denied();
            if (!body?.type || !body.name || !body.content) return fail(400, 9005, "type, name and content are required");
            if (!(body.name === zone.name || String(body.name).endsWith(`.${zone.name}`))) return fail(400, 9000, "DNS name is invalid for this zone");
            if (body.comment !== undefined && String(body.comment).length > 100) return fail(400, 9101, "comment is too long (100 characters on this plan)");
            if ([...records.values()].some((record) => record.zone === zone.id && record.name === body.name)) return fail(400, 81053, "An A, AAAA, or CNAME record with that host already exists.");
            const record: FakeCfRecord = { id: randomUUID().replace(/-/g, ""), zone: zone.id, type: body.type, name: body.name, content: body.content, proxied: Boolean(body.proxied), ttl: body.ttl ?? 1, comment: body.comment ?? null };

            records.set(record.id, record);
            return ok(record);
          }
          const record = records.get(parts[3]!);

          if (parts.length !== 4) return fail(404, 7003, "No route for that URI");
          if (!record || record.zone !== zone.id) return fail(404, 81044, "Record does not exist.");
          if (method === "GET") return ok(record);
          if (method === "DELETE") {
            if (options.dnsReadOnly) return denied();
            records.delete(record.id);
            return ok({ id: record.id });
          }
          return fail(405, 10405, "Method not allowed");
        }
        if (parts[0] === "accounts" && parts[2] === "cfd_tunnel") {
          const account = accounts.find((entry) => entry.id === parts[1]);

          if (!account) return denied();
          if (options.noTunnels) return denied();
          if (parts.length === 3) {
            if (method === "GET") {
              const name = query.get("name");
              const live = query.get("is_deleted") === "false";

              return ok([...tunnels.values()].filter((tunnel) => tunnel.account === account.id && (!name || tunnel.name === name) && (!live || !tunnel.deleted_at)).map(({ token: _t, ...tunnel }) => tunnel));
            }
            if (method !== "POST") return fail(405, 10405, "Method not allowed");
            if (options.tunnelReadOnly) return denied();
            if (!body?.name) return fail(400, 1001, "name is required");
            if (body.config_src !== "cloudflare" && body.config_src !== "local") return fail(400, 1001, "config_src must be cloudflare or local");
            if ([...tunnels.values()].some((tunnel) => tunnel.account === account.id && tunnel.name === body.name && !tunnel.deleted_at)) return fail(409, 1013, "You already have a tunnel with this name.");
            const tunnel: FakeCfTunnel = { id: randomUUID(), account: account.id, name: body.name, token: `eyJ-fake-tunnel-token-${randomUUID()}`, config_src: body.config_src, deleted_at: null, connections: 0, ingress: null };

            tunnels.set(tunnel.id, tunnel);
            return ok({ id: tunnel.id, name: tunnel.name, created_at: new Date().toISOString(), deleted_at: null, token: tunnel.token, status: "inactive" });
          }
          const tunnel = tunnels.get(parts[3]!);

          if (!tunnel || tunnel.account !== account.id || tunnel.deleted_at) return fail(404, 1003, "Tunnel not found");
          const tail = parts.slice(4).join("/");

          if (tail === "") {
            if (method === "GET") {
              const { token: _t, ...shown } = tunnel;

              return ok(shown);
            }
            if (method === "DELETE") {
              if (options.tunnelReadOnly) return denied();
              if (tunnel.connections > 0) return fail(400, 1022, "Cannot delete a tunnel with active connections");
              tunnel.deleted_at = new Date().toISOString();
              return ok({ id: tunnel.id });
            }
            return fail(405, 10405, "Method not allowed");
          }
          if (tail === "configurations") {
            if (method !== "PUT") return fail(405, 10405, "Method not allowed");
            if (options.tunnelReadOnly) return denied();
            const ingress = body?.config?.ingress;

            if (!Array.isArray(ingress) || ingress.length === 0) return fail(400, 1055, "config.ingress is required");
            if (ingress.at(-1).hostname) return fail(400, 1055, "Your ingress rules must include a catch-all rule at the end");
            if (ingress.some((rule: any) => typeof rule.service !== "string")) return fail(400, 1055, "every ingress rule needs a service");
            tunnel.ingress = ingress;
            return ok({ tunnel_id: tunnel.id, version: 1, config: body.config });
          }
          if (tail === "token") return method === "GET" ? ok(tunnel.token) : fail(405, 10405, "Method not allowed");
          if (tail === "connections") {
            if (method === "DELETE") {
              tunnel.connections = 0;
              return ok(null);
            }
            if (method === "GET") return ok([]);
            return fail(405, 10405, "Method not allowed");
          }
          return fail(404, 7003, "No route for that URI");
        }
        return fail(404, 7003, `No route for that URI`);
      })();

      calls.push({ method, path, status: reply.status, body, at: performance.now() });
      return reply;
    },
    (bearer) => (bearer === null ? "none" : bearer === token ? "account" : "other"),
    options.port
  );

  return { ...server, api: `${server.url}/client/v4`, token, records, tunnels, calls, writes: () => calls.filter((call) => call.method !== "GET") };
}
