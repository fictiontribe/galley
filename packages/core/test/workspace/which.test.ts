import { describe, expect, it } from "vitest";

import { candidateNames } from "../../src/workspace/command";

describe("which file a command name means", () => {
  it("is the name itself everywhere but Windows", () => {
    expect(candidateNames("npm", false, ".COM;.EXE;.BAT;.CMD")).toEqual(["npm"]);
  });

  it("on Windows tries the endings Windows can start first, and the bare name last", () => {
    // npm ships a plain `npm` (a script for other shells) beside npm.cmd: the bare file must not win.
    expect(candidateNames("npm", true, ".COM;.EXE;.BAT;.CMD")).toEqual(["npm.com", "npm.exe", "npm.bat", "npm.cmd", "npm"]);
  });

  it("leaves a name that already has such an ending alone, whatever its case", () => {
    expect(candidateNames("npm.cmd", true, ".COM;.EXE;.BAT;.CMD")).toEqual(["npm.cmd"]);
    expect(candidateNames("Git.EXE", true, ".COM;.EXE;.BAT;.CMD")).toEqual(["Git.EXE"]);
  });

  it("falls back to the usual endings when PATHEXT isn't set", () => {
    expect(candidateNames("node", true, undefined)).toEqual(["node.com", "node.exe", "node.bat", "node.cmd", "node"]);
    expect(candidateNames("node", true, "")).toEqual(["node.com", "node.exe", "node.bat", "node.cmd", "node"]);
  });
});
