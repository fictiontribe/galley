import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  aiMetaFromEnv,
  createGoogleProvider,
  createOpenAiProvider,
  creditsFromUsd,
  DEFAULT_AI_CREDIT_MILLICENTS,
  extractProxyError,
  GOOGLE_INTERACTIONS_URL,
  googleInteractionsUrl,
  OPENAI_BASE,
  openaiBaseUrl,
  readManagedAiConfig,
} from "../../src/ai/index";
import { describeApiFailure, rememberSecret } from "../../src/ai/errors";
import { jsonResponse, scriptedFetch } from "./helpers/scripted-fetch";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("managed AI credits helpers", () => {
  it("converts USD amounts to whole credits, rounding up", () => {
    expect(creditsFromUsd(0)).toBe(0);
    expect(creditsFromUsd(-1)).toBe(0);
    expect(creditsFromUsd(Number.NaN)).toBe(0);
    expect(creditsFromUsd(0.00001)).toBe(1);
    expect(creditsFromUsd(0.0025)).toBe(1);
    expect(creditsFromUsd(0.0026)).toBe(2);
    expect(creditsFromUsd(0.03)).toBe(12);
    expect(creditsFromUsd(0.08)).toBe(32);
    expect(creditsFromUsd(1)).toBe(400);
    expect(creditsFromUsd(1, 500)).toBe(200);
    expect(creditsFromUsd(1, 0)).toBe(400);
  });

  it("reads managed AI flags dynamically and omits meta when unmanaged", () => {
    const env: NodeJS.ProcessEnv = {};

    expect(readManagedAiConfig(env)).toEqual({
      managed: false,
      creditMillicents: DEFAULT_AI_CREDIT_MILLICENTS,
      disabled: false,
      creditsUrl: null,
      manageUrl: null,
    });
    expect(aiMetaFromEnv(env)).toBeUndefined();

    env.GALLEY_AI_MANAGED = "true";
    env.GALLEY_AI_CREDIT_MILLICENTS = "500";
    env.GALLEY_AI_CREDITS_URL = " https://cloud.galleycms.com/ai/v1/credits ";
    env.GALLEY_AI_MANAGE_URL = " https://cloud.galleycms.com/sites/s1 ";
    expect(aiMetaFromEnv(env)).toEqual({
      managed: true,
      creditMillicents: 500,
      manageUrl: "https://cloud.galleycms.com/sites/s1",
    });

    env.GALLEY_AI_OFF = "1";
    expect(aiMetaFromEnv(env)).toEqual({
      managed: true,
      creditMillicents: 500,
      disabled: true,
      manageUrl: "https://cloud.galleycms.com/sites/s1",
    });

    env.GALLEY_AI_OFF = "0";
    env.GALLEY_AI_CREDIT_MILLICENTS = "not-a-number";
    expect(aiMetaFromEnv(env)).toEqual({
      managed: true,
      creditMillicents: DEFAULT_AI_CREDIT_MILLICENTS,
      manageUrl: "https://cloud.galleycms.com/sites/s1",
    });
  });
});

describe("Galley Cloud proxy error surfacing", () => {
  it.each([
    ["galley_ai_allowance_used", 402, "This month's AI credits are used up. Add credits in Galley Cloud."],
    ["galley_ai_paused_unpaid", 402, "The payment for your Galley Cloud plan is overdue, so the AI is paused."],
    ["galley_ai_switched_off", 403, "AI is switched off for this site in Galley Cloud."],
  ])("surfaces %s plain-English message directly from Anthropic SDK errors", (code, status, message) => {
    const body = { type: "error", error: { type: "billing_error", message, details: { error_code: code } }, request_id: "req_1" };
    const sdkError = Anthropic.APIError.generate(status, body, undefined, new Headers());

    expect(describeApiFailure(sdkError, { baseURL: "https://cloud.galleycms.com/ai/anthropic" })).toEqual({
      aborted: false,
      message,
    });
  });

  it("scrubs secrets from proxy error messages and leaves normal BYOK errors unchanged", () => {
    const secret = "sk-ant-proxy-secret-1234567890";

    rememberSecret(secret);
    const extracted = extractProxyError({
      error: { type: "billing_error", message: `Paused for ${secret}`, details: { error_code: "galley_ai_paused_unpaid" } },
    });

    expect(extracted).toEqual({ code: "galley_ai_paused_unpaid", message: "Paused for [redacted]" });

    const byokError = Anthropic.APIError.generate(402, { type: "error", error: { type: "billing_error", message: "Your credit balance is too low." } }, undefined, new Headers());

    expect(describeApiFailure(byokError).message).toContain("Add credit to the account");
  });
});

describe("image provider base URL overrides and proxy errors", () => {
  it("reads GALLEY_OPENAI_BASE_URL dynamically on each call and surfaces proxy errors", async () => {
    const env: NodeJS.ProcessEnv = { GALLEY_OPENAI_BASE_URL: "https://proxy-a.example/openai/v1/" };
    const provider = createOpenAiProvider(env);

    expect(openaiBaseUrl(env)).toBe("https://proxy-a.example/openai/v1");
    expect(openaiBaseUrl({})).toBe(OPENAI_BASE);

    const script = scriptedFetch([
      () => jsonResponse(200, { data: [{ b64_json: PNG }] }),
      () => jsonResponse(402, { error: { code: "galley_ai_allowance_used", message: "Your Galley AI credits are used up." } }),
    ]);

    await provider.generate({ prompt: "A loaf", aspect: "1:1", count: 1, model: "gpt-image-2", transparent: false, references: [] }, "tok-1", script.fetch);
    expect(script.requests[0]!.url).toBe("https://proxy-a.example/openai/v1/images/generations");

    env.GALLEY_OPENAI_BASE_URL = "https://proxy-b.example/openai/v1";
    await expect(
      provider.generate({ prompt: "A loaf", aspect: "1:1", count: 1, model: "gpt-image-2", transparent: false, references: [] }, "tok-1", script.fetch)
    ).rejects.toMatchObject({ kind: "quota", plain: "Your Galley AI credits are used up." });
    expect(script.requests[1]!.url).toBe("https://proxy-b.example/openai/v1/images/generations");
  });

  it("reads GALLEY_GOOGLE_BASE_URL dynamically without duplicating /v1beta/interactions and surfaces proxy errors", async () => {
    const env: NodeJS.ProcessEnv = { GALLEY_GOOGLE_BASE_URL: "https://proxy.example/google/" };
    const provider = createGoogleProvider(env);

    expect(googleInteractionsUrl({})).toBe(GOOGLE_INTERACTIONS_URL);
    expect(googleInteractionsUrl(env)).toBe("https://proxy.example/google/v1beta/interactions");
    expect(googleInteractionsUrl({ GALLEY_GOOGLE_BASE_URL: "https://proxy.example/google/v1beta/interactions/" })).toBe(
      "https://proxy.example/google/v1beta/interactions"
    );

    const script = scriptedFetch([
      () => jsonResponse(200, { steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: PNG }] }] }),
      () =>
        jsonResponse(403, {
          error: { status: "PERMISSION_DENIED", message: "AI is switched off for this site in Galley Cloud.", details: [{ reason: "galley_ai_switched_off" }] },
        }),
    ]);

    await provider.generate({ prompt: "A loaf", aspect: "1:1", count: 1, model: "gemini-image", transparent: false, references: [] }, "tok-1", script.fetch);
    expect(script.requests[0]!.url).toBe("https://proxy.example/google/v1beta/interactions");

    env.GALLEY_GOOGLE_BASE_URL = "https://proxy-2.example/google/v1beta/interactions";
    await expect(
      provider.generate({ prompt: "A loaf", aspect: "1:1", count: 1, model: "gemini-image", transparent: false, references: [] }, "tok-1", script.fetch)
    ).rejects.toMatchObject({ kind: "auth", plain: "AI is switched off for this site in Galley Cloud." });
    expect(script.requests[1]!.url).toBe("https://proxy-2.example/google/v1beta/interactions");
  });
});
