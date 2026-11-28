// @ts-check
/**
 * Scheduled publishing helpers for Astro content collections (`@galleycms/astro/schedules`).
 *
 * Filters out drafts and entries whose `publishAt` or `scheduledAt` timestamp
 * is still in the future at build/request time.
 */

const SCHEDULE_KEYS = ["publishAt", "scheduledAt"];

/**
 * Parses an ISO date ("2026-12-01") or full ISO timestamp into epoch ms, or null.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parsePublishAt(value) {
  if (value instanceof Date) {
    const ms = value.getTime();

    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();

  if (!trimmed) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
  const ms = Date.parse(normalized);

  return Number.isFinite(ms) ? ms : null;
}

/**
 * Extracts frontmatter data whether handed an Astro collection entry (`{ data: {...} }`)
 * or a plain data object directly.
 * @param {unknown} entryOrData
 * @returns {Record<string, unknown> | null}
 */
function dataOf(entryOrData) {
  if (!entryOrData || typeof entryOrData !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (entryOrData);

  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return /** @type {Record<string, unknown>} */ (record.data);
  }
  return record;
}

/**
 * Returns true when an Astro content entry (or its `data` object) is live at `now`.
 * Draft entries (`draft: true`) and entries with a future `publishAt` or
 * `scheduledAt` timestamp return false.
 *
 * @param {unknown} entryOrData
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isPublished(entryOrData, now = new Date()) {
  const data = dataOf(entryOrData);

  if (!data) return true;
  if (data.draft === true) return false;
  const nowMs = now.getTime();

  for (const key of SCHEDULE_KEYS) {
    const raw = data[key];

    if (raw === undefined || raw === null || raw === "") continue;
    const targetMs = parsePublishAt(raw);

    if (targetMs !== null && targetMs > nowMs) return false;
  }
  return true;
}

/**
 * Filters a list of Astro content entries (or data objects) to those live at `now`.
 *
 * @template T
 * @param {readonly T[]} entries
 * @param {Date} [now]
 * @returns {T[]}
 */
export function filterPublished(entries, now = new Date()) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => isPublished(entry, now));
}
