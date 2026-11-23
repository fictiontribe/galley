declare module "virtual:galley-kit/config" {
  import type { ScriptsConfig } from "../kit";

  /** The forms options the integration was given, with defaults applied. */
  export const options: {
    collection: string;
    endpoint: string;
    allowFormScripts: boolean;
    messages: Record<string, string>;
    freeEmailDomains: string[];
  };
  /** The parsed scripts file, or null when the site has none. */
  export const scripts: ScriptsConfig | null;
  export const scriptsFile: string;
  /** Whether any form uses UTM autofill (the runtime then remembers landings). */
  export const utm: boolean;
  /** The email-link dialog's settings, or null when it is off. */
  export const mailto: { options: string[]; strings: Record<string, string> } | null;
}
