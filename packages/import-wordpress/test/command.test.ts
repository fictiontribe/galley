import { join } from "node:path";
import { existsSync, rmdirSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importCommand, IMPORT_HELP, type ImportIo } from "../src/command";
import { cacheDirFor } from "../src/source/index";
import { defaultCacheDir } from "../src/source/http";
import type { ImportReport } from "../src/types";
import { startFakeWordPress, type FakeWordPress } from "./fake-wordpress";
import { FIXTURES, git, makeSite, redirectFetch, uploads } from "./helpers";

const WXR = join(FIXTURES, "quillfield.wxr");
let server: FakeWordPress;
const caches: string[] = [];

beforeAll(async () => {
  server = await startFakeWordPress({ files: uploads(), credentials: "ana:very secret words" });
  caches.push(cacheDirFor({ url: server.url })!);
});

afterAll(async () => {
  await server.close();
  // Live imports keep a resume cache in the temp folder; a test leaves none behind.
  for (const dir of caches) rmSync(dir, { recursive: true, force: true });
  try {
    rmdirSync(defaultCacheDir());
  } catch {
    // Not empty: something else is using it.
  }
});

function io(cwd: string, env: NodeJS.ProcessEnv = {}): ImportIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return { stdout, stderr, out: (line = "") => stdout.push(line), err: (line = "") => stderr.push(line), cwd, env, fetch: redirectFetch(server.url) };
}

describe("galley import", () => {
  it("prints help, and refuses what it can't do in plain words", async () => {
    const help = io(process.cwd());

    expect(await importCommand.run(["--help"], help)).toBe(0);
    expect(help.stdout.join("\n")).toBe(IMPORT_HELP);
    const cases: Array<[string[], RegExp]> = [
      [[], /Usage: galley import wordpress/],
      [["joomla", "x"], /can import from WordPress/],
      [["wordpress"], /Say where the WordPress site is/],
      [["wordpress", WXR, "--only", "comments"], /--only takes posts, pages or media/],
      [["wordpress", WXR, "--bogus"], /--bogus isn't an option here/],
      [["wordpress", WXR, "--type", "course"], /--type needs a content type and a collection/],
      [["wordpress", WXR, "--since", "last week"], /--since needs a date/],
      [["wordpress", "https://example.org", "--user", "ana"], /environment variable WORDPRESS_APP_PASSWORD/],
    ];

    for (const [args, message] of cases) {
      const run = io(process.cwd());

      expect(await importCommand.run(args, run)).toBe(2);
      expect([...run.stdout, ...run.stderr].join("\n")).toMatch(message);
    }
  });

  it("--dry-run --json prints the full report and writes nothing", async () => {
    const root = makeSite("cmd-dry");
    const run = io(root);

    expect(await importCommand.run(["wordpress", WXR, "--dry-run", "--json"], run)).toBe(0);
    const report = JSON.parse(run.stdout.join("\n")) as ImportReport;

    expect(report.dryRun).toBe(true);
    expect(report.counts.posts.created).toBe(4);
    expect(report.rebuilds.map((rebuild) => rebuild.title).sort()).toEqual(["Classes", "Commissions"]);
    expect(report.snippets.netlify).toContain("/2024/03/glaze-notes/");
    expect(git(root, "status", "--porcelain", "-uall")).toBe("");
  });

  it("asks instead of guessing, and writes nothing until answered", async () => {
    const root = makeSite("cmd-ask");
    const run = io(root);

    expect(await importCommand.run(["wordpress", WXR, "--pages-into", "nowhere"], run)).toBe(1);
    expect(run.stdout.join("\n")).toMatch(/Questions to answer first[\s\S]*There's no collection called “nowhere”/);
    expect(git(root, "status", "--porcelain", "-uall")).toBe("");
  });

  it("imports into --into, with defaults for required fields", async () => {
    const root = makeSite("cmd-run");
    const run = io(process.cwd());

    expect(await importCommand.run(["wordpress", WXR, "--into", root, "--only", "posts", "--default", "blog.image=/images/share.png"], run)).toBe(0);
    expect(run.stdout.join("\n")).toMatch(/^Import finished/);
    expect(existsSync(join(root, "src/content/blog/bank-holidays.md"))).toBe(true);
    expect(existsSync(join(root, "src/content/pages/classes.md"))).toBe(false);
  });

  it("reads the application password from the environment and never prints it", async () => {
    const root = makeSite("cmd-auth");
    const run = io(root, { WP_PASS: "very secret words" });

    expect(await importCommand.run(["wordpress", server.url, "--user", "ana", "--app-password-env", "WP_PASS", "--dry-run", "--json"], run)).toBe(0);
    const report = JSON.parse(run.stdout.join("\n")) as ImportReport;

    expect(report.items.some((item) => item.title === "Notes for the summer open studio")).toBe(true);
    expect([...run.stdout, ...run.stderr].join("\n")).not.toContain("very secret words");
    const wrong = io(root, { WP_PASS: "wrong but secret" });

    expect(await importCommand.run(["wordpress", server.url, "--user", "ana", "--app-password-env", "WP_PASS", "--fresh"], wrong)).toBe(1);
    expect(wrong.stderr.join("\n")).toMatch(/didn't accept the user name and application password/);
    expect([...wrong.stdout, ...wrong.stderr].join("\n")).not.toContain("wrong but secret");
  });

  it("points at the export file when the API is blocked", async () => {
    const blocked = await startFakeWordPress({ mode: "disabled" });

    caches.push(cacheDirFor({ url: blocked.url })!);
    try {
      const run = io(makeSite("cmd-blocked"));

      expect(await importCommand.run(["wordpress", blocked.url, "--fresh"], run)).toBe(1);
      expect(run.stderr.join("\n")).toMatch(/Tools › Export/);
    } finally {
      await blocked.close();
    }
  });
});
