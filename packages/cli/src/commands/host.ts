/**
 * `galley host` — "Host the editor online" from the terminal, with the same
 * engine the app uses: a hosted install of this app for the site, on the
 * person's own account (Fly.io or Google Cloud), behind Cloudflare on a
 * computer of theirs, or on any server with Docker.
 *
 * It always prints the plan and its monthly cost first; `--dry-run` stops
 * there having created nothing, and without `--yes` it asks. It asks only on
 * a terminal, never in CI. Afterwards the same command shows the editor's
 * status and first-run link, checks a self-run install, upgrades it, backs it
 * up and removes it. `galley host recipe` needs no site and no account: it
 * writes the files to run an install with Docker.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import {
  builtInEditorHosts,
  createHostingService,
  addressProblem,
  editorNameProblem,
  IMAGE_REFERENCE,
  RECIPE_PROXIES,
  recipeFiles,
  resolveAddresses,
  defaultImage,
  type EditorHostAccount,
  type EditorHostInfo,
  type HostedEditorPlan,
  type HostingService,
  type RecipeFile,
  type RecipeProxy,
} from "@galley/core/hosting";
import type { Job, SecretName } from "@galley/core/types";
import { defaultHome, openSingleSite, type SingleSiteEngine } from "@galley/server";
import { parse, UsageError } from "../args";
import type { Io } from "../io";

export const HOST_HELP = `Usage: ${PRODUCT.slug} host [path] --host <where> --address <name> [options]
       ${PRODUCT.slug} host status|link|check|upgrade|backup|remove [path]
       ${PRODUCT.slug} host recipe --name <name> --address <name> [options]

Put an editor for the site in [path] (default: this folder) online, on your
own account: a hosted ${PRODUCT.name} with its own disk, at three addresses of
your domain (the editor, its preview and the live comparison). It prints
everything it would create and what it costs a month before anything is
created, and asks before creating it. The site's settings
(${PRODUCT.configFile} › editor) then say where its editor lives.

Where (--host)
  fly           Fly.io: everything is created on your Fly.io account
  gcp           Google Cloud: a virtual machine of its own, with its own disk,
                network and fixed address, in your Google Cloud project
  cloudflare    Cloudflare in front of a computer of yours: a tunnel and three
                DNS names on Cloudflare; you start the files it writes
  own-server    Any server with Docker: it writes the files, you start them

Options
      --address <name>     The editor's address, like cms.example.com
      --preview-address <name>  The preview's address (default: worked out from
                           --address, cms.example.com → cms-preview.example.com)
      --live-address <name>     The live comparison's (→ cms-live.example.com).
                           Give both for an address like example.co.uk, whose
                           worked-out names would be someone else's domain
      --name <name>        The short name everything created carries
                           (default: from the site's name)
      --account <id>       The Fly.io organization, Google Cloud project or
                           Cloudflare account
      --region <id>        Where it runs (Fly.io default: iad; Google Cloud
                           default: us-central1)
      --option <key=value> A host's own choice, e.g. memory=1024, sleep=off,
                           size=e2-medium, proxy=shared-proxy (repeatable)
      --hand-over <keys>   Keys to copy to it, by name, comma-separated
                           (e.g. anthropic). Default: none
      --out <folder>       Where to write the files a self-run install needs
                           (default: a folder named after it, here)
      --dry-run            Print the plan and stop: nothing is created
  -y, --yes                Don't ask: create (or remove) what the plan says
      --json               Print the result as JSON
  -h, --help               Show this help

Afterwards
  status     Where the editor is, whether it answers, what is left to do
  link       The first-run link, while its first run isn't finished
  check      Look again (after starting the files or adding DNS names by
             hand) and hand the site over once it answers
  upgrade    Move it to this version of ${PRODUCT.name}, keeping its disk
  backup     Copy its disk on the host, or say where backups are downloaded
  remove     Print exactly what will be deleted, then delete it (asks; --yes)

recipe: the files to run one install with Docker, for an operator
      --name <name> --address <name>      Required
      --preview-address <name> --live-address <name>  As above
      --repository <address>  The site's repository
      --folder <path>         Where the site is inside it ("apps/site")
      --proxy <how>           caddy (default), shared-proxy or tunnel
      --image <reference>     Default: ${defaultImage({})}
      --setup-token-sha256 <hex>  The SHA-256 of a one-time setup code
      --out <folder|->        Write the files there (default -: print them)

Keys
  Read from FLY_API_TOKEN, GOOGLE_APPLICATION_CREDENTIALS_JSON (the whole
  key file's text) or CLOUDFLARE_API_TOKEN when set, otherwise the one stored
  with the app, otherwise asked for on a terminal (and stored). For Google
  Cloud, paste the key file or type the path to it.

Examples
  ${PRODUCT.slug} host --host fly --address cms.example.com --dry-run
  ${PRODUCT.slug} host --host gcp --region europe-west1 --address cms.example.com
  ${PRODUCT.slug} host --host own-server --address cms.example.com --yes
  ${PRODUCT.slug} host recipe --name acme-editor --address cms.example.com --out ./acme`;

export interface HostIo extends Io {
  /** Ask a question on the terminal. Absent (or not a terminal): never ask. */
  prompt?: (question: string, options?: { secret?: boolean }) => Promise<string>;
}

const SUBCOMMANDS = new Set(["status", "link", "check", "upgrade", "backup", "remove", "recipe"]);
const KEY_VARIABLE: Partial<Record<SecretName, string>> = { fly: "FLY_API_TOKEN", gcp: "GOOGLE_APPLICATION_CREDENTIALS_JSON", cloudflare: "CLOUDFLARE_API_TOKEN" };

function terminalPrompt(): HostIo["prompt"] | null {
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

async function choose<T>(ask: NonNullable<HostIo["prompt"]>, io: Io, title: string, items: T[], label: (item: T) => string): Promise<T> {
  io.err(title);
  items.forEach((item, index) => io.err(`  ${index + 1}. ${label(item)}`));
  for (;;) {
    const answer = await ask(`Choose 1–${items.length} [1]: `);
    const pick = answer === "" ? 1 : Number(answer);

    if (Number.isInteger(pick) && pick >= 1 && pick <= items.length) return items[pick - 1]!;
    io.err(`Type a number from 1 to ${items.length}.`);
  }
}

const money = (amount: number, currency: string) => `${currency === "EUR" ? "€" : "$"}${amount.toFixed(2)}`;

function printPlan(io: Io, plan: HostedEditorPlan): void {
  io.out(`${plan.hostName}: the editor “${plan.name}”${plan.account ? ` in ${plan.account}` : ""}`);
  io.out(`  Editor:          https://${plan.addresses.editor}`);
  io.out(`  Preview:         https://${plan.addresses.preview}`);
  io.out(`  Live comparison: https://${plan.addresses.live}`);
  io.out(`  Runs:            ${plan.image}`);
  if (plan.resources.length) {
    io.out("");
    io.out("Creates, in this order:");
    for (const resource of plan.resources) io.out(`  - ${resource.kind} “${resource.name}”${resource.detail ? `: ${resource.detail}` : ""}`);
  } else {
    io.out("");
    io.out("Creates nothing on an account.");
  }
  io.out("");
  io.out(`Costs about ${money(plan.cost.monthly, plan.cost.currency)} a month:`);
  for (const line of plan.cost.lines) io.out(`  ${money(line.amount, plan.cost.currency).padStart(8)}  ${line.label}`);
  io.out(`  ${plan.cost.note}`);
  io.out(`  Prices from ${plan.cost.source}, read ${plan.cost.checked}.`);
  io.out("");
  if (plan.handover.length) {
    io.out("Hands the new editor:");
    for (const line of plan.handover) io.out(`  - ${line.label}: ${line.value}`);
  } else io.out("Hands the new editor nothing: its setup screen asks for everything.");
  if (plan.steps.length) {
    io.out("");
    io.out("You then:");
    plan.steps.forEach((step, index) => {
      io.out(`  ${index + 1}. ${step.title}. ${step.detail}`);
      if (step.copy) for (const line of step.copy.split("\n")) io.out(`       ${line}`);
    });
  }
  if (plan.files.length) io.out(`\nFiles to run it: ${plan.files.map((file) => file.name).join(", ")}`);
  if (plan.problems.length) {
    io.out("");
    io.out("It can't go ahead:");
    for (const problem of plan.problems) io.out(`  ! ${problem.message}${problem.fix ? ` ${problem.fix}` : ""}`);
  }
}

/** Writes files into `folder`; a file that may hold a key is readable by this user only. */
function writeFiles(folder: string, files: RecipeFile[]): void {
  for (const file of files) {
    const path = join(folder, file.name);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content, file.sensitive ? { mode: 0o600 } : {});
    if (file.sensitive) chmodSync(path, 0o600);
  }
}

function outFolder(io: Io, out: string | undefined, name: string): string {
  const folder = resolve(io.cwd, out ?? `${name}-files`);

  if (!out && existsSync(folder) && readdirSync(folder).length > 0) throw new UsageError(`${folder} already has files in it. Say where to write them with --out.`);
  return folder;
}

async function follow(io: Io, hosting: HostingService, job: Job, json: boolean): Promise<Job> {
  let last = "";

  return hosting.wait(job.id, (update) => {
    if (json || !update.detail || update.detail === last || update.state !== "running") return;
    last = update.detail;
    io.err(update.detail);
  });
}

function fail(io: Io, json: boolean, message: string, detail?: string): number {
  if (json) io.out(JSON.stringify({ ok: false, error: message, ...(detail ? { detail } : {}) }));
  else {
    io.err(`! ${message}`);
    if (detail) io.err(detail.split("\n").map((line) => `  ${line}`).join("\n"));
  }
  return 1;
}

/** An address given with --preview-address or --live-address, checked like the editor's; undefined when not given. */
function givenAddress(value: string | undefined, option: string, what: string): string | undefined {
  if (value === undefined) return undefined;
  const problem = addressProblem(value, what);

  if (problem) throw new UsageError(`--${option}: ${problem}`);
  return value.trim();
}

/**
 * The three addresses from --address, --preview-address and --live-address:
 * each checked like the editor's, the last two worked out from the first
 * when not given. Problems are usage errors naming the option.
 */
function addressesFrom(values: { address?: string; "preview-address"?: string; "live-address"?: string }) {
  const problem = addressProblem(values.address ?? "");

  if (problem) throw new UsageError(`--address: ${problem}`);
  givenAddress(values["preview-address"], "preview-address", "The preview's address");
  givenAddress(values["live-address"], "live-address", "The live comparison's address");
  const resolved = resolveAddresses({
    address: values.address!,
    ...(values["preview-address"] ? { previewAddress: values["preview-address"] } : {}),
    ...(values["live-address"] ? { liveAddress: values["live-address"] } : {}),
  });

  if ("problem" in resolved) {
    throw new UsageError(
      values["preview-address"] && values["live-address"]
        ? resolved.problem
        : `--address: no preview and live comparison names can be made from ${values.address}. Use a name like cms.example.com, or give --preview-address and --live-address.`
    );
  }
  return resolved.addresses;
}

function recipe(argv: string[], io: Io): number {
  const { values } = parse(
    "host recipe",
    argv,
    {
      name: { type: "string" },
      address: { type: "string" },
      "preview-address": { type: "string" },
      "live-address": { type: "string" },
      repository: { type: "string" },
      folder: { type: "string" },
      proxy: { type: "string" },
      image: { type: "string" },
      "setup-token-sha256": { type: "string" },
      out: { type: "string" },
    },
    0
  );

  if (values.help) {
    io.out(HOST_HELP);
    return 0;
  }
  const name = values.name?.trim() ?? "";
  const nameProblem = editorNameProblem(name);

  if (nameProblem) throw new UsageError(`--name: ${nameProblem}`);
  const addresses = addressesFrom(values);
  const proxy = (values.proxy ?? "caddy") as RecipeProxy;

  if (!RECIPE_PROXIES.includes(proxy)) throw new UsageError(`--proxy must be one of ${RECIPE_PROXIES.join(", ")}, not “${values.proxy}”.`);
  const image = values.image?.trim() || defaultImage(io.env);

  if (!IMAGE_REFERENCE.test(image)) throw new UsageError(`--image: “${image}” isn't an image reference like registry.example.com/editor:1.2.3.`);
  const hash = values["setup-token-sha256"]?.trim();

  if (hash !== undefined && !/^[0-9a-fA-F]{64}$/.test(hash)) throw new UsageError("--setup-token-sha256 must be 64 hexadecimal characters: the SHA-256 of the setup code.");
  const folder = values.folder?.trim().replace(/^\/+|\/+$/g, "");

  if (folder !== undefined && (folder === "" || folder.split("/").includes(".."))) throw new UsageError("--folder must be a folder inside the repository, like apps/site.");
  if (folder && !values.repository) throw new UsageError("--folder goes with --repository: it says where the site is inside that repository.");
  const files = recipeFiles({
    name,
    addresses,
    image,
    proxy,
    ...(hash ? { setupTokenSha256: hash.toLowerCase() } : {}),
    ...(values.repository ? { repository: values.repository.trim() } : {}),
    ...(folder ? { folder } : {}),
  });

  if (!values.out || values.out === "-") {
    for (const file of files) {
      io.out(`# ── ${file.name}`);
      io.out(file.content.replace(/\n$/, ""));
      io.out("");
    }
    return 0;
  }
  const out = resolve(io.cwd, values.out);

  writeFiles(out, files);
  io.err(`✓ Wrote ${files.map((file) => file.name).join(", ")} to ${out}`);
  return 0;
}

async function withEngine<T>(io: Io, path: string | undefined, work: (engine: SingleSiteEngine, hosting: HostingService) => Promise<T>): Promise<T> {
  const root = resolve(io.cwd, path ?? ".");
  const home = defaultHome(io.env);
  const engine = await (io.openSite ?? openSingleSite)({ root, home, env: io.env, watch: false });
  const builtIns = builtInEditorHosts();
  const ids = new Set(builtIns.map((host) => host.id));
  const hosting = createHostingService({
    home,
    settings: engine.settings,
    events: engine.events,
    env: io.env,
    // The built-in hosts, then any a plugin adds (a plugin can't replace a built-in host).
    hosts: [...builtIns, ...(engine.plugins?.editorHostObjects(root) ?? []).filter((host) => !ids.has(host.id))],
  });

  try {
    return await work(engine, hosting);
  } finally {
    hosting.dispose();
    await engine.dispose();
  }
}

/**
 * A key file from Google Cloud: its path, or the file itself pasted — which a
 * terminal hands over one line at a time, so lines are read until the JSON
 * is whole (or a bounded number of lines have come).
 */
async function keyFile(io: HostIo, ask: NonNullable<HostIo["prompt"]>): Promise<string> {
  const first = await ask("Paste the key file from Google Cloud (a service account's JSON key), or type the path to it: ", { secret: true });

  if (!first) return "";
  if (!first.startsWith("{")) {
    const path = resolve(io.cwd, first.replace(/^~(?=\/)/, io.env.HOME ?? "~"));

    if (!existsSync(path)) throw new UsageError(`There's no file at ${path}.`);
    return readFileSync(path, "utf8");
  }
  let text = first;

  for (let line = 0; line < 200; line += 1) {
    try {
      JSON.parse(text);
      return text;
    } catch {
      text += `\n${await ask("", { secret: true })}`;
    }
  }
  return text;
}

async function ensureKeys(io: HostIo, hosting: HostingService, host: EditorHostInfo, ask: HostIo["prompt"] | null): Promise<void> {
  for (const credential of host.credentials.filter((entry) => entry.required)) {
    if (host.secrets.some((status) => status.name === credential.secret && status.configured)) continue;
    const variable = KEY_VARIABLE[credential.secret];

    if (!ask) throw new UsageError(`No ${credential.label}. ${variable ? `Set ${variable}, or run` : "Run"} \`${PRODUCT.slug} host\` on a terminal to paste one. How to make one: ${credential.docsUrl}`);
    io.err(`${host.name} needs a ${credential.label}. ${credential.help}`);
    if (credential.permissions.length) io.err(`  It needs: ${credential.permissions.join(", ")}.`);
    io.err(`  How to make one: ${credential.docsUrl}`);
    const value = credential.secret === "gcp" ? await keyFile(io, ask) : await ask(`Paste the ${credential.label}: `, { secret: true });

    if (!value) throw new UsageError("No key was pasted, so nothing was created.");
    // Checked with the host first; only a key it accepts is stored.
    await hosting.connect(host.id, { key: value, secret: credential.secret });
  }
}

async function create(argv: string[], io: HostIo): Promise<number> {
  const { values, positionals } = parse(
    "host",
    argv,
    {
      host: { type: "string" },
      address: { type: "string" },
      "preview-address": { type: "string" },
      "live-address": { type: "string" },
      name: { type: "string" },
      account: { type: "string" },
      region: { type: "string" },
      option: { type: "string", multiple: true },
      "hand-over": { type: "string" },
      out: { type: "string" },
      "dry-run": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      json: { type: "boolean" },
    },
    1
  );

  if (values.help) {
    io.out(HOST_HELP);
    return 0;
  }
  const json = Boolean(values.json);
  const ask = values.yes || json ? null : (io.prompt ?? terminalPrompt());
  const options: Record<string, string> = {};

  for (const entry of values.option ?? []) {
    const match = /^([a-z][a-z0-9_-]*)=(.*)$/.exec(entry);

    if (!match) throw new UsageError(`--option takes key=value, like memory=1024, not “${entry}”.`);
    options[match[1]!] = match[2]!;
  }
  if (values.region) options.region = values.region;
  const keys = (values["hand-over"] ?? "").split(",").map((key) => key.trim()).filter(Boolean) as SecretName[];

  return withEngine(io, positionals[0], async (engine, hosting) => {
    const hosts = await hosting.hosts();
    let hostId = values.host;

    if (!hostId && ask) hostId = (await choose(ask, io, "Where should the editor run?", hosts, (host) => `${host.name} — ${host.summary}`)).id;
    if (!hostId) throw new UsageError(`Say where with --host: ${hosts.map((host) => host.id).join(", ")}.`);
    const host = hosts.find((candidate) => candidate.id === hostId);

    if (!host) throw new UsageError(`--host must be one of ${hosts.map((candidate) => candidate.id).join(", ")}, not “${hostId}”.`);
    await ensureKeys(io, hosting, host, ask);
    let account = values.account ?? "";

    if (host.credentials.length > 0) {
      const found: EditorHostAccount = await hosting.connect(host.id);
      const blocking = found.gaps.filter((gap) => gap.blocking);

      for (const gap of found.gaps) if (!json) io.err(`${gap.blocking ? "!" : "·"} ${gap.what} ${gap.where}`);
      if (blocking.length) return fail(io, json, `${host.name} can't be used with this key yet: ${blocking[0]!.what}`, blocking.map((gap) => `${gap.what} ${gap.where}`).join("\n"));
      if (!account) {
        if (found.accounts.length === 1) account = found.accounts[0]!.id;
        else if (found.accounts.length > 1 && ask) account = (await choose(ask, io, `Which ${host.id === "fly" ? "organization" : host.id === "gcp" ? "project" : "account"}?`, found.accounts, (entry) => `${entry.name} (${entry.id})`)).id;
        else if (found.accounts.length > 1) throw new UsageError(`The key can use ${found.accounts.length} accounts; say which with --account: ${found.accounts.map((entry) => `${entry.id} (${entry.name})`).join(", ")}.`);
        else throw new UsageError("The key can't list its accounts; say which with --account.");
      }
      if ((host.id === "fly" || host.id === "gcp") && !options.region && ask && found.regions.length) {
        options.region = (await choose(ask, io, "Where should it run?", found.regions, (region) => `${region.name} (${region.id})`)).id;
      }
    }
    let address = values.address;

    if (!address && ask) address = await ask("The editor's address (like cms.example.com): ");
    if (!address) throw new UsageError("Say the editor's address with --address, like cms.example.com.");
    // The editor's own address is checked with the plan (its problems are the plan's); the other two, given here, are checked now.
    const preview = givenAddress(values["preview-address"], "preview-address", "The preview's address");
    const live = givenAddress(values["live-address"], "live-address", "The live comparison's address");
    const status = await hosting.status(engine.site);
    let name = values.name ?? "";

    if (!name) name = (ask ? await ask(`A short name for it [${status.suggestedName}]: `) : "") || status.suggestedName;
    const plan = await hosting.plan(engine.site, {
      host: host.id,
      account,
      name,
      address,
      ...(preview ? { previewAddress: preview } : {}),
      ...(live ? { liveAddress: live } : {}),
      options,
      handover: { repository: true, identity: true, liveAddress: true, keys },
    });

    if (json && (values["dry-run"] || plan.problems.length)) {
      io.out(JSON.stringify({ ok: plan.problems.length === 0, dryRun: Boolean(values["dry-run"]), plan }));
      return plan.problems.length ? 1 : 0;
    }
    if (!json) printPlan(io, plan);
    if (plan.problems.length) return 1;
    if (values["dry-run"]) {
      io.err("Nothing was created (--dry-run).");
      return 0;
    }
    if (!values.yes) {
      if (!ask) throw new UsageError("Nothing was created. Add --yes to create it without asking, or run on a terminal.");
      const answer = await ask(`\nCreate all of this${host.kind === "managed" ? ` on ${host.name}` : ""}, for about ${money(plan.cost.monthly, plan.cost.currency)} a month? [y/N] `);

      if (!/^y(es)?$/i.test(answer)) {
        io.err("Nothing was created.");
        return 0;
      }
    }
    const job = await follow(io, hosting, await hosting.create(engine.site, plan.id, true), json);

    if (job.state === "error") return fail(io, json, job.detail ?? "Putting the editor online didn't finish.", job.output);
    const after = await hosting.status(engine.site);
    let written: string | null = null;

    if (after.pending?.files.length) {
      written = outFolder(io, values.out, name);
      writeFiles(written, after.pending.files);
    }
    const link = after.record?.handedOver ? (await hosting.setupLink(engine.site).catch(() => null))?.url ?? null : null;

    if (json) {
      io.out(JSON.stringify({ ok: true, url: `https://${plan.addresses.editor}`, ...(link ? { setupLink: link } : {}), pending: after.pending?.steps ?? [], ...(written ? { files: written } : {}) }));
      return 0;
    }
    if (link) {
      io.out(`✓ The editor is online at https://${plan.addresses.editor}`);
      io.out(`  Open this link to choose its password and finish setting it up (it works once): ${link}`);
    } else {
      io.out(`✓ ${job.detail ?? "Created."}`);
      if (written) io.out(`  The files to run it are in ${written}.`);
      (after.pending?.steps ?? []).forEach((step, index) => {
        io.out(`  ${index + 1}. ${step.title}. ${step.detail}`);
        if (step.copy) for (const line of step.copy.split("\n")) io.out(`       ${line}`);
      });
      io.out(`  Then run \`${PRODUCT.slug} host check\` here.`);
    }
    return 0;
  });
}

async function afterwards(command: string, argv: string[], io: HostIo): Promise<number> {
  const { values, positionals } = parse(`host ${command}`, argv, { yes: { type: "boolean", short: "y" }, json: { type: "boolean" }, out: { type: "string" } }, 1);

  if (values.help) {
    io.out(HOST_HELP);
    return 0;
  }
  const json = Boolean(values.json);
  const ask = values.yes || json ? null : (io.prompt ?? terminalPrompt());

  return withEngine(io, positionals[0], async (engine, hosting) => {
    const site = engine.site;

    if (command === "status" || command === "check") {
      const status = command === "check" ? await hosting.check(site) : await hosting.status(site);

      if (values.out && status.pending?.files.length) writeFiles(resolve(io.cwd, values.out), status.pending.files);
      if (json) {
        io.out(JSON.stringify({ ok: true, ...status, pending: status.pending ? { steps: status.pending.steps, files: status.pending.files.map((file) => file.name) } : null }));
        return 0;
      }
      if (!status.config && !status.record) {
        io.out(`This site has no editor online. Put one online with \`${PRODUCT.slug} host --host fly --address cms.example.com\`.`);
        return 0;
      }
      const url = status.config?.url ?? `https://${status.record!.addresses.editor}`;
      const words = { healthy: "answering", setup: "answering, waiting for its first run", starting: "starting", unreachable: "not answering", unknown: "not known" } as const;

      io.out(`Editor: ${url} (${status.config?.host ?? status.record?.host ?? "unknown host"}) — ${words[status.health]}`);
      if (status.record) io.out(`  Version ${status.record.version}${status.upgradeAvailable ? `; ${status.currentVersion} is available (\`${PRODUCT.slug} host upgrade\`)` : ""}`);
      else io.out("  It was put online from another computer, so it is managed from there or from its own Install page.");
      if (status.pending) {
        io.out("  Still to do:");
        status.pending.steps.forEach((step, index) => io.out(`    ${index + 1}. ${step.title}. ${step.detail}`));
        if (status.pending.files.length) io.out(values.out ? `  The files are in ${resolve(io.cwd, values.out)}.` : `  Write the files to run it with --out <folder>.`);
      }
      if (command === "check" && status.record?.handedOver && status.record.setup === "pending") io.out(`  The site was handed over. \`${PRODUCT.slug} host link\` prints the first-run link.`);
      return 0;
    }
    if (command === "link") {
      const { url } = await hosting.setupLink(site);

      io.out(json ? JSON.stringify({ ok: true, url }) : url);
      return 0;
    }
    if (command === "backup") {
      const backup = await hosting.backup(site);

      io.out(json ? JSON.stringify({ ok: true, ...backup }) : `✓ ${backup.message}${backup.url ? ` ${backup.url}` : ""}`);
      return 0;
    }
    if (command === "upgrade") {
      const job = await follow(io, hosting, await hosting.upgrade(site), json);

      if (job.state === "error") return fail(io, json, job.detail ?? "Upgrading didn't finish.", job.output);
      io.out(json ? JSON.stringify({ ok: true, url: job.url }) : `✓ ${job.detail}`);
      return 0;
    }
    // remove: exactly what will be deleted first.
    const removal = await hosting.removal(site);

    if (!json) {
      io.out(removal.resources.length ? "Deletes:" : "Deletes nothing on an account.");
      for (const resource of removal.resources) io.out(`  - ${resource.kind} “${resource.name}”${resource.id ? ` (${resource.id})` : ""}`);
      if (removal.skipped.length) {
        io.out("Leaves alone (changed or already gone):");
        for (const { resource, reason } of removal.skipped) io.out(`  - ${resource.kind} “${resource.name}”: ${reason}`);
      }
      io.out("Keeps:");
      for (const kept of removal.kept) io.out(`  - ${kept}`);
      io.out(removal.warning);
    }
    if (!values.yes) {
      if (!ask) throw new UsageError("Nothing was removed. Add --yes to remove it without asking, or run on a terminal.");
      if (!/^y(es)?$/i.test(await ask("Remove it? [y/N] "))) {
        io.err("Nothing was removed.");
        return 0;
      }
    }
    const job = await follow(io, hosting, await hosting.remove(site, true), json);

    if (job.state === "error") return fail(io, json, job.detail ?? "Removing didn't finish.", job.output);
    if (json) io.out(JSON.stringify({ ok: true, removed: removal.resources, skipped: removal.skipped }));
    else {
      io.out(`✓ ${job.detail}`);
      if (job.output) io.out(job.output.split("\n").map((line) => `  ${line}`).join("\n"));
    }
    return 0;
  });
}

export async function hostCommand(argv: string[], io: HostIo): Promise<number> {
  const [first, ...rest] = argv;

  if (first && SUBCOMMANDS.has(first)) return first === "recipe" ? recipe(rest, io) : afterwards(first, rest, io);
  return create(argv, io);
}
