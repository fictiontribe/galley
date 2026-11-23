/**
 * A strict fake of the parts of Cloudflare's API that Bulk Redirects use:
 * account lists and their items (asynchronous bulk operations that must be
 * polled), the account's http_request_redirect entry point ruleset and its
 * rules. Strict where the docs are: list names, kinds, item shapes (no query
 * string or fragment in a source, a valid URL target, no duplicate sources,
 * no target query with preserve_query_string), cursor pagination at 500 per
 * page, a list referenced by a rule can't be deleted, and permissions per
 * area (403, code 10000) — so a wrong call fails the way the real API would.
 *
 * In-process (`fake.fetch`) for unit tests; `serveFake` puts the same
 * handler on a loopback port for the end-to-end rehearsal.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeItem {
  id: string;
  redirect: Record<string, unknown>;
  created_on: string;
}

export interface FakeList {
  id: string;
  name: string;
  description: string;
  kind: string;
  items: FakeItem[];
}

export interface FakeRule {
  id: string;
  ref?: string;
  expression: string;
  action: string;
  description?: string;
  enabled?: boolean;
  action_parameters?: { from_list?: { name?: string; key?: string } };
}

export interface FakeOptions {
  token?: string;
  account?: string;
  /** The key can't touch lists (no Account Filter Lists permission). */
  noLists?: boolean;
  /** The key can't touch rulesets (no Bulk URL Redirects permission). */
  noRules?: boolean;
  /** How many polls a bulk operation stays pending/running before it completes. */
  pollsToComplete?: number;
  /** Make the next bulk operation fail with this message. */
  failOperation?: string;
}

export interface FakeCloudflare {
  token: string;
  account: string;
  apiBase: string;
  lists: FakeList[];
  ruleset: { id: string; rules: FakeRule[] } | null;
  log: Array<{ method: string; path: string; status: number }>;
  options: FakeOptions;
  fetch: typeof fetch;
  handle(method: string, url: URL, headers: Headers, body: string): Promise<{ status: number; body: unknown }>;
}

const ok = (result: unknown, status = 200, extra: Record<string, unknown> = {}) => ({ status, body: { success: true, errors: [], messages: [], result, ...extra } });
const fail = (status: number, code: number, message: string) => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

let counter = 0;
const newId = () => `${(++counter).toString(16).padStart(8, "0")}${Math.random().toString(16).slice(2, 10)}${"0".repeat(16)}`.slice(0, 32);

const STATUSES = new Set([301, 302, 307, 308]);

function itemProblem(item: unknown): string | null {
  const redirect = (item as { redirect?: Record<string, unknown> })?.redirect;

  if (!redirect || typeof redirect !== "object") return "item must have a redirect";
  const source = redirect.source_url;
  const target = redirect.target_url;

  if (typeof source !== "string" || source === "") return "source_url is required";
  if (typeof target !== "string" || target === "") return "target_url is required";
  if (/[?#]/.test(source)) return "source_url cannot contain a query string or fragment";
  try {
    new URL(/^https?:\/\//.test(source) ? source : `https://${source}`);
    new URL(target);
  } catch {
    return "not a valid URL";
  }
  if (redirect.status_code !== undefined && !STATUSES.has(redirect.status_code as number)) return "invalid status_code";
  if (redirect.preserve_query_string === true && new URL(target).search) return "target_url cannot contain a query string when preserve_query_string is enabled";
  for (const key of Object.keys(redirect)) {
    if (!["source_url", "target_url", "status_code", "preserve_query_string", "include_subdomains", "subpath_matching", "preserve_path_suffix"].includes(key)) return `unknown field ${key}`;
  }
  return null;
}

export function createFakeCloudflare(options: FakeOptions = {}): FakeCloudflare {
  const token = options.token ?? "cf-redirects-test-token-0123456789abcdef";
  const account = options.account ?? "acc0123456789abcdef0123456789abc";
  const operations = new Map<string, { polls: number; error?: string; apply: () => void }>();
  const fake: FakeCloudflare = {
    token,
    account,
    apiBase: "https://fake.cloudflare.test/client/v4",
    lists: [],
    ruleset: null,
    log: [],
    options,
    fetch: undefined as unknown as typeof fetch,
    async handle(method, url, headers, raw) {
      const path = url.pathname.replace(/^\/client\/v4/, "");

      if (headers.get("authorization") !== `Bearer ${token}`) return fail(401, 9109, "Invalid access token");
      const prefix = `/accounts/${account}`;

      if (!path.startsWith(`${prefix}/`)) return fail(403, 10000, "Authentication error");
      const rest = path.slice(prefix.length);
      const json = () => (raw ? JSON.parse(raw) : undefined);
      const listsArea = rest.startsWith("/rules/lists");
      const rulesArea = rest.startsWith("/rulesets");

      if (listsArea && options.noLists) return fail(403, 10000, "Authentication error");
      if (rulesArea && options.noRules) return fail(403, 10000, "Authentication error");

      // ── lists
      if (method === "GET" && rest === "/rules/lists") {
        return ok(fake.lists.map(({ items, ...list }) => ({ ...list, num_items: items.length, num_referencing_filters: referenced(list.name) ? 1 : 0 })));
      }
      if (method === "POST" && rest === "/rules/lists") {
        const body = json() as { name?: string; kind?: string; description?: string };

        if (!body?.name || !/^[a-z0-9_]{1,50}$/.test(body.name)) return fail(400, 10001, "list name must be lowercase letters, digits and underscores, up to 50 characters");
        if (!["ip", "redirect", "hostname", "asn"].includes(body.kind ?? "")) return fail(400, 10002, "invalid list kind");
        if ((body.description ?? "").length > 500) return fail(400, 10003, "description too long");
        if (fake.lists.some((list) => list.name === body.name)) return fail(400, 10004, "duplicate list name");
        const list: FakeList = { id: newId(), name: body.name, kind: body.kind!, description: body.description ?? "", items: [] };

        fake.lists.push(list);
        return ok({ id: list.id, name: list.name, description: list.description, kind: list.kind, num_items: 0, num_referencing_filters: 0 });
      }
      const bulk = /^\/rules\/lists\/bulk_operations\/([^/]+)$/.exec(rest);

      if (bulk && method === "GET") {
        const operation = operations.get(bulk[1]!);

        if (!operation) return fail(404, 10006, "operation not found");
        operation.polls += 1;
        const needed = options.pollsToComplete ?? 2;

        if (operation.polls < needed) return ok({ id: bulk[1], status: operation.polls === 1 ? "pending" : "running" });
        if (operation.error) return ok({ id: bulk[1], status: "failed", completed: new Date().toISOString(), error: operation.error });
        operation.apply();
        return ok({ id: bulk[1], status: "completed", completed: new Date().toISOString() });
      }
      const listMatch = /^\/rules\/lists\/([^/]+)(\/items)?$/.exec(rest);

      if (listMatch) {
        const list = fake.lists.find((candidate) => candidate.id === listMatch[1]);

        if (!list) return fail(404, 10007, "list not found");
        if (!listMatch[2]) {
          if (method === "DELETE") {
            if (referenced(list.name)) return fail(400, 10008, "list is referenced by a filter or rule");
            fake.lists = fake.lists.filter((candidate) => candidate !== list);
            return ok({ id: list.id });
          }
          if (method === "GET") return ok({ id: list.id, name: list.name, kind: list.kind, description: list.description, num_items: list.items.length });
          return fail(405, 10000, "method not allowed");
        }
        if (method === "GET") {
          const perPage = Number(url.searchParams.get("per_page") ?? "25");

          if (!Number.isInteger(perPage) || perPage < 1 || perPage > 500) return fail(400, 10009, "per_page must be between 1 and 500");
          const start = Number(url.searchParams.get("cursor") ?? "0");
          const page = list.items.slice(start, start + perPage);
          const after = start + perPage < list.items.length ? String(start + perPage) : undefined;

          return ok(page, 200, { result_info: { cursors: after ? { after } : {} } });
        }
        if (method === "PUT" || method === "POST") {
          const body = json();

          if (!Array.isArray(body)) return fail(400, 10010, "body must be a list of items");
          if (list.kind !== "redirect") return fail(400, 10011, "items don't match the list kind");
          const sources = new Set<string>();

          for (const item of body) {
            const problem = itemProblem(item);

            if (problem) return fail(400, 10012, problem);
            const source = String((item as { redirect: { source_url: string } }).redirect.source_url);

            if (sources.has(source)) return fail(400, 10013, `duplicate source_url ${source}`);
            sources.add(source);
          }
          const id = newId();
          const items = body.map((item) => ({ id: newId(), redirect: (item as { redirect: Record<string, unknown> }).redirect, created_on: new Date().toISOString() }));

          operations.set(id, {
            polls: 0,
            ...(options.failOperation ? { error: options.failOperation } : {}),
            apply: () => {
              list.items = method === "PUT" ? items : [...list.items.filter((existing) => !sources.has(String(existing.redirect.source_url))), ...items];
            },
          });
          options.failOperation = undefined;
          return ok({ operation_id: id }, 201);
        }
        return fail(405, 10000, "method not allowed");
      }

      // ── rulesets
      if (method === "GET" && rest === "/rulesets/phases/http_request_redirect/entrypoint") {
        if (!fake.ruleset) return fail(404, 10014, "could not find entrypoint ruleset in the http_request_redirect phase");
        return ok({ id: fake.ruleset.id, kind: "root", phase: "http_request_redirect", rules: fake.ruleset.rules });
      }
      if (method === "POST" && rest === "/rulesets") {
        const body = json() as { kind?: string; phase?: string; rules?: FakeRule[]; name?: string };

        if (body?.kind !== "root" || body.phase !== "http_request_redirect") return fail(400, 10015, "only a root ruleset in the http_request_redirect phase is supported here");
        if (fake.ruleset) return fail(400, 10016, "an entry point ruleset already exists for this phase");
        for (const rule of body.rules ?? []) {
          const problem = ruleProblem(rule);

          if (problem) return fail(400, 10017, problem);
        }
        fake.ruleset = { id: newId(), rules: (body.rules ?? []).map((rule) => ({ ...rule, id: newId() })) };
        return ok({ id: fake.ruleset.id, kind: "root", phase: "http_request_redirect", rules: fake.ruleset.rules });
      }
      const ruleMatch = /^\/rulesets\/([^/]+)\/rules(?:\/([^/]+))?$/.exec(rest);

      if (ruleMatch) {
        if (!fake.ruleset || fake.ruleset.id !== ruleMatch[1]) return fail(404, 10018, "ruleset not found");
        const ruleset = fake.ruleset;

        if (method === "POST" && !ruleMatch[2]) {
          const rule = json() as FakeRule;
          const problem = ruleProblem(rule);

          if (problem) return fail(400, 10017, problem);
          ruleset.rules.push({ ...rule, id: newId() });
          return ok({ id: ruleset.id, rules: ruleset.rules });
        }
        const at = ruleset.rules.findIndex((rule) => rule.id === ruleMatch[2]);

        if (at === -1) return fail(404, 10019, "rule not found");
        if (method === "PATCH") {
          const rule = json() as FakeRule;
          const problem = ruleProblem(rule);

          if (problem) return fail(400, 10017, problem);
          ruleset.rules[at] = { ...rule, id: ruleset.rules[at]!.id };
          return ok({ id: ruleset.id, rules: ruleset.rules });
        }
        if (method === "DELETE") {
          ruleset.rules.splice(at, 1);
          return ok({ id: ruleset.id, rules: ruleset.rules });
        }
      }
      return fail(404, 7003, `no route for ${method} ${path}`);
    },
  };

  function referenced(name: string): boolean {
    return Boolean(fake.ruleset?.rules.some((rule) => rule.expression.includes(`$${name}`)));
  }

  function ruleProblem(rule: FakeRule): string | null {
    if (rule.action !== "redirect") return "action must be redirect";
    const name = rule.action_parameters?.from_list?.name;

    if (!name || !fake.lists.some((list) => list.name === name && list.kind === "redirect")) return `list ${name} not found`;
    if (rule.action_parameters?.from_list?.key !== "http.request.full_uri") return "from_list.key must be http.request.full_uri";
    if (rule.expression !== `http.request.full_uri in $${name}`) return "expression must reference the list";
    return null;
  }

  fake.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    const reply = await fake.handle(method, url, headers, body);

    fake.log.push({ method, path: url.pathname.replace(/^\/client\/v4/, "") + url.search, status: reply.status });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return fake;
}

/** The fake on a loopback port: `${url}/client/v4` is the API base. */
export async function serveFake(fake: FakeCloudflare, port = 0): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const headers = new Headers();

      for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
      void fake.handle((req.method ?? "GET").toUpperCase(), url, headers, Buffer.concat(chunks).toString("utf8")).then((reply) => {
        fake.log.push({ method: req.method ?? "GET", path: url.pathname.replace(/^\/client\/v4/, "") + url.search, status: reply.status });
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
