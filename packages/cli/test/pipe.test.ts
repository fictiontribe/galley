/**
 * `galley starters | head`: a reader that stops early ends any command
 * quietly with status 0, instead of an unhandled EPIPE.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tolerateClosedPipe } from "../src/io";

const bin = fileURLToPath(new URL("../bin/galley.js", import.meta.url));

describe("output whose reader went away", () => {
  it("exits 0 on a closed pipe and still raises any other error", () => {
    const stream = new EventEmitter();
    const exits: number[] = [];

    tolerateClosedPipe(stream, (code) => void exits.push(code));
    stream.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    expect(exits).toEqual([0]);
    expect(() => stream.emit("error", Object.assign(new Error("no space"), { code: "ENOSPC" }))).toThrow(/no space/);
  });

  it("`galley starters` with its output closed before it writes: no crash, status 0", async () => {
    const child = spawn(process.execPath, [bin, "starters"], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    // The reader is gone before the command prints a line, as with `| head` on a long list.
    child.stdout.destroy();
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

    expect(stderr).not.toMatch(/EPIPE|Unhandled/);
    expect(code).toBe(0);
  }, 90_000);
});
