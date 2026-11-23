/**
 * Options from a pasted list: one per line, blank lines skipped, duplicates
 * dropped. "Label | value" sets the value sent; otherwise it comes from the
 * label.
 */
import type { FormFieldOption } from "@galley/core/kit";
import { uniqueName } from "./names";

/** The value an option sends, from its label: "201–1,000" → "201-1000", "More than 1,000" → "more-than-1000". */
export function valueFromLabel(label: string): string {
  const value = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^a-z0-9+]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return value || "option";
}

export function optionsFromLines(text: string): FormFieldOption[] {
  const out: FormFieldOption[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[-*•]\s+/, "");
    if (!trimmed) continue;
    const [labelPart, valuePart] = trimmed.split("|").map((part) => part.trim());
    const label = labelPart ?? "";
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const value = uniqueName(valuePart || valueFromLabel(label), out.map((option) => option.value));
    out.push({ value, label });
  }
  return out;
}
