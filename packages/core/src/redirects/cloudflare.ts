/**
 * Setting the redirects on Cloudflare itself, as Bulk Redirects: one
 * redirect list and one rule that uses it, both created and named by this
 * app, at account level. Plain `fetch`, no SDK.
 *
 * Protocol (developers.cloudflare.com/rules/url-forwarding/bulk-redirects/create-api/,
 * …/waf/tools/lists/lists-api/endpoints/, …/ruleset-engine/rulesets-api/, read 2026-11-23):
 *   lists     GET  /accounts/:a/rules/lists                       → find ours by name
 *             POST /accounts/:a/rules/lists {name, kind:"redirect", description}
 *   items     GET  /accounts/:a/rules/lists/:id/items?per_page=500&cursor=…
 *             PUT  /accounts/:a/rules/lists/:id/items [ {redirect:{…}} ] → {operation_id}  (replaces all; asynchronous)
 *   poll      GET  /accounts/:a/rules/lists/bulk_operations/:op → status pending|running|completed|failed
 *   rule      GET  /accounts/:a/rulesets/phases/http_request_redirect/entrypoint (404: none yet)
 *             POST /accounts/:a/rulesets {kind:"root", phase:"http_request_redirect", rules:[ours]}   when there is none
 *             POST /accounts/:a/rulesets/:r/rules ours                                                  when ours is missing
 *             PATCH /accounts/:a/rulesets/:r/rules/:rule ours                                           when ours changed
 *   remove    DELETE /accounts/:a/rulesets/:r/rules/:rule, then DELETE /accounts/:a/rules/lists/:id
 *
 * Idempotent: the list's items are compared first and only replaced when
 * they differ; the rule only touched when it differs. Lists and rules this
 * app didn't create are never changed: ours are found by exact name/ref and
 * must carry our description, and the rule is changed one rule at a time
 * (never by rewriting the whole ruleset).
 *
 * Never verified against the real API from here (no Cloudflare key on the
 * machine it was written on): tests use a strict fake (test/redirects/fake-cloudflare.ts),
 * and docs/redirects.md gives the one command that checks it for real.
 */
import { createHash } from "node:crypto";
import { PRODUCT } from "../brand";
import { scrub } from "../deploy/errors";
import { GalleyError } from "../errors";
import { bulkItem } from "./generate";
import { CLOUDFLARE_BULK_LIMITS, CLOUDFLARE_BULK_PERMISSIONS } from "./info";
import { queryOf } from "./path";
import type { CloudflarePlan, CloudflareRecord, CloudflareRedirectItem, Redirect } from "./types";

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const PHASE = "http_request_redirect";
const MARKER = `Managed by ${PRODUCT.name}`;
const PER_PAGE = 500;

export interface CloudflareApi {
  token: string;
  fetch: typeof fetch;
  apiBase: string;
  /** Between polls of an asynchronous list operation. */
  pollMs?: number;
  /** Give up waiting for one list operation after this long. */
  timeoutMs?: number;
}

export interface CloudflareTarget {
  account: string;
  hostnames: string[];
  /** The site's id, which names the list and rule ("galley_redirects_1a2b3c4d5e6f"). */
  siteId: string;
  siteName: string;
}

interface Envelope<T> {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
  result_info?: { cursors?: { after?: string } };
}

interface RemoteList {
  id: string;
  name: string;
  description?: string;
  kind?: string;
}

interface RemoteRule {
  id: string;
  ref?: string;
  expression?: string;
  action?: string;
  description?: string;
  enabled?: boolean;
  action_parameters?: { from_list?: { name?: string; key?: string } };
}

interface RemoteState {
  list: RemoteList | null;
  items: CloudflareRedirectItem[];
  ruleset: { id: string; rules: RemoteRule[] } | null;
  rule: RemoteRule | null;
}

type Area = "lists" | "rules";

const PERMISSION_FOR: Record<Area, string> = { lists: CLOUDFLARE_BULK_PERMISSIONS[0]!, rules: CLOUDFLARE_BULK_PERMISSIONS[1]! };

export function listNameFor(siteId: string): string {
  // List names are used in rule expressions: lowercase letters, digits and underscores, 50 characters at most.
  return `${PRODUCT.slug.replace(/[^a-z0-9]/g, "")}_redirects_${siteId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}`.slice(0, 50);
}

function description(target: CloudflareTarget): string {
  return `${MARKER} for “${target.siteName}”. Its contents are replaced from the site's redirects list; change them there.`.slice(0, 500);
}

function ruleFor(listName: string, target: CloudflareTarget) {
  return {
    ref: listName,
    expression: `http.request.full_uri in $${listName}`,
    description: `${MARKER}: redirects for “${target.siteName}”.`.slice(0, 500),
    action: "redirect",
    action_parameters: { from_list: { name: listName, key: "http.request.full_uri" } },
    enabled: true,
  };
}

/** A key refused outright vs. a key without the permission: different fixes, so different sentences. */
function failure(status: number, body: Envelope<unknown> | null, area: Area, doing: string, detail: string, token: string): GalleyError {
  const codes = (body?.errors ?? []).map((error) => error.code);
  const clean = scrub(detail, [token]);

  if (status === 401 || codes.includes(9109) || codes.includes(6003) || codes.includes(6111)) {
    // Never 401: that would tell the app its own session ended (see deploy/errors.ts shapeForHttp).
    return new GalleyError("unconfigured", "Cloudflare didn't accept the access key. It may have been deleted or have expired. Create a new one and paste it in the site's Online settings.", clean);
  }
  if (status === 403 || codes.includes(10000)) {
    return new GalleyError(
      "forbidden",
      `Cloudflare didn't let the access key ${doing}. Edit the key on Cloudflare (My Profile › API Tokens): under Permissions add ${PERMISSION_FOR[area]}, for this account. Then try again. Nothing was changed on Cloudflare.`,
      clean
    );
  }
  if (status === 429) return new GalleyError("busy", "Cloudflare is asking for a pause. Wait a minute, then try again.", clean);
  const message = body?.errors?.[0]?.message;

  return new GalleyError("internal", `Cloudflare couldn't ${doing}${message ? `: “${scrub(message, [token]).slice(0, 200)}”` : ""}. Try again in a moment.`, clean);
}

async function call<T>(api: CloudflareApi, method: string, path: string, area: Area, doing: string, body?: unknown, accept404 = false): Promise<{ status: number; body: Envelope<T> | null }> {
  const url = `${api.apiBase.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  let response: Response;

  try {
    response = await api.fetch(url, {
      method,
      headers: { authorization: `Bearer ${api.token}`, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new GalleyError("internal", "This computer can't reach Cloudflare. Check your internet connection and try again. Nothing was changed on Cloudflare.", scrub(`${method} ${path}: ${error instanceof Error ? error.message : String(error)}`, [api.token]));
  }
  const text = (await response.text().catch(() => "")).slice(0, 4 * 1024 * 1024);
  let parsed: Envelope<T> | null = null;

  try {
    parsed = text ? (JSON.parse(text) as Envelope<T>) : null;
  } catch {
    parsed = null;
  }
  if (accept404 && response.status === 404) return { status: 404, body: parsed };
  if (!response.ok || parsed?.success === false) throw failure(response.status, parsed, area, doing, `${method} ${path} → ${response.status}\n${text.slice(0, 2000)}`, api.token);
  return { status: response.status, body: parsed };
}

const accountPath = (account: string) => `accounts/${encodeURIComponent(account)}`;

/** What the list asks Cloudflare for: one item per redirect per hostname, and what can't go. */
export function desiredItems(list: Redirect[], hostnames: string[]): { items: CloudflareRedirectItem[]; skipped: Array<{ from: string; reason: string }> } {
  const items: CloudflareRedirectItem[] = [];
  const skipped: Array<{ from: string; reason: string }> = [];
  const seen = new Set<string>();

  for (const redirect of list) {
    for (const hostname of hostnames) {
      const item = bulkItem(redirect, hostname);

      if ("reason" in item) {
        if (hostname === hostnames[0]) skipped.push({ from: redirect.from, reason: item.reason });
        continue;
      }
      // One source per list (Cloudflare refuses duplicates); the first redirect for it wins, as on every host.
      if (seen.has(item.source)) continue;
      seen.add(item.source);
      items.push({
        source_url: item.source,
        target_url: item.target,
        status_code: redirect.status,
        // The visitor's query string is carried over unless the new address has its own (Cloudflare allows one or the other).
        preserve_query_string: !queryOf(item.target),
        include_subdomains: false,
        subpath_matching: item.subpath,
        preserve_path_suffix: item.subpath ? item.suffix : false,
      });
    }
  }
  return { items, skipped };
}

/** Cloudflare's defaults filled in, and the suffix flag ignored where it has no effect, so items compare fairly. */
function normal(item: Partial<CloudflareRedirectItem> & { source_url: string; target_url: string }): CloudflareRedirectItem {
  const subpath = item.subpath_matching ?? false;

  return {
    source_url: item.source_url,
    target_url: item.target_url,
    status_code: item.status_code ?? 301,
    preserve_query_string: item.preserve_query_string ?? false,
    include_subdomains: item.include_subdomains ?? false,
    subpath_matching: subpath,
    preserve_path_suffix: subpath ? (item.preserve_path_suffix ?? true) : false,
  };
}

const itemKey = (item: CloudflareRedirectItem) => JSON.stringify(normal(item));

export function itemsHash(items: CloudflareRedirectItem[]): string {
  return createHash("sha256")
    .update(JSON.stringify(items.map(itemKey).sort()))
    .digest("hex")
    .slice(0, 16);
}

async function readRemote(api: CloudflareApi, target: CloudflareTarget, listName: string): Promise<RemoteState> {
  const base = accountPath(target.account);
  const lists = await call<RemoteList[]>(api, "GET", `${base}/rules/lists`, "lists", "read the account's lists");
  const list = (lists.body?.result ?? []).find((candidate) => candidate.name === listName) ?? null;

  if (list && !(list.description ?? "").startsWith(MARKER)) {
    throw new GalleyError("conflict", `There's already a list called “${listName}” on Cloudflare that this app didn't make, so it was left alone. Rename or remove that list on Cloudflare, then try again. Nothing was changed.`);
  }
  if (list && list.kind && list.kind !== "redirect") throw new GalleyError("conflict", `The list “${listName}” on Cloudflare isn't a redirect list, so it was left alone. Nothing was changed.`);
  const items: CloudflareRedirectItem[] = [];

  if (list) {
    let cursor: string | undefined;

    for (let page = 0; page < 10_000; page += 1) {
      const query = `per_page=${PER_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await call<Array<{ redirect?: CloudflareRedirectItem }>>(api, "GET", `${base}/rules/lists/${encodeURIComponent(list.id)}/items?${query}`, "lists", "read the redirect list");

      for (const entry of response.body?.result ?? []) if (entry.redirect?.source_url) items.push(normal(entry.redirect));
      cursor = response.body?.result_info?.cursors?.after;
      if (!cursor) break;
    }
  }
  const entry = await call<{ id: string; rules?: RemoteRule[] }>(api, "GET", `${base}/rulesets/phases/${PHASE}/entrypoint`, "rules", "read the account's redirect rules", undefined, true);
  const ruleset = entry.status === 404 || !entry.body?.result ? null : { id: entry.body.result.id, rules: entry.body.result.rules ?? [] };
  const rule = ruleset?.rules.find((candidate) => candidate.ref === listName && (candidate.description ?? "").startsWith(MARKER)) ?? null;

  return { list, items, ruleset, rule };
}

function ruleDiffers(rule: RemoteRule, wanted: ReturnType<typeof ruleFor>): boolean {
  return rule.expression !== wanted.expression || rule.action !== wanted.action || rule.enabled === false || rule.action_parameters?.from_list?.name !== wanted.action_parameters.from_list.name || rule.action_parameters?.from_list?.key !== wanted.action_parameters.from_list.key;
}

export interface PlanOutcome {
  plan: CloudflarePlan;
  desired: CloudflareRedirectItem[];
  remote: RemoteState;
}

export async function planCloudflare(api: CloudflareApi, target: CloudflareTarget, list: Redirect[]): Promise<PlanOutcome> {
  const listName = listNameFor(target.siteId);
  const { items: desired, skipped } = desiredItems(list, target.hostnames);
  const remote = await readRemote(api, target, listName);
  const current = new Map(remote.items.map((item) => [item.source_url, item]));
  const wanted = new Map(desired.map((item) => [item.source_url, item]));
  const add: CloudflareRedirectItem[] = [];
  const change: Array<{ before: CloudflareRedirectItem; after: CloudflareRedirectItem }> = [];
  const remove: CloudflareRedirectItem[] = [];
  let unchanged = 0;

  for (const item of desired) {
    const before = current.get(item.source_url);

    if (!before) add.push(item);
    else if (itemKey(before) !== itemKey(item)) change.push({ before, after: item });
    else unchanged += 1;
  }
  for (const item of remote.items) if (!wanted.has(item.source_url)) remove.push(item);
  const wantedRule = ruleFor(listName, target);
  const rule: CloudflarePlan["rule"] = !remote.rule ? "create" : ruleDiffers(remote.rule, wantedRule) ? "update" : "none";
  const listAction: CloudflarePlan["list"] = !remote.list ? "create" : add.length || change.length || remove.length ? "update" : "none";
  const notes: string[] = [];
  const free = CLOUDFLARE_BULK_LIMITS[0];

  if (desired.length > free.redirects) {
    const fits = CLOUDFLARE_BULK_LIMITS.find((limit) => limit.redirects >= desired.length);

    notes.push(`That's ${desired.length.toLocaleString("en-US")} redirects. Cloudflare's Free plan takes ${free.redirects.toLocaleString("en-US")} across all lists in an account${fits ? `; ${fits.plan} takes ${fits.redirects.toLocaleString("en-US")}` : ""}. If the account's plan is smaller, Cloudflare refuses the list and nothing changes.`);
  }
  if (!remote.list) notes.push(`A list counts towards the account's lists (${free.lists} on Free, Pro and Business) and the rule towards its Bulk Redirect rules (${free.rules}).`);
  notes.push("These apply once visitors reach the site through its own domain in this Cloudflare account, with its traffic proxied by Cloudflare (the orange cloud). They don't apply on workers.dev addresses.");
  const id = createHash("sha256")
    .update(JSON.stringify([target.account, target.hostnames, itemsHash(desired), itemsHash(remote.items), remote.list?.id ?? null, remote.rule ? JSON.stringify(remote.rule) : null]))
    .digest("hex")
    .slice(0, 20);

  return {
    desired,
    remote,
    plan: {
      id,
      account: target.account,
      hostnames: target.hostnames,
      listName,
      list: listAction,
      rule,
      add: add.length,
      change: change.length,
      remove: remove.length,
      unchanged,
      total: desired.length,
      examples: { add: add.slice(0, 20), change: change.slice(0, 20), remove: remove.slice(0, 20) },
      skipped,
      notes,
    },
  };
}

export interface ApplyProgress {
  detail: string;
  progress?: number;
}

async function waitFor(api: CloudflareApi, account: string, operation: string, onProgress: (progress: ApplyProgress) => void): Promise<void> {
  const started = Date.now();
  const pollMs = api.pollMs ?? 1500;
  const timeout = api.timeoutMs ?? 10 * 60_000;

  for (let attempt = 0; ; attempt += 1) {
    const response = await call<{ status?: string; error?: string }>(api, "GET", `${accountPath(account)}/rules/lists/bulk_operations/${encodeURIComponent(operation)}`, "lists", "say how the list update is going");
    const status = response.body?.result?.status;

    if (status === "completed") return;
    if (status === "failed") throw new GalleyError("invalid", `Cloudflare couldn't take the redirect list${response.body?.result?.error ? `: “${scrub(response.body.result.error, [api.token]).slice(0, 300)}”` : ""}. The rule wasn't changed.`, `bulk operation ${operation} failed`);
    if (Date.now() - started > timeout) throw new GalleyError("busy", "Cloudflare is still working on the list. Check again in a few minutes.", `bulk operation ${operation} still ${status ?? "unknown"}`);
    onProgress({ detail: status === "running" ? "Cloudflare is updating the list…" : "Waiting for Cloudflare to start on the list…" });
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs * (attempt < 5 ? 1 : 2), 10_000)));
  }
}

/** Makes Cloudflare match the plan. Re-plans first and refuses when anything moved since `planId`. */
export async function applyCloudflare(api: CloudflareApi, target: CloudflareTarget, list: Redirect[], planId: string, onProgress: (progress: ApplyProgress) => void): Promise<CloudflareRecord> {
  onProgress({ detail: "Checking Cloudflare…", progress: 0.05 });
  const { plan, desired, remote } = await planCloudflare(api, target, list);

  if (plan.id !== planId) throw new GalleyError("conflict", "Something changed since the plan was made — the list here, or the redirects on Cloudflare. Look at the new plan and apply again. Nothing was changed.");
  const base = accountPath(target.account);
  let listId = remote.list?.id ?? "";

  if (!remote.list) {
    onProgress({ detail: "Creating the redirect list…", progress: 0.1 });
    const created = await call<RemoteList>(api, "POST", `${base}/rules/lists`, "lists", "create the redirect list", { name: plan.listName, kind: "redirect", description: description(target) });

    listId = created.body?.result?.id ?? "";
    if (!listId) throw new GalleyError("internal", "Cloudflare didn't say which list it created. Nothing else was changed; check again.", "list create returned no id");
  }
  if (plan.list !== "none") {
    onProgress({ detail: `Sending ${desired.length.toLocaleString("en-US")} redirects…`, progress: 0.25 });
    const replaced = await call<{ operation_id?: string }>(
      api,
      "PUT",
      `${base}/rules/lists/${encodeURIComponent(listId)}/items`,
      "lists",
      "replace the redirects in the list",
      desired.map((item) => ({ redirect: item }))
    );
    const operation = replaced.body?.result?.operation_id;

    if (operation) await waitFor(api, target.account, operation, onProgress);
  }
  onProgress({ detail: "Turning the redirects on…", progress: 0.85 });
  const wanted = ruleFor(plan.listName, target);
  let rulesetId = remote.ruleset?.id ?? "";
  let ruleId = remote.rule?.id ?? "";

  if (!remote.ruleset) {
    const created = await call<{ id: string; rules?: RemoteRule[] }>(api, "POST", `${base}/rulesets`, "rules", "create the account's redirect rules", {
      name: "Bulk redirects",
      kind: "root",
      phase: PHASE,
      rules: [wanted],
    });

    rulesetId = created.body?.result?.id ?? "";
    ruleId = created.body?.result?.rules?.find((rule) => rule.ref === wanted.ref)?.id ?? "";
  } else if (!remote.rule) {
    const updated = await call<{ id: string; rules?: RemoteRule[] }>(api, "POST", `${base}/rulesets/${encodeURIComponent(rulesetId)}/rules`, "rules", "add the redirect rule", wanted);

    ruleId = updated.body?.result?.rules?.find((rule) => rule.ref === wanted.ref)?.id ?? "";
  } else if (plan.rule === "update") {
    await call(api, "PATCH", `${base}/rulesets/${encodeURIComponent(rulesetId)}/rules/${encodeURIComponent(ruleId)}`, "rules", "update the redirect rule", wanted);
  }
  onProgress({ detail: "Done", progress: 1 });
  return {
    account: target.account,
    hostnames: target.hostnames,
    listId,
    listName: plan.listName,
    rulesetId,
    ruleId,
    items: desired.length,
    itemsHash: itemsHash(desired),
    appliedAt: new Date().toISOString(),
  };
}

/** "Check Cloudflare matches": the plan again, read as differences. */
export async function checkCloudflare(api: CloudflareApi, target: CloudflareTarget, list: Redirect[]): Promise<{ matches: boolean; differences: string[]; plan: CloudflarePlan }> {
  const { plan } = await planCloudflare(api, target, list);
  const differences: string[] = [];
  const count = (value: number, one: string, many: string) => `${value.toLocaleString("en-US")} ${value === 1 ? one : many}`;

  if (plan.list === "create") differences.push("The redirect list isn't on Cloudflare.");
  else {
    if (plan.add) differences.push(`${count(plan.add, "redirect is", "redirects are")} missing on Cloudflare.`);
    if (plan.change) differences.push(`${count(plan.change, "redirect goes", "redirects go")} somewhere else on Cloudflare.`);
    if (plan.remove) differences.push(`${count(plan.remove, "redirect on Cloudflare isn't", "redirects on Cloudflare aren't")} in the list any more.`);
  }
  if (plan.rule === "create") differences.push("The rule that turns the list on isn't on Cloudflare.");
  if (plan.rule === "update") differences.push("The rule that turns the list on was changed or switched off on Cloudflare.");
  return { matches: differences.length === 0, differences, plan };
}

/** Takes this app's rule and list off Cloudflare. Nothing else is touched. */
export async function removeCloudflare(api: CloudflareApi, target: CloudflareTarget): Promise<{ removed: boolean }> {
  const listName = listNameFor(target.siteId);
  const remote = await readRemote(api, target, listName);
  const base = accountPath(target.account);

  if (remote.rule && remote.ruleset) await call(api, "DELETE", `${base}/rulesets/${encodeURIComponent(remote.ruleset.id)}/rules/${encodeURIComponent(remote.rule.id)}`, "rules", "remove the redirect rule");
  if (remote.list) await call(api, "DELETE", `${base}/rules/lists/${encodeURIComponent(remote.list.id)}`, "lists", "remove the redirect list");
  return { removed: Boolean(remote.rule || remote.list) };
}

/**
 * What the stored key can do here, found by reading (never by changing
 * anything): the deploy key the setup asks for has only Workers Scripts ›
 * Edit, so most keys need two more permissions before the first apply. A
 * key that can read lists and rules may still lack Edit; that shows on apply.
 */
export async function probeCloudflare(api: CloudflareApi, account: string): Promise<{ missing: string[] }> {
  const missing: string[] = [];
  const base = accountPath(account);

  for (const [area, path] of [["lists", `${base}/rules/lists`], ["rules", `${base}/rulesets/phases/${PHASE}/entrypoint`]] as const) {
    try {
      await call(api, "GET", path, area, area === "lists" ? "read the account's lists" : "read the account's redirect rules", undefined, true);
    } catch (error) {
      if (error instanceof GalleyError && error.code === "forbidden") missing.push(PERMISSION_FOR[area]);
      else throw error;
    }
  }
  return { missing };
}

/** The sentence for a key that lacks permissions, with the steps to add them to the same key. */
export function missingPermissionError(missing: string[]): GalleyError {
  return new GalleyError(
    "forbidden",
    `The Cloudflare access key can't change Bulk Redirects yet. Add ${missing.join(" and ")} to the same key on Cloudflare (My Profile › API Tokens › Edit), then try again. Nothing was changed on Cloudflare.`,
    `missing: ${missing.join(", ")}`
  );
}

/** Hostnames Bulk Redirects can apply to: a domain of the person's own, not a Cloudflare-provided address. */
export function hostnameProblem(hostname: string): string | null {
  const host = hostname.trim().toLowerCase();

  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return `“${hostname}” isn't a domain name, like www.example.com.`;
  if (/\.(workers|pages)\.dev$/.test(host)) return `${host} is an address Cloudflare provides, not a domain of your own, so Bulk Redirects can't apply there. Add the site's own domain first.`;
  return null;
}
