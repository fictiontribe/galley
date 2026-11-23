/**
 * What is kept of the page a submission came from. Query strings often carry
 * things nobody meant to store — e-mail addresses, session ids, one-time
 * tokens — so only the campaign parameters (`utm_*`) survive, and fragments
 * never do.
 */
import type { FormSubmission } from "../kit";

const MAX_URL = 2048;
const MAX_TITLE = 300;

/** An http(s) address with every query parameter but `utm_*` and the fragment removed; null when it isn't one. */
export function trimPageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let url: URL;

  try {
    url = new URL(raw.trim().slice(0, MAX_URL * 2));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const kept = new URLSearchParams();

  for (const [key, value] of url.searchParams) if (/^utm_[a-z0-9_]+$/i.test(key)) kept.append(key, value);
  url.search = kept.toString();
  url.hash = "";
  url.username = "";
  url.password = "";
  const text = url.toString();

  return text.length > MAX_URL ? null : text;
}

/** The `page` record stored with a submission, or undefined when nothing usable was sent. */
export function storedPage(raw: unknown): FormSubmission["page"] {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as { url?: unknown; title?: unknown; referrer?: unknown };
  const page: NonNullable<FormSubmission["page"]> = {};
  const url = trimPageUrl(input.url);
  const referrer = trimPageUrl(input.referrer);

  if (url) page.url = url;
  if (referrer) page.referrer = referrer;
  if (typeof input.title === "string" && input.title.trim()) page.title = input.title.trim().slice(0, MAX_TITLE);
  return Object.keys(page).length ? page : undefined;
}

/** The `utm_*` parameters of a stored page address, for "how the visitor arrived". */
export function campaignOf(url: string | undefined): Array<{ key: string; value: string }> {
  if (!url) return [];
  try {
    return [...new URL(url).searchParams].filter(([key]) => key.startsWith("utm_")).map(([key, value]) => ({ key, value }));
  } catch {
    return [];
  }
}
