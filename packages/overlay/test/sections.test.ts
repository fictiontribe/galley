// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { OverlaySectionList } from "@galley/core/types";
import { edgeSpeed, gapAt, gapY, moveTo, nearGap } from "../src/geometry";
import { mapSections } from "../src/sections";

const list = (sections: Array<{ type: string; label?: string; texts?: string[]; images?: string[] }>, field = "sections"): OverlaySectionList => ({
  field,
  sections: sections.map((section, index) => ({ index, type: section.type, label: section.label ?? section.type, texts: section.texts ?? [], images: section.images ?? [] })),
});

const page = (main: string) => {
  document.body.innerHTML = `<header><nav><a href="/">Home</a><a href="/about/">About</a></nav></header><main>${main}</main><footer><p>Small print for the whole site</p></footer>`;
};
const $ = (selector: string) => document.querySelector(selector);

const HERO = `<section id="s0"><div class="container"><p class="eyebrow">Studio</p><h1>Make more of the <em>home you have</em>.</h1><p>Clear drawings and fixed fees.</p><a href="/contact/">Book a visit</a></div><img src="/images/hero.svg" alt=""></section>`;
const FEATURES = `<section id="s1"><div class="container"><h2>Four ways we help</h2><ul><li><h3>Extensions</h3><p>Side returns and rear extensions.</p></li><li><h3>Lofts</h3><p>Dormers and rooflights.</p></li></ul></div></section>`;
const CTA = `<section id="s2"><div class="container"><h2>Tell us about your house.</h2><a href="/contact/">Get in touch</a></div></section>`;

const LISTS = list([
  { type: "hero", label: "Hero", texts: ["Studio", "Make more of the home you have.", "Clear drawings and fixed fees.", "Book a visit"], images: ["/images/hero.svg"] },
  { type: "features", label: "Features", texts: ["Four ways we help", "Extensions", "Side returns and rear extensions.", "Lofts", "Dormers and rooflights."] },
  { type: "cta", label: "CTA", texts: ["Tell us about your house.", "Get in touch"] },
]);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mapping sections by markers", () => {
  it("a marked page maps each section to its marked element, exactly", () => {
    page(
      `<section data-galley-block="sections.0" data-galley-block-type="hero" id="m0"><h1>Same words</h1></section>` +
        `<section data-galley-block="sections.1" data-galley-block-type="features" id="m1"><h2>Same words</h2></section>` +
        `<section data-galley-block="sections.2" data-galley-block-type="cta" id="m2"><h2>Same words</h2></section>`,
    );
    // Markers need no evidence: identical text in every section doesn't matter.
    const result = mapSections(document, [list([{ type: "hero" }, { type: "features" }, { type: "cta" }])]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.how).toBe("markers");
    expect(result.sections.map((section) => section.element.id)).toEqual(["m0", "m1", "m2"]);
    expect(result.sections.map((section) => section.key)).toEqual(["sections.0", "sections.1", "sections.2"]);
  });

  it("a page that marks a different set of sections than the content is stale, not mapped", () => {
    page(`<section data-galley-block="sections.0" data-galley-block-type="hero"></section><section data-galley-block="sections.1" data-galley-block-type="cta"></section>`);
    const result = mapSections(document, [list([{ type: "hero" }, { type: "features" }])]);
    expect(result).toMatchObject({ ok: false, stale: true });
    const fewer = mapSections(document, [list([{ type: "hero" }])]);
    expect(fewer).toMatchObject({ ok: false, stale: true });
  });

  it("nested markers are declined", () => {
    page(`<section data-galley-block="sections.0"><div data-galley-block="sections.1"></div></section>`);
    const result = mapSections(document, [list([{ type: "hero" }, { type: "features" }])]);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/nested/);
  });

  it("markers out of content order are declined", () => {
    page(`<section data-galley-block="sections.1" data-galley-block-type="features"></section><section data-galley-block="sections.0" data-galley-block-type="hero"></section>`);
    expect(mapSections(document, [list([{ type: "hero" }, { type: "features" }])]).ok).toBe(false);
  });

  it("marks of another blocks field don't count against this one", () => {
    page(`<section data-galley-block="sections.0"><div data-galley-block="sections.0.columns.0"></div></section>`);
    const result = mapSections(document, [list([{ type: "hero" }])]);
    expect(result.ok).toBe(true);
  });
});

describe("mapping sections by evidence (no markers)", () => {
  it("an unmarked page whose sections each show their own words maps to the section elements", () => {
    page(HERO + FEATURES + CTA);
    const result = mapSections(document, [LISTS]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.how).toBe("evidence");
    // The root is widened past the inner container to the whole section (the hero's image included).
    expect(result.sections.map((section) => section.element.id)).toEqual(["s0", "s1", "s2"]);
  });

  it("never widens a section into the site's header, footer or navigation", () => {
    document.body.innerHTML = `<div id="wrap"><header><nav><a href="/">Home</a></nav></header><div id="only"><h1>Only section heading</h1><p>Only section text.</p></div><footer><p>Footer words</p></footer></div>`;
    const result = mapSections(document, [list([{ type: "hero", texts: ["Only section heading", "Only section text."] }])]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sections[0]?.element.id).toBe("only");
  });

  it("ambiguous: two sections showing identical text are declined, never guessed", () => {
    page(`<section><h2>Learn more</h2><p>Learn more</p></section><section><h2>Learn more</h2></section>`);
    const result = mapSections(
      document,
      [list([
        { type: "a", texts: ["Learn more"] },
        { type: "b", texts: ["Learn more"] },
      ])],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no text or image that only it has/);
  });

  it("text that also shows elsewhere on the page isn't evidence", () => {
    page(HERO.replace("Book a visit", "Small print for the whole site") + FEATURES + CTA);
    // The hero still resolves from its other strings; the footer's copy of the line is ignored.
    const result = mapSections(document, [LISTS]);
    expect(result.ok).toBe(true);
  });

  it("a section with nothing of its own on the page declines the whole page", () => {
    page(HERO + FEATURES + CTA);
    const lists = list([...LISTS.sections, { index: 3, type: "gallery", label: "Gallery", texts: ["Not on the page"], images: [] }].map((section) => ({ type: section.type, label: section.label, texts: section.texts, images: section.images })));
    expect(mapSections(document, [lists]).ok).toBe(false);
  });

  it("nested sections are declined", () => {
    page(`<section id="outer"><h2>Outer heading</h2><div id="inner"><h3>Inner heading</h3></div><p>Outer closing words</p></section>`);
    const result = mapSections(
      document,
      [list([
        { type: "outer", texts: ["Outer heading", "Outer closing words"] },
        { type: "inner", texts: ["Inner heading"] },
      ])],
    );
    expect(result.ok).toBe(false);
  });

  it("interleaved sections are declined", () => {
    page(`<div><h2>A one</h2><h2>B one</h2><h2>A two</h2><h2>B two</h2></div>`);
    const result = mapSections(
      document,
      [list([
        { type: "a", texts: ["A one", "A two"] },
        { type: "b", texts: ["B one", "B two"] },
      ])],
    );
    expect(result.ok).toBe(false);
  });

  it("a page in a different order than the content is declined (it may be reloading)", () => {
    page(FEATURES + HERO + CTA);
    const result = mapSections(document, [LISTS]);
    expect(result).toMatchObject({ ok: false, stale: true });
  });

  it("re-maps after a hot reload reorders the page and the content agrees", () => {
    page(HERO + FEATURES + CTA);
    expect(mapSections(document, [LISTS]).ok).toBe(true);
    // The person moved the CTA to the top: the content changes first, the page follows.
    const moved = list([LISTS.sections[2], LISTS.sections[0], LISTS.sections[1]].map((section) => ({ type: section!.type, label: section!.label, texts: section!.texts, images: section!.images })));
    expect(mapSections(document, [moved]).ok).toBe(false);
    const main = $("main") as HTMLElement;
    main.prepend($("#s2") as HTMLElement);
    const result = mapSections(document, [moved]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sections.map((section) => section.element.id)).toEqual(["s2", "s0", "s1"]);
  });

  it("an image the section stores counts as evidence", () => {
    page(`<section id="a"><img src="/images/one.png" alt=""></section><section id="b"><h2>Second</h2></section>`);
    const result = mapSections(
      document,
      [list([
        { type: "gallery", images: ["/images/one.png"] },
        { type: "cta", texts: ["Second"] },
      ])],
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sections[0]?.element.id).toBe("a");
  });
});

describe("drop arithmetic", () => {
  const spans = [
    { top: 0, bottom: 100 },
    { top: 100, bottom: 300 },
    { top: 300, bottom: 400 },
  ];
  it("finds the gap under the pointer by section middles", () => {
    expect(gapAt(spans, 10)).toBe(0);
    expect(gapAt(spans, 60)).toBe(1);
    expect(gapAt(spans, 250)).toBe(2);
    expect(gapAt(spans, 399)).toBe(3);
  });
  it("places gaps between sections and at both ends", () => {
    expect(gapY(spans, 0)).toBe(0);
    expect(gapY(spans, 1)).toBe(100);
    expect(gapY(spans, 3)).toBe(400);
  });
  it("turns a gap into the moved section's final position, or nothing when it stays", () => {
    expect(moveTo(0, 0)).toBeNull();
    expect(moveTo(0, 1)).toBeNull();
    expect(moveTo(0, 3)).toBe(2);
    expect(moveTo(2, 0)).toBe(0);
    expect(moveTo(1, 3)).toBe(2);
  });
  it("offers the ＋ only near a boundary", () => {
    expect(nearGap(spans, 104, 20)).toBe(1);
    expect(nearGap(spans, 200, 20)).toBeNull();
  });
  it("scrolls faster the closer the pointer is to an edge", () => {
    expect(edgeSpeed(400, 800)).toBe(0);
    expect(edgeSpeed(2, 800)).toBeLessThan(edgeSpeed(40, 800));
    expect(edgeSpeed(798, 800)).toBeGreaterThan(0);
  });
});
