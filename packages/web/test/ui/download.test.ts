// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { download } from "@/lib/download";

afterEach(() => vi.restoreAllMocks());

describe("download", () => {
  it("clicks a download link in the document and takes it away again, leaving the page where it is", () => {
    const clicked: Array<{ href: string; download: string; inDocument: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute("href") ?? "", download: this.getAttribute("download") ?? "(none)", inDocument: document.body.contains(this) });
    });
    const before = window.location.href;

    download("/api/sites/caddow/brand/export?format=tokens");

    expect(clicked).toEqual([{ href: "/api/sites/caddow/brand/export?format=tokens", download: "", inDocument: true }]);
    expect(document.querySelectorAll("a").length).toBe(0);
    expect(window.location.href).toBe(before);
  });
});
