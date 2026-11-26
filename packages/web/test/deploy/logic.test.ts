import { describe, expect, it } from "vitest";
import type { DeployStatus, Deployment, Job } from "@galley/core/types";
import { canPromoteDeployment, configuredDomains, deploymentItems, isCurrentLive, onlineOutcome, canContinue, failureFor, hostOf, initialSetup, jobFailureTitle, nextStepForJob, onlineSettingsWaiting, progressSteps, setupReducer, statusLine } from "../../src/features/deploy/logic";

const NOW = new Date(2026, 10, 23, 15, 0, 0).getTime();
const LIVE: Deployment = { id: "d1", kind: "production", target: "cloudflare", project: "lowfield", url: "https://lowfield.studio.workers.dev", commit: "abc", createdAt: new Date(NOW - 3 * 60_000).toISOString(), files: 214, bytes: 1000 };
const BASE: DeployStatus = { config: null, production: null, preview: null, job: null, behind: null, liveAddressSet: false, suggestedProject: "lowfield-studio" };
const CONFIG = { target: "cloudflare", account: "acc", project: "lowfield" };
const job = (patch: Partial<Job>): Job => ({ id: "j1", kind: "deploy", label: "Putting the site online", state: "running", startedAt: NOW - 1000, ...patch });

describe("statusLine", () => {
  it("says whether and where the site is live, in plain words", () => {
    expect(statusLine(BASE, null, NOW)).toEqual({ text: "Not online yet", tone: "neutral", action: { label: "Put this site online", kind: "setup" } });
    expect(statusLine({ ...BASE, config: CONFIG }, null, NOW).text).toBe("Not live yet");
    expect(statusLine({ ...BASE, config: CONFIG, production: LIVE, behind: 0 }, null, NOW)).toMatchObject({ text: "Live at lowfield.studio.workers.dev · updated 3 min ago", tone: "success", href: LIVE.url });
    expect(statusLine({ ...BASE, config: CONFIG, production: LIVE, behind: 2 }, null, NOW)).toMatchObject({ text: "2 published versions not live yet", action: { label: "Put live" } });
    expect(statusLine({ ...BASE, config: CONFIG, production: LIVE, behind: 1 }, null, NOW).text).toBe("1 published version not live yet");
  });

  it("shows progress while working, and a failure until something newer succeeds", () => {
    expect(statusLine({ ...BASE, config: CONFIG }, job({ detail: "Uploading 37 of 214 files…" }), NOW)).toMatchObject({ text: "Uploading 37 of 214 files…", tone: "busy" });
    const failed = job({ state: "error", detail: "Cloudflare didn't accept the access key.", finishedAt: NOW - 1000 });
    expect(statusLine({ ...BASE, config: CONFIG, production: LIVE, behind: 0 }, failed, NOW)).toMatchObject({ text: "Couldn’t put the site online", tone: "danger" });
    const older = { ...failed, finishedAt: NOW - 10 * 60_000 };
    expect(statusLine({ ...BASE, config: CONFIG, production: LIVE, behind: 0 }, older, NOW).tone).toBe("success");
  });

  it("strips addresses to their host", () => {
    expect(hostOf("https://x.vercel.app/")).toBe("x.vercel.app");
  });
});

describe("setup", () => {
  it("walks host → key → account → name, and remembers a site's existing choices", () => {
    let state = initialSetup(BASE);
    expect(state).toMatchObject({ step: "host", project: "lowfield-studio", intent: "production" });
    expect(canContinue(state, null)).toBe(false);
    state = setupReducer(state, { type: "host", target: "cloudflare", keyStored: false });
    expect(state.step).toBe("key");
    state = setupReducer(state, { type: "key-saved" });
    state = setupReducer(state, { type: "accounts", accounts: [{ id: "a1", name: "Studio" }] });
    expect(state.account).toBe("a1");
    state = setupReducer(state, { type: "account", account: "a1" });
    expect(state.step).toBe("name");
    expect(canContinue(state, { available: false })).toBe(false);
    expect(canContinue(state, { available: true })).toBe(true);
    expect(setupReducer(state, { type: "back" }).step).toBe("account");
    expect(initialSetup({ ...BASE, config: CONFIG }, "preview")).toMatchObject({ step: "name", target: "cloudflare", account: "acc", project: "lowfield", intent: "preview" });
  });

  it("forgets the account when the host changes, and doesn't pick one of several", () => {
    let state = setupReducer(initialSetup(BASE), { type: "host", target: "cloudflare", keyStored: true });
    state = setupReducer(state, { type: "accounts", accounts: [{ id: "a1", name: "A" }, { id: "a2", name: "B" }] });
    expect(state.account).toBeNull();
    state = setupReducer(state, { type: "account", account: "a2" });
    state = setupReducer(state, { type: "host", target: "vercel", keyStored: false });
    expect(state).toMatchObject({ target: "vercel", account: null, accounts: null, step: "key" });
  });

  it("finishes on the job it started, and a failure points at the step that fixes it", () => {
    let state = setupReducer(initialSetup({ ...BASE, config: CONFIG }), { type: "started", jobId: "j1" });
    expect(state.step).toBe("working");
    expect(setupReducer(state, { type: "finished", job: job({ id: "other", state: "done" }) }).step).toBe("working");
    expect(setupReducer(state, { type: "finished", job: job({ state: "done" }) }).step).toBe("done");
    state = setupReducer(state, { type: "finished", job: job({ state: "error", detail: "Cloudflare didn't accept the access key. Create a new one and paste it here." }) });
    expect(state).toMatchObject({ step: "failed", retryStep: "key" });
    expect(setupReducer(state, { type: "back" }).step).toBe("key");
  });
});

describe("failures", () => {
  it("maps what went wrong to a title, the sentence and the step that fixes it", () => {
    expect(failureFor({ offline: true, shape: { code: "internal", message: "x" } })).toMatchObject({ title: "Can’t reach this app", back: null });
    expect(failureFor({ code: "unconfigured", message: "Cloudflare didn't accept the access key. It may have been deleted." }, "Cloudflare")).toMatchObject({ title: "Check the access key", back: "key" });
    expect(failureFor({ code: "forbidden", message: "Cloudflare didn't let the access key list the Workers in this account. Edit the key on Cloudflare (My Profile › API Tokens): under Permissions add Account › Workers Scripts › Edit." })).toMatchObject({ title: "The access key is missing a permission", back: "key" });
    expect(failureFor({ code: "conflict", message: "Vercel says the name “x” can't be used. Choose a different name." })).toMatchObject({ back: "name" });
    expect(failureFor({ code: "unconfigured", message: "This Cloudflare account doesn't have a workers.dev address yet." })).toMatchObject({ back: "account" });
    expect(failureFor({ code: "internal", message: "" })).toMatchObject({ title: "Couldn’t put the site online", body: "Nothing on the live site changed. Try again." });
  });

  it("names a failed job's trouble", () => {
    expect(jobFailureTitle(job({ state: "error", detail: "The site's own build stopped with a problem, so nothing was uploaded." }))).toBe("The site couldn’t be built");
    expect(jobFailureTitle(job({ state: "error", detail: "The site has more than 20,000 files, and Cloudflare takes at most 20,000 in one go. Nothing was uploaded." }))).toBe("The site is too big for this host");
    expect(jobFailureTitle(job({ state: "error", detail: "This computer can't reach Cloudflare. Check your internet connection." }))).toBe("Couldn’t reach the host");
    expect(nextStepForJob(job({ state: "error", detail: "The site's own build stopped with a problem" }))).toBeNull();
    expect(nextStepForJob(job({ state: "error", detail: "Vercel says the name “x” can't be used. Choose a different name." }))).toBe("name");
  });
});

describe("progressSteps", () => {
  it("moves through building, uploading and live", () => {
    expect(progressSteps(job({ progress: 0.1 }), "production").map((step) => step.state)).toEqual(["current", "todo", "todo"]);
    expect(progressSteps(job({ progress: 0.6 }), "production").map((step) => step.state)).toEqual(["done", "current", "todo"]);
    expect(progressSteps(job({ state: "done", progress: 1 }), "preview")).toEqual([
      { label: "Building the site", state: "done" },
      { label: "Uploading the files", state: "done" },
      { label: "Preview ready", state: "done" },
    ]);
  });
});

describe("onlineOutcome", () => {
  it("drops “they stay here” once the site is online, and nothing else", () => {
    const saved = { kind: "saved-local", title: "Published on this computer", body: "2 changes are saved as a new version. This site isn’t set up to send versions to a host, so they stay here." };
    expect(onlineOutcome(saved, true)).toEqual({ kind: "saved-local", title: "Published", body: "2 changes are saved as a new version." });
    expect(onlineOutcome(saved, false)).toBe(saved);
    const published = { kind: "published", title: "Published", body: "x" };
    expect(onlineOutcome(published, true)).toBe(published);
  });
});

describe("the online settings at the end of setting up", () => {
  const change = (path: string, kind: "config" | "content" = "config") => ({ path, kind, status: "modified" as const, binary: false, additions: 1, deletions: 0, summary: "" });

  it("says plainly that the settings are waiting in Proof, and offers to publish just that file", () => {
    const waiting = onlineSettingsWaiting([change("src/content/pages/index.md", "content"), change("galley.config.json")]);

    expect(waiting).toMatchObject({ path: "galley.config.json", title: "The site’s online settings are a change waiting in Proof", button: "Publish the settings", message: "Online settings" });
    expect(waiting?.body).not.toMatch(/deploy|commit/i);
  });

  it("says nothing when the settings aren't waiting", () => {
    expect(onlineSettingsWaiting([])).toBeNull();
    expect(onlineSettingsWaiting([change("src/content/pages/index.md", "content")])).toBeNull();
  });
});

describe("deployments, rollback, and multiple custom domains", () => {
  const OLDER: Deployment = { ...LIVE, id: "d0", createdAt: new Date(NOW - 60 * 60_000).toISOString() };

  it("merges listed and status deployments without duplicates and enables Make live only on non-current versions", () => {
    const status: DeployStatus = { ...BASE, config: CONFIG, production: LIVE, deployments: [LIVE, OLDER], canPromote: true };

    expect(deploymentItems(status, [LIVE]).map((item) => item.id)).toEqual(["d1", "d0"]);
    expect(isCurrentLive(LIVE, status)).toBe(true);
    expect(isCurrentLive(OLDER, status)).toBe(false);
    expect(canPromoteDeployment(LIVE, status, true)).toBe(false);
    expect(canPromoteDeployment(OLDER, status, true)).toBe(true);
    expect(canPromoteDeployment(OLDER, status, false)).toBe(false);
    expect(canPromoteDeployment(OLDER, { ...status, canPromote: false }, true)).toBe(false);
    expect(canPromoteDeployment(OLDER, { ...status, job: job({ state: "running" }) }, true)).toBe(false);
  });

  it("collects configured custom domains from domains[] and legacy domain without duplicates", () => {
    expect(configuredDomains(null)).toEqual([]);
    expect(configuredDomains({ ...CONFIG, domain: { hostname: "example.com", attached: true } })).toEqual([{ hostname: "example.com", attached: true }]);
    expect(
      configuredDomains({
        ...CONFIG,
        domain: { hostname: "example.com", attached: true },
        domains: [
          { hostname: "example.com", attached: true },
          { hostname: "www.example.com", attached: true, pending: true },
        ],
      }).map((item) => item.hostname)
    ).toEqual(["example.com", "www.example.com"]);
  });

  it("skips the access key step for hosts with no credentials", () => {
    const state = setupReducer(initialSetup(BASE), { type: "host", target: "source-host", keyStored: false, skipKey: true });

    expect(state.step).toBe("account");
  });
});
