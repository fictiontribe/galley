import type { ScheduledRelease } from "@galley/core/schedules/types";
import { api } from "@/lib/api";
import { invalidate, useQuery } from "@/lib/query";
import { keys } from "@/lib/sync";

export function useSchedules(siteId: string) {
  return useQuery(
    keys.schedules(siteId),
    () => api("GET /api/sites/:siteId/schedules", { params: { siteId } }),
    { enabled: Boolean(siteId) },
  );
}

export function invalidateSchedules(siteId: string): void {
  invalidate(keys.schedules(siteId));
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Tomorrow at 09:00 local time, formatted for `<input type="date">` and `<input type="time">`. */
export function defaultScheduleInputs(now = new Date()): { date: string; time: string } {
  const next = new Date(now.getTime() + 86_400_000);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: "09:00" };
}

/** Split an ISO timestamp into local `YYYY-MM-DD` and `HH:MM` input strings. */
export function toLocalDateTimeInputs(iso: string): { date: string; time: string } {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return defaultScheduleInputs();
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
}

/** Combine local `YYYY-MM-DD` + `HH:MM` inputs into a UTC ISO string, or null when invalid. */
export function combineLocalDateTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}/.test(time)) return null;
  const combined = new Date(`${date}T${time}`);
  return Number.isFinite(combined.getTime()) ? combined.toISOString() : null;
}

/** Human-readable local date/time label (e.g. "Tue, Dec 2 at 9:00 AM"). */
export function formatScheduledTime(iso: string, timeZone?: string): string {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    }).format(parsed);
  } catch {
    return parsed.toLocaleString();
  }
}

export function activeSchedules(items: ScheduledRelease[] | undefined): ScheduledRelease[] {
  return (items ?? []).filter((item) => item.state === "scheduled" || item.state === "publishing" || item.state === "failed");
}
