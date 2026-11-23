/**
 * `galley mcp`: help, the token, the printed configurations, and a stdio
 * session served in-process over a pair of streams (the real child process
 * is exercised in packages/mcp/test/stdio.test.ts).
 */
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { MCP_CLIENTS } from "@galley/mcp";
import { openSingleSite } from "@galley/server";
import type { Io } from "../src/io";
import { HELP, main } from "../src/main";

const fixture = fileURLToPath(new URL("../../core/test/fixtures/astro-site", import.meta.url));
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-cli-mcp-")));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function testIo(overrides: Partial<Io> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = {
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: join(tmp, "home") },
    startServer: () => {
      throw new Error("startServer not faked");
    },
    openBrowser: async () => true,
    waitForStop: async () => {},
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
    launcher: { command: "/usr/bin/node", args: ["/opt/galley/packages/cli/bin/galley.js"] },
    ...overrides,
  };

  return { io, stdout, stderr };
}

function site(name: string): string {
  const target = join(tmp, name);

  cpSync(fixture, target, { recursive: true });
  return target;
}

describe("galley mcp --help", () => {
  it("is listed in the main help and has its own", async () => {
    expect(HELP).toContain("galley mcp [path]");
    const { io, stdout } = testIo();

    expect(await main(["mcp", "--help"], io)).toBe(0);
    expect(stdout.join("\n")).toMatch(/^Usage: galley mcp \[path\]/);
    expect(stdout.join("\n")).toContain("--read-only");
  });

  it("refuses unknown options and folders that aren't sites", async () => {
    const bogus = testIo();

    expect(await main(["mcp", "--bogus"], bogus.io)).toBe(2);
    const empty = testIo();

    expect(await main(["mcp", tmp], empty.io)).toBe(1);
    expect(empty.stderr.join("\n")).toContain("doesn't look like a site");
    expect(empty.stdout).toEqual([]);
  });
});

describe("galley mcp token", () => {
  it("prints the token once, keeps only its hash, and rotates", async () => {
    const home = join(tmp, "token-home");
    const first = testIo({ env: { GALLEY_HOME: home } });

    expect(await main(["mcp", "token"], first.io)).toBe(0);
    const token = first.stdout[0]!;

    expect(first.stdout).toHaveLength(1);
    expect(token).toMatch(/^galley_mcp_[A-Za-z0-9_-]{43}$/);
    expect(first.stderr.join("\n")).toContain("shown this once");
    const file = join(home, "mcp-token.json");
    const stored = readFileSync(file, "utf8");

    expect(stored).not.toContain(token);
    expect(JSON.parse(stored).sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = testIo({ env: { GALLEY_HOME: home } });

    expect(await main(["mcp", "token"], again.io)).toBe(0);
    expect(again.stdout).toEqual([]);
    expect(again.stderr.join("\n")).toContain(`ending in …${token.slice(-4)}`);
    expect(again.stderr.join("\n")).not.toContain(token);

    const rotated = testIo({ env: { GALLEY_HOME: home } });

    expect(await main(["mcp", "token", "--rotate"], rotated.io)).toBe(0);
    expect(rotated.stdout[0]).not.toBe(token);
  });
});

describe("galley mcp config", () => {
  it.each(MCP_CLIENTS)("prints the npx form first for %s, then the form from a copy of the code", async (client) => {
    const root = site(`config-${client}`);
    const { io, stdout } = testIo();

    expect(await main(["mcp", "config", root, "--client", client], io)).toBe(0);
    const output = stdout.join("\n");
    const copyAt = output.indexOf("From a copy of the code");

    expect(output).not.toContain("is published to npm");
    expect(copyAt).toBeGreaterThan(0);
    expect(output.indexOf("galley-cms")).toBeLessThan(copyAt);
    expect(output.indexOf("/opt/galley/packages/cli/bin/galley.js")).toBeGreaterThan(copyAt);
    expect(output).toContain(root);
    if (client === "claude-code") {
      expect(output).toContain(`claude mcp add --transport stdio galley -- npx -y galley-cms mcp ${root}`);
      expect(output).toContain(`claude mcp add --transport stdio galley -- /usr/bin/node /opt/galley/packages/cli/bin/galley.js mcp ${root}`);
    } else {
      const json = output.slice(output.indexOf("{"), output.indexOf("\n}") + 2);
      const parsed = JSON.parse(json);
      const entry = client === "generic" ? parsed : parsed.mcpServers.galley;

      expect(entry).toMatchObject({ command: "npx", args: ["-y", "galley-cms", "mcp", root] });
    }
  });

  it("offers only the npx form when this copy runs from npx's cache", async () => {
    const root = site("config-npx-cache");
    const { io, stdout } = testIo({ launcher: { command: "/usr/bin/node", args: ["/Users/someone/.npm/_npx/0f1e2d/node_modules/galley-cms/bin/galley.js"] } });

    expect(await main(["mcp", "config", root, "--client", "cursor"], io)).toBe(0);
    const output = stdout.join("\n");

    expect(output).toContain('"npx"');
    expect(output).not.toContain("From a copy of the code");
    expect(output).not.toContain("_npx");
  });

  it("passes --build and --read-only on", async () => {
    const root = site("config-flags");
    const { io, stdout } = testIo();

    expect(await main(["mcp", "config", root, "--client", "cursor", "--build", "--read-only"], io)).toBe(0);
    expect(stdout.join("\n")).toMatch(/"--build",\s+"--read-only"/);
  });

  it.each(MCP_CLIENTS)("prints an HTTP configuration for %s", async (client) => {
    const { io, stdout } = testIo({ env: { GALLEY_PUBLIC_URL: "https://cms.example.com" } });

    expect(await main(["mcp", "config", "--client", client, "--http"], io)).toBe(0);
    const output = stdout.join("\n");

    expect(output).toContain("https://cms.example.com/mcp");
    expect(output).toMatch(/Bearer/);
    expect(output).not.toContain("galley-cms");
  });

  it("explains that Claude Desktop can't reach a server on this computer over HTTP", async () => {
    const { io, stdout } = testIo();

    expect(await main(["mcp", "config", "--client", "claude-desktop", "--http"], io)).toBe(0);
    expect(stdout.join("\n")).toContain("use the stdio configuration instead");
  });

  it("needs a known client", async () => {
    const { io, stderr } = testIo();

    expect(await main(["mcp", "config", "--client", "emacs"], io)).toBe(2);
    expect(stderr.join("\n")).toContain("claude-desktop, claude-code, cursor, vscode, generic");
  });
});

describe("galley mcp (serving)", () => {
  it("serves one site over the given streams and returns when the client hangs up", async () => {
    const root = site("serve-site");
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const frames: string[] = [];
    let disposed = false;

    stdout.on("data", (chunk: Buffer) => frames.push(...chunk.toString("utf8").split("\n").filter(Boolean)));
    const { io, stderr } = testIo({
      stdio: { stdin, stdout },
      openSite: async (options) => {
        const engine = await openSingleSite({ ...options, watch: false });

        return {
          ...engine,
          dispose: async () => {
            disposed = true;
            await engine.dispose();
          },
        };
      },
    });
    const running = main(["mcp", root, "--read-only"], io);
    const reply = (id: number) =>
      new Promise<Record<string, any>>((resolve) => {
        const check = () => {
          const frame = frames.map((line) => JSON.parse(line)).find((message) => message.id === id);

          if (frame) resolve(frame);
          else setTimeout(check, 20);
        };

        check();
      });

    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } })}\n`);
    expect((await reply(1)).result.serverInfo.name).toBe("galley");
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    const tools = (await reply(2)).result.tools.map((tool: { name: string }) => tool.name);

    expect(tools).toContain("read_entry");
    expect(tools).not.toContain("update_entry");
    stdin.end();
    expect(await running).toBe(0);
    expect(disposed).toBe(true);
    expect(stderr.join("\n")).toContain("read-only");
  });
});
