/**
 * Opt-in live check — NOT part of `vitest run`. Makes three real (billed)
 * requests to the Anthropic API with the key in ANTHROPIC_API_KEY:
 *
 *   ANTHROPIC_API_KEY=sk-ant-… pnpm --filter @galley/core exec tsx test/seo/live-write.mts
 *
 * Copies starters/astro-starter into a temp folder, empties the description
 * of three pages, commits, audits, and runs "write the 3 missing
 * descriptions" through the same batch the app uses (one request per page,
 * effort "low", the model from GALLEY_SEO_MODEL or Haiku 5.5). It prints each
 * page's result and the resulting diff, then deletes the temp folder.
 * Nothing is published.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiClient } from "../../src/ai/runtime";
import { costFor } from "../../src/ai/models";
import { createEventBus, createSiteService } from "../../src/site/index";
import { auditSite } from "../../src/seo/audit";
import { createWriteBatches, planWrite } from "../../src/seo/write";

const key = process.env.ANTHROPIC_API_KEY;

if (!key) {
  process.stderr.write("Set ANTHROPIC_API_KEY to run the live check.\n");
  process.exit(1);
}
const model = process.env.GALLEY_SEO_MODEL ?? "claude-haiku-5-5";
const starter = join(dirname(fileURLToPath(import.meta.url)), "../../../../starters/astro-starter");
const root = realpathSync(mkdtempSync(join(tmpdir(), "galley-live-write-")));
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Live Check", "-c", "user.email=live@example.invalid", ...args], { cwd: root, encoding: "utf8" });

try {
  cpSync(starter, root, { recursive: true, filter: (source) => !["node_modules", ".astro", "dist"].includes(basename(source)) });
  for (const page of ["about", "services", "pricing"]) {
    const file = join(root, "src/content/pages", `${page}.md`);

    writeFileSync(file, readFileSync(file, "utf8").replace(/^description: .*$/m, 'description: ""'));
  }
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Three pages without a description");
  const site = await createSiteService(root, { id: "live", events: createEventBus(), overlayScript: () => "", author: () => null, watch: false } as Parameters<typeof createSiteService>[1]);
  const client = createApiClient(key, process.env, 1);
  let cost = 0;
  const deps = {
    client: async () => client,
    model: async () => model,
    record: async (usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) => void (cost += costFor(model, usage) ?? 0),
    events: createEventBus(),
    log: (line: string) => process.stderr.write(`${line}\n`),
  };

  await auditSite(site, { render: "off" });
  const plan = await planWrite(site, "description", deps);

  process.stdout.write(`Plan: ${plan.requests} requests with ${model}\n`);
  const batches = createWriteBatches(deps);
  const started = await batches.start(site, "description");
  let status = started;

  while (status.job.state === "running") {
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = batches.status(started.job.id)!;
  }
  for (const item of status.items) process.stdout.write(`${item.state.padEnd(8)} ${item.title}: ${item.value ?? item.reason ?? ""}\n`);
  process.stdout.write(`\n${git("diff")}\nEstimated cost: $${cost.toFixed(4)}\n`);
  batches.dispose();
  await site.dispose();
} finally {
  rmSync(root, { recursive: true, force: true });
}
