/**
 * Provider and integration settings, checked against the catalogue: the
 * required ones, and each one's pattern — with a plain message that shows
 * the catalogue's placeholder as the example.
 */
import type { JsonValue } from "@galley/core/types";
import type { FormProviderInfo } from "@galley/core/kit";
import { settingText } from "./json";

export type SettingSpec = FormProviderInfo["settings"][number];

/** What's wrong with one setting, or null. Empty optional settings are fine. */
export function settingProblem(spec: SettingSpec, value: JsonValue | undefined): string | null {
  const text = settingText(value).trim();
  if (!text) return spec.required ? `Add the ${spec.label}.` : null;
  if (!spec.pattern) return null;
  let pattern: RegExp;
  try {
    pattern = new RegExp(spec.pattern);
  } catch {
    return null;
  }
  if (pattern.test(text)) return null;
  if (!spec.placeholder) return `Check the ${spec.label}.`;
  return `Check the ${spec.label} — it usually looks like ${spec.placeholder}${/[.…]$/.test(spec.placeholder) ? "" : "."}`;
}

/** Every setting's problem, keyed by setting. */
export function settingProblems(specs: readonly SettingSpec[], settings: { [key: string]: JsonValue }): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const spec of specs) {
    const problem = settingProblem(spec, settings[spec.key]);
    if (problem) problems[spec.key] = problem;
  }
  return problems;
}

/** Whether the settings are complete enough to use (required ones present and well-formed). */
export function settingsReady(specs: readonly SettingSpec[], settings: { [key: string]: JsonValue }): boolean {
  return Object.keys(settingProblems(specs, settings)).length === 0;
}
