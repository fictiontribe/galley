/**
 * Reading pages from a preview that has only just started: the first ask of
 * each page compiles it, so a quick timeout fails pages that are fine. The
 * audit wakes the preview, asks again, and reports only pages that really
 * didn't answer.
 */
import { describe, expect, it } from "vitest";
import { fetchPages, unansweredNote } from "../../src/seo/audit";
import type { Fetched } from "../../src/seo/render";

const page = (url: string): Fetched => ({ status: 200, body: `<html><title>${url}</title></html>`, type: "text/html", finalPath: url });
const URLS = ["/", "/atelier/", "/journal/", "/contact/", "/stockists/"];

/** A fake preview: `answer(url, patient, nth)` decides each response; every ask is recorded. */
function preview(answer: (url: string, patient: boolean, nth: number) => Fetched | null) {
  const asks: Array<{ url: string; patient: boolean }> = [];
  const seen = new Map<string, number>();

  return {
    asks,
    source: {
      kind: "preview" as const,
      async get(url: string, options: { patient?: boolean } = {}) {
        const nth = (seen.get(url) ?? 0) + 1;

        seen.set(url, nth);
        asks.push({ url, patient: Boolean(options.patient) });
        return answer(url, Boolean(options.patient), nth);
      },
    },
  };
}

describe("pages from a preview that has just started", () => {
  it("wakes it with one patient ask, then asks again for pages that timed out, and reports none", async () => {
    // Cold: only a patient ask gets an answer while the pages compile.
    const { source, asks } = preview((url, patient) => (patient ? page(url) : null));
    const { got, unanswered } = await fetchPages(source, URLS);

    expect(unanswered).toEqual([]);
    expect([...got.values()].every((item) => item?.status === 200)).toBe(true);
    expect(asks[0]).toEqual({ url: "/", patient: true });
    expect(asks.filter((ask) => ask.patient).map((ask) => ask.url)).toEqual(URLS);
  });

  it("reports only the page that still doesn't answer, and keeps asking the others after a page's own error", async () => {
    const { source } = preview((url, patient) => (url === "/journal/" ? { ...page(url), status: 500 } : url === "/contact/" && !patient ? null : page(url)));
    const { unanswered } = await fetchPages(source, URLS);

    expect(unanswered).toEqual(["/journal/"]);
  });

  it("stops waiting when the preview answers nothing at all", async () => {
    const { source, asks } = preview(() => null);
    const { unanswered } = await fetchPages(source, URLS);

    expect(unanswered).toEqual(URLS);
    // One patient ask (the first page); no patient wait on each of the rest.
    expect(asks.filter((ask) => ask.patient)).toHaveLength(1);
  });

  it("asks a build's files once each and never reports them as not answering", async () => {
    const asks: string[] = [];
    const { unanswered } = await fetchPages({ kind: "build", get: async (url) => (asks.push(url), null) }, URLS);

    expect(unanswered).toEqual([]);
    expect(asks).toEqual(URLS);
  });

  it("says pages didn't answer only when some didn't", () => {
    expect(unansweredNote(0)).toBe("");
    expect(unansweredNote(1)).toBe(" 1 page didn't answer the running preview, even when asked again, so it wasn't checked. Check again in a moment.");
    expect(unansweredNote(13)).toMatch(/^ 13 pages didn't answer the running preview, even when asked again, so they weren't checked\./);
  });
});
