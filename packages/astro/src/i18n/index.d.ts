export interface I18nLocaleConfig {
  code: string;
  label: string;
  prefix?: string;
  direction?: "ltr" | "rtl";
}

export interface I18nConfig {
  defaultLocale: string;
  locales: I18nLocaleConfig[];
  strategy?: "folder" | "suffix";
  prefixDefaultLocale?: boolean;
  localizeSlugs?: boolean;
}

export interface I18nManifestLink {
  key: string;
  sourcePath: string;
  locale: string;
  sourceHash: string;
  sourceSlug: string;
  localizedSlug: string;
  updatedAt: string;
}

export interface I18nManifest {
  version: 1;
  links: Record<string, I18nManifestLink>;
}

export interface ResolvedLocale {
  code: string;
  label: string;
  prefix: string;
  direction: "ltr" | "rtl";
  isDefault: boolean;
}

export interface PageLocaleAlternate extends ResolvedLocale {
  active: boolean;
  exists: boolean;
  path: string | null;
  href: string | null;
  fallbackPath: string;
  fallbackHref: string | null;
}

export interface ResolvedPageLocales {
  configured: boolean;
  defaultLocale: string;
  current: ResolvedLocale;
  alternates: PageLocaleAlternate[];
  xDefaultPath: string;
  xDefaultHref: string | null;
}

export function loadSiteI18n(
  root?: string,
  overrides?: { config?: I18nConfig | null; manifest?: I18nManifest | null }
): {
  configured: boolean;
  defaultLocale: string;
  prefixDefaultLocale: boolean;
  localizeSlugs: boolean;
  locales: ResolvedLocale[];
  manifest: I18nManifest;
};

export function resolvePageLocales(input: {
  pathname: string;
  currentLocale?: string;
  site?: string | URL;
  base?: string;
  root?: string;
  config?: I18nConfig | null;
  manifest?: I18nManifest | null;
}): ResolvedPageLocales;
