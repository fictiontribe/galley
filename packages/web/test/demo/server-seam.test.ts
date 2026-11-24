/**
 * The mock server's one seam for the demo: `handlers` replaces or wraps
 * answers before routing. Without it the server answers exactly as before.
 */
import { describe, expect, it } from "vitest";
import { createMockServer, type MockServer } from "../../mock/server.ts";

async function call(server: MockServer, method: string, url: string) {
  const answer = await server.handle({ method, url, headers: {} });
  return { status: answer.status, json: answer.body ? (JSON.parse(String(answer.body)) as Record<string, unknown>) : null };
}

describe("the mock server's handlers option", () => {
  it("answers as before when nothing is passed", async () => {
    const server = createMockServer({ mode: "local" });
    const meta = await call(server, "GET", "/api/meta");
    expect(meta.status).toBe(200);
    expect(meta.json).toMatchObject({ mode: "local", authenticated: true, platform: process.platform });
  });

  it("lets a caller wrap one route and keep the rest", async () => {
    const server = createMockServer({
      mode: "local",
      handlers: (handlers, backend) => ({
        ...handlers,
        "GET /api/meta": (request) => ({ ...(handlers["GET /api/meta"](request) as object), platform: `wrapped:${backend.sites.size}` }) as ReturnType<typeof handlers["GET /api/meta"]>,
      }),
    });
    expect((await call(server, "GET", "/api/meta")).json).toMatchObject({ mode: "local", platform: `wrapped:${server.backend.sites.size}` });
    expect((await call(server, "GET", "/api/sites")).status).toBe(200);
    expect(server.log.map((entry) => entry.route)).toEqual(["GET /api/meta", "GET /api/sites"]);
  });
});
