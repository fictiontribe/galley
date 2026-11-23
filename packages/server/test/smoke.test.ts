/**
 * The real engine behind the real server, over HTTP: open the starter site,
 * edit one field, proof it, publish it. Skipped until the engine's site and
 * ai factories exist (compose.ts wires them).
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChangeSet, EntryList, FileDiff, HistoryEntry, PublishResult, SiteDetail, Entry, EditResult } from "@galley/core/types";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/types";

async function engineReady(): Promise<boolean> {
  try {
    const site = (await import("@galley/core/site")) as Record<string, unknown>;
    const ai = (await import("@galley/core/ai")) as Record<string, unknown>;

    return ["createEventBus", "createSiteRegistry"].every((name) => typeof site[name] === "function") &&
      ["createSettingsService", "createImageService", "createAgentRuntime"].every((name) => typeof ai[name] === "function");
  } catch {
    return false;
  }
}

const ready = await engineReady();
const starter = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));

describe.skipIf(!ready)("smoke: real engine over HTTP", () => {
  let tmp = "";
  let server: RunningServer;
  let siteId = "";
  let entryPath = "";
  let titleField = "";
  const git = (...args: string[]) => execFileSync("git", args, { cwd: join(tmp, "site"), encoding: "utf8" });

  async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  }

  beforeAll(async () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-smoke-")));
    const site = join(tmp, "site");

    cpSync(starter, site, { recursive: true, filter: (source) => !["node_modules", ".astro", "dist"].includes(basename(source)) });
    symlinkSync(realpathSync(join(starter, "node_modules")), join(site, "node_modules"));
    git("init", "-q");
    git("symbolic-ref", "HEAD", "refs/heads/main");
    // The site's .gitignore says node_modules/, which a symlink doesn't match.
    writeFileSync(join(site, ".git", "info", "exclude"), "node_modules\n");
    git("config", "user.name", "Smoke Test");
    git("config", "user.email", "smoke@example.invalid");
    git("add", "-A");
    git("commit", "-q", "-m", "First version");
    server = await startServer({
      port: 0,
      home: join(tmp, "home"),
      webDir: join(tmp, "no-ui"),
      env: { PATH: process.env.PATH, HOME: tmp },
      notice: () => {},
    });
  });

  afterAll(async () => {
    await server?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("opens the site", async () => {
    const { status, body } = await api<SiteDetail>("POST", "/api/sites/open", { path: join(tmp, "site") });

    expect(status).toBe(200);
    expect(body.root).toBe(join(tmp, "site"));
    siteId = body.id;
  });

  it("lists collections and entries", async () => {
    const { body: detail } = await api<SiteDetail>("GET", `/api/sites/${siteId}`);
    const collection = detail.model.collections.find((item) => item.kind === "entries" && item.count > 0 && item.titleField);

    expect(collection, JSON.stringify(detail.model.collections.map((item) => item.id))).toBeTruthy();
    titleField = collection!.titleField!;
    const { status, body } = await api<EntryList>("GET", `/api/sites/${siteId}/entries?collection=${collection!.id}`);

    expect(status).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    entryPath = body.items[0]!.path;
  });

  it("reads an entry and changes one field", async () => {
    const { body: entry } = await api<Entry>("GET", `/api/sites/${siteId}/entry?path=${encodeURIComponent(entryPath)}`);

    expect(entry.path).toBe(entryPath);
    const { status, body } = await api<EditResult>("PATCH", `/api/sites/${siteId}/entry?path=${encodeURIComponent(entryPath)}`, {
      ops: [{ op: "set", path: [titleField], value: "Smoke test title" }],
      baseHash: entry.hash,
    });

    expect(status).toBe(200);
    expect(body.applied).toBe(1);
    expect(body.entry.data[titleField]).toBe("Smoke test title");
  });

  it("shows the change, with a field change, and its diff", async () => {
    const { body: changes } = await api<ChangeSet>("GET", `/api/sites/${siteId}/changes`);
    const file = changes.files.find((item) => item.path === entryPath);

    expect(changes.files.map((item) => item.path)).toEqual([entryPath]);
    expect(file?.fieldChanges?.some((change) => change.field[0] === titleField && change.after === "Smoke test title")).toBe(true);
    const { status, body: diff } = await api<FileDiff>("GET", `/api/sites/${siteId}/diff?path=${encodeURIComponent(entryPath)}`);

    expect(status).toBe(200);
    expect(diff.hunks.length).toBeGreaterThan(0);
    expect(diff.after).toContain("Smoke test title");
  });

  it("publishes, shows it in history, and leaves no changes", async () => {
    const { status, body: result } = await api<PublishResult>("POST", `/api/sites/${siteId}/publish`, { message: "Smoke test publish" });

    expect(status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.files).toEqual([entryPath]);
    const { body: history } = await api<{ items: HistoryEntry[] }>("GET", `/api/sites/${siteId}/history?limit=5`);

    expect(history.items[0]?.message).toContain("Smoke test publish");
    expect(history.items[0]?.viaGalley).toBe(true);
    const { body: after } = await api<ChangeSet>("GET", `/api/sites/${siteId}/changes`);

    expect(after.files).toEqual([]);
    expect(git("log", "--format=%s", "-n", "1").trim()).toBe("Smoke test publish");
  });
});
