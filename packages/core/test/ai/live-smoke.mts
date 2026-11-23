/**
 * Opt-in live smoke test — NOT part of `vitest run`. Makes real (billed)
 * requests to the Anthropic API with the key in ANTHROPIC_API_KEY.
 *
 *   ANTHROPIC_API_KEY=sk-ant-… pnpm --filter @galley/core exec tsx test/ai/live-smoke.mts
 *   GALLEY_AI_PROFILE=plain ANTHROPIC_API_KEY=sk-ant-… pnpm --filter @galley/core exec tsx test/ai/live-smoke.mts
 *
 * Without GALLEY_AI_PROFILE the runtime starts on the full profile and drops
 * to plain only if the API refuses full as a bad request; the script prints
 * which profile each turn finished on, so the first run with a real key shows
 * at once whether the full request shape is accepted.
 *
 * It copies starters/astro-starter into a temp folder (no node_modules), makes
 * it a git repository, and runs two turns: one edit and one follow-up. It
 * prints the streamed events, the resulting diff, token usage per turn, and
 * whether the second turn read from the prompt cache. Everything lives in temp
 * folders that are deleted at the end; nothing is published; nothing outside
 * the temp folders is written. Output per response is capped at 8,000 tokens,
 * effort is "low", and each turn is limited to 12 steps.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILE_ENV, createAgentRuntime, createImageService, createSettingsService } from "../../src/ai/index";
import { createEventBus, createSiteRegistry } from "../../src/site/index";
import type { ChatMessage, ServerEvent, TurnUsage } from "../../src/types";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("Set ANTHROPIC_API_KEY to run the live smoke test. Nothing was sent.");
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const starter = join(here, "../../../../starters/astro-starter");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "galley-live-smoke-")));
const root = join(scratch, "site");
const home = join(scratch, "home");
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Smoke Test", "-c", "user.email=smoke@example.com", ...args], { cwd: root, encoding: "utf8" });

function printUsage(label: string, usage: TurnUsage | undefined): void {
  if (!usage) return console.log(`${label}: no usage reported`);
  console.log(
    `${label}: ${usage.requests} requests · input ${usage.inputTokens} · output ${usage.outputTokens} · cache read ${usage.cacheReadTokens} · cache write ${usage.cacheWriteTokens} · ≈ $${usage.cost?.toFixed(4) ?? "?"}`
  );
}

async function main(): Promise<void> {
  const pin = process.env[PROFILE_ENV];

  console.log(pin ? `${PROFILE_ENV}=${pin}: the profile is pinned, no ladder.` : `${PROFILE_ENV} not set: starting on "full", laddering to "plain" on a 400.`);
  cpSync(starter, root, {
    recursive: true,
    filter: (source) => !["node_modules", ".astro", "dist"].includes(relative(starter, source).split("/")[0] ?? ""),
  });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Starter");

  const events = createEventBus();
  const settings = createSettingsService({ home, env: process.env });

  await settings.update({ ai: { effort: "low" } });
  const registry = await createSiteRegistry({
    home,
    sitesDir: join(scratch, "sites"),
    startersDir: join(scratch, "starters"),
    events,
    overlayScript: () => "",
    settings,
    install: async () => undefined,
  });

  try {
    const site = await registry.open({ path: root });
    const runtime = createAgentRuntime({
      home,
      registry,
      settings,
      images: createImageService({ home, settings }),
      events,
      maxTokens: 8_000,
      maxSteps: 12,
      logger: (line) => console.log(`  [log] ${line}`),
    });
    const thread = await runtime.createThread(site.id);
    let streaming = false;

    events.subscribe((event: ServerEvent) => {
      if (event.type === "chat.delta") {
        if (!streaming) process.stdout.write("  assistant › ");
        streaming = true;
        process.stdout.write(event.text);
        return;
      }
      if (streaming) process.stdout.write("\n");
      streaming = false;
      if (event.type === "chat.tool") console.log(`  [${event.tool.status}] ${event.tool.label}`);
      if (event.type === "chat.error") console.log(`  [error] ${event.message}`);
      if (event.type === "changes.updated") console.log(`  [changes] ${event.paths.join(", ")} (${event.origin})`);
    });

    const turn = async (text: string, context?: { urlPath: string }): Promise<ChatMessage | undefined> => {
      console.log(`\nperson › ${text}`);
      let reply: ChatMessage | undefined;
      const finished = new Promise<void>((resolve) => {
        const off = events.subscribe((event) => {
          if (event.type === "chat.message" && event.message.role === "assistant" && !event.message.pending) reply = event.message;
          if (event.type === "chat.done") {
            off();
            resolve();
          }
        });
      });

      await runtime.send(site.id, thread.id, { text, ...(context ? { context } : {}) });
      await finished;
      console.log(`  final › ${reply?.text ?? "(none)"}`);
      console.log(`  profile › ${reply ? (runtime.turnProfile(reply.turnId) ?? "unknown") : "unknown"}`);
      return reply;
    };

    const first = await turn("Change the home page hero heading to “Better rooms in the home you already have.”", { urlPath: "/" });
    const second = await turn("Thanks. Now make the hero's paragraph one sentence shorter — keep the wording otherwise.", { urlPath: "/" });

    console.log("\n── diff ───────────────────────────────────────────");
    console.log(git("diff", "--stat") || "(no changes)");
    console.log(git("diff"));
    console.log("── usage ──────────────────────────────────────────");
    printUsage(`turn 1 (${first ? runtime.turnProfile(first.turnId) : "?"} profile)`, first?.usage);
    printUsage(`turn 2 (${second ? runtime.turnProfile(second.turnId) : "?"} profile)`, second?.usage);
    if (!pin && first && runtime.turnProfile(first.turnId) === "plain") {
      console.log("The API refused the full profile; see the [log] line above for the request id and the reason.");
    }
    const hit = (second?.usage?.cacheReadTokens ?? 0) > 0;

    console.log(hit ? "Turn 2 read from the prompt cache." : "Turn 2 did NOT read from the prompt cache — investigate (see shared/prompt-caching.md).");
  } finally {
    await registry.dispose();
    rmSync(scratch, { recursive: true, force: true });
    console.log(`\nRemoved ${scratch}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  rmSync(scratch, { recursive: true, force: true });
  process.exitCode = 1;
});
