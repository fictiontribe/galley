/**
 * Embedding: generic server hooks (`onFileWrite`, `beforeDiscard`, `onActivity`)
 * and per-path locking (`host.sites.withPathLock`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SiteActivityNotice, SiteFileWriteNotice } from "@galley/core/site";
import { defineExtension, type ExtensionHost } from "../../src/extensions";
import { DISCARD_GUARD_FAILED } from "../../src/extensions/run";
import { GET_CHANGES_NOTHING, STOPPED } from "../../src/extensions/site";
import { call, EDITOR, sandbox, siteRepository, startHosted, stopHosted, until } from "../hosted-helpers";

const box = sandbox("extensions-hooks");
const PASSWORD = "correct horse battery staple";
const OWN_PAGE = { "sec-fetch-site": "same-origin" };

const writes: SiteFileWriteNotice[] = [];
const activities: SiteActivityNotice[] = [];
let blockDiscard = false;
/** How the probe's discard guard answers: as before (blockDiscard), by throwing, by never answering, or with a long, many-line sentence holding its secret. */
let guardMode: "plain" | "throw" | "hang" | "loud" = "plain";
const PROBE_SECRET = "probe-secret-value-0123456789";
let capturedHost: ExtensionHost | null = null;
let started: Awaited<ReturnType<typeof startHosted>>;
let port = 0;
let siteId = "";
let ownerCookie = "";
let folder = "";

const hooksExtension = defineExtension({
  id: "hooks-probe",
  secrets: ["HOOKS_PROBE_TOKEN"],
  setup(host) {
    capturedHost = host;
    host.hooks.onFileWrite((notice) => {
      writes.push(notice);
    });
    host.hooks.onActivity((notice) => {
      activities.push(notice);
    });
    host.hooks.beforeDiscard((notice) => {
      if (guardMode === "throw") throw new Error("the guard broke");
      if (guardMode === "hang") return new Promise<null>(() => undefined);
      if (guardMode === "loud") return `Refused:\nline two with ${PROBE_SECRET}\n${"x".repeat(900)}`;
      if (blockDiscard) {
        return `Refused discard for ${notice.paths.join(", ")}`;
      }
      return null;
    });

    return {
      routes: {
        "GET /sites/:siteId/try-lock-in-get": {
          access: "edit",
          async handle({ site }) {
            await host.sites.withPathLock(site!.id, "src/content/pages/home.md", async () => "nope");
            return { ok: true };
          },
        },
        "POST /sites/:siteId/locked-update": {
          access: "edit",
          body: (input) => input as { title: string },
          async handle({ site, body }) {
            return await host.sites.withPathLock(site!.id, "src/content/pages/home.md", async (lockedSite) => {
              const res = await lockedSite.updateEntry("src/content/pages/home.md", [{ op: "set", path: ["title"], value: body.title }]);

              return { title: String(res.entry.data.title ?? "") };
            });
          },
        },
      },
    };
  },
});

beforeAll(async () => {
  const repo = siteRepository(box, {
    extra: {
      "galley.config.json": JSON.stringify({
        name: "Harbour Notes",
        dev: { command: "node server.mjs" },
        collections: [
          {
            id: "pages",
            label: "Pages",
            path: "src/content/pages",
            format: "markdown",
            fields: [{ key: "title", label: "Title", type: "string" }],
          },
        ],
      }),
      "src/content/pages/home.md": "---\ntitle: Home\n---\nInitial body.\n",
    },
  });

  started = await startHosted(
    box,
    box.folder("home"),
    {
      GALLEY_PUBLIC_URL: EDITOR,
      GALLEY_PASSWORD: PASSWORD,
      GALLEY_OWNER_NAME: "Sam Owner",
      GALLEY_OWNER_EMAIL: "sam@example.com",
      GALLEY_SITE_REPOSITORY: repo,
      GALLEY_SITE_ACCESS: "token",
      GALLEY_SITE_TOKEN: "fake-access-key-for-the-repository-0000",
      HOOKS_PROBE_TOKEN: PROBE_SECRET,
    },
    { extensions: [hooksExtension] },
  );
  port = started.port;
  await until(() => Boolean(started.server.install?.siteId()));
  siteId = started.server.install!.siteId()!;
  folder = started.server.install!.siteFolder()!;
  const login = await call(port, "POST", "/api/auth/login", { body: { email: "sam@example.com", password: PASSWORD } });

  ownerCookie = login.cookies[0]!;
}, 60_000);

afterAll(async () => {
  await stopHosted(box, started);
  box.cleanup();
}, 60_000);

describe("host.hooks and host.sites.withPathLock", () => {
  it("notifies onFileWrite on locked updates and allows re-entrant updateEntry under withPathLock", async () => {
    writes.length = 0;
    const res = await call(port, "POST", `/api/x/hooks-probe/sites/${siteId}/locked-update`, {
      cookie: ownerCookie,
      headers: OWN_PAGE,
      body: { title: "Locked Title" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ title: "Locked Title" });
    expect(writes.some((w) => w.siteId === siteId && w.path === "src/content/pages/home.md" && w.actor.kind === "person")).toBe(true);
  });

  it("refuses withPathLock inside GET handlers", async () => {
    const res = await call(port, "GET", `/api/x/hooks-probe/sites/${siteId}/try-lock-in-get`, {
      cookie: ownerCookie,
      headers: OWN_PAGE,
    });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain(GET_CHANGES_NOTHING);
  });

  it("lets beforeDiscard refuse a discard with 403 and emits onActivity when allowed", async () => {
    writeFileSync(join(folder, "src/content/pages/home.md"), "---\ntitle: Changed\n---\nBody\n");
    blockDiscard = true;
    const refused = await call(port, "POST", `/api/sites/${siteId}/discard`, {
      cookie: ownerCookie,
      headers: OWN_PAGE,
      body: { paths: ["src/content/pages/home.md"] },
    });

    expect(refused.status).toBe(403);

    blockDiscard = false;
    activities.length = 0;
    const allowed = await call(port, "POST", `/api/sites/${siteId}/discard`, {
      cookie: ownerCookie,
      headers: OWN_PAGE,
      body: { paths: ["src/content/pages/home.md"] },
    });

    expect(allowed.status).toBe(200);
    expect(activities.some((a) => a.kind === "discard" && a.phase === "start")).toBe(true);
    expect(activities.some((a) => a.kind === "discard" && a.phase === "end")).toBe(true);
  });

  it("refuses a discard when a guard throws or doesn't answer in time: it fails closed, and the file is kept", async () => {
    const changed = "---\ntitle: Kept\n---\nBody\n";
    const discard = () => call(port, "POST", `/api/sites/${siteId}/discard`, { cookie: ownerCookie, headers: OWN_PAGE, body: { paths: ["src/content/pages/home.md"] } });

    writeFileSync(join(folder, "src/content/pages/home.md"), changed);
    try {
      for (const mode of ["throw", "hang"] as const) {
        guardMode = mode;
        const refused = await discard();

        expect(refused.status, mode).toBe(403);
        expect(JSON.stringify(refused.body), mode).toContain(DISCARD_GUARD_FAILED);
        expect(readFileSync(join(folder, "src/content/pages/home.md"), "utf8"), mode).toBe(changed);
      }
    } finally {
      guardMode = "plain";
    }
  }, 30_000);

  it("says a guard's refusal as one line of at most 500 characters, with its secrets taken out", async () => {
    writeFileSync(join(folder, "src/content/pages/home.md"), "---\ntitle: Loud\n---\nBody\n");
    guardMode = "loud";
    try {
      const refused = await call(port, "POST", `/api/sites/${siteId}/discard`, { cookie: ownerCookie, headers: OWN_PAGE, body: { paths: ["src/content/pages/home.md"] } });
      const message = (refused.body as { error: { message: string } }).error.message;

      expect(refused.status).toBe(403);
      expect(message).not.toContain("\n");
      expect(message).not.toContain(PROBE_SECRET);
      expect(message.length).toBeLessThanOrEqual(500);
      expect(message.startsWith("Refused:")).toBe(true);
    } finally {
      guardMode = "plain";
    }
  });

  it("never tells onFileWrite of a secrets file, while it tells of other changes made outside the app", async () => {
    writes.length = 0;
    writeFileSync(join(folder, ".env.local"), "TOKEN=outside\n");
    writeFileSync(join(folder, "src/content/pages/outside.md"), "---\ntitle: Outside\n---\n");
    await until(() => writes.some((w) => w.path === "src/content/pages/outside.md"), 15_000);
    await new Promise((done) => setTimeout(done, 500));
    expect(writes.filter((w) => w.path.includes(".env"))).toEqual([]);
  }, 30_000);

  it("tells onActivity a publish failed when it answers ok: false without throwing (nothing to publish)", async () => {
    activities.length = 0;
    const res = await call(port, "POST", `/api/sites/${siteId}/publish`, { cookie: ownerCookie, headers: OWN_PAGE, body: { paths: ["src/content/pages/no-such-change.md"] } });

    expect((res.body as { ok?: boolean }).ok).toBe(false);
    expect(activities.find((a) => a.kind === "publish" && a.phase === "end")).toMatchObject({ failed: true });
  });

  it("refuses withPathLock once the server has stopped", async () => {
    await stopHosted(box, started);
    await expect(capturedHost!.sites.withPathLock(siteId, "src/content/pages/home.md", async () => "late")).rejects.toThrow(STOPPED);
  });
});
