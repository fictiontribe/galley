/**
 * Putting a site online, answered from memory for `dev:mock`: the real hosts'
 * setup copy (straight from the engine), a pretend account or two, deploys as
 * `job`s with the same steps the engine reports, a deployment list, and
 * auto-deploy after a publish.
 */
import { randomUUID } from "node:crypto";
// Only the dependency-free setup data (and types): this file is loaded by Node directly, not bundled.
import { CLOUDFLARE_CREDENTIALS, CLOUDFLARE_INFO, VERCEL_CREDENTIALS, VERCEL_INFO, defaultProjectName, projectNameProblem } from "@galley/core/deploy-info";
import type { DeployConfig, DeployKind, DeployStatus, DeployTargetInfo, Deployment, DomainPlan, Job } from "@galley/core/types";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError } from "./site.ts";

type DeployKey =
  | "GET /api/deploy/targets"
  | "POST /api/deploy/targets/:targetId/connect"
  | "POST /api/sites/:siteId/deploy/check"
  | "GET /api/sites/:siteId/deploy"
  | "PUT /api/sites/:siteId/deploy"
  | "POST /api/sites/:siteId/deploy/live-address"
  | "POST /api/sites/:siteId/deploy"
  | "GET /api/sites/:siteId/deployments"
  | "POST /api/sites/:siteId/deploy/domain/plan"
  | "POST /api/sites/:siteId/deploy/domain"
  | "POST /api/sites/:siteId/deploy/domain/check"
  | "DELETE /api/sites/:siteId/deploy/domain";

const TARGETS = [
  { id: "cloudflare", name: "Cloudflare", info: CLOUDFLARE_INFO, credentials: CLOUDFLARE_CREDENTIALS },
  { id: "vercel", name: "Vercel", info: VERCEL_INFO, credentials: VERCEL_CREDENTIALS },
];
const ACCOUNTS: Record<string, Array<{ id: string; name: string }>> = {
  cloudflare: [
    { id: "4f1c0a9e2b7d4c18a3e5f60718293a4b", name: "Studio account" },
    { id: "9a8b7c6d5e4f30211234567890abcdef", name: "Personal" },
  ],
  vercel: [{ id: "team_mock0123456789", name: "Studio" }],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMockDeploy(mock: MockBackend) {
  const configs = new Map<string, DeployConfig>();
  const records = new Map<string, Deployment[]>();
  const jobs = new Map<string, string>();
  const liveAddress = new Set<string>();
  const domainJobs = new Map<string, string>();

  function domainPlan(siteId: string, hostname: string): DomainPlan {
    const config = configs.get(siteId);
    const host = config?.target === "vercel" ? "Vercel" : "Cloudflare";
    const apex = hostname.split(".").slice(-2).join(".");

    if (!config || !records.get(siteId)?.some((record) => record.kind === "production")) return { hostname, status: "not-online", summary: "Put the site online first; then it can answer on your own address.", canAttach: false };
    if (hostname.startsWith("shop.")) return { hostname, status: "taken", summary: `${hostname} already shows another Worker in this account (“storefront”). Choose another address, or free that one on ${host} first. Nothing was changed.`, canAttach: false };
    if (hostname.startsWith("mail.")) return { hostname, status: "dns-conflict", summary: `${apex} already has a DNS record for ${hostname}. This app never replaces DNS records: remove or rename that record on Cloudflare (DNS › Records), then check again. Nothing was changed.`, canAttach: false };
    if (!hostname.endsWith("example.com")) return { hostname, status: "not-in-account", summary: `${apex} isn't a domain in this Cloudflare account, so Cloudflare can't answer ${hostname} with this site — no DNS record elsewhere can do it. Add ${apex} to this Cloudflare account first (it moves the domain's DNS to Cloudflare), or use an address on a domain that is already there.`, canAttach: false, helpUrl: "https://developers.cloudflare.com/fundamentals/manage-domains/add-site/" };
    return { hostname, status: "ready", summary: `${host} will answer ${hostname} with this site and set up its certificate. Nothing else on ${apex} changes.`, canAttach: true };
  }


  const productionUrl = (config: DeployConfig) => (config.target === "vercel" ? `https://${config.project}.vercel.app` : `https://${config.project}.studio-mock.workers.dev`);

  function status(siteId: string): DeployStatus {
    const site = mock.site(siteId);
    const config = configs.get(siteId) ?? null;
    const list = records.get(siteId) ?? [];
    const production = list.find((record) => record.kind === "production") ?? null;
    const at = production ? site.history.findIndex((entry) => entry.commit === production.commit) : -1;
    const jobId = jobs.get(siteId);

    return {
      config,
      production,
      preview: list.find((record) => record.kind === "preview") ?? null,
      job: jobId ? (mock.jobs.get(jobId) ?? null) : null,
      domainJob: domainJobs.get(siteId) ? (mock.jobs.get(domainJobs.get(siteId)!) ?? null) : null,
      behind: production ? (at === -1 ? null : at) : null,
      liveAddressSet: liveAddress.has(siteId),
      suggestedProject: defaultProjectName(site.name),
    };
  }

  function start(siteId: string, kind: DeployKind, label?: string, auto = false): Job {
    const site = mock.site(siteId);
    const config = configs.get(siteId);

    if (!config) throw new MockError("unconfigured", "This site isn't set up to go online yet. Choose a host first.");
    const running = jobs.get(siteId) ? mock.jobs.get(jobs.get(siteId)!) : null;

    if (running?.state === "running") return running;
    const target = TARGETS.find((candidate) => candidate.id === config.target)!;
    const job: Job = { id: randomUUID(), kind: "deploy", label: kind === "production" ? (auto ? "Putting the published version live" : "Putting the site online") : "Making a preview link", state: "running", progress: 0, detail: "Getting ready…", siteId, startedAt: Date.now() };
    const count = 214;
    const steps: Array<[string, number]> = [
      [`Connecting to ${target.name}…`, 0.02],
      [kind === "production" ? "Building the published version…" : "Building the site with your changes…", 0.05],
      ["Checking the files…", 0.35],
      [`Sending ${count} files (3.1 MB) to ${target.name}…`, 0.4],
      [`Uploading 80 of ${count} files…`, 0.6],
      [`Uploading ${count} of ${count} files…`, 0.95],
      [kind === "production" ? `${target.name} is putting it live…` : `${target.name} is preparing the preview…`, 0.95],
    ];

    mock.jobs.set(job.id, job);
    jobs.set(siteId, job.id);
    mock.emit({ type: "job", job: { ...job } });
    void (async () => {
      for (const [detail, progress] of steps) {
        await sleep(650);
        Object.assign(job, { detail, progress });
        mock.emit({ type: "job", job: { ...job } });
      }
      // A site whose name says so fails its build, to show the error state.
      if (site.name.toLowerCase().includes("broken")) {
        Object.assign(job, { state: "error", finishedAt: Date.now(), detail: "The site's own build stopped with a problem, so nothing was uploaded and the live site is as it was.", output: "src/pages/index.astro:12:3\nError: Unexpected token" });
        mock.emit({ type: "job", job: { ...job } });
        return;
      }
      const id = randomUUID();
      const url = kind === "production" ? productionUrl(config) : config.target === "vercel" ? `https://${config.project}-${id.slice(0, 9)}-studio.vercel.app` : `https://${id.slice(0, 8)}-${config.project}.studio-mock.workers.dev`;
      const record: Deployment = { id, kind, target: config.target, project: config.project, url, commit: site.history[0]?.commit ?? null, createdAt: new Date().toISOString(), who: mock.settings.author.name || undefined, files: count, bytes: 3_250_000, ...(label ? { label } : {}) };

      records.set(siteId, [record, ...(records.get(siteId) ?? [])]);
      if (kind === "production") {
        const latest = configs.get(siteId) ?? config;

        configs.set(siteId, { ...latest, defaultUrl: url, ...(latest.domain && !latest.domain.pending ? {} : { productionUrl: url }) });
      }
      Object.assign(job, { state: "done", progress: 1, detail: kind === "production" ? "Live" : "Preview ready", url, finishedAt: Date.now() });
      mock.emit({ type: "job", job: { ...job } });
      mock.emit({ type: "site.updated", siteId });
    })();
    return { ...job };
  }

  const handlers: Pick<Handlers, DeployKey> = {
    "GET /api/deploy/targets": () => ({
      targets: TARGETS.map((target): DeployTargetInfo => ({ ...target.info, credentials: target.credentials, secrets: [mock.secrets[target.credentials[0]!.secret]] })),
    }),
    "POST /api/deploy/targets/:targetId/connect": async ({ params, body }) => {
      const target = TARGETS.find((candidate) => candidate.id === params.targetId);

      if (!target) throw new MockError("not-found", "That host isn't one this app can put sites on.");
      await sleep(500);
      const secret = target.credentials[0]!.secret;
      if (body?.key) {
        // Like the engine: a key containing "wrong" is refused and the stored one stays.
        if (body.key.includes("wrong")) throw new MockError("unconfigured", `${target.name} didn't accept the access key. It may have been deleted or have expired. Create a new one and paste it here.${mock.secrets[secret].configured ? " The key saved before is still the one in use." : ""}`);
        mock.secrets[secret] = { name: secret, configured: true, source: "stored", hint: body.key.slice(-4) };
      }
      if (!mock.secrets[target.credentials[0]!.secret].configured) throw new MockError("unconfigured", `Add a ${target.name} access key first.`);
      if (mock.secrets[target.credentials[0]!.secret].hint === "nope") throw new MockError("unconfigured", `${target.name} didn't accept the access key. It may have been deleted or have expired. Create a new one and paste it here.`);
      return { accounts: ACCOUNTS[target.id] ?? [] };
    },
    "POST /api/sites/:siteId/deploy/check": async ({ body }) => {
      await sleep(300);
      const problem = projectNameProblem(body.project);

      if (problem) return { name: body.project, available: false, existing: false, message: problem };
      const existing = body.project === "taken" || body.project.startsWith("old-");
      const base = { name: body.project, available: true, existing, ...(body.target === "cloudflare" ? { productionUrl: `https://${body.project}.studio-mock.workers.dev` } : {}) };

      return existing ? { ...base, message: `There's already a ${body.target === "vercel" ? "project" : "Worker"} called “${body.project}”. Putting the site there replaces what it serves.` } : base;
    },
    "GET /api/sites/:siteId/deploy": ({ params }) => status(params.siteId),
    "PUT /api/sites/:siteId/deploy": ({ params, body }) => {
      const current = configs.get(params.siteId);
      const next = { ...current, ...body } as DeployConfig;

      if (!next.target || !next.account || !next.project) throw new MockError("invalid", "Choose the host, the account and a project name.");
      configs.set(params.siteId, next);
      // As the engine does: the settings are part of the site, written into its galley.config.json as a change to publish.
      const site = mock.site(params.siteId);
      const config = JSON.parse(site.read("galley.config.json")?.toString("utf8") ?? "{}") as Record<string, unknown>;
      site.write("galley.config.json", Buffer.from(`${JSON.stringify({ ...config, deploy: { target: next.target, account: next.account, project: next.project } }, null, 2)}\n`));
      mock.changed(params.siteId, ["galley.config.json"], "user");
      mock.emit({ type: "site.updated", siteId: params.siteId });
      return status(params.siteId);
    },
    "POST /api/sites/:siteId/deploy/live-address": ({ params }) => {
      if (!configs.get(params.siteId)?.productionUrl) throw new MockError("unconfigured", "The site isn't online yet, so there's no live address to use.");
      liveAddress.add(params.siteId);
      return status(params.siteId);
    },
    "POST /api/sites/:siteId/deploy": ({ params, body }) => start(params.siteId, body.kind, body.label),
    "POST /api/sites/:siteId/deploy/domain/plan": async ({ params, body }) => {
      await sleep(600);
      return domainPlan(params.siteId, body.hostname.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
    },
    "POST /api/sites/:siteId/deploy/domain": ({ params, body }) => {
      const hostname = body.hostname.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const config = configs.get(params.siteId);
      const plan = domainPlan(params.siteId, hostname);
      const job: Job = { id: randomUUID(), kind: "domain", label: `Using ${hostname}`, state: "running", progress: 0, detail: `Checking ${hostname}…`, siteId: params.siteId, startedAt: Date.now() };

      mock.jobs.set(job.id, job);
      domainJobs.set(params.siteId, job.id);
      void (async () => {
        const steps: Array<[string, number]> = [[`Asking ${config?.target === "vercel" ? "Vercel" : "Cloudflare"} to answer ${hostname}…`, 0.2], [`Waiting for ${hostname} to answer — Cloudflare is setting up its certificate…`, 0.5]];

        if (!plan.canAttach) {
          await sleep(500);
          Object.assign(job, { state: "error", detail: plan.summary, finishedAt: Date.now() });
          mock.emit({ type: "job", job: { ...job } });
          return;
        }
        for (const [detail, progress] of steps) {
          await sleep(1500);
          Object.assign(job, { detail, progress });
          mock.emit({ type: "job", job: { ...job } });
        }
        await sleep(2500);
        configs.set(params.siteId, { ...configs.get(params.siteId)!, productionUrl: `https://${hostname}`, domain: { hostname, attached: true } });
        Object.assign(job, { state: "done", progress: 1, url: `https://${hostname}`, detail: `${hostname} answers`, finishedAt: Date.now() });
        mock.emit({ type: "job", job: { ...job } });
        mock.emit({ type: "site.updated", siteId: params.siteId });
      })();
      return { ...job };
    },
    "POST /api/sites/:siteId/deploy/domain/check": ({ params }) => {
      const config = configs.get(params.siteId);

      if (!config?.domain) throw new MockError("invalid", "This site isn't using an address of its own.");
      const job: Job = { id: randomUUID(), kind: "domain", label: `Using ${config.domain.hostname}`, state: "done", progress: 1, url: `https://${config.domain.hostname}`, detail: `${config.domain.hostname} answers`, siteId: params.siteId, startedAt: Date.now(), finishedAt: Date.now() };

      mock.jobs.set(job.id, job);
      domainJobs.set(params.siteId, job.id);
      return job;
    },
    "DELETE /api/sites/:siteId/deploy/domain": ({ params }) => {
      const config = configs.get(params.siteId);

      if (config?.domain) {
        const { domain: _gone, ...rest } = config;

        configs.set(params.siteId, { ...rest, ...(config.defaultUrl ? { productionUrl: config.defaultUrl } : {}) });
      }
      mock.emit({ type: "site.updated", siteId: params.siteId });
      return status(params.siteId);
    },
    "GET /api/sites/:siteId/deployments": ({ params, query }) => ({ items: (records.get(params.siteId) ?? []).slice(0, query.limit ? Number(query.limit) : 50) }),
  };

  return {
    handlers,
    /** After a mock publish: put it live when the site says so. */
    afterPublish(siteId: string) {
      if (configs.get(siteId)?.autoDeploy) start(siteId, "production", undefined, true);
    },
  };
}
