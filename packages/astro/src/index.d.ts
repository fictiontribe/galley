import type { AstroIntegration } from "astro";

export interface FormsOptions {
  /** Content collection the forms live in. Default "forms". */
  collection?: string;
  /** Its folder, scanned for site-wide needs (UTM memory). Default "src/content/forms". */
  dir?: string;
  /** The capture address for "galley" destinations. */
  endpoint?: string;
  /** Let `script` after-submit actions run (custom code from the form file). Default false. */
  allowFormScripts?: boolean;
  /** Site-wide wording for every form (keys in docs/forms.md). */
  messages?: Record<string, string>;
  /** Extra domains `businessEmailOnly` refuses. */
  freeEmailDomains?: string[];
}

export interface ScriptsOptions {
  /** The scripts file, relative to the site. Default "src/data/scripts.json". */
  file?: string;
  /** Put the scripts into every page automatically. Default true. */
  inject?: boolean;
}

export interface MailtoOptions {
  /** Which actions, in which order. Default ["gmail", "outlook", "app", "copy"]; "outlook-live" is also available. */
  options?: Array<"gmail" | "outlook" | "outlook-live" | "app" | "copy">;
  /** Wording, by key (docs/mailto.md). */
  strings?: Record<string, string>;
}

export interface VisibilityOptions {
  /** The data file, relative to the site. Default "src/data/visibility.json" (docs/ai-first-output.md). */
  file?: string;
}

export interface GalleyOptions {
  /**
   * Address of the Galley server to look for.
   * Default: the `GALLEY_URL` environment variable, else `http://127.0.0.1:4400`.
   */
  url?: string;
  /** The Dev Toolbar app (astro dev only). Default true. */
  toolbar?: boolean;
  /** Forms: <Form /> settings. `false` turns the part off. */
  forms?: FormsOptions | false;
  /** Managed third-party scripts. `false` turns the part off. */
  scripts?: ScriptsOptions | false;
  /** The email-link dialog (Gmail, Outlook, mail app, copy). On by default; `false` turns it off. */
  mailto?: MailtoOptions | false;
  /**
   * The agent-readable output: a markdown twin of every page, llms.txt,
   * llms-full.txt, agent.md, structured data, and robots.txt / sitemap.xml
   * when the site has none of its own. On by default; `false` turns it off.
   */
  visibility?: VisibilityOptions | false;
}

/** What `GET /__galley/status` answers in `astro dev`. */
export interface GalleyStatus {
  /** Whether a Galley server answered at `url`. */
  running: boolean;
  /** The address that was checked. */
  url: string;
  /** The project's folder, absolute. */
  root: string;
}

/** The Galley site kit: forms, managed scripts, email links, the agent-readable output, and (in astro dev) the Dev Toolbar app. */
export default function galley(options?: GalleyOptions): AstroIntegration;

/** The address the integration looks for Galley at, as it resolves `options.url`, `GALLEY_URL` and the default. */
export function resolveGalleyUrl(options?: GalleyOptions, env?: Record<string, string | undefined>): string;

/** The forms options with their defaults. */
export function formsSettings(forms?: FormsOptions | false): Required<Omit<FormsOptions, never>>;

/** Absolute path of the toolbar app's module. */
export const TOOLBAR_ENTRYPOINT: string;
/** Absolute path of the middleware that injects managed scripts. */
export const SCRIPTS_MIDDLEWARE: string;
export const PRODUCT_NAME: string;
export const INTEGRATION_NAME: string;
export const APP_ID: string;
export const STATUS_PATH: string;
export const SCRIPTS_MANIFEST_PATH: string;
export const DEFAULT_URL: string;
export const URL_ENV: string;
