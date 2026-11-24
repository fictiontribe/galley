/**
 * `galley theme …`: list, check (the app's own check, exit 1 when it would be
 * refused), add (kept adjusted, in the home's themes/), use, export, remove.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Io } from "../src/io";
import { main } from "../src/main";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-cli-theme-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function io(home: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const value: Io & { stdout: string[]; stderr: string[] } = {
    stdout,
    stderr,
    out: (line = "") => stdout.push(line),
    err: (line = "") => stderr.push(line),
    cwd: tmp,
    env: { PATH: process.env.PATH, HOME: tmp, GALLEY_HOME: home },
    startServer: () => {
      throw new Error("not in this test");
    },
    openBrowser: async () => true,
    waitForStop: async () => {},
    watchParent: () => ({ gone: new Promise<void>(() => {}), stop: () => {} }),
  };
  return value;
}

const QUIET_LIGHT = { paper: "#F6F4F0", ink: "#1A1712", pencil: "#2E2BFF", plate: "#1C1915", table: "#E3DBCD" };
const fog = { contract: 1, id: "fog", name: "Fog", light: { ...QUIET_LIGHT, paper: "#CFCBC4", ink: "#6E6A64" }, switches: {} };

describe("galley theme", () => {
  const home = join(tmp, "home");

  it("checks a file the way the app does, and says what it would change", async () => {
    writeFileSync(join(tmp, "fog.json"), JSON.stringify(fog));
    const run = io(home);
    expect(await main(["theme", "check", "fog.json"], run)).toBe(0);
    expect(run.stdout[0]).toBe("✓ Fog can be used.");
    expect(run.stdout.join("\n")).toContain("~ Your paper was too dark for a light theme, so it was lightened from #CFCBC4 to");
  });

  it("refuses with exit 1 what the app would refuse", async () => {
    writeFileSync(join(tmp, "grey.json"), JSON.stringify({ ...fog, id: "grey", light: { ...fog.light, pencil: "#808080" } }));
    writeFileSync(join(tmp, "css.json"), JSON.stringify({ ...fog, id: "css", light: { ...fog.light, paper: "#FFF; background:url(x)" } }));
    writeFileSync(join(tmp, "big.json"), JSON.stringify({ ...fog, description: "x".repeat(20_000) }));
    for (const file of ["grey.json", "css.json", "big.json"]) {
      const run = io(home);
      expect(await main(["theme", "check", file], run), file).toBe(1);
      expect(run.stderr[0]).toBe(`${file} can't be used as a theme:`);
    }
    const run = io(home);
    expect(await main(["theme", "check", "grey.json"], run)).toBe(1);
    expect(run.stderr[1]).toMatch(/✗ Your pencil color \(#808080\) is too close to grey/);
  });

  it("adds a theme for everyone here, kept adjusted, and lists, uses, exports and removes it", async () => {
    const add = io(home);
    expect(await main(["theme", "add", "fog.json"], add)).toBe(0);
    expect(add.stdout[0]).toBe("✓ Added Fog (fog) for everyone who uses Galley here.");
    expect(readdirSync(join(home, "themes"))).toEqual(["fog.json"]);
    expect(JSON.parse(readFileSync(join(home, "themes", "fog.json"), "utf8")).light.paper).not.toBe("#CFCBC4");

    const use = io(home);
    expect(await main(["theme", "use", "fog"], use)).toBe(0);
    const list = io(home);
    expect(await main(["theme", "list", "--json"], list)).toBe(0);
    const listed = JSON.parse(list.stdout.join("\n"));
    expect(listed.default).toBe("fog");
    expect(listed.themes.map((t: { id: string }) => t.id)).toEqual(["quiet", "plate", "desk", "fog"]);

    const exported = io(home);
    expect(await main(["theme", "export", "fog", "--out", "fog-out.json"], exported)).toBe(0);
    const back = io(home);
    expect(await main(["theme", "check", "fog-out.json"], back)).toBe(0);
    // Exported adjusted: checking it again changes no seed.
    expect(back.stdout.join("\n")).not.toMatch(/Your (paper|ink)/);

    expect(await main(["theme", "use", "nope"], io(home))).toBe(1);
    expect(await main(["theme", "remove", "quiet"], io(home))).toBe(1);
    expect(await main(["theme", "remove", "fog"], io(home))).toBe(0);
  });

  it("never crashes on a switch key every object inherits, and prints no escape sequence", async () => {
    const hostileHome = join(tmp, "hostile-home");
    const escapes = "\u001b]0;pwned\u0007\u001b[2J\u001b[31m";
    for (const key of ["constructor", "__proto__", "toString"]) {
      writeFileSync(join(tmp, "odd.json"), `{"contract":1,"id":"odd","name":"Odd","light":${JSON.stringify(QUIET_LIGHT)},"switches":{"${key}":"x"},${JSON.stringify(escapes + escapes)}:1}`);
      const run = io(hostileHome);
      expect(await main(["theme", "check", "odd.json"], run), key).toBe(1);
      expect([...run.stdout, ...run.stderr].join("\n")).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/);
      expect(run.stderr.join("\n")).toContain("The switches have one a theme can’t hold");
    }
    // One such file in the themes folder: the others are listed, and it is named with the reason.
    expect(await main(["theme", "add", "fog.json"], io(hostileHome))).toBe(0);
    mkdirSync(join(hostileHome, "themes"), { recursive: true });
    writeFileSync(join(hostileHome, "themes", "odd.json"), `{"contract":1,"id":"odd","name":"Odd","light":${JSON.stringify(QUIET_LIGHT)},"switches":{"constructor":"x"}}`);
    const list = io(hostileHome);
    expect(await main(["theme", "list"], list)).toBe(0);
    expect(list.stdout.join("\n")).toContain("fog");
    expect(list.stderr.join("\n")).toMatch(/^! odd\.json in the themes folder was left out: /m);
  });

  it("won't add a theme with a built-in's id, and explains its commands", async () => {
    writeFileSync(join(tmp, "plate.json"), JSON.stringify({ ...fog, id: "plate", name: "Mine" }));
    const run = io(home);
    expect(await main(["theme", "add", "plate.json"], run)).toBe(1);
    expect(run.stderr[0]).toContain("has the id of a theme that comes with Galley");
    const help = io(home);
    expect(await main(["theme", "--help"], help)).toBe(0);
    expect(help.stdout[0]).toContain("Usage: galley theme <command>");
    expect(await main(["theme", "paint"], io(home))).toBe(2);
  });
});
