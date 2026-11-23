import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { RunningServer, ServerOptions } from "@galley/server";
import { watchStdin, type Io } from "../src/io";
import { main } from "../src/main";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-desktop-")));
const bin = fileURLToPath(new URL("../bin/galley.js", import.meta.url));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function fakeIo(overrides: Partial<Io> = {}): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    env: { HOME: tmp, GALLEY_HOME: join(tmp, "home") },
    startServer: () => {
      throw new Error("startServer not faked");
    },
    openBrowser: async () => {
      throw new Error("the desktop command must not open a browser");
    },
    waitForStop: () => new Promise<void>(() => {}),
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
    ...overrides,
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

describe("watchStdin", () => {
  it("resolves when standard input ends", async () => {
    const stdin = new PassThrough();
    const watch = watchStdin(stdin);

    stdin.end();
    await expect(watch.gone).resolves.toBeUndefined();
  });

  it("stop() lets go of the stream without reporting the parent gone", async () => {
    const stdin = new PassThrough();
    const watch = watchStdin(stdin);
    let gone = false;

    void watch.gone.then(() => (gone = true));
    watch.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gone).toBe(false);
    expect(stdin.destroyed).toBe(true);
  });
});

describe("galley desktop", () => {
  it("starts a local, desktop-flagged server on exactly the port given, opens no site, and stops when the parent goes", async () => {
    const calls: string[] = [];
    let received: ServerOptions = {};
    let parentGone!: () => void;
    const io = fakeIo({
      env: { HOME: tmp, GALLEY_HOST: "127.0.0.1" },
      startServer: async (options) => {
        received = { ...options };
        calls.push("start");
        return { url: "http://127.0.0.1:4555", close: async () => void calls.push("close") } as unknown as RunningServer;
      },
      watchParent: () => {
        calls.push("watch");
        return { gone: new Promise<void>((resolve) => (parentGone = resolve)), stop: () => void calls.push("unwatch") };
      },
    });
    const run = main(["desktop", "--exit-with-parent", "--port", "4555"], io);

    await new Promise((resolve) => setTimeout(resolve, 10));
    parentGone();
    expect(await run).toBe(0);
    expect(received).toMatchObject({ mode: "local", host: "127.0.0.1", port: 4555, findFreePort: false, desktop: true });
    expect(calls).toEqual(["watch", "start", "unwatch", "close"]);
    expect(io.stdout).toContain("Galley is running at http://127.0.0.1:4555");
  });

  it("doesn't watch the parent without --exit-with-parent", async () => {
    let watched = false;
    const io = fakeIo({
      startServer: async () => ({ url: "u", close: async () => {} }) as unknown as RunningServer,
      waitForStop: async () => {},
      watchParent: () => {
        watched = true;
        return { gone: new Promise<void>(() => {}), stop: () => {} };
      },
    });

    expect(await main(["desktop"], io)).toBe(0);
    expect(watched).toBe(false);
  });

  it("refuses a host that isn't this computer", async () => {
    const { startServer } = await import("@galley/server");
    const io = fakeIo({ startServer, env: { HOME: tmp, GALLEY_HOME: join(tmp, "refuse-home"), GALLEY_HOST: "0.0.0.0" } });

    expect(await main(["desktop"], io)).toBe(1);
    expect(io.stderr.join("\n")).toMatch(/only listens on this computer/);
  });

  // The real thing: a separate process whose stdin is a pipe we hold, the way the desktop shell runs it.
  it("as a real process, exits and frees its port when standard input closes", async () => {
    const token = "desktop-test-token-0123456789";
    const port = await freePort();
    const child = spawn(process.execPath, [bin, "desktop", "--exit-with-parent", "--port", String(port)], {
      env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: join(tmp, "real-home"), GALLEY_TOKEN: token, GALLEY_WEB_DIR: join(tmp, "no-ui"), GALLEY_DESKTOP: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));

    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no start-up line:\n${output}`)), 45_000);

      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = /running at (http:\/\/127\.0\.0\.1:\d+)/.exec(output);

        if (match) {
          clearTimeout(timer);
          resolve(match[1]!);
        }
      });
    });
    expect(url).toBe(`http://127.0.0.1:${port}`);
    const meta = await (await fetch(`${url}/api/meta`, { headers: { authorization: `Bearer ${token}` } })).json();

    expect(meta).toMatchObject({ desktop: true, mode: "local", authenticated: true });
    child.stdin.end();
    const started = Date.now();

    expect(await exited).toBe(0);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(await portAnswers(port)).toBe(false);
    expect(output).toContain("has exited. Stopping…");
  });
});
