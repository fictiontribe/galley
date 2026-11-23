/**
 * The site kit over HTTP, against the real engine and a copy of the plain
 * Astro starter as it was before it shipped the kit: what the site has,
 * "Set it up for me" as a job (its end is asked for the way a reload would),
 * and the forms list in one request.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FormListItem, SiteKitStatus } from "@galley/core/api";
import { loadKitBundle } from "@galley/core/site-kit";
import type { AddSitesResult, Job } from "@galley/core/types";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/types";

const FIXTURE = fileURLToPath(new URL("../../core/test/fixtures/pre-kit-astro", import.meta.url));

describe("the site kit over HTTP", () => {
  let tmp = "";
  let server: RunningServer;
  let siteId = "";
  let site = "";

  async function api<T>(method: string, path: string): Promise<{ status: number; body: T }> {
    const response = await fetch(`${server.url}${path}`, { method, headers: { authorization: `Bearer ${server.token}` } });

    return { status: response.status, body: (await response.json()) as T };
  }

  beforeAll(async () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-kit-http-")));
    site = join(tmp, "sites", "pre-kit");
    cpSync(FIXTURE, site, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: site });
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "add", "-A"], { cwd: site });
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "First"], { cwd: site });
    server = await startServer({ port: 0, home: join(tmp, "home"), webDir: join(tmp, "no-ui"), env: { PATH: process.env.PATH, HOME: tmp }, notice: () => {} });
    const response = await fetch(`${server.url}/api/sites/add`, {
      method: "POST",
      headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
      body: JSON.stringify({ paths: [site] }),
    });

    siteId = ((await response.json()) as AddSitesResult).added[0]!.id;
  });

  afterAll(async () => {
    await server?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("says what set-up would do, runs it as a job, and lists the first form", async () => {
    const before = await api<SiteKitStatus>("GET", `/api/sites/${siteId}/kit`);

    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ supported: true, buildAllowed: true, ready: false, kit: null });
    expect(before.body.steps.every((step) => step.state === "ready")).toBe(true);
    expect((await api<{ forms: FormListItem[] }>("GET", `/api/sites/${siteId}/forms`)).body.forms).toEqual([]);

    let job = (await api<Job>("POST", `/api/sites/${siteId}/kit/setup`)).body;

    expect(job).toMatchObject({ kind: "kit-setup", state: "running", siteId });
    for (let tries = 0; job.state === "running" && tries < 400; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = (await api<Job>("GET", `/api/jobs/${job.id}`)).body;
    }
    expect(job.state, job.detail).toBe("done");
    // The kit's files and its settings, the first form, the scripts setup, the two wiring edits, astro.config and visibility.json.
    const expected = Object.keys((await loadKitBundle()).files).length + 1 + 2 + 2 + 2;

    expect(job.detail).toMatch(new RegExp(`^${expected} files are waiting in Proof\\.`));
    expect(readFileSync(join(site, "astro.config.ts"), "utf8")).toContain("integrations: [galley()],");

    const after = await api<SiteKitStatus>("GET", `/api/sites/${siteId}/kit`);

    expect(after.body.ready).toBe(true);
    // A server on this computer can't be reached by visitors: its address is never written into the published settings…
    expect(JSON.parse(readFileSync(join(site, "src/galley/settings.json"), "utf8")).forms.endpoint).toBe("");
    expect(after.body.inbox).toEqual({ used: true, endpoint: null, settable: true, address: `${server.url}/f/${siteId}`, reachable: false });
    // …and asking for it says so.
    const refused = await api<{ error: { message: string } }>("POST", `/api/sites/${siteId}/kit/endpoint`);

    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/^Visitors' browsers can't reach this app's inbox/);
    // "Also publish a version AI assistants can read" runs only that step: here it is on already.
    let only = (await api<Job>("POST", `/api/sites/${siteId}/kit/visibility`)).body;

    expect(only).toMatchObject({ kind: "kit-setup", label: "Publishing a version AI assistants can read" });
    for (let tries = 0; only.state === "running" && tries < 400; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      only = (await api<Job>("GET", `/api/jobs/${only.id}`)).body;
    }
    expect(only).toMatchObject({ state: "done", detail: "Nothing needed changing." });
    const list = await api<{ forms: FormListItem[] }>("GET", `/api/sites/${siteId}/forms`);

    expect(list.body.forms).toEqual([
      { id: "contact", path: "src/content/forms/contact.json", title: "Contact", status: "added", definition: expect.objectContaining({ name: "Contact", submitLabel: "Send message" }), pages: [] },
    ]);
  }, 120_000);
});
