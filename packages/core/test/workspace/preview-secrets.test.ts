/**
 * The preview is the site's own dev server, and a dev server answers for
 * files of the site's folder by their path. What it refuses is its
 * framework's to say: Vite refuses `.env` and `.env.*`, and answers for
 * `.envrc` and `.env-production`. So the proxy in front of it asks the same
 * question as every other way a file is shown, and passes no such address on.
 */
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBaselineProxy, startPreviewProxy, type ProxyHandle } from "../../src/workspace/preview/proxy";

const asked: string[] = [];
let devServer: http.Server;
let preview: ProxyHandle;
let baseline: ProxyHandle;

beforeAll(async () => {
  // A dev server that answers for any path, as one would for a file it has.
  devServer = http.createServer((req, res) => {
    asked.push(req.url ?? "");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`TOKEN=served-for ${req.url}`);
  });
  await new Promise<void>((done) => devServer.listen(0, "127.0.0.1", done));
  const port = (devServer.address() as AddressInfo).port;

  preview = await startPreviewProxy({ upstreamHost: "127.0.0.1", upstreamPort: port, host: "127.0.0.1", publicHost: "127.0.0.1", overlayScript: () => "" });
  baseline = await startBaselineProxy({ url: `http://127.0.0.1:${port}`, host: "127.0.0.1", publicHost: "127.0.0.1" });
});

afterAll(async () => {
  await preview.close();
  await baseline.close();
  await new Promise((done) => devServer.close(done));
});

async function get(from: ProxyHandle, path: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    // The path as written, so an encoded one reaches the proxy encoded.
    http
      .get({ host: "127.0.0.1", port: new URL(from.url).port, path }, (res) => {
        let text = "";

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      })
      .on("error", reject);
  });
}

describe("the preview, asked for a file by its path", () => {
  it.each([
    "/.envrc",
    "/.envrc?raw",
    "/.env-production?raw",
    "/.env_local?url",
    "/.ENV",
    "/config/.Env.Staging?import&raw",
    "/@fs/home/site/.envrc?raw",
    "/%2Eenvrc",
    "/.%65nvrc?raw",
    "/.git/config",
    "/sub/.GIT/HEAD?raw",
    "/@fs/home/site/.git/config",
  ])("passes %s to nobody", async (path) => {
    asked.length = 0;
    const answer = await get(preview, path);

    expect(answer.status).toBe(403);
    expect(answer.text).toContain("That file can't be shown here.");
    expect(answer.text).not.toContain("TOKEN=");
    expect(asked).toEqual([]);
  });

  it.each(["/", "/about/", "/src/env.d.ts", "/@vite/env", "/environment", "/src/pages/index.astro?raw", "/.well-known/security.txt", "/node_modules/.vite/deps/chunk.js"])("passes %s on as before", async (path) => {
    asked.length = 0;
    const answer = await get(preview, path);

    expect(answer.status).toBe(200);
    expect(asked).toEqual([path]);
  });

  it.each(["/.envrc", "/.env-production?raw", "/%2Eenvrc", "/.git/config"])("passes an upgrade for %s to nobody either", async (path) => {
    asked.length = 0;
    // A dev server with nothing listening for upgrades answers one as it would a plain request.
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(Number(new URL(preview.url).port), "127.0.0.1");
      let text = "";

      socket.on("error", reject);
      socket.on("data", (chunk) => (text += chunk.toString()));
      socket.on("close", () => resolve(text));
      socket.on("connect", () => socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`));
      setTimeout(() => socket.destroy(), 1500).unref();
    });

    expect(answer).not.toContain("TOKEN=");
    expect(answer).toMatch(/^HTTP\/1\.1 403 /);
    expect(asked).toEqual([]);
  });

  it("leaves the live site's proxy alone: that is another server's files, not this folder's", async () => {
    asked.length = 0;
    expect((await get(baseline, "/.envrc")).status).toBe(200);
    expect(asked).toEqual(["/.envrc"]);
  });
});
