import { describe, expect, it } from "vitest";
import type { AiCreditsInfo, MetaInfo, SettingsService } from "@galley/core/types";
import { fake, json, testApp } from "./helpers";

describe("managed AI credits metadata & endpoint", () => {
  it("omits meta.ai and returns unmanaged credits when GALLEY_AI_MANAGED is not set", async () => {
    const app = testApp({}, { env: {} });

    const meta = (await json(await app.call("GET", "/api/meta"))) as MetaInfo;
    expect(meta.ai).toBeUndefined();

    const credits = (await json(await app.call("GET", "/api/ai/credits"))) as AiCreditsInfo;
    expect(credits).toEqual({ managed: false, disabled: false, creditMillicents: 250, balance: null });
  });

  it("exposes meta.ai dynamically when authenticated and hides it from unauthenticated requests", async () => {
    const env: NodeJS.ProcessEnv = {
      GALLEY_AI_MANAGED: "1",
      GALLEY_AI_CREDIT_MILLICENTS: "250",
      GALLEY_AI_MANAGE_URL: "https://cloud.galleycms.com/w/1",
    };
    const app = testApp({}, { env });

    const stranger = (await json(await app.raw("GET", "http://127.0.0.1:4400/api/meta"))) as MetaInfo;
    expect(stranger.authenticated).toBe(false);
    expect(stranger.ai).toBeUndefined();

    const authed = (await json(await app.call("GET", "/api/meta"))) as MetaInfo;
    expect(authed.ai).toEqual({
      managed: true,
      creditMillicents: 250,
      manageUrl: "https://cloud.galleycms.com/w/1",
    });

    // Live toggle without restarting the server.
    env.GALLEY_AI_OFF = "1";
    const switchedOff = (await json(await app.call("GET", "/api/meta"))) as MetaInfo;
    expect(switchedOff.ai).toEqual({
      managed: true,
      creditMillicents: 250,
      disabled: true,
      manageUrl: "https://cloud.galleycms.com/w/1",
    });
  });

  it("fetches live credits with Bearer token and never leaks the token", async () => {
    const token = "gc-site-secret-token-xyz987654321";
    const calls: Array<{ url: string; auth: string | null }> = [];
    const env: NodeJS.ProcessEnv = {
      GALLEY_AI_MANAGED: "1",
      GALLEY_AI_CREDIT_MILLICENTS: "250",
      GALLEY_AI_CREDITS_URL: "https://cloud.galleycms.com/ai/v1/credits",
      GALLEY_AI_MANAGE_URL: "https://cloud.galleycms.com",
    };
    const settings = fake<SettingsService>("settings", {
      readSecret: async (name) => (name === "anthropic" ? token : null),
    });
    const fetchStub: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers);

      calls.push({ url, auth: headers.get("authorization") });
      return new Response(
        JSON.stringify({
          usedCredits: 1200,
          includedCredits: 4000,
          topUpCredits: 500,
          leftCredits: 3300,
          changesLeft: 165,
          state: "ok",
          renewsAt: "2026-12-01T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const app = testApp({ settings }, { env, fetch: fetchStub });

    const response = await app.call("GET", "/api/ai/credits");
    const text = await response.text();
    const body = JSON.parse(text) as AiCreditsInfo;

    expect(response.status).toBe(200);
    expect(text).not.toContain(token);
    expect(calls).toEqual([{ url: "https://cloud.galleycms.com/ai/v1/credits", auth: `Bearer ${token}` }]);
    expect(body).toEqual({
      managed: true,
      disabled: false,
      creditMillicents: 250,
      manageUrl: "https://cloud.galleycms.com",
      balance: {
        usedCredits: 1200,
        includedCredits: 4000,
        topUpCredits: 500,
        leftCredits: 3300,
        changesLeft: 165,
        state: "ok",
        renewsAt: "2026-12-01T00:00:00.000Z",
      },
    });

    // When AI is switched off, does not call upstream.
    env.GALLEY_AI_OFF = "true";
    const offBody = (await json(await app.call("GET", "/api/ai/credits"))) as AiCreditsInfo;
    expect(offBody).toEqual({
      managed: true,
      disabled: true,
      creditMillicents: 250,
      manageUrl: "https://cloud.galleycms.com",
      balance: null,
    });
    expect(calls).toHaveLength(1);
  });

  it("returns balance: null cleanly when upstream fails or auth is missing", async () => {
    const env: NodeJS.ProcessEnv = {
      GALLEY_AI_MANAGED: "1",
      GALLEY_AI_CREDITS_URL: "https://cloud.galleycms.com/ai/v1/credits",
    };
    const settings = fake<SettingsService>("settings", {
      readSecret: async () => "gc-token-1234567890",
    });
    const failingFetch: typeof fetch = async () => new Response("upstream down", { status: 502 });
    const app = testApp({ settings }, { env, fetch: failingFetch });

    expect((await app.raw("GET", "http://127.0.0.1:4400/api/ai/credits")).status).toBe(401);
    expect(await json(await app.call("GET", "/api/ai/credits"))).toEqual({
      managed: true,
      disabled: false,
      creditMillicents: 250,
      balance: null,
    });
  });
});
