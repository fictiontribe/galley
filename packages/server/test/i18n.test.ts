/**
 * Multilingual / i18n HTTP route integration & role-based access tests.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  GlossaryFile,
  I18nCreateEntryResult,
  I18nEntryDetail,
  I18nOverview,
  TranslationJobStatus,
  TranslationMemoryFile,
  TranslationPlan,
} from "@galley/core/i18n/types";
import { ROUTE_ACCESS, roleMayCall } from "@galley/core/install/route-access";
import type { SiteDetail } from "@galley/core/types";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/types";

const starter = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));

describe("i18n HTTP routes", () => {
  let tmp = "";
  let server: RunningServer;
  let siteId = "";

  async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${server.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  }

  beforeAll(async () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-srv-i18n-")));
    const site = join(tmp, "site");

    cpSync(starter, site, { recursive: true, filter: (src) => !["node_modules", ".astro", "dist"].includes(basename(src)) });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: site, encoding: "utf8" });

    git("init", "-q");
    git("symbolic-ref", "HEAD", "refs/heads/main");
    git("config", "user.name", "I18n Server Test");
    git("config", "user.email", "i18n@example.invalid");
    git("add", "-A");
    git("commit", "-q", "-m", "Initial");

    server = await startServer({
      port: 0,
      home: join(tmp, "home"),
      webDir: join(tmp, "no-ui"),
      env: { PATH: process.env.PATH, HOME: tmp, GALLEY_AI_CREDIT_MILLICENTS: "250" },
      notice: () => {},
    });
    siteId = (await api<SiteDetail>("POST", "/api/sites/open", { path: site })).body.id;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("enforces manage access on PUT /i18n/config and edit access on translation & memory routes", () => {
    expect(ROUTE_ACCESS["PUT /api/sites/:siteId/i18n/config"]).toBe("manage");
    expect(roleMayCall("contributor", "PUT /api/sites/:siteId/i18n/config")).toBe(false);
    expect(roleMayCall("editor", "PUT /api/sites/:siteId/i18n/config")).toBe(false);
    expect(roleMayCall("owner", "PUT /api/sites/:siteId/i18n/config")).toBe(true);

    const editRoutes = [
      "GET /api/sites/:siteId/i18n",
      "GET /api/sites/:siteId/i18n/entry",
      "POST /api/sites/:siteId/i18n/entry/create",
      "GET /api/sites/:siteId/i18n/glossary",
      "PUT /api/sites/:siteId/i18n/glossary",
      "GET /api/sites/:siteId/i18n/memory",
      "PUT /api/sites/:siteId/i18n/memory",
      "POST /api/sites/:siteId/i18n/translate/plan",
      "POST /api/sites/:siteId/i18n/translate",
      "GET /api/sites/:siteId/i18n/translate/:jobId",
      "POST /api/sites/:siteId/i18n/translate/:jobId/cancel",
    ] as const;

    for (const route of editRoutes) {
      expect(ROUTE_ACCESS[route]).toBe("edit");
      expect(roleMayCall("contributor", route)).toBe(true);
      expect(roleMayCall("editor", route)).toBe(true);
      expect(roleMayCall("owner", route)).toBe(true);
    }
  });

  it("serves config, overview, manual draft creation, entry detail, glossary, memory, and translation planning/jobs", async () => {
    const initial = await api<I18nOverview>("GET", `/api/sites/${siteId}/i18n`);

    expect(initial.status).toBe(200);
    expect(initial.body.configured).toBe(false);

    const updated = await api<I18nOverview>("PUT", `/api/sites/${siteId}/i18n/config`, {
      defaultLocale: "en",
      locales: [
        { code: "en", label: "English" },
        { code: "es", label: "Español" },
      ],
      strategy: "folder",
      prefixDefaultLocale: false,
      localizeSlugs: true,
    });

    expect(updated.status).toBe(200);
    expect(updated.body.configured).toBe(true);
    expect(updated.body.locales.length).toBe(2);

    const sourcePage = updated.body.pages[0]!;

    // Glossary & Memory CRUD
    const savedGlossary = await api<GlossaryFile>("PUT", `/api/sites/${siteId}/i18n/glossary`, {
      version: 1,
      terms: [{ id: "brand", term: "Lowfield", doNotTranslate: true }],
    });

    expect(savedGlossary.status).toBe(200);
    expect((await api<GlossaryFile>("GET", `/api/sites/${siteId}/i18n/glossary`)).body.terms).toHaveLength(1);

    const savedMemory = await api<TranslationMemoryFile>("PUT", `/api/sites/${siteId}/i18n/memory`, {
      version: 1,
      entries: [
        {
          id: "tm-1",
          sourceLocale: "en",
          targetLocale: "es",
          source: "Get in touch",
          target: "Ponte en contacto",
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    expect(savedMemory.status).toBe(200);
    expect((await api<TranslationMemoryFile>("GET", `/api/sites/${siteId}/i18n/memory`)).body.entries).toHaveLength(1);

    // Upfront translation plan (returns clear USD + AI credits estimate)
    const plan = await api<TranslationPlan>("POST", `/api/sites/${siteId}/i18n/translate/plan`, {
      paths: [sourcePage.sourcePath],
      targetLocales: ["es"],
    });

    expect(plan.status).toBe(200);
    expect(plan.body.totalItems).toBe(1);
    expect(plan.body.estimatedCredits).toBeGreaterThanOrEqual(0);

    // Without an AI key, starting an AI-requiring translation returns 400 unconfigured
    const refused = await api<{ error: { code: string } }>("POST", `/api/sites/${siteId}/i18n/translate`, {
      paths: [sourcePage.sourcePath],
      targetLocales: ["es"],
    });

    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("unconfigured");

    // Manual translation draft creation + side-by-side entry detail
    const created = await api<I18nCreateEntryResult>("POST", `/api/sites/${siteId}/i18n/entry/create`, {
      sourcePath: sourcePage.sourcePath,
      targetLocale: "es",
    });

    expect(created.status).toBe(200);
    expect(created.body.locale).toBe("es");

    const detail = await api<I18nEntryDetail>(
      "GET",
      `/api/sites/${siteId}/i18n/entry?path=${encodeURIComponent(created.body.path)}`
    );

    expect(detail.status).toBe(200);
    expect(detail.body.isDefault).toBe(false);
    expect(detail.body.sourcePath).toBe(sourcePage.sourcePath);
    expect(detail.body.sourceData).not.toBeNull();
    expect(detail.body.counterparts).toHaveLength(2);

    // Unknown job id returns 404 cleanly on status and cancel
    expect((await api<TranslationJobStatus>("GET", `/api/sites/${siteId}/i18n/translate/missing-job`)).status).toBe(404);
    expect((await api("POST", `/api/sites/${siteId}/i18n/translate/missing-job/cancel`)).status).toBe(404);
  });
});
