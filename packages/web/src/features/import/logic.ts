/**
 * The WordPress move's pure parts: what the address box accepts, the words
 * for counts and steps, which next steps are done, and the chunked reading
 * of an export file. No React here, so it is tested on its own.
 */
import type { ImportInspection, ImportReportView, ImportRunStatus, ImportStep } from "@galley/core/types";
import { count } from "@/lib/format";

export type FlowStep = "source" | "plan" | "run" | "report";
export const FLOW: FlowStep[] = ["source", "plan", "run", "report"];
export const FLOW_LABEL: Record<FlowStep, string> = { source: "Where it is", plan: "What comes across", run: "Bringing it over", report: "The report" };

/** Enough of an address to be worth looking at: a dot or a port in a host, no spaces. */
export function addressReady(text: string): boolean {
  const value = text.trim();
  if (!value || /\s/.test(value)) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return /\.[a-z]{2,}$/i.test(url.hostname) || url.port !== "" || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname === "localhost";
  } catch {
    return false;
  }
}

/** "https://www.example.com/" → "www.example.com". */
export function shortAddress(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** The counts of a quick look, as the person reads them: what's there, and the one thing that won't come across. */
export function inspectionFacts(look: ImportInspection): Array<{ value: string; label: string; muted?: boolean }> {
  const { posts, pages, media, comments } = look.counts;
  const fact = (n: number | null, one: string, many: string, muted?: boolean) => (n === null ? null : { value: n.toLocaleString(), label: n === 1 ? one : many, ...(muted ? { muted } : {}) });
  return [fact(posts, "post", "posts"), fact(pages, "page", "pages"), fact(media, "image or file", "images and files"), fact(comments || null, "comment — stays behind", "comments — stay behind", true)].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

/** "Bringing over posts — 41 of 312". */
export function stepLine(step: ImportStep): string {
  return step.total ? `${step.label} — ${(step.done ?? 0).toLocaleString()} of ${step.total.toLocaleString()}` : step.label;
}

/** The steps worth showing: a step that had nothing to do disappears once the run is past it. */
export function visibleSteps(status: ImportRunStatus): ImportStep[] {
  return status.steps.filter((step) => step.state !== "skipped" && !(step.id === "pages" && status.state === "done" && !step.total));
}

export interface NextStep {
  id: "resume" | "proof" | "rebuild" | "redirects" | "online" | "domain";
  title: string;
  body: string;
}

/** Review in Proof → rebuild page-builder pages → set redirects → put the site online → switch the domain. */
export function nextSteps(report: ImportReportView): NextStep[] {
  const arrived = report.arrived.posts + report.arrived.pages + report.arrived.updated;
  const rebuilt = report.rebuilds.filter((rebuild) => rebuild.threadId).length;
  const waiting = [arrived ? count(arrived, "entry", "entries") : "", report.arrived.images ? count(report.arrived.images, "image") : ""].filter(Boolean);
  const steps: NextStep[] = [];
  if (report.stopped) steps.push({ id: "resume", title: "Finish bringing it over", body: "Start the import again: what arrived stays as it is and the rest follows. Nothing is duplicated." });
  steps.push({
    id: "proof",
    title: "Review it in Proof",
    body: waiting.length ? `${waiting.join(" and ")} ${arrived + report.arrived.images === 1 ? "is" : "are"} waiting there. Nothing is live until you publish.` : "Nothing new arrived this time.",
  });
  if (report.rebuilds.length) {
    steps.push({
      id: "rebuild",
      title: "Rebuild the page-builder pages",
      body: rebuilt ? `${rebuilt} of ${report.rebuilds.length} started with the assistant.` : `${count(report.rebuilds.length, "page")} came across as plain text; the assistant rebuilds each from this site’s sections.`,
    });
  }
  if (report.redirects.count) steps.push({ id: "redirects", title: "Set the redirects", body: `So ${count(report.redirects.count, "old address", "old addresses")} keep working, and search engines follow them.` });
  steps.push(
    { id: "online", title: "Put the site online", body: "Publish, then put it on a host — the app walks you through it." },
    { id: "domain", title: "Switch the domain", body: "When the new site looks right online, point your domain at it. Keep WordPress running until then." },
  );
  return steps;
}

export const CHUNK_BYTES = 6 * 1024 * 1024;

/** Base64 of a slice of bytes (the browser's own encoder, a chunk at a time so a big file never sits in one string). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let at = 0; at < bytes.length; at += step) binary += String.fromCharCode(...bytes.subarray(at, at + step));
  return btoa(binary);
}

/** Whether a dropped file looks like an export, before it is sent: the server checks properly. */
export function exportFileProblem(file: { name: string; size: number }): string | null {
  if (!/\.(xml|wxr)$/i.test(file.name)) return "That isn’t an export file. WordPress’s export ends in .xml — in WordPress, open Tools › Export and choose “All content”.";
  if (file.size > 200 * 1024 * 1024) return "That export is over 200 MB, more than can be uploaded here. Export posts and pages separately (Tools › Export lets you choose), or use the command line.";
  if (file.size === 0) return "That file is empty. Export it from WordPress again.";
  return null;
}

/** A rough cost as a short phrase: "about $0.40–$1.20". */
export function costRange(estimate: { low: number; high: number } | null): string | null {
  if (!estimate) return null;
  const money = (value: number) => (value < 0.01 ? "under $0.01" : `$${value.toFixed(2)}`);
  return estimate.low === estimate.high ? `about ${money(estimate.low)}` : `about ${money(estimate.low)}–${money(estimate.high)}`;
}
