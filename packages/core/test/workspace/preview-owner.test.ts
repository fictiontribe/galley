/**
 * Whose a listening port is, found out without lsof or ps: what a slim Linux
 * container has to go by. Read from a stand-in /proc anywhere, and from the
 * real one on Linux.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { groupFromProc, listenerStartedHere, listenersFromProc } from "../../src/workspace/preview/owner";
import { cleanupAll, tempDir } from "./helpers";

const children: ChildProcess[] = [];

afterAll(() => {
  for (const child of children) child.kill("SIGKILL");
  cleanupAll();
});

/** A /proc with processes 40 (group 40) and 41 (group 40, holding the socket that listens on 4321) and 77 (group 77, listening on 8080 over IPv6). */
function standInProc(): string {
  const proc = tempDir("proc-");
  const row = (local: string, state: string, inode: number) => `   0: ${local} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1 0000000000000000 100 0 0 10 0`;

  mkdirSync(join(proc, "net"), { recursive: true });
  writeFileSync(join(proc, "net/tcp"), ["  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode", row("0100007F:10E1", "0A", 555), row("0100007F:10E1", "01", 556), row("0100007F:9C40", "0A", 600)].join("\n"));
  writeFileSync(join(proc, "net/tcp6"), ["  sl  local_address remote_address st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode", row("00000000000000000000000001000000:1F90", "0A", 700)].join("\n"));
  for (const [pid, group, name, sockets] of [
    [40, 40, "npm run dev", [] as number[]],
    [41, 40, "node (astro) dev", [556, 555]],
    [77, 77, "other", [700]],
  ] as const) {
    mkdirSync(join(proc, String(pid), "fd"), { recursive: true });
    writeFileSync(join(proc, String(pid), "stat"), `${pid} (${name}) S 1 ${group} ${group} 0 -1 4194304 100 0 0 0`);
    symlinkSync("/dev/null", join(proc, String(pid), "fd", "0"));
    sockets.forEach((inode, at) => symlinkSync(`socket:[${inode}]`, join(proc, String(pid), "fd", String(3 + at))));
  }
  return proc;
}

describe("whose a port is, from /proc alone", () => {
  it("finds the processes holding the socket that listens on a port, and a process's group", async () => {
    const proc = standInProc();

    expect(await listenersFromProc(4321, proc)).toEqual({ pids: [41], unseen: false });
    expect(await listenersFromProc(8080, proc)).toEqual({ pids: [77], unseen: false });
    // Nothing listens there (a connection from that port is no listener).
    expect(await listenersFromProc(4322, proc)).toEqual({ pids: [], unseen: false });
    // Something listens, held by nobody this process may look into.
    expect(await listenersFromProc(40000, proc)).toEqual({ pids: [], unseen: true });
    expect(await listenersFromProc(4321, join(proc, "nowhere"))).toBeNull();
    expect(await groupFromProc(41, proc)).toBe(40);
    expect(await groupFromProc(77, proc)).toBe(77);
    expect(await groupFromProc(999, proc)).toBeNull();
  });

  it.runIf(process.platform === "linux")("on Linux, says the same of a real dev server started in a group of its own", async () => {
    const child = spawn(process.execPath, ["-e", 'require("http").createServer((q, r) => r.end("ok")).listen(0, "127.0.0.1", function () { console.log(this.address().port); })'], { detached: true, stdio: ["ignore", "pipe", "ignore"] });

    children.push(child);
    const port = await new Promise<number>((resolve) => child.stdout!.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().trim()))));

    expect(await listenersFromProc(port)).toEqual({ pids: [child.pid], unseen: false });
    expect(await groupFromProc(child.pid!)).toBe(child.pid);
    expect(await listenerStartedHere(port, child.pid!, tempDir("elsewhere-"))).toBe("own");
    // A listener of this process's own is not that dev server's.
    const mine = net.createServer();

    await new Promise<void>((done) => mine.listen(0, "127.0.0.1", done));
    try {
      const minePort = (mine.address() as net.AddressInfo).port;

      expect((await listenersFromProc(minePort))?.pids).toContain(process.pid);
      expect(await listenerStartedHere(minePort, child.pid!, tempDir("elsewhere-"))).toBe("foreign");
    } finally {
      await new Promise((done) => mine.close(done));
    }
  });
});
