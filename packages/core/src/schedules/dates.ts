/**
 * Content entry date/time matching for scheduled publishing (`publishAt` /
 * `scheduledAt` frontmatter fields and draft flags).
 */

export const SCHEDULE_DATE_FIELDS = ["publishAt", "scheduledAt"] as const;

/** Parses an ISO date ("2026-12-01") or full ISO timestamp ("2026-12-01T14:00:00Z") into epoch ms, or null. */
export function parsePublishAt(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();

    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();

  if (!trimmed) return null;
  // Date-only values ("YYYY-MM-DD") parse as UTC midnight.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
  const ms = Date.parse(normalized);

  return Number.isFinite(ms) ? ms : null;
}

/**
 * Returns whether an entry's data is live at `now`:
 * - `draft === true` → false
 * - `publishAt` or `scheduledAt` in the future (`> now.getTime()`) → false
 * - Otherwise → true
 */
export function isEntryLiveAt(data: Record<string, unknown> | null | undefined, now: Date = new Date()): boolean {
  if (!data || typeof data !== "object") return true;
  if (data.draft === true) return false;
  const nowMs = now.getTime();

  for (const key of SCHEDULE_DATE_FIELDS) {
    const raw = data[key];

    if (raw === undefined || raw === null || raw === "") continue;
    const targetMs = parsePublishAt(raw);

    if (targetMs !== null && targetMs > nowMs) return false;
  }
  return true;
}

/** Minimum lead time (30 seconds) required when scheduling a new release. */
export const MIN_SCHEDULE_LEAD_MS = 30_000;

/** Validates and normalizes a future scheduledAt ISO string to UTC. */
export function normalizeFutureSchedule(scheduledAt: string, now: Date = new Date()): { ok: true; iso: string } | { ok: false; message: string } {
  const trimmed = scheduledAt.trim();

  if (!trimmed) return { ok: false, message: "Choose a date and time for this scheduled publish." };
  const ms = Date.parse(trimmed);

  if (!Number.isFinite(ms)) return { ok: false, message: "That scheduled date and time isn't valid." };
  if (ms < now.getTime() + MIN_SCHEDULE_LEAD_MS) {
    return { ok: false, message: "Pick a time at least a minute in the future." };
  }
  return { ok: true, iso: new Date(ms).toISOString() };
}
