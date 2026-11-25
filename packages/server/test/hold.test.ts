/**
 * One server to a data folder: a hosted server takes its hold on the folder
 * before it reads or changes anything in it, and a start that can't take it
 * stops in plain words. Real servers on real temporary folders; only the
 * hold's interval is shortened.
 */
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { StartupError, startServer } from "../src/server";
import { call, sandbox, startHosted, stopHosted, until } from "./hosted-helpers";

const box = sandbox("hold");
const BEAT = 25;
const lockOf = (home: string) => join(home, "server.lock");
const read = (home: string) => JSON.parse(readFileSync(lockOf(home), "utf8")) as { pid: number; hostname: string; port: number | null; id?: string; beat?: number };
const refused = (work: Promise<unknown>) => work.then(() => { throw new Error("it started"); }, (error: Error) => error);

afterAll(() => box.cleanup(), 60_000);

/** Stands in for a server on another machine that is still running: its hold changes every beat. */
function beating(home: string): () => void {
  let beat = 0;
  const write = () => writeFileSync(lockOf(home), `${JSON.stringify({ pid: 1, hostname: "another-machine", port: 4400, startedAt: new Date().toISOString(), id: "theirs", beat: (beat += 1) })}\n`);
  const timer = setInterval(write, BEAT);

  write();
  return () => clearInterval(timer);
}

describe("a hosted server and its data folder", () => {
  it("holds the folder while it runs, says where it listens, and lets go on a graceful stop", async () => {
    const home = box.folder("home");
    const started = await startHosted(box, home);

    expect(read(home)).toMatchObject({ pid: process.pid, hostname: hostname(), port: started.port });
    await stopHosted(box, started);
    expect(existsSync(lockOf(home))).toBe(false);
    // Let go of, so the next start takes it without a wait or a word.
    const again = await startHosted(box, home);

    expect(again.notices.filter((line) => /data folder/.test(line))).toEqual([]);
    await stopHosted(box, again);
  });

  it("refuses a second server on the same folder, and the first carries on", async () => {
    const home = box.folder("home");
    const first = await startHosted(box, home);
    const error = await refused(startHosted(box, home));

    expect(error).toBeInstanceOf(StartupError);
    expect(error.message).toBe(`Another editor is running on this data folder (process ${process.pid} on ${hostname()}). Stop it first, or give this one a data folder of its own (GALLEY_HOME).`);
    expect((await call(first.port, "GET", "/healthz")).status).toBe(200);
    expect(read(home).port).toBe(first.port);
    await stopHosted(box, first);
  });

  it("refuses while a server on another machine holds the folder, before reading or changing anything in it", async () => {
    const home = box.folder("home");
    const stop = beating(home);

    try {
      const error = await refused(startHosted(box, home, {}, { holdBeatMs: BEAT }));

      expect(error).toBeInstanceOf(StartupError);
      expect(error.message).toBe("Another editor is running on this data folder (process 1 on another-machine, port 4400). Stop it first, or give this one a data folder of its own (GALLEY_HOME).");
      // Not the state file, not the cookie key: only the other server's hold is there.
      expect(readdirSync(home)).toEqual(["server.lock"]);
      expect(read(home).id).toBe("theirs");
    } finally {
      stop();
    }
  });

  it("takes over a hold left by a server on another machine that is gone, and says so", async () => {
    const home = box.folder("home");

    writeFileSync(lockOf(home), `${JSON.stringify({ pid: 1, hostname: "another-machine", port: 4400, startedAt: "2026-01-01T00:00:00.000Z", id: "theirs", beat: 90 })}\n`);
    const started = await startHosted(box, home, {}, { holdBeatMs: BEAT });

    expect(started.notices.filter((line) => /data folder/.test(line))).toEqual([
      "Another server's hold is on this data folder (process 1 on another-machine, port 4400). Checking whether it is still running: about 1 second.",
      "That server isn't running any more: its hold didn't change. This server has taken the data folder.",
    ]);
    expect(read(home)).toMatchObject({ pid: process.pid, hostname: hostname(), port: started.port });
    await stopHosted(box, started);
  });

  it.skipIf(process.getuid?.() === 0)("stops the start with the reason when the hold can't be written", async () => {
    const home = box.folder("home");

    chmodSync(home, 0o500);
    try {
      const error = await refused(startHosted(box, home));

      expect(error).toBeInstanceOf(StartupError);
      expect(error.message).toMatch(new RegExp(`^This server can't take its hold on the data folder ${home}, so it won't start: EACCES: .*\\. Check that the folder is there and that the server may write to it\\.$`));
    } finally {
      chmodSync(home, 0o700);
    }
    expect(readdirSync(home)).toEqual([]);
  });

  it("lets go of the folder when the start fails later, at the port", async () => {
    const home = box.folder("home");
    const taken = createServer();
    const port = await new Promise<number>((resolve) => taken.listen(0, "127.0.0.1", () => resolve((taken.address() as { port: number }).port)));

    try {
      const error = await refused(startServer({ mode: "hosted", host: "127.0.0.1", port, home, webDir: join(box.root, "no-ui"), env: { PATH: process.env.PATH, HOME: box.root, GALLEY_MCP: "off" }, notice: () => undefined, log: () => undefined }));

      expect(error.message).toMatch(/^Port \d+ is already in use/);
      expect(existsSync(lockOf(home))).toBe(false);
    } finally {
      await new Promise((resolve) => taken.close(resolve));
    }
    // Free again: the folder is taken by the next start as if nothing had happened.
    const started = await startHosted(box, home);

    await stopHosted(box, started);
  });

  it("stops serving when another server takes the folder, says why, and writes nothing more to it", async () => {
    const home = box.folder("home");
    const started = await startHosted(box, home, {}, { holdBeatMs: BEAT });
    const stateFile = join(home, "install.json");
    const state = existsSync(stateFile) ? readFileSync(stateFile) : null;

    expect((await call(started.port, "GET", "/api/meta")).status).toBe(200);
    // Another server's hold is in the folder now, and it is running.
    const stop = beating(home);

    await started.server.displaced;
    stop();
    box.running.splice(box.running.indexOf(started.server), 1);
    // It no longer answers anyone.
    await expect(fetch(`http://127.0.0.1:${started.port}/healthz`)).rejects.toThrow();
    // It said what happened, and what to do.
    const said = started.notices.join("\n");

    expect(said).toContain("Another server has taken this data folder (process 1 on another-machine, port 4400) while this one was running.");
    expect(said).toMatch(/This server has stopped: the data folder .+ is another server's now \(process 1 on another-machine, port 4400\), and two servers on one data folder write over each other\. Stop the other one, or give this one a data folder of its own \(GALLEY_HOME\), then start it again\./);
    // The other server's hold is untouched, and so is the state it now keeps.
    expect(read(home).id).toBe("theirs");
    expect(existsSync(stateFile) ? readFileSync(stateFile) : null).toEqual(state);
  });

  it("carries on when its hold file is left empty by a write that didn't finish: that is not another server", async () => {
    const home = box.folder("home");
    const started = await startHosted(box, home, {}, { holdBeatMs: BEAT });
    const id = read(home).id;
    const sawItDamaged = () => started.notices.some((line) => line.includes("the hold file was damaged (a write to it didn't finish). It has been written again."));
    let stopped = false;

    void started.server.displaced!.then(() => (stopped = true));
    // A refresh that had already read the hold writes it whole again over the empty file without ever seeing it empty.
    // So the file is emptied until a refresh has read it that way: the server says so when one does.
    await until(() => {
      if (sawItDamaged() || stopped) return true;
      writeFileSync(lockOf(home), "");
      return false;
    });
    // Its hold is whole again, and its own.
    await until(() => {
      try {
        return stopped || read(home).id === id;
      } catch {
        return false;
      }
    });
    expect(read(home)).toMatchObject({ id, pid: process.pid, port: started.port });
    // It carried on: it wasn't told the folder is another server's, and it still answers.
    expect(stopped).toBe(false);
    expect((await call(started.port, "GET", "/api/meta")).status).toBe(200);
    const said = started.notices.join("\n");

    expect(said).not.toMatch(/Another server has taken|This server has stopped/);
    expect(sawItDamaged()).toBe(true);
    await stopHosted(box, started);
    expect(existsSync(lockOf(home))).toBe(false);
  });

  it("takes no hold in local mode", async () => {
    const home = box.folder("local-home");
    const options = { mode: "local" as const, host: "127.0.0.1", port: 0, home, webDir: join(box.root, "no-ui"), env: { PATH: process.env.PATH, HOME: box.root, GALLEY_MCP: "off" }, notice: () => undefined, log: () => undefined };
    const first = await startServer(options);
    const second = await startServer(options);

    try {
      expect(existsSync(lockOf(home))).toBe(false);
    } finally {
      await first.close({ graceMs: 0 });
      await second.close({ graceMs: 0 });
    }
  });
});
