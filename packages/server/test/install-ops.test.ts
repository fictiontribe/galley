/**
 * A hosted install's operations over real HTTP, against the real engine,
 * real folders and real repositories: health and readiness (also while the
 * engine is still being composed), logs without secrets, backups and
 * restores (through first run, and in place with the preview running), the
 * upload's own size cap, the Install page, the memory ceiling for the site's
 * commands and the plugin secrets hidden from them.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PRODUCT, VERSION } from "@galley/core/brand";
import { BACKUP_MAGIC, INSTALL_SCHEMA_VERSION, type InstallInfo, type RestoreUpload } from "@galley/core/install";
import { resolveCommand } from "@galley/core/workspace";
import type { Job, PreviewStatus } from "@galley/core/types";
import { startServer, StartupError } from "../src/server";
import { buildServices } from "./helpers";
import {
  alive,
  call,
  EDITOR,
  freePort,
  git,
  PASSWORD,
  sandbox,
  signIn,
  siteRepository,
  startHosted,
  stopHosted,
  until,
  waitForJob,
  type Started,
} from "./hosted-helpers";

const box = sandbox("install-ops");

afterAll(() => box.cleanup(), 120_000);

const PASSPHRASE = "the backup passphrase, long";
const ASSISTANT_KEY = "sk-ant-api03-fakeRestoreKey0000000000";

/** A connected install with things in every corner of its data folder. */
async function fullInstall(home: string, env: Record<string, string> = {}): Promise<{ started: Started; cookie: string; siteId: string; deployKey: string }> {
  const bare = siteRepository(box);
  const started = await startHosted(box, home, {
    GALLEY_PUBLIC_URL: EDITOR,
    GALLEY_PASSWORD: PASSWORD,
    GALLEY_SITE_REPOSITORY: bare,
    GALLEY_SITE_ACCESS: "token",
    GALLEY_SITE_TOKEN: "fake-access-key-for-the-repository-0000",
    GALLEY_AUTHOR_NAME: "Sam Editor",
    GALLEY_AUTHOR_EMAIL: "sam@example.com",
    ...env,
  });

  await started.server.install!.idle();
  const siteId = started.server.install!.siteId()!;
  const cookie = await signIn(started.port);

  expect((await call(started.port, "PUT", "/api/secrets/anthropic", { cookie, body: { value: ASSISTANT_KEY } })).status).toBe(200);
  expect((await call(started.port, "PATCH", "/api/settings", { cookie, body: { ai: { effort: "high" } } })).status).toBe(200);
  const key = await call(started.port, "POST", "/api/setup/deploy-key", { cookie, body: {} });

  expect(key.status).toBe(200);
  const site = started.server.install!.siteFolder();

  writeFileSync(join(site, "src/content/pages/index.md"), "---\ntitle: Home\n---\nAn unpublished change\n");
  mkdirSync(join(home, "state", siteId, "submissions"), { recursive: true });
  writeFileSync(join(home, "state", siteId, "submissions", "contact.jsonl"), `${JSON.stringify({ id: "s1", siteId, form: "contact", receivedAt: new Date().toISOString(), fields: { name: "Sam" } })}\n`);
  return { started, cookie, siteId, deployKey: readFileSync(join(home, "keys", "deploy_key"), "utf8") };
}

async function backup(port: number, cookie: string, passphrase = PASSPHRASE): Promise<Buffer> {
  const answer = await call(port, "POST", "/api/install/backup", { cookie, body: { passphrase } });

  expect(answer.status, answer.text).toBe(200);
  expect(answer.headers["content-type"]).toBe("application/octet-stream");
  expect(answer.headers["content-disposition"]).toMatch(new RegExp(`^attachment; filename="harbour-notes-backup-\\d{4}-\\d{2}-\\d{2}\\.bak"$`));
  expect(answer.bytes.subarray(0, 8).equals(BACKUP_MAGIC)).toBe(true);
  return answer.bytes;
}

describe("health and readiness", () => {
  it(
    "answer with no sign-in and no Host check, say nothing about the install, and answer while the engine is still being composed",
    async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const services = buildServices({
        settings: {
          authorLayers: async () => {
            await gate;
            return { app: { name: "Sam", email: "sam@example.com" }, site: null };
          },
        } as never,
      });
      const port = await freePort();
      const logs: string[] = [];
      const starting = startServer({
        port,
        host: "127.0.0.1",
        mode: "hosted",
        home: box.folder("home"),
        webDir: join(box.root, "no-ui"),
        env: { GALLEY_PUBLIC_URL: EDITOR, GALLEY_MCP: "off", GALLEY_AUTHOR_NAME: "Sam", GALLEY_AUTHOR_EMAIL: "sam@example.com" },
        services,
        notice: () => undefined,
        log: (line) => logs.push(line),
      });

      await until(async () => (await call(port, "GET", "/healthz", { host: "10.1.2.3:4400" }).catch(() => null))?.status === 200);
      const health = await call(port, "GET", "/healthz", { host: "10.1.2.3:4400" });

      expect(health.body).toEqual({ ok: true });
      expect(health.headers["cache-control"]).toBe("no-store");
      const early = await call(port, "GET", "/readyz", { host: "10.1.2.3:4400" });

      expect(early.status).toBe(503);
      expect(early.body).toEqual({ ready: false, state: "starting" });
      expect(early.headers["cache-control"]).toBe("no-store");
      expect((await call(port, "GET", "/api/meta")).status).toBe(503);
      release();
      const server = await starting;

      box.running.push(server);
      const up = await call(port, "GET", "/readyz", { host: "health-prober.internal" });

      expect(up.status).toBe(200);
      expect(up.body).toEqual({ ready: true, state: "setup" });
      expect((await call(port, "HEAD", "/readyz", { host: "health-prober.internal" })).status).toBe(200);
      // Nothing that identifies the install: no version, no name, no address.
      for (const answer of [health, early, up]) {
        for (const value of [VERSION, PRODUCT.name, "cms.localhost", "Sam"]) expect(`${answer.text} ${JSON.stringify(answer.headers)}`).not.toContain(value);
      }
      // No request lines for health checks.
      expect(logs.join("\n")).not.toMatch(/healthz|readyz/);
      expect(logs.join("\n")).toMatch(/^GET \/api\/meta 503 \d+ms$/m);
    },
    120_000
  );
});

describe("logs without secrets", () => {
  it(
    "the whole first run and a failing sign-in, with fake secrets everywhere they can be given: none of them is ever written",
    async () => {
      const secrets = {
        setupCode: "fake-setup-code-NEVER-LOGGED-0123456789",
        operatorToken: "fake-operator-token-NEVER-LOGGED-01",
        password: "fake-password-NEVER-LOGGED-1234",
        typed: "fake-typed-password-NEVER-LOGGED",
        envAssistant: "sk-ant-fakeEnvNEVERLOGGED0000000000",
        envOpenai: "sk-fakeOpenaiNEVERLOGGED000000000",
        siteToken: "fake-site-token-NEVER-LOGGED-00000",
        accessToken: "fake-access-token-NEVER-LOGGED-0000",
        handedKey: "AIzafakeGoogleNEVERLOGGED000000000",
      };
      const home = box.folder("home");
      const bare = siteRepository(box);
      const started = await startHosted(box, home, {
        GALLEY_PUBLIC_URL: EDITOR,
        GALLEY_SETUP_TOKEN: secrets.setupCode,
        GALLEY_TOKEN: secrets.operatorToken,
        ANTHROPIC_API_KEY: secrets.envAssistant,
        OPENAI_API_KEY: secrets.envOpenai,
        GALLEY_SITE_TOKEN: secrets.siteToken,
      });
      const { port, logs, notices } = started;
      const code = secrets.setupCode;

      expect((await call(port, "GET", "/readyz")).body).toEqual({ ready: true, state: "setup" });
      await call(port, "GET", `/setup?token=${code}`);
      await call(port, "GET", `/api/jobs/${code}?token=${code}&ticket=${code}`, { bearer: code });
      await call(port, "POST", "/api/setup/handover", { bearer: code, origin: null, body: { keys: { google: secrets.handedKey } } });
      const cookie = (await call(port, "POST", "/api/setup/password", { bearer: code, origin: null, body: { password: secrets.password } })).cookies[0]!;

      expect((await call(port, "POST", "/api/auth/login", { body: { password: secrets.typed } })).status).toBe(401);
      await call(port, "POST", "/api/setup/site/check", { cookie, body: { repository: `${bare}-missing`, access: "token", token: secrets.accessToken } });
      const job = await call<Job>(port, "POST", "/api/setup/site", { cookie, body: { repository: bare, access: "token", token: secrets.accessToken } });

      expect((await waitForJob(port, job.body, { cookie })).state).toBe("done");
      await call(port, "PUT", "/api/setup/details", { cookie, body: { author: { name: "Sam Editor", email: "sam@example.com" } } });
      await call(port, "POST", "/api/setup/finish", { cookie });
      await call(port, "GET", "/api/sites", { bearer: secrets.operatorToken });
      expect((await call(port, "GET", "/readyz")).body).toEqual({ ready: true, state: "ready" });
      await call(port, "POST", "/api/auth/logout-all", { cookie });
      await signIn(port, secrets.password);

      const written = [...logs, ...notices];
      const all = written.join("\n");

      for (const [name, secret] of Object.entries(secrets)) expect(all, name).not.toContain(secret);
      // What was written: request lines without their query, and one line for each event worth keeping.
      expect(all).toMatch(/^GET \/setup \d{3} \d+ms$/m);
      expect(all).toMatch(/^POST \/api\/setup\/password 200 \d+ms$/m);
      // Was "The password was chosen…", "A sign-in from … failed", "Signed in from …": each line now names whose account it was (never an e-mail).
      expect(all).toContain("The owner's account was made through the setup link: Owner with no name yet, from 127.0.0.1.");
      expect(all).toContain("A sign-in to Owner with no name yet from 127.0.0.1 failed: wrong password.");
      expect(all).toContain("Signed in: Owner with no name yet, from 127.0.0.1.");
      expect(all).toContain("The site was connected.");
      expect(all).toContain("First run finished.");
      expect(all).toContain("Owner with no name yet signed out everywhere.");
      expect(all).toContain("GET /api/jobs/[redacted] ");
      expect(all).not.toMatch(/healthz|readyz/);
      for (const line of written) expect(line).not.toMatch(/cookie|authorization/i);
    },
    180_000
  );

  it("GALLEY_LOG_REQUESTS=0 leaves the request lines out; the events stay", async () => {
    const started = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_LOG_REQUESTS: "0" });

    await signIn(started.port);
    expect(started.logs).toEqual(["Signed in: Owner with no name yet, from 127.0.0.1."]);
  });
});

describe("backups", () => {
  it(
    "back up → wipe the data folder → a fresh install → restore through first run: everything is back and the site opens",
    async () => {
      const home = box.folder("home");
      const first = await fullInstall(home);
      const { port, server } = first.started;
      const accessToken = readFileSync(join(home, "keys", "site-token"), "utf8");
      const head = git(server.install!.siteFolder(), "rev-parse", "HEAD");
      // A script's token can't take the keys away, and a short passphrase is refused.
      const scripted = await call(port, "POST", "/api/install/backup", { cookie: first.cookie, bearer: "anything-at-all-0000", origin: null, body: { passphrase: PASSPHRASE } });

      expect(scripted.status).toBe(401);
      expect((await call(port, "POST", "/api/install/backup", { cookie: first.cookie, body: { passphrase: "too short" } })).body.error.message).toMatch(/at least 12 characters/);
      expect((await call<InstallInfo>(port, "GET", "/api/install", { cookie: first.cookie })).body.lastBackupAt).toBeNull();
      const bytes = await backup(port, first.cookie);

      // Sealed: the secrets it carries can't be read in it.
      for (const plain of [ASSISTANT_KEY, accessToken.trim(), first.deployKey.split("\n")[1]!, "An unpublished change"]) expect(bytes.includes(Buffer.from(plain))).toBe(false);
      await until(async () => (await call<InstallInfo>(port, "GET", "/api/install", { cookie: first.cookie })).body.lastBackupAt !== null);
      expect(first.started.logs).toContain("A backup was made and downloaded.");
      await stopHosted(box, first.started);

      // The data folder is lost; a fresh install starts in first run.
      rmSync(home, { recursive: true, force: true });
      const fresh = await startHosted(box, home, { GALLEY_PUBLIC_URL: EDITOR });
      const code = new URL(fresh.server.setupUrl!).searchParams.get("token")!;
      const upload = await call<RestoreUpload>(fresh.port, "POST", "/api/install/restore/upload", { bearer: code, origin: null, raw: bytes });

      expect(upload.status, upload.text).toBe(200);
      expect(upload.body).toEqual({ id: expect.stringMatching(/^[0-9a-f]{24}$/), bytes: bytes.length });
      const job = await call<Job>(fresh.port, "POST", "/api/install/restore", { bearer: code, origin: null, body: { upload: upload.body.id, passphrase: PASSPHRASE } });

      expect(job.status, job.text).toBe(200);
      expect(job.body).toMatchObject({ kind: "restore", state: "running" });
      // The setup code is dead once the restored password rules, yet it may still ask how its restore ended.
      const done = await waitForJob(fresh.port, job.body, { bearer: code });

      expect(done, done.detail).toMatchObject({ state: "done" });
      expect((await call(fresh.port, "GET", "/api/setup", { bearer: code })).status).toBe(401);

      // The password, the settings, the stored key, the inbox, the deploy key, the access key, the checkout with its change and history.
      const cookie = await signIn(fresh.port);
      const settings = await call(fresh.port, "GET", "/api/settings", { cookie });

      expect(settings.body.ai.effort).toBe("high");
      expect(settings.body.secrets.find((secret: { name: string }) => secret.name === "anthropic")).toMatchObject({ configured: true, hint: ASSISTANT_KEY.slice(-4) });
      expect(readFileSync(join(home, "keys", "deploy_key"), "utf8")).toBe(first.deployKey);
      expect(readFileSync(join(home, "keys", "site-token"), "utf8")).toBe(accessToken);
      expect(readFileSync(join(home, "state", first.siteId, "submissions", "contact.jsonl"), "utf8")).toContain("\"name\":\"Sam\"");
      const site = fresh.server.install!.siteFolder();

      expect(readFileSync(join(site, "src/content/pages/index.md"), "utf8")).toContain("An unpublished change");
      expect(git(site, "rev-parse", "HEAD")).toBe(head);
      expect(git(site, "log", "--format=%s")).toBe("First");
      expect((await call(fresh.port, "GET", "/api/setup", { cookie })).body).toMatchObject({ step: "done", site: { state: "connected" } });
      expect((await call(fresh.port, "GET", `/api/sites/${first.siteId}`, { cookie })).status).toBe(200);
      const changes = await call(fresh.port, "GET", `/api/sites/${first.siteId}/changes`, { cookie });

      expect(JSON.stringify(changes.body)).toContain("src/content/pages/index.md");
      // Nothing left behind: no staging folder, no upload.
      expect(readdirSync(home).filter((name) => name.startsWith(".restore"))).toEqual([".restore-uploads"]);
      expect(readdirSync(join(home, ".restore-uploads"))).toEqual([]);
      expect(fresh.logs.join("\n")).toMatch(/A backup was restored \(it was made .*\)\. Everyone was signed out\./);
    },
    300_000
  );

  it(
    "restored in place with the preview running: the preview stops, everyone is signed out, the browser that started it still sees how it ended",
    async () => {
      const home = box.folder("home");
      const first = await fullInstall(home);
      const { port, server } = first.started;
      const bytes = await backup(port, first.cookie);
      const preview = await call<PreviewStatus>(port, "POST", `/api/sites/${first.siteId}/preview/start`, { cookie: first.cookie });

      expect(preview.body.state).toBe("ready");
      const pid = Number(/pid (\d+)/.exec(readFileSync(join(server.install!.siteFolder(), ".seen.log"), "utf8"))![1]);

      expect(alive(pid)).toBe(true);
      // A change made after the backup: the restore takes it away.
      writeFileSync(join(server.install!.siteFolder(), "after-the-backup.md"), "gone after the restore\n");
      const other = await signIn(port);
      const upload = await call<RestoreUpload>(port, "POST", "/api/install/restore/upload", { cookie: first.cookie, raw: bytes });

      // A wrong passphrase changes nothing and says so.
      const wrong = await call<Job>(port, "POST", "/api/install/restore", { cookie: first.cookie, body: { upload: upload.body.id, passphrase: "not the passphrase at all" } });
      const refused = await waitForJob(port, wrong.body, { cookie: first.cookie });

      expect(refused).toMatchObject({ state: "error", detail: expect.stringMatching(/That passphrase doesn't open this backup.*Nothing was changed\./) });
      expect(alive(pid)).toBe(true);
      expect((await call(port, "GET", "/api/sites", { cookie: other })).status).toBe(200);

      // The browser that starts it has the event stream open: the job's last event must still reach it.
      let events = "";
      const stream = http.request({ host: "127.0.0.1", port, path: "/api/events", headers: { host: "cms.localhost", cookie: first.cookie }, agent: false }, (res) => res.on("data", (chunk: Buffer) => (events += chunk.toString())));

      stream.on("error", () => undefined);
      stream.end();
      await until(() => events.includes("hello"));
      const job = await call<Job>(port, "POST", "/api/install/restore", { cookie: first.cookie, body: { upload: upload.body.id, passphrase: PASSPHRASE } });
      const done = await waitForJob(port, job.body, { cookie: first.cookie });

      expect(done.state, done.detail).toBe("done");
      await until(() => events.includes(`"id":"${job.body.id}"`) && /"kind":"restore"[^}]*"state":"done"|"state":"done"[^}]*"kind":"restore"/.test(events));
      stream.destroy();
      await until(() => !alive(pid), 10_000);
      expect(existsSync(join(server.install!.siteFolder(), "after-the-backup.md"))).toBe(false);
      // Everyone is signed out — the browser that started it too — but it could still follow its job.
      for (const cookie of [first.cookie, other]) expect((await call(port, "GET", "/api/sites", { cookie })).status).toBe(401);
      expect((await call(port, "GET", `/api/jobs/${job.body.id}`, { cookie: other })).status).toBe(401);
      const cookie = await signIn(port);

      expect((await call(port, "GET", `/api/sites/${first.siteId}`, { cookie })).status).toBe(200);
      expect((await call(port, "GET", "/readyz")).body).toEqual({ ready: true, state: "ready" });
    },
    300_000
  );

  it.skipIf(process.platform === "win32")(
    "a restore waits for the editor's own round in progress, and no round runs while the backup is put back",
    async () => {
      const home = box.folder("home");
      const first = await fullInstall(home);
      const { port, server } = first.started;
      const bytes = await backup(port, first.cookie);
      const checkout = server.install!.store.checkoutFolder();
      // The code host is slow to answer: a round's look waits until it is let through.
      const gate = box.folder("slow-host");

      writeFileSync(join(gate, "serve.sh"), `#!/bin/sh\n: > '${gate}/asked'\nwhile [ ! -e '${gate}/go' ]; do sleep 0.05; done\nexec git upload-pack "$@"\n`, { mode: 0o755 });
      git(checkout, "config", "remote.origin.uploadpack", join(gate, "serve.sh"));
      writeFileSync(join(server.install!.siteFolder(), "after-the-backup.md"), "gone after the restore\n");
      const round = server.keepUp!.round();

      await until(() => existsSync(join(gate, "asked")));
      const upload = await call<RestoreUpload>(port, "POST", "/api/install/restore/upload", { cookie: first.cookie, raw: bytes });
      const job = await call<Job>(port, "POST", "/api/install/restore", { cookie: first.cookie, body: { upload: upload.body.id, passphrase: PASSPHRASE } });

      expect(job.body).toMatchObject({ kind: "restore", state: "running" });
      // From the moment a restore begins no new round runs, whatever it is doing.
      expect(await server.keepUp!.round()).toBe("overlap");
      // The backup is opened and checked, and then the restore waits: the round still has the site.
      await until(async () => (await call(port, "GET", "/readyz")).body.state === "restoring");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(existsSync(join(server.install!.siteFolder(), "after-the-backup.md"))).toBe(true);
      expect((await call<Job>(port, "GET", `/api/jobs/${job.body.id}`, { cookie: first.cookie })).body).toMatchObject({ state: "running", detail: "Stopping the preview and closing the site" });

      // The code host answers; the round ends; only then is the backup put in place.
      writeFileSync(join(gate, "go"), "");
      expect(["quiet", "failed", "busy"]).toContain(await round);
      expect(await server.keepUp!.round()).toBe("busy");
      const done = await waitForJob(port, job.body, { cookie: first.cookie });

      expect(done.state, done.detail).toBe("done");
      expect(existsSync(join(server.install!.siteFolder(), "after-the-backup.md"))).toBe(false);
      expect((await call(port, "GET", "/readyz")).body).toEqual({ ready: true, state: "ready" });
      // Afterwards rounds run again, on the restored site.
      expect(["quiet", "failed"]).toContain(await server.keepUp!.round());
    },
    300_000
  );

  it(
    "restored over a running install that has read its inbox: the inbox is the backup's, not what it had cached",
    async () => {
      const home = box.folder("home");
      const first = await fullInstall(home);
      const { port, server } = first.started;
      const store = server.services.forms!.store;
      const submission = (id: string, name: string) => ({ id, siteId: first.siteId, form: "contact", at: new Date().toISOString(), values: { name }, read: false, spam: false });
      const inbox = async (cookie: string) => {
        const answer = await call(port, "GET", `/api/sites/${first.siteId}/inbox/contact?filter=all`, { cookie });

        expect(answer.status, answer.text).toBe(200);
        return (answer.body.items as Array<{ id: string; values: { name: string } }>).map((item) => `${item.id} ${item.values.name}`).sort();
      };

      await store.append(submission("s-before", "Ada"));
      // Read, so the inbox's file is cached as it is now.
      expect(await inbox(first.cookie)).toEqual(["s-before Ada"]);
      const bytes = await backup(port, first.cookie);

      await store.append(submission("s-after", "Bea"));
      expect(await inbox(first.cookie)).toEqual(["s-after Bea", "s-before Ada"]);
      const upload = await call<RestoreUpload>(port, "POST", "/api/install/restore/upload", { cookie: first.cookie, raw: bytes });
      const job = await call<Job>(port, "POST", "/api/install/restore", { cookie: first.cookie, body: { upload: upload.body.id, passphrase: PASSPHRASE } });

      expect((await waitForJob(port, job.body, { cookie: first.cookie })).state).toBe("done");
      expect(await inbox(await signIn(port))).toEqual(["s-before Ada"]);
    },
    300_000
  );

  it(
    "the upload isn't held to the 40 MB limit, but to its own cap; a damaged backup changes nothing",
    async () => {
      const roomy = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_RESTORE_MAX_MB: "48" });
      const cookie = await signIn(roomy.port);
      const big = Buffer.alloc(41 * 1024 * 1024, 7);
      const accepted = await call<RestoreUpload>(roomy.port, "POST", "/api/install/restore/upload", { cookie, raw: big });

      expect(accepted.status, accepted.text).toBe(200);
      expect(accepted.body.bytes).toBe(big.length);
      // The 40 MB limit still holds everywhere else.
      expect((await call(roomy.port, "PUT", "/api/secrets/anthropic", { cookie, raw: "{}", headers: { "content-type": "application/json", "content-length": String(big.length) } })).status).toBe(413);
      // Not a backup at all: the job says so, and nothing changed.
      const before = readFileSync(join(roomy.server.home, "install.json"), "utf8");
      const job = await call<Job>(roomy.port, "POST", "/api/install/restore", { cookie, body: { upload: accepted.body.id, passphrase: PASSPHRASE } });

      expect((await waitForJob(roomy.port, job.body, { cookie })).detail).toMatch(/isn't a backup made by/);
      expect(readFileSync(join(roomy.server.home, "install.json"), "utf8")).toBe(before);

      const tight = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD, GALLEY_RESTORE_MAX_MB: "1" });
      const tightCookie = await signIn(tight.port);
      // Said up front: refused before a byte is read.
      const declared = await call(tight.port, "POST", "/api/install/restore/upload", { cookie: tightCookie, raw: "x", headers: { "content-length": String(2 * 1024 * 1024) } });

      expect(declared.status).toBe(413);
      expect(declared.body.error.message).toMatch(/larger than this editor accepts \(1 MB\).*backup restore/);
      // Not said (streamed): cut off at the cap, and the part already written is removed.
      const streamed = await new Promise<{ status: number; text: string }>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port: tight.port, method: "POST", path: "/api/install/restore/upload", headers: { host: "cms.localhost", origin: EDITOR, cookie: tightCookie, "content-type": "application/octet-stream", "transfer-encoding": "chunked" } },
          (res) => {
            let text = "";

            res.on("data", (chunk: Buffer) => (text += chunk.toString()));
            res.on("end", () => {
              req.destroy();
              resolve({ status: res.statusCode ?? 0, text });
            });
          }
        );

        req.on("error", (error: NodeJS.ErrnoException) => (error.code === "EPIPE" || error.code === "ECONNRESET" ? undefined : reject(error)));
        // More than the cap, and the request left open: the answer comes before the body ends.
        req.write(Buffer.alloc(1536 * 1024, 1));
      });

      expect(streamed.status).toBe(413);
      expect(streamed.text).toMatch(/larger than this editor accepts/);
      await until(() => readdirSync(join(tight.server.home, ".restore-uploads")).length === 0);
      // Without a session, or with a script's token, nothing is taken.
      expect((await call(tight.port, "POST", "/api/install/restore/upload", { raw: "x" })).status).toBe(401);
    },
    180_000
  );
});

describe("the Install page", () => {
  it(
    "says what this install is and what is stored where, sizes measured in the background",
    async () => {
      const home = box.folder("home");
      const first = await fullInstall(home);
      const ask = () => call<InstallInfo>(first.started.port, "GET", "/api/install", { cookie: first.cookie });
      const info = (await ask()).body;

      expect(info).toMatchObject({
        version: VERSION,
        schema: INSTALL_SCHEMA_VERSION,
        address: EDITOR,
        previewAddress: "https://preview.cms.localhost",
        liveAddress: "https://live.cms.localhost",
        site: { state: "connected", repository: expect.any(String) },
        author: { name: "Sam Editor", email: "sam@example.com" },
        dataFolder: home,
        passwordChangedAt: expect.any(String),
        lastBackupAt: null,
        fixed: expect.arrayContaining(["address"]),
      });
      expect(info.storage.map((line) => line.id)).toEqual(["site", "settings", "keys", "inbox", "history", "brand", "assistant", "plugins", "sessions", "cache"]);
      expect(info.storage.find((line) => line.id === "cache")?.inBackup).toBe(false);
      await until(async () => (await ask()).body.storage.find((line) => line.id === "site")?.bytes !== null);
      const measured = (await ask()).body.storage;

      expect(measured.find((line) => line.id === "site")!.bytes).toBeGreaterThan(0);
      expect(measured.find((line) => line.id === "keys")!.bytes).toBeGreaterThan(0);
      expect((await call(first.started.port, "GET", "/api/install")).status).toBe(401);
    },
    180_000
  );
});

describe("the site's own commands", () => {
  it("get a memory ceiling with GALLEY_PREVIEW_MEMORY_MB, after the operator's NODE_OPTIONS — never this server's own process", async () => {
    const root = box.folder("commands");
    const saved = process.env.NODE_OPTIONS;

    process.env.NODE_OPTIONS = "--enable-source-maps";
    try {
      expect(resolveCommand(root, "node --version").env.NODE_OPTIONS).toBe("--enable-source-maps");
      const started = await startHosted(box, box.folder("home"), { GALLEY_PASSWORD: PASSWORD, GALLEY_PREVIEW_MEMORY_MB: "256" });

      expect(resolveCommand(root, "node --version").env.NODE_OPTIONS).toBe("--enable-source-maps --max-old-space-size=256");
      expect(resolveCommand(root, "NODE_OPTIONS=--trace-warnings node --version").env.NODE_OPTIONS).toBe("--trace-warnings --max-old-space-size=256");
      expect(process.env.NODE_OPTIONS).toBe("--enable-source-maps");
      await stopHosted(box, started);
      expect(resolveCommand(root, "node --version").env.NODE_OPTIONS).toBe("--enable-source-maps");
    } finally {
      if (saved === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = saved;
    }
    await expect(startServer({ mode: "hosted", home: box.folder("home"), env: { GALLEY_PREVIEW_MEMORY_MB: "lots" } })).rejects.toThrow(StartupError);
  });

  it("don't see the environment variables plugins name for their secret settings", async () => {
    const root = box.folder("commands");
    const saved = process.env.TEST_PLUGIN_SECRET_KEY;

    process.env.TEST_PLUGIN_SECRET_KEY = "fake-plugin-secret-0000";
    try {
      const started = await startHosted(box, box.folder("home"), { GALLEY_PASSWORD: PASSWORD });

      expect(resolveCommand(root, "node --version").env.TEST_PLUGIN_SECRET_KEY).toBe("fake-plugin-secret-0000");
      started.server.services.plugins!.register(
        { name: `${PRODUCT.slug}-plugin-test-secrets`, apiVersion: 1, settings: [{ key: "apiKey", label: "Key", secret: true, env: ["TEST_PLUGIN_SECRET_KEY"] }] },
        { source: "user", location: "a test" }
      );
      expect(resolveCommand(root, "node --version").env.TEST_PLUGIN_SECRET_KEY).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.TEST_PLUGIN_SECRET_KEY;
      else process.env.TEST_PLUGIN_SECRET_KEY = saved;
    }
  });
});
