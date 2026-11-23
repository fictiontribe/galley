/**
 * "Set it up for me" on a real copy of the plain Astro starter as it was
 * before it shipped the site kit (test/fixtures/pre-kit-astro): what it
 * writes, the two wiring edits byte for byte, what it leaves when the site
 * is ambiguous, and that Discard takes all of it back.
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isPublicAddress, loadKitBundle, planSiteKit, runSiteKitSetup, setInboxEndpoint } from "../../src/site-kit/index";
import { disposeAll, openSite, sh, tempDir, writeTree } from "../site/helpers";

const FIXTURE = fileURLToPath(new URL("../fixtures/pre-kit-astro", import.meta.url));
const CAPTURE = "http://127.0.0.1:4620/f/test-site";

function preKitSite(change?: (root: string) => void): string {
  const root = tempDir("kit-setup-");

  cpSync(FIXTURE, root, { recursive: true });
  change?.(root);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "Initial");
  return root;
}

afterEach(disposeAll);

describe("Set it up for me", () => {
  it("adds the kit, a Contact form and the scripts setup, and wires the starter's config and layout surgically", async () => {
    const root = preKitSite();
    const { site } = await openSite(root);
    const before = await planSiteKit(site, { captureAddress: CAPTURE });

    expect(before.status.supported).toBe(true);
    expect(before.status.steps.map((step) => [step.id, step.state])).toEqual([
      ["files", "ready"],
      ["forms", "ready"],
      ["scripts", "ready"],
      ["collection", "ready"],
      ["layout", "ready"],
      ["visibility", "ready"],
    ]);
    const outcome = await runSiteKitSetup(site, { captureAddress: CAPTURE, build: false });
    const kit = await loadKitBundle();

    // Proof: the kit's files, the first form, the scripts setup, the two wiring edits — and nothing else.
    const changed = (await site.changes()).files.map((file) => file.path).sort();
    const expected = [
      ...Object.keys(kit.files).map((file) => `src/galley/${file}`),
      "src/galley/settings.json",
      "src/content/forms/contact.json",
      "src/data/scripts.json",
      "src/content.config.ts",
      "src/layouts/Base.astro",
      "astro.config.ts",
      "src/data/visibility.json",
    ].sort();

    expect(changed).toEqual(expected);
    expect(outcome.written.sort()).toEqual(expected);
    expect(outcome.status.ready).toBe(true);

    // The kit files are exactly what the kit's own vendoring script writes; settings point at the inbox.
    for (const [file, text] of Object.entries(kit.files)) expect(readFileSync(join(root, "src/galley", file), "utf8"), file).toBe(text);
    // This computer's address is never written into a file that is published: the preview is handed it as pages load.
    expect(JSON.parse(readFileSync(join(root, "src/galley/settings.json"), "utf8")).forms.endpoint).toBe("");
    expect(outcome.status.inbox).toEqual({ used: true, endpoint: null, settable: true, address: CAPTURE, reachable: false });
    expect(JSON.parse(readFileSync(join(root, "src/content/forms/contact.json"), "utf8")).name).toBe("Contact");
    expect(JSON.parse(readFileSync(join(root, "src/data/scripts.json"), "utf8"))).toEqual({ consent: { mode: "banner", googleConsentMode: true }, scripts: [] });

    // The wiring diffs, line for line.
    expect(sh(root, "diff", "-U0", "--", "src/content.config.ts").split("\n").filter((line) => /^[+-][^+-]/.test(line))).toEqual([
      '+import { formSchema } from "./galley/schema.js";',
      "-export const collections = { pages, blog, team };",
      '+const forms = defineCollection({ loader: glob({ pattern: "*.json", base: "./src/content/forms" }), schema: formSchema });',
      "+export const collections = { pages, blog, team, forms };",
    ]);
    expect(sh(root, "diff", "-U0", "--", "src/layouts/Base.astro").split("\n").filter((line) => /^[+-][^+-]/.test(line))).toEqual([
      '+import { Scripts } from "../galley/components/index.js";',
      '+    <Scripts placement="head" />',
      '+    <Scripts placement="body-start" />',
      '+    <Scripts placement="body-end" />',
    ]);
    expect(sh(root, "diff", "-U0", "--", "astro.config.ts").split("\n").filter((line) => /^[+-][^+-]/.test(line))).toEqual([
      '+import galley from "./src/galley/integration.js";',
      "+  integrations: [galley()],",
    ]);
    // The starters' defaults: articles only for the dated posts with pages (the journal), the privacy page as secondary.
    const visibility = JSON.parse(readFileSync(join(root, "src/data/visibility.json"), "utf8"));

    expect(visibility.structuredData.articles).toEqual(["blog"]);
    expect(visibility.agentReadable).toMatchObject({ llmsTxt: true, llmsFullTxt: true, markdownTwins: true, agentPage: true, optional: ["/privacy/"] });

    // The screens work straight away: the model knows the forms collection and the scripts setup as kit files.
    const model = await site.model();

    expect(model.kit).toEqual({ source: "vendored", version: kit.version, allowFormScripts: false });
    expect(model.collections.find((collection) => collection.kit === "forms")?.path).toBe("src/content/forms");
    expect(model.collections.find((collection) => collection.kit === "scripts")?.path).toBe("src/data/scripts.json");
    expect(await site.validate()).toEqual([]);

    // Running it again changes nothing.
    const again = await runSiteKitSetup(site, { captureAddress: CAPTURE, build: false });

    expect(again.written).toEqual([]);

    // Discard takes all of it back.
    await site.discard();
    expect((await site.changes()).files).toEqual([]);
    // Git keeps no folders, so Discard leaves src/galley/'s empty folders behind and nothing in them.
    expect(existsSync(join(root, "src/galley/schema.js"))).toBe(false);
    expect(sh(root, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(root, "src/content.config.ts"), "utf8")).toBe(readFileSync(join(FIXTURE, "src/content.config.ts"), "utf8"));
    expect(readFileSync(join(root, "src/layouts/Base.astro"), "utf8")).toBe(readFileSync(join(FIXTURE, "src/layouts/Base.astro"), "utf8"));
    expect(readFileSync(join(root, "astro.config.ts"), "utf8")).toBe(readFileSync(join(FIXTURE, "astro.config.ts"), "utf8"));
    expect((await site.model()).kit).toBeUndefined();
  }, 180_000);

  it("does everything else when the config and layout are ambiguous, and says exactly what is left", async () => {
    const root = preKitSite((dir) => {
      const config = readFileSync(join(dir, "src/content.config.ts"), "utf8");

      writeFileSync(join(dir, "src/content.config.ts"), config.replace("export const collections = { pages, blog, team };", "const all = { pages, blog, team };\nexport const collections = { ...all };"));
      writeFileSync(join(dir, "src/layouts/Landing.astro"), "---\n---\n<html><head><title>x</title></head><body><slot /></body></html>\n");
      writeFileSync(join(dir, "astro.config.ts"), 'import { defineConfig } from "astro/config";\nimport { integrations } from "./integrations.mjs";\n\nexport default defineConfig({\n  integrations: integrations(),\n});\n');
    });
    const { site } = await openSite(root);
    const outcome = await runSiteKitSetup(site, { captureAddress: CAPTURE, build: false });
    const steps = Object.fromEntries(outcome.status.steps.map((step) => [step.id, step]));

    expect(steps.files?.state).toBe("done");
    expect(steps.forms?.state).toBe("done");
    expect(steps.scripts?.state).toBe("done");
    expect(steps.collection?.state).toBe("left");
    expect(steps.collection?.detail).toBe("src/content.config.ts spreads collections in from elsewhere, so where the forms collection goes isn’t clear.");
    expect(steps.collection?.snippet?.code).toContain('forms: defineCollection({ loader: glob({ pattern: "*.json", base: "./src/content/forms" }), schema: formSchema }),');
    expect(steps.layout?.state).toBe("left");
    expect(steps.layout?.detail).toMatch(/^2 files write their own <html>, <head> and <body> \(src\/layouts\/Base\.astro, src\/layouts\/Landing\.astro\)/);
    expect(steps.visibility?.state).toBe("left");
    expect(steps.visibility?.detail).toBe("astro.config.ts builds its integrations with code, so where the kit’s build step goes isn’t clear.");
    expect(steps.visibility?.snippet?.code).toContain('import galley from "./src/galley/integration.js";');
    expect(outcome.status.ready).toBe(false);
    expect(outcome.status.assistantRequest).toContain("publish a version AI assistants can read (astro.config.ts: ");
    expect(outcome.status.assistantRequest).toMatch(/^Finish setting up the site kit on this site\. Use build mode: connect forms to the site’s content \(src\/content\.config\.ts: /);
    // The site's own code is untouched.
    const changed = (await site.changes()).files.map((file) => file.path);

    expect(changed).not.toContain("src/content.config.ts");
    expect(changed).not.toContain("src/layouts/Base.astro");
    expect(changed).not.toContain("src/layouts/Landing.astro");
    expect(changed).not.toContain("astro.config.ts");
    // The data file is harmless on its own, so it is written; turning the build step on is left.
    expect(changed).toContain("src/data/visibility.json");
  }, 180_000);

  it("on a site that has the kit but not its build step, turns on only the AI-readable version", async () => {
    const root = preKitSite();
    const { site } = await openSite(root);

    await runSiteKitSetup(site, { build: false });
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Kit");
    // As a site set up before the kit could publish it: no build step, no data file.
    writeFileSync(join(root, "astro.config.ts"), readFileSync(join(FIXTURE, "astro.config.ts"), "utf8"));
    sh(root, "rm", "-q", "src/data/visibility.json");
    sh(root, "commit", "-qam", "Before the AI-readable version");
    const plan = await planSiteKit(site);

    expect(plan.status.steps.filter((step) => step.state !== "done").map((step) => [step.id, step.state])).toEqual([["visibility", "ready"]]);
    const outcome = await runSiteKitSetup(site, { build: false, only: ["files", "visibility"] });

    expect(outcome.written.sort()).toEqual(["astro.config.ts", "src/data/visibility.json"]);
    expect(outcome.status.ready).toBe(true);
    expect((await runSiteKitSetup(site, { build: false, only: ["files", "visibility"] })).written).toEqual([]);
  }, 180_000);

  it("writes the inbox address only when visitors can reach it, and changes only that line", async () => {
    const root = preKitSite();
    const { site } = await openSite(root);
    const PUBLIC = "https://cms.example.com/f/test-site";

    await runSiteKitSetup(site, { captureAddress: PUBLIC, captureReachable: true, build: false });
    expect(JSON.parse(readFileSync(join(root, "src/galley/settings.json"), "utf8")).forms.endpoint).toBe(PUBLIC);
    expect((await planSiteKit(site, { captureAddress: PUBLIC, captureReachable: true })).status.inbox).toMatchObject({ used: true, endpoint: PUBLIC });

    const settings = readFileSync(join(root, "src/galley/settings.json"), "utf8");

    writeFileSync(join(root, "src/galley/settings.json"), settings.replace(PUBLIC, ""));
    await expect(setInboxEndpoint(site, "http://127.0.0.1:4620/f/test-site")).rejects.toThrow(/can't reach/);
    await setInboxEndpoint(site, "https://forms.example.org/f/test-site");
    expect(readFileSync(join(root, "src/galley/settings.json"), "utf8")).toBe(settings.replace(PUBLIC, "https://forms.example.org/f/test-site"));
    expect([isPublicAddress("http://localhost:4400/f/x"), isPublicAddress("http://192.168.1.4/f/x"), isPublicAddress("https://galley.internal/f/x"), isPublicAddress("https://cms.example.com/f/x")]).toEqual([false, false, false, true]);
  }, 180_000);

  it("says plainly that the kit is Astro-only on another framework, and writes nothing", async () => {
    const root = tempDir("kit-setup-hugo-");

    cpSync(fileURLToPath(new URL("../fixtures/hugo-site", import.meta.url)), root, { recursive: true });
    sh(root, "init", "-q", "-b", "main");
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "Initial");
    const { site } = await openSite(root);
    const plan = await planSiteKit(site);

    expect(plan.status.supported).toBe(false);
    expect(plan.status.reason).toMatch(/^The site kit works with Astro sites today, and this site is built with Hugo\./);
    await expect(runSiteKitSetup(site, { build: false })).rejects.toThrow(/Astro sites today/);
    expect((await site.changes()).files).toEqual([]);
  });

  it("refuses before writing anything when the site doesn't allow build mode", async () => {
    const root = preKitSite((dir) => writeFileSync(join(dir, "galley.config.json"), `${JSON.stringify({ ai: { allowBuild: false } })}\n`));
    const { site } = await openSite(root);

    await expect(runSiteKitSetup(site, { build: false })).rejects.toThrow(/turn that off/);
    expect((await site.changes()).files).toEqual([]);
  });

  it("leaves a src/galley/ that holds someone else's files alone", async () => {
    const root = preKitSite((dir) => writeTree(dir, { "src/galley/notes.md": "Our own notes.\n" }));
    const { site } = await openSite(root);
    const plan = await planSiteKit(site);
    const files = plan.status.steps.find((step) => step.id === "files");

    expect(files?.state).toBe("left");
    expect(files?.detail).toMatch(/src\/galley\/notes\.md/);
    expect([...plan.writes.keys()].some((path) => path.startsWith("src/galley/"))).toBe(false);
  });
});
