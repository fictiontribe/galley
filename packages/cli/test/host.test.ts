/**
 * `galley host` against the strict fake hosts and a fake install: the plan
 * and its cost always first, nothing created on --dry-run or without a yes,
 * the whole life on Fly.io and on a server of one's own, the recipe for an
 * operator, and no key ever printed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { startFakeCloudflareHosting, type FakeCloudflareHosting } from "../../core/test/hosting/fakes/cloudflare";
import { startFakeFly, type FakeFly } from "../../core/test/hosting/fakes/fly";
import { startFakeGcp } from "../../core/test/hosting/fakes/gcp";
import { startFakeInstall, type FakeInstall } from "../../core/test/hosting/fakes/install";
import type { HostIo } from "../src/commands/host";
import { main } from "../src/main";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-cli-host-")));
const gitConfig = join(tmp, "gitconfig");

writeFileSync(gitConfig, "[user]\n\tname = Test Editor\n\temail = editor@example.com\n[init]\n\tdefaultBranch = main\n");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let fly: FakeFly | null = null;
let cf: FakeCloudflareHosting | null = null;
let install: FakeInstall | null = null;

afterEach(async () => {
  await fly?.close();
  await cf?.close();
  await install?.close();
  fly = cf = install = null;
});

let count = 0;

function makeSite(): string {
  const root = join(tmp, `site-${(count += 1)}`);
  const files: Record<string, string> = {
    "galley.config.json": `{ "name": "Corner Bakery", "urls": { "production": "https://www.example.com" } }\n`,
    "content/home.md": "---\ntitle: Home\n---\nFresh bread.\n",
  };

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" }, stdio: "pipe" });

  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "First version");
  git("remote", "add", "origin", "git@github.com:example/bakery.git");
  return root;
}

/** The setup code's hash this computer gave the install, read from its record. */
function recordedHash(home: string): string | null {
  const state = join(home, "state");

  if (!existsSync(state)) return null;
  for (const site of readdirSync(state)) {
    const path = join(state, site, "editor.json");

    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")).environment?.GALLEY_SETUP_TOKEN_SHA256 ?? null;
  }
  return null;
}

async function rig(extra: Record<string, string> = {}) {
  fly = await startFakeFly();
  cf = await startFakeCloudflareHosting();
  const home = join(tmp, `home-${count + 1}`);

  install = await startFakeInstall({ editor: "cms.example.com", hash: () => recordedHash(home) });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: HostIo & { stdout: string[]; stderr: string[] } = {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: tmp,
      GALLEY_HOME: home,
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      FLY_API_TOKEN: fly.token,
      CLOUDFLARE_API_TOKEN: cf.token,
      GALLEY_HOSTING_FLY_API: fly.url,
      GALLEY_HOSTING_CLOUDFLARE_API: cf.api,
      GALLEY_HOSTING_INSTALL_API: install.url,
      ...extra,
    },
    startServer: () => {
      throw new Error("not used");
    },
    openBrowser: async () => true,
    waitForStop: async () => {},
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
  };

  return { io, home, root: makeSite() };
}

function expectNoKeys(io: { stdout: string[]; stderr: string[] }): void {
  const text = [...io.stdout, ...io.stderr].join("\n");

  for (const key of [fly?.token, cf?.token]) for (const part of (key ?? "").split(/[\s,]+/).filter((piece) => piece.length >= 8)) expect(text).not.toContain(part);
}

describe("galley host", () => {
  it("prints its help, and is listed in the main help", async () => {
    const { io } = await rig();

    expect(await main(["host", "--help"], io)).toBe(0);
    expect(io.stdout.join("\n")).toContain("before anything is\ncreated");
    expect(await main(["--help"], io)).toBe(0);
    expect(io.stdout.join("\n")).toContain("galley host [path]");
  });

  it("--dry-run prints the plan and the monthly cost, and creates nothing", async () => {
    const { io, root } = await rig();

    expect(await main(["host", root, "--host", "fly", "--address", "cms.example.com", "--dry-run"], io)).toBe(0);
    const text = io.stdout.join("\n");

    expect(text).toContain("Fly.io: the editor “corner-bakery-editor” in personal");
    expect(text).toContain("Preview:         https://cms-preview.example.com");
    expect(text).toContain("Costs about $13.24 a month:");
    expect(text).toContain("  - machine “corner-bakery-editor”: 1 shared CPU, 2 GB memory, in Ashburn, Virginia (US); sleeps while nobody is using it");
    expect(text).toContain("  - Repository: git@github.com:example/bakery.git");
    expect(io.stderr).toContain("Nothing was created (--dry-run).");
    expect(fly!.writes()).toEqual([]);
    expect(cf!.writes()).toEqual([]);
    expectNoKeys(io);
  });

  it("asks before creating, and never asks without a terminal", async () => {
    const { io, root } = await rig();

    expect(await main(["host", root, "--host", "fly", "--address", "cms.example.com"], io)).toBe(2);
    expect(io.stderr.at(-1)).toBe("Nothing was created. Add --yes to create it without asking, or run on a terminal.");
    expect(io.stdout.join("\n")).toContain("Costs about $13.24 a month");
    expect(fly!.writes()).toEqual([]);
    const asked: string[] = [];

    io.prompt = async (question) => {
      asked.push(question);
      return question.startsWith("Choose") ? "" : "n";
    };
    expect(await main(["host", root, "--host", "fly", "--address", "cms.example.com", "--name", "bakery-editor"], io)).toBe(0);
    // Where it runs (the first, Ashburn), then the yes — the only questions left once the flags say the rest.
    expect(asked).toEqual(["Choose 1–17 [1]: ", "\nCreate all of this on Fly.io, for about $13.24 a month? [y/N] "]);
    expect(io.stderr.at(-1)).toBe("Nothing was created.");
    expect(fly!.writes()).toEqual([]);
  });

  it("on Google Cloud: the plan and its cost with the key from the environment, or the key file pasted line by line", async () => {
    const google = await startFakeGcp();

    try {
      const apis = { GALLEY_HOSTING_GCP_COMPUTE_API: google.apis["gcp-compute"], GALLEY_HOSTING_GCP_OAUTH_API: google.apis["gcp-oauth"], GALLEY_HOSTING_GCP_RESOURCE_MANAGER_API: google.apis["gcp-resource-manager"] };
      const { io, root, home } = await rig({ ...apis, GOOGLE_APPLICATION_CREDENTIALS_JSON: google.key.json });

      expect(await main(["host", root, "--host", "gcp", "--region", "europe-west1", "--address", "cms.example.com", "--dry-run"], io)).toBe(0);
      const text = io.stdout.join("\n");

      expect(text).toContain("Google Cloud: the editor “corner-bakery-editor” in example-project");
      expect(text).toContain("Costs about $17.88 a month:");
      expect(text).toContain("  - machine “corner-bakery-editor”: A virtual machine with 2 GB of memory (e2-small), Ubuntu 24.04, in Belgium (europe-west1)");
      expect(text).toContain("  - firewall-rule “corner-bakery-editor-web”: Lets the web in on ports 80 and 443");
      expect(google.writes()).toEqual([]);
      // No key in the environment: the file is pasted, and a terminal hands it over one line at a time.
      const pasted = google.key.json.split("\n");
      const asked: string[] = [];
      const second = await rig({ ...apis, GOOGLE_APPLICATION_CREDENTIALS_JSON: "" });

      second.io.prompt = async (question) => {
        asked.push(question);
        return question.startsWith("Choose") ? "" : (pasted.shift() ?? "");
      };
      expect(await main(["host", second.root, "--host", "gcp", "--name", "bakery-editor", "--address", "cms.example.com", "--dry-run"], second.io)).toBe(0);
      expect(asked[0]).toBe("Paste the key file from Google Cloud (a service account's JSON key), or type the path to it: ");
      expect(asked.at(-1)).toBe("Choose 1–3 [1]: ");
      expect(JSON.parse(JSON.parse(readFileSync(join(second.home, "secrets.json"), "utf8")).gcp).private_key_id).toBe(google.key.privateKeyId);
      expect(second.io.stdout.join("\n")).toContain("in Iowa (us-central1)");
      const pem = JSON.parse(google.key.json).private_key as string;

      for (const output of [io, second.io]) {
        const all = [...output.stdout, ...output.stderr].join("\n");

        for (const line of pem.split("\n").filter((entry) => entry.length >= 16)) expect(all).not.toContain(line);
        expect(all).not.toContain("ya29.");
      }
      void home;
    } finally {
      await google.close();
    }
  });

  it("says which key is missing and where it is read from", async () => {
    const { io, root } = await rig({ FLY_API_TOKEN: "" });

    expect(await main(["host", root, "--host", "fly", "--address", "cms.example.com", "--yes"], io)).toBe(2);
    expect(io.stderr.at(-1)).toContain("No Fly.io access key. Set FLY_API_TOKEN");
  });

  it("the whole life on Fly.io: create with --yes, the first-run link, status, upgrade, backup, remove", async () => {
    const { io, root } = await rig();

    expect(await main(["host", root, "--host", "fly", "--address", "cms.example.com", "--region", "fra", "--option", "memory=1024", "--yes"], io)).toBe(0);
    expect(io.stdout).toContain("✓ The editor is online at https://cms.example.com");
    expect(io.stdout.find((line) => line.includes("/setup?token="))).toMatch(/https:\/\/cms\.example\.com\/setup\?token=[A-Za-z0-9_-]{43}/);
    expect(io.stderr).toEqual(expect.arrayContaining(["Creating the app on Fly.io…", "Handing the site over…"]));
    const app = fly!.apps.get("corner-bakery-editor")!;

    expect([...app.machines.values()][0]!.config.guest.memory_mb).toBe(1024);
    expect([...app.volumes.values()][0]!.region).toBe("fra");
    expect(install!.handovers).toEqual([{ site: { repository: "git@github.com:example/bakery.git", branch: "main", access: "deploy-key" }, author: { name: "Test Editor", email: "editor@example.com" }, liveUrl: "https://www.example.com" }]);
    expect(JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8")).editor).toEqual({ url: "https://cms.example.com", host: "fly" });
    io.stdout.length = 0;
    expect(await main(["host", "status", root, "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdout[0]!)).toMatchObject({ ok: true, health: "setup", config: { url: "https://cms.example.com" }, record: { host: "fly" } });
    io.stdout.length = 0;
    expect(await main(["host", "link", root], io)).toBe(0);
    expect(io.stdout[0]).toMatch(/^https:\/\/cms\.example\.com\/setup\?token=/);
    io.stdout.length = 0;
    expect(await main(["host", "backup", root], io)).toBe(0);
    expect(io.stdout[0]).toContain("Fly.io is copying the editor's disk now.");
    io.env.GALLEY_HOSTING_IMAGE = "ghcr.io/example/editor:2.0.0";
    expect(await main(["host", "upgrade", root], io)).toBe(0);
    expect([...app.machines.values()][0]!.config.image).toBe("ghcr.io/example/editor:2.0.0");
    io.stdout.length = 0;
    expect(await main(["host", "remove", root], io)).toBe(2);
    expect(io.stdout[0]).toBe("Deletes:");
    expect(io.stdout).toContain("  - app “corner-bakery-editor” (" + app.id + ")");
    expect(fly!.apps.has("corner-bakery-editor")).toBe(true);
    expect(await main(["host", "remove", root, "--yes"], io)).toBe(0);
    expect(io.stdout.at(-1)).toBe("✓ Removed.");
    expect(fly!.apps.size).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8")).editor).toBeUndefined();
    expectNoKeys(io);
  });

  it("on a server of one's own: writes the files, then check hands the site over", async () => {
    const { io, root, home } = await rig();
    const out = join(tmp, `files-${count}`);

    install!.up = false;
    expect(await main(["host", root, "--host", "own-server", "--address", "cms.example.com", "--out", out, "--yes", "--json"], io)).toBe(0);
    const result = JSON.parse(io.stdout.at(-1)!);

    expect(result).toMatchObject({ ok: true, url: "https://cms.example.com", files: out });
    expect(result.pending.map((step: { title: string }) => step.title)).toEqual(["Point the three addresses at the server", "Copy the files to the server", "Start it", "Then come back and choose Check"]);
    expect(readdirSync(out).sort()).toEqual([".env", "Caddyfile", "compose.yaml"]);
    expect(readFileSync(join(out, ".env"), "utf8")).toContain(`GALLEY_SETUP_TOKEN_SHA256=${recordedHash(home)}`);
    expect(readFileSync(join(out, "compose.yaml"), "utf8")).toContain("    read_only: true\n");
    install!.up = true;
    io.stdout.length = 0;
    expect(await main(["host", "check", root], io)).toBe(0);
    expect(io.stdout[0]).toBe("Editor: https://cms.example.com (own-server) — answering, waiting for its first run");
    expect(install!.handovers).toHaveLength(1);
  });

  it("recipe: the files for an operator, printed or written, with no site and no account", async () => {
    const { io } = await rig({ FLY_API_TOKEN: "", CLOUDFLARE_API_TOKEN: "" });

    expect(await main(["host", "recipe", "--name", "acme-editor", "--address", "cms.example.com", "--repository", "git@github.com:example/monorepo.git", "--folder", "apps/site/"], io)).toBe(0);
    const printed = io.stdout.join("\n");

    expect(printed).toContain("# ── compose.yaml");
    expect(printed).toContain("# ── Caddyfile");
    expect(printed).toContain("GALLEY_SITE_FOLDER=apps/site");
    const out = join(tmp, "recipe-out");

    expect(await main(["host", "recipe", "--name", "acme-editor", "--address", "cms.example.com", "--proxy", "tunnel", "--image", "registry.example.com/editor:3", "--setup-token-sha256", "B".repeat(64), "--out", out], io)).toBe(0);
    expect(readdirSync(out).sort()).toEqual([".env", "compose.yaml", "tunnel.env"]);
    expect(statSync(join(out, "tunnel.env")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(out, ".env"), "utf8")).toContain(`GALLEY_SETUP_TOKEN_SHA256=${"b".repeat(64)}`);
    expect(readFileSync(join(out, "compose.yaml"), "utf8")).toContain('    image: "registry.example.com/editor:3"\n');
    expect(await main(["host", "recipe", "--name", "acme-editor", "--address", "https://cms.example.com"], io)).toBe(2);
    expect(io.stderr.at(-1)).toContain("--address: The editor's address should be just the name");
    expect(await main(["host", "recipe", "--name", "acme-editor", "--address", "cms.example.com", "--proxy", "nginx"], io)).toBe(2);
    expect(await main(["host", "recipe", "--name", "acme-editor", "--address", "cms.example.com", "--setup-token-sha256", "abc"], io)).toBe(2);
    expect(await main(["host", "recipe", "--name", "acme-editor", "--address", "cms.example.com", "--folder", "apps/site"], io)).toBe(2);
  });

  it("recipe: the preview's and live comparison's addresses given, for an address whose worked-out names would be someone else's", async () => {
    const { io } = await rig({ FLY_API_TOKEN: "", CLOUDFLARE_API_TOKEN: "" });
    const out = join(tmp, "recipe-addresses");

    expect(await main(["host", "recipe", "--name", "acme-editor", "--address", "cms.example.co.uk", "--preview-address", "Preview.Example.co.uk", "--live-address", "live.example.co.uk", "--out", out], io)).toBe(0);
    const env = readFileSync(join(out, ".env"), "utf8");

    expect(env).toContain("GALLEY_PUBLIC_URL=https://cms.example.co.uk\n");
    expect(env).toContain("GALLEY_PREVIEW_URL=https://preview.example.co.uk\n");
    expect(env).toContain("GALLEY_LIVE_VIEW_URL=https://live.example.co.uk\n");
    expect(readFileSync(join(out, "Caddyfile"), "utf8")).toContain("cms.example.co.uk, preview.example.co.uk, live.example.co.uk {");
    // Not given: worked out from the editor's address, as before.
    io.stdout.length = 0;
    expect(await main(["host", "recipe", "--name", "acme-editor", "--address", "cms.example.com", "--live-address", "live.example.com"], io)).toBe(0);
    expect(io.stdout.join("\n")).toContain("GALLEY_PREVIEW_URL=https://cms-preview.example.com\nGALLEY_LIVE_VIEW_URL=https://live.example.com\n");
    // Checked like the editor's address.
    for (const [option, value, said] of [
      ["--preview-address", "https://preview.example.co.uk", "--preview-address: The preview's address should be just the name"],
      ["--live-address", "live.example.co.uk:8443", "--live-address: The live comparison's address should be just the name, without a port"],
      ["--live-address", "cms.example.co.uk", "The editor, the preview and the live comparison each need an address of their own."],
    ] as const) {
      const preview = option === "--preview-address" ? value : "preview.example.co.uk";
      const live = option === "--live-address" ? value : "live.example.co.uk";

      expect(await main(["host", "recipe", "--name", "acme-editor", "--address", "cms.example.co.uk", "--preview-address", preview, "--live-address", live], io)).toBe(2);
      expect(io.stderr.at(-1)).toContain(said);
    }
  });

  it("galley host: the preview's and live comparison's addresses go into the plan and the files", async () => {
    const { io, root } = await rig();
    const out = join(tmp, `files-addresses-${count}`);

    install!.up = false;
    expect(await main(["host", root, "--host", "own-server", "--address", "cms.example.co.uk", "--preview-address", "preview.example.co.uk", "--live-address", "live.example.co.uk", "--dry-run"], io)).toBe(0);
    expect(io.stdout.join("\n")).toContain("  Preview:         https://preview.example.co.uk\n  Live comparison: https://live.example.co.uk");
    expect(await main(["host", root, "--host", "own-server", "--address", "cms.example.co.uk", "--preview-address", "preview.example.co.uk", "--live-address", "live.example.co.uk", "--out", out, "--yes", "--json"], io)).toBe(0);
    expect(readFileSync(join(out, ".env"), "utf8")).toContain("GALLEY_PREVIEW_URL=https://preview.example.co.uk\nGALLEY_LIVE_VIEW_URL=https://live.example.co.uk\n");
    expect(await main(["host", root, "--host", "own-server", "--address", "cms.example.co.uk", "--preview-address", "preview.example.co.uk/x", "--dry-run"], io)).toBe(2);
    expect(io.stderr.at(-1)).toContain("--preview-address: The preview's address should be just the name, without a path");
  });
});
