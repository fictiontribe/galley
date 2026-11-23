/**
 * "Show only when…": a field that appears (and is sent) only when another
 * field has a given answer, and the same rule for a destination's "only
 * when…".
 */
import type { FormField } from "@galley/core/kit";
import { hasOptions, isLayout } from "./fieldTypes";
import type { Answer } from "./validation";

export type Answers = Record<string, Answer | undefined>;

type Rule = NonNullable<FormField["showWhen"]>;

function asList(value: Answer | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Whether a rule holds for these answers — the site runtime's `holds`. */
export function ruleHolds(rule: Rule, answers: Answers): boolean {
  const value = answers[rule.field];
  const list = Array.isArray(value) ? value : [value ?? ""];
  if (rule.equals === undefined && rule.notEquals === undefined && rule.in === undefined) return asList(value).some((item) => item !== "");
  if (rule.equals !== undefined && !list.includes(rule.equals)) return false;
  if (rule.notEquals !== undefined && list.includes(rule.notEquals)) return false;
  if (rule.in !== undefined && !list.some((item) => rule.in?.includes(item))) return false;
  return true;
}

/**
 * The ids of the fields on screen (and sent) for these answers. A field whose
 * rule looks at a hidden field is hidden too — as the site runtime decides.
 */
export function shownIds(fields: readonly FormField[], answers: Answers): Set<string> {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const memo = new Map<string, boolean>();
  const shown = (id: string, seen: ReadonlySet<string>): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const field = byId.get(id);
    let result = Boolean(field);
    if (field?.showWhen) {
      const controller = field.showWhen.field;
      result = !seen.has(controller) && shown(controller, new Set([...seen, id])) && ruleHolds(field.showWhen, answers);
    }
    memo.set(id, result);
    return result;
  };
  return new Set(fields.filter((field) => shown(field.id, new Set())).map((field) => field.id));
}

/** Whether one field is on screen for these answers (ignoring chains; use `shownIds` for a whole form). */
export function isShown(field: FormField, answers: Answers): boolean {
  return field.showWhen ? ruleHolds(field.showWhen, answers) : true;
}

/** Fields another field's rule may depend on: real answers, not itself, not layout. */
export function conditionTargets(fields: readonly FormField[], selfId: string | null): FormField[] {
  return fields.filter((field) => field.id !== selfId && !isLayout(field) && field.type !== "hidden");
}

/** A tick box's answer when ticked (what the site sends). */
export const TICKED = "true";

/** The values a rule can compare with, when the target field has a fixed set. */
export function ruleValues(target: FormField | undefined): Array<{ value: string; label: string }> | null {
  if (!target) return null;
  if (hasOptions(target)) return (target.options ?? []).map((option) => ({ value: option.value, label: option.label || option.value }));
  if (target.type === "checkbox" || target.type === "consent") return [{ value: TICKED, label: "Ticked" }];
  return null;
}

/** "shows when Company size is 51–200" */
export function describeRule(rule: Rule, fields: readonly FormField[]): string {
  const target = fields.find((field) => field.id === rule.field);
  if (!target) return "shows when a field that was removed has an answer";
  const name = target.label?.trim() || target.id;
  const label = (value: string) => ruleValues(target)?.find((option) => option.value === value)?.label ?? value;
  if (rule.equals !== undefined) return `shows when ${name} is ${label(rule.equals)}`;
  if (rule.notEquals !== undefined) return `shows when ${name} isn’t ${label(rule.notEquals)}`;
  if (rule.in?.length) return `shows when ${name} is ${rule.in.map(label).join(" or ")}`;
  return `shows when ${name} is filled in`;
}
