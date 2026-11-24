#!/usr/bin/env node
// A rehearsal of accounts on a hosted install, end to end over HTTP, with
// nothing leaving this computer: it starts the real server the way an
// operator does (`galley serve`, the command line, in hosted mode) on a
// loopback port, with a temporary data folder, a temporary bare repository
// as the site (Publish sends there), and a small SMTP sink written here
// (node:net) as the outgoing mail server. Then it walks, as separate
// browsers (cookie jars, each from its own client address), through first
// run, invitations, roles, Publish, switching people off, e-mailed links,
// signing everyone out, the operator's access token, the sign-in limits and
// a browser someone has signed in on before, an install from before
// accounts, `serve --reset-password`, and a starter sent from first run.
//
//   npx tsx scripts/rehearse-accounts.mjs [--dir <scratch folder>] [--keep]
//
// One line per step; the first step that fails ends the run with exit code 1.
// Everything it made (servers, the sink, the folders) is removed at the end,
// unless --keep is given. It reads no key or setting from your environment:
// the servers get only what is listed in `baseEnv` below.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { hashPassword } from "../packages/core/src/install/password.ts";
import { ROLE_REFUSAL } from "../packages/core/src/install/route-access.ts";
import { BUILD_MODE_REFUSAL, SITE_SETTINGS_REFUSAL } from "../packages/core/src/install/caller.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/cli/bin/galley.js");
const { values } = parseArgs({ options: { dir: { type: "string" }, keep: { type: "boolean", default: false } } });

mkdirSync(values.dir ? resolve(values.dir) : tmpdir(), { recursive: true });
const scratch = realpathSync(mkdtempSync(join(values.dir ? resolve(values.dir) : tmpdir(), "rehearse-accounts-")));
const PASSWORD = "a long password for the owner";
const NEW_PASSWORD = "another long password, chosen through a link";
const PEOPLE_PASSWORD = "a long password for the team";
const KEY = "sk-ant-rehearsal-not-a-real-key-WXYZ";
const HOST_KEY = "rehearsal-host-key-not-real-0000WXYZ";
const KEY_TAIL = "WXYZ";
const OPERATOR_TOKEN = "rehearsal-operator-token-not-real-0000";

/** Everything secret this run makes or types: none of it may reach a server's log. */
const secrets = new Set([PASSWORD, NEW_PASSWORD, PEOPLE_PASSWORD, KEY, HOST_KEY, OPERATOR_TOKEN]);
const running = [];
let sink = null;

// ─────────────────────────────────────────────────────────────── the outgoing mail server

/** Undoes quoted-printable (what mail programs do to long lines): soft line breaks and =XX bytes. */
function unQuote(text) {
  return Buffer.from(text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16))), "latin1").toString("utf8");
}

/** The readable text of a message: every part, decoded. */
function readable(raw) {
  const split = (block) => {
    const at = block.indexOf("\r\n\r\n");
    return at === -1 ? [block, ""] : [block.slice(0, at), block.slice(at + 4)];
  };
  const decode = (headers, body) => {
    const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headers)?.[1];
    if (/content-type:\s*multipart\//i.test(headers) && boundary) {
      return body
        .split(`--${boundary}`)
        .slice(1)
        .filter((part) => !part.startsWith("--"))
        .map((part) => decode(...split(part.replace(/^\r\n/, ""))))
        .join("\n");
    }
    const encoding = /content-transfer-encoding:\s*([\w-]+)/i.exec(headers)?.[1]?.toLowerCase();
    if (encoding === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    if (encoding === "quoted-printable") return unQuote(body);
    return body;
  };
  const [headers, body] = split(raw);
  return { subject: /^subject:\s*(.*)$/im.exec(headers)?.[1] ?? "", text: decode(headers, body) };
}

/** A mail server that accepts everything and keeps it: SMTP without TLS or sign-in, on loopback. */
function startSink() {
  const messages = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    let current = { to: [], raw: "" };

    socket.setEncoding("latin1");
    socket.write("220 rehearsal-sink ESMTP\r\n");
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          const raw = buffer.slice(0, end).replace(/^\.\./gm, ".");
          buffer = buffer.slice(end + 5);
          messages.push({ to: current.to, ...readable(raw) });
          current = { to: [], raw: "" };
          inData = false;
          socket.write("250 kept\r\n");
          continue;
        }
        const newline = buffer.indexOf("\r\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO") socket.write("250-rehearsal-sink\r\n250 8BITMIME\r\n");
        else if (verb === "RCPT") {
          current.to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
          socket.write("250 ok\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 go on\r\n");
        } else if (verb === "RSET") {
          current = { to: [], raw: "" };
          socket.write("250 ok\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
          return;
        } else socket.write("250 ok\r\n");
      }
    });
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () =>
      done({
        port: server.address().port,
        messages,
        close: () => new Promise((closed) => server.close(() => closed())),
      })
    )
  );
}

// ─────────────────────────────────────────────────────────────── servers

function freePort() {
  return new Promise((done, fail) => {
    const probe = net.createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...baseEnv(), GIT_AUTHOR_NAME: "Seed", GIT_AUTHOR_EMAIL: "seed@example.com", GIT_COMMITTER_NAME: "Seed", GIT_COMMITTER_EMAIL: "seed@example.com" } }).trim();
}

/** What every server (and git) runs with — nothing from this shell's environment but PATH. */
function baseEnv() {
  return {
    PATH: process.env.PATH ?? "",
    HOME: join(scratch, "home"),
    TMPDIR: join(scratch, "tmp"),
    GIT_CONFIG_GLOBAL: join(scratch, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GALLEY_MCP: "off",
    GALLEY_ALLOW_LOCAL_REPOSITORIES: "1",
    // Each browser below says which address it comes from (X-Forwarded-For), as people do behind the proxy in front of a real install.
    GALLEY_TRUST_PROXY: "1",
  };
}

/** `galley serve` in hosted mode, until it says it is serving. */
async function serve(home, { args = [], mail = false, publicUrl = false, env: extra = {} } = {}) {
  const port = await freePort();
  // Links are only ever built from the editor's public address, and only e-mailed when it is set: here, this loopback port.
  const env = { ...baseEnv(), GALLEY_HOME: home, ...(mail ? { GALLEY_SMTP_URL: `smtp://127.0.0.1:${sink.port}`, GALLEY_MAIL_FROM: "editor@example.com" } : {}), ...(publicUrl ? { GALLEY_PUBLIC_URL: `http://127.0.0.1:${port}` } : {}), ...extra };
  const child = spawn(process.execPath, [CLI, "serve", "--host", "127.0.0.1", "--port", String(port), ...args], { cwd: scratch, env, stdio: ["ignore", "pipe", "pipe"] });
  const server = { port, child, out: "", log: "" };

  running.push(server);
  child.stdout.setEncoding("utf8").on("data", (text) => (server.out += text));
  child.stderr.setEncoding("utf8").on("data", (text) => (server.log += text));
  await new Promise((ready, fail) => {
    const timer = setTimeout(() => fail(new Error(`the server didn't start within 120 s:\n${server.out}${server.log}`)), 120_000);
    child.stdout.on("data", () => {
      if (server.out.includes("Press Ctrl+C to stop.")) {
        clearTimeout(timer);
        ready();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`the server stopped (${code}) before serving:\n${server.out}${server.log}`));
    });
  });
  return server;
}

async function stop(server) {
  running.splice(running.indexOf(server), 1);
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;
  await new Promise((stopped) => {
    const kill = setTimeout(() => server.child.kill("SIGKILL"), 20_000);
    server.child.once("exit", () => {
      clearTimeout(kill);
      stopped();
    });
    server.child.kill("SIGTERM");
  });
}

// ─────────────────────────────────────────────────────────────── browsers

let addresses = 10;

/** A browser: its own cookies and its own client address. */
function browser(server, label) {
  const cookies = new Map();
  const address = `203.0.113.${addresses++}`;

  return {
    label,
    server,
    signedIn: () => cookies.size > 0,
    async call(method, path, body, headers = {}) {
      const origin = `http://127.0.0.1:${this.server.port}`;
      const send = { host: `127.0.0.1:${this.server.port}`, "x-forwarded-for": address, ...headers };
      let payload;

      // As the web app's api() does: every call but a GET (and a DELETE without one) carries a JSON body, `{}` when there is nothing to say.
      if (body === undefined && method !== "GET" && method !== "DELETE") body = {};
      if (body !== undefined) {
        payload = Buffer.from(JSON.stringify(body));
        send["content-type"] = "application/json";
        send["content-length"] = String(payload.length);
      }
      if (method !== "GET") send.origin = headers.origin ?? origin;
      if (cookies.size) send.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      return new Promise((done, fail) => {
        const request = http.request({ host: "127.0.0.1", port: this.server.port, method, path, headers: send, agent: false }, (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            for (const line of response.headers["set-cookie"] ?? []) {
              const [pair] = line.split(";");
              const at = pair.indexOf("=");
              const name = pair.slice(0, at);
              const value = pair.slice(at + 1);
              if (!value || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) cookies.delete(name);
              else cookies.set(name, value);
            }
            const text = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = null;
            }
            done({ status: response.statusCode, text, body: json, type: response.headers["content-type"] ?? "" });
          });
        });
        request.on("error", fail);
        request.end(payload);
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────── checks

class Failed extends Error {}

function check(condition, message) {
  if (!condition) throw new Failed(message);
}

/** An answer with this status, or a failure that says what came instead. */
function expectStatus(answer, status, what) {
  check(answer.status === status, `${what}: expected ${status}, got ${answer.status} ${answer.text.slice(0, 300)}`);
  return answer;
}

function refusedForRole(answer, what) {
  expectStatus(answer, 403, what);
  check(answer.body?.error?.code === "forbidden" && answer.body.error.message === ROLE_REFUSAL, `${what}: the refusal wasn't the plain sentence: ${answer.text}`);
}

function codeOf(url) {
  return new URL(url).hash.slice(1);
}

function linkIn(text, path) {
  const found = new RegExp(`https?://[^\\s"<>]+${path}#[A-Za-z0-9_-]+`).exec(text);
  return found?.[0] ?? null;
}

async function waitFor(condition, ms, what) {
  const until = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > until) throw new Failed(`${what} didn't happen within ${ms / 1000} s`);
    await new Promise((later) => setTimeout(later, 100));
  }
}

let stepCount = 0;

async function step(title, run) {
  stepCount += 1;
  const started = Date.now();
  const said = await run();
  process.stdout.write(`ok   ${String(stepCount).padStart(2)}. ${title}${said ? ` — ${said}` : ""} (${((Date.now() - started) / 1000).toFixed(1)} s)\n`);
}

// ─────────────────────────────────────────────────────────────── the site

function siteRepository() {
  const bare = join(scratch, "remote", "site.git");
  const seed = join(scratch, "seed");
  const files = {
    "galley.config.json": `${JSON.stringify({ name: "Rehearsal site", dev: { command: "node server.mjs" } }, null, 2)}\n`,
    "server.mjs": 'import http from "node:http";\nhttp.createServer((_q, s) => s.end("the site")).listen(0, "127.0.0.1", function () { console.log("Local http://localhost:" + this.address().port + "/"); });\n',
    "src/content/pages/index.md": "---\ntitle: Home\n---\nWelcome.\n",
    "src/content/pages/about.md": "---\ntitle: About\n---\nAbout the site.\n",
  };

  mkdirSync(bare, { recursive: true });
  mkdirSync(seed, { recursive: true });
  git(["init", "-q", "--bare", "-b", "main"], bare);
  git(["init", "-q", "-b", "main"], seed);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(seed, path)), { recursive: true });
    writeFileSync(join(seed, path), content);
  }
  git(["add", "-A"], seed);
  git(["commit", "-q", "-m", "First version"], seed);
  git(["push", "-q", bare, "main"], seed);
  return bare;
}

// ─────────────────────────────────────────────────────────────── the walk

async function main() {
  for (const folder of ["home", "tmp"]) mkdirSync(join(scratch, folder), { recursive: true });
  writeFileSync(join(scratch, "gitconfig"), "[init]\n\tdefaultBranch = main\n");
  sink = await startSink();
  const bare = siteRepository();
  const home = join(scratch, "install");
  const server = await serve(home, { mail: true, publicUrl: true, env: { GALLEY_TOKEN: OPERATOR_TOKEN } });
  const setupUrl = /Setup:\s+(\S+)/.exec(server.out)?.[1];
  let owner = browser(server, "owner");
  const people = {};
  let siteId = null;
  let setupCode = null;

  await step("first run with the setup code: the owner's account, the site connected, finished", async () => {
    check(setupUrl, `the server printed no setup link:\n${server.out}`);
    setupCode = new URL(setupUrl).searchParams.get("token");
    secrets.add(setupCode);
    const created = expectStatus(await owner.call("POST", "/api/setup/password", { name: "Sam Owner", email: "Sam@Example.com", password: PASSWORD }, { authorization: `Bearer ${setupCode}` }), 200, "creating the owner");
    check(created.body.step === "site" && owner.signedIn(), `after the account, first run should ask for the site and this browser be signed in: ${created.text}`);
    expectStatus(await browser(server, "stranger").call("POST", "/api/setup/password", { name: "Mallory", email: "m@example.com", password: "someone else's password" }, { authorization: `Bearer ${setupCode}` }), 401, "the setup code a second time");
    const job = expectStatus(await owner.call("POST", "/api/setup/site", { repository: bare, access: "token", token: "not-used-for-a-folder" }), 200, "connecting the site");
    await waitFor(async () => (await owner.call("GET", `/api/jobs/${job.body.id}`)).body?.state !== "running", 90_000, "connecting the site");
    const status = expectStatus(await owner.call("GET", "/api/setup"), 200, "first run's state");
    check(status.body.step === "details" && status.body.site?.state === "connected", `the site wasn't connected: ${status.text}`);
    expectStatus(await owner.call("PUT", "/api/setup/details", { author: { name: "Install Name", email: "install@example.com" } }), 200, "the details");
    const finished = expectStatus(await owner.call("POST", "/api/setup/finish"), 200, "finishing");
    check(finished.body.step === "done", `first run didn't finish: ${finished.text}`);
    return "setup code used once; site connected from a local bare repository";
  });

  await step("GET /api/meta as the owner: the account, what it may do, sign-in with e-mail", async () => {
    const meta = expectStatus(await owner.call("GET", "/api/meta"), 200, "meta").body;
    check(meta.authenticated === true, "the owner isn't signed in");
    check(meta.account?.name === "Sam Owner" && meta.account.email === "sam@example.com" && meta.account.role === "owner", `account: ${JSON.stringify(meta.account)}`);
    check(JSON.stringify(meta.account.access) === JSON.stringify(["edit", "publish", "manage"]), `access: ${JSON.stringify(meta.account.access)}`);
    check(meta.install?.signInWith === "email" && meta.install.passwordEmail === true, `install: ${JSON.stringify(meta.install)}`);
    check(!("passwordHash" in meta.account) && !meta.account.incomplete, "the account says too much, or is incomplete");
    siteId = meta.install.siteId;
    check(siteId, "no site id in meta");
    const signedOut = (await browser(server, "nobody").call("GET", "/api/meta")).body;
    check(signedOut.account === undefined && signedOut.install.signInWith === "email", `signed out, meta says: ${JSON.stringify(signedOut)}`);
    return `e-mail lower-cased; access ${meta.account.access.join("+")}`;
  });

  await step("invite an editor and a contributor; each link told once and used from a fresh browser; used and unknown codes refused alike", async () => {
    const before = sink.messages.length;
    const refusals = [];

    for (const [role, name, email] of [["editor", "Robin Editor", "robin@example.com"], ["contributor", "Jo Contributor", "jo@example.com"]]) {
      const invited = expectStatus(await owner.call("POST", "/api/people/invitations", { email, role }), 200, `inviting the ${role}`);
      const url = invited.body.link?.url;
      check(url && new URL(url).pathname === "/join" && invited.body.invitation.role === role && !("url" in invited.body.invitation), `the invitation: ${invited.text}`);
      const code = codeOf(url);
      secrets.add(code);
      const list = expectStatus(await owner.call("GET", "/api/people"), 200, "the People list");
      check(!list.text.includes(code), "the People list repeats a link's code");
      check(list.body.invitations.some((invitation) => invitation.email === email && invitation.emailed === true), `the invitation isn't listed as e-mailed: ${list.text}`);
      const fresh = browser(server, name);
      const preview = expectStatus(await fresh.call("POST", "/api/auth/link/check", { code }), 200, "checking the link");
      check(preview.body.kind === "invitation" && preview.body.email === email && preview.body.role === role && preview.body.invitedBy === "Sam Owner", `the link says: ${preview.text}`);
      expectStatus(await fresh.call("POST", "/api/auth/link", { code, password: PEOPLE_PASSWORD, name }), 200, "using the link");
      check(fresh.signedIn(), "using the link didn't sign the browser in");
      const me = expectStatus(await fresh.call("GET", "/api/account"), 200, "their account");
      check(me.body.role === role && me.body.name === name, `their account: ${me.text}`);
      people[role] = { browser: fresh, id: me.body.id, name, email };
      const again = browser(server, `${name}, again`);
      refusals.push(await again.call("POST", "/api/auth/link/check", { code }));
      refusals.push(await again.call("POST", "/api/auth/link", { code, password: PEOPLE_PASSWORD, name }));
    }
    refusals.push(await browser(server, "a guesser").call("POST", "/api/auth/link/check", { code: "A".repeat(43) }));
    for (const refusal of refusals) {
      expectStatus(refusal, 404, "a used or unknown link");
      check(refusal.text === refusals[0].text, `a used and an unknown link were answered differently:\n${refusals[0].text}\n${refusal.text}`);
    }
    check(sink.messages.length - before === 2, `expected 2 invitation e-mails, the sink has ${sink.messages.length - before}`);
    return `${refusals.length} refusals, one 404 sentence: "${refusals[0].body.error.message}"`;
  });

  await step("as the contributor: edit an entry; Publish, inbox, People, Install page and a key refused with 403; no key hint in settings", async () => {
    const jo = people.contributor.browser;
    expectStatus(await owner.call("PUT", "/api/secrets/anthropic", { value: KEY }), 200, "the owner storing a key");
    expectStatus(await owner.call("PUT", "/api/secrets/cloudflare", { value: HOST_KEY }), 200, "the owner storing a host's key");
    const hosts = expectStatus(await owner.call("GET", "/api/deploy/targets"), 200, "the hosts, for the owner");
    check(hosts.text.includes(KEY_TAIL), "the owner's list of hosts doesn't show the host key's hint (so the contributor's check below would prove nothing)");
    const edited = expectStatus(await jo.call("PATCH", `/api/sites/${siteId}/entry?path=${encodeURIComponent("src/content/pages/index.md")}`, { ops: [{ op: "set", path: ["title"], value: "Home, as Jo left it" }] }), 200, "the contributor editing an entry");
    check(edited.body.ok !== false, `the edit: ${edited.text.slice(0, 300)}`);
    refusedForRole(await jo.call("POST", `/api/sites/${siteId}/publish`, { message: "Jo publishing" }), "the contributor's Publish");
    refusedForRole(await jo.call("GET", `/api/sites/${siteId}/inbox`), "the contributor reading the inbox");
    refusedForRole(await jo.call("GET", "/api/people"), "the contributor reading People");
    refusedForRole(await jo.call("GET", "/api/install"), "the contributor opening the Install page");
    refusedForRole(await jo.call("PUT", "/api/secrets/anthropic", { value: "sk-ant-someone-else-0000" }), "the contributor changing a key");
    const settings = expectStatus(await jo.call("GET", "/api/settings"), 200, "the contributor reading settings");
    const anthropic = settings.body.secrets.find((secret) => secret.name === "anthropic");
    check(anthropic?.configured === true && !("hint" in anthropic), `the contributor's settings: ${JSON.stringify(anthropic)}`);
    check(!settings.text.includes(KEY_TAIL), "the contributor's settings carry the key's last characters");
    const forOwner = expectStatus(await owner.call("GET", "/api/settings"), 200, "the owner reading settings");
    check(forOwner.body.secrets.find((secret) => secret.name === "anthropic")?.hint === KEY_TAIL, "the owner doesn't see the key's hint");
    for (const path of ["/api/deploy/targets", "/api/plugins", `/api/sites/${siteId}/plugins`, `/api/sites/${siteId}`, "/api/images/providers", "/api/videos/providers"]) {
      const answer = await jo.call("GET", path);
      check(!answer.text.includes(KEY_TAIL), `${path} gives the contributor the key's last characters`);
    }
    return "5 refusals, each the plain sentence; key set, no hint anywhere the contributor reads";
  });

  await step("the site's settings file by every route: the contributor's and the editor's attempts refused in plain words, the owner's work", async () => {
    const jo = people.contributor.browser;
    const robin = people.editor.browser;
    const read = async () => expectStatus(await owner.call("GET", `/api/sites/${siteId}/file?path=galley.config.json`), 200, "reading the settings file").body.content;
    const config = expectStatus(await owner.call("GET", `/api/sites/${siteId}/config`), 200, "the settings").body.config;
    const before = await read();
    const raw = (who, path, mode) => who.call("PUT", `/api/sites/${siteId}/file?path=${encodeURIComponent(path)}`, { content: '{ "name": "Changed", "dev": { "command": "node other.mjs" } }\n', mode });
    const refused = (answer, sentence, what) => {
      check(answer.status === 403 && answer.body?.error?.message === sentence, `${what}: expected 403 "${sentence}", got ${answer.status} ${answer.text.slice(0, 300)}`);
    };

    refusedForRole(await jo.call("PUT", `/api/sites/${siteId}/config`, { config: { ...config, name: "Jo's settings" } }), "the contributor saving the settings screen");
    refused(await raw(jo, "galley.config.json", "build"), BUILD_MODE_REFUSAL, "the contributor writing the settings file in build mode");
    refused(await raw(jo, "GALLEY.CONFIG.JSON", "build"), BUILD_MODE_REFUSAL, "the contributor writing it in other letter case");
    expectStatus(await raw(jo, "galley.config.json", "content"), 403, "the contributor writing it in content mode");
    check((await jo.call("DELETE", `/api/sites/${siteId}/media?path=galley.config.json`)).status >= 400, "the contributor removing it as media");
    refused(await raw(robin, "galley.config.json", "build"), SITE_SETTINGS_REFUSAL, "the editor writing the settings file in build mode");
    check((await read()) === before, "the settings file changed");
    // The owner's work; a pending change of theirs isn't the contributor's to discard either.
    expectStatus(await owner.call("PUT", `/api/sites/${siteId}/config`, { config: { ...config, name: "Rehearsal site, renamed" } }), 200, "the owner saving the settings");
    check((await read()).includes("Rehearsal site, renamed"), "the owner's settings weren't saved");
    refused(await jo.call("POST", `/api/sites/${siteId}/discard`, { paths: ["galley.config.json"] }), SITE_SETTINGS_REFUSAL, "the contributor discarding the owner's settings change");
    expectStatus(await owner.call("POST", `/api/sites/${siteId}/discard`, { paths: ["galley.config.json"] }), 200, "the owner discarding it");
    check((await read()) === before, "the owner's discard didn't put the file back");
    return `5 ways in refused for the contributor, 1 for the editor; "${BUILD_MODE_REFUSAL}"`;
  });

  await step("the editor publishes, the owner changes another entry and publishes: two authors in the repository", async () => {
    const robin = people.editor.browser;
    const first = expectStatus(await robin.call("POST", `/api/sites/${siteId}/publish`, { message: "Robin publishes the new home title" }), 200, "the editor's Publish");
    check(first.body.ok === true, `the editor's Publish: ${first.text.slice(0, 400)}`);
    expectStatus(await owner.call("PATCH", `/api/sites/${siteId}/entry?path=${encodeURIComponent("src/content/pages/about.md")}`, { ops: [{ op: "set", path: ["title"], value: "About us" }] }), 200, "the owner's edit");
    const second = expectStatus(await owner.call("POST", `/api/sites/${siteId}/publish`, { message: "Sam renames About" }), 200, "the owner's Publish");
    check(second.body.ok === true, `the owner's Publish: ${second.text.slice(0, 400)}`);
    const log = git(["--git-dir", bare, "log", "--format=%an <%ae>|%cn <%ce>|%s", "-n", "3", "main"]).split("\n");
    check(log[0] === "Sam Owner <sam@example.com>|Sam Owner <sam@example.com>|Sam renames About", `newest version: ${log[0]}`);
    check(log[1] === "Robin Editor <robin@example.com>|Robin Editor <robin@example.com>|Robin publishes the new home title", `the one before: ${log[1]}`);
    check(log[2]?.endsWith("|First version"), `the first: ${log[2]}`);
    return `git log: ${log[0].split("|")[0]}; ${log[1].split("|")[0]}`;
  });

  await step("the owner makes the editor a contributor: their very next Publish is refused, without signing in again", async () => {
    const robin = people.editor.browser;
    const changed = expectStatus(await owner.call("PATCH", `/api/people/${people.editor.id}`, { role: "contributor" }), 200, "changing the role");
    check(changed.body.role === "contributor", `the change: ${changed.text}`);
    expectStatus(await robin.call("PATCH", `/api/sites/${siteId}/entry?path=${encodeURIComponent("src/content/pages/about.md")}`, { ops: [{ op: "set", path: ["title"], value: "About, by Robin" }] }), 200, "the demoted editor still editing");
    refusedForRole(await robin.call("POST", `/api/sites/${siteId}/publish`, { message: "Robin again" }), "the demoted editor's Publish");
    const meta = expectStatus(await robin.call("GET", "/api/meta"), 200, "their meta").body;
    check(meta.account?.role === "contributor" && JSON.stringify(meta.account.access) === '["edit"]', `their meta: ${JSON.stringify(meta.account)}`);
    return "same cookie, new role";
  });

  await step("the owner switches the contributor off: their next request is 401, their sign-in gets the wrong-password sentence", async () => {
    const jo = people.contributor.browser;
    expectStatus(await owner.call("PATCH", `/api/people/${people.contributor.id}`, { disabled: true }), 200, "switching off");
    expectStatus(await jo.call("GET", `/api/sites/${siteId}/changes`), 401, "the switched-off contributor's next request");
    const switchedOff = await browser(server, "Jo again").call("POST", "/api/auth/login", { email: "jo@example.com", password: PEOPLE_PASSWORD });
    const wrong = await browser(server, "a wrong password").call("POST", "/api/auth/login", { email: "robin@example.com", password: "not robin's password at all" });
    expectStatus(switchedOff, 401, "signing in while switched off");
    expectStatus(wrong, 401, "a wrong password");
    check(switchedOff.text === wrong.text, `switched off and a wrong password answered differently:\n${switchedOff.text}\n${wrong.text}`);
    return `"${wrong.body.error.message}"`;
  });

  await step("outgoing e-mail: an invitation and \"forgot\" each send one message whose link works; an unknown address gets the same answer and nothing", async () => {
    let before = sink.messages.length;
    const invited = expectStatus(await owner.call("POST", "/api/people/invitations", { email: "kim@example.com", role: "editor" }), 200, "inviting by e-mail");
    check(invited.body.link.emailed === true, `the invitation wasn't e-mailed: ${invited.text}`);
    secrets.add(codeOf(invited.body.link.url));
    await waitFor(() => sink.messages.length > before, 10_000, "the invitation e-mail");
    check(sink.messages.length - before === 1, `the invitation sent ${sink.messages.length - before} messages`);
    const invitation = sink.messages.at(-1);
    const joinLink = linkIn(invitation.text, "/join");
    check(invitation.to.join() === "kim@example.com" && joinLink === invited.body.link.url, `the invitation e-mail: to ${invitation.to.join()}, link ${joinLink}`);
    const kim = browser(server, "Kim");
    expectStatus(await kim.call("POST", "/api/auth/link", { code: codeOf(joinLink), password: PEOPLE_PASSWORD, name: "Kim Editor" }), 200, "joining from the e-mail");

    before = sink.messages.length;
    const asking = browser(server, "Sam, locked out");
    const forgot = expectStatus(await asking.call("POST", "/api/auth/forgot", { email: "sam@example.com" }), 200, "forgot");
    await waitFor(() => sink.messages.length > before, 10_000, "the new-password e-mail");
    await new Promise((later) => setTimeout(later, 1000));
    check(sink.messages.length - before === 1, `"forgot" sent ${sink.messages.length - before} messages`);
    const message = sink.messages.at(-1);
    const passwordLink = linkIn(message.text, "/new-password");
    check(message.to.join() === "sam@example.com" && passwordLink, `the new-password e-mail: to ${message.to.join()}, text:\n${message.text.slice(0, 600)}`);
    secrets.add(codeOf(passwordLink));
    const preview = expectStatus(await asking.call("POST", "/api/auth/link/check", { code: codeOf(passwordLink) }), 200, "checking the e-mailed link");
    check(preview.body.kind === "password" && preview.body.email === "sam@example.com", `the e-mailed link: ${preview.text}`);
    expectStatus(await asking.call("POST", "/api/auth/link", { code: codeOf(passwordLink), password: NEW_PASSWORD }), 200, "choosing a new password through it");
    expectStatus(await owner.call("GET", "/api/people"), 401, "the owner's other browser, after the new password");
    owner = asking;

    before = sink.messages.length;
    const unknown = expectStatus(await browser(server, "a stranger").call("POST", "/api/auth/forgot", { email: "nobody@example.com" }), 200, "forgot for an unknown address");
    check(unknown.text === forgot.text, `the answers differ:\n${forgot.text}\n${unknown.text}`);
    await new Promise((later) => setTimeout(later, 2000));
    check(sink.messages.length === before, "an unknown address got an e-mail");
    return `sink holds ${sink.messages.length} messages; both answers ${forgot.text}`;
  });

  await step("\"Sign everyone out\", then the owner signs in again with e-mail and password", async () => {
    const kept = [owner, people.editor.browser];
    expectStatus(await owner.call("POST", "/api/people/sign-out"), 200, "signing everyone out");
    for (const someone of kept) expectStatus(await someone.call("GET", `/api/sites/${siteId}/changes`), 401, `${someone.label} after everyone was signed out`);
    const again = browser(server, "Sam, signing in");
    expectStatus(await again.call("POST", "/api/auth/login", { email: "sam@example.com", password: NEW_PASSWORD }), 200, "the owner signing in");
    const meta = expectStatus(await again.call("GET", "/api/meta"), 200, "meta").body;
    check(meta.authenticated && meta.account?.role === "owner", `after signing in: ${JSON.stringify(meta.account)}`);
    expectStatus(await browser(server, "the old password").call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 401, "the password from before the link");
    owner = again;
    return "every browser out; back in with the new password";
  });

  await step("the rest of People and Your account, with the bodies the web app sends", async () => {
    const list = expectStatus(await owner.call("GET", "/api/people"), 200, "the People list").body;
    check(list.emailAvailable === true && Array.isArray(list.accounts) && Array.isArray(list.invitations), `the list: ${JSON.stringify(list).slice(0, 300)}`);
    const kim = list.accounts.find((account) => account.email === "kim@example.com");
    const jo = list.accounts.find((account) => account.email === "jo@example.com");
    check(kim && jo?.disabled === true, "Kim or Jo is missing from the list");
    const kimIn = browser(server, "Kim, signed in");
    expectStatus(await kimIn.call("POST", "/api/auth/login", { email: "kim@example.com", password: PEOPLE_PASSWORD }), 200, "Kim signing in");
    // New-password link (People › … › New-password link): a OneTimeLink, e-mailed — and then only in Kim's inbox, not handed to the owner.
    const before = sink.messages.length;
    const made = expectStatus(await owner.call("POST", `/api/people/${kim.id}/password-link`), 200, "a new-password link for Kim").body;
    check(made.url === null && made.expiresAt && made.emailed === true, `the link: ${JSON.stringify(made)}`);
    await waitFor(() => sink.messages.length > before, 10_000, "the new-password e-mail to Kim");
    const mailed = linkIn(sink.messages.at(-1).text, "/new-password");
    check(sink.messages.at(-1).to.join() === "kim@example.com" && mailed && new URL(mailed).origin === `http://127.0.0.1:${server.port}`, `the e-mail to Kim: ${sink.messages.at(-1).to.join()} ${mailed}`);
    secrets.add(codeOf(mailed));
    // Sign out (one person, everywhere).
    expectStatus(await owner.call("POST", `/api/people/${kim.id}/sign-out`), 200, "signing Kim out");
    expectStatus(await kimIn.call("GET", "/api/account"), 401, "Kim after being signed out");
    // An invitation taken back: its link stops working.
    const invited = expectStatus(await owner.call("POST", "/api/people/invitations", { email: "lee@example.com", role: "contributor" }), 200, "inviting Lee").body;
    secrets.add(codeOf(invited.link.url));
    expectStatus(await owner.call("DELETE", `/api/people/invitations/${invited.invitation.id}`), 200, "taking the invitation back");
    expectStatus(await browser(server, "Lee").call("POST", "/api/auth/link/check", { code: codeOf(invited.link.url) }), 404, "the taken-back link");
    // Remove.
    expectStatus(await owner.call("DELETE", `/api/people/${jo.id}`), 200, "removing Jo");
    check(!expectStatus(await owner.call("GET", "/api/people"), 200, "the list").body.accounts.some((account) => account.id === jo.id), "Jo is still listed");
    // Your account: the name alone; the password; signing yourself out everywhere.
    const renamed = expectStatus(await owner.call("PATCH", "/api/account", { name: "Sam O. Owner" }), 200, "changing your name").body;
    check(renamed.name === "Sam O. Owner" && renamed.access?.includes("manage"), `after the rename: ${JSON.stringify(renamed)}`);
    expectStatus(await owner.call("POST", "/api/account/password", { current: "not the current password", next: PASSWORD }), 400, "a wrong current password");
    expectStatus(await owner.call("POST", "/api/account/password", { current: NEW_PASSWORD, next: PASSWORD }), 200, "changing your password");
    expectStatus(await owner.call("GET", "/api/account"), 200, "this browser after the change");
    expectStatus(await owner.call("POST", "/api/auth/logout-all"), 200, "signing yourself out everywhere");
    expectStatus(await owner.call("GET", "/api/account"), 401, "after signing out everywhere");
    expectStatus(await owner.call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 200, "signing in again");
    expectStatus(await owner.call("POST", "/api/auth/logout"), 200, "signing out");
    return "password link, sign out one, take back, remove, rename, password, out everywhere";
  });

  await step("the operator's access token still publishes: guarded work done for the operator, not for nobody", async () => {
    const sam = browser(server, "Sam, editing for the operator");
    expectStatus(await sam.call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 200, "signing in");
    expectStatus(await sam.call("PATCH", `/api/sites/${siteId}/entry?path=${encodeURIComponent("src/content/pages/about.md")}`, { ops: [{ op: "set", path: ["title"], value: "About, published by a script" }] }), 200, "an edit to publish");
    const published = expectStatus(await browser(server, "a script").call("POST", `/api/sites/${siteId}/publish`, { message: "Published with the operator's token" }, { authorization: `Bearer ${OPERATOR_TOKEN}` }), 200, "publishing with the operator's token");
    check(published.body.ok === true, `the operator's Publish: ${published.text.slice(0, 400)}`);
    const log = git(["--git-dir", bare, "log", "--format=%s", "-n", "1", "main"]);
    check(log === "Published with the operator's token", `newest version: ${log}`);
    return log;
  });

  await step("sign-in limits: a browser that signed in before gets in at once while its e-mail is guessed at; an unknown one waits its turn", async () => {
    const own = browser(server, "Sam's own browser");
    const first = expectStatus(await own.call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 200, "signing in");
    check(own.signedIn(), `no cookie after signing in: ${first.text}`);
    let guesses = 0;
    for (let i = 0; i < 10; i += 1) {
      expectStatus(await browser(server, `a guesser ${i}`).call("POST", "/api/auth/login", { email: "sam@example.com", password: "a guess at Sam's password" }), 401, "a guess");
      guesses += 1;
    }
    let started = Date.now();
    expectStatus(await own.call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 200, "the browser Sam used before");
    const knownMs = Date.now() - started;
    check(knownMs < 900, `the browser Sam used before waited ${knownMs} ms`);
    started = Date.now();
    expectStatus(await browser(server, "a new browser of Sam's").call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 200, "a browser Sam never used");
    const unknownMs = Date.now() - started;
    check(unknownMs >= 900, `a new browser didn't wait its turn (${unknownMs} ms)`);
    return `${guesses} guesses; the known browser in ${knownMs} ms, a new one after ${unknownMs} ms`;
  });

  await step("the log never shows a password, a key, a link's code or anyone's e-mail", async () => {
    // The setup link is printed on purpose, once, where the server starts (stdout); the log is everything after.
    for (const secret of secrets) check(!server.log.includes(secret), `the server's log carries a secret (${secret.slice(0, 4)}…)`);
    for (const email of ["sam@example.com", "robin@example.com", "jo@example.com", "kim@example.com", "nobody@example.com"]) check(!server.log.includes(email), `the server's log names ${email}`);
    return `${server.log.split("\n").length} log lines checked`;
  });

  await step("the built web app: /join, /new-password and /account are the app's own page, signed out and signed in", async () => {
    const dist = join(ROOT, "packages/web/dist");
    if (!existsSync(join(dist, "index.html"))) return "SKIPPED: the web app isn't built here (pnpm --filter @galley/web build)";
    const stranger = browser(server, "a stranger");
    const sam = browser(server, "Sam");
    expectStatus(await sam.call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 200, "signing in");
    const app = expectStatus(await stranger.call("GET", "/"), 200, "the app");
    check(app.type.startsWith("text/html") && app.text === readFileSync(join(dist, "index.html"), "utf8"), "/ isn't the built app's page");
    for (const path of ["/join", "/new-password", "/account"]) {
      for (const who of [stranger, sam]) {
        const page = expectStatus(await who.call("GET", path), 200, `${path} for ${who.label}`);
        check(page.type.startsWith("text/html") && page.text === app.text, `${path} for ${who.label} isn't the app's page`);
      }
    }
    // The page those addresses open is in the build, and served.
    const chunk = readdirSync(join(dist, "assets")).find((file) => file.endsWith(".js") && readFileSync(join(dist, "assets", file), "utf8").includes("This link can’t be used."));
    check(chunk, "no part of the built app says \"This link can’t be used.\"");
    const served = expectStatus(await stranger.call("GET", `/assets/${chunk}`), 200, "the link page's code");
    check(/javascript/.test(served.type), `the link page's code came as ${served.type}`);
    return `3 pages × signed out and in: the app's index.html; ${chunk} served`;
  });

  await stop(server);

  await step("without the editor's public address: no link is e-mailed, and one is shown only on this computer", async () => {
    const bare = await serve(join(scratch, "no-address"), { mail: true, env: { GALLEY_PASSWORD: PASSWORD, GALLEY_OWNER_NAME: "Sam Owner", GALLEY_OWNER_EMAIL: "sam@example.com" } });
    check(/E-mail: {4}set up, but no link is e-mailed until the editor's public address is set/.test(bare.out), `the start-up lines don't say so:
${bare.out}`);
    const sam = browser(bare, "Sam, no address");
    const before = sink.messages.length;
    expectStatus(await sam.call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 200, "signing in");
    const forgot = expectStatus(await browser(bare, "asking").call("POST", "/api/auth/forgot", { email: "sam@example.com" }), 200, "forgot");
    check(forgot.body.emailAvailable === false, `forgot: ${forgot.text}`);
    const foreign = await sam.call("POST", "/api/people/invitations", { email: "lee@example.com", role: "editor" }, { host: "editor.example.net", origin: "http://editor.example.net" });
    check(foreign.status === 400 && /public address \(GALLEY_PUBLIC_URL\)/.test(foreign.body?.error?.message ?? ""), `an invitation through another address: ${foreign.status} ${foreign.text}`);
    const here = expectStatus(await sam.call("POST", "/api/people/invitations", { email: "lee@example.com", role: "editor" }), 200, "an invitation on this computer");
    check(here.body.link.emailed === false && new URL(here.body.link.url).origin === `http://127.0.0.1:${bare.port}`, `the invitation: ${JSON.stringify({ ...here.body.link, url: new URL(here.body.link.url).origin })}`);
    secrets.add(codeOf(here.body.link.url));
    await new Promise((later) => setTimeout(later, 1000));
    check(sink.messages.length === before, `${sink.messages.length - before} e-mails went out without a public address`);
    await stop(bare);
    return "nothing e-mailed; the link shown on 127.0.0.1 only";
  });

  const legacyHome = join(scratch, "legacy");
  let legacy = null;

  await step("an install from before accounts: password alone, complete the account, sign out, sign in with the e-mail", async () => {
    mkdirSync(legacyHome, { recursive: true });
    git(["clone", "-q", bare, join(legacyHome, "site")], scratch);
    const schema1 = {
      schema: 1,
      createdAt: "2026-10-01T10:00:00.000Z",
      password: { hash: await hashPassword(PASSWORD), changedAt: "2026-10-02T10:00:00.000Z" },
      setup: { tokenSha256: null, finishedAt: "2026-10-01T10:05:00.000Z" },
      sessions: { validAfter: 0, revoked: [] },
      site: { root: "site", folder: null, repository: bare, branch: "main", access: "token", connectedAt: "2026-10-01T10:04:00.000Z", starter: null },
      liveUrl: null,
      pendingLiveUrl: null,
      lastBackupAt: null,
      seeded: ["password"],
    };
    writeFileSync(join(legacyHome, "install.json"), `${JSON.stringify(schema1, null, 2)}\n`, { mode: 0o600 });
    legacy = await serve(legacyHome);
    const sam = browser(legacy, "Sam on the old install");
    const meta = (await sam.call("GET", "/api/meta")).body;
    check(meta.install?.signInWith === "password" && meta.install.passwordSet === true && meta.install.setupNeeded === false, `before: ${JSON.stringify(meta.install)}`);
    expectStatus(await sam.call("POST", "/api/auth/login", { password: PASSWORD }), 200, "the password alone");
    const account = (await sam.call("GET", "/api/meta")).body.account;
    check(account?.role === "owner" && account.incomplete === true && account.email === "", `the carried-over owner: ${JSON.stringify(account)}`);
    expectStatus(await sam.call("PATCH", "/api/account", { name: "Sam Owner", email: "sam@example.com" }), 400, "adding an e-mail without the current password");
    const completed = expectStatus(await sam.call("PATCH", "/api/account", { name: "Sam Owner", email: "sam@example.com", password: PASSWORD }), 200, "completing the account");
    check(!completed.body.incomplete && completed.body.email === "sam@example.com", `completed: ${completed.text}`);
    expectStatus(await sam.call("POST", "/api/auth/logout"), 200, "signing out");
    expectStatus(await sam.call("GET", "/api/sites"), 401, "after signing out");
    check((await sam.call("GET", "/api/meta")).body.install.signInWith === "email", "the sign-in page still asks for the password alone");
    expectStatus(await sam.call("POST", "/api/auth/login", { password: PASSWORD }), 401, "the password alone, once there is an e-mail");
    expectStatus(await sam.call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 200, "signing in with the e-mail");
    const after = (await sam.call("GET", "/api/meta")).body;
    check(after.account?.name === "Sam Owner" && !after.account.incomplete && after.install.siteId, `after: ${JSON.stringify(after.account)}`);
    return "schema 1 → 2 on start; the same password throughout";
  });

  await stop(legacy);

  await step("serve --reset-password for a locked-out owner: the printed link sets a new password; old links are dead", async () => {
    const first = await serve(legacyHome, { args: ["--reset-password"] });
    const firstLink = /Password:\s+(\S+)/.exec(first.out)?.[1];
    check(firstLink && new URL(firstLink).pathname === "/new-password", `no new-password link printed:\n${first.out}`);
    secrets.add(codeOf(firstLink));
    check(!first.log.includes(codeOf(firstLink)), "the reset link reached the log");
    await stop(first);

    const second = await serve(legacyHome, { args: ["--reset-password"] });
    const secondLink = /Password:\s+(\S+)/.exec(second.out)?.[1];
    check(secondLink && secondLink !== firstLink, "the second run printed no new link");
    secrets.add(codeOf(secondLink));
    const sam = browser(second, "Sam, locked out");
    // The old password still works until the link is used.
    expectStatus(await browser(second, "the old password").call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 200, "the old password before the link is used");
    expectStatus(await sam.call("POST", "/api/auth/link/check", { code: codeOf(firstLink) }), 404, "the link from the run before");
    const preview = expectStatus(await sam.call("POST", "/api/auth/link/check", { code: codeOf(secondLink) }), 200, "the printed link");
    check(preview.body.kind === "password" && preview.body.email === "sam@example.com", `the printed link: ${preview.text}`);
    expectStatus(await sam.call("POST", "/api/auth/link", { code: codeOf(secondLink), password: NEW_PASSWORD }), 200, "choosing a new password");
    expectStatus(await browser(second, "the link again").call("POST", "/api/auth/link/check", { code: codeOf(secondLink) }), 404, "the used link");
    expectStatus(await browser(second, "the old password again").call("POST", "/api/auth/login", { email: "sam@example.com", password: PASSWORD }), 401, "the old password after the link");
    expectStatus(await browser(second, "the new password").call("POST", "/api/auth/login", { email: "sam@example.com", password: NEW_PASSWORD }), 200, "the new password");
    for (const secret of secrets) check(!second.log.includes(secret), `the server's log carries a secret (${secret.slice(0, 4)}…)`);
    await stop(second);
    return "two runs: the first link died when the second was made; the second worked once";
  });

  await step("a starter sent from first run: its first version carries the owner's name, though no publishing name is saved yet", async () => {
    // A starter of our own, with nothing to install, so nothing is fetched; npm is told to stay offline all the same.
    const starters = join(scratch, "starters");
    mkdirSync(join(starters, "tiny", "src", "content", "pages"), { recursive: true });
    writeFileSync(join(starters, "tiny", "package.json"), `${JSON.stringify({ name: "tiny", private: true, scripts: { dev: "node -e 0" } }, null, 2)}\n`);
    writeFileSync(join(starters, "tiny", "src", "content", "pages", "index.md"), "---\ntitle: Home\n---\nHello.\n");
    const empty = join(scratch, "remote", "starter.git");
    mkdirSync(empty, { recursive: true });
    git(["init", "-q", "--bare", "-b", "main"], empty);
    const fresh = await serve(join(scratch, "starter-install"), { env: { GALLEY_STARTERS_DIR: starters, npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" } });
    const code = new URL(/Setup:\s+(\S+)/.exec(fresh.out)?.[1] ?? "http://x/").searchParams.get("token");
    check(code, `the fresh install printed no setup link:\n${fresh.out}`);
    secrets.add(code);
    const ana = browser(fresh, "Ana, the new owner");
    expectStatus(await ana.call("POST", "/api/setup/password", { name: "Ana Owner", email: "ana@example.com", password: PASSWORD }, { authorization: `Bearer ${code}` }), 200, "creating the owner");
    const job = expectStatus(await ana.call("POST", "/api/setup/site", { repository: empty, access: "token", token: "not-used-for-a-folder", starter: { id: "tiny", name: "Starter site" } }), 200, "sending the starter");
    await waitFor(async () => (await ana.call("GET", `/api/jobs/${job.body.id}`)).body?.state !== "running", 120_000, "sending the starter");
    const ended = (await ana.call("GET", `/api/jobs/${job.body.id}`)).body;
    check(ended?.state === "done", `sending the starter didn't finish: ${JSON.stringify(ended)}`);
    const first = git(["log", "--format=%an <%ae>|%s", "main"], empty);
    check(first === "Ana Owner <ana@example.com>|Start Starter site from a starter", `the starter's first version: ${first}`);
    await stop(fresh);
    return first.split("|")[0];
  });
}

let failed = false;

try {
  await main();
  process.stdout.write(`All ${stepCount} steps passed.\n`);
} catch (error) {
  failed = true;
  process.stdout.write(`FAIL ${String(stepCount).padStart(2)}. ${error instanceof Failed ? error.message : (error?.stack ?? String(error))}\n`);
  for (const server of running) process.stdout.write(`--- the server on port ${server.port} said:\n${server.out}\n${server.log.split("\n").slice(-40).join("\n")}\n`);
} finally {
  await Promise.all([...running].map((server) => stop(server).catch(() => undefined)));
  await sink?.close();
  if (!values.keep) rmSync(scratch, { recursive: true, force: true });
  else process.stdout.write(`Kept: ${scratch}\n`);
}
process.exit(failed ? 1 : 0);
