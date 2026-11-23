/**
 * Putting a site online, answered from memory for `dev:mock`: the real hosts'
 * setup copy (straight from the engine), a pretend account or two, deploys as
 * `job`s with the same steps the engine reports, a deployment list, and
 * auto-deploy after a publish.
 */
import { randomUUID } from "node:crypto";
// Only the dependency-free setup data (and types): this file is loaded by Node directly, not bundled.
import { CLOUDFLARE_CREDENTIALS, CLOUDFLARE_INFO, VERCEL_CREDENTIALS, VERCEL_INFO, defaultProjectName, projectNameProblem } from "@galley/core/deploy-info";
import type { DeployConfig, DeployKind, DeployStatus, DeployTargetInfo, Deployment, Job } from "@galley/core/types";
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
  | "GET /api/sites/:siteId/deployments";

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
      [`Uploading ${count} files (3.1 MB)…`, 0.4],
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
      if (kind === "production") configs.set(siteId, { ...config, productionUrl: url });
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
      mock.emit({ type: "site.updated", siteId: params.siteId });
      return status(params.siteId);
    },
    "POST /api/sites/:siteId/deploy/live-address": ({ params }) => {
      if (!configs.get(params.siteId)?.productionUrl) throw new MockError("unconfigured", "The site isn't online yet, so there's no live address to use.");
      liveAddress.add(params.siteId);
      return status(params.siteId);
    },
    "POST /api/sites/:siteId/deploy": ({ params, body }) => start(params.siteId, body.kind, body.label),
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
