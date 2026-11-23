/** Session handling of the Streamable HTTP handler, without a server around it. */
import { describe, expect, it } from "vitest";
import { createMcpHttpHandler, createMcpServer, type SiteResolver } from "../src/index";

const noSites: SiteResolver = {
  kind: "many",
  list: async () => [],
  resolve: async () => {
    throw new Error("no site in this test");
  },
};

function server() {
  return createMcpServer({ sites: noSites, mode: "content", allowPublish: true, transport: "http", brand: { name: "Test", version: "0" } });
}

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

function initialize(handler: ReturnType<typeof createMcpHttpHandler>): Promise<Response> {
  return handler.handle(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
    })
  );
}

function list(handler: ReturnType<typeof createMcpHttpHandler>, session: string): Promise<Response> {
  return handler.handle(
    new Request("http://127.0.0.1/mcp", { method: "POST", headers: { ...HEADERS, "mcp-session-id": session, "mcp-protocol-version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) })
  );
}

describe("createMcpHttpHandler", () => {
  it("keeps at most maxSessions, closing the longest idle", async () => {
    const handler = createMcpHttpHandler({ createServer: server, maxSessions: 2, log: () => {} });
    const ids: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const response = await initialize(handler);

      ids.push(response.headers.get("mcp-session-id")!);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(handler.sessions).toBe(2);
    expect((await list(handler, ids[0]!)).status).toBe(404);
    const live = await list(handler, ids[2]!);

    expect(live.status).toBe(200);
    expect(((await live.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name)).toContain("list_sites");
    await handler.close();
    expect((await initialize(handler)).status).toBe(503);
  });

  it("ends sessions that sit idle", async () => {
    const handler = createMcpHttpHandler({ createServer: server, idleMs: 20, log: () => {} });
    const id = (await initialize(handler)).headers.get("mcp-session-id")!;

    await new Promise((resolve) => setTimeout(resolve, 40));
    // A new session sweeps the idle ones first.
    await initialize(handler);
    expect((await list(handler, id)).status).toBe(404);
    await handler.close();
  });

  it("refuses a body that isn't JSON, and non-initialize requests without a session", async () => {
    const handler = createMcpHttpHandler({ createServer: server, log: () => {} });
    const garbage = await handler.handle(new Request("http://127.0.0.1/mcp", { method: "POST", headers: HEADERS, body: "{nope" }));

    expect(garbage.status).toBe(400);
    expect(((await garbage.json()) as { error: { code: number } }).error.code).toBe(-32700);
    expect((await handler.handle(new Request("http://127.0.0.1/mcp", { method: "POST", headers: HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }))).status).toBe(400);
    await handler.close();
  });
});
