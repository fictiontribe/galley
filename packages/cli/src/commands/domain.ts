/**
 * `galley domain` — use your own domain for a site that is online: show the
 * plan (nothing changes), attach on yes, wait until it answers over HTTPS.
 * `galley deploy --domain <hostname>` runs the same after a live deploy.
 */
import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { createDeployService, deployMessage, type DeployService } from "@galley/core/deploy";
import type { EventBus, Job, SiteService } from "@galley/core/types";
import { defaultHome, openSingleSite } from "@galley/server";
import { parse, UsageError } from "../args";
import type { DeployIo } from "./deploy";

export const DOMAIN_HELP = `Usage: ${PRODUCT.slug} domain [path] [hostname] [options]

Use your own domain for the site in [path] (default: this folder), which must
already be online. With a hostname: show what will change, attach it on yes,
and wait until it answers over HTTPS — it then becomes the site's live
address. Without one: show the address in use.

Options
      --check     Look again at an address that isn't answering yet
      --remove    Stop using the address (it is detached only if ${PRODUCT.name} attached it)
  -y, --yes       Don't ask before attaching or removing
      --json      Print the result as JSON
  -h, --help      Show this help

Examples
  ${PRODUCT.slug} domain www.example.com
  ${PRODUCT.slug} domain ./site --remove --yes`;

/** Waits for a domain job's end, printing each new step. */
function follow(events: EventBus, deploy: DeployService, job: Job, onStep: (detail: string) => void): Promise<Job> {
  return new Promise((done) => {
    let last = "";
    const settle = (next: Job) => {
      if (next.detail && next.detail !== last) {
        last = next.detail;
        if (next.state === "running") onStep(next.detail);
      }
      if (next.state !== "running") {
        unsubscribe();
        done(next);
      }
    };
    const unsubscribe = events.subscribe((event) => {
      if (event.type === "job" && event.job.id === job.id) settle(event.job);
    });

    settle(deploy.job(job.id) ?? job);
  });
}

/** Plan → yes → attach → wait. Returns the exit code. Shared with `deploy --domain`. */
export async function useDomain(io: DeployIo, deploy: DeployService, events: EventBus, site: SiteService, hostname: string, options: { yes: boolean; json: boolean }): Promise<number> {
  const plan = await deploy.planDomain(site, hostname);

  if (!options.json) {
    io.err(plan.summary);
    for (const record of plan.records ?? []) io.err(`  ${record.type}  ${record.name}  ${record.value}`);
    if (plan.helpUrl) io.err(`  ${plan.helpUrl}`);
  }
  if (!plan.canAttach && plan.status !== "already") {
    if (options.json) io.out(JSON.stringify({ ok: false, plan }));
    return 1;
  }
  if (!options.yes) {
    if (!io.prompt) throw new UsageError(`Nothing was changed. Run it again with --yes to use ${plan.hostname}.`);
    const answer = await io.prompt(`Use ${plan.hostname}? [y/N] `);

    if (!/^y(es)?$/i.test(answer)) {
      io.err("Nothing was changed.");
      return 1;
    }
  }
  const job = await follow(events, deploy, await deploy.attachDomain(site, plan.hostname), (detail) => !options.json && io.err(detail));

  return report(io, deploy, site, job, options.json);
}

async function report(io: DeployIo, deploy: DeployService, site: SiteService, job: Job, json: boolean): Promise<number> {
  const status = await deploy.status(site);

  if (json) io.out(JSON.stringify({ ok: job.state === "done", job, address: status.config?.productionUrl ?? null, records: status.domainRecords ?? [] }));
  else if (job.state === "done" && job.url) io.out(`✓ ${job.url} answers — it's the site's live address now.`);
  else if (job.state === "done") {
    io.out(`! ${job.detail}`);
    for (const record of status.domainRecords ?? []) io.out(`  ${record.type}  ${record.name}  ${record.value}`);
    io.out(`  Then run \`${PRODUCT.slug} domain --check\`.`);
  } else io.err(`! ${job.detail}`);
  return job.state === "done" && job.url ? 0 : 1;
}

export async function domainCommand(argv: string[], io: DeployIo): Promise<number> {
  const { values, positionals } = parse("domain", argv, { check: { type: "boolean" }, remove: { type: "boolean" }, yes: { type: "boolean", short: "y" }, json: { type: "boolean" } }, 2);

  if (values.help) {
    io.out(DOMAIN_HELP);
    return 0;
  }
  // [path] [hostname]: a lone argument with a dot and no slash is the hostname.
  const lone = positionals.length === 1 && /\./.test(positionals[0]!) && !/[/\\]/.test(positionals[0]!) && !positionals[0]!.startsWith(".");
  const path = lone ? "." : (positionals[0] ?? ".");
  const hostname = lone ? positionals[0] : positionals[1];

  if (values.check && values.remove) throw new UsageError("Use either --check or --remove, not both.");
  if (hostname && (values.check || values.remove)) throw new UsageError("Give a hostname to use it, or --check / --remove for the one in use — not both.");
  const home = defaultHome(io.env);
  const engine = await (io.openSite ?? openSingleSite)({ root: resolve(io.cwd, path), home, env: io.env, watch: false });
  const deploy = createDeployService({ home, settings: engine.settings, events: engine.events, env: io.env });
  const json = Boolean(values.json);

  try {
    const status = await deploy.status(engine.site);
    const domain = status.config?.domain;

    if (hostname) return await useDomain(io, deploy, engine.events, engine.site, hostname, { yes: Boolean(values.yes), json });
    if (values.check) {
      if (!domain) throw new UsageError("This site isn't using an address of its own.");
      return await report(io, deploy, engine.site, await follow(engine.events, deploy, await deploy.checkDomain(engine.site), (detail) => !json && io.err(detail)), json);
    }
    if (values.remove) {
      if (!domain) throw new UsageError("This site isn't using an address of its own.");
      if (!values.yes) {
        if (!io.prompt) throw new UsageError(`Nothing was changed. Run it again with --yes to stop using ${domain.hostname}.`);
        if (!/^y(es)?$/i.test(await io.prompt(`Stop using ${domain.hostname}? [y/N] `))) return 1;
      }
      const after = await deploy.detachDomain(engine.site);

      if (json) io.out(JSON.stringify({ ok: true, address: after.config?.productionUrl ?? null }));
      else io.out(`✓ Stopped using ${domain.hostname}.${after.config?.productionUrl ? ` The live address is ${after.config.productionUrl} again.` : ""}${domain.attached ? "" : ` It was set up outside ${PRODUCT.name}, so it stays as it is on the host.`}`);
      return 0;
    }
    if (json) io.out(JSON.stringify({ address: status.config?.productionUrl ?? null, domain: domain ?? null, hostAddress: status.config?.defaultUrl ?? null }));
    else if (domain) io.out(`${domain.hostname}${domain.pending ? " — attached, not answering yet" : ""}`);
    else io.out(`No address of its own.${status.config?.productionUrl ? ` Live at ${status.config.productionUrl}.` : ""}`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    const message = deployMessage(error);

    if (json) io.out(JSON.stringify({ ok: false, error: message }));
    else io.err(`! ${message}`);
    return 1;
  } finally {
    deploy.dispose();
    await engine.dispose();
  }
}
