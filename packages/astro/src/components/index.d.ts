import type { FormDefinition } from "../kit";
import type { I18nConfig, I18nManifest } from "../i18n/index";

type AstroComponent<P> = (props: P) => any;

export interface FormProps {
  /** The form's id: its file name in the forms collection. */
  id?: string;
  /** A definition to render instead of looking one up. */
  definition?: FormDefinition;
  collection?: string;
  endpoint?: string;
  class?: string;
  submitClass?: string;
  backClass?: string;
  headingLevel?: number;
  unstyled?: boolean;
}

export interface LocaleHeadProps {
  site?: string | URL;
  pathname?: string;
  currentLocale?: string;
  config?: I18nConfig | null;
  manifest?: I18nManifest | null;
  root?: string;
}

export interface LanguageSelectorProps {
  label?: string;
  fallback?: "home" | "hide";
  showCode?: boolean;
  class?: string;
  unstyled?: boolean;
  pathname?: string;
  currentLocale?: string;
  config?: I18nConfig | null;
  manifest?: I18nManifest | null;
  root?: string;
}

export declare const Form: AstroComponent<FormProps>;
export declare const Scripts: AstroComponent<{ placement?: "head" | "body-start" | "body-end" }>;
export declare const ConsentBanner: AstroComponent<Record<string, never>>;
export declare const LanguageSelector: AstroComponent<LanguageSelectorProps>;
export declare const LocaleHead: AstroComponent<LocaleHeadProps>;
