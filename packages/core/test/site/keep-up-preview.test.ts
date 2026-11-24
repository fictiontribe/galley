/**
 * Newer versions coming in under a running preview. The stand-in dev server
 * behaves like the one this was found with: it checks each page against a
 * schema it reads once at start, keeps what it checked in a store keyed by
 * the page's digest, re-checks a page that changes under it with the schema
 * it still has loaded, and trusts its store on the next start. A page and
 * its schema changing together under it leave a store that a plain restart
 * would serve forever.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { astroAdapter } from "../../src/adapters/index";
import { forgetPreviewSaves, HELD_DETAIL } from "../../src/workspace/index";
import { cleanupAll, disposeAll, openSite, sh, tempDir, until, writeTree } from "./helpers";

const SLOW = { timeout: 180_000 };
const PAGE = "src/content/pages/index.md";
const SCHEMA = "src/schema.json";
const STORE = ".astro/data-store.json";

afterEach(async () => {
  await disposeAll();
  cleanupAll();
});

const DEV_SERVER = `
import http from "node:http";
import crypto from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
appendFileSync("starts.log", "start\\n");
const schema = JSON.parse(readFileSync(${JSON.stringify(SCHEMA)}, "utf8"));
const digest = () => crypto.createHash("sha1").update(readFileSync(${JSON.stringify(PAGE)})).digest("hex");
const checked = () => {
  const lines = readFileSync(${JSON.stringify(PAGE)}, "utf8").split("---")[1].trim().split("\\n");
  const data = Object.fromEntries(lines.map((line) => line.split(":").map((part) => part.trim())));
  return Object.fromEntries(Object.entries(data).filter(([key]) => schema.fields.includes(key)));
};
let store = existsSync(${JSON.stringify(STORE)}) ? JSON.parse(readFileSync(${JSON.stringify(STORE)}, "utf8")) : null;
const save = () => {
  mkdirSync(".astro", { recursive: true });
  store = { digest: digest(), data: checked() };
  writeFileSync(${JSON.stringify(STORE)}, JSON.stringify(store));
};
if (!store || store.digest !== digest()) save();
let seen = store.digest;
setInterval(() => {
  try {
    const now = digest();
    if (now !== seen) { seen = now; save(); }
  } catch {}
}, 40);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head><title>Site</title></head><body><pre id=data>" + JSON.stringify(store.data) + "</pre></body></html>");
});
server.listen(Number(process.env.PORT) || 0, "127.0.0.1", () => console.log("Local http://localhost:" + server.address().port + "/"));
`;

/** An Astro site (by its dependency) whose dev command is the stand-in, with a code host and someone publishing elsewhere. */
function astroSite() {
  const root = tempDir("site-keepup-");

  writeTree(root, {
    "package.json": JSON.stringify({ name: "harbour-notes", private: true, type: "module", dependencies: { astro: "^5.0.0" } }),
    "galley.config.json": JSON.stringify({ dev: { command: "node server.mjs" } }),
    "server.mjs": DEV_SERVER,
    [SCHEMA]: JSON.stringify({ fields: ["title"] }),
    [PAGE]: "---\ntitle: Home\n---\nHello\n",
    ".gitignore": ".astro\nnode_modules\nstarts.log\n",
  });
  // Installed, as far as the preview can tell: nothing is installed for real.
  mkdirSync(join(root, "node_modules"));
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "First");
  const bare = tempDir("site-keepup-bare-");

  sh(bare, "init", "-q", "--bare", "-b", "main");
  sh(root, "remote", "add", "origin", bare);
  sh(root, "push", "-q", "-u", "origin", "main");
  const other = tempDir("site-keepup-other-");

  sh(other, "clone", "-q", bare, ".");
  return {
    root,
    elsewhere(changes: Record<string, string>, message: string) {
      writeTree(other, changes);
      sh(other, "add", "-A");
      sh(other, "commit", "-q", "-m", message);
      sh(other, "push", "-q", "origin", "main");
    },
    starts: () => (existsSync(join(root, "starts.log")) ? readFileSync(join(root, "starts.log"), "utf8").trim().split("\n").length : 0),
    store: () => readFileSync(join(root, STORE), "utf8"),
  };
}

/**
 * A site whose install is a stand-in as well: `npm install` runs the site's
 * own preinstall script, which makes node_modules straight away (as a real
 * install does long before it is done), notes that it ran, and waits to be
 * let through. Nothing is
 * fetched: the site has no dependencies.
 */
function siteWithInstall() {
  const root = tempDir("site-install-");
  const gate = tempDir("site-install-gate-");
  const log = join(gate, "installs.log");

  writeTree(root, {
    "package.json": JSON.stringify({ name: "harbour-notes", private: true, type: "module", scripts: { preinstall: "node install.mjs" } }),
    "install.mjs": `import { appendFileSync, existsSync, mkdirSync } from "node:fs";
mkdirSync("node_modules", { recursive: true });
appendFileSync(${JSON.stringify(log)}, "install\\n");
while (!existsSync(${JSON.stringify(join(gate, "go"))})) await new Promise((resolve) => setTimeout(resolve, 40));
`,
    "galley.config.json": JSON.stringify({ dev: { command: "node server.mjs" } }),
    "server.mjs": DEV_SERVER,
    [SCHEMA]: JSON.stringify({ fields: ["title"] }),
    [PAGE]: "---\ntitle: Home\n---\nHello\n",
    ".gitignore": ".astro\nnode_modules\nstarts.log\npackage-lock.json\n",
  });
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "First");
  const bare = tempDir("site-install-bare-");

  sh(bare, "init", "-q", "--bare", "-b", "main");
  sh(root, "remote", "add", "origin", bare);
  sh(root, "push", "-q", "-u", "origin", "main");
  const other = tempDir("site-install-other-");

  sh(other, "clone", "-q", bare, ".");
  return {
    root,
    elsewhere(changes: Record<string, string>, message: string) {
      writeTree(other, changes);
      sh(other, "add", "-A");
      sh(other, "commit", "-q", "-m", message);
      sh(other, "push", "-q", "origin", "main");
    },
    installs: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0),
    /** Lets installs through from now on, or makes them wait again. */
    letThrough: (open = true) => (open ? writeFileSync(join(gate, "go"), "") : rmSync(join(gate, "go"), { force: true })),
    starts: () => (existsSync(join(root, "starts.log")) ? readFileSync(join(root, "starts.log"), "utf8").trim().split("\n").length : 0),
  };
}

/**
 * Holds a bring-in open part-way through its files: git waits, when it comes
 * to write GATE into the site, until it is let through (a filter the
 * repository names for that one file). The newer version has to change GATE.
 */
const GATE = "aaa-gate.txt";

function holdBringIn(root: string) {
  const gate = tempDir("site-bring-in-gate-");
  const program = join(gate, "wait.sh");

  writeFileSync(program, `#!/bin/sh\n: > '${gate}/reached'\nwhile [ ! -e '${gate}/go' ]; do sleep 0.05; done\ncat\n`, { mode: 0o755 });
  sh(root, "config", "filter.gate.smudge", program);
  sh(root, "config", "filter.gate.clean", "cat");
  writeFileSync(join(root, ".git", "info", "attributes"), `${GATE} filter=gate\n`);
  return { reached: () => existsSync(join(gate, "reached")), letThrough: () => writeFileSync(join(gate, "go"), "") };
}

// The stand-ins for a slow install and a slow bring-in are shell and npm scripts.
const posix = process.platform !== "win32";

function shown(url: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    http
      .get(`${url}/`, { agent: false }, (res) => {
        let body = "";

        res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        res.on("end", () => {
          const match = /<pre id=data>(.*?)<\/pre>/.exec(body);

          if (!match) reject(new Error(`not the site's page: ${body.slice(0, 200)}`));
          else resolve(JSON.parse(match[1]!) as Record<string, string>);
        });
      })
      .on("error", reject);
  });
}

describe("the preview follows newer versions", SLOW, () => {
  it("stops before a page and its schema change together, forgets what it saved, and starts once on the new versions", async () => {
    const site = astroSite();
    const { site: open, of } = await openSite(site.root);

    expect((await open.model()).previewSaves).toEqual([".astro/data-store.json", "node_modules/.astro/data-store.json"]);
    const preview = open.preview();
    const ready = await preview.start();

    expect(ready.state).toBe("ready");
    expect(await shown(ready.url!)).toEqual({ title: "Home" });
    expect(site.starts()).toBe(1);

    // Get latest, by a person: the page gains a field and the schema learns it in one version.
    site.elsewhere({ [PAGE]: "---\ntitle: Home\nalign: center\n---\nHello\n", [SCHEMA]: JSON.stringify({ fields: ["title", "align"] }) }, "Centre the home page");
    const status = await open.pull();

    expect(status).toMatchObject({ behind: 0, lastCommit: { message: "Centre the home page" } });
    await until(() => preview.status().state === "ready" && site.starts() === 2, 60_000);
    expect(await shown(preview.status().url!)).toEqual({ title: "Home", align: "center" });
    expect(JSON.parse(site.store()).data).toEqual({ title: "Home", align: "center" });
    expect(of("preview.status").filter((event) => event.status.state === "stopped")).toHaveLength(1);

    // Nothing new: the round restarts nothing.
    expect(await open.catchUp()).toMatchObject({ brought: 0 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(site.starts()).toBe(2);
    expect(preview.status().state).toBe("ready");

    // A stopped preview stays stopped when the round brings something in.
    await preview.stop();
    site.elsewhere({ [PAGE]: "---\ntitle: Welcome\nalign: center\n---\nHello\n" }, "Rename the home page");
    expect(await open.catchUp()).toMatchObject({ brought: 1, paths: [PAGE] });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(preview.status().state).toBe("stopped");
    expect(site.starts()).toBe(2);
  });

  it("leaves a running preview and its store as they were when bringing in can't go ahead", async () => {
    const site = astroSite();
    const { site: open } = await openSite(site.root);
    const preview = open.preview();

    await preview.start();
    const store = site.store();
    const pid = open.previewHandle()?.pid;

    writeFileSync(join(site.root, PAGE), "---\ntitle: Mine\n---\nHello\n");
    await until(() => JSON.parse(site.store()).data.title === "Mine");
    const mine = site.store();

    site.elsewhere({ [PAGE]: "---\ntitle: Theirs\n---\nHello\n" }, "Their title");
    await expect(open.pull()).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("index.md") });
    expect(await open.catchUp()).toMatchObject({ brought: 0, status: { inTheWay: { kind: "changes" } } });
    expect(preview.status().state).toBe("ready");
    expect(open.previewHandle()?.pid).toBe(pid);
    expect(pid).toBeGreaterThan(0);
    expect(site.starts()).toBe(1);
    expect(site.store()).toBe(mine);
    expect(store).not.toBe(mine);
  });

  it("the app's own restart forgets what was saved once the copy moved on by another route", async () => {
    const site = astroSite();
    const { site: open } = await openSite(site.root);
    const preview = open.preview();

    await preview.start();
    const before = site.store();

    // Moved on outside the app, under the running preview: the stand-in saves the page checked against its old schema.
    site.elsewhere({ [PAGE]: "---\ntitle: Home\nalign: center\n---\nHello\n", [SCHEMA]: JSON.stringify({ fields: ["title", "align"] }) }, "Centre the home page");
    sh(site.root, "pull", "-q", "--ff-only");
    await until(() => site.store() !== before);
    expect(JSON.parse(site.store()).data).toEqual({ title: "Home" });
    const restarted = await preview.restart();

    expect(restarted.state).toBe("ready");
    expect(await shown(restarted.url!)).toEqual({ title: "Home", align: "center" });
    // Restarting again on the same version keeps what it saved.
    const saved = site.store();

    await preview.restart();
    expect(site.store()).toBe(saved);
  });
});

describe("the preview while newer versions come in", SLOW, () => {
  it.skipIf(!posix)("an install is left to finish: the round waits for it, Get latest says so, and the versions come in afterwards", async () => {
    const site = siteWithInstall();
    const { site: open } = await openSite(site.root);
    const preview = open.preview();
    const starting = preview.start();

    await until(() => preview.status().state === "installing" && site.installs() === 1, 60_000);
    site.elsewhere({ [PAGE]: "---\ntitle: Theirs\n---\nHello\n" }, "Their title");
    const head = sh(site.root, "rev-parse", "HEAD");

    // The editor's own round: skipped like a save in progress, with nothing touched.
    expect((await open.gitStatus()).behind).toBe(0);
    expect(await open.catchUp()).toBeNull();
    // It looked all the same, so what the app says is waiting is true while the install goes on.
    expect(await open.gitStatus()).toMatchObject({ behind: 1, checkedAt: expect.any(String) });
    // A person: told why, and what to do.
    const refused = await open.pull().catch((error: unknown) => error);

    expect(refused).toMatchObject({ code: "busy", status: 409, message: expect.stringMatching(/still installing the site's dependencies\. Get the latest versions once it has finished\.$/) });
    expect(preview.status().state).toBe("installing");
    expect(sh(site.root, "rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(join(site.root, PAGE), "utf8")).toContain("title: Home");

    site.letThrough();
    expect((await starting).state).toBe("ready");
    expect(site.installs()).toBe(1);
    expect(site.starts()).toBe(1);
    // The install got through, so the next round brings the version in and the preview starts again without installing.
    expect(await open.catchUp()).toMatchObject({ brought: 1, paths: [PAGE] });
    await until(() => preview.status().state === "ready" && site.starts() === 2, 60_000);
    expect(site.installs()).toBe(1);
    expect(await shown(preview.status().url!)).toEqual({ title: "Theirs" });
  });

  it.skipIf(!posix)("a preview stopped while it was installing installs again at the next start, though the packages folder is there", async () => {
    const site = siteWithInstall();
    const { site: open } = await openSite(site.root);
    const preview = open.preview();

    void preview.start();
    await until(() => preview.status().state === "installing" && site.installs() === 1, 60_000);
    expect(existsSync(join(site.root, "node_modules"))).toBe(true);
    const stopping = preview.stop();

    site.letThrough();
    await stopping;
    expect(preview.status().state).toBe("stopped");
    expect(site.starts()).toBe(0);
    expect((await preview.start()).state).toBe("ready");
    expect(site.installs()).toBe(2);
    // That install got through: a plain restart doesn't install a third time.
    expect((await preview.restart()).state).toBe("ready");
    expect(site.installs()).toBe(2);
  });

  it.skipIf(!posix)("a start asked for while the files are changing waits until they are in, and is the one start that follows", async () => {
    const site = astroSite();
    const { site: open, of } = await openSite(site.root);
    const preview = open.preview();

    expect((await preview.start()).state).toBe("ready");
    expect(site.starts()).toBe(1);
    const hold = holdBringIn(site.root);

    site.elsewhere({ [GATE]: "held here\n", [PAGE]: "---\ntitle: Home\nalign: center\n---\nHello\n", [SCHEMA]: JSON.stringify({ fields: ["title", "align"] }) }, "Centre the home page");
    const pulling = open.pull();

    // The files are part-way changed and the bring-in isn't over: the preview reads "stopped", and a person presses Start.
    await until(() => hold.reached(), 60_000);
    expect(preview.status().state).toBe("stopped");
    const asked = preview.start();

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(site.starts()).toBe(1);
    expect(preview.status()).toMatchObject({ state: "starting", detail: HELD_DETAIL, url: null });
    expect(HELD_DETAIL).not.toMatch(/merge|branch|fetch|commit|pull/i);

    hold.letThrough();
    expect(await pulling).toMatchObject({ behind: 0, lastCommit: { message: "Centre the home page" } });
    expect((await asked).state).toBe("ready");
    await until(() => preview.status().state === "ready" && site.starts() === 2, 60_000);
    // Started on the new versions with nothing kept from the old ones, and only once.
    expect(await shown(preview.status().url!)).toEqual({ title: "Home", align: "center" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(site.starts()).toBe(2);
    expect(of("preview.status").filter((event) => event.status.state === "ready")).toHaveLength(2);
  });
});

describe("forgetting what the preview saved", () => {
  it("removes exactly the adapter's files — never a folder, never through a link out of the site", async () => {
    const root = tempDir("site-saves-");
    const outside = tempDir("site-saves-outside-");

    writeTree(root, {
      ".astro/data-store.json": "{}",
      ".astro/settings.json": "{}",
      "node_modules/.astro/data-store.json": "{}",
      "node_modules/.astro/other.json": "{}",
      "node_modules/astro/package.json": "{}",
    });
    const saves = await astroAdapter.forgetPreviewSaves();

    expect(saves).toEqual([".astro/data-store.json", "node_modules/.astro/data-store.json"]);
    expect(await forgetPreviewSaves(root, saves)).toEqual(saves);
    expect(existsSync(join(root, ".astro/data-store.json"))).toBe(false);
    expect(existsSync(join(root, "node_modules/.astro/data-store.json"))).toBe(false);
    for (const kept of [".astro/settings.json", "node_modules/.astro/other.json", "node_modules/astro/package.json"]) expect(existsSync(join(root, kept))).toBe(true);
    // Missing files, folders, unsafe paths and a store reached through a link to another folder are left alone.
    writeTree(outside, { ".astro/data-store.json": "{}" });
    const linked = tempDir("site-saves-linked-");

    symlinkSync(join(outside, ".astro"), join(linked, ".astro"), "dir");
    expect(await forgetPreviewSaves(linked, [".astro/data-store.json", "../outside.json", "/etc/hosts", ".astro"])).toEqual([]);
    expect(existsSync(join(outside, ".astro/data-store.json"))).toBe(true);
    expect(await forgetPreviewSaves(root, saves)).toEqual([]);
  });
});
