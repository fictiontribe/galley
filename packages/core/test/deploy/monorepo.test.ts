/**
 * A site in a monorepo sub-folder: its build imports a package installed only
 * at the repository root (pnpm layout: a link into `.pnpm`), a workspace
 * package linked into the site's node_modules by a relative path (with its
 * own node_modules), and a shared file by relative path. A live deploy must
 * build the published versions of the workspace package and the shared file;
 * a preview the edited ones.
 */
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createDeployService } from "../../src/deploy/index";
import { createEventBus } from "../../src/site/index";
import type { Settings } from "../../src/types";
import { disposeAll, openSite } from "../site/helpers";
import { cleanupAll, sh, tempDir, writeTree } from "../workspace/helpers";
import { startFakeCloudflare, type FakeCloudflare } from "./fakes/cloudflare";

const ACCOUNT = "acc0123456789abcdef0123456789abc";
let fake: FakeCloudflare | null = null;

afterEach(async () => {
  await disposeAll();
  await fake?.close();
  fake = null;
});
afterAll(cleanupAll);

function makeMonorepo(): string {
  const root = tempDir("deploy-mono-");

  writeTree(root, {
    "package.json": JSON.stringify({ name: "mono", private: true }),
    ".gitignore": "node_modules/\ndist/\n",
    "shared/banner.txt": "published banner\n",
    "packages/greeting/package.json": JSON.stringify({ name: "@demo/greeting", type: "module", exports: "./index.mjs" }),
    "packages/greeting/index.mjs": 'import { shout } from "shout-dep";\nexport const greeting = shout("published greeting");\n',
    "apps/site/package.json": JSON.stringify({ name: "@demo/site", private: true, type: "module" }),
    "apps/site/galley.config.json": JSON.stringify({ name: "Mono site", build: { command: "node build.mjs", outDir: "dist" } }),
    "apps/site/content/about.md": "---\ntitle: About\n---\nAbout.\n",
    "apps/site/content/contact.md": "---\ntitle: Contact\n---\nContact.\n",
    "apps/site/build.mjs": [
      'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
      'import { tool } from "root-tool";',
      'import { greeting } from "@demo/greeting";',
      'const banner = readFileSync("../../shared/banner.txt", "utf8").trim();',
      'mkdirSync("dist", { recursive: true });',
      'writeFileSync("dist/index.html", `<h1>${greeting}</h1><p>${tool()}</p><p>${banner}</p>`);',
      "",
    ].join("\n"),
  });
  // Installed, never committed: the root's package in pnpm's layout, and the workspace package's own dependency.
  writeTree(root, {
    "node_modules/.pnpm/root-tool@1.0.0/node_modules/root-tool/package.json": JSON.stringify({ name: "root-tool", type: "module", exports: "./index.mjs" }),
    "node_modules/.pnpm/root-tool@1.0.0/node_modules/root-tool/index.mjs": 'export const tool = () => "root tool";\n',
    "packages/greeting/node_modules/shout-dep/package.json": JSON.stringify({ name: "shout-dep", type: "module", exports: "./index.mjs" }),
    "packages/greeting/node_modules/shout-dep/index.mjs": "export const shout = (text) => text.toUpperCase();\n",
  });
  symlinkSync("./.pnpm/root-tool@1.0.0/node_modules/root-tool", join(root, "node_modules/root-tool"), "dir");
  mkdirSync(join(root, "apps/site/node_modules/@demo"), { recursive: true });
  symlinkSync("../../../../packages/greeting", join(root, "apps/site/node_modules/@demo/greeting"), "dir");
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "Published");
  return root;
}

describe("a site in a monorepo sub-folder", () => {
  it("goes live with the published workspace package and shared files; a preview with the edited ones", async () => {
    const root = makeMonorepo();
    const siteRoot = join(root, "apps/site");

    fake = await startFakeCloudflare();
    const bus = createEventBus();
    const deploy = createDeployService({
      home: tempDir("deploy-mono-home-"),
      settings: { readSecret: async () => fake!.token, get: async () => ({ author: { name: "Test Editor", email: "e@example.com" } }) as Settings, setSecret: async (name) => ({ name, configured: true, source: "stored" }) },
      events: bus,
      apiBase: { cloudflare: fake.api },
      env: {},
    });
    const { site } = await openSite(siteRoot, { events: bus });

    await deploy.configure(site, { target: "cloudflare", account: ACCOUNT, project: "mono-site" });
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Online settings");
    writeFileSync(join(root, "packages/greeting/index.mjs"), 'import { shout } from "shout-dep";\nexport const greeting = shout("edited greeting");\n');
    writeFileSync(join(root, "shared/banner.txt"), "edited banner\n");

    await deploy.run(site, { kind: "production" });
    expect(fake.deployments.at(-1)!.files.get("index.html")!.toString()).toBe("<h1>PUBLISHED GREETING</h1><p>root tool</p><p>published banner</p>");

    await deploy.run(site, { kind: "preview" });
    expect(fake.deployments.at(-1)!.files.get("index.html")!.toString()).toBe("<h1>EDITED GREETING</h1><p>root tool</p><p>edited banner</p>");

    // The working tree is untouched and the temporary checkout is gone.
    expect(readFileSync(join(root, "packages/greeting/index.mjs"), "utf8")).toContain("edited greeting");
    expect(sh(root, "worktree", "list").split("\n")).toHaveLength(1);
  }, 120_000);
});
