/**
 * Scripts as entries in the setup file: what a new one starts as (the
 * catalogue's placement and consent, a sensible loading time), and the plain
 * words for each choice.
 */
import type { JsonValue } from "@galley/core/types";
import type { ConsentCategory, ScriptEntry, ScriptIntegrationInfo } from "@galley/core/kit";
import { SCRIPT_INTEGRATIONS } from "@galley/core/kit-catalog";
import { settingText } from "@/features/forms/logic/json";
import { pluginScriptIntegration } from "@/features/plugins/catalog";

/** The built-in catalogue first; then a kind a plugin active for the site adds (from the last catalogue read). */
export function integrationOf(kind: string): ScriptIntegrationInfo | null {
  return SCRIPT_INTEGRATIONS.find((integration) => integration.kind === kind) ?? pluginScriptIntegration(kind);
}

/** What a script is called in the app. */
export function scriptName(entry: Pick<ScriptEntry, "label" | "kind">): string {
  return entry.label?.trim() || integrationOf(entry.kind)?.name || entry.kind;
}

/** The setting that identifies the script (the container, measurement or pixel id), or the address of a custom one. */
export function primarySetting(entry: Pick<ScriptEntry, "kind" | "settings">): string | null {
  const integration = integrationOf(entry.kind);
  const key = entry.kind === "custom" ? (settingText(entry.settings.src) ? "src" : null) : (integration?.settings.find((setting) => setting.required)?.key ?? integration?.settings[0]?.key ?? null);
  if (!key) return null;
  const value = settingText(entry.settings[key]).trim();
  return value || null;
}

/** When a script loads, unless the person chooses otherwise. Tag managers and analytics start with the page; chat waits for a first tap. */
export function defaultLoad(integration: ScriptIntegrationInfo): NonNullable<ScriptEntry["load"]> {
  if (integration.category === "tag-manager" || integration.category === "analytics") return "eager";
  if (integration.category === "support") return "interaction";
  return "idle";
}

/** A new entry for an integration, with an id no other script has. Keys in reading order. */
export function newScript(integration: ScriptIntegrationInfo, settings: { [key: string]: JsonValue }, taken: Iterable<string>): ScriptEntry {
  const used = new Set(taken);
  let id = integration.kind;
  for (let n = 2; used.has(id); n++) id = `${integration.kind}-${n}`;
  const clean: { [key: string]: JsonValue } = {};
  for (const [key, value] of Object.entries(settings)) if (settingText(value).trim()) clean[key] = typeof value === "string" ? value.trim() : value;
  return {
    id,
    kind: integration.kind,
    enabled: true,
    settings: clean,
    placement: integration.defaultPlacement,
    load: defaultLoad(integration),
    consent: integration.defaultConsent,
  };
}

export const LOAD_WORDS: Record<NonNullable<ScriptEntry["load"]>, { label: string; line: string }> = {
  eager: { label: "Straight away", line: "Loads with the page. Needed for tags that must see the first page view." },
  idle: { label: "When idle", line: "Waits until the page has finished loading, so it doesn’t slow the page down." },
  interaction: { label: "First interaction", line: "Waits for the visitor’s first scroll, tap or key press. Best for chat and pop-ups." },
};

export const CONSENT_WORDS: Record<ConsentCategory, { label: string; line: string }> = {
  necessary: { label: "Necessary", line: "Always loads. Only for scripts the site can’t work without, or that keep no record of the visitor." },
  analytics: { label: "Analytics", line: "Measures visits. Loads once the visitor agrees to analytics." },
  marketing: { label: "Marketing", line: "Advertising and follow-up. Loads once the visitor agrees to marketing." },
  preferences: { label: "Preferences", line: "Remembers choices and powers extras like chat. Loads once the visitor agrees to preferences." },
};

export const PLACEMENT_WORDS: Record<NonNullable<ScriptEntry["placement"]>, string> = {
  head: "In the page head",
  "body-start": "At the start of the page",
  "body-end": "At the end of the page",
};

export const CATEGORY_WORDS: Record<ScriptIntegrationInfo["category"], string> = {
  "tag-manager": "Tag managers",
  analytics: "Analytics",
  advertising: "Advertising",
  marketing: "Marketing",
  support: "Support and chat",
  other: "Other",
};

/** The consent category a script asks for (absent = the integration's default, or necessary). */
export function consentOf(entry: Pick<ScriptEntry, "consent" | "kind">): ConsentCategory {
  return entry.consent ?? integrationOf(entry.kind)?.defaultConsent ?? "necessary";
}

export function loadOf(entry: Pick<ScriptEntry, "load">): NonNullable<ScriptEntry["load"]> {
  return entry.load ?? "eager";
}

/** A short mark for an integration's tile: GTM, GA, … */
export function markOf(kind: string): string {
  const marks: Record<string, string> = { gtm: "GTM", ga4: "GA", "meta-pixel": "Me", "linkedin-insight": "in", hubspot: "Hs", "marketo-munchkin": "Mk", plausible: "Pl", segment: "Sg", hotjar: "Hj", clarity: "Cl", intercom: "Ic", custom: "</>" };
  return marks[kind] ?? kind.slice(0, 2);
}
