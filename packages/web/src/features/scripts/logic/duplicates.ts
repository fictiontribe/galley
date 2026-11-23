/**
 * Problems worth flagging in a scripts setup: two scripts with the same id,
 * the same tag installed twice, Analytics both directly and (typically) in a
 * Tag Manager container, and tracking that loads without asking when the
 * site has no consent banner.
 */
import type { ScriptsConfig } from "@galley/core/kit";
import { consentOf, integrationOf, primarySetting, scriptName } from "./entries";

export interface ScriptWarning {
  id: string;
  tone: "warning" | "info";
  text: string;
  /** Indexes of the scripts concerned. */
  scripts: number[];
}

export function scriptWarnings(config: ScriptsConfig): ScriptWarning[] {
  const warnings: ScriptWarning[] = [];
  const byId = new Map<string, number[]>();
  config.scripts.forEach((entry, index) => byId.set(entry.id, [...(byId.get(entry.id) ?? []), index]));
  for (const [id, indexes] of byId) {
    if (id && indexes.length > 1) warnings.push({ id: `id-${id}`, tone: "warning", text: `${indexes.length} scripts use the name “${id}”. Give each its own, so changes and page rules apply to the right one.`, scripts: indexes });
  }

  const byTag = new Map<string, number[]>();
  config.scripts.forEach((entry, index) => {
    if (!entry.enabled) return;
    const value = primarySetting(entry);
    if (!value) return;
    const key = `${entry.kind}\n${value}`;
    byTag.set(key, [...(byTag.get(key) ?? []), index]);
  });
  for (const [key, indexes] of byTag) {
    if (indexes.length < 2) continue;
    const first = config.scripts[indexes[0] as number];
    const value = key.split("\n")[1] ?? "";
    warnings.push({
      id: `tag-${key}`,
      tone: "warning",
      text: `${first ? scriptName(first) : "This script"} is installed ${indexes.length} times with ${value}. Visits would be counted more than once — switch one off.`,
      scripts: indexes,
    });
  }

  const ga4 = config.scripts.flatMap((entry, index) => (entry.enabled && entry.kind === "ga4" ? [index] : []));
  const gtm = config.scripts.flatMap((entry, index) => (entry.enabled && entry.kind === "gtm" ? [index] : []));
  if (ga4.length > 0 && gtm.length > 0) {
    warnings.push({
      id: "ga4-in-gtm",
      tone: "info",
      text: "Google Analytics is often set up inside the Tag Manager container too. If yours is, page views are counted twice — keep it in one place.",
      scripts: [...ga4, ...gtm],
    });
  }

  if ((config.consent?.mode ?? "none") === "none") {
    const tracking = config.scripts.flatMap((entry, index) => {
      const category = consentOf(entry);
      return entry.enabled && (category === "analytics" || category === "marketing") ? [index] : [];
    });
    if (tracking.length > 0) {
      warnings.push({
        id: "no-consent",
        tone: "warning",
        text: "Analytics and marketing scripts load without asking, because consent is off. In many countries visitors must agree before these load.",
        scripts: tracking,
      });
    }
  }
  return warnings;
}

/** Whether a kind is one the catalogue knows (others come from plugins, or are typos). */
export function isKnownKind(kind: string): boolean {
  return integrationOf(kind) !== null;
}
