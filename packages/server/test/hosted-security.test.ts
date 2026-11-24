/**
 * The hosted install's security claims, one test each, end to end against a
 * started hosted server with the real engine, real folders and a real
 * repository. Read the titles as the claims; the bodies as their proof.
 */
import { existsSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRODUCT, VERSION } from "@galley/core/brand";
import { INSTALL_SCHEMA_VERSION, sealArchive, type RestoreUpload } from "@galley/core/install";
import type { Job, PreviewStatus } from "@galley/core/types";
import { call, EDITOR, EDITOR_HOST, entryPath, git, LIVE_HOST, PASSWORD, PREVIEW_HOST, sandbox, signIn, siteRepository, startHosted, stopHosted, waitForJob, type Started } from "./hosted-helpers";

const box = sandbox("hosted-security");

afterAll(() => box.cleanup(), 120_000);

const PREVIEW = `https://${PREVIEW_HOST}`;
const SESSION = `__Host-${PRODUCT.slug}_session`;

/** Fake, distinctive values for every secret an install holds. */
const SECRETS = {
  password: "fake-password-SECURITY-CLAIMS-1234",
  setupCode: "fake-setup-code-SECURITY-CLAIMS-0123456789",
  operatorToken: "fake-operator-token-SECURITY-CLAIMS",
  accessToken: "fake-access-token-SECURITY-CLAIMS-0000",
  assistantKey: "sk-ant-api03-fakeSECURITYCLAIMS000000000",
};

/** Route keys read from the contract's source, as routes.test.ts reads them. */
function contractKeys(): string[] {
  const source = readFileSync(fileURLToPath(new URL("../../core/src/api.ts", import.meta.url)), "utf8");
  const block = source.slice(source.indexOf("export interface ApiRoutes"), source.indexOf("export type ApiRouteKey"));

  return [...block.matchAll(/"((?:GET|POST|PUT|PATCH|DELETE) \/api[^"]*)"/g)].map((match) => match[1]!);
}

interface World {
  started: Started;
  port: number;
  home: string;
  site: string;
  siteId: string;
  cookie: string;
  /** Secrets that only exist once the install made them. */
  made: { privateKeyLines: string[]; captureKey: string; sessionKey: string };
}

let world: World;

/** A hosted install set up through first run with the setup link, every kind of secret in it. */
async function setUp(): Promise<World> {
  const home = box.folder("home");
  const bare = siteRepository(box);
  const started = await startHosted(box, home, { GALLEY_PUBLIC_URL: EDITOR, GALLEY_SETUP_TOKEN: SECRETS.setupCode, GALLEY_TOKEN: SECRETS.operatorToken });
  const { port } = started;
  const code = SECRETS.setupCode;
  const cookie = (await call(port, "POST", "/api/setup/password", { bearer: code, origin: null, body: { password: SECRETS.password } })).cookies[0]!;
  const job = await call<Job>(port, "POST", "/api/setup/site", { cookie, body: { repository: bare, access: "token", token: SECRETS.accessToken } });

  expect((await waitForJob(port, job.body, { cookie })).state).toBe("done");
  await call(port, "PUT", "/api/setup/details", { cookie, body: { author: { name: "Sam Editor", email: "sam@example.com" } } });
  await call(port, "POST", "/api/setup/finish", { cookie });
  expect((await call(port, "PUT", "/api/secrets/anthropic", { cookie, body: { value: SECRETS.assistantKey } })).status).toBe(200);
  expect((await call(port, "POST", "/api/setup/deploy-key", { cookie, body: {} })).status).toBe(200);
  const siteId = started.server.install!.siteId()!;
  const capture = await call(port, "POST", `/api/sites/${siteId}/capture/key`, { cookie, body: { action: "rotate" } });

  expect(capture.status, capture.text).toBe(200);
  const privateKey = readFileSync(join(home, "keys", "deploy_key"), "utf8");

  return {
    started,
    port,
    home,
    site: started.server.install!.siteFolder(),
    siteId,
    cookie,
    made: {
      privateKeyLines: privateKey.split("\n").filter((line) => line.length > 20 && !line.startsWith("-----")),
      captureKey: capture.body.key,
      sessionKey: readFileSync(join(home, "session.key"), "utf8").trim(),
    },
  };
}

beforeAll(async () => {
  world = await setUp();
}, 180_000);

function allSecrets(): Array<[string, string]> {
  return [
    ...Object.entries(SECRETS),
    ["capture key", world.made.captureKey],
    ["session key", world.made.sessionKey],
    ...world.made.privateKeyLines.map((line, i) => [`deploy key line ${i}`, line] as [string, string]),
  ];
}

describe("the hosted install's security claims", () => {
  it("the setup link works once", async () => {
    const answer = await call(world.port, "GET", "/api/setup", { bearer: SECRETS.setupCode });

    expect(answer.status).toBe(401);
    expect(answer.body.error.message).toBe("The setup link has been used already. Sign in with the password instead.");
    expect((await call(world.port, "POST", "/api/setup/password", { bearer: SECRETS.setupCode, origin: null, body: { password: "someone else's password" } })).status).toBe(401);
    expect(await world.started.server.install!.store.checkPassword(SECRETS.password)).toBe(true);
  });

  it("a wrong Host is refused", async () => {
    for (const host of ["evil.example", "cms.localhost.evil.example", `${EDITOR_HOST}.`]) {
      const answer = await call(world.port, "GET", "/api/meta", { host, cookie: world.cookie });

      if (host.endsWith(".")) expect(answer.status).toBe(200);
      else {
        expect(answer.status, host).toBe(403);
        expect(answer.body.error.message).toBe("This address isn't one this app answers to.");
      }
    }
  });

  it("a write from another origin is refused, and from the preview's origin even with the editor's cookie attached", async () => {
    for (const origin of ["https://evil.example", PREVIEW, `https://${LIVE_HOST}`, "null"]) {
      const answer = await call(world.port, "PATCH", "/api/settings", { cookie: world.cookie, origin, body: { ai: { effort: "low" } } });

      expect(answer.status, origin).toBe(403);
      expect(answer.body.error.message).toBe("This request came from outside the app, so it was blocked.");
    }
    // Sent to the preview's own name, it never reaches the app at all.
    const there = await call(world.port, "PATCH", "/api/settings", { host: PREVIEW_HOST, cookie: world.cookie, origin: PREVIEW, body: { ai: { effort: "low" } } });

    expect(there.status).toBe(401);
    expect(there.headers["content-type"]).toMatch(/text\/html/);
    expect((await call(world.port, "GET", "/api/settings", { cookie: world.cookie })).body.ai.effort).not.toBe("low");
  });

  it(
    "no route returns a secret: every GET in the contract, the setup and install routes, every header — and the sealed backup is the one carrier",
    async () => {
      const { port, siteId, cookie } = world;
      const answers: string[] = [];
      const gets = contractKeys().filter((key) => key.startsWith("GET "));
      const withTimeout = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000).unref())]);

      expect(gets.length).toBeGreaterThan(60);
      for (const key of gets) {
        if (key === "GET /api/events") continue;
        const path = key.slice(4).replace(":siteId", siteId).replace(/:[A-Za-z]+/g, "x");

        for (const auth of [{ cookie }, { bearer: SECRETS.operatorToken }, {}]) {
          const answer = await withTimeout(call(port, "GET", path, auth));

          if (answer) answers.push(`${key} ${answer.status} ${JSON.stringify(answer.headers)} ${answer.text}`);
        }
      }
      // The event stream: its first chunk.
      const stream = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { authorization: `Bearer ${SECRETS.operatorToken}` } }).catch(() => null);

      if (stream?.body) {
        const reader = stream.body.getReader();

        answers.push(new TextDecoder().decode((await reader.read()).value));
        await reader.cancel();
      }
      // Setup and install routes that answer with something.
      for (const [method, path, body] of [
        ["POST", "/api/setup/deploy-key", {}],
        ["POST", "/api/setup/finish", undefined],
        ["PUT", "/api/setup/details", {}],
        ["POST", `/api/sites/${siteId}/preview/entry`, undefined],
      ] as const) {
        const answer = await call(port, method, path, { cookie, ...(body !== undefined ? { body } : {}) });

        answers.push(`${method} ${path} ${answer.status} ${JSON.stringify(answer.headers)} ${answer.text}`);
      }
      const everything = answers.join("\n");

      expect(everything).toContain(`"version":"${VERSION}"`);
      for (const [name, secret] of allSecrets()) expect(everything, name).not.toContain(secret);
      // The one answer that carries them, carries them sealed.
      const backup = await call(port, "POST", "/api/install/backup", { cookie, body: { passphrase: "a long enough passphrase" } });

      expect(backup.status).toBe(200);
      expect(backup.bytes.length).toBeGreaterThan(1000);
      for (const [name, secret] of allSecrets()) expect(backup.bytes.includes(Buffer.from(secret)), name).toBe(false);
      expect(JSON.stringify(backup.headers)).not.toMatch(new RegExp(allSecrets().map(([, secret]) => secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")));
      // And with nothing but a script's token, it isn't made at all.
      expect((await call(port, "POST", "/api/install/backup", { bearer: SECRETS.operatorToken, origin: null, body: { passphrase: "a long enough passphrase" } })).status).toBe(403);
      // Nor did any log line carry one.
      const logged = [...world.started.logs, ...world.started.notices].join("\n");

      for (const [name, secret] of allSecrets()) expect(logged, name).not.toContain(secret);
    },
    600_000
  );

  it(
    "the preview's origin can't read or use the editor's cookie: __Host-, HttpOnly, never forwarded, the gateway never serves the app, both pages say who may frame them",
    async () => {
      const { port, siteId } = world;
      const login = await call(port, "POST", "/api/auth/login", { body: { password: SECRETS.password } });
      const line = (login.headers["set-cookie"] ?? [])[0]!;
      const cookie = login.cookies[0]!;

      expect(line).toMatch(new RegExp(`^${SESSION}=`));
      for (const part of ["; Path=/", "; HttpOnly", "; Secure", "; SameSite=Strict"]) expect(line).toContain(part);
      expect(line).not.toMatch(/Domain=/i);
      expect((await call<PreviewStatus>(port, "POST", `/api/sites/${siteId}/preview/start`, { cookie })).body.state).toBe("ready");
      const entry = await call(port, "POST", `/api/sites/${siteId}/preview/entry`, { cookie });
      const viewer = (await call(port, "GET", entryPath(entry.body.preview, "/"), { host: PREVIEW_HOST })).cookies[0]!;

      // The editor's cookie alone gets nothing there; with the viewer cookie it is cut before the site sees anything.
      expect((await call(port, "GET", "/", { host: PREVIEW_HOST, cookie })).status).toBe(401);
      expect((await call(port, "GET", "/echo", { host: PREVIEW_HOST, cookie: `${viewer}; ${cookie}` })).body.cookie).toBeNull();
      expect(readFileSync(join(world.site, ".seen.log"), "utf8")).not.toContain(SESSION);
      // The app's pages never come back on the preview's name.
      for (const path of ["/", "/api/meta", "/setup", "/api/install"]) {
        const answer = await call(port, "GET", path, { host: PREVIEW_HOST });

        expect(answer.status, path).toBe(401);
        expect(answer.text).not.toContain('"brand"');
      }
      // Who may frame what: the app only itself; the gateway's own pages only the editor; the app frames only the gateway.
      const app = await call(port, "GET", "/", { host: EDITOR_HOST });

      expect(String(app.headers["content-security-policy"])).toMatch(/frame-ancestors 'self'/);
      expect(String(app.headers["content-security-policy"])).toContain(`frame-src ${PREVIEW} https://${LIVE_HOST};`);
      const gate = await call(port, "GET", "/", { host: PREVIEW_HOST });

      expect(String(gate.headers["content-security-policy"])).toContain(`frame-ancestors ${EDITOR}`);
      await call(port, "POST", `/api/sites/${siteId}/preview/stop`, { cookie });
    },
    180_000
  );

  it("nothing outside the data folder is readable or writable through the app", async () => {
    const { port, siteId, cookie, home, site } = world;
    const S = `/api/sites/${siteId}`;
    const outside = join(box.root, "outside-the-data-folder.txt");

    writeFileSync(outside, "OUTSIDE-SECRET-CONTENT\n");
    // Links inside the site pointing out: to the server's files, and to the data folder's keys.
    symlinkSync(box.root, join(site, "leak-dir"));
    symlinkSync(join(home, "keys", "deploy_key"), join(site, "leak-key"));
    const traversals = [
      "../install.json",
      "../keys/deploy_key",
      "../../outside-the-data-folder.txt",
      outside,
      "/etc/passwd",
      "%2e%2e/install.json",
      "..%2finstall.json",
      "src/../../install.json",
      "leak-dir/outside-the-data-folder.txt",
      "leak-key",
      ".git/config",
    ];
    const answers: string[] = [];

    for (const path of traversals) {
      const query = `path=${path.includes("%") ? path : encodeURIComponent(path)}`;

      for (const url of [`${S}/file?${query}`, `${S}/raw?${query}`, `${S}/entry?${query}`]) {
        const answer = await call(port, "GET", url, { cookie });

        expect(answer.status, url).toBeGreaterThanOrEqual(400);
        answers.push(answer.text);
      }
      const write = await call(port, "PUT", `${S}/file?${query}`, { cookie, body: { content: "WRITTEN-BY-THE-APP" } });

      expect(write.status, `PUT ${path}`).toBeGreaterThanOrEqual(400);
      expect((await call(port, "DELETE", `${S}/media?${query}`, { cookie })).status, `DELETE ${path}`).toBeGreaterThanOrEqual(400);
    }
    const media = await call(port, "POST", `${S}/media`, { cookie, body: { filename: "x.png", directory: "../..", data: `data:image/png;base64,${Buffer.from("x").toString("base64")}` } });

    expect(media.status).toBeGreaterThanOrEqual(400);
    const joined = answers.join("\n");

    expect(joined).not.toContain("OUTSIDE-SECRET-CONTENT");
    expect(joined).not.toContain('"schema"');
    for (const line of world.made.privateKeyLines) expect(joined).not.toContain(line);
    expect(readFileSync(outside, "utf8")).toBe("OUTSIDE-SECRET-CONTENT\n");
    for (const file of [join(home, "install.json"), join(home, "keys", "deploy_key")]) expect(readFileSync(file, "utf8")).not.toContain("WRITTEN-BY-THE-APP");
    expect(readdirSync(box.root).filter((name) => name.includes("WRITTEN"))).toEqual([]);

    // The multi-site and folder-listing routes are refused.
    for (const [method, path, body] of [
      ["POST", "/api/sites/open", { path: box.root }],
      ["POST", "/api/sites/clone", { url: "https://example.com/x.git" }],
      ["POST", "/api/sites/create", { name: "x", starter: "x" }],
      ["POST", "/api/sites/scan", { path: "/" }],
      ["GET", "/api/fs/list?path=/", undefined],
      ["GET", `/api/open?root=${encodeURIComponent(box.root)}`, undefined],
    ] as const) {
      const answer = await call(port, method, path, { cookie, ...(body ? { body } : {}) });

      expect(answer.status, path).toBe(403);
    }
  });

  it(
    "a restore can't write outside the data folder: a hostile backup changes nothing",
    async () => {
      const { port, cookie, home } = world;
      const tar = (entries: Array<{ name: string; type?: string; link?: string; body?: string }>) => {
        const blocks: Buffer[] = [];

        for (const entry of entries) {
          const body = Buffer.from(entry.body ?? "");
          const header = Buffer.alloc(512);

          header.write(entry.name, 0, 100);
          header.write("0000644\0", 100);
          header.write("0000000\0", 108);
          header.write("0000000\0", 116);
          header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
          header.write("00000000000\0", 136);
          header.write(entry.type ?? "0", 156);
          if (entry.link) header.write(entry.link, 157, 100);
          header.write("ustar\0", 257);
          header.write("00", 263);
          header.fill(" ", 148, 156);
          let sum = 0;

          for (const byte of header) sum += byte;
          header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
          blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
        }
        return Buffer.concat([...blocks, Buffer.alloc(1024)]);
      };
      const before = readFileSync(join(home, "install.json"), "utf8");

      for (const hostile of [
        [{ name: "../../escaped-by-a-restore.txt", body: "x" }],
        [{ name: join(box.root, "escaped-by-a-restore.txt"), body: "x" }],
        [{ name: "site/link", type: "2", link: "../../.." }, { name: "site/link/escaped-by-a-restore.txt", body: "x" }],
      ]) {
        const sealed = await sealArchive({
          archive: Readable.from([gzipSync(tar([{ name: "install.json", body: "{}" }, ...hostile]))]),
          manifest: { format: 1, product: PRODUCT.slug, version: VERSION, schema: INSTALL_SCHEMA_VERSION, createdAt: new Date().toISOString(), madeOn: "test" },
          passphrase: "a long enough passphrase",
        });
        const chunks: Buffer[] = [];

        for await (const chunk of sealed.stream) chunks.push(chunk as Buffer);
        const upload = await call<RestoreUpload>(port, "POST", "/api/install/restore/upload", { cookie, raw: Buffer.concat(chunks) });
        const job = await call<Job>(port, "POST", "/api/install/restore", { cookie, body: { upload: upload.body.id, passphrase: "a long enough passphrase" } });
        const done = await waitForJob(port, job.body, { cookie });

        expect(done.state).toBe("error");
        expect(done.detail).toMatch(/would be written outside the data folder/);
      }
      expect(existsSync(join(dirname(home), "escaped-by-a-restore.txt"))).toBe(false);
      expect(existsSync(join(box.root, "escaped-by-a-restore.txt"))).toBe(false);
      expect(readFileSync(join(home, "install.json"), "utf8")).toBe(before);
      expect((await call(port, "GET", "/api/sites", { cookie })).status).toBe(200);
    },
    180_000
  );

  it(
    "a site's folder can't point outside the repository's copy",
    async () => {
      const home = box.folder("home");
      const started = await startHosted(box, home, { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD });
      const cookie = await signIn(started.port);
      const bare = siteRepository(box);
      // A repository whose "folder" is a link out of it.
      const work = box.folder("linked");

      git(work, "clone", "-q", bare, ".");
      symlinkSync("../../..", join(work, "escape"));
      git(work, "add", "-A");
      git(work, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "A link out");
      git(work, "push", "-q", "origin", "main");
      for (const folder of ["../outside", "/etc", "apps/../../x", ".git"]) {
        const answer = await call(started.port, "POST", "/api/setup/site/check", { cookie, body: { repository: bare, access: "token", token: "x-0000", folder } });

        expect(answer.status, folder).toBe(400);
      }
      const job = await call<Job>(started.port, "POST", "/api/setup/site", { cookie, body: { repository: bare, access: "token", token: "x-0000", folder: "escape" } });
      const done = await waitForJob(started.port, job.body, { cookie });

      expect(done).toMatchObject({ state: "error", detail: expect.stringMatching(/leads outside the repository/) });
      expect(existsSync(join(home, "site"))).toBe(false);
    },
    180_000
  );

  it("a cookie from one install is refused by another", async () => {
    const other = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: SECRETS.password });

    // The same name (__Host-, one address), another install's key.
    expect((await call(world.port, "GET", "/api/sites", { cookie: world.cookie })).status).toBe(200);
    expect((await call(other.port, "GET", "/api/sites", { cookie: world.cookie })).status).toBe(401);
  });

  it(
    "sessions end on sign-out everywhere, across a restart",
    async () => {
      const home = box.folder("home");
      const first = await startHosted(box, home, { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD });
      const a = await signIn(first.port);
      const b = await signIn(first.port);

      expect((await call(first.port, "POST", "/api/auth/logout-all", { cookie: a })).status).toBe(200);
      for (const cookie of [a, b]) expect((await call(first.port, "GET", "/api/sites", { cookie })).status).toBe(401);
      await stopHosted(box, first);
      const second = await startHosted(box, home, { GALLEY_PUBLIC_URL: EDITOR });

      for (const cookie of [a, b]) expect((await call(second.port, "GET", "/api/sites", { cookie })).status).toBe(401);
      expect((await call(second.port, "GET", "/api/sites", { cookie: await signIn(second.port) })).status).toBe(200);
    },
    120_000
  );
});
