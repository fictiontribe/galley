/**
 * "Cloudflare in front of a computer of yours". Cloudflare's own container
 * product can't hold an install: its disk starts fresh after every sleep,
 * restart or update (developers.cloudflare.com/containers/platform-details/,
 * read 2026-11-23). What works today: a Cloudflare Tunnel to a computer the
 * person runs, which dials out to Cloudflare, so no port is opened.
 *
 * With the stored Cloudflare key, `create` makes (create-remote-tunnel-api,
 * read 2026-11-23):
 *   1. POST /accounts/:a/cfd_tunnel { name, config_src: "cloudflare" }
 *   2. PUT  /accounts/:a/cfd_tunnel/:id/configurations — the three names to
 *      http://editor:4400, then the catch-all every ingress list must end with
 *   3. POST /zones/:z/dns_records × 3 — proxied CNAMEs to
 *      <tunnel id>.cfargotunnel.com, each with a comment naming the install
 * and the person starts the editor and the connector with the files it hands
 * over (the connector's key fetched fresh from GET …/cfd_tunnel/:id/token,
 * never stored). Removing deletes the DNS records (deleting a tunnel leaves
 * them behind), clears the tunnel's connections, then the tunnel.
 *
 * Cloudflare's free certificate covers a domain and the names one level below
 * it, so an address deeper than that is refused in the plan.
 */
import { PRODUCT } from "../brand";
import { depthBelow } from "./addresses";
import { canReadDns, cf, cfFailure, cfRaw, checkCloudflareKey, CLOUDFLARE_API, createRecord, deleteRecord, dnsGap, gapSentence, listAccounts, listZones, readRecord, recordResourceId, recordsNamed, splitRecordId, tunnelGap, zoneFor, zoneListGap, type CfZone } from "./cloudflare-api";
import { HostingError } from "./errors";
import { INSTALL_PORT, recipeFiles } from "./recipe";
import { recordComment } from "./tag";
import type { CostEstimate, EditorAddresses, EditorHost, EditorHostAccount, EditorHostContext, EditorHostGap, HostedEditorRecord, HostedResource, ManualStep } from "./types";

export const CLOUDFLARE_COST: CostEstimate = {
  monthly: 0,
  currency: "USD",
  lines: [
    { label: "Cloudflare Tunnel (every account includes 1,000 at no cost)", amount: 0 },
    { label: "Three DNS names on your domain", amount: 0 },
  ],
  note: "Cloudflare charges nothing for this. The editor runs on a computer of yours, so what that computer costs is yours: nothing more on one you already have.",
  source: "https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/",
  checked: "2026-11-23",
};

const tunnelPath = (account: string, id?: string) => `accounts/${encodeURIComponent(account)}/cfd_tunnel${id ? `/${encodeURIComponent(id)}` : ""}`;

async function keyOf(ctx: EditorHostContext): Promise<string> {
  const key = await ctx.secret("cloudflare");

  if (!key) throw new HostingError("no-key", "Add a Cloudflare access key first. Paste it in the setup, or start the app with CLOUDFLARE_API_TOKEN set.");
  return key;
}

/** The account's name for a sentence, or its id when the key can't list accounts. */
async function accountName(ctx: EditorHostContext, key: string, account: string): Promise<string> {
  const accounts = await listAccounts(ctx, key).catch(() => null);

  return accounts?.find((entry) => entry.id === account)?.name ?? account;
}

/**
 * What the key reaches and may do. `needTunnel`: the Cloudflare host (a
 * missing permission stops it); otherwise Fly.io asking only about DNS (a
 * missing permission means the names are added by hand).
 */
export async function inspectCloudflare(ctx: EditorHostContext, key: string, needTunnel: boolean): Promise<EditorHostAccount> {
  await checkCloudflareKey(ctx, key);
  const gaps: EditorHostGap[] = [];
  const [listed, zones] = await Promise.all([listAccounts(ctx, key), listZones(ctx, key)]);

  if (zones === null) gaps.push(zoneListGap(needTunnel));
  const accounts = listed ?? [];

  // A key without Account Settings › Read still names its accounts through its domains.
  for (const zone of zones ?? []) {
    if (zone.account?.id && !accounts.some((account) => account.id === zone.account!.id)) accounts.push({ id: zone.account.id, name: zone.account.name?.trim() || zone.account.id });
  }
  const domains: Array<{ id: string; name: string }> = [];

  for (const zone of (zones ?? []).slice(0, 25)) {
    if (await canReadDns(ctx, key, zone.id)) domains.push({ id: zone.id, name: zone.name });
  }
  if (zones && zones.length > 0 && domains.length === 0) gaps.push(dnsGap(zones.length === 1 ? zones[0]!.name : "your domains", needTunnel));
  if (needTunnel) {
    for (const account of accounts) {
      const response = await cfRaw<unknown[]>(ctx, key, "GET", tunnelPath(account.id), { query: { per_page: "1", is_deleted: "false" } });

      if (response.status === 403) gaps.push(tunnelGap(account.name));
      else if (!response.ok || response.body?.success === false) throw cfFailure(response, "GET", tunnelPath(account.id), "list the account's tunnels");
    }
    if (accounts.length > 0 && !gaps.some((gap) => gap.blocking)) {
      gaps.push({
        what: "Cloudflare lets an app check only that a key may read tunnels and DNS records, not that it may also make them (Account › Cloudflare Tunnel › Edit, Zone › DNS › Edit).",
        where: "If the key may only read them, creating stops at its first step and says which permission to add; nothing is left half-made.",
        url: "https://dash.cloudflare.com/profile/api-tokens",
        blocking: false,
      });
    }
  }
  return { accounts, regions: [], domains, gaps };
}

/** The zone all three names are in, and the first problem with them. */
export function zoneProblem(zones: CfZone[] | null, addresses: EditorAddresses): { zone: CfZone | null; problem: { message: string; fix?: string } | null } {
  if (zones === null) return { zone: null, problem: { message: zoneListGap(true).what, fix: zoneListGap(true).where } };
  const zone = zoneFor(zones, addresses.editor);

  if (!zone) {
    return {
      zone: null,
      problem: {
        message: `${addresses.editor} isn't on a domain this Cloudflare key can see.`,
        fix: "Add the domain to Cloudflare (or include it in the key's Zone Resources), or choose “Any server with Docker”.",
      },
    };
  }
  for (const host of [addresses.editor, addresses.preview, addresses.live]) {
    const depth = depthBelow(host, zone.name);

    if (depth < 0) return { zone, problem: { message: `${host} isn't on ${zone.name}, like the editor's address: all three need the same domain.`, fix: "Use names on the same domain, like cms.example.com, cms-preview.example.com and cms-live.example.com." } };
    if (depth > 1) {
      return {
        zone,
        problem: {
          message: `${host} is more than one level below ${zone.name}, and Cloudflare's free certificate covers only one level (like cms.${zone.name}).`,
          fix: `Use names one level below ${zone.name}, like cms.${zone.name} — or order an Advanced Certificate for these names on Cloudflare (from $10 a month).`,
        },
      };
    }
  }
  return { zone, problem: null };
}

function tunnelSteps(addresses: EditorAddresses): ManualStep[] {
  return [
    { title: "Copy the files to a computer with Docker", detail: "Any computer that stays on: a small server, a spare machine, a NAS. It needs no open ports: the connector dials out to Cloudflare." },
    { title: "Start it", detail: "In the folder with the files, start the editor and the connector. The first start downloads them and takes a minute or two.", copy: "docker compose up -d" },
    { title: "Then come back and choose Check", detail: `Once ${addresses.editor} answers, the site is handed over and you get the first-run link.` },
  ];
}

export function createCloudflareEditorHost(): EditorHost {
  return {
    id: "cloudflare",
    name: "Cloudflare",
    apis: { cloudflare: CLOUDFLARE_API },
    info: {
      id: "cloudflare",
      name: "Cloudflare, in front of a computer of yours",
      summary: "Runs the editor on any computer of yours with Docker and reaches it at your own addresses through Cloudflare, with no ports opened. A tunnel and three DNS names are created on your Cloudflare account.",
      kind: "self-run",
      credentials: [
        {
          secret: "cloudflare",
          label: "Cloudflare access key",
          help: "Cloudflare calls it an API token. It lets this app create the tunnel and the three DNS names. It's kept on this computer only.",
          docsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
          permissions: ["Account › Cloudflare Tunnel › Edit", "Zone › DNS › Edit", "Zone › Zone › Read"],
          required: true,
        },
      ],
      cost: CLOUDFLARE_COST,
      options: [],
      docsUrl: "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/",
    },

    async inspect(ctx) {
      return inspectCloudflare(ctx, await keyOf(ctx), true);
    },

    async plan(ctx, request, input) {
      const key = await keyOf(ctx);
      const problems: Array<{ message: string; fix?: string }> = [];
      const { zone, problem } = zoneProblem(await listZones(ctx, key), input.addresses);

      if (!request.account) problems.push({ message: "Choose the Cloudflare account the tunnel goes in." });
      if (problem) problems.push(problem);
      const names = [input.addresses.editor, input.addresses.preview, input.addresses.live];

      if (zone && !problem) {
        if (!(await canReadDns(ctx, key, zone.id))) problems.push({ message: dnsGap(zone.name, true).what, fix: dnsGap(zone.name, true).where });
        else {
          for (const host of names) {
            if ((await recordsNamed(ctx, key, zone.id, host)).length > 0) problems.push({ message: `There's already a DNS record for ${host} on Cloudflare.`, fix: "Choose another address, or delete that record on Cloudflare first." });
          }
        }
      }
      if (request.account) {
        const response = await cfRaw<Array<{ name?: string; deleted_at?: string | null }>>(ctx, key, "GET", tunnelPath(request.account), { query: { name: request.name, is_deleted: "false" } });

        if (response.status === 403) problems.push({ message: tunnelGap(await accountName(ctx, key, request.account)).what, fix: tunnelGap(request.account).where });
        else if (!response.ok || response.body?.success === false) throw cfFailure(response, "GET", tunnelPath(request.account), "list the account's tunnels");
        else if ((response.body?.result ?? []).some((tunnel) => tunnel.name === request.name && !tunnel.deleted_at)) {
          problems.push({ message: `There's already a tunnel called “${request.name}” in this Cloudflare account.`, fix: "Choose another name." });
        }
      }
      const resources: HostedResource[] = [
        { kind: "tunnel", id: "", name: request.name, detail: `A Cloudflare Tunnel sending the three names to the editor (http://editor:${INSTALL_PORT} on your computer)` },
        ...names.map((host) => ({ kind: "dns-record", id: "", name: host, detail: `${host} → the tunnel, through Cloudflare` })),
      ];
      const files = recipeFiles({ name: request.name, addresses: input.addresses, image: input.image, proxy: "tunnel", ...(input.environment?.GALLEY_SETUP_TOKEN_SHA256 ? { setupTokenSha256: input.environment.GALLEY_SETUP_TOKEN_SHA256 } : {}) });

      return { resources, cost: CLOUDFLARE_COST, steps: tunnelSteps(input.addresses), files, problems };
    },

    async create(ctx, input) {
      const key = await keyOf(ctx);
      const { request, plan } = input;
      const account = request.account;
      const { zone, problem } = zoneProblem(await listZones(ctx, key), plan.addresses);

      if (!zone || problem) throw new HostingError("invalid", problem?.message ?? `${plan.addresses.editor} isn't on a domain this Cloudflare key can see.`);
      input.onProgress({ detail: "Creating the tunnel on Cloudflare…", progress: 0.1 });
      const created = await cfRaw<{ id?: string; name?: string }>(ctx, key, "POST", tunnelPath(account), { json: { name: request.name, config_src: "cloudflare" } });

      if (created.status === 403) throw new HostingError("permission", gapSentence(tunnelGap(await accountName(ctx, key, account))));
      if (!created.ok || created.body?.success === false) throw cfFailure(created, "POST", tunnelPath(account), "create the tunnel");
      const tunnelId = created.body?.result?.id;

      if (!tunnelId) throw new HostingError("host", "Cloudflare didn't say which tunnel it made. Try again.", "POST cfd_tunnel returned no id");
      await input.onResource({ kind: "tunnel", id: tunnelId, name: request.name, detail: `Cloudflare Tunnel in account ${account}` });
      input.onProgress({ detail: "Sending the three names through the tunnel…", progress: 0.3 });
      const names = [plan.addresses.editor, plan.addresses.preview, plan.addresses.live];

      await cf(ctx, key, "PUT", `${tunnelPath(account, tunnelId)}/configurations`, "set where the tunnel sends the three names", {
        json: { config: { ingress: [...names.map((hostname) => ({ hostname, service: `http://editor:${INSTALL_PORT}` })), { service: "http_status:404" }] } },
        permission: tunnelGap(await accountName(ctx, key, account)),
      });
      for (const [index, host] of names.entries()) {
        input.onProgress({ detail: `Adding the DNS name ${host}…`, progress: 0.45 + index * 0.15 });
        const record = await createRecord(ctx, key, zone, { name: host, content: `${tunnelId}.cfargotunnel.com`, proxied: true, comment: recordComment(request.name) });

        await input.onResource({ kind: "dns-record", id: recordResourceId(zone.id, record.id), name: host, detail: `${host} → the tunnel, on ${zone.name}` });
      }
      input.onProgress({ detail: `The tunnel is ready. Start the files on your computer; ${PRODUCT.name} hands the site over once it answers.`, progress: 1 });
    },

    async pending(ctx, record) {
      const key = await keyOf(ctx);
      const tunnel = record.resources.find((resource) => resource.kind === "tunnel");
      let tunnelToken: string | undefined;

      if (tunnel) tunnelToken = (await cf<string>(ctx, key, "GET", `${tunnelPath(record.account, tunnel.id)}/token`, "read the connector's key")) ?? undefined;
      const files = recipeFiles({
        name: record.name,
        addresses: record.addresses,
        image: record.image,
        proxy: "tunnel",
        ...(tunnelToken ? { tunnelToken } : {}),
        ...(record.environment?.GALLEY_SETUP_TOKEN_SHA256 ? { setupTokenSha256: record.environment.GALLEY_SETUP_TOKEN_SHA256 } : {}),
      });

      return { steps: tunnelSteps(record.addresses), files };
    },

    async backup(_ctx, record) {
      return {
        kind: "page",
        url: `https://${record.addresses.editor}/install`,
        message: "Backups of an editor on your own computer are downloaded from its Install page. To copy its whole disk, back up the Docker volume there.",
      };
    },

    async removal(ctx, record) {
      const key = await keyOf(ctx);
      const resources: HostedResource[] = [];
      const skipped: Array<{ resource: HostedResource; reason: string }> = [];
      const tunnelId = record.resources.find((resource) => resource.kind === "tunnel")?.id;

      for (const resource of record.resources) {
        if (resource.kind === "tunnel") {
          const response = await cfRaw<{ name?: string; deleted_at?: string | null }>(ctx, key, "GET", tunnelPath(record.account, resource.id));

          if (response.status === 404 || response.body?.result?.deleted_at) skipped.push({ resource, reason: "It's already gone." });
          else if (!response.ok || response.body?.success === false) throw cfFailure(response, "GET", tunnelPath(record.account, resource.id), "read the tunnel");
          else if (response.body?.result?.name !== resource.name) skipped.push({ resource, reason: `It's called “${response.body?.result?.name ?? ""}” now, so it was changed after it was created.` });
          else resources.push(resource);
        } else if (resource.kind === "dns-record") {
          const ids = splitRecordId(resource.id);
          const found = ids ? await readRecord(ctx, key, ids.zoneId, ids.recordId) : null;

          if (!found) skipped.push({ resource, reason: "It's already gone." });
          else if (found.comment !== recordComment(record.name)) skipped.push({ resource, reason: "Its note on Cloudflare was changed, so it may belong to something else now." });
          else if (found.content !== `${tunnelId}.cfargotunnel.com` || found.name !== resource.name) skipped.push({ resource, reason: "It points somewhere else now." });
          else resources.push(resource);
        } else {
          skipped.push({ resource, reason: "This app doesn't know how to check it, so it was left alone." });
        }
      }
      return { resources, skipped };
    },

    async remove(ctx, record, input) {
      const key = await keyOf(ctx);
      const newestFirst = [...record.resources].reverse();

      for (const resource of newestFirst) {
        input.onProgress({ detail: resource.kind === "tunnel" ? "Deleting the tunnel…" : `Deleting the DNS name ${resource.name}…` });
        if (resource.kind === "dns-record") {
          const ids = splitRecordId(resource.id);

          if (ids) await deleteRecord(ctx, key, ids.zoneId, ids.recordId, resource.name);
        } else if (resource.kind === "tunnel") {
          // A tunnel can only be deleted with no connections left.
          const connections = await cfRaw<unknown>(ctx, key, "DELETE", `${tunnelPath(record.account, resource.id)}/connections`);

          if (!connections.ok && connections.status !== 404) throw cfFailure(connections, "DELETE", `${tunnelPath(record.account, resource.id)}/connections`, "disconnect the tunnel");
          const response = await cfRaw<unknown>(ctx, key, "DELETE", tunnelPath(record.account, resource.id));

          if (response.status !== 404 && (!response.ok || response.body?.success === false)) {
            const failure = cfFailure(response, "DELETE", tunnelPath(record.account, resource.id), "delete the tunnel");

            throw response.status === 400 || response.status === 409
              ? new HostingError("host", "Cloudflare won't delete the tunnel while the editor's computer is still connected to it. Stop it there first (docker compose down), then remove again.", failure.detail)
              : failure;
          }
        }
        await input.onRemoved(resource);
      }
    },
  };
}
