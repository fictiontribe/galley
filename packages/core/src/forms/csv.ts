/**
 * Submissions as a spreadsheet file: RFC 4180 CSV with CRLF line ends, a
 * UTF-8 byte-order mark (so Excel reads accents and non-Latin text
 * correctly), the form's fields as columns in the form's own order with their
 * labels as headers, then any answers for fields the form no longer has.
 *
 * A cell that starts with = + - @ (or a tab or carriage return) is prefixed
 * with ' so a spreadsheet shows it as text instead of running it as a
 * formula — visitors write these cells.
 */
import type { FormDefinition, FormSubmission } from "../kit";
import { isLayoutField } from "./validate";

export const CSV_BOM = "﻿";

export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function cellText(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join("; ") : value;
}

/** The CSV text (with BOM) for these submissions, oldest first as given. */
export function submissionsCsv(form: FormDefinition | null, submissions: FormSubmission[]): string {
  const fields = (form?.fields ?? []).filter((field) => !isLayoutField(field));
  const columns: Array<{ id: string; header: string }> = fields.map((field) => ({ id: field.id, header: field.label?.trim() || field.id }));
  const known = new Set(columns.map((column) => column.id));

  for (const submission of submissions) {
    for (const id of Object.keys(submission.values)) {
      if (!known.has(id)) {
        known.add(id);
        columns.push({ id, header: id });
      }
    }
  }
  const header = ["Received", ...columns.map((column) => column.header), "Page", "Referrer", "Spam"];
  const rows = submissions.map((submission) => [
    submission.at,
    ...columns.map((column) => cellText(submission.values[column.id])),
    submission.page?.url ?? "",
    submission.page?.referrer ?? "",
    submission.spam ? "yes" : "",
  ]);

  return `${CSV_BOM}${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** "contact-submissions-2026-11-23.csv" */
export function csvFileName(formId: string, now = new Date()): string {
  return `${formId}-submissions-${now.toISOString().slice(0, 10)}.csv`;
}
