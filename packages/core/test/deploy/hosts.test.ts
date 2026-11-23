/**
 * Each host's upload protocol against a fake that implements it strictly:
 * every file arrives with the right bytes under the right hash, unchanged
 * files aren't sent twice, and a wrong step is refused the way the host would.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { collectFiles, createCloudflareTarget, createVercelTarget, DeployError, type DeployContext, type DeployInput } from "../../src/deploy/index";
import { cleanupAll, tempDir, writeTree } from "../workspace/helpers";
import { cfHashOf, startFakeCloudflare, type FakeCloudflare } from "./fakes/cloudflare";
import { startFakeVercel, type FakeVercel } from "./fakes/vercel";

afterAll(cleanupAll);

const SITE: Record<string, string | Uint8Array> = {
  "index.html": "<h1>Home</h1>",
  "about/index.html": "<h1>About</h1>",
  "404.html": "<h1>Not here</h1>",
  "styles/site.css": "body{margin:0}",
  "img/logo.svg": "<svg/>",
  "img/photo.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
  // Same bytes as another file: one upload, two paths.
  "copy/index.html": "<h1>Home</h1>",
};

async function siteFiles(files = SITE) {
  const dir = tempDir("deploy-host-");

  writeTree(dir, files);
  return { dir, files: await collectFiles(dir, { maxFiles: 1000, maxFileBytes: null, maxTotalBytes: null }, "Host", "dist") };
}

function input(dir: string, files: DeployInput["files"], extra: Partial<DeployInput> = {}): DeployInput & { progress: string[] } {
  const progress: string[] = [];

  return { project: "lowfield-studio", account: "", dir, files, kind: "production", commit: "abc1234def", onProgress: ({ detail }) => progress.push(detail), progress, ...extra };
}

describe("Cloudflare (Workers static assets, Direct Upload)", () => {
  let fake: FakeCloudflare;
  const target = createCloudflareTarget();
  const ctx = (token = fake.token): DeployContext => ({ token, fetch, apiBase: fake.api });
  const ACCOUNT = "acc0123456789abcdef0123456789abc";

  afterEach(async () => fake?.close());

  it("lists the accounts the key can use", async () => {
    fake = await startFakeCloudflare();
    expect(await target.connect(ctx())).toEqual({ accounts: [{ id: ACCOUNT, name: "Studio account" }] });
  });

  it("says what the key reaches truthfully whether it covers one account or all of them, and how to narrow it", () => {
    // The pre-filled page starts with every account, so a key may well cover more than one.
    expect(target.info.keyUrl).toContain("accountId=%2A");
    expect(target.info.keyGrants).not.toMatch(/that one account/);
    expect(target.info.keyGrants).toMatch(/the accounts the key covers/);
    expect(target.info.narrowKey).toEqual({ text: expect.stringContaining("Account Resources"), url: "https://dash.cloudflare.com/profile/api-tokens" });
    expect(createVercelTarget().info.narrowKey).toBeUndefined();
  });

  it("creates the Worker with its addresses on, then deploys every file with matching hashes", async () => {
    fake = await startFakeCloudflare();
    const { dir, files } = await siteFiles();

    expect(await target.checkProject(ctx(), { account: ACCOUNT, name: "lowfield-studio" })).toEqual({
      name: "lowfield-studio",
      available: true,
      existing: false,
      productionUrl: "https://lowfield-studio.studio.workers.dev",
    });
    const project = await target.ensureProject(ctx(), { account: ACCOUNT, name: "lowfield-studio" });

    expect(project).toEqual({ project: "lowfield-studio", productionUrl: "https://lowfield-studio.studio.workers.dev" });
    expect(fake.scripts.get("lowfield-studio")).toEqual({ subdomain: true, previews: true });
    const run = input(dir, files, { account: ACCOUNT });
    const outcome = await target.deploy(ctx(), run);

    expect(outcome).toMatchObject({ kind: "production", url: "https://lowfield-studio.studio.workers.dev", productionUrl: "https://lowfield-studio.studio.workers.dev" });
    const deployed = fake.deployments.at(-1)!;

    expect(deployed.kind).toBe("production");
    expect([...deployed.files.keys()].sort()).toEqual(Object.keys(SITE).sort());
    for (const [path, content] of Object.entries(SITE)) expect(deployed.files.get(path)!.equals(Buffer.from(content))).toBe(true);
    // Two paths share bytes and extension: one part uploaded for both.
    expect(fake.uploadedParts).toBe(Object.keys(SITE).length - 1);
    expect(deployed.metadata).toMatchObject({
      main_module: "site.mjs",
      bindings: [{ type: "assets", name: "ASSETS" }],
      assets: { config: { html_handling: "auto-trailing-slash", not_found_handling: "404-page" } },
      annotations: { "workers/tag": "abc1234def" },
    });
    expect(deployed.moduleType).toBe("application/javascript+module");
    // Uploads used the session jwt; every other call the account key.
    expect(fake.log.filter((entry) => entry.path.endsWith("/workers/assets/upload")).every((entry) => entry.auth === "upload")).toBe(true);
    expect(fake.log.filter((entry) => !entry.path.endsWith("/workers/assets/upload")).every((entry) => entry.auth === "account")).toBe(true);
    expect(run.progress).toContain("Uploading 6 files…");
    expect(run.progress.at(-1)).toBe("Cloudflare is putting it live…");
  });

  it("sends only what changed the second time, and a preview is a version with its own address", async () => {
    fake = await startFakeCloudflare();
    const { dir, files } = await siteFiles();

    await target.ensureProject(ctx(), { account: ACCOUNT, name: "lowfield-studio" });
    await target.deploy(ctx(), input(dir, files, { account: ACCOUNT }));
    const before = fake.uploadedParts;
    const changed = await siteFiles({ ...SITE, "index.html": "<h1>Home, edited</h1>" });
    const outcome = await target.deploy(ctx(), input(changed.dir, changed.files, { account: ACCOUNT, kind: "preview", label: "For Sam" }));

    expect(fake.uploadedParts - before).toBe(1);
    const version = fake.deployments.at(-1)!;

    expect(version.kind).toBe("preview");
    expect(version.files.get("index.html")!.toString()).toBe("<h1>Home, edited</h1>");
    expect(version.files.get("copy/index.html")!.toString()).toBe("<h1>Home</h1>");
    expect(version.metadata.annotations["workers/message"]).toBe("For Sam");
    expect(outcome.url).toBe(`https://${version.id.slice(0, 8)}-lowfield-studio.studio.workers.dev`);
    expect(outcome.productionUrl).toBeUndefined();

    // Nothing changed at all: no buckets, and the session's own jwt completes the upload.
    const parts = fake.uploadedParts;

    await target.deploy(ctx(), input(changed.dir, changed.files, { account: ACCOUNT, kind: "preview" }));
    expect(fake.uploadedParts).toBe(parts);
  });

  it("the fake refuses a wrong step: account key on the upload, a part that doesn't match its hash, no manifest", async () => {
    fake = await startFakeCloudflare();
    const base = `${fake.api}/accounts/${ACCOUNT}`;
    const auth = { authorization: `Bearer ${fake.token}`, "content-type": "application/json" };

    expect((await fetch(`${base}/workers/scripts/x/assets-upload-session`, { method: "POST", headers: auth, body: JSON.stringify({}) })).status).toBe(400);
    const session: any = await (await fetch(`${base}/workers/scripts/x/assets-upload-session`, { method: "POST", headers: auth, body: JSON.stringify({ manifest: { "/a.html": { hash: cfHashOf(Buffer.from("A").toString("base64"), "/a.html"), size: 1 } } }) })).json();
    const hash = session.result.buckets[0][0];
    const form = () => {
      const data = new FormData();

      data.append(hash, new Blob([Buffer.from("B").toString("base64")], { type: "text/html" }), hash);
      return data;
    };

    expect((await fetch(`${base}/workers/assets/upload?base64=true`, { method: "POST", headers: { authorization: `Bearer ${fake.token}` }, body: form() })).status).toBe(401);
    const mismatch = await fetch(`${base}/workers/assets/upload?base64=true`, { method: "POST", headers: { authorization: `Bearer ${session.result.jwt}` }, body: form() });

    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).toContain("hash mismatch");
  });

  it("says which permission is missing, and when the account has no workers.dev address", async () => {
    fake = await startFakeCloudflare({ noWorkersPermission: true });
    const error = await target.checkProject(ctx(), { account: ACCOUNT, name: "lowfield-studio" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DeployError);
    expect(error).toMatchObject({ reason: "permission" });
    expect((error as Error).message).toContain("Account › Workers Scripts › Edit");
    await fake.close();

    fake = await startFakeCloudflare({ subdomain: null });
    await expect(target.ensureProject(ctx(), { account: ACCOUNT, name: "lowfield-studio" })).rejects.toMatchObject({ reason: "account-setup", message: expect.stringContaining("workers.dev address") });
    await fake.close();

    fake = await startFakeCloudflare();
    await expect(target.connect(ctx("not-the-key-0123456789abcdefghijkl"))).rejects.toMatchObject({ reason: "unauthorized", message: expect.stringContaining("didn't accept the access key") });
  });

  it("works with a key that can't list accounts (the account is typed instead)", async () => {
    fake = await startFakeCloudflare({ hideAccounts: true });
    expect(await target.connect(ctx())).toEqual({ accounts: [] });
    expect(await target.checkProject(ctx(), { account: ACCOUNT, name: "lowfield-studio" })).toMatchObject({ available: true });
  });

  it("reports an existing Worker as usable, with a caution", async () => {
    fake = await startFakeCloudflare();
    fake.scripts.set("taken", { subdomain: true, previews: true });
    expect(await target.checkProject(ctx(), { account: ACCOUNT, name: "taken" })).toMatchObject({ available: true, existing: true, message: expect.stringContaining("replaces what it serves") });
    expect(await target.checkProject(ctx(), { account: ACCOUNT, name: "Bad Name" })).toMatchObject({ available: false });
  });
});

describe("Vercel (REST: files by SHA, then a deployment)", () => {
  let fake: FakeVercel;
  const target = createVercelTarget();
  const ctx = (token = fake.token): DeployContext => ({ token, fetch, apiBase: fake.url });
  const TEAM = "team_0123456789abcdef";

  afterEach(async () => fake?.close());

  it("lists teams, default first", async () => {
    fake = await startFakeVercel({ teams: [{ id: "team_b", slug: "b", name: "B" }, { id: TEAM, slug: "studio", name: "Studio" }] });
    // The fake's default team is its first; here that's team_b.
    expect((await target.connect(ctx())).accounts.map((account) => account.id)).toEqual(["team_b", TEAM]);
  });

  it("creates the project, uploads every file by SHA-1 and deploys to production", async () => {
    fake = await startFakeVercel();
    const { dir, files } = await siteFiles();

    expect(await target.checkProject(ctx(), { account: TEAM, name: "lowfield-studio" })).toEqual({ name: "lowfield-studio", available: true, existing: false });
    await target.ensureProject(ctx(), { account: TEAM, name: "lowfield-studio" });
    expect(fake.projects.get("lowfield-studio")).toEqual({ teamId: TEAM, deployments: 0 });
    const run = input(dir, files, { account: TEAM });
    const outcome = await target.deploy(ctx(), run);
    const deployed = fake.deployments.at(-1)!;

    expect(deployed.kind).toBe("production");
    expect(deployed.body.projectSettings).toMatchObject({ framework: null });
    expect([...deployed.files.keys()].sort()).toEqual(Object.keys(SITE).sort());
    for (const [path, content] of Object.entries(SITE)) expect(deployed.files.get(path)!.equals(Buffer.from(content))).toBe(true);
    expect(fake.uploads).toBe(Object.keys(SITE).length - 1);
    expect(outcome).toMatchObject({ kind: "production", url: "https://lowfield-studio.vercel.app", productionUrl: "https://lowfield-studio.vercel.app" });
    expect(run.progress).toContain("Vercel is putting it live…");
  });

  it("a preview has no target and its own address; files Vercel lost are sent again", async () => {
    fake = await startFakeVercel({ forgetOnce: true });
    const { dir, files } = await siteFiles();

    await target.ensureProject(ctx(), { account: TEAM, name: "lowfield-studio" });
    const outcome = await target.deploy(ctx(), input(dir, files, { account: TEAM, kind: "preview" }));
    const deployed = fake.deployments.at(-1)!;

    expect(deployed.body.target).toBeUndefined();
    expect(outcome.url).toBe(`https://lowfield-studio-${deployed.id.slice(4, 13)}-studio.vercel.app`);
    expect(outcome.productionUrl).toBeUndefined();
    expect(fake.uploads).toBe(Object.keys(SITE).length);
  });

  it("refuses a wrong digest, and explains a refused key or a failed deployment", async () => {
    fake = await startFakeVercel({ failBuild: true });
    const bad = await fetch(`${fake.url}/v2/files`, { method: "POST", headers: { authorization: `Bearer ${fake.token}`, "x-vercel-digest": "0".repeat(40) }, body: "hello" });

    expect(bad.status).toBe(400);
    await expect(target.connect(ctx("nope-nope-nope-nope-nope"))).rejects.toMatchObject({ reason: "unauthorized", message: expect.stringContaining("didn't accept the access key") });
    const { dir, files } = await siteFiles();

    await target.ensureProject(ctx(), { account: TEAM, name: "lowfield-studio" });
    await expect(target.deploy(ctx(), input(dir, files, { account: TEAM }))).rejects.toMatchObject({ reason: "host", message: expect.stringContaining("couldn't finish") });
  });
});
