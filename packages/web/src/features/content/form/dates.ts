/**
 * Native date pickers speak "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm". Files speak
 * whatever their author wrote. These convert both ways and write the new
 * value back in the stored value's own shape (separator, seconds, zone).
 */

const DATE = /^(\d{4})([-/.])(\d{2})\2(\d{2})$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})([T ])(\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** The picker value for a stored date, or "" when it can't be read as one. */
export function toDateInput(stored: unknown): string {
  if (typeof stored !== "string") return "";
  const plain = DATE.exec(stored.trim());
  if (plain) return `${plain[1]}-${plain[3]}-${plain[4]}`;
  const full = DATETIME.exec(stored.trim());
  return full?.[1] ?? "";
}

/** The picker value for a stored date-time ("" when unreadable). Shows the stored wall time; zones aren't converted. */
export function toDateTimeInput(stored: unknown): string {
  if (typeof stored !== "string") return "";
  const full = DATETIME.exec(stored.trim());
  if (full) return `${full[1]}T${full[3]}`;
  const plain = DATE.exec(stored.trim());
  return plain ? `${plain[1]}-${plain[3]}-${plain[4]}T00:00` : "";
}

/** Whether the stored text is something the picker can show without losing anything. */
export function isPickable(stored: unknown, kind: "date" | "datetime"): boolean {
  if (stored === undefined || stored === null || stored === "") return true;
  if (typeof stored !== "string") return false;
  return kind === "date" ? DATE.test(stored.trim()) || DATETIME.test(stored.trim()) : DATETIME.test(stored.trim()) || DATE.test(stored.trim());
}

/** A picked date ("YYYY-MM-DD") written the way `stored` was written. */
export function fromDateInput(picked: string, stored: unknown): string {
  if (picked === "") return "";
  const previous = typeof stored === "string" ? stored.trim() : "";
  const plain = DATE.exec(previous);
  if (plain) return picked.replace(/-/g, plain[2] ?? "-");
  const full = DATETIME.exec(previous);
  if (full) return `${picked}${full[2]}${full[3]}${full[4] ?? ""}${full[5] ?? ""}`;
  return picked;
}

/** A picked date-time ("YYYY-MM-DDTHH:mm") written the way `stored` was written. */
export function fromDateTimeInput(picked: string, stored: unknown): string {
  if (picked === "") return "";
  const [day = "", time = ""] = picked.split("T");
  const previous = typeof stored === "string" ? stored.trim() : "";
  const full = DATETIME.exec(previous);
  if (full) {
    // Keep seconds when the file had them; the picker only edits hours and minutes.
    const seconds = full[4] ? (time.length > 5 ? time.slice(5) : full[4]) : "";
    return `${day}${full[2]}${time.slice(0, 5)}${seconds}${full[5] ?? ""}`;
  }
  return `${day}T${time.slice(0, 5)}`;
}
