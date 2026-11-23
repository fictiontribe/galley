import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GalleyError } from "@galley/core";
import type { SecretStatus, Settings } from "@galley/core/types";
import { json, testApp } from "./helpers";

const SECRET = "sk-ant-THIS-IS-THE-SECRET-VALUE-1234";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []
  );
}

describe("secrets never cross the HTTP boundary", () => {
  it("PUT /api/secrets/:name answers with the status fields only", async () => {
    const leaky = { name: "anthropic", configured: true, source: "stored", hint: "1234", value: SECRET } as SecretStatus;
    const app = testApp({ settings: { setSecret: async () => leaky } });
    const response = await app.call("PUT", "/api/secrets/anthropic", { value: SECRET });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ name: "anthropic", configured: true, source: "stored", hint: "1234" });
    expect(text).not.toContain(SECRET);
    expect(app.logs.join("")).not.toContain(SECRET);
  });

  it("a hint is cut to its last four characters whatever the engine sends", async () => {
    const app = testApp({ settings: { setSecret: async () => ({ name: "openai", configured: true, source: "stored", hint: SECRET }) } });
    const body = await json(await app.call("PUT", "/api/secrets/openai", { value: SECRET }));

    expect(body.hint).toBe("1234");
  });

  it("GET and PATCH /api/settings strip anything but status from secrets", async () => {
    const settings = { ai: {}, images: {}, author: {}, appearance: {}, secrets: [{ name: "anthropic", configured: true, source: "env", value: SECRET }] } as unknown as Settings;
    const app = testApp({ settings: { get: async () => settings, update: async () => settings } });

    for (const response of [await app.call("GET", "/api/settings"), await app.call("PATCH", "/api/settings", {})]) {
      const text = await response.text();

      expect(text).not.toContain(SECRET);
      expect(JSON.parse(text).secrets).toEqual([{ name: "anthropic", configured: true, source: "env" }]);
    }
  });

  it("an engine error that quotes the secret is scrubbed from the response and the log", async () => {
    for (const thrown of [new Error(`key ${SECRET} was rejected`), new GalleyError("invalid", `The key ${SECRET} was rejected.`, `detail ${SECRET}`)]) {
      const app = testApp({
        settings: {
          setSecret: async () => {
            throw thrown;
          },
        },
      });
      const text = await (await app.call("PUT", "/api/secrets/anthropic", { value: SECRET })).text();

      expect(text).not.toContain(SECRET);
      expect(app.logs.join("\n")).not.toContain(SECRET);
    }
  });

  it("a rejected secret body never echoes the value", async () => {
    const long = `${SECRET}${"x".repeat(5000)}`;
    const app = testApp();
    const text = await (await app.call("PUT", "/api/secrets/anthropic", { value: long })).text();

    expect(text).not.toContain(SECRET);
    const unknownName = await (await app.call("PUT", "/api/secrets/aws", { value: SECRET })).text();

    expect(unknownName).not.toContain(SECRET);
  });

  it("the server never reads a secret, and never logs request bodies (source grep)", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const files = sourceFiles(src);

    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, "utf8");

      expect(text, file).not.toMatch(/readSecret\s*\(/);
      expect(text, file).not.toMatch(/console\.(log|info|debug)\(/);
      // The only log sink is errorResponse (errors.ts), which writes method, path and the error.
      if (!file.endsWith("errors.ts")) expect(text, file).not.toMatch(/\blog\(\s*`[^`]*(body|value|password|secret)/i);
    }
  });
});
