import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createScheduleService } from "@galley/core/schedules";
import { openSingleSite } from "@galley/server";
import type { Io } from "../src/io";
import { main } from "../src/main";

const starter = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-cli-sched-")));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function testIo(home: string, cwd: string): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd,
    env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: home },
    startServer: () => {
      throw new Error("not used");
    },
    openBrowser: async () => true,
    waitForStop: async () => {},
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
  };
}

describe("galley schedule", () => {
  it("prints help with --help", async () => {
    const io = testIo(join(tmp, "home-help"), tmp);

    expect(await main(["schedule", "--help"], io)).toBe(0);
    expect(io.stdout.join("\n")).toContain("Usage: galley schedule");
    expect(io.stdout.join("\n")).toContain("--run-due");
  });

  it("lists scheduled releases and runs due ones with --run-due --json", async () => {
    const root = join(tmp, "site");
    const home = join(tmp, "home");

    cpSync(starter, root, { recursive: true, filter: (src) => !["node_modules", ".astro", "dist"].includes(basename(src)) });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

    git("init", "-q");
    git("symbolic-ref", "HEAD", "refs/heads/main");
    git("config", "user.name", "CLI Schedule Test");
    git("config", "user.email", "cli-sched@example.invalid");
    git("add", "-A");
    git("commit", "-q", "-m", "Initial");

    // Seed a scheduled release whose time is already in the past relative to real now.
    const target = "src/content/pages/about.md";
    const updatedText = `${readFileSync(join(root, target), "utf8")}\nCLI scheduled release.\n`;

    writeFileSync(join(root, target), updatedText, "utf8");
    const engine = await openSingleSite({ root, home, watch: false });

    try {
      const pastClock = new Date("2020-01-01T00:00:00.000Z");
      const svc = createScheduleService({ home, now: () => pastClock });

      await svc.create(engine.site, {
        message: "CLI release",
        paths: [target],
        scheduledAt: "2020-01-02T00:00:00.000Z",
      });
    } finally {
      await engine.dispose();
    }

    const listIo = testIo(home, tmp);

    expect(await main(["schedule", root, "--list", "--json"], listIo)).toBe(0);
    const listed = JSON.parse(listIo.stdout.join("\n")) as { items: Array<{ state: string; message: string }> };

    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]!.state).toBe("scheduled");

    const runIo = testIo(home, tmp);

    expect(await main(["schedule", root, "--run-due", "--json"], runIo)).toBe(0);
    const ran = JSON.parse(runIo.stdout.join("\n")) as { ran: Array<{ state: string; commit?: string }> };

    expect(ran.ran).toHaveLength(1);
    expect(ran.ran[0]!.state).toBe("published");
    expect(ran.ran[0]!.commit).toBeTruthy();
    expect(readFileSync(join(root, target), "utf8")).toBe(updatedText);
  }, 30_000);
});
