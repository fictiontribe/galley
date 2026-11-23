/**
 * Feature statuses: src/data/status.json is the only place the site says
 * whether something is built, in preview, new, in progress or later.
 */
import data from "../data/status.json";

export type StatusId = keyof typeof data.labels;
export interface StatusItem { id: string; label: string; line: string; status: StatusId; home?: boolean }

export const statusItems = data.items as StatusItem[];
export const statusLabels = data.labels as Record<StatusId, string>;
export const statusGroups = data.groups as StatusId[];

export function statusOf(id: string): StatusItem {
  const item = statusItems.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown status id "${id}" (src/data/status.json)`);
  return item;
}

/** The badge for a feature: its status label, or nothing when it is simply built. */
export function badgeOf(id: string | undefined): { label: string; status: StatusId } | null {
  if (!id) return null;
  const item = statusOf(id);
  return item.status === "built" ? null : { label: statusLabels[item.status], status: item.status };
}
