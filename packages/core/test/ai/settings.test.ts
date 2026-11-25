/** Settings, secrets and usage accounting. */
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODELS, costFor, createSettingsService, summarizeUsage } from "../../src/ai/index";
import { scrubSecrets } from "../../src/ai/errors";
import type { SecretName } from "../../src/types";
import type { UsageLine } from "../../src/ai/usage";
import { cleanEnv, tempDir } from "./helpers/env";

const ANTHROPIC = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789WXYZ";
const OPENAI = "sk-proj-abcdefghijklmnopqrstuvwxyz98765";

describe("settings", () => {
  it("defaults to Opus 5.5 at medium effort, the system theme and the machine's git identity", async () => {
    const settings = createSettingsService({ home: tempDir(), env: cleanEnv() });
    const value = await settings.get();

    expect(value.ai.model).toBe("claude-opus-5-5");
    expect(value.ai.effort).toBe("medium");
    expect(value.ai.models.map((m) => m.id)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"]);
    expect(value.appearance.theme).toBe("system");
    expect(value.author).toEqual({ name: "Test Editor", email: "editor@example.com" });
    expect(value.images.provider).toBeNull();
    expect(value.images.providers.find((p) => p.id === "mock")?.configured).toBe(true);
    expect(value.images.providers.find((p) => p.id === "openai")?.configured).toBe(false);
  });

  it("reads the machine's git identity, not that of a repository the process happens to be started in", async () => {
    const repo = tempDir("ai-cwd-repo-");
    const started = process.cwd();

    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Repo Person"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "repo@example.com"], { cwd: repo });
    process.chdir(repo);
    try {
      const settings = createSettingsService({ home: tempDir(), env: cleanEnv() });

      expect((await settings.get()).author).toEqual({ name: "Test Editor", email: "editor@example.com" });
    } finally {
      process.chdir(started);
    }
  });

  it("lists models with list prices and a plain blurb each", () => {
    expect(MODELS.find((m) => m.id === "claude-opus-5-5")).toMatchObject({ inputPrice: 4, outputPrice: 20 });
    expect(MODELS.find((m) => m.id === "claude-sonnet-5-5")).toMatchObject({ inputPrice: 2, outputPrice: 10 });
    expect(MODELS.find((m) => m.id === "claude-haiku-5-5")).toMatchObject({ inputPrice: 0.1, outputPrice: 0.5 });
    expect(MODELS.find((m) => m.id === "claude-fable-5-2")).toMatchObject({ inputPrice: 8, outputPrice: 40 });
    for (const model of MODELS) expect(model.blurb.length).toBeGreaterThan(20);
  });

  it("writes settings atomically and validates patches", async () => {
    const home = tempDir();
    const settings = createSettingsService({ home, env: cleanEnv() });

    await settings.update({ ai: { model: "claude-sonnet-5-5", effort: "high" }, appearance: { theme: "dark" }, author: { name: " Ana ", email: "ana@example.com" } });
    const stored = JSON.parse(readFileSync(join(home, "settings.json"), "utf8"));

    expect(stored).toMatchObject({ ai: { model: "claude-sonnet-5-5", effort: "high" }, appearance: { theme: "dark" }, author: { name: "Ana" } });
    expect((await settings.get()).author).toEqual({ name: "Ana", email: "ana@example.com" });
    await expect(settings.update({ ai: { model: "gpt-9" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(settings.update({ author: { email: "not an email" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(settings.update({ images: { provider: "nope" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(settings.update({ images: { provider: "openai" } })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("API key first") });
    await settings.setSecret("openai", "sk-proj-0123456789abcdefghijklmnop");
    await settings.setSecret("google", "AIzaSyD-abcdefghijklmnopqrstuvwxyz01234");
    await settings.update({ images: { provider: "openai", model: "gpt-image-2" } });
    await settings.update({ images: { provider: "google" } });
    expect((await settings.get()).images).toMatchObject({ provider: "google", model: null });
  });

  it("keeps the chosen video service and model with the other settings, not in a browser", async () => {
    const home = tempDir();
    const settings = createSettingsService({ home, env: cleanEnv(), videoProviders: () => [{ id: "openrouter", label: "OpenRouter" }, { id: "fake", label: "Fake" }] });

    expect((await settings.get()).videos).toEqual({ provider: null, model: null });
    await settings.update({ videos: { provider: "openrouter", model: "google/veo-3.1-lite" } });
    expect((await settings.get()).videos).toEqual({ provider: "openrouter", model: "google/veo-3.1-lite" });
    expect(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).videos).toEqual({ provider: "openrouter", model: "google/veo-3.1-lite" });
    // Another service forgets the model chosen for the first; a service no plugin offers is refused.
    await settings.update({ videos: { provider: "fake" } });
    expect((await settings.get()).videos).toEqual({ provider: "fake", model: null });
    await expect(settings.update({ videos: { provider: "nowhere" } })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("isn't available") });
    await expect(settings.update({ videos: { model: "not a model!" } })).rejects.toMatchObject({ code: "invalid" });
    await settings.update({ videos: { provider: null } });
    expect((await settings.get()).videos).toEqual({ provider: null, model: null });
  });
});

describe("secrets", () => {
  it("takes the environment first and won't change an environment key", async () => {
    const home = tempDir();
    const settings = createSettingsService({ home, env: cleanEnv({ ANTHROPIC_API_KEY: ANTHROPIC, GOOGLE_API_KEY: "AIzaSyD-abcdefghijklmnopqrstuvwxyz01234" }) });
    const statuses = (await settings.get()).secrets;

    expect(statuses.find((s) => s.name === "anthropic")).toEqual({ name: "anthropic", configured: true, source: "env", hint: "WXYZ" });
    expect(statuses.find((s) => s.name === "google")).toMatchObject({ configured: true, source: "env" });
    expect(await settings.readSecret("anthropic")).toBe(ANTHROPIC);
    await expect(settings.setSecret("anthropic", "sk-ant-api03-another-key-0000000000000000")).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("environment"),
    });
  });

  it("stores keys in a 0600 file inside a 0700 folder, trimmed, with only a hint shown", async () => {
    const home = tempDir();
    // A home something else created with the usual 0755 is tightened when the first key goes in (docs/multi-site.md).
    chmodSync(home, 0o755);
    const settings = createSettingsService({ home, env: cleanEnv() });
    const status = await settings.setSecret("openai", `  ${OPENAI}\n`);

    expect(status).toEqual({ name: "openai", configured: true, source: "stored", hint: "8765" });
    expect(statSync(join(home, "secrets.json")).mode & 0o777).toBe(0o600);
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(await settings.readSecret("openai")).toBe(OPENAI);
    expect(JSON.stringify(await settings.get())).not.toContain(OPENAI);
    await settings.setSecret("openai", null);
    expect(await settings.readSecret("openai")).toBeNull();
  });

  it("rejects obviously wrong keys without echoing them", async () => {
    const settings = createSettingsService({ home: tempDir(), env: cleanEnv() });
    const cases: Array<[SecretName, string]> = [
      ["anthropic", "hello there"],
      ["anthropic", OPENAI],
      ["openai", ANTHROPIC],
      ["google", "short"],
    ];

    for (const [name, value] of cases) {
      const error = (await settings.setSecret(name, value).catch((e: unknown) => e)) as Error & { detail?: string };

      expect(error).toMatchObject({ code: "invalid" });
      expect(`${error.message} ${error.detail ?? ""}`).not.toContain(value);
    }
  });

  it("scrubs keys from any text, including keys it has seen", async () => {
    const settings = createSettingsService({ home: tempDir(), env: cleanEnv() });

    await settings.setSecret("google", "Zq9_seen0123456789abcdefgh");
    expect(scrubSecrets(`boom ${ANTHROPIC} and Zq9_seen0123456789abcdefgh and AIzaSyD-abcdefghijklmnopqrstuvwxyz01234`)).toBe("boom [redacted] and [redacted] and [redacted]");
  });
});

describe("cost", () => {
  it("prices tokens per model, cache reads and writes included", () => {
    expect(costFor("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })).toBeCloseTo(4 + 20 + 0.2 + 5, 10);
    expect(costFor("claude-sonnet-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 2_000_000, cacheWriteTokens: 0 })).toBeCloseTo(0.2, 10);
    expect(costFor("claude-fable-5-2", { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 1000 })).toBeCloseTo((8 + 40 + 10) / 1000, 10);
    expect(costFor("some-unknown-model", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });

  it("uses Haiku 5.5's long-prompt rate card above 100K prompt tokens", () => {
    const short = costFor("claude-haiku-5-5", { inputTokens: 100_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const long = costFor("claude-haiku-5-5", { inputTokens: 50_000, outputTokens: 1_000_000, cacheReadTokens: 60_000, cacheWriteTokens: 0 });

    expect(short).toBeCloseTo(0.01 + 0.5, 10);
    expect(long).toBeCloseTo(50_000 * 0.5e-6 + 2.5 + 60_000 * 0.05e-6, 10);
  });
});

describe("usage", () => {
  const line = (at: number, extra: Partial<UsageLine> = {}): UsageLine => ({
    siteId: "s",
    at,
    model: "claude-opus-5-5",
    requests: 2,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 50,
    cacheWriteTokens: 5,
    cost: 0.01,
    ...extra,
  });

  it("buckets by local day across midnight", () => {
    const now = new Date(2026, 10, 23, 0, 30).getTime(); // 00:30 local
    const beforeMidnight = new Date(2026, 10, 22, 23, 59).getTime();
    const afterMidnight = new Date(2026, 10, 23, 0, 1).getTime();
    const sixDaysAgo = new Date(2026, 10, 17, 0, 0).getTime();
    const sevenDaysAgo = new Date(2026, 10, 16, 23, 59).getTime();
    const summary = summarizeUsage([line(beforeMidnight), line(afterMidnight), line(sixDaysAgo), line(sevenDaysAgo, { model: "claude-sonnet-5-5" })], now);

    expect(summary.today.turns).toBe(1);
    expect(summary.last7.turns).toBe(3);
    expect(summary.last30.turns).toBe(4);
    expect(summary.allTime.requests).toBe(8);
    expect(summary.days).toHaveLength(14);
    expect(summary.days.at(-1)).toEqual({ date: "2026-11-23", requests: 2, cost: 0.01 });
    expect(summary.days.at(-2)).toEqual({ date: "2026-11-22", requests: 2, cost: 0.01 });
    expect(summary.days[0]!.date).toBe("2026-11-10");
    expect(summary.byModel.map((m) => [m.model, m.turns])).toEqual([["claude-opus-5-5", 3], ["claude-sonnet-5-5", 1]]);
  });

  it("withholds the money total when a model has no price, and counts images apart", () => {
    const now = new Date(2026, 10, 23, 12).getTime();
    const summary = summarizeUsage(
      [line(now), line(now, { model: "mystery", cost: null }), line(now, { model: "mock:abstract-svg", requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: null, images: 3 })],
      now
    );

    expect(summary.today.cost).toBeNull();
    expect(summary.today.images).toBe(3);
    expect(summary.today.turns).toBe(2);
    expect(summary.byModel.find((m) => m.model === "claude-opus-5-5")?.cost).toBeCloseTo(0.01, 10);
  });

  it("includes the image and video costs the services reported in the totals, labelled apart", () => {
    const now = new Date(2026, 10, 23, 12).getTime();
    const media = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const summary = summarizeUsage(
      [
        line(now),
        line(now, { ...media, model: "openrouter:google/gemini-3.1-flash-image", cost: 0.04, images: 2 }),
        // A service that didn't say what its picture cost: counted, flagged, left out of the money.
        line(now, { ...media, model: "pictures:pictures-1", cost: null, images: 1 }),
        // The built-in placeholders are made here for nothing, even on lines that recorded no price.
        line(now, { ...media, model: "mock:abstract-svg", cost: null, images: 1 }),
        line(now, { ...media, model: "openrouter:google/veo-3.1-lite", cost: 0.4, videos: 1 }),
      ],
      now
    );

    expect(summary.today.cost).toBeCloseTo(0.01 + 0.04 + 0.4, 10);
    expect(summary.today).toMatchObject({ images: 4, videos: 1, turns: 1 });
    expect(summary.today.media?.images).toBeCloseTo(0.04, 10);
    expect(summary.today.media?.videos).toBeCloseTo(0.4, 10);
    expect(summary.today.media?.unpriced).toBe(1);
    expect(summary.days.at(-1)?.cost).toBeCloseTo(0.45, 10);
    // The by-model table stays the assistant's.
    expect(summary.byModel.map((m) => m.model)).toEqual(["claude-opus-5-5"]);
  });

  it("appends lines to usage.jsonl and survives a torn last line", async () => {
    const home = tempDir();
    const now = Date.now();
    const settings = createSettingsService({ home, env: cleanEnv(), now: () => now });

    await settings.recordUsage({ siteId: "a", at: now, model: "claude-opus-5-5", requests: 1, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.0001 });
    writeFileSync(join(home, "usage.jsonl"), `${readFileSync(join(home, "usage.jsonl"), "utf8")}{"at": 12`);
    const summary = await settings.usage();

    expect(summary.allTime.requests).toBe(1);
    expect(summary.today.inputTokens).toBe(10);
  });
});

describe("an operator's own API endpoint", () => {
  it("says which host rejected the key when the endpoint is overridden", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { describeApiFailure } = await import("../../src/ai/errors");
    const rejected = Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());

    expect(describeApiFailure(rejected, { baseURL: "https://llm-gateway.internal.example:8443/anthropic" }).message).toBe(
      "The assistant can't connect: llm-gateway.internal.example:8443 rejected the API key. That address comes from GALLEY_ANTHROPIC_BASE_URL; check the key is one it accepts, or remove that setting to use the public API."
    );
    // The public API (the default) keeps the usual words.
    expect(describeApiFailure(rejected, { baseURL: "https://api.anthropic.com" }).message).toBe("The assistant can't connect: the API key in Settings was rejected. Add a fresh key in Settings.");
    expect(describeApiFailure(rejected).message).toContain("the API key in Settings was rejected");
  });
});
