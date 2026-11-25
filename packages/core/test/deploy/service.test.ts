/**
 * The whole deploy flow on real temporary git repositories: the site's own
 * build, production from the published version in a throwaway worktree,
 * previews from the working tree, settings written surgically, records,
 * auto-deploy after publishing that can never fail the publish, and the
 * access key scrubbed from everything a person or a log could see.
 */
import { withAccountAuthor } from "../../src/workspace/author";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createDeployService, type DeployService } from "../../src/deploy/index";
import { createEventBus } from "../../src/site/index";
import type { Job, ServerEvent, Settings } from "../../src/types";
import { createSettingsService } from "../../src/ai/settings";
import { disposeAll, makeSite, openSite, type Harness } from "../site/helpers";
import { cleanupAll, sh, tempDir, until, writeTree } from "../workspace/helpers";
import { startFakeCloudflare, type FakeCloudflare } from "./fakes/cloudflare";
import { startFakeVercel, type FakeVercel } from "./fakes/vercel";

const ACCOUNT = "acc0123456789abcdef0123456789abc";
const TEAM = "team_0123456789abcdef";

/** A dependency-free build: each content file becomes a page; "BREAK" in one makes the build fail. */
const BUILD = `import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
for (const name of readdirSync("content")) {
  const text = readFileSync("content/" + name, "utf8");
  if (text.includes("BREAK")) { console.error("Error: content/" + name + " can't be built"); process.exit(1); }
  const slug = name.replace(/\\.md$/, "");
  mkdirSync("dist/" + slug, { recursive: true });
  writeFileSync("dist/" + slug + "/index.html", "<h1>" + (/^title: (.*)$/m.exec(text)?.[1] ?? slug) + "</h1>");
}
writeFileSync("dist/index.html", "<h1>Home</h1>");
console.log("built");
`;

/** Odd spacing on purpose: config edits must leave untouched lines byte for byte. */
const BUILD_LINE = `  "build":   { "command": "node build.mjs",   "outDir": "dist" },`;
const CONFIG = `{
${BUILD_LINE}
  "name": "Lowfield Studio"
}
`;

function makeTinySite(options: { commit?: boolean } = {}): string {
  const root = tempDir("deploy-site-");

  writeTree(root, {
    "galley.config.json": CONFIG,
    "build.mjs": BUILD,
    ".gitignore": "dist/\n",
    "content/about.md": "---\ntitle: About us\n---\nWho we are.\n",
    "content/contact.md": "---\ntitle: Contact\n---\nWrite to us.\n",
  });
  sh(root, "init", "-q", "-b", "main");
  if (options.commit !== false) {
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "First version");
  }
  return root;
}

interface Rig {
  secrets: Record<string, string | undefined>;
  harness: Harness;
  deploy: DeployService;
  events: ServerEvent[];
  jobs(): Job[];
}

let fakeCf: FakeCloudflare | null = null;
let fakeVercel: FakeVercel | null = null;

afterEach(async () => {
  await disposeAll();
  await fakeCf?.close();
  await fakeVercel?.close();
  fakeCf = null;
  fakeVercel = null;
});
afterAll(cleanupAll);

async function rig(root: string, options: { token?: string; secrets?: Partial<Record<string, string>> } = {}): Promise<Rig> {
  fakeCf ??= await startFakeCloudflare({ echoAuth: true });
  const events: ServerEvent[] = [];
  const bus = createEventBus();
  let deploy!: DeployService;

  bus.subscribe((event) => events.push(event));
  const secrets: Record<string, string | undefined> = { cloudflare: options.token ?? fakeCf.token, vercel: fakeVercel?.token, ...options.secrets };
  deploy = createDeployService({
    home: tempDir("deploy-home-"),
    settings: {
      readSecret: async (name) => secrets[name] ?? null,
      get: async () => ({ author: { name: "Test Editor", email: "editor@example.com" } }) as Settings,
      setSecret: async (name, value) => {
        secrets[name] = value ?? undefined;
        return { name, configured: Boolean(value), source: value ? "stored" : null };
      },
    },
    events: bus,
    apiBase: { cloudflare: fakeCf.api, ...(fakeVercel ? { vercel: fakeVercel.url } : {}) },
    env: {},
  });
  const harness = await openSite(root, { events: bus, onPublished: (result) => deploy.afterPublish(harness.site, result) });

  return { secrets, harness, deploy, events, jobs: () => events.filter((event): event is Extract<ServerEvent, { type: "job" }> => event.type === "job").map((event) => event.job) };
}

const page = (deployment: { files: Map<string, Buffer> } | undefined, path: string) => deployment?.files.get(path)?.toString();

describe("deploying a site", () => {
  it("records who put it online: the signed-in person, their e-mail address until they have a name, and the app's publishing name only for nobody's work", async () => {
    const root = makeTinySite();
    const { harness, deploy } = await rig(root);
    const site = harness.site;

    await deploy.configure(site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" });
    const named = await withAccountAuthor({ name: "Ed Editor", email: "ed@example.com" }, () => deploy.run(site, { kind: "production" }));
    const nameless = await withAccountAuthor({ name: "", email: "ed@example.com" }, () => deploy.run(site, { kind: "production" }));
    const nobody = await deploy.run(site, { kind: "production" });

    expect(named.who).toBe("Ed Editor");
    expect(nameless.who).toBe("ed@example.com");
    expect(nobody.who).toBe("Test Editor");
  });

  it("first production deploy: builds the published version, uploads all of dist, records it and the live address", async () => {
    const root = makeTinySite();
    const { harness, deploy, jobs } = await rig(root);
    const site = harness.site;

    await deploy.configure(site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" });
    const deployment = await deploy.run(site, { kind: "production" });

    expect(deployment).toMatchObject({ kind: "production", target: "cloudflare", project: "lowfield-studio", url: "https://lowfield-studio.studio.workers.dev", who: "Test Editor", files: 3 });
    expect(deployment.commit).toBe(sh(root, "rev-parse", "HEAD"));
    const live = fakeCf!.deployments.at(-1)!;

    expect([...live.files.keys()].sort()).toEqual(["about/index.html", "contact/index.html", "index.html"]);
    expect(page(live, "about/index.html")).toBe("<h1>About us</h1>");
    // The address was written into the settings file, and nothing else in it moved.
    const config = readFileSync(join(root, "galley.config.json"), "utf8");

    expect(config.split("\n")).toContain(BUILD_LINE);
    expect(JSON.parse(config)).toMatchObject({ deploy: { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio", productionUrl: "https://lowfield-studio.studio.workers.dev" } });
    // The temporary worktree is gone: the site's folder has no build output from it and git lists one worktree.
    expect(sh(root, "worktree", "list").split("\n")).toHaveLength(1);
    expect(existsSync(join(root, "dist"))).toBe(false);
    const status = await deploy.status(site);

    expect(status).toMatchObject({ behind: 0, liveAddressSet: false, production: { id: deployment.id } });
    expect(status.job).toMatchObject({ kind: "deploy", state: "done", url: deployment.url, siteId: site.id });
    // Every step reaches the event stream, in order, however fast the machine: none may be coalesced away.
    const details = jobs().map((job) => job.detail);
    const steps = ["Getting ready…", "Connecting to Cloudflare…", "Building the published version…", "Checking the files…", "Sending 3 files (46 B) to Cloudflare…", "Checking which of 3 files Cloudflare already has…", "Uploading 3 files…", "Uploading 3 of 3 files…", "Cloudflare is putting it live…", "Live"];

    expect(details.filter((detail) => steps.includes(detail ?? "")), JSON.stringify(details)).toEqual(steps);
    expect(await deploy.deployments(site)).toEqual([deployment]);

    // Offer accepted: the live address becomes urls.production, so Proof compares against the real site.
    expect((await deploy.useLiveAddress(site)).liveAddressSet).toBe(true);
    expect((await site.model()).urls.production).toBe("https://lowfield-studio.studio.workers.dev");
  });

  it("production never includes pending changes; a preview is exactly the working tree", async () => {
    const root = makeTinySite();
    const { harness, deploy } = await rig(root);
    const site = harness.site;

    await deploy.configure(site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" });
    writeFileSync(join(root, "content/about.md"), "---\ntitle: About us, edited\n---\nWho we are.\n");
    writeFileSync(join(root, "content/new.md"), "---\ntitle: Brand new\n---\nNot published.\n");
    await deploy.run(site, { kind: "production" });
    const production = fakeCf!.deployments.at(-1)!;

    expect(page(production, "about/index.html")).toBe("<h1>About us</h1>");
    expect(production.files.has("new/index.html")).toBe(false);

    const preview = await deploy.run(site, { kind: "preview", label: "For Sam" });
    const version = fakeCf!.deployments.at(-1)!;

    expect(version.kind).toBe("preview");
    expect(page(version, "about/index.html")).toBe("<h1>About us, edited</h1>");
    expect(page(version, "new/index.html")).toBe("<h1>Brand new</h1>");
    expect(preview).toMatchObject({ kind: "preview", label: "For Sam", url: `https://${version.id.slice(0, 8)}-lowfield-studio.studio.workers.dev` });
    // The pending edits are untouched.
    expect(readFileSync(join(root, "content/about.md"), "utf8")).toContain("edited");
  });

  it("a preview can be the very first thing put online", async () => {
    const root = makeTinySite();
    const { harness, deploy } = await rig(root);

    await deploy.configure(harness.site, { target: "cloudflare", account: ACCOUNT, project: "first-preview" });
    const preview = await deploy.run(harness.site, { kind: "preview" });

    expect(preview.url).toMatch(/^https:\/\/[0-9a-f]{8}-first-preview\.studio\.workers\.dev$/);
    expect(fakeCf!.scripts.get("first-preview")).toEqual({ subdomain: true, previews: true });
    expect((await deploy.status(harness.site)).production).toBeNull();
  });

  it.each([".git", "sub/.git/objects", ".envs", "..", "../elsewhere", "/tmp"])("never puts online an output folder the settings name as %s", async (outDir) => {
    const root = makeTinySite();

    writeFileSync(join(root, "galley.config.json"), CONFIG.replace('"outDir": "dist"', `"outDir": ${JSON.stringify(outDir)}`));
    sh(root, "commit", "-q", "-am", "Another output folder");
    const { harness, deploy } = await rig(root);

    await deploy.configure(harness.site, { target: "cloudflare", account: ACCOUNT, project: "not-this" });
    for (const kind of ["preview", "production"] as const) {
      await expect(deploy.run(harness.site, { kind }), kind).rejects.toMatchObject({ reason: "not-set-up", message: expect.stringContaining("output folder") });
    }
    // Nothing was built, read or sent.
    expect(fakeCf!.deployments).toHaveLength(0);
    expect(fakeCf!.log.some((entry) => entry.method !== "GET")).toBe(false);
  });

  it("refuses to put anything live before the first publish, and explains a failed build with its last lines", async () => {
    const empty = makeTinySite({ commit: false });
    const first = await rig(empty);

    await first.deploy.configure(first.harness.site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" });
    await expect(first.deploy.run(first.harness.site, { kind: "production" })).rejects.toMatchObject({ reason: "unpublished", message: expect.stringContaining("what's live is what you've published") });

    const root = makeTinySite();
    const { harness, deploy, jobs } = await rig(root);

    await deploy.configure(harness.site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" });
    writeFileSync(join(root, "content/about.md"), "---\ntitle: BREAK\n---\n");
    const error = await deploy.run(harness.site, { kind: "preview" }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reason: "build", message: expect.stringContaining("The site's own build stopped") });
    expect((error as { detail: string }).detail).toContain("content/about.md can't be built");
    expect(jobs().at(-1)).toMatchObject({ state: "error", output: expect.stringContaining("can't be built") });
    expect(fakeCf!.deployments).toHaveLength(0);
    // Nothing was created on the host for a site that didn't build.
    expect(fakeCf!.scripts.has("lowfield-studio")).toBe(false);
    expect(fakeCf!.log.some((entry) => entry.method !== "GET")).toBe(false);
  });

  it("counts published versions that aren't live yet", async () => {
    const root = makeTinySite();
    const { harness, deploy } = await rig(root);

    await deploy.configure(harness.site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" });
    await deploy.run(harness.site, { kind: "production" });
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Settings");
    writeFileSync(join(root, "content/contact.md"), "---\ntitle: Contact us\n---\n");
    sh(root, "commit", "-qam", "Contact");
    await harness.site.refresh();
    expect((await deploy.status(harness.site)).behind).toBe(2);
  });

  it("auto-deploy: a publish puts the published version live by itself", async () => {
    const root = makeTinySite();
    const { harness, deploy, jobs } = await rig(root);
    const site = harness.site;

    await deploy.configure(site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio", autoDeploy: true });
    writeFileSync(join(root, "content/about.md"), "---\ntitle: About the studio\n---\nWho we are.\n");
    const result = await site.publish({ message: "New about title" });

    expect(result.ok).toBe(true);
    await until(() => jobs().some((job) => job.kind === "deploy" && job.state !== "running"), 30_000);
    const done = jobs().filter((job) => job.kind === "deploy").at(-1)!;

    expect(done).toMatchObject({ state: "done", label: "Putting the published version live" });
    expect(page(fakeCf!.deployments.at(-1), "about/index.html")).toBe("<h1>About the studio</h1>");
    expect(fakeCf!.deployments.at(-1)!.kind).toBe("production");
  });

  it("auto-deploy can't fail a publish, even when the host is unreachable", async () => {
    const root = makeTinySite();
    const { harness, deploy, jobs } = await rig(root);
    const site = harness.site;

    await deploy.configure(site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio", autoDeploy: true });
    await fakeCf!.close();
    writeFileSync(join(root, "content/contact.md"), "---\ntitle: Contact us\n---\n");
    const result = await site.publish({ message: "Contact" });

    expect(result).toMatchObject({ ok: true });
    expect(sh(root, "log", "-1", "--format=%s")).toBe("Contact");
    await until(() => jobs().some((job) => job.kind === "deploy" && job.state === "error"), 30_000);
    expect(jobs().find((job) => job.state === "error")!.detail).toContain("can't reach Cloudflare");
    fakeCf = null;
  }, 60_000);

  it("the access key never reaches a message, a detail, an event or a record — even when the host echoes it", async () => {
    const root = makeTinySite();
    const token = "cf-secret-value-ZZZZ0123456789abcdefghij";
    const { harness, deploy, events } = await rig(root, { token });
    const site = harness.site;

    await deploy.configure(site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" });
    // The fake answers "Invalid access token (sent: Bearer <token>)" to a key it doesn't know.
    const connectError = (await deploy.connect("cloudflare").catch((caught: unknown) => caught)) as Error & { detail?: string };

    expect(connectError).toMatchObject({ reason: "unauthorized" });
    expect(`${connectError.message}\n${connectError.detail}`).not.toContain(token);
    expect(connectError.detail).toContain("[redacted]");
    const runError = (await deploy.run(site, { kind: "production" }).catch((caught: unknown) => caught)) as Error & { detail?: string };

    expect(runError).toMatchObject({ reason: "unauthorized" });
    expect(`${runError.message}\n${runError.detail}`).not.toContain(token);
    expect(JSON.stringify(events)).not.toContain(token);
    expect(JSON.stringify(await deploy.status(site))).not.toContain(token);
    expect(readFileSync(join(root, "galley.config.json"), "utf8")).not.toContain(token);
  });

  it("checks a pasted key with the host first: a refused key never replaces the one that works", async () => {
    const root = makeTinySite();
    const { deploy, secrets } = await rig(root);
    const good = fakeCf!.token;
    const wrong = "cf-wrong-key-0123456789abcdefghijklmn";

    const refused = (await deploy.connect("cloudflare", { key: wrong }).catch((caught: unknown) => caught)) as Error & { reason: string; detail?: string };

    expect(refused).toMatchObject({ reason: "unauthorized" });
    expect(refused.message).toContain("The key saved before is still the one in use.");
    expect(`${refused.message}\n${refused.detail}`).not.toContain(wrong);
    expect(secrets.cloudflare).toBe(good);
    // Nothing stored yet: no promise about an old key.
    secrets.cloudflare = undefined;
    const fresh = (await deploy.connect("cloudflare", { key: wrong }).catch((caught: unknown) => caught)) as Error;

    expect(fresh.message).not.toContain("saved before");
    expect(secrets.cloudflare).toBeUndefined();
    // A key the host accepts is stored, and its accounts come back.
    expect(await deploy.connect("cloudflare", { key: `  ${good}  ` })).toEqual({ accounts: [{ id: ACCOUNT, name: "Studio account" }] });
    expect(secrets.cloudflare).toBe(good);
  });

  it("says plainly when there is no key, or the site isn't set up", async () => {
    const root = makeTinySite();
    const { harness, deploy } = await rig(root, { secrets: { cloudflare: undefined } });

    await expect(deploy.start(harness.site, { kind: "production" })).rejects.toMatchObject({ reason: "not-set-up" });
    await deploy.configure(harness.site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" });
    await expect(deploy.connect("cloudflare")).rejects.toMatchObject({ reason: "no-key", message: expect.stringContaining("CLOUDFLARE_API_TOKEN") });
    await expect(deploy.configure(harness.site, { project: "Not Valid" })).rejects.toMatchObject({ reason: "taken" });
  });

  it("redirects follow what's published: production takes the published vercel.json, a preview the edited one", async () => {
    fakeVercel = await startFakeVercel();
    const root = makeTinySite();
    const redirect = (to: string) => JSON.stringify({ redirects: [{ source: "/old", destination: to, permanent: true }] }, null, 2);

    writeFileSync(join(root, "vercel.json"), redirect("/published/"));
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Redirects");
    writeFileSync(join(root, "vercel.json"), redirect("/unpublished/"));
    const { harness, deploy } = await rig(root);

    await deploy.configure(harness.site, { target: "vercel", account: TEAM, project: "lowfield-studio" });
    await deploy.run(harness.site, { kind: "production" });
    expect(fakeVercel.deployments.at(-1)!.config).toEqual({ redirects: [{ source: "/old", destination: "/published/", permanent: true }] });
    await deploy.run(harness.site, { kind: "preview" });
    expect(fakeVercel.deployments.at(-1)!.config).toEqual({ redirects: [{ source: "/old", destination: "/unpublished/", permanent: true }] });
  });

  it("Vercel: a site that doesn't build creates no project", async () => {
    fakeVercel = await startFakeVercel();
    const root = makeTinySite();
    const { harness, deploy } = await rig(root);

    await deploy.configure(harness.site, { target: "vercel", account: TEAM, project: "lowfield-studio" });
    writeFileSync(join(root, "content/about.md"), "---\ntitle: BREAK\n---\n");
    await expect(deploy.run(harness.site, { kind: "preview" })).rejects.toMatchObject({ reason: "build" });
    expect(fakeVercel.projects.has("lowfield-studio")).toBe(false);
    expect(fakeVercel.log.some((entry) => entry.method !== "GET")).toBe(false);
  });

  it("a retry after a failed attempt adopts the empty Worker it left, instead of failing with “already exists”", async () => {
    const root = makeTinySite();
    const { harness, deploy } = await rig(root);

    // An older build of this app created the Worker before building; the build failed; the Worker stayed, empty.
    fakeCf!.scripts.set("lowfield-studio", { subdomain: true, previews: true });
    await deploy.configure(harness.site, { target: "cloudflare", account: ACCOUNT, project: "lowfield-studio" });
    await expect(deploy.run(harness.site, { kind: "production" })).resolves.toMatchObject({ kind: "production" });
    expect(fakeCf!.log.filter((entry) => entry.method === "POST" && entry.path.endsWith("/workers/workers"))).toHaveLength(0);
  });

  it("Vercel end to end: team, project, production and preview", async () => {
    fakeVercel = await startFakeVercel();
    const root = makeTinySite();
    const { harness, deploy } = await rig(root);
    const site = harness.site;

    expect((await deploy.connect("vercel")).accounts).toEqual([{ id: TEAM, name: "Studio" }]);
    await deploy.configure(site, { target: "vercel", account: TEAM, project: "lowfield-studio" });
    const production = await deploy.run(site, { kind: "production" });

    expect(production.url).toBe("https://lowfield-studio.vercel.app");
    expect(fakeVercel.deployments.at(-1)!.files.get("about/index.html")!.toString()).toBe("<h1>About us</h1>");
    writeFileSync(join(root, "content/about.md"), "---\ntitle: Preview me\n---\n");
    const preview = await deploy.run(site, { kind: "preview" });

    expect(preview.url).toMatch(/^https:\/\/lowfield-studio-.*-studio\.vercel\.app$/);
    expect(fakeVercel.deployments.at(-1)!.files.get("about/index.html")!.toString()).toBe("<h1>Preview me</h1>");
    expect((await site.model()).deploy?.productionUrl).toBe("https://lowfield-studio.vercel.app");
  });

  it("the environment's key wins over a stored one, and only its status is ever reported", async () => {
    const home = tempDir("deploy-settings-");
    const stored = createSettingsService({ home, env: {} });

    await stored.setSecret("cloudflare", "stored-cloudflare-key-0123456789abcdefgh");
    const fromEnv = createSettingsService({ home, env: { CLOUDFLARE_API_TOKEN: "env-cloudflare-key-0123456789abcdefghij", VERCEL_TOKEN: "env-vercel-key-0123456789" } });

    expect(await fromEnv.readSecret("cloudflare")).toBe("env-cloudflare-key-0123456789abcdefghij");
    expect(await fromEnv.readSecret("vercel")).toBe("env-vercel-key-0123456789");
    const statuses = (await fromEnv.get()).secrets.filter((secret) => secret.name === "cloudflare" || secret.name === "vercel");

    expect(statuses).toEqual([
      { name: "cloudflare", configured: true, source: "env", hint: "ghij" },
      { name: "vercel", configured: true, source: "env", hint: "6789" },
    ]);
    await expect(fromEnv.setSecret("cloudflare", "x".repeat(40))).rejects.toThrow("CLOUDFLARE_API_TOKEN");
    await expect(stored.setSecret("cloudflare", "not a key")).rejects.toThrow("doesn't look like a Cloudflare access key");
  });

  it("builds the real Astro starter's published version in a worktree with the site's packages", async () => {
    const root = makeSite({ nodeModules: true });
    const { harness, deploy } = await rig(root);

    await deploy.configure(harness.site, { target: "cloudflare", account: ACCOUNT, project: "astro-starter" });
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Online");
    const deployment = await deploy.run(harness.site, { kind: "production" });
    const live = fakeCf!.deployments.at(-1)!;

    expect(deployment.files).toBeGreaterThan(10);
    expect(live.files.has("index.html")).toBe(true);
    expect(live.files.has("404.html")).toBe(true);
    expect([...live.files.keys()].some((path) => path.startsWith("node_modules/") || path.startsWith(".git/"))).toBe(false);
    expect(sh(root, "worktree", "list").split("\n")).toHaveLength(1);
  }, 180_000);
});
