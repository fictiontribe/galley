/**
 * Test scaffolding: a git-initialised copy of the starter site in a temp
 * folder, the real engine over it, and an SDK client wired to a server
 * through the SDK's in-memory transport.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createImageService, createSettingsService } from "@galley/core/ai";
import { PRODUCT } from "@galley/core/brand";
import { createSiteService } from "@galley/core/site";
import type { EventBus, ServerEvent, SiteService } from "@galley/core/types";
import { createMcpServer, singleSite, type McpServerOptions } from "../src/index";

export const REPO = fileURLToPath(new URL("../../..", import.meta.url));
export const STARTER = join(REPO, "starters", "astro-starter");
const SKIP = new Set(["node_modules", "dist", ".astro"]);

const created: string[] = [];

afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix: string): string {
  const base = join(tmpdir(), "galley-mcp");

  mkdirSync(base, { recursive: true });
  const dir = realpathSync(mkdtempSync(join(base, prefix)));

  created.push(dir);
  return dir;
}

// Git runs with a known identity and none of this machine's settings; no model keys reach the engine.
const gitConfig = join(tempDir("gitcfg-"), "gitconfig");

writeFileSync(gitConfig, "[user]\n\tname = Test Editor\n\temail = editor@example.com\n[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = gitConfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";
for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete process.env[name];

export function testEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...extra };
}

/** A git-initialised copy of the starter, node_modules linked rather than copied. */
export function makeSite(name = "site"): string {
  const root = join(tempDir(`${name}-`), name);

  cpSync(STARTER, root, { recursive: true, filter: (source) => !SKIP.has(source.split("/").pop() ?? "") });
  symlinkSync(join(STARTER, "node_modules"), join(root, "node_modules"));
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "Initial site");
  return root;
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", env: process.env });
}

export interface RecordingBus extends EventBus {
  events: ServerEvent[];
}

export function recordingBus(): RecordingBus {
  const listeners = new Set<(event: ServerEvent) => void>();
  const events: ServerEvent[] = [];

  return {
    events,
    emit(event) {
      events.push(event);
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface Engine {
  site: SiteService;
  events: RecordingBus;
  home: string;
  images: ReturnType<typeof createImageService>;
  settings: ReturnType<typeof createSettingsService>;
}

export async function openEngine(root: string, options: { watch?: boolean } = {}): Promise<Engine> {
  const home = tempDir("home-");
  const events = recordingBus();
  const settings = createSettingsService({ home, env: testEnv() });
  const images = createImageService({ home, settings });
  const site = await createSiteService(root, {
    id: "test-site",
    events,
    overlayScript: () => "",
    author: () => ({ name: "Test Editor", email: "editor@example.com" }),
    watch: options.watch ?? false,
  });

  return { site, events, home, images, settings };
}

export type ServerOverrides = Partial<Omit<McpServerOptions, "sites">> & { sites?: McpServerOptions["sites"] };

export async function connect(engine: Engine, overrides: ServerOverrides = {}): Promise<{ client: Client; close(): Promise<void> }> {
  const server = createMcpServer({
    sites: singleSite(engine.site),
    mode: "content",
    allowPublish: true,
    transport: "stdio",
    brand: { name: PRODUCT.name, version: "0.0.0-test" },
    ...overrides,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(result: unknown): string {
  const content = (result as CallToolResult).content ?? [];

  return content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = textOf(result);

  return { result, text, isError: Boolean(result.isError), json: () => JSON.parse(text) as Record<string, any> };
}
