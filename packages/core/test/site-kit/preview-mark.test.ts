/**
 * The preview proxy marks every previewed page's <html> — as the editor's
 * preview (the site kit keeps third-party scripts inert) and with this app's
 * inbox address (the kit's forms send there) — without touching the site's
 * files or adding a script a site's CSP could refuse.
 */
import { describe, expect, it } from "vitest";
import { markHtmlElement } from "../../src/workspace/preview/proxy";

const mark = (html: string, attributes: Record<string, string>) => markHtmlElement(Buffer.from(html, "latin1"), attributes).toString("latin1");
const ATTRS = { "data-galley-preview": "", "data-galley-endpoint": "http://127.0.0.1:4620/f/abc" };

describe("marking a previewed page", () => {
  it("adds the attributes to the <html> start tag and nothing else", () => {
    expect(mark('<!doctype html>\n<html lang="en">\n<head></head><body>x</body></html>', ATTRS)).toBe(
      '<!doctype html>\n<html lang="en" data-galley-preview data-galley-endpoint="http://127.0.0.1:4620/f/abc">\n<head></head><body>x</body></html>',
    );
  });

  it("keeps what the page says itself, and escapes values", () => {
    expect(mark('<html data-galley-endpoint="https://cms.example.com/f/abc"><head></head></html>', ATTRS)).toBe('<html data-galley-endpoint="https://cms.example.com/f/abc" data-galley-preview><head></head></html>');
    expect(mark("<HTML>", { "data-galley-endpoint": 'a"b<c&' })).toBe('<HTML data-galley-endpoint="a&quot;b&lt;c&amp;">');
  });

  it("leaves a page without <html> alone", () => {
    expect(mark("<p>fragment</p>", ATTRS)).toBe("<p>fragment</p>");
  });
});
