import { describe, expect, it } from "vitest";
import { resolvePageLocales, type I18nConfig, type I18nManifest } from "../src/i18n/index.js";

const CONFIG: I18nConfig = {
  defaultLocale: "en",
  locales: [
    { code: "en", label: "English" },
    { code: "es", label: "Español" },
    { code: "fr", label: "Français" },
  ],
  strategy: "folder",
  prefixDefaultLocale: false,
  localizeSlugs: true,
};

const MANIFEST: I18nManifest = {
  version: 1,
  links: {
    "src/content/pages/es/precios.md": {
      key: "src/content/pages/pricing.md",
      sourcePath: "src/content/pages/pricing.md",
      locale: "es",
      sourceHash: "abc123",
      sourceSlug: "pricing",
      localizedSlug: "precios",
      updatedAt: "2026-11-27T00:00:00.000Z",
    },
    "src/content/pages/fr/tarifs.md": {
      key: "src/content/pages/pricing.md",
      sourcePath: "src/content/pages/pricing.md",
      locale: "fr",
      sourceHash: "abc123",
      sourceSlug: "pricing",
      localizedSlug: "tarifs",
      updatedAt: "2026-11-27T00:00:00.000Z",
    },
    "src/content/pages/es/sobre-nosotros.md": {
      key: "src/content/pages/about.md",
      sourcePath: "src/content/pages/about.md",
      locale: "es",
      sourceHash: "def456",
      sourceSlug: "about",
      localizedSlug: "sobre-nosotros",
      updatedAt: "2026-11-27T00:00:00.000Z",
    },
  },
};

describe("@galleycms/astro i18n resolution (<LanguageSelector /> & <LocaleHead />)", () => {
  it("resolves localized counterpart URLs and absolute hreflang + x-default from manifest", () => {
    const fromEn = resolvePageLocales({
      pathname: "/pricing/",
      site: "https://acme.example",
      config: CONFIG,
      manifest: MANIFEST,
    });

    expect(fromEn.configured).toBe(true);
    expect(fromEn.current.code).toBe("en");
    expect(fromEn.xDefaultHref).toBe("https://acme.example/pricing/");
    expect(fromEn.alternates.map((a) => [a.code, a.path, a.href, a.active, a.exists])).toEqual([
      ["en", "/pricing/", "https://acme.example/pricing/", true, true],
      ["es", "/es/precios/", "https://acme.example/es/precios/", false, true],
      ["fr", "/fr/tarifs/", "https://acme.example/fr/tarifs/", false, true],
    ]);

    // Resolving backwards from a localized Spanish slug (/es/precios/) finds EN + FR counterparts!
    const fromEs = resolvePageLocales({
      pathname: "/es/precios/",
      site: "https://acme.example",
      config: CONFIG,
      manifest: MANIFEST,
    });

    expect(fromEs.current.code).toBe("es");
    expect(fromEs.xDefaultHref).toBe("https://acme.example/pricing/");
    expect(fromEs.alternates.find((a) => a.code === "fr")?.path).toBe("/fr/tarifs/");
    expect(fromEs.alternates.find((a) => a.code === "es")?.active).toBe(true);
  });

  it("marks untranslated counterparts as exists=false with locale home fallbackPath", () => {
    const about = resolvePageLocales({
      pathname: "/about/",
      config: CONFIG,
      manifest: MANIFEST,
    });

    const fr = about.alternates.find((a) => a.code === "fr")!;

    expect(fr.exists).toBe(false);
    expect(fr.path).toBeNull();
    expect(fr.fallbackPath).toBe("/fr/");
  });

  it("respects prefixDefaultLocale=true for default locale URLs and x-default", () => {
    const resolved = resolvePageLocales({
      pathname: "/en/pricing/",
      site: "https://acme.example",
      config: { ...CONFIG, prefixDefaultLocale: true },
      manifest: MANIFEST,
    });

    expect(resolved.current.code).toBe("en");
    expect(resolved.alternates.find((a) => a.code === "en")?.path).toBe("/en/pricing/");
    expect(resolved.alternates.find((a) => a.code === "es")?.path).toBe("/es/precios/");
    expect(resolved.xDefaultHref).toBe("https://acme.example/en/pricing/");
  });
});
