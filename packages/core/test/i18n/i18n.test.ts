/**
 * Multilingual / i18n core engine tests:
 * - Astro astro.config.* static i18n detection (string & object locales, RTL)
 * - galley.config.json i18n schema validation
 * - Folder & suffix slug mapping, localized URLs, index protection, internal link rewriting
 * - Schema-safe galley/i18n/manifest.json & source-hash out-of-sync detection
 * - Translation Memory exact + fuzzy matching & 0-cost reuse without an AI key
 * - Glossary seeding & prompt injection
 * - Upfront cost & AI credit estimation (GALLEY_AI_CREDIT_MILLICENTS)
 * - Full AI batch translation job writing to Proof & recording usage
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createSettingsService } from "../../src/ai/settings";
import { validateConfig } from "../../src/content/config/schema";
import { detectSite } from "../../src/content/detect/detect";
import {
  createI18nService,
  detectSlugLocale,
  formatGlossaryPrompt,
  localizedEntryUrl,
  MemoryIndex,
  normalizeI18nConfig,
  rewriteMarkdownLinks,
  rewriteUrlValue,
  sanitizeLocalizedSlug,
  targetEntrySlug,
} from "../../src/i18n";
import { createEventBus, createSiteService } from "../../src/site";

const starter = fileURLToPath(new URL("../../../../starters/astro-starter", import.meta.url));
const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length) {
    const dir = cleanup.pop()!;

    rmSync(dir, { recursive: true, force: true });
  }
});

async function makeSiteFixture(options?: { astroI18n?: string }) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-i18n-core-")));

  cleanup.push(tmp);
  const root = join(tmp, "site");
  const home = join(tmp, "home");

  cpSync(starter, root, { recursive: true, filter: (src) => !["node_modules", ".astro", "dist"].includes(basename(src)) });

  // Add a clean pricing page with internal links and a fenced code block for translation tests.
  writeFileSync(
    join(root, "src/content/pages/pricing.md"),
    [
      "---",
      'title: "Simple pricing"',
      'description: "Transparent plans for architectural projects of every size."',
      "---",
      "",
      "Get in touch to discuss your project.",
      "",
      "Read our [Home page](/) or visit [About](/about/) for studio details.",
      "",
      "```ts",
      'const untouched = "do not translate code";',
      "```",
      "",
    ].join("\n"),
    "utf8"
  );

  const astroConfigName = ["astro.config.mjs", "astro.config.ts", "astro.config.js"].find((f) => existsSync(join(root, f))) ?? "astro.config.mjs";

  if (options?.astroI18n) {
    const astroPath = join(root, astroConfigName);
    const current = readFileSync(astroPath, "utf8");

    writeFileSync(astroPath, current.replace("defineConfig({", `defineConfig({\n  i18n: ${options.astroI18n},`), "utf8");
  }

  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

  git("init", "-q");
  git("symbolic-ref", "HEAD", "refs/heads/main");
  git("config", "user.name", "I18n Test");
  git("config", "user.email", "i18n@example.invalid");
  git("add", "-A");
  git("commit", "-q", "-m", "Initial");

  const events = createEventBus();
  const settings = createSettingsService({ home, env: { PATH: process.env.PATH, HOME: tmp } });
  const site = await createSiteService(root, { id: "site-i18n", events, overlayScript: () => "", author: async () => null, watch: false });

  return { tmp, root, astroConfigName, home, events, settings, site };
}

describe("i18n config schema & Astro detection", () => {
  it("validates galley.config.json i18n block and rejects invalid defaults or duplicates", () => {
    const ok = validateConfig({
      i18n: {
        defaultLocale: "en",
        locales: [
          { code: "en", label: "English" },
          { code: "es", label: "Español" },
          { code: "ar", label: "العربية", direction: "rtl" },
        ],
        strategy: "folder",
        prefixDefaultLocale: false,
        localizeSlugs: true,
      },
    });

    expect(ok.ok).toBe(true);

    const missingDefault = validateConfig({
      i18n: {
        defaultLocale: "fr",
        locales: [{ code: "en", label: "English" }],
      },
    });

    expect(missingDefault.ok).toBe(false);

    const dup = validateConfig({
      i18n: {
        defaultLocale: "en",
        locales: [
          { code: "en", label: "English" },
          { code: "EN", label: "English UK" },
        ],
      },
    });

    expect(dup.ok).toBe(false);
  });

  it("statically detects Astro i18n config including object locales and RTL direction", async () => {
    const { root } = await makeSiteFixture({
      astroI18n: `{ defaultLocale: "en", locales: ["en", { path: "mexico", codes: ["es-MX", "es"] }, "ar"], routing: { prefixDefaultLocale: true } }`,
    });
    const model = await detectSite(root);

    expect(model.i18n).toBeDefined();
    expect(model.i18n?.defaultLocale).toBe("en");
    expect(model.i18n?.prefixDefaultLocale).toBe(true);
    expect(model.i18n?.locales.map((l) => l.code)).toEqual(["en", "es-MX", "ar"]);
    expect(model.i18n?.locales[1]?.prefix).toBe("mexico");
    expect(model.i18n?.locales[2]?.direction).toBe("rtl");
  });
});

describe("slugs, localized URLs & internal link rewriting", () => {
  const config = normalizeI18nConfig({
    defaultLocale: "en",
    locales: [
      { code: "en", label: "English" },
      { code: "es", label: "Español" },
      { code: "fr", label: "Français" },
    ],
    strategy: "folder",
    prefixDefaultLocale: false,
    localizeSlugs: true,
  });

  it("handles folder & suffix strategies, keeps index intact, and builds localized URLs", () => {
    expect(detectSlugLocale("pricing", config)).toEqual({ locale: "en", baseSlug: "pricing", isDefault: true });
    expect(detectSlugLocale("es/precios", config)).toEqual({ locale: "es", baseSlug: "precios", isDefault: false });
    expect(sanitizeLocalizedSlug("Precios y Planes!", "pricing")).toBe("precios-y-planes");
    expect(sanitizeLocalizedSlug("inicio", "index")).toBe("index");

    expect(targetEntrySlug("precios", "es", config)).toBe("es/precios");
    expect(localizedEntryUrl("/{slug}/", "pricing", "en", config)).toBe("/pricing/");
    expect(localizedEntryUrl("/{slug}/", "precios", "es", config)).toBe("/es/precios/");
    expect(localizedEntryUrl("/{slug}/", "index", "es", config)).toBe("/es/");

    const prefixed = normalizeI18nConfig({ ...config, prefixDefaultLocale: true });

    expect(localizedEntryUrl("/{slug}/", "pricing", "en", prefixed)).toBe("/en/pricing/");

    const suffix = normalizeI18nConfig({ ...config, strategy: "suffix" });

    expect(targetEntrySlug("precios", "es", suffix)).toBe("precios.es");
    expect(detectSlugLocale("precios.es", suffix)).toEqual({ locale: "es", baseSlug: "precios", isDefault: false });
  });

  it("rewrites internal Markdown links and URL fields while skipping fenced code and images", () => {
    const urlMap = new Map<string, string>([
      ["/pricing", "/es/precios/"],
      ["/about", "/es/sobre-nosotros/"],
    ]);

    expect(rewriteUrlValue("/pricing/#plans", urlMap)).toBe("/es/precios/#plans");
    expect(rewriteUrlValue("https://external.example/pricing", urlMap)).toBe("https://external.example/pricing");

    const md = [
      "See [Pricing](/pricing/#pro) and ![Photo](/pricing/hero.jpg).",
      "",
      "```md",
      "[Stay untouched](/pricing/)",
      "```",
    ].join("\n");
    const rewritten = rewriteMarkdownLinks(md, urlMap);

    expect(rewritten).toContain("[Pricing](/es/precios/#pro)");
    expect(rewritten).toContain("![Photo](/pricing/hero.jpg)");
    expect(rewritten).toContain("[Stay untouched](/pricing/)");
  });
});

describe("I18nService: manifest out-of-sync, TM 0-cost reuse, glossary, cost math & AI batch job", () => {
  it("tracks manual drafts, detects outdated translations when source changes, and syncs astro.config.*", async () => {
    const { root, astroConfigName, events, settings, site } = await makeSiteFixture();
    const service = createI18nService({ settings, events });

    const overview = await service.saveConfig(site, {
      defaultLocale: "en",
      locales: [
        { code: "en", label: "English" },
        { code: "es", label: "Español" },
      ],
      strategy: "folder",
      prefixDefaultLocale: false,
      localizeSlugs: true,
      syncAstroConfig: true,
    });

    expect(overview.configured).toBe(true);
    expect(overview.glossaryCount).toBeGreaterThanOrEqual(1); // auto-seeded brand term
    expect(readFileSync(join(root, astroConfigName), "utf8")).toContain('defaultLocale: "en"');

    // Seed Translation Memory so manual creation reuses exact matches automatically.
    await service.saveMemory(site, {
      version: 1,
      entries: [
        {
          id: "m1",
          sourceLocale: "en",
          targetLocale: "es",
          source: "Simple pricing",
          target: "Precios sencillos",
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    const created = await service.createEntry(site, {
      sourcePath: "src/content/pages/pricing.md",
      targetLocale: "es",
      localizedSlug: "precios",
    });

    expect(created.path).toBe("src/content/pages/es/precios.md");
    expect(created.url).toBe("/es/precios/");
    expect(created.reusedSegments).toBe(1);
    expect(created.entry.data.title).toBe("Precios sencillos");

    // Initially up to date; editing the source page flags the Spanish translation as "outdated"!
    const beforeEdit = await service.entryDetail(site, created.path);

    expect(beforeEdit.outdated).toBe(false);
    expect(beforeEdit.sourceData?.title).toBe("Simple pricing");
    expect(beforeEdit.tmMatches.title?.target).toBe("Precios sencillos");

    await site.updateEntry(
      "src/content/pages/pricing.md",
      [{ op: "set", path: ["title"], value: "Updated pricing tiers" }],
      { origin: "user" }
    );

    const afterEdit = await service.entryDetail(site, created.path);

    expect(afterEdit.outdated).toBe(true);
    expect(afterEdit.state).toBe("outdated");

    await site.dispose();
    service.dispose();
  });

  it("computes accurate USD/credits + TM savings and runs 0-cost TM-only batches without an AI key", async () => {
    const { events, settings, site } = await makeSiteFixture();
    const service = createI18nService({
      settings,
      events,
      env: { PATH: process.env.PATH, GALLEY_AI_CREDIT_MILLICENTS: "250" },
    });

    await service.saveConfig(site, {
      defaultLocale: "en",
      locales: [
        { code: "en", label: "English" },
        { code: "es", label: "Español" },
      ],
    });

    const initialPlan = await service.planTranslation(site, {
      paths: ["src/content/pages/pricing.md"],
      targetLocales: ["es"],
    });

    expect(initialPlan.connected).toBe(false);
    expect(initialPlan.requests).toBe(1);
    expect(initialPlan.estimatedInputTokens).toBeGreaterThan(400);
    expect(initialPlan.estimatedOutputTokens).toBeGreaterThan(90);
    expect(initialPlan.estimatedUsd).toBeGreaterThan(0);
    expect(initialPlan.estimatedCredits).toBeGreaterThan(0);

    // Populate Translation Memory for EVERY segment on pricing.md → 0 requests, 0 credits, $0.00!
    await service.saveMemory(site, {
      version: 1,
      entries: [
        { id: "1", sourceLocale: "en", targetLocale: "es", source: "Simple pricing", target: "Precios sencillos", updatedAt: "" },
        {
          id: "2",
          sourceLocale: "en",
          targetLocale: "es",
          source: "Transparent plans for architectural projects of every size.",
          target: "Planes transparentes para proyectos de arquitectura de todos los tamaños.",
          updatedAt: "",
        },
        {
          id: "3",
          sourceLocale: "en",
          targetLocale: "es",
          source: "Get in touch to discuss your project.",
          target: "Ponte en contacto para hablar de tu proyecto.",
          updatedAt: "",
        },
        {
          id: "4",
          sourceLocale: "en",
          targetLocale: "es",
          source: "Read our [Home page](/) or visit [About](/about/) for studio details.",
          target: "Lee nuestra [página de inicio](/) o visita [Nosotros](/about/) para conocer el estudio.",
          updatedAt: "",
        },
      ],
    });

    const tmPlan = await service.planTranslation(site, {
      paths: ["src/content/pages/pricing.md"],
      targetLocales: ["es"],
    });

    expect(tmPlan.requests).toBe(0);
    expect(tmPlan.tmOnlyItems).toBe(1);
    expect(tmPlan.estimatedUsd).toBe(0);
    expect(tmPlan.estimatedCredits).toBe(0);
    expect(tmPlan.tmHits).toBe(4);
    expect(tmPlan.tmSavedTokens).toBeGreaterThan(0);

    // Can run TM-only translation with NO Anthropic API key configured!
    const started = await service.startTranslation(site, {
      paths: ["src/content/pages/pricing.md"],
      targetLocales: ["es"],
    });

    let current = started;

    for (let i = 0; i < 40 && current.job.state === "running"; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      current = service.translationStatus(started.job.id) ?? current;
    }

    expect(current.job.state).toBe("done");
    expect(current.actualCredits).toBe(0);
    expect(current.items[0]?.jobState).toBe("reused_tm");
    const written = await site.readEntry("src/content/pages/es/pricing.md");

    expect(written.data.title).toBe("Precios sencillos");
    expect(written.body).toContain('const untouched = "do not translate code";');
    expect(written.body).toContain("[Nosotros](/es/about/)");

    await site.dispose();
    service.dispose();
  });

  it("executes AI batch translation with glossary prompt, records usage, translates slug, and writes TM + manifest", async () => {
    const { events, settings, site } = await makeSiteFixture();

    await settings.setSecret("anthropic", "sk-ant-api03-test-key-0123456789abcdef");
    let capturedPrompt = "";
    const fakeClient = {
      messages: {
        create: async (params: { messages: Array<{ content: string }> }) => {
          capturedPrompt = String(params.messages[0]?.content ?? "");
          return {
            usage: { input_tokens: 620, output_tokens: 280 },
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  localizedSlug: "precios",
                  segments: [
                    { id: "field:title", text: "Precios claros" },
                    { id: "field:description", text: "Planes claros para cada proyecto." },
                    { id: "body:0", text: "Ponte en contacto para hablar de tu proyecto." },
                    { id: "body:1", text: "Lee nuestra [Inicio](/) o visita [Nosotros](/about/)." },
                  ],
                }),
              },
            ],
          };
        },
      },
    } as unknown as Anthropic;

    const service = createI18nService({
      settings,
      events,
      client: fakeClient,
      env: { PATH: process.env.PATH, GALLEY_AI_CREDIT_MILLICENTS: "250" },
    });

    await service.saveConfig(site, {
      defaultLocale: "en",
      locales: [
        { code: "en", label: "English" },
        { code: "es", label: "Español" },
      ],
      localizeSlugs: true,
    });
    await service.saveGlossary(site, {
      version: 1,
      terms: [{ id: "g1", term: "architectural", translations: { es: "arquitectónico" } }],
    });

    const started = await service.startTranslation(site, {
      paths: ["src/content/pages/pricing.md"],
      targetLocales: ["es"],
      translateSlugs: true,
    });
    let current = started;

    for (let i = 0; i < 40 && current.job.state === "running"; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      current = service.translationStatus(started.job.id) ?? current;
    }

    expect(current.job.state).toBe("done");
    expect(capturedPrompt).toContain('"architectural" → "arquitectónico"');
    expect(current.items[0]?.jobState).toBe("translated");
    expect(current.items[0]?.writtenPath).toBe("src/content/pages/es/precios.md");
    expect(current.items[0]?.writtenUrl).toBe("/es/precios/");
    expect(current.actualInputTokens).toBe(620);
    expect(current.actualOutputTokens).toBe(280);
    expect(current.actualCredits).toBeGreaterThan(0);

    // Memory & usage recorded cleanly
    const memory = await service.getMemory(site);
    const idx = new MemoryIndex(memory);

    expect(idx.exact("en", "es", "Simple pricing")?.target).toBe("Precios claros");
    expect(formatGlossaryPrompt({ version: 1, terms: [{ id: "1", term: "Lowfield", doNotTranslate: true }] }, "es", "Welcome to Lowfield")).toContain("do not translate");

    const usage = await settings.usage();

    expect(usage.today.requests).toBe(1);
    expect(usage.today.inputTokens).toBe(620);

    await site.dispose();
    service.dispose();
  });
});
