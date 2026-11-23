/**
 * The real binary: `node packages/cli/bin/galley.js mcp <site>` as a child
 * process, driven by the SDK client over its stdin/stdout. Everything the
 * child writes to stdout is recorded and must be protocol frames only, through
 * a session that edits a page and starts the preview (the noisiest thing the
 * engine does). Ending the session must end the process and its children.
 */
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult, JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { git, makeSite, REPO, tempDir } from "./helpers";

const BIN = join(REPO, "packages", "cli", "bin", "galley.js");

/** A stdio client transport over a child we spawned ourselves, so every stdout byte can be inspected. */
class RecordingTransport implements Transport {
  readonly stdout: Buffer[] = [];
  readonly stderr: string[] = [];
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private readonly buffer = new ReadBuffer();

  constructor(readonly child: ChildProcessWithoutNullStreams) {}

  async start(): Promise<void> {
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.stdout.push(chunk);
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) this.onmessage?.(message);
    });
    this.child.stderr.on("data", (chunk: Buffer) => this.stderr.push(chunk.toString("utf8")));
    this.child.once("exit", () => this.onclose?.());
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.child.stdin.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.child.stdin.end();
  }
}

function exited(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`still running after ${timeoutMs} ms`)), timeoutMs);

    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Processes whose command line mentions this folder (the dev server runs from inside it). */
function processesUnder(root: string): string[] {
  return execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes(root) && !line.includes("ps -axo"));
}

describe("galley mcp over stdio, as a real child process", () => {
  it("speaks only protocol on stdout through an edit and a preview, and exits with its children when the client goes", async () => {
    const root = makeSite("stdio-site");
    const home = tempDir("stdio-home-");
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GALLEY_HOME: home,
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const child = spawn(process.execPath, [BIN, "mcp", root], { cwd: tempDir("cwd-"), env, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    const transport = new RecordingTransport(child);
    const client = new Client({ name: "stdio-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({ name: "galley" });
      expect(client.getInstructions()).toContain("Call get_site first");
      const tools = (await client.listTools()).tools.map((tool) => tool.name);

      expect(tools).toContain("update_entry");
      expect(tools).not.toContain("list_sites");

      const read = (await client.callTool({ name: "read_entry", arguments: { path: "src/content/pages/index.md" } })) as CallToolResult;
      const entry = JSON.parse((read.content[0] as { text: string }).text);
      const update = (await client.callTool({
        name: "update_entry",
        arguments: { path: entry.path, baseHash: entry.hash, ops: [{ op: "set", path: "sections.0.heading", value: "Make more of the home you already love." }] },
      })) as CallToolResult;

      expect(update.isError).toBeFalsy();
      expect(readFileSync(join(root, entry.path), "utf8")).toContain("heading: Make more of the home you already love.");
      expect(git(root, "status", "--porcelain")).toBe(" M src/content/pages/index.md\n");

      const preview = (await client.callTool({ name: "start_preview", arguments: {} }, undefined, { timeout: 120_000 })) as CallToolResult;
      const previewText = (preview.content[0] as { text: string }).text;

      expect(preview.isError, previewText).toBeFalsy();
      const { url } = JSON.parse(previewText) as { url: string };
      const page = await (await fetch(url)).text();

      expect(page).toContain("Make more of the home you already love.");
      expect(processesUnder(root).length).toBeGreaterThan(0);

      // Everything on stdout parses as a JSON-RPC message, one per line.
      const raw = Buffer.concat(transport.stdout).toString("utf8");
      const lines = raw.split("\n").filter((line) => line !== "");

      expect(raw.endsWith("\n")).toBe(true);
      expect(lines.length).toBeGreaterThan(4);
      for (const line of lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
      // The notices went to stderr instead.
      expect(transport.stderr.join("")).toContain("over MCP");

      // The client hangs up: stdin closes, and the server, the preview and its proxies go with it.
      await client.close();
      expect(await exited(child, 8_000)).toBe(0);
      await expect(fetch(url)).rejects.toThrow();
      expect(processesUnder(root)).toEqual([]);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 180_000);

  it("exits with a plain message on stderr, and nothing on stdout, when the folder isn't a site", async () => {
    const empty = tempDir("not-a-site-");
    const child = spawn(process.execPath, [BIN, "mcp", empty], { env: { PATH: process.env.PATH, HOME: process.env.HOME, GALLEY_HOME: tempDir("h-") } }) as ChildProcessWithoutNullStreams;
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    expect(await exited(child, 30_000)).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("doesn't look like a site");
  }, 40_000);
});
