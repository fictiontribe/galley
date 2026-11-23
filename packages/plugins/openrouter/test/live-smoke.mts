/**
 * Opt-in live check against the real OpenRouter API — NOT part of the test
 * suite, and it spends money. It:
 *
 *   1. lists the image models OpenRouter offers, with their prices (free);
 *   2. picks an inexpensive per-image or per-megapixel model, states the
 *      expected cost, and refuses to go on if that estimate is over the cap;
 *   3. generates ONE image at the smallest shape (1:1) through the real
 *      engine — plugin registry, Settings, ImageService — into a temporary
 *      copy of the starter, saves it into the site's media, and reports the
 *      model, the cost OpenRouter reported, and the file's dimensions;
 *   4. deletes everything it made.
 *
 * Video is never generated here (it is priced far higher); it is verified
 * against scripted responses only. The key comes from OPENROUTER_API_KEY and
 * is never printed.
 *
 *   OPENROUTER_API_KEY=… node --import tsx test/live-smoke.mts
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFileSecretStore, createImageService, createSettingsService } from "@galley/core/ai";
import { builtinPlugin, createPluginRegistry, createPluginSettingsStore } from "@galley/core/plugins";
import { createEventBus, createSiteService } from "@galley/core/site";
import { createOpenRouterPlugin } from "../src/index";

/** The most this script may spend on its one image. The whole run's budget is US$0.50. */
const CAP_USD = 0.1;
const PREFERRED = ["black-forest-labs/flux.2-klein-4b", "sourceful/riverflow-v2.5-fast", "qwen/qwen-image-3"];
const STARTER = fileURLToPath(new URL("../../../../starters/astro-starter", import.meta.url));

const key = process.env.OPENROUTER_API_KEY?.trim();

if (!key) {
  console.error("Set OPENROUTER_API_KEY to run the live check.");
  process.exit(2);
}

/** "$0.014 per megapixel" → { amount: 0.014, unit: "megapixel" }. */
function parsePrice(price: string | undefined): { amount: number; unit: string } | null {
  const match = /^\$([0-9.]+) per (image|megapixel|request)$/.exec(price ?? "");

  return match ? { amount: Number(match[1]), unit: match[2]! } : null;
}

const temp: string[] = [];
const made = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  temp.push(dir);
  return dir;
};
let dispose: (() => Promise<void>) | null = null;

try {
  const home = made("galley-live-home-");
  const env = { OPENROUTER_API_KEY: key };
  const secrets = createFileSecretStore(home);
  let plugins: ReturnType<typeof createPluginRegistry> | null = null;
  const settings = createSettingsService({ home, env, secretStore: secrets, imageProviders: () => plugins?.imageProviders() ?? [] });

  plugins = createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env, secrets, setBuiltinSecret: (name, value) => settings.setSecret(name, value) }) });
  plugins.register(builtinPlugin, { source: "builtin", required: true });
  plugins.register(createOpenRouterPlugin(), { source: "builtin" });
  await plugins.start();
  const registry = plugins;
  const images = createImageService({ home, settings, providers: () => registry.imageProviders() });

  // 1. The live catalogue.
  const openrouter = (await images.providers()).find((provider) => provider.id === "openrouter")!;

  console.log(`OpenRouter image models listed: ${openrouter.models.length} (configured: ${openrouter.configured})`);
  for (const model of openrouter.models) console.log(`  ${model.id.padEnd(48)} ${model.price ?? "(no price listed)"}${model.supportsReferences ? " · takes references" : ""}`);

  // 2. Choose, estimate, cap.
  const priced = openrouter.models
    .map((model) => ({ model, price: parsePrice(model.price) }))
    .filter((item): item is { model: (typeof openrouter.models)[number]; price: { amount: number; unit: string } } => item.price !== null)
    // 1:1 at the 1K tier is about one megapixel.
    .map((item) => ({ ...item, estimate: item.price.amount * (item.price.unit === "megapixel" ? 1.1 : 1) }));
  const choice = PREFERRED.map((id) => priced.find((item) => item.model.id === id)).find(Boolean) ?? priced.sort((a, b) => a.estimate - b.estimate)[0];

  if (!choice) throw new Error("No image model with a per-image or per-megapixel price was listed, so the cost can't be estimated; stopping.");
  console.log(`\nChosen: ${choice.model.id} at ${choice.model.price}. Expected cost of one 1:1 image: about $${choice.estimate.toFixed(4)}.`);
  if (choice.estimate > CAP_USD) throw new Error(`That is over the $${CAP_USD} cap for this check; stopping before any paid call.`);

  // 3. A temporary copy of the starter, opened through the real engine.
  const root = join(made("galley-live-site-"), "site");

  cpSync(STARTER, root, { recursive: true, filter: (source) => !["node_modules", "dist", ".astro"].includes(basename(source)) });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Live Check", "-c", "user.email=check@example.com", ...args], { cwd: root, stdio: "pipe" });

  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Starter");
  const site = await createSiteService(root, { id: "live-check", events: createEventBus(), overlayScript: () => "", author: () => ({ name: "Live Check", email: "check@example.com" }), watch: false });

  dispose = () => site.dispose();
  await settings.update({ images: { provider: "openrouter", model: choice.model.id } });
  const started = Date.now();
  const [candidate] = await images.generate({ prompt: "A small red lighthouse on a rocky shore at dusk, flat illustration", aspect: "1:1", count: 1 }, { site });
  const usage = readFileSync(join(home, "usage.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { model: string; cost: number | null }).at(-1);
  const item = await images.save(site, { candidateId: candidate!.id, filename: "live-check-lighthouse" });

  console.log(`\nGenerated in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  model:       ${candidate!.model}`);
  console.log(`  cost:        ${usage?.cost === null || usage?.cost === undefined ? "not reported" : `$${usage.cost}`} (as OpenRouter reported it)`);
  console.log(`  saved as:    ${item.path} (${item.type}, ${item.size} bytes)`);
  // Measured by the media library when it saved the file.
  console.log(`  dimensions:  ${item.width ?? "?"} × ${item.height ?? "?"}`);
  console.log(`  pending:     ${(await site.changes()).files.map((file) => file.path).join(", ")}`);
} catch (error) {
  console.error(`\nThe live check stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await dispose?.();
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
  console.log("\nTemporary home and site deleted.");
}
