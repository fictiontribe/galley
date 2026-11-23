import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeSet, ServerEvent } from "@galley/core/types";
import { coalesce } from "../../src/lib/coalesce";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("coalesce", () => {
  it("runs once now and once more for everything asked meanwhile", async () => {
    let runs = 0;
    const run = coalesce(async () => {
      runs++;
      await tick(5);
    });
    const all = Array.from({ length: 50 }, () => run());
    await Promise.all(all);
    expect(runs).toBe(2);
    await run();
    expect(runs).toBe(3);
  });

  it("resolves each caller only after a run that started after its call", async () => {
    let value = 0;
    let seen = -1;
    const run = coalesce(async () => {
      const at = value;
      await tick(5);
      seen = at;
    });
    void run();
    value = 7;
    await run();
    expect(seen).toBe(7);
  });

  it("keeps going after a run fails", async () => {
    let runs = 0;
    const run = coalesce(async () => {
      runs++;
      if (runs === 1) throw new Error("offline");
    });
    await run();
    await run();
    expect(runs).toBe(2);
  });
});

/** A stand-in for the browser's EventSource that the test can push events through. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  close() {}
  emit(event: ServerEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

describe("change events → requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns 200 change events into a handful of requests and ends on the right count", async () => {
    // The server's side: each written file adds one pending change; every answer takes a few ms.
    let pending = 0;
    const calls: string[] = [];
    const changeSet = (): ChangeSet => ({
      files: Array.from({ length: pending }, (_, index) => ({ path: `src/content/posts/p${index}.md`, status: "added", kind: "content", additions: 1, deletions: 0 }) as ChangeSet["files"][number]),
      totals: { files: pending, additions: pending, deletions: 0 },
    }) as ChangeSet;
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        calls.push(url);
        const answer = url.includes("/changes") ? changeSet() : url.endsWith("/api/sites") ? [] : {};
        await tick(8);
        return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    const { startSync } = await import("../../src/lib/sync");
    const { useChanges } = await import("../../src/lib/stores/changes");
    await useChanges.getState().load("site-1");
    startSync();
    await tick(5);
    calls.length = 0;

    // An import: 200 files written, one event each, in quick succession.
    for (let index = 0; index < 200; index++) {
      pending++;
      FakeEventSource.last!.emit({ type: "changes.updated", siteId: "site-1", paths: [`src/content/posts/p${index}.md`], origin: "user" } as ServerEvent);
      if (index % 20 === 0) await tick(1);
    }
    await vi.waitFor(() => expect(useChanges.getState().changes?.totals.files).toBe(200), { timeout: 2000 });
    await tick(50);

    const changeRequests = calls.filter((url) => url.includes("/changes")).length;
    const siteListRequests = calls.filter((url) => url.endsWith("/api/sites")).length;
    expect(changeRequests).toBeGreaterThan(0);
    expect(changeRequests).toBeLessThanOrEqual(6);
    expect(siteListRequests).toBeLessThanOrEqual(6);
    expect(useChanges.getState().changes?.totals.files).toBe(200);
  });
});
