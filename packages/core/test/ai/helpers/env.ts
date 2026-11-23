/**
 * Shared test scaffolding: temp homes, an environment with no real keys, a
 * recording event bus, and a runtime wired to a scripted client.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAgentRuntime, createImageService, createSettingsService, type GalleyAgentRuntime } from "../../../src/ai/index";
import type { EventBus, ServerEvent, SiteRegistry, SiteService } from "../../../src/types";
import { TEST_KEY } from "./scripted-fetch";

const created: string[] = [];

afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = "ai-test-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));

  created.push(dir);
  return dir;
}

const gitConfig = join(tempDir("ai-gitcfg-"), "gitconfig");

writeFileSync(gitConfig, "[user]\n\tname = Test Editor\n\temail = editor@example.com\n");

/** The process environment minus every key this module reads, git isolated to a known identity. */
export function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete env[name];
  env.GIT_CONFIG_GLOBAL = gitConfig;
  env.GIT_CONFIG_NOSYSTEM = "1";
  return { ...env, ...extra };
}

export interface RecordingBus extends EventBus {
  events: ServerEvent[];
  waitFor(predicate: (event: ServerEvent) => boolean, timeoutMs?: number): Promise<ServerEvent>;
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
    waitFor(predicate, timeoutMs = 10_000) {
      const seen = events.find(predicate);

      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error("timed out waiting for an event"));
        }, timeoutMs);
        const off = this.subscribe((event) => {
          if (!predicate(event)) return;
          clearTimeout(timer);
          off();
          resolve(event);
        });
      });
    },
  };
}

export function registryOf(...sites: SiteService[]): SiteRegistry {
  const byId = new Map(sites.map((site) => [site.id, site]));

  return {
    list: async () => [],
    get: async (id) => byId.get(id) ?? null,
    open: async () => {
      throw new Error("not in tests");
    },
    clone: async () => {
      throw new Error("not in tests");
    },
    create: async () => {
      throw new Error("not in tests");
    },
    starterPreview: async () => null,
    remove: async () => {},
    starters: async () => [],
    job: () => null,
    dispose: async () => {},
  };
}

export interface Harness {
  home: string;
  runtime: GalleyAgentRuntime;
  bus: RecordingBus;
  logs: string[];
  settings: ReturnType<typeof createSettingsService>;
  /** Sends and waits for chat.done. */
  turn(threadId: string, text: string, extra?: Record<string, unknown>): Promise<{ turnId: string }>;
}

export function harness(options: {
  client: Anthropic;
  site: SiteService;
  withKey?: boolean;
  maxTokens?: number;
  maxSteps?: number;
  profile?: "full" | "plain";
  /** Where GALLEY_AI_PROFILE is read from; default: an empty environment, so the operator's shell can't leak in. */
  profileEnv?: NodeJS.ProcessEnv;
  contextWindow?: number;
}): Harness {
  const home = tempDir("ai-home-");
  const env = cleanEnv(options.withKey === false ? {} : { ANTHROPIC_API_KEY: TEST_KEY });
  const settings = createSettingsService({ home, env });
  const images = createImageService({ home, settings });
  const bus = recordingBus();
  const logs: string[] = [];
  const runtime = createAgentRuntime({
    home,
    registry: registryOf(options.site),
    settings,
    images,
    events: bus,
    client: options.client,
    maxTokens: options.maxTokens ?? 8_000,
    ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}),
    env: options.profileEnv ?? {},
    logger: (line) => logs.push(line),
  });

  return {
    home,
    runtime,
    bus,
    logs,
    settings,
    async turn(threadId, text, extra = {}) {
      const before = bus.events.length;
      const started = await runtime.send(options.site.id, threadId, { text, ...extra });

      await new Promise<void>((resolve, reject) => {
        const check = () => bus.events.slice(before).some((e) => e.type === "chat.done" && e.turnId === started.turnId);

        if (check()) return resolve();
        const timer = setTimeout(() => reject(new Error("turn did not finish")), 15_000);
        const off = bus.subscribe(() => {
          if (!check()) return;
          clearTimeout(timer);
          off();
          resolve();
        });
      });
      return started;
    },
  };
}
