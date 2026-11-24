/**
 * A hosted editor keeping up with its repository by itself (keep-up.ts):
 * rounds run by a test's hand instead of a real interval, against real
 * temporary repositories — a bare one as the code host, a clone as someone
 * publishing elsewhere.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NO_CALLER_REFUSAL, requireCallerForGuardedWork } from "@galley/core/install";
import { createEventBus, createSiteService } from "@galley/core/site";
import type { ServerEvent, SiteService } from "@galley/core/types";
import { createKeepUp, SKIPPED_SAID_AFTER_MS, type KeepUpTimer } from "../src/keep-up";
import { StartupError, startServer } from "../src/server";
import { call, git, sandbox, siteRepository, startHosted, until } from "./hosted-helpers";

const box = sandbox("keep-up");
const OPERATOR = "an-operator-token-for-scripts-0000";
const PAGE = "src/content/pages/index.md";

afterAll(() => box.cleanup(), 120_000);

/** A timer the test turns by hand: `tick()` runs the round it was given, `cancelled` once it was stopped. */
function handTimer() {
  const state = { every: [] as number[], run: null as null | (() => Promise<unknown>), cancelled: false };
  const timer: KeepUpTimer = {
    every(ms, run) {
      state.every.push(ms);
      state.run = run;
      return () => {
        state.cancelled = true;
      };
    },
  };

  return { timer, state, tick: () => state.run!() };
}

/** Someone publishing to the code host from elsewhere. */
function publisher(bare: string) {
  const other = box.folder("elsewhere");

  git(other, "clone", "-q", bare, ".");
  return (text: string, message: string) => {
    git(other, "pull", "-q");
    writeFileSync(join(other, PAGE), `---\ntitle: Home\n---\n${text}\n`);
    git(other, "commit", "-q", "-am", message);
    git(other, "push", "-q", "origin", "main");
  };
}

/** The site as a hosted install holds it: its own copy of the repository, opened through the real engine. */
async function copyOf(bare: string): Promise<{ root: string; site: SiteService; events: ServerEvent[]; bus: ReturnType<typeof createEventBus> }> {
  const root = box.folder("copy");

  git(root, "clone", "-q", bare, ".");
  const bus = createEventBus();
  const events: ServerEvent[] = [];

  bus.subscribe((event) => events.push(event));
  const site = await createSiteService(root, { id: "site-1", events: bus, overlayScript: () => "", author: () => ({ name: "Sam", email: "sam@example.com" }), watch: false });

  return { root, site, events, bus };
}

describe("the editor's own rounds", () => {
  it("bring newer versions in, say each new thing once, skip when busy or overlapping, and stop", async () => {
    const bare = siteRepository(box);
    const elsewhere = publisher(bare);
    const { root, site, events } = await copyOf(bare);
    const hand = handTimer();
    const lines: string[] = [];
    let busy: string | null = null;
    const keepUp = createKeepUp({ minutes: 5, site: async () => site, busy: () => busy, log: (line) => lines.push(line), timer: hand.timer });

    try {
      expect(hand.state.every).toEqual([5 * 60_000]);
      // Nothing new: nothing said.
      expect(await hand.tick()).toBe("quiet");
      expect(lines).toEqual([]);
      elsewhere("One", "First change");
      elsewhere("Two", "Second change");
      expect(await hand.tick()).toBe("brought");
      expect(readFileSync(join(root, PAGE), "utf8")).toContain("Two");
      expect(lines).toEqual(["Repository: brought in 2 newer versions (1 file changed)."]);
      expect(events.filter((event) => event.type === "repository.checked").at(-1)).toEqual({ type: "repository.checked", siteId: "site-1", brought: 2 });
      expect(events.some((event) => event.type === "changes.updated" && event.origin === "external" && event.paths.includes(PAGE))).toBe(true);

      // Install-level work under way: skipped, not queued.
      busy = "a backup is being put back";
      elsewhere("Three", "Third change");
      expect(await hand.tick()).toBe("busy");
      expect(readFileSync(join(root, PAGE), "utf8")).toContain("Two");
      busy = null;

      // Never two at once.
      const [first, second] = await Promise.all([keepUp.round(), keepUp.round()]);

      expect([first, second]).toEqual(["brought", "overlap"]);

      // The code host can't be reached: said once, not every round, and once more when it clears.
      git(root, "remote", "set-url", "origin", join(box.root, "gone.git"));
      expect(await hand.tick()).toBe("failed");
      expect(await hand.tick()).toBe("failed");
      git(root, "remote", "set-url", "origin", bare);
      expect(await hand.tick()).toBe("quiet");
      expect(lines.slice(2)).toEqual([expect.stringMatching(/^Repository: couldn't check for newer versions: .+\.$/), "Repository: the code host answers again."]);

      // An unpublished change to the file the newer version changes: held, said once, nothing overwritten.
      writeFileSync(join(root, PAGE), "---\ntitle: Home\n---\nMine\n");
      elsewhere("Four", "Fourth change");
      expect(await hand.tick()).toBe("held");
      expect(await hand.tick()).toBe("held");
      expect(readFileSync(join(root, PAGE), "utf8")).toContain("Mine");
      expect(lines.slice(4)).toEqual([expect.stringMatching(/^Repository: 1 newer version waiting, not brought in: .*index\.md.*Publish or discard/)]);

      await keepUp.stop();
      expect(hand.state.cancelled).toBe(true);
      expect(await keepUp.round()).toBe("stopped");
    } finally {
      await keepUp.stop();
      await site.dispose();
    }
  }, 180_000);

  it("a skipped round still looks while only the assistant is in the way, and half an hour of skipping is said once, with why", async () => {
    const bare = siteRepository(box);
    const elsewhere = publisher(bare);
    const { root, site, events } = await copyOf(bare);
    const lines: string[] = [];
    let busy: string | null = null;
    let working: string | null = null;
    let now = Date.parse("2026-11-24T10:00:00Z");
    const keepUp = createKeepUp({ minutes: 0, site: async () => site, busy: () => busy, working: () => working, log: (line) => lines.push(line), now: () => now });
    const checked = () => events.filter((event) => event.type === "repository.checked").length;
    const later = (minutes: number) => void (now += minutes * 60_000);

    try {
      elsewhere("One", "First change");
      // Install-level work (the site may be on its way in or out): not even a look.
      busy = "a backup is being put back";
      expect(await keepUp.round()).toBe("busy");
      expect((await site.gitStatus()).behind).toBe(0);
      expect(checked()).toBe(0);
      busy = null;

      // The assistant at work: nothing comes in, but the round looks, and open browsers hear what it found.
      working = "the assistant is working on the site";
      expect(await keepUp.round()).toBe("busy");
      expect(readFileSync(join(root, PAGE), "utf8")).not.toContain("One");
      expect(await site.gitStatus()).toMatchObject({ behind: 1, checkedAt: expect.any(String) });
      expect(checked()).toBe(1);
      // The same found again is not announced again.
      later(5);
      expect(await keepUp.round()).toBe("busy");
      expect(checked()).toBe(1);
      expect(lines).toEqual([]);

      // Still skipping half an hour after the first skipped round: said once, with the reason as it is now.
      later(SKIPPED_SAID_AFTER_MS / 60_000 - 6);
      expect(await keepUp.round()).toBe("busy");
      expect(lines).toEqual([]);
      later(2);
      expect(await keepUp.round()).toBe("busy");
      expect(lines).toEqual(["Repository: the editor's rounds have been skipped for 31 minutes, because the assistant is working on the site. Newer versions, if there are any, come in once that is over."]);
      later(60);
      expect(await keepUp.round()).toBe("busy");
      expect(lines).toHaveLength(1);

      // Over: the round runs, and the log says so before it says what came in.
      working = null;
      expect(await keepUp.round()).toBe("brought");
      expect(lines.slice(1)).toEqual(["Repository: the editor's rounds run again.", "Repository: brought in 1 newer version (1 file changed)."]);
      expect(readFileSync(join(root, PAGE), "utf8")).toContain("One");

      // A short skip says nothing at all, and the half hour is counted afresh each time.
      working = "the assistant is working on the site";
      expect(await keepUp.round()).toBe("busy");
      later(SKIPPED_SAID_AFTER_MS / 60_000 - 1);
      expect(await keepUp.round()).toBe("busy");
      working = null;
      expect(await keepUp.round()).toBe("quiet");
      expect(lines).toHaveLength(3);
    } finally {
      await keepUp.stop();
      await site.dispose();
    }
  }, 180_000);

  it("says so too when it is the site that keeps standing aside", async () => {
    const lines: string[] = [];
    let now = 0;
    let looks = 0;
    // A site that always stands aside, as one does while a save, a publish or the preview's install is in progress.
    const site = { catchUp: async () => null, checkGit: async () => void (looks += 1) } as unknown as SiteService;
    const keepUp = createKeepUp({ minutes: 0, site: async () => site, busy: () => null, log: (line) => lines.push(line), now: () => now });

    expect(await keepUp.round()).toBe("busy");
    now += SKIPPED_SAID_AFTER_MS;
    expect(await keepUp.round()).toBe("busy");
    expect(lines).toEqual([
      "Repository: the editor's rounds have been skipped for 30 minutes, because a save or a publish is in progress on the site, or its preview is installing the site's packages. Newer versions, if there are any, come in once that is over.",
    ]);
    // The site did its own looking, if any: the round asks for no second one.
    expect(looks).toBe(0);
    await keepUp.stop();
  });

  it("on a hosted install, run as the engine — and what listens to the site's events still can't bring versions in", async () => {
    const bare = siteRepository(box);
    const elsewhere = publisher(bare);
    const { root, site, bus } = await copyOf(bare);
    const keepUp = createKeepUp({ minutes: 0, site: async () => site, busy: () => null, log: () => undefined });
    const attempts: Array<Promise<string>> = [];
    const refusal = (work: () => Promise<unknown>) =>
      work().then(
        () => "went ahead",
        (error: unknown) => (error instanceof Error ? error.message : String(error))
      );

    requireCallerForGuardedWork(true);
    try {
      // Work done for nobody, outside the round: refused.
      expect(await refusal(() => site.catchUp())).toBe(NO_CALLER_REFUSAL);
      // A listener reacting to what the round announces, as a plugin's callback would.
      bus.subscribe((event) => {
        if (event.type === "repository.checked" || event.type === "changes.updated") {
          attempts.push(refusal(() => site.pull()), refusal(() => site.catchUp()));
        }
      });
      elsewhere("By the round", "A change for the round");
      expect(await keepUp.round()).toBe("brought");
      expect(readFileSync(join(root, PAGE), "utf8")).toContain("By the round");
      expect(attempts.length).toBeGreaterThan(0);
      expect(new Set(await Promise.all(attempts))).toEqual(new Set([NO_CALLER_REFUSAL]));
    } finally {
      requireCallerForGuardedWork(false);
      await site.dispose();
    }
  }, 180_000);
});

describe("a started server", () => {
  it("hosted: rounds every GALLEY_SYNC_MINUTES (5 by default) once the site is connected, the look route answers, and shutdown stops them", async () => {
    const bare = siteRepository(box);
    const elsewhere = publisher(bare);
    const hand = handTimer();
    const { server, port, logs } = await startHosted(
      box,
      box.folder("home"),
      {
        GALLEY_PASSWORD: "correct horse battery staple",
        GALLEY_OWNER_NAME: "Sam Owner",
        GALLEY_OWNER_EMAIL: "sam@example.com",
        GALLEY_TOKEN: OPERATOR,
        GALLEY_SITE_REPOSITORY: bare,
        GALLEY_SITE_ACCESS: "token",
        GALLEY_SITE_TOKEN: "fake-access-key-for-the-repository-0000",
      },
      { syncTimer: hand.timer }
    );

    await server.install!.idle();
    expect(server.syncMinutes).toBe(5);
    expect(hand.state.every).toEqual([5 * 60_000]);
    const folder = server.install!.siteFolder();
    const siteId = server.install!.siteId()!;

    elsewhere("Brought by the server", "From elsewhere");
    // The look: what is new, nothing changed.
    const looked = await call(port, "POST", `/api/sites/${siteId}/git/check`, { bearer: OPERATOR });

    expect(looked.status, looked.text).toBe(200);
    expect(looked.body).toMatchObject({ behind: 1, ahead: 0, checkedAt: expect.any(String) });
    expect(readFileSync(join(folder, PAGE), "utf8")).not.toContain("Brought by the server");
    expect(await hand.tick()).toBe("brought");
    expect(readFileSync(join(folder, PAGE), "utf8")).toContain("Brought by the server");
    await until(() => logs.some((line) => line.includes("Repository: brought in 1 newer version (1 file changed).")));
    // The code host gone: Get latest answers as somebody else's server not answering, in plain words.
    git(server.install!.store.checkoutFolder(), "remote", "set-url", "origin", join(box.root, "gone.git"));
    const unreachable = await call(port, "POST", `/api/sites/${siteId}/pull`, { bearer: OPERATOR });

    expect(unreachable.status, unreachable.text).toBe(502);
    expect(unreachable.body.error).toMatchObject({ code: "git", message: expect.stringMatching(/code host.*\.$/) });
    expect(unreachable.body.error.message).not.toMatch(/fatal|fetch|origin|publish/i);
    await server.close({ graceMs: 0 });
    box.running.splice(box.running.indexOf(server), 1);
    expect(hand.state.cancelled).toBe(true);
    expect(await hand.tick()).toBe("stopped");
  }, 180_000);

  it.skipIf(process.platform === "win32")("hosted: a round is skipped while a publish is really in progress and while the assistant is really working, and comes back for the version after", async () => {
    const bare = siteRepository(box);
    const elsewhere = publisher(bare);
    const hand = handTimer();
    // The assistant's service, standing in: it takes the request and says nothing until the turn is stopped.
    const asked: string[] = [];
    const service = http.createServer((req) => {
      asked.push(`${req.method} ${req.url}`);
      req.resume();
    });

    await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
    // The assistant reads its service's address from the process's own environment. And should that ever stop
    // being so, nothing in this test may reach a real service: any request that isn't to this computer is refused.
    const realFetch = globalThis.fetch;
    const addressBefore = process.env.GALLEY_ANTHROPIC_BASE_URL;

    process.env.GALLEY_ANTHROPIC_BASE_URL = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const host = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).hostname;

      if (host !== "127.0.0.1") return Promise.reject(new Error(`this test may only talk to this computer, not ${host}`));
      return realFetch(input, init);
    });
    try {
      const { server, port } = await startHosted(
        box,
        box.folder("home"),
        {
          GALLEY_PASSWORD: "correct horse battery staple",
          GALLEY_OWNER_NAME: "Sam Owner",
          GALLEY_OWNER_EMAIL: "sam@example.com",
          GALLEY_TOKEN: OPERATOR,
          GALLEY_SITE_REPOSITORY: bare,
          GALLEY_SITE_ACCESS: "token",
          GALLEY_SITE_TOKEN: "fake-access-key-for-the-repository-0000",
          ANTHROPIC_API_KEY: "not-a-real-key-for-the-stand-in-0000",
        },
        { syncTimer: hand.timer }
      );

      await server.install!.idle();
      const folder = server.install!.siteFolder();
      const siteId = server.install!.siteId()!;
      const page = () => readFileSync(join(folder, PAGE), "utf8");

      // A publish, held open by the site's own check before a version is recorded.
      const gate = box.folder("publish-gate");

      writeFileSync(join(folder, ".git", "hooks", "pre-commit"), `#!/bin/sh\n: > '${gate}/reached'\nwhile [ ! -e '${gate}/go' ]; do sleep 0.05; done\n`, { mode: 0o755 });
      writeFileSync(join(folder, "notes.md"), "A note to publish.\n");
      const publishing = call(port, "POST", `/api/sites/${siteId}/publish`, { bearer: OPERATOR, body: { paths: ["notes.md"], message: "A note" } });

      await until(() => existsSync(join(gate, "reached")));
      expect(await hand.tick()).toBe("busy");
      writeFileSync(join(gate, "go"), "");
      const published = await publishing;

      expect(published.status, published.text).toBe(200);
      expect(published.body).toMatchObject({ ok: true, pushed: true });

      // The assistant at work on the site: its turn began before the newer version was there, and writes from what it read.
      const thread = await call(port, "POST", `/api/sites/${siteId}/threads`, { bearer: OPERATOR, body: {} });

      expect(thread.status, thread.text).toBe(200);
      const sent = await call(port, "POST", `/api/sites/${siteId}/threads/${thread.body.id}/messages`, { bearer: OPERATOR, body: { text: "Tidy the home page." } });

      expect(sent.status, sent.text).toBe(200);
      await until(() => asked.length > 0);
      elsewhere("Brought in after the assistant finished", "From elsewhere");
      expect((await call(port, "GET", `/api/sites/${siteId}/git`, { bearer: OPERATOR })).body).toMatchObject({ behind: 0 });
      expect(await hand.tick()).toBe("busy");
      expect(await hand.tick()).toBe("busy");
      expect(page()).not.toContain("Brought in after the assistant finished");
      // The skipped rounds looked all the same: the plain status knows a newer version is waiting, with nobody having asked.
      expect((await call(port, "GET", `/api/sites/${siteId}/git`, { bearer: OPERATOR })).body).toMatchObject({ behind: 1, checkedAt: expect.any(String) });
      // And a person's own look still answers meanwhile: it changes no file.
      const looked = await call(port, "POST", `/api/sites/${siteId}/git/check`, { bearer: OPERATOR });

      expect(looked.body).toMatchObject({ behind: 1 });
      expect(page()).not.toContain("Brought in after the assistant finished");

      // The turn is stopped: the next round brings the version in.
      expect((await call(port, "POST", `/api/sites/${siteId}/threads/${thread.body.id}/cancel`, { bearer: OPERATOR })).status).toBe(200);
      expect(await hand.tick()).toBe("brought");
      expect(page()).toContain("Brought in after the assistant finished");
    } finally {
      vi.unstubAllGlobals();
      if (addressBefore === undefined) delete process.env.GALLEY_ANTHROPIC_BASE_URL;
      else process.env.GALLEY_ANTHROPIC_BASE_URL = addressBefore;
      service.closeAllConnections();
      await new Promise((resolve) => service.close(resolve));
    }
  }, 180_000);

  it("hosted with GALLEY_SYNC_MINUTES=0 runs no rounds; local mode never does; a value that isn't a whole number stops the start", async () => {
    const hosted = handTimer();
    const { server } = await startHosted(box, box.folder("home"), { GALLEY_SYNC_MINUTES: "0" }, { syncTimer: hosted.timer });

    expect(server.syncMinutes).toBe(0);
    expect(hosted.state.every).toEqual([]);
    const local = handTimer();
    const started = await startServer({ port: 0, mode: "local", home: box.folder("local-home"), webDir: join(box.root, "no-ui"), env: { PATH: process.env.PATH, HOME: box.root, GALLEY_SYNC_MINUTES: "1" }, notice: () => undefined, log: () => undefined, syncTimer: local.timer });

    box.running.push(started);
    expect(started.syncMinutes).toBeNull();
    expect(started.keepUp).toBeUndefined();
    expect(local.state.every).toEqual([]);
    await expect(startServer({ mode: "hosted", host: "127.0.0.1", port: 0, home: box.folder("bad-home"), env: { GALLEY_SYNC_MINUTES: "often" } })).rejects.toThrow(StartupError);
  }, 120_000);
});
