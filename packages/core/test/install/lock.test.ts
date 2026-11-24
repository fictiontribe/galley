/**
 * A server's hold on its data folder, against real folders. The beat and the
 * watch are shortened so a test takes milliseconds; nothing else is faked.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { holdDataFolder, lockFile, serverHolding, type DataFolderHold, type ServerLock } from "../../src/install/lock";
import { tempDir } from "./helpers";

const BEAT = 25;
/** This process's own set of process ids, as a hold records it: Linux names it, elsewhere there is one. */
const SPACE = (() => {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return null;
  }
})();
const held: DataFolderHold[] = [];
const children: ChildProcess[] = [];

/** Takes `home` with short beats, remembering the hold so the test lets go of it. */
async function hold(home: string, log: string[] = [], port: number | null = null, onLost?: (by: string) => void): Promise<DataFolderHold> {
  const taken = await holdDataFolder(home, port, { beatMs: BEAT, log: (line) => log.push(line), ...(onLost ? { onLost } : {}) });

  held.push(taken);
  return taken;
}

const read = (home: string): ServerLock => JSON.parse(readFileSync(lockFile(home), "utf8")) as ServerLock;
const write = (home: string, lock: Partial<ServerLock>) => writeFileSync(lockFile(home), `${JSON.stringify({ port: 4400, startedAt: new Date().toISOString(), ...lock })}\n`);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const refusal = (work: Promise<unknown>) => work.then(() => { throw new Error("it was taken"); }, (error: { code?: string; message: string }) => error);

/** A process that is certainly alive and certainly not an editor. */
function sleeper(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });

  children.push(child);
  return child.pid!;
}

/** A process id that answers to nobody: one that has just exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });

  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid!;
}

/** Stands in for a server on another machine: rewrites its hold every beat, as a running one does. */
function beating(home: string, lock: Partial<ServerLock>): () => void {
  let beat = 0;
  const timer = setInterval(() => write(home, { ...lock, beat: (beat += 1) }), BEAT);

  write(home, { ...lock, beat });
  return () => clearInterval(timer);
}

afterEach(async () => {
  while (held.length) await held.pop()!.release();
  while (children.length) children.pop()!.kill("SIGKILL");
});

describe("a server's hold on its data folder", () => {
  it("is written when the folder is taken, says where the server listens, and is gone after it lets go", async () => {
    const home = tempDir("hold-");
    const taken = await hold(home);

    expect(read(home)).toMatchObject({ pid: process.pid, hostname: hostname(), port: null, beat: 0 });
    await taken.setPort(4400);
    expect(read(home).port).toBe(4400);
    await taken.release();
    expect(existsSync(lockFile(home))).toBe(false);
  });

  it("beats while the server runs", async () => {
    const home = tempDir("hold-");

    await hold(home);
    await pause(BEAT * 4);
    expect(read(home).beat).toBeGreaterThanOrEqual(2);
  });

  it("refuses a second server in the same process at once", async () => {
    const home = tempDir("hold-");

    await hold(home);
    const error = await refusal(hold(home));

    expect(error.code).toBe("busy");
    expect(error.message).toBe(`Another editor is running on this data folder (process ${process.pid} on ${hostname()}). Stop it first, or give this one a data folder of its own (GALLEY_HOME).`);
  });

  it("takes over at once a hold whose process is gone, and says so", async () => {
    const home = tempDir("hold-");
    const pid = await deadPid();
    const log: string[] = [];

    write(home, { pid, hostname: hostname(), id: "earlier", beat: 12, space: SPACE });
    await hold(home, log);
    expect(read(home)).toMatchObject({ pid: process.pid, beat: 0 });
    // One line, and no watch before it: a process that is gone here is certain.
    expect(log).toEqual([`The server that last used this data folder (process ${pid} on ${hostname()}, port 4400) didn't stop cleanly and is gone. This server has taken the folder.`]);
  });

  it("refuses when another machine's hold keeps beating", async () => {
    const home = tempDir("hold-");
    const stop = beating(home, { pid: 1, hostname: "another-machine", id: "theirs" });
    const log: string[] = [];

    try {
      const error = await refusal(hold(home, log));

      expect(error.code).toBe("busy");
      expect(error.message).toBe("Another editor is running on this data folder (process 1 on another-machine, port 4400). Stop it first, or give this one a data folder of its own (GALLEY_HOME).");
      expect(log).toEqual(["Another server's hold is on this data folder (process 1 on another-machine, port 4400). Checking whether it is still running: about 1 second."]);
      // Theirs still: nothing of ours was written over it.
      expect(read(home)).toMatchObject({ hostname: "another-machine", id: "theirs" });
    } finally {
      stop();
    }
  });

  it("takes over another machine's hold that has stopped beating, and says so", async () => {
    const home = tempDir("hold-");
    const log: string[] = [];

    write(home, { pid: 1, hostname: "another-machine", id: "theirs", beat: 40 });
    await hold(home, log);
    expect(read(home)).toMatchObject({ pid: process.pid, hostname: hostname(), beat: 0 });
    expect(log.at(-1)).toBe("That server isn't running any more: its hold didn't change. This server has taken the data folder.");
  });

  it("doesn't trust a process id from another set of process ids, even under this hostname", async () => {
    const home = tempDir("hold-");
    const stop = beating(home, { pid: await deadPid(), hostname: hostname(), id: "a-container", space: "pid:[another]" });

    try {
      expect((await refusal(hold(home))).code).toBe("busy");
    } finally {
      stop();
    }
  });

  it("watches a hold whose process id answers here: it refuses while it beats, and takes over when it doesn't", async () => {
    const running = tempDir("hold-");
    const reused = tempDir("hold-");
    const stop = beating(running, { pid: sleeper(), hostname: hostname(), id: "running", space: SPACE });

    try {
      expect((await refusal(hold(running))).code).toBe("busy");
    } finally {
      stop();
    }
    // The id answers, but to another program: the server that wrote this is gone.
    write(reused, { pid: sleeper(), hostname: hostname(), id: "gone", beat: 7, space: SPACE });
    await hold(reused);
    expect(read(reused).pid).toBe(process.pid);
  });

  it("refuses at once, and says how to carry on, when an older version's hold names a process that answers here", async () => {
    const home = tempDir("hold-");
    const pid = sleeper();

    const log: string[] = [];

    write(home, { pid, hostname: hostname() });
    const error = await refusal(hold(home, log));

    // No watch: an older version never refreshes its hold, so there would be nothing to see.
    expect(log).toEqual([]);
    expect(error.message).toBe(
      `Another editor is running on this data folder (process ${pid} on ${hostname()}, port 4400). Stop it first, or give this one a data folder of its own (GALLEY_HOME). If nothing is running there, delete ${lockFile(home)} and start again.`
    );
  });

  it("lets only one of two servers starting together take an empty folder", async () => {
    const home = tempDir("hold-");
    const script = `
      import { holdDataFolder } from ${JSON.stringify(new URL("../../src/install/lock.ts", import.meta.url).href)};
      try {
        await holdDataFolder(${JSON.stringify(home)}, null, { beatMs: ${BEAT} });
        console.log("took");
        // Stays up, as a server does, until the test ends it.
        setInterval(() => {}, 1000);
      } catch (error) {
        console.log("refused: " + error.message);
      }
    `;
    const run = () =>
      new Promise<string>((resolve) => {
        const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
        let out = "";

        children.push(child);
        child.stdout!.on("data", (chunk: Buffer) => {
          out += chunk.toString();
          if (out.includes("\n")) resolve(out.trim());
        });
        child.once("exit", () => resolve(out.trim()));
      });
    const outcomes = await Promise.all([run(), run()]);

    expect(outcomes.filter((line) => line === "took")).toHaveLength(1);
    expect(outcomes.filter((line) => line.startsWith("refused: Another editor is running on this data folder"))).toHaveLength(1);
  }, 30_000);

  it("stops the start with the reason when the hold can't be written", async () => {
    const home = tempDir("hold-");

    chmodSync(home, 0o500);
    try {
      const error = await refusal(hold(home));

      expect(error.code).toBe("unconfigured");
      expect(error.message).toMatch(new RegExp(`^This server can't take its hold on the data folder ${home}, so it won't start: EACCES: .*\\. Check that the folder is there and that the server may write to it\\.$`));
    } finally {
      chmodSync(home, 0o700);
    }
    // Nothing is left behind, and the folder can be taken once it can be written.
    expect(existsSync(lockFile(home))).toBe(false);
    await hold(home);
  });

  it("says once that another server has taken the folder, tells its server once, and stops beating", async () => {
    const home = tempDir("hold-");
    const log: string[] = [];
    const lost: string[] = [];
    const taken = await hold(home, log, null, (by) => lost.push(by));

    write(home, { pid: 1, hostname: "another-machine", id: "theirs", beat: 0 });
    await pause(BEAT * 5);
    expect(log).toEqual(["Another server has taken this data folder (process 1 on another-machine, port 4400) while this one was running."]);
    expect(lost).toEqual([" (process 1 on another-machine, port 4400)"]);
    expect(read(home)).toMatchObject({ id: "theirs", beat: 0 });
    // Letting go leaves the other server's hold where it is.
    await taken.release();
    expect(read(home).id).toBe("theirs");
  });

  it.each([
    ["empty", ""],
    ["cut off half-way", '{"pid":4242,"hostname":"this-machi'],
    ["not a hold at all", "\u0000\u0000\u0000"],
  ])("a hold file that is %s is nobody else's: the server is not told it lost the folder, and its hold goes back", async (_what, damaged) => {
    const home = tempDir("hold-");
    const log: string[] = [];
    const lost: string[] = [];
    const taken = await hold(home, log, 4400, (by) => lost.push(by));
    const id = read(home).id;

    // What a write that failed part-way leaves behind (a full disk, a volume that hiccuped).
    writeFileSync(lockFile(home), damaged);
    await pause(BEAT * 5);
    expect(lost).toEqual([]);
    expect(log.filter((line) => /Another server has taken/.test(line))).toEqual([]);
    // Whole again, and still this server's own.
    expect(read(home)).toMatchObject({ pid: process.pid, id, port: 4400 });
    const beat = read(home).beat!;

    await pause(BEAT * 4);
    expect(read(home).beat!).toBeGreaterThan(beat);
    await taken.release();
    expect(existsSync(lockFile(home))).toBe(false);
  });

  it("is never seen half-written by anyone reading it while the server refreshes it", async () => {
    const home = tempDir("hold-");

    await hold(home);
    const id = read(home).id;
    let reads = 0;

    // Read as often as this process can for a dozen refreshes: always a whole hold, always this server's.
    for (const until = Date.now() + BEAT * 12; Date.now() < until; ) {
      expect(JSON.parse(readFileSync(lockFile(home), "utf8")).id).toBe(id);
      reads += 1;
      if (reads % 50 === 0) await pause(0);
    }
    expect(reads).toBeGreaterThan(100);
  });

  it.skipIf(process.getuid?.() === 0)("a refresh that can't be written is said once and tried again, and is not the folder being lost", async () => {
    const home = tempDir("hold-");
    const log: string[] = [];
    const lost: string[] = [];

    await hold(home, log, null, (by) => lost.push(by));
    const before = read(home);

    // Nothing can be written to the folder for a while.
    chmodSync(home, 0o500);
    try {
      await pause(BEAT * 6);
      expect(lost).toEqual([]);
      expect(log.filter((line) => /couldn't refresh its hold/.test(line))).toHaveLength(1);
      // The hold that was there is untouched: whole, this server's, and no longer changing.
      expect(read(home)).toMatchObject({ id: before.id, pid: process.pid });
    } finally {
      chmodSync(home, 0o700);
    }
    const stuck = read(home).beat!;

    await pause(BEAT * 5);
    // Writable again: it carries on, with nothing more said.
    expect(read(home).beat!).toBeGreaterThan(stuck);
    expect(lost).toEqual([]);
    expect(log.filter((line) => /couldn't refresh its hold/.test(line))).toHaveLength(1);
  });

  it("puts its hold back when the file is removed while it runs", async () => {
    const home = tempDir("hold-");

    await hold(home);
    rmSync(lockFile(home));
    await pause(BEAT * 4);
    expect(read(home).pid).toBe(process.pid);
  });

  it("is what the command line is told: a running server counts, one that is gone doesn't", async () => {
    const home = tempDir("hold-");

    write(home, { pid: sleeper(), hostname: hostname() });
    expect((await serverHolding(home))?.port).toBe(4400);
    write(home, { pid: await deadPid(), hostname: hostname() });
    expect(await serverHolding(home)).toBeNull();
    write(home, { pid: 1, hostname: "another-machine" });
    expect((await serverHolding(home))?.hostname).toBe("another-machine");
  });
});
