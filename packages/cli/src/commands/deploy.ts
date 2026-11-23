/**
 * `galley deploy` — put a site online with Cloudflare or Vercel from the
 * terminal, with the same engine the app uses.
 *
 * It asks only what it must, and only on a terminal: the host (Cloudflare
 * unless the site is already set up), the access key (unless one is stored or
 * in CLOUDFLARE_API_TOKEN / VERCEL_TOKEN), the account when there is more than
 * one, and the project name. With flags and the environment providing all of
 * it — or `--yes` taking the defaults — it never asks, so it runs in CI.
 */
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { createDeployService, deployMessage, formatBytes, type DeployService } from "@galley/core/deploy";
import type { DeployAccount, DeployConfig, DeployTargetInfo, Job } from "@galley/core/types";
import { defaultHome, openSingleSite } from "@galley/server";
import { parse, UsageError } from "../args";
import type { Io } from "../io";
import { useDomain } from "./domain";

export const DEPLOY_HELP = `Usage: ${PRODUCT.slug} deploy [path] [options]

Put the site in [path] (default: this folder) online with Cloudflare or
Vercel, and print its address. Without --preview it puts the last published
version live — never unpublished changes. The first run sets the site up,
asking only for what it can't find; the choices are saved in
${PRODUCT.configFile} (ids only: the access key stays in ${PRODUCT.name}'s secrets).

Options
      --preview         Upload the site as it is, unpublished changes included,
                        to a preview address of its own
      --target <host>   cloudflare (default) or vercel
      --project <name>  The project on the host (default: from the site's name)
      --account <id>    The Cloudflare account or Vercel team
      --domain <host>   Afterwards, use your own address for the live site
                        (see \`${PRODUCT.slug} domain --help\`)
  -y, --yes             Don't ask: take the defaults (and an existing project)
      --json            Print the result as JSON
  -h, --help            Show this help

Access keys
  Read from CLOUDFLARE_API_TOKEN or VERCEL_TOKEN when set, otherwise the one
  stored with the app, otherwise asked for on a terminal (and stored).
  CLOUDFLARE_ACCOUNT_ID and VERCEL_TEAM_ID name the account when there are several.

Examples
  ${PRODUCT.slug} deploy                       Put the published site live
  ${PRODUCT.slug} deploy --preview             Share unpublished changes
  ${PRODUCT.slug} deploy ./site --target vercel --project my-site --yes`;

export interface DeployIo extends Io {
  /** Ask a question on the terminal. Absent (or not a terminal): never ask. */
  prompt?: (question: string, options?: { secret?: boolean }) => Promise<string>;
}

/** A readline prompt on this process's terminal, or null when there is none. */
function terminalPrompt(): DeployIo["prompt"] | null {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return null;
  return (question, options = {}) =>
    new Promise((done) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });

      if (options.secret) {
        // Echo nothing for a pasted key: it must not be left on the screen or in scrollback.
        (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = (text: string) => {
          if (text.includes(question)) process.stderr.write(text);
        };
      }
      rl.question(question, (answer) => {
        rl.close();
        if (options.secret) process.stderr.write("\n");
        done(answer.trim());
      });
    });
}

async function choose<T>(ask: NonNullable<DeployIo["prompt"]>, io: Io, title: string, items: T[], label: (item: T) => string): Promise<T> {
  io.err(title);
  items.forEach((item, index) => io.err(`  ${index + 1}. ${label(item)}`));
  for (;;) {
    const answer = await ask(`Choose 1–${items.length} [1]: `);
    const pick = answer === "" ? 1 : Number(answer);

    if (Number.isInteger(pick) && pick >= 1 && pick <= items.length) return items[pick - 1]!;
    io.err(`Type a number from 1 to ${items.length}.`);
  }
}

interface Plan {
  target: DeployTargetInfo;
  account: string;
  project: string;
}

async function plan(io: DeployIo, deploy: DeployService, site: Parameters<DeployService["status"]>[0], values: { target?: string; project?: string; account?: string; yes?: boolean }): Promise<Plan> {
  const ask = values.yes ? null : (io.prompt ?? null);
  const status = await deploy.status(site);
  const config: DeployConfig | null = status.config;
  const targets = await deploy.targets();
  let targetId = values.target ?? config?.target;

  if (!targetId && ask) {
    targetId = (await choose(ask, io, "Where should the site go?", targets, (target) => `${target.name}${target.recommended ? " (recommended)" : ""} — ${target.blurb}`)).id;
  }
  const target = targets.find((candidate) => candidate.id === (targetId ?? "cloudflare"));

  if (!target) throw new UsageError(`--target must be one of ${targets.map((candidate) => candidate.id).join(", ")}, not “${targetId}”.`);
  const sameHost = config?.target === target.id;
  let connected: DeployAccount[] | null = null;
  const secret = target.credentials[0]!.secret;

  if (!target.secrets.some((status) => status.name === secret && status.configured)) {
    const variable = target.id === "cloudflare" ? "CLOUDFLARE_API_TOKEN" : "VERCEL_TOKEN";

    if (!ask) throw new UsageError(`No ${target.name} access key. Set ${variable}, or run \`${PRODUCT.slug} deploy\` on a terminal to paste one. How to make one: ${target.keyUrl}`);
    io.err(`${target.name} needs an access key. Make one at ${target.keyUrl}:`);
    target.keySteps.forEach((step, index) => io.err(`  ${index + 1}. ${step}`));
    io.err(`  ${target.keyGrants}`);
    const value = await ask(`Paste the ${target.name} access key: `, { secret: true });

    if (!value) throw new UsageError("No key was pasted, so nothing was put online.");
    // Checked with the host first; only a key it accepts is stored.
    connected = (await deploy.connect(target.id, { key: value })).accounts;
  }
  let account = values.account ?? (sameHost ? config?.account : undefined);

  if (!account) {
    const accounts = connected ?? (await deploy.connect(target.id)).accounts;

    if (accounts.length === 1) account = accounts[0]!.id;
    else if (accounts.length > 1 && ask) account = (await choose<DeployAccount>(ask, io, `Which ${target.accountNoun}?`, accounts, (entry) => `${entry.name} (${entry.id})`)).id;
    else if (accounts.length > 1) {
      throw new UsageError(`The key can use ${accounts.length} ${target.accountNoun}s; say which with --account: ${accounts.map((entry) => `${entry.id} (${entry.name})`).join(", ")}.`);
    } else if (ask) {
      io.err(`The key can't list ${target.accountNoun}s. ${target.accountHelp}`);
      account = await ask(`${target.accountNoun[0]!.toUpperCase()}${target.accountNoun.slice(1)} ID: `);
    }
    if (!account) throw new UsageError(`Say which ${target.accountNoun} with --account. ${target.accountHelp}`);
  }
  let project = values.project ?? (sameHost ? config?.project : undefined);

  if (!project) {
    project = status.suggestedProject;
    if (ask) project = (await ask(`Project name on ${target.name} [${project}]: `)) || project;
  }
  if (!sameHost || config?.account !== account || config?.project !== project) {
    const check = await deploy.checkProject({ target: target.id, account, name: project, site });

    if (!check.available) throw new UsageError(check.message ?? `“${project}” can't be used as a project name.`);
    if (check.existing && ask) {
      const answer = await ask(`${check.message} Continue? [y/N] `);

      if (!/^y(es)?$/i.test(answer)) throw new UsageError("Nothing was put online. Choose another name with --project.");
    }
  }
  return { target, account, project };
}

export async function deployCommand(argv: string[], io: DeployIo): Promise<number> {
  const { values, positionals } = parse(
    "deploy",
    argv,
    {
      preview: { type: "boolean" },
      target: { type: "string" },
      project: { type: "string" },
      account: { type: "string" },
      domain: { type: "string" },
      yes: { type: "boolean", short: "y" },
      json: { type: "boolean" },
    },
    1
  );

  if (values.help) {
    io.out(DEPLOY_HELP);
    return 0;
  }
  const json = Boolean(values.json);
  const ioWithPrompt: DeployIo = { ...io, ...(io.prompt === undefined && !json ? { prompt: terminalPrompt() ?? undefined } : {}) } as DeployIo;
  const root = resolve(io.cwd, positionals[0] ?? ".");
  const home = defaultHome(io.env);
  const engine = await (io.openSite ?? openSingleSite)({ root, home, env: io.env, watch: false });
  const deploy = createDeployService({ home, settings: engine.settings, events: engine.events, env: io.env });
  const kind = values.preview ? "preview" : "production";

  try {
    const chosen = await plan(ioWithPrompt, deploy, engine.site, values);
    const status = await deploy.status(engine.site);

    if (status.config?.target !== chosen.target.id || status.config.account !== chosen.account || status.config.project !== chosen.project) {
      await deploy.configure(engine.site, { target: chosen.target.id, account: chosen.account, project: chosen.project });
    }
    let last = "";
    const deployment = await deploy.run(engine.site, { kind }, (job: Job) => {
      if (json || !job.detail || job.detail === last || job.state !== "running") return;
      last = job.detail;
      io.err(job.detail);
    });

    if (json) {
      io.out(JSON.stringify({ ok: true, ...deployment }));
    } else if (kind === "production") {
      io.out(`✓ Live at ${deployment.url}`);
      io.err(`  ${deployment.files} files, ${formatBytes(deployment.bytes)} on ${chosen.target.name} (${chosen.project}).`);
    } else {
      io.out(`✓ Preview at ${deployment.url}`);
      io.err(`  It shows unpublished changes. ${chosen.target.previewNote}`);
    }
    // Then the site's own address, the same way `galley domain` does it.
    if (values.domain) {
      if (kind !== "production") throw new UsageError("--domain goes with a live deploy, not --preview.");
      return await useDomain(ioWithPrompt, deploy, engine.events, engine.site, values.domain, { yes: Boolean(values.yes), json });
    }
    return 0;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    const message = deployMessage(error);
    const detail = (error as { detail?: string }).detail;

    if (json) io.out(JSON.stringify({ ok: false, error: message, ...(detail ? { detail } : {}) }));
    else {
      io.err(`! ${message}`);
      if (detail) io.err(detail.split("\n").map((line) => `  ${line}`).join("\n"));
    }
    return 1;
  } finally {
    deploy.dispose();
    await engine.dispose();
  }
}
