/**
 * Locale helpers: standard labels, RTL detection, prefix resolution, and
 * normalizing a site's i18n configuration with safe defaults.
 */
import type { I18nConfig, I18nLocaleConfig } from "../types";

export const DEFAULT_LOCALE: I18nLocaleConfig = {
  code: "en",
  label: "English",
  direction: "ltr",
};

const RTL_BASES = new Set(["ar", "arc", "dv", "fa", "ha", "he", "khw", "ks", "ku", "ps", "ur", "yi"]);

export const COMMON_LOCALES: readonly I18nLocaleConfig[] = [
  { code: "en", label: "English", direction: "ltr" },
  { code: "es", label: "Español", direction: "ltr" },
  { code: "fr", label: "Français", direction: "ltr" },
  { code: "de", label: "Deutsch", direction: "ltr" },
  { code: "it", label: "Italiano", direction: "ltr" },
  { code: "pt", label: "Português", direction: "ltr" },
  { code: "pt-BR", label: "Português (Brasil)", prefix: "pt-br", direction: "ltr" },
  { code: "nl", label: "Nederlands", direction: "ltr" },
  { code: "ja", label: "日本語", direction: "ltr" },
  { code: "ko", label: "한국어", direction: "ltr" },
  { code: "zh", label: "中文", direction: "ltr" },
  { code: "zh-TW", label: "繁體中文", prefix: "zh-tw", direction: "ltr" },
  { code: "ar", label: "العربية", direction: "rtl" },
  { code: "he", label: "עברית", direction: "rtl" },
  { code: "sv", label: "Svenska", direction: "ltr" },
  { code: "da", label: "Dansk", direction: "ltr" },
  { code: "no", label: "Norsk", direction: "ltr" },
  { code: "fi", label: "Suomi", direction: "ltr" },
  { code: "pl", label: "Polski", direction: "ltr" },
  { code: "tr", label: "Türkçe", direction: "ltr" },
  { code: "uk", label: "Українська", direction: "ltr" },
  { code: "hi", label: "हिन्दी", direction: "ltr" },
];

export function directionForLocale(code: string): "ltr" | "rtl" {
  const base = code.split("-")[0]?.toLowerCase() ?? "";

  return RTL_BASES.has(base) ? "rtl" : "ltr";
}

export function defaultLabelForLocale(code: string): string {
  const found = COMMON_LOCALES.find((item) => item.code.toLowerCase() === code.toLowerCase());

  if (found) return found.label;
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    const display = names.of(code);

    if (display && display.toLowerCase() !== code.toLowerCase()) return display;
  } catch {
    // Fallback below.
  }
  return code;
}

export function localePrefix(locale: Pick<I18nLocaleConfig, "code" | "prefix">): string {
  return (locale.prefix ?? locale.code).trim().toLowerCase();
}

export interface NormalizedLocale extends I18nLocaleConfig {
  prefix: string;
  direction: "ltr" | "rtl";
}

export interface NormalizedI18nConfig {
  defaultLocale: string;
  locales: NormalizedLocale[];
  strategy: "folder" | "suffix";
  prefixDefaultLocale: boolean;
  localizeSlugs: boolean;
}

export function normalizeI18nConfig(config?: I18nConfig | null): NormalizedI18nConfig {
  if (!config || !config.locales.length) {
    return {
      defaultLocale: DEFAULT_LOCALE.code,
      locales: [{ ...DEFAULT_LOCALE, prefix: "en", direction: "ltr" }],
      strategy: "folder",
      prefixDefaultLocale: false,
      localizeSlugs: true,
    };
  }
  const seen = new Set<string>();
  const locales: NormalizedLocale[] = [];

  for (const item of config.locales) {
    const code = item.code.trim();
    const key = code.toLowerCase();

    if (!code || seen.has(key)) continue;
    seen.add(key);
    locales.push({
      code,
      label: item.label.trim() || defaultLabelForLocale(code),
      prefix: localePrefix(item),
      direction: item.direction ?? directionForLocale(code),
    });
  }
  if (locales.length === 0) {
    locales.push({ ...DEFAULT_LOCALE, prefix: "en", direction: "ltr" });
  }
  const matchedDefault = locales.find((item) => item.code.toLowerCase() === config.defaultLocale.toLowerCase()) ?? locales[0]!;

  return {
    defaultLocale: matchedDefault.code,
    locales,
    strategy: config.strategy ?? "folder",
    prefixDefaultLocale: config.prefixDefaultLocale ?? false,
    localizeSlugs: config.localizeSlugs ?? true,
  };
}

export function findLocale(config: NormalizedI18nConfig, codeOrPrefix: string): NormalizedLocale | undefined {
  const needle = codeOrPrefix.trim().toLowerCase();

  return config.locales.find((item) => item.code.toLowerCase() === needle || item.prefix === needle);
}

export function isDefaultLocale(config: NormalizedI18nConfig, localeCode: string): boolean {
  return config.defaultLocale.toLowerCase() === localeCode.toLowerCase();
}
