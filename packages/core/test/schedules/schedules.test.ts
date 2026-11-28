import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus, createSiteService } from "../../src/site";
import { createScheduleService, isEntryLiveAt, normalizeFutureSchedule, parsePublishAt } from "../../src/schedules";

const starter = fileURLToPath(new URL("../../../../starters/astro-starter", import.meta.url));
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function makeSite() {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-sched-core-")));
  dirs.push(tmp);
  const root = join(tmp, "site");
  const home = join(tmp, "home");

  cpSync(starter, root, { recursive: true, filter: (src) => !["node_modules", ".astro", "dist"].includes(basename(src)) });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

  git("init", "-q");
  git("symbolic-ref", "HEAD", "refs/heads/main");
  git("config", "user.name", "Schedule Test");
  git("config", "user.email", "sched@example.invalid");
  git("add", "-A");
  git("commit", "-q", "-m", "Initial");

  const events = createEventBus();
  const site = await createSiteService(root, { id: "site-sched", events, overlayScript: () => "", author: async () => null, watch: false });

  return { tmp, root, home, site, events, git };
}

describe("schedule date helpers", () => {
  it("parses ISO dates and date-times and evaluates isEntryLiveAt", () => {
    const now = new Date("2026-12-01T12:00:00.000Z");

    expect(parsePublishAt("2026-12-01")).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
    expect(parsePublishAt("not-a-date")).toBeNull();
    expect(isEntryLiveAt({ publishAt: "2026-12-01T10:00:00Z" }, now)).toBe(true);
    expect(isEntryLiveAt({ publishAt: "2026-12-01T14:00:00Z" }, now)).toBe(false);
    expect(isEntryLiveAt({ scheduledAt: "2026-12-02" }, now)).toBe(false);
    expect(isEntryLiveAt({ draft: true, publishAt: "2026-11-01T00:00:00Z" }, now)).toBe(false);
    expect(isEntryLiveAt({ title: "No date" }, now)).toBe(true);
  });

  it("rejects past or immediate schedule times and normalizes future times", () => {
    const now = new Date("2026-12-01T12:00:00.000Z");

    expect(normalizeFutureSchedule("2026-12-01T11:59:00Z", now).ok).toBe(false);
    expect(normalizeFutureSchedule("2026-12-01T12:00:10Z", now).ok).toBe(false);
    const ok = normalizeFutureSchedule("2026-12-02T09:00:00-08:00", now);

    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.iso).toBe("2026-12-02T17:00:00.000Z");
  });
});

describe("ScheduleService", () => {
  it("seals chosen Proof files, holds them out of the working tree, reschedules, and restores on cancel", async () => {
    const { root, home, site, events } = await makeSite();

    try {
      const target = "src/content/pages/about.md";
      const original = readFileSync(join(root, target), "utf8");
      const edited = `${original}\nScheduled paragraph.\n`;

      writeFileSync(join(root, target), edited, "utf8");
      expect((await site.changes()).files.map((f) => f.path)).toContain(target);

      let clock = new Date("2026-12-01T12:00:00.000Z");
      const schedules = createScheduleService({ home, events, now: () => clock });
      const created = await schedules.create(site, {
        message: "Launch spring story",
        paths: [target],
        scheduledAt: "2026-12-02T17:00:00.000Z",
        timezone: "America/Los_Angeles",
      });

      expect(created.state).toBe("scheduled");
      expect(created.files).toHaveLength(1);
      // Working tree was restored to HEAD so editors can keep publishing other changes.
      expect(readFileSync(join(root, target), "utf8")).toBe(original);
      expect((await site.changes()).files).toHaveLength(0);

      // Reschedule forward
      const updated = await schedules.update(site, created.id, {
        scheduledAt: "2026-12-03T17:00:00.000Z",
        message: "Launch spring story (revised)",
      });

      expect(updated.scheduledAt).toBe("2026-12-03T17:00:00.000Z");
      expect(updated.message).toBe("Launch spring story (revised)");

      // Cancel and restore to Proof
      const cancelled = await schedules.cancel(site, created.id, { restoreToProof: true });

      expect(cancelled.state).toBe("cancelled");
      expect(readFileSync(join(root, target), "utf8")).toBe(edited);
      expect((await site.changes()).files.map((f) => f.path)).toContain(target);
    } finally {
      await site.dispose();
    }
  });

  it("publishes due releases cleanly even when unrelated dirty files are waiting in Proof", async () => {
    const { root, home, site, events } = await makeSite();

    try {
      const scheduledPath = "src/content/pages/about.md";
      const unrelatedPath = "src/content/pages/contact.md";
      const scheduledContent = `${readFileSync(join(root, scheduledPath), "utf8")}\nRelease copy.\n`;
      const unrelatedContent = `${readFileSync(join(root, unrelatedPath), "utf8")}\nWIP draft copy.\n`;

      writeFileSync(join(root, scheduledPath), scheduledContent, "utf8");

      let clock = new Date("2026-12-01T12:00:00.000Z");
      let deployCalls = 0;
      const schedules = createScheduleService({
        home,
        events,
        now: () => clock,
        deploySite: async () => {
          deployCalls += 1;
          return { url: "https://example.pages.dev" };
        },
      });
      const created = await schedules.create(site, {
        message: "Scheduled about refresh",
        paths: [scheduledPath],
        scheduledAt: "2026-12-01T13:00:00.000Z",
        deployAfterPublish: true,
      });

      // Editor now makes an unrelated draft edit in Proof.
      writeFileSync(join(root, unrelatedPath), unrelatedContent, "utf8");

      // Advance clock past scheduledAt and run due releases.
      clock = new Date("2026-12-01T13:05:00.000Z");
      const ran = await schedules.runDueForSite(site);

      expect(ran).toHaveLength(1);
      expect(ran[0]!.id).toBe(created.id);
      expect(ran[0]!.state).toBe("published");
      expect(ran[0]!.commit).toBeTruthy();
      expect(ran[0]!.deployUrl).toBe("https://example.pages.dev");
      expect(deployCalls).toBe(1);

      // Scheduled file is committed; unrelated draft remains untouched in Proof.
      expect(readFileSync(join(root, scheduledPath), "utf8")).toBe(scheduledContent);
      expect(readFileSync(join(root, unrelatedPath), "utf8")).toBe(unrelatedContent);
      const remaining = (await site.changes()).files.map((f) => f.path);

      expect(remaining).toEqual([unrelatedPath]);
    } finally {
      await site.dispose();
    }
  });

  it("writes the GitHub Actions scheduled rebuild workflow into Proof", async () => {
    const { root, home, site } = await makeSite();

    try {
      const schedules = createScheduleService({ home });
      const res = await schedules.setupWorkflow(site, "0 */6 * * *");

      expect(res.path).toBe(".github/workflows/galley-schedule.yml");
      expect(res.cron).toBe("0 */6 * * *");
      expect(res.created).toBe(true);
      expect(existsSync(join(root, res.path))).toBe(true);
      expect(readFileSync(join(root, res.path), "utf8")).toContain('cron: "0 */6 * * *"');
    } finally {
      await site.dispose();
    }
  });
});
