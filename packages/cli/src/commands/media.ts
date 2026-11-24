/**
 * `galley media` — where a site keeps its media: the repository, or a
 * bucket (Cloudflare R2, Amazon S3). Connecting runs the same real check as
 * the app before anything is saved; keys are read from the environment or
 * asked for with nothing echoed, never taken as flags (they would stay in the
 * shell's history).
 */
import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { MEDIA_KEY_ENV, type MediaCheckResult, type MediaMoveRequest, type MediaStorageService } from "@galley/core/media-storage";
import type { MediaStorageConfig } from "@galley/core/types";
import { defaultHome, openSingleSite } from "@galley/server";
import { parse, UsageError } from "../args";
import { terminalPrompt, type DeployIo } from "./deploy";

export const MEDIA_HELP = `Usage: ${PRODUCT.slug} media [command] [path] [options]

Where the site in [path] (default: this folder) keeps new media: its
repository, or a bucket that serves files at their own address.

Commands
  status        Where new files go, and whether the bucket's key is set (the default)
  connect       Connect a bucket: checks for real, then saves (asks what it needs)
  check         Check the connected bucket again: store, read, list, load, remove a test picture
  move          Move files: --to bucket, --to repository, or --address <url>
  disconnect    New files go to the repository again (the bucket's files stay)

Options for connect
      --connector <id>   r2 (Cloudflare R2) or s3 (Amazon S3)
      --bucket <name>
      --account <id>     R2: the account ID
      --region <code>    S3: the bucket's Region ("eu-west-1")
      --endpoint <url>   R2 in a jurisdiction: the bucket's S3 address
      --prefix <folder>  Keep this site's files in a folder of the bucket
      --public-url <url> Where visitors load the files from
  The key is read from ${MEDIA_KEY_ENV.accessKeyId} and ${MEDIA_KEY_ENV.secretAccessKey},
  or asked for (nothing is shown as you paste). It is never a flag.

Options for move
      --to <place>       bucket or repository
      --address <url>    Use a new public address for the bucket's files
      --keep-copies      Moving to the bucket: keep the repository's copies too

Options
      --forget-keys      disconnect: remove the bucket's key from this computer too
  -y, --yes              Don't ask before moving or disconnecting
      --json             Print the result as JSON
  -h, --help             Show this help

Examples
  ${PRODUCT.slug} media connect --connector r2 --bucket lowfield-media --account 4f0c… --public-url https://media.example.com
  ${PRODUCT.slug} media move --to bucket
  ${PRODUCT.slug} media move --address https://media.example.com`;

const SUBCOMMANDS = new Set(["status", "connect", "check", "move", "disconnect"]);

function printCheck(io: DeployIo, result: MediaCheckResult): void {
  for (const step of result.steps) io.err(`  ${step.state === "ok" ? "✓" : step.state === "failed" ? "✗" : "·"} ${step.label}`);
  if (!result.ok) io.err(`! ${result.message ?? "The check didn't pass."}`);
  if (result.detail) io.err(`  (${result.detail})`);
}

async function ask(io: DeployIo, question: string, options: { secret?: boolean } = {}): Promise<string> {
  if (!io.prompt) throw new UsageError(`${question.replace(/[:?]\s*$/, "")} is needed. Give it as an option (see \`${PRODUCT.slug} media --help\`).`);
  return io.prompt(question, options);
}

export async function mediaCommand(argv: string[], io: DeployIo): Promise<number> {
  const sub = argv[0] && SUBCOMMANDS.has(argv[0]) ? argv[0] : "status";
  const rest = argv[0] && SUBCOMMANDS.has(argv[0]) ? argv.slice(1) : argv;
  const { values, positionals } = parse(
    "media",
    rest,
    {
      connector: { type: "string" },
      bucket: { type: "string" },
      account: { type: "string" },
      region: { type: "string" },
      endpoint: { type: "string" },
      prefix: { type: "string" },
      "public-url": { type: "string" },
      to: { type: "string" },
      address: { type: "string" },
      "keep-copies": { type: "boolean" },
      "forget-keys": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      json: { type: "boolean" },
    },
    1
  );

  if (values.help) {
    io.out(MEDIA_HELP);
    return 0;
  }
  const json = Boolean(values.json);
  const withPrompt: DeployIo = { ...io, ...(io.prompt === undefined && !json ? { prompt: terminalPrompt() ?? undefined } : {}) } as DeployIo;
  const home = defaultHome(io.env);
  const engine = await (io.openSite ?? openSingleSite)({ root: resolve(io.cwd, positionals[0] ?? "."), home, env: io.env, watch: false });
  const storage = engine.mediaStorage;

  if (!storage) {
    await engine.dispose();
    throw new UsageError("Keeping media outside the repository isn't available here.");
  }
  try {
    switch (sub) {
      case "status":
        return await status(withPrompt, storage, engine.site, json);
      case "check": {
        const result = await storage.check(engine.site);

        if (json) io.out(JSON.stringify(result));
        else {
          printCheck(withPrompt, result);
          if (result.ok) io.out("✓ The bucket works: new files can be stored and visitors can load them.");
        }
        return result.ok ? 0 : 1;
      }
      case "connect":
        return await connect(withPrompt, storage, engine.site, values, json);
      case "move":
        return await move(withPrompt, storage, engine.site, values, json);
      case "disconnect": {
        const current = await storage.status(engine.site);

        if (!current.bucket.config) throw new UsageError("This site isn't connected to a bucket.");
        if (!values.yes) {
          if (!withPrompt.prompt) throw new UsageError("Nothing was changed. Run it again with --yes to stop putting new files in the bucket.");
          if (!/^y(es)?$/i.test(await withPrompt.prompt(`New files go to the repository again; the bucket's files stay. Go ahead? [y/N] `))) return 1;
        }
        await storage.disconnect(engine.site, { forgetKeys: Boolean(values["forget-keys"]) });
        if (json) io.out(JSON.stringify({ ok: true }));
        else io.out(`✓ New files go to the repository again. The files in ${current.bucket.config.bucket} stay there, and pages that use them keep working.`);
        return 0;
      }
    }
    return 2;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    const message = error instanceof Error ? error.message : String(error);

    if (json) io.out(JSON.stringify({ ok: false, error: message }));
    else io.err(`! ${message}`);
    return 1;
  } finally {
    await engine.dispose();
  }
}

async function status(io: DeployIo, storage: MediaStorageService, site: Parameters<MediaStorageService["status"]>[0], json: boolean): Promise<number> {
  const current = await storage.status(site);

  if (json) {
    io.out(JSON.stringify(current));
    return 0;
  }
  const config = current.bucket.config;

  if (!config) {
    io.out(`New files are kept in the site's repository. \`${PRODUCT.slug} media connect\` keeps them in a bucket instead.`);
    return 0;
  }
  io.out(`New files go to ${current.bucket.store?.name ?? config.connector}: ${config.bucket}${config.prefix ? `/${config.prefix}` : ""}, loaded from ${config.publicUrl}.`);
  io.out(current.bucket.keys.accessKeyId.configured && current.bucket.keys.secretAccessKey.configured ? `  Key: ending in ${current.bucket.keys.accessKeyId.hint ?? "····"} (${current.bucket.keys.accessKeyId.source === "env" ? "from the environment" : "kept on this computer"}).` : `  The key is missing: run \`${PRODUCT.slug} media connect\` again.`);
  if (current.bucket.trialAddress) io.out("  The r2.dev address is rate-limited and for trying out: connect a custom domain before the site goes live.");
  return 0;
}

async function connect(io: DeployIo, storage: MediaStorageService, site: Parameters<MediaStorageService["status"]>[0], values: Record<string, unknown>, json: boolean): Promise<number> {
  const connectors = storage.connectors();
  const saved = (await storage.status(site)).bucket.config;
  let connector = (values.connector as string | undefined) ?? saved?.connector;

  if (!connector) {
    io.err("Where should the files be kept?");
    connectors.forEach((info, index) => io.err(`  ${index + 1}. ${info.name}${info.recommended ? " (recommended)" : ""} — ${info.blurb}`));
    const answer = await ask(io, "Number: ");
    connector = connectors[Number(answer) - 1]?.id;
    if (!connector) throw new UsageError("Choose one of the numbers shown.");
  }
  const info = connectors.find((candidate) => candidate.id === connector);

  if (!info) throw new UsageError(`“${connector}” isn't a kind of bucket ${PRODUCT.name} knows. Use one of: ${connectors.map((c) => c.id).join(", ")}.`);
  const option = (name: string, fallback: string | undefined) => (values[name] as string | undefined) ?? fallback;
  const config: MediaStorageConfig = { connector, bucket: option("bucket", saved?.bucket) ?? "", publicUrl: option("public-url", saved?.publicUrl) ?? "" };

  for (const [field, flag] of [["account", "account"], ["region", "region"], ["endpoint", "endpoint"], ["prefix", "prefix"]] as const) {
    const value = option(flag, saved?.[field]);

    if (value) config[field] = value;
  }
  // Ask only for what this kind of bucket needs and wasn't given.
  for (const field of info.fields) {
    if (field.secret || field.id === "accessKeyId" || !field.required) continue;
    const key = field.id as "account" | "bucket" | "region" | "publicUrl";

    if (!config[key]) config[key] = await ask(io, `${field.label}: `);
  }
  const fromEnv = { accessKeyId: io.env[MEDIA_KEY_ENV.accessKeyId]?.trim(), secretAccessKey: io.env[MEDIA_KEY_ENV.secretAccessKey]?.trim() };
  const stored = (await storage.status(site)).bucket.keys;
  const keys: { accessKeyId?: string; secretAccessKey?: string } = {};

  if (!fromEnv.accessKeyId && !stored.accessKeyId.configured) keys.accessKeyId = await ask(io, "Access Key ID: ");
  if (!fromEnv.secretAccessKey && !stored.secretAccessKey.configured) keys.secretAccessKey = await ask(io, "Secret Access Key (not shown): ", { secret: true });
  if (!json) io.err(`Checking ${info.name} for real…`);
  const result = await storage.connect(site, { config, ...keys });

  if (json) io.out(JSON.stringify(result));
  else {
    printCheck(io, result.check);
    if (result.status) io.out(`✓ Connected. New files go to ${info.name} (${config.bucket}). Files already in the repository stay there; \`${PRODUCT.slug} media move --to bucket\` moves them.`);
  }
  return result.check.ok ? 0 : 1;
}

async function move(io: DeployIo, storage: MediaStorageService, site: Parameters<MediaStorageService["status"]>[0], values: Record<string, unknown>, json: boolean): Promise<number> {
  const to = values.to as string | undefined;
  const address = values.address as string | undefined;

  if (Boolean(to) === Boolean(address)) throw new UsageError("Give either --to bucket, --to repository, or --address <url>.");
  if (to && to !== "bucket" && to !== "repository") throw new UsageError("--to is bucket or repository.");
  const request: MediaMoveRequest = address
    ? { kind: "address", store: "bucket", publicUrl: address }
    : to === "bucket"
      ? { kind: "move", from: "repository", to: "bucket", keepCopies: Boolean(values["keep-copies"]) }
      : { kind: "move", from: "bucket", to: "repository" };
  const plan = await storage.planMove(site, request);

  if (!json) {
    const places = `${plan.references} ${plan.references === 1 ? "place" : "places"} in ${plan.pages} ${plan.pages === 1 ? "page" : "pages"}`;

    if (plan.kind === "address") io.err(`${places} will use ${plan.publicUrl}.`);
    else {
      io.err(`${plan.files} ${plan.files === 1 ? "file" : "files"} to copy${plan.done ? ` (${plan.done} already there)` : ""}; ${places} to update.`);
      if (plan.to === "bucket") io.err(plan.keepCopies ? "The repository keeps its copies." : "Then the repository's copies are removed (they leave the site when you publish).");
      if (plan.staying) io.err(`${plan.staying.files} stay where they are: ${plan.staying.reason}`);
    }
    for (const problem of plan.problems) io.err(`  ! ${problem.path}: ${problem.reason}`);
  }
  if (!values.yes) {
    if (!io.prompt) throw new UsageError("Nothing was changed. Run it again with --yes to go ahead.");
    if (!/^y(es)?$/i.test(await io.prompt("Go ahead? [y/N] "))) return 1;
  }
  let last = "";
  const outcome = await storage.move(site, request, (detail) => {
    if (!json && detail !== last) io.err(`  ${(last = detail)}`);
  });

  if (json) io.out(JSON.stringify({ ok: outcome.problems.length === 0, ...outcome }));
  else {
    for (const problem of outcome.problems) io.err(`  ! ${problem.path}: ${problem.reason}`);
    io.out(`${outcome.problems.length ? "!" : "✓"} ${outcome.summary}`);
  }
  return outcome.problems.length ? 1 : 0;
}
