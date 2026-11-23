import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { isTestRunnerMarker, resolveCommand, withoutAgentMarkers } from "../../src/workspace/command";

describe("test-runner markers never reach a site's own commands", () => {
  const root = mkdtempSync(join(tmpdir(), "command-env-"));

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("recognises vitest and jest markers, and TEST only when it is switched on", () => {
    expect(isTestRunnerMarker("VITEST", "true")).toBe(true);
    expect(isTestRunnerMarker("VITEST_POOL_ID", "1")).toBe(true);
    expect(isTestRunnerMarker("VITEST_WORKER_ID", "3")).toBe(true);
    expect(isTestRunnerMarker("JEST_WORKER_ID", "1")).toBe(true);
    expect(isTestRunnerMarker("TEST", "true")).toBe(true);
    expect(isTestRunnerMarker("TEST", "1")).toBe(true);
    // A site's own TEST variable with some other meaning is left alone.
    expect(isTestRunnerMarker("TEST", "staging")).toBe(false);
    expect(isTestRunnerMarker("TEST", undefined)).toBe(false);
    expect(isTestRunnerMarker("TESTING", "true")).toBe(false);
    expect(isTestRunnerMarker("PATH", "/usr/bin")).toBe(false);
  });

  it("strips them from an inherited environment", () => {
    const env = withoutAgentMarkers({ VITEST: "true", VITEST_MODE: "RUN", JEST_WORKER_ID: "2", TEST: "true", HOME: "/home/someone", CLAUDECODE: "1" });

    expect(env).toEqual({ HOME: "/home/someone" });
    expect(withoutAgentMarkers({ TEST: "staging" })).toEqual({ TEST: "staging" });
  });

  it("resolveCommand drops the markers this test process carries, but keeps ones set on purpose", () => {
    // Vitest sets VITEST in this very process — the situation the fix is for.
    expect(process.env.VITEST).toBeDefined();
    const inherited = resolveCommand(root, "node --version");

    expect(inherited.env.VITEST).toBeUndefined();
    expect(Object.keys(inherited.env).some((name) => name.startsWith("VITEST_"))).toBe(false);
    expect(resolveCommand(root, "node --version", { VITEST: "true" }).env.VITEST).toBe("true");
  });
});

describe("the adapter's environment reaches the site's own commands", () => {
  const root = mkdtempSync(join(tmpdir(), "command-env-adapter-"));

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("applies it to the build, after inherited markers are removed, and to a package-manager script's arguments", async () => {
    const { writeFileSync, readFileSync } = await import("node:fs");
    const { runBuild } = await import("../../src/workspace/build");
    const { withArguments } = await import("../../src/workspace/command");
    const saved = process.env.AI_AGENT;

    writeFileSync(join(root, "print-env.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync("env.json", JSON.stringify({ flavour: process.env.SITE_FLAVOUR ?? null, agent: process.env.AI_AGENT ?? null, ci: process.env.CI ?? null }));');
    process.env.AI_AGENT = "inherited";
    try {
      const result = await runBuild(root, "node print-env.mjs", { env: { SITE_FLAVOUR: "from-the-adapter", AI_AGENT: "set-on-purpose" } });

      expect(result.ok).toBe(true);
      expect(JSON.parse(readFileSync(join(root, "env.json"), "utf8"))).toEqual({ flavour: "from-the-adapter", agent: "set-on-purpose", ci: "1" });
      await runBuild(root, "node print-env.mjs");
      expect(JSON.parse(readFileSync(join(root, "env.json"), "utf8"))).toEqual({ flavour: null, agent: null, ci: "1" });
    } finally {
      if (saved === undefined) delete process.env.AI_AGENT;
      else process.env.AI_AGENT = saved;
    }
    // npm needs "--" before arguments meant for the script; the others pass them straight on.
    expect(withArguments(["npm", "run", "dev"], ["--port", "4322"])).toEqual(["npm", "run", "dev", "--", "--port", "4322"]);
    expect(withArguments(["npm", "run", "dev", "--", "--host"], ["--port", "4322"])).toEqual(["npm", "run", "dev", "--", "--host", "--port", "4322"]);
    expect(withArguments(["pnpm", "run", "dev"], ["--port", "4322"])).toEqual(["pnpm", "run", "dev", "--port", "4322"]);
    expect(withArguments(["astro", "dev"], ["--port", "4322"])).toEqual(["astro", "dev", "--port", "4322"]);
    expect(resolveCommand(root, "node --version", {}, ["--port", "1"]).args).toEqual(["--version", "--port", "1"]);
  });

  it("is passed by the site to its build and its preview", async () => {
    const { openSiteService } = await import("../../src/site/service");
    const { createEventBus } = await import("../../src/site/events");
    const { writeFileSync, readFileSync, mkdirSync } = await import("node:fs");
    const site = join(root, "site");

    mkdirSync(join(site, "tools"), { recursive: true });
    writeFileSync(join(site, "package.json"), JSON.stringify({ name: "env-site", scripts: { build: "node print-env.mjs" } }));
    writeFileSync(join(site, "print-env.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync("env.json", JSON.stringify({ flavour: process.env.SITE_FLAVOUR ?? null }));');
    writeFileSync(join(site, "tools", "adapter.mjs"), 'export default { id: "envy", name: "Envy", detect: () => ({ confidence: 1 }), conventions: () => ({ build: { command: "node print-env.mjs" } }), environment: () => ({ SITE_FLAVOUR: "from-the-adapter" }) };');
    writeFileSync(join(site, "galley.config.json"), JSON.stringify({ adapters: ["./tools/adapter.mjs"], build: { command: "node print-env.mjs" } }));
    const service = await openSiteService(site, { id: "env", events: createEventBus(), overlayScript: () => "", author: () => null, watch: false });

    try {
      expect((await service.model()).environment).toEqual({ SITE_FLAVOUR: "from-the-adapter" });
      expect((await service.build()).ok).toBe(true);
      expect(JSON.parse(readFileSync(join(site, "env.json"), "utf8"))).toEqual({ flavour: "from-the-adapter" });
    } finally {
      await service.dispose();
    }
  });
});
