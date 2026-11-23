/**
 * The /mcp mount: its guards (against fakes, through app.request), the
 * GALLEY_MCP switches, and the real server on a real port with the SDK's
 * Streamable HTTP client — an edit over MCP must reach /api/events as
 * changes.updated, the way an open UI would see it.
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ensureMcpToken } from "@galley/mcp";
import { createMcpMount } from "../src/mcp";
import { resolveConfig, startServer } from "../src/server";
import type { ServerEvent } from "@galley/core/types";
import { buildServices, TOKEN, testApp } from "./helpers";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "galley-mcp-server-")));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
};
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

function mountedApp(home: string) {
  const services = buildServices({ settings: { get: async () => ({ images: { provider: null } }) as never }, registry: { list: async () => [] } });
  const mcp = createMcpMount(services, { mode: "content", allowPublish: true, home, productName: "Test", version: "0.0.0", log: () => {} });

  return { ...testApp({}, { mcp }), mcp };
}

describe("the /mcp guards", () => {
  const home = join(scratch, "guard-home");

  it("is absent unless mounted", async () => {
    const { raw } = testApp();

    expect((await raw("POST", "/mcp", { body: INIT, headers: { ...MCP_HEADERS, authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
  });

  it("refuses requests without a token, or with a wrong one", async () => {
    const { raw, mcp } = mountedApp(home);
    const none = await raw("POST", "/mcp", { body: INIT, headers: MCP_HEADERS });

    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Bearer /);
    expect(((await none.json()) as any).error.message).toContain("mcp token");
    expect((await raw("POST", "/mcp", { body: INIT, headers: { ...MCP_HEADERS, authorization: "Bearer not-the-token" } })).status).toBe(401);
    // A signed-in browser cookie is not a credential here.
    expect((await raw("POST", "/mcp", { body: INIT, headers: { ...MCP_HEADERS, cookie: "galley_session_test=anything" } })).status).toBe(401);
    await mcp.close();
  });

  it("refuses a foreign Origin even with a valid token (DNS rebinding)", async () => {
    const { raw, mcp } = mountedApp(home);
    const response = await raw("POST", "http://localhost/mcp", { body: INIT, headers: { ...MCP_HEADERS, authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" } });

    expect(response.status).toBe(403);
    expect(((await response.json()) as any).jsonrpc).toBe("2.0");
    expect((await raw("POST", "http://localhost/mcp", { body: INIT, headers: { ...MCP_HEADERS, authorization: `Bearer ${TOKEN}`, origin: "null" } })).status).toBe(403);
    // Its own origin is fine.
    expect((await raw("POST", "http://localhost/mcp", { body: INIT, headers: { ...MCP_HEADERS, authorization: `Bearer ${TOKEN}`, origin: "http://localhost" } })).status).toBe(200);
    await mcp.close();
  });

  it("accepts the session token and the stable MCP token, and opens a session", async () => {
    const { raw, mcp } = mountedApp(home);
    const session = await raw("POST", "/mcp", { body: INIT, headers: { ...MCP_HEADERS, authorization: `Bearer ${TOKEN}` } });

    expect(session.status).toBe(200);
    expect(session.headers.get("mcp-session-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(((await session.json()) as any).result.serverInfo).toMatchObject({ name: "test", title: "Test" });
    const { token } = await ensureMcpToken(home, { rotate: true });
    const stable = await raw("POST", "/mcp", { body: INIT, headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` } });

    expect(stable.status).toBe(200);
    // A rotated token stops working at once.
    await ensureMcpToken(home, { rotate: true });
    expect((await raw("POST", "/mcp", { body: INIT, headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` } })).status).toBe(401);
    expect(mcp.handler.sessions).toBe(2);
    await mcp.close();
    expect(mcp.handler.sessions).toBe(0);
  });

  it("answers the protocol's own errors: no session, unknown session, wrong method", async () => {
    const { raw, mcp } = mountedApp(home);
    const auth = { ...MCP_HEADERS, authorization: `Bearer ${TOKEN}` };

    expect((await raw("POST", "/mcp", { body: { jsonrpc: "2.0", id: 2, method: "tools/list" }, headers: auth })).status).toBe(400);
    expect((await raw("POST", "/mcp", { body: { jsonrpc: "2.0", id: 2, method: "tools/list" }, headers: { ...auth, "mcp-session-id": "nope" } })).status).toBe(404);
    expect((await raw("GET", "/mcp", { headers: auth })).status).toBe(400);
    expect((await raw("PUT", "/mcp", { body: {}, headers: auth })).status).toBe(405);
    const opened = await raw("POST", "/mcp", { body: INIT, headers: auth });
    const id = opened.headers.get("mcp-session-id")!;
    const badVersion = await raw("POST", "/mcp", { body: { jsonrpc: "2.0", id: 3, method: "tools/list" }, headers: { ...auth, "mcp-session-id": id, "mcp-protocol-version": "1999-01-01" } });

    expect(badVersion.status).toBe(400);
    expect((await raw("DELETE", "/mcp", { headers: { ...auth, "mcp-session-id": id } })).status).toBe(200);
    expect((await raw("POST", "/mcp", { body: { jsonrpc: "2.0", id: 4, method: "tools/list" }, headers: { ...auth, "mcp-session-id": id } })).status).toBe(404);
    await mcp.close();
  });
});

describe("GALLEY_MCP switches", () => {
  it("defaults to on, content mode, publishing allowed — locally and hosted", () => {
    expect(resolveConfig({ env: {} }).mcp).toEqual({ enabled: true, build: false, publish: true });
    expect(resolveConfig({ env: { GALLEY_HOST: "0.0.0.0", GALLEY_PASSWORD: "correct horse battery" } }).mcp).toEqual({ enabled: true, build: false, publish: true });
  });

  it("reads off, build and publish from the environment", () => {
    expect(resolveConfig({ env: { GALLEY_MCP: "off" } }).mcp.enabled).toBe(false);
    expect(resolveConfig({ env: { GALLEY_MCP: "0" } }).mcp.enabled).toBe(false);
    expect(resolveConfig({ env: { GALLEY_MCP_BUILD: "1" } }).mcp.build).toBe(true);
    expect(resolveConfig({ env: { GALLEY_MCP_PUBLISH: "0" } }).mcp.publish).toBe(false);
    expect(resolveConfig({ env: { GALLEY_MCP: "off" }, mcp: { enabled: true } }).mcp.enabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────── the real thing

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const STARTER = join(REPO, "starters", "astro-starter");
const PORT = 4440;
const FIXED_TOKEN = "fixed-test-token-for-mcp-0123456789";

function makeSite(name: string): string {
  const root = join(scratch, name);
  const skip = new Set(["node_modules", "dist", ".astro"]);

  cpSync(STARTER, root, { recursive: true, filter: (source) => !skip.has(source.split("/").pop() ?? "") });
  symlinkSync(join(STARTER, "node_modules"), join(root, "node_modules"));
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["-c", "user.name=Test Editor", "-c", "user.email=editor@example.com", "commit", "-q", "-m", "Initial site"]]) {
    execFileSync("git", args, { cwd: root });
  }
  return root;
}

function liveEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const gitConfig = join(scratch, "gitconfig");

  writeFileSync(gitConfig, "[user]\n\tname = Test Editor\n\temail = editor@example.com\n");
  // No model keys: a publish message must never become a live API call in a test.
  return { PATH: process.env.PATH, HOME: process.env.HOME, GALLEY_HOME: home, GALLEY_TOKEN: FIXED_TOKEN, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1", ...extra };
}

/** Collects /api/events until stopped. */
function subscribe(port: number): { events: ServerEvent[]; stop(): void; ready: Promise<void> } {
  const events: ServerEvent[] = [];
  let stop = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/api/events", headers: { authorization: `Bearer ${FIXED_TOKEN}` } }, (res) => {
      let buffer = "";

      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let at: number;

        while ((at = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, at);

          buffer = buffer.slice(at + 2);
          for (const line of block.split("\n")) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)) as ServerEvent);
        }
        resolve();
      });
    });

    req.on("error", reject);
    req.end();
    stop = () => req.destroy();
  });

  return { events, ready, stop: () => stop() };
}

async function until<T>(probe: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = probe();

    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("the real server on port 4440", () => {
  it("serves MCP over Streamable HTTP; an edit arrives on the event stream as changes.updated from the agent", async () => {
    const home = join(scratch, "home");
    const root = makeSite("live-site");
    const server = await startServer({ port: PORT, findFreePort: false, env: liveEnv(home), webDir: join(scratch, "no-ui"), notice: () => {}, log: () => {} });
    const stream = subscribe(server.port);
    let client: Client | null = null;

    try {
      const site = await server.services.registry.open({ path: root });

      await stream.ready;
      client = new Client({ name: "live-test", version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { authorization: `Bearer ${FIXED_TOKEN}` } } }));
      expect(client.getServerVersion()).toMatchObject({ name: "galley" });
      const tools = (await client.listTools()).tools.map((t) => t.name);

      expect(tools).toContain("list_sites");
      expect(tools).not.toContain("write_file");
      const sites = JSON.parse((((await client.callTool({ name: "list_sites", arguments: {} })) as CallToolResult).content[0] as { text: string }).text);

      expect(sites).toEqual([expect.objectContaining({ id: site.id, name: "Lowfield Studio" })]);
      const read = (await client.callTool({ name: "read_entry", arguments: { path: "src/content/pages/index.md" } })) as CallToolResult;
      const entry = JSON.parse((read.content[0] as { text: string }).text);
      const updated = (await client.callTool({
        name: "update_entry",
        arguments: { site: "Lowfield Studio", path: entry.path, baseHash: entry.hash, ops: [{ op: "set", path: "sections.0.eyebrow", value: "Architecture, Ashcombe" }] },
      })) as CallToolResult;

      expect(updated.isError).toBeFalsy();
      const event = await until(() => stream.events.find((e) => e.type === "changes.updated" && e.paths.includes("src/content/pages/index.md")));

      expect(event).toMatchObject({ type: "changes.updated", siteId: site.id, origin: "agent" });
      const proof = (await client.callTool({ name: "get_changes", arguments: {} })) as CallToolResult;

      expect((proof.structuredContent as { files: unknown[] }).files).toHaveLength(1);
    } finally {
      stream.stop();
      await client?.close();
      await server.close();
    }
  });

  it("a second process on the same checkout (galley mcp over stdio) shows up in the UI as an outside change", async () => {
    const home = join(scratch, "home-two");
    const root = makeSite("shared-site");
    const env = liveEnv(home);
    const server = await startServer({ port: PORT, findFreePort: false, env, webDir: join(scratch, "no-ui"), notice: () => {}, log: () => {} });
    const stream = subscribe(server.port);
    const client = new Client({ name: "stdio-beside-ui", version: "1.0.0" });

    try {
      const site = await server.services.registry.open({ path: root });

      await stream.ready;
      await client.connect(
        new StdioClientTransport({ command: process.execPath, args: [join(REPO, "packages", "cli", "bin", "galley.js"), "mcp", root], env: env as Record<string, string>, stderr: "ignore" })
      );
      const read = (await client.callTool({ name: "read_entry", arguments: { path: "src/content/pages/about.md" } })) as CallToolResult;
      const entry = JSON.parse((read.content[0] as { text: string }).text);
      const updated = (await client.callTool({ name: "update_entry", arguments: { path: entry.path, baseHash: entry.hash, ops: [{ op: "set", path: "title", value: "About Lowfield, the people" }] } })) as CallToolResult;

      expect(updated.isError, JSON.stringify(updated)).toBeFalsy();
      const event = await until(() => stream.events.find((e) => e.type === "changes.updated" && e.paths.includes("src/content/pages/about.md"))).catch((error) => {
        throw new Error(`${error.message}: ${JSON.stringify(stream.events)} ${JSON.stringify(updated)} ${execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })}`);
      });

      expect(event).toMatchObject({ siteId: site.id, origin: "external" });
      // The UI's own proof (the server's SiteService) sees the edit.
      expect((await site.changes()).files.map((file) => file.path)).toEqual(["src/content/pages/about.md"]);
    } finally {
      stream.stop();
      await client.close();
      await server.close();
    }
  });

  it("GALLEY_MCP=off removes the route from the real server", async () => {
    const home = join(scratch, "home-off");
    const server = await startServer({ port: PORT, findFreePort: false, env: liveEnv(home, { GALLEY_MCP: "off" }), webDir: join(scratch, "no-ui"), notice: () => {}, log: () => {} });

    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: "POST", headers: { ...MCP_HEADERS, authorization: `Bearer ${FIXED_TOKEN}` }, body: JSON.stringify(INIT) });

      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
