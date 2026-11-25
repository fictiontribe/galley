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

  it.each(["/", "/about/", "/src/env.d.ts", "/@vite/env", "/environment", "/src/pages/index.astro?raw", "/.well-known/security.txt", "/node_modules/.vite/deps/chunk.js", "/caf%C3%A9/", "/100%25/", "/a%20b.html?x=%ZZ"])("passes %s on as before", async (path) => {
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

  it.each([
    ["sent after the dev server's answer", false],
    ["riding in the same packet as the upgrade", true],
  ] as const)("passes on no second request on a socket the dev server didn't upgrade (%s)", async (_how, together) => {
    asked.length = 0;
    const first = "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n";
    const second = "GET /.envrc HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(Number(new URL(preview.url).port), "127.0.0.1");
      let text = "";
      let sentSecond = together;

      socket.on("error", reject);
      socket.on("data", (chunk) => {
        text += chunk.toString();
        if (!sentSecond) {
          sentSecond = true;
          socket.write(second);
        }
      });
      socket.on("close", () => resolve(text));
      socket.on("connect", () => socket.write(together ? first + second : first));
      setTimeout(() => socket.destroy(), 4000).unref();
    });

    // The dev server answered the first as it would a plain request, and that answer came back; it was asked nothing more.
    expect(answer).toMatch(/^HTTP\/1\.1 200 /);
    expect(answer).toContain("TOKEN=served-for /");
    expect(answer).not.toContain("served-for /.envrc");
    expect(asked).toEqual(["/"]);
  });

  it.each(["/%ZZ/%2e%2e/%2eenvrc", "/%2eenv/%ZZ/..", "/%E0%A4%A/%2eenvrc", "/%"])("answers 400 for %s, an address it can't read, and passes it to nobody", async (path) => {
    asked.length = 0;
    const answer = await get(preview, path);

    expect(answer.status).toBe(400);
    expect(answer.text).not.toContain("TOKEN=");
    expect(asked).toEqual([]);
  });

  it.each(["/%252eenvrc", "/%25252eenvrc", "/a/%2e%2e/.envrc", "/a/b/../../.env-production", "/x/..%2f.envrc", "//.envrc", "/.envrc/", "/%E0%A4%A/.envrc"])("passes %s to nobody, however the dev server would come to read it", async (path) => {
    asked.length = 0;
    const answer = await get(preview, path);

    expect(answer.status).toBe(403);
    expect(asked).toEqual([]);
  });

  it("ends the browser's side when the dev server closes an upgrade without answering it", async () => {
    // A dev server that takes the connection and hangs up without a word.
    const silent = net.createServer((socket) => socket.once("data", () => socket.destroy()));

    await new Promise<void>((done) => silent.listen(0, "127.0.0.1", done));
    const proxy = await startPreviewProxy({ upstreamHost: "127.0.0.1", upstreamPort: (silent.address() as AddressInfo).port, host: "127.0.0.1", publicHost: "127.0.0.1", overlayScript: () => "" });

    try {
      const started = Date.now();
      const closed = await new Promise<boolean>((resolve, reject) => {
        const socket = net.connect(Number(new URL(proxy.url).port), "127.0.0.1");

        socket.on("error", reject);
        socket.on("data", () => undefined);
        socket.on("close", () => resolve(true));
        socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"));
        setTimeout(() => resolve(false), 3000).unref();
      });

      expect(closed).toBe(true);
      expect(Date.now() - started).toBeLessThan(2500);
    } finally {
      await proxy.close();
      await new Promise((done) => silent.close(done));
    }
  });

  it("leaves the live site's proxy alone: that is another server's files, not this folder's", async () => {
    asked.length = 0;
    expect((await get(baseline, "/.envrc")).status).toBe(200);
    expect(asked).toEqual(["/.envrc"]);
  });
});
