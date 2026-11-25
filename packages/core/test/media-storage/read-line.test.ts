/**
 * The line for reading stored files through the server: a few at once for a
 * site, the rest in order, a refusal only when the line is full, and a place
 * given up by a request nobody is waiting for any more.
 */
import { describe, expect, it } from "vitest";
import { createReadLine } from "../../src/media-storage/read-line";

/** A piece of work the test finishes when it chooses. */
function held<T>(value: T) {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  let started = false;
  const gate = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });

  return {
    work: async () => {
      started = true;
      await gate;
      return value;
    },
    finish,
    fail,
    get started() {
      return started;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the line for reading stored files", () => {
  it("runs a few at once and the rest in the order they came, each with its own answer", async () => {
    const line = createReadLine(4, 100);
    const order: number[] = [];
    let running = 0;
    let most = 0;
    const reads = Array.from({ length: 30 }, (_, index) =>
      line.run("site", async () => {
        order.push(index);
        most = Math.max(most, (running += 1));
        await new Promise((resolve) => setTimeout(resolve, index % 3));
        running -= 1;
        return `file ${index}`;
      })
    );

    expect(line.size("site")).toEqual({ running: 4, waiting: 26 });
    expect(await Promise.all(reads)).toEqual(Array.from({ length: 30 }, (_, index) => `file ${index}`));
    expect(most).toBe(4);
    expect(order).toEqual(Array.from({ length: 30 }, (_, index) => index));
    expect(line.size("site")).toEqual({ running: 0, waiting: 0 });
  });

  it("refuses a read only when the line is full, and takes one again once it has moved", async () => {
    const line = createReadLine(2, 3);
    const jobs = Array.from({ length: 5 }, (_, index) => held(index));
    const reads = jobs.map((job) => line.run("site", job.work));

    await expect(line.run("site", async () => "one too many")).rejects.toMatchObject({ code: "busy", message: "Too many stored files are being shown at once. Try again in a moment." });
    expect(line.size("site")).toEqual({ running: 2, waiting: 3 });
    jobs[0]!.finish();
    await reads[0];
    const late = line.run("site", async () => "taken");

    for (const job of jobs) job.finish();
    expect(await Promise.all(reads)).toEqual([0, 1, 2, 3, 4]);
    expect(await late).toBe("taken");
  });

  it("gives the place of a read that failed to the next in line", async () => {
    const line = createReadLine(1, 10);
    const first = held("first");
    const failing = line.run("site", first.work);
    const next = line.run("site", async () => "next");

    first.fail(new Error("the store didn't answer"));
    await expect(failing).rejects.toThrow("the store didn't answer");
    expect(await next).toBe("next");
    expect(line.size("site")).toEqual({ running: 0, waiting: 0 });
  });

  it("lets a waiting read go when its request is given up, without running it or losing anyone's turn", async () => {
    const line = createReadLine(1, 10);
    const first = held("first");
    const second = held("second");
    const third = held("third");
    const leaving = new AbortController();
    const reads = [line.run("site", first.work), line.run("site", second.work, leaving.signal), line.run("site", third.work)];

    leaving.abort();
    await expect(reads[1]).rejects.toMatchObject({ code: "busy" });
    expect(line.size("site")).toEqual({ running: 1, waiting: 1 });
    first.finish();
    await reads[0];
    await settle();
    expect(second.started).toBe(false);
    expect(third.started).toBe(true);
    third.finish();
    expect(await reads[2]).toBe("third");
    // Given up before it arrived: it never takes a place.
    await expect(line.run("site", async () => "never", leaving.signal)).rejects.toMatchObject({ code: "busy" });
    // Given up once it is running: the read finishes and frees its place as usual.
    const running = new AbortController();
    const fourth = held("fourth");
    const read = line.run("site", fourth.work, running.signal);

    await settle();
    running.abort();
    fourth.finish();
    expect(await read).toBe("fourth");
    expect(line.size("site")).toEqual({ running: 0, waiting: 0 });
  });

  it("keeps a line for each site", async () => {
    const line = createReadLine(1, 0);
    const busy = held("a");
    const first = line.run("one", busy.work);

    await expect(line.run("one", async () => "b")).rejects.toMatchObject({ code: "busy" });
    expect(await line.run("two", async () => "c")).toBe("c");
    busy.finish();
    expect(await first).toBe("a");
  });
});
