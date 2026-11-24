import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeS3, type FakeS3 } from "../../core/test/media-storage/fakes/s3";
import type { DeployIo } from "../src/commands/deploy";
import { main } from "../src/main";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-cli-media-")));
const gitConfig = join(tmp, "gitconfig");
const KEY = { id: "0123456789abcdef0123456789abcdef", secret: "d".repeat(64) };
let fake: FakeS3;

writeFileSync(gitConfig, "[user]\n\tname = Test Editor\n\temail = editor@example.com\n[init]\n\tdefaultBranch = main\n");
beforeAll(async () => {
  fake = await startFakeS3();
  fake.addBucket("cli-media", { region: "auto" });
  fake.addKey({ id: KEY.id, secret: KEY.secret, buckets: { "cli-media": ["read", "write", "list", "delete"] } });
});
afterAll(async () => {
  await fake.close();
  rmSync(tmp, { recursive: true, force: true });
});

function makeSite(): string {
  const root = join(tmp, "bakery");
  const files: Record<string, string> = {
    "galley.config.json": `{ "name": "Corner Bakery", "media": { "dir": "public/images", "publicPath": "/images" }, "writable": { "content": ["content/**", "public/images/**"] } }\n`,
    "content/home.md": "---\ntitle: Home\nimage: /images/loaf.svg\n---\nFresh bread.\n",
    "public/images/loaf.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
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

function testIo(env: Record<string, string> = {}, extra: Partial<DeployIo> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: DeployIo & { stdout: string[]; stderr: string[] } = {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    env: { PATH: process.env.PATH ?? "", HOME: tmp, GALLEY_HOME: join(tmp, "home"), GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1", ...env },
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

describe("galley media", () => {
  const root = makeSite();
  const connectArgs = () => ["connect", root, "--connector", "r2", "--account", KEY.id, "--bucket", "cli-media", "--endpoint", fake.endpoint, "--public-url", fake.publicUrl("cli-media")];

  it("prints its help, and says where files go", async () => {
    const help = testIo();

    expect(await main(["media", "--help"], help)).toBe(0);
    expect(help.stdout.join("\n")).toContain("never a flag");
    const io = testIo();

    expect(await main(["media", root], io)).toBe(0);
    expect(io.stdout.join("\n")).toContain("kept in the site's repository");
  });

  it("asks for the key with nothing shown, checks for real, then connects", async () => {
    const asked: Array<[string, boolean]> = [];
    const io = testIo({}, {
      prompt: async (question, options) => {
        asked.push([question, Boolean(options?.secret)]);
        return question.startsWith("Access Key ID") ? KEY.id : KEY.secret;
      },
    });

    expect(await main(["media", ...connectArgs()], io)).toBe(0);
    expect(asked).toEqual([
      ["Access Key ID: ", false],
      ["Secret Access Key (not shown): ", true],
    ]);
    expect(io.stderr.join("\n")).toContain("✓ Load it from the public address");
    expect(io.stdout.join("\n")).toContain("✓ Connected.");
    expect([...io.stdout, ...io.stderr].join("\n")).not.toContain(KEY.secret);
    expect(JSON.parse(readFileSync(join(root, "galley.config.json"), "utf8")).media.storage.bucket).toBe("cli-media");
  });

  it("checks again, moves the files with --yes, and disconnects", async () => {
    const check = testIo();

    expect(await main(["media", "check", root], check)).toBe(0);
    const refused = testIo();

    expect(await main(["media", "move", root, "--to", "bucket"], refused)).toBe(2);
    expect(refused.stderr.join("\n")).toContain("--yes");
    const moving = testIo();

    expect(await main(["media", "move", root, "--to", "bucket", "--yes"], moving), [...moving.stdout, ...moving.stderr].join("\n")).toBe(0);
    expect(readFileSync(join(root, "content/home.md"), "utf8")).toContain(`image: ${fake.publicUrl("cli-media")}/loaf.svg`);
    expect(fake.buckets.get("cli-media")!.objects.has("loaf.svg")).toBe(true);
    const json = testIo();

    expect(await main(["media", "status", root, "--json"], json)).toBe(0);
    expect(JSON.parse(json.stdout.join("")).bucket.connected).toBe(true);
    const off = testIo();

    expect(await main(["media", "disconnect", root, "--yes", "--forget-keys"], off)).toBe(0);
    expect(off.stdout.join("\n")).toContain("stay there");
  });

  it("refuses a key given any other way than the environment or the prompt", async () => {
    const io = testIo();

    expect(await main(["media", "connect", root, "--secret", "x"], io)).toBe(2);
  });
});
