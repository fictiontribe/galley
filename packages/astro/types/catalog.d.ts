import type { FormProviderInfo, ScriptIntegrationInfo } from "../src/kit";

export declare const scriptIntegrations: readonly ScriptIntegrationInfo[];
export declare const formProviders: readonly FormProviderInfo[];
export declare function scriptIntegration(kind: string): ScriptIntegrationInfo | undefined;
export declare function formProvider(id: string): FormProviderInfo | undefined;

/** An AI crawler robots.txt can allow or block (src/data/visibility.json → crawlers). */
export interface AiCrawler {
  /** The robots.txt user-agent token, e.g. "GPTBot". */
  token: string;
  vendor: string;
  /** "OpenAI's training crawler". */
  label: string;
  /** training: may train AI models · dataset: an open archive others train on · search: AI search answers · user: fetches for a person. */
  purpose: "training" | "dataset" | "search" | "user";
  /** false for control tokens (Google-Extended, Applebot-Extended) that fetch nothing themselves. */
  crawls: boolean;
  what: string;
  ifBlocked: string;
  caveat?: string;
  /** The provider's own page. */
  docs: string;
}

export declare const aiCrawlers: readonly AiCrawler[];
export declare function aiCrawler(token: string): AiCrawler | undefined;
/** "Blocks AI training (GPTBot, CCBot); allows AI search (OAI-SearchBot)." */
export declare function describePolicy(choices: Record<string, "allow" | "block">): string;
