/**
 * "Any server with Docker": no account and no API. The plan is the files —
 * the editor and Caddy in one compose project (or behind a Caddy the server's
 * editors share), a Caddyfile and an .env — and the steps: three DNS names
 * pointing at the server, then `docker compose up -d`. Nothing is created
 * anywhere by this app, so there is nothing for it to remove; `check` hands
 * the site over once the install answers at its address.
 */
import { PRODUCT } from "../brand";
import { recipeFiles, type RecipeProxy } from "./recipe";
import type { CostEstimate, EditorAddresses, EditorHost, HostedEditorRecord, ManualStep, RecipeFile } from "./types";

/**
 * What a small server costs, from the providers' own pages (read 2026-11-23):
 * DigitalOcean's Basic Droplet with 2 GiB, 1 vCPU, 50 GiB disk is $12.00 a
 * month with its IPv4 address included; Hetzner's CPX12 (1 vCPU, 2 GB) is
 * from €9.99 a month before VAT.
 */
export const OWN_SERVER_COST: CostEstimate = {
  monthly: 12,
  currency: "USD",
  lines: [
    { label: "A server with 2 GB of memory (for example DigitalOcean's Basic Droplet: 1 CPU, 50 GB disk, address included)", amount: 12 },
    { label: "HTTPS certificates (Caddy gets them from Let's Encrypt)", amount: 0 },
  ],
  note: "What a small server costs: $12.00 a month at DigitalOcean, or from €9.99 a month before VAT for Hetzner's CPX12 (1 CPU, 2 GB). On a server you already have, nothing more.",
  source: "https://www.digitalocean.com/pricing/droplets",
  checked: "2026-11-23",
};

function proxyOf(options: Record<string, string> | undefined): RecipeProxy {
  return options?.proxy === "shared-proxy" ? "shared-proxy" : "caddy";
}

function steps(addresses: EditorAddresses, proxy: RecipeProxy, name: string): ManualStep[] {
  const names = [addresses.editor, addresses.preview, addresses.live];

  return [
    {
      title: "Point the three addresses at the server",
      detail: `At the company that holds your domain, add an A record (and an AAAA record, if the server has an IPv6 address) for each of ${names.join(", ")}, with the server's address. If the domain is on Cloudflare, set them to “DNS only”: Caddy makes the certificates itself.`,
      copy: names.map((host) => `${host}.  A  <the server's IPv4 address>`).join("\n"),
    },
    {
      title: "Copy the files to the server",
      detail: proxy === "shared-proxy"
        ? `Put compose.yaml and .env in a folder of their own (one folder per editor). The first time on this server, also start the shared Caddy from proxy/ and put ${name}.caddy in its sites/ folder.`
        : "Put compose.yaml, Caddyfile and .env in a folder of their own on the server. It needs Docker, with ports 80 and 443 open to the internet.",
    },
    { title: "Start it", detail: "In that folder, start the editor. The first start downloads it and takes a minute or two.", copy: "docker compose up -d" },
    { title: "Then come back and choose Check", detail: `Once ${addresses.editor} answers, the site is handed over and you get the first-run link.` },
  ];
}

function filesFor(record: Pick<HostedEditorRecord, "name" | "addresses" | "image" | "environment">, proxy: RecipeProxy): RecipeFile[] {
  return recipeFiles({ name: record.name, addresses: record.addresses, image: record.image, proxy, ...(record.environment?.GALLEY_SETUP_TOKEN_SHA256 ? { setupTokenSha256: record.environment.GALLEY_SETUP_TOKEN_SHA256 } : {}) });
}

export function createOwnServerHost(): EditorHost {
  return {
    id: "own-server",
    name: "Any server with Docker",
    apis: {},
    info: {
      id: "own-server",
      name: "Any server with Docker",
      summary: `Writes the files to run the editor on any server of yours with Docker, with HTTPS from Caddy. Nothing is created on an account; you start it there.`,
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
      docsUrl: "https://caddyserver.com/docs/caddyfile/directives/reverse_proxy",
    },

    async inspect() {
      return { accounts: [], regions: [], domains: [], gaps: [] };
    },

    async plan(_ctx, request, input) {
      const proxy = proxyOf(request.options);
      const record = { name: request.name, addresses: input.addresses, image: input.image, ...(input.environment ? { environment: input.environment } : {}) };

      return { resources: [], cost: OWN_SERVER_COST, steps: steps(input.addresses, proxy, request.name), files: filesFor(record, proxy), problems: [] };
    },

    async create(_ctx, input) {
      input.onProgress({ detail: `The files are ready. Start them on your server; ${PRODUCT.name} hands the site over once it answers.`, progress: 1 });
    },

    async pending(_ctx, record) {
      const proxy = proxyOf(record.options);

      return { steps: steps(record.addresses, proxy, record.name), files: filesFor(record, proxy) };
    },

    async backup(_ctx, record) {
      return {
        kind: "page",
        url: `https://${record.addresses.editor}/install`,
        message: "Backups of an editor on your own server are downloaded from its Install page. To copy its whole disk, back up the Docker volume on the server.",
      };
    },

    async removal() {
      return { resources: [], skipped: [] };
    },

    async remove(_ctx, _record, input) {
      input.onProgress({ detail: "Nothing was created on an account, so there is nothing to delete there.", progress: 1 });
    },
  };
}

