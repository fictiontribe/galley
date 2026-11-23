import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { startFakeCloudflare, type FakeCloudflare } from "../../core/test/deploy/fakes/cloudflare";
import { startFakeVercel, type FakeVercel } from "../../core/test/deploy/fakes/vercel";
import type { DeployIo } from "../src/commands/deploy";
import { main } from "../src/main";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-cli-deploy-")));
const gitConfig = join(tmp, "gitconfig");

writeFileSync(gitConfig, "[user]\n\tname = Test Editor\n\temail = editor@example.com\n[init]\n\tdefaultBranch = main\n");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let cf: FakeCloudflare | null = null;
let vercel: FakeVercel | null = null;

afterEach(async () => {
  await cf?.close();
  await vercel?.close();
  cf = vercel = null;
});

let count = 0;

function makeSite(): string {
  const root = join(tmp, `site-${(count += 1)}`);
  const files: Record<string, string> = {
    "galley.config.json": `{ "name": "Corner Bakery", "build": { "command": "node build.mjs", "outDir": "dist" } }\n`,
    "build.mjs": `import { mkdirSync, writeFileSync, readFileSync } from "node:fs"; mkdirSync("dist/menu", { recursive: true }); writeFileSync("dist/index.html", readFileSync("content/home.md", "utf8")); writeFileSync("dist/menu/index.html", "menu");`,
    ".gitignore": "dist/\n",
    "content/home.md": "---\ntitle: Home\n---\nFresh bread.\n",
    "content/menu.md": "---\ntitle: Menu\n---\nRye.\n",
  };

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" }, stdio: "pipe" });

  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "First version");
  return root;
}

function testIo(env: Record<string, string>, extra: Partial<DeployIo> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: DeployIo & { stdout: string[]; stderr: string[] } = {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    env: { PATH: process.env.PATH ?? "", HOME: tmp, GALLEY_HOME: join(tmp, `home-${count}`), GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1", ...env },
    startServer: () => {
      throw new Error("not used");
    },
    openBrowser: async () => true,
    waitForStop: async () => {},
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
    ...extra,
  };

  return io;
}

describe("galley deploy", () => {
  it("prints its help", async () => {
    const io = testIo({});

    expect(await main(["deploy", "--help"], io)).toBe(0);
    expect(io.stdout.join("\n")).toContain("never unpublished changes");
  });

  it("sets up and deploys without asking when the environment says everything", async () => {
    cf = await startFakeCloudflare();
    const root = makeSite();
    const io = testIo({ CLOUDFLARE_API_TOKEN: cf.token, GALLEY_DEPLOY_CLOUDFLARE_API: cf.api });

    expect(await main(["deploy", root], io)).toBe(0);
    expect(io.stdout).toEqual(["✓ Live at https://corner-bakery.studio.workers.dev"]);
    expect(io.stderr).toEqual(expect.arrayContaining(["Building the published version…", "Uploading 2 files (37 B)…", "Uploading 2 of 2 files…", "Cloudflare is putting it live…"]));
    expect(cf.deployments.at(-1)!.files.get("index.html")!.toString()).toContain("Fresh bread.");
    expect(JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8")).deploy).toEqual({
      target: "cloudflare",
      account: "acc0123456789abcdef0123456789abc",
      project: "corner-bakery",
      productionUrl: "https://corner-bakery.studio.workers.dev",
    });
    expect(io.stderr.join("\n")).not.toContain(cf.token);
  });

  it("--preview --json uploads the unpublished working tree", async () => {
    cf = await startFakeCloudflare();
    const root = makeSite();
    const io = testIo({ CLOUDFLARE_API_TOKEN: cf.token, GALLEY_DEPLOY_CLOUDFLARE_API: cf.api });

    writeFileSync(join(root, "content/home.md"), "---\ntitle: Home\n---\nSourdough today.\n");
    expect(await main(["deploy", root, "--preview", "--json", "--project", "bakery-preview"], io)).toBe(0);
    const result = JSON.parse(io.stdout[0]!);

    expect(result).toMatchObject({ ok: true, kind: "preview", project: "bakery-preview" });
    expect(result.url).toMatch(/^https:\/\/[0-9a-f]{8}-bakery-preview\.studio\.workers\.dev$/);
    expect(cf.deployments.at(-1)!.files.get("index.html")!.toString()).toContain("Sourdough today.");
  });

  it("asks for the key, host and name on a terminal, and stores the key", async () => {
    vercel = await startFakeVercel();
    const root = makeSite();
    const answers = ["2", vercel.token, "", ""];
    const asked: string[] = [];
    const io = testIo({ GALLEY_DEPLOY_VERCEL_API: vercel.url }, {
      prompt: async (question, options) => {
        asked.push(`${question}${options?.secret ? " (hidden)" : ""}`);
        return answers.shift() ?? "";
      },
    });

    expect(await main(["deploy", root], io)).toBe(0);
    expect(asked).toEqual(["Choose 1–2 [1]: ", "Paste the Vercel access key:  (hidden)", "Project name on Vercel [corner-bakery]: "]);
    expect(io.stdout).toEqual(["✓ Live at https://corner-bakery.vercel.app"]);
    expect(readFileSync(join(io.env.GALLEY_HOME!, "secrets.json"), "utf8")).toContain(vercel.token);

    // The second time nothing is asked: the site remembers its host and the key is stored.
    const again = testIo({ GALLEY_DEPLOY_VERCEL_API: vercel.url, GALLEY_HOME: io.env.GALLEY_HOME! }, { prompt: async () => { throw new Error("asked"); } });

    expect(await main(["deploy", root, "--preview"], again)).toBe(0);
    expect(again.stdout[0]).toMatch(/^✓ Preview at https:\/\/corner-bakery-/);
  });

  it("checks a pasted key with the host before storing it", async () => {
    cf = await startFakeCloudflare();
    const root = makeSite();
    const io = testIo({ GALLEY_DEPLOY_CLOUDFLARE_API: cf.api }, { prompt: async (question) => (question.startsWith("Choose") ? "1" : question.startsWith("Paste") ? "cf-wrong-key-0123456789abcdefghijklmn" : "") });

    expect(await main(["deploy", root], io)).toBe(1);
    expect(io.stderr.join("\n")).toContain("Cloudflare didn't accept the access key.");
    expect(existsSync(join(io.env.GALLEY_HOME!, "secrets.json"))).toBe(false);
    expect(cf.deployments).toHaveLength(0);
  });

  it("refuses, without asking, when there's no key and no terminal", async () => {
    const root = makeSite();
    const io = testIo({});

    expect(await main(["deploy", root, "--yes"], io)).toBe(2);
    expect(io.stderr.join("\n")).toContain("No Cloudflare access key. Set CLOUDFLARE_API_TOKEN");
  });

  it("exits 1 with the plain reason when the host refuses", async () => {
    cf = await startFakeCloudflare();
    const root = makeSite();
    const io = testIo({ CLOUDFLARE_API_TOKEN: "wrong-key-0123456789abcdefghijklmnop", GALLEY_DEPLOY_CLOUDFLARE_API: cf.api });

    expect(await main(["deploy", root, "--yes"], io)).toBe(1);
    expect(io.stderr[0]).toBe("! Cloudflare didn't accept the access key. It may have been deleted or have expired. Create a new one and paste it here.");
  });
});
