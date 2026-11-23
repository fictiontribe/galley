import { describe, expect, it } from "vitest";
import { createApiClient, DEFAULT_API_BASE_URL } from "../../src/ai/runtime";

/**
 * Other tools set ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN for their own
 * traffic. Started from such a terminal, the assistant once sent a valid key
 * to a local proxy and reported it as rejected.
 */
describe("the assistant's API client", () => {
  it("ignores an ambient ANTHROPIC_BASE_URL and auth token", () => {
    const previous = { base: process.env.ANTHROPIC_BASE_URL, token: process.env.ANTHROPIC_AUTH_TOKEN };

    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9/someone-elses-proxy";
    process.env.ANTHROPIC_AUTH_TOKEN = "not-ours";
    try {
      const client = createApiClient("sk-ant-test", {}, 0);

      expect(client.baseURL).toBe(DEFAULT_API_BASE_URL);
      expect(client.authToken).toBeNull();
      expect(client.apiKey).toBe("sk-ant-test");
    } finally {
      if (previous.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previous.base;
      if (previous.token === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previous.token;
    }
  });

  it("uses GALLEY_ANTHROPIC_BASE_URL when an operator sets one", () => {
    const client = createApiClient("sk-ant-test", { GALLEY_ANTHROPIC_BASE_URL: " https://gateway.example.com " }, 0);

    expect(client.baseURL).toBe("https://gateway.example.com");
  });
});
