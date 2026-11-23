import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSiteModel } from "@galley/core/content";
import type { BlockType } from "@galley/core/types";
import { elementorOutlineFromData, elementorOutlineFromHtml, isElementorHtml } from "../src/convert/builders/elementor";
import { builderOfHtml, builderOutlineFromHtml } from "../src/convert/builders/generic";
import { convertHtml } from "../src/convert/html";
import { classifySection, suggestSection } from "../src/rebuild";
import { readWxr } from "../src/source/wxr";
import type { OutlineSection } from "../src/types";
import { PAGES } from "./fixtures/rest";
import { FIXTURES, STARTER } from "./helpers";

const toMarkdown = (html: string) => convertHtml(html, { siteUrl: "https://old.example.org", form: "rendered" }).markdown;
let blocks: BlockType[];
let elementorData: unknown;

beforeAll(async () => {
  const model = await loadSiteModel(STARTER);

  blocks = model.collections.find((c) => c.id === "pages")!.fields.find((f) => f.type === "blocks")!.blocks!;
  const wp = await readWxr(join(FIXTURES, "quillfield.wxr"));

  elementorData = wp.items.find((item) => item.id === 304)!.builder!.data;
});

describe("Elementor outline", () => {
  it("reads _elementor_data into sections, columns and items, in order", () => {
    const outline = elementorOutlineFromData(elementorData, { toMarkdown })!;

    expect(outline.from).toBe("elementor-data");
    expect(outline.sections).toHaveLength(7);
    expect(outline.sections[0]!.anchor).toBe("intro");
    expect(outline.sections[0]!.columns[0]!.items.map((item) => item.kind)).toEqual(["heading", "text", "button"]);
    expect(outline.sections[1]!.columns.map((column) => column.width)).toEqual([33, 33, 33]);
    expect(outline.sections.map((section) => section.hints)).toEqual([
      ["a large heading with a short text and a button"],
      ["three equal columns each with an icon, a heading and text"],
      ["a quote with a name and a role"],
      ["three questions with answers"],
      ["two equal columns each with a price plan"],
      ["a row of four logos"],
      ["a contact form with three fields"],
    ]);
    expect(outline.sections[4]!.columns[1]!.items[0]).toEqual({ kind: "price", name: "Weekend course", price: "£95", period: "per weekend", features: ["Two full days", "Lunch included"], button: { label: "Book a weekend", href: "https://old.example.org/opening-hours/" }, featured: true });
  });

  it("reads the rendered page (REST) into the same shape", () => {
    const html = String((PAGES[0]!.content as { rendered: string }).rendered).replaceAll("{{SITE}}", "https://old.example.org");

    expect(isElementorHtml(html)).toBe(true);
    const outline = elementorOutlineFromHtml(html, { toMarkdown });

    expect(outline.from).toBe("html");
    expect(outline.sections.map((section) => section.hints[0])).toEqual([
      "a large heading with a short text and a button",
      "three equal columns each with an icon, a heading and text",
      "a quote with a name and a role",
      "two questions with answers",
      "a contact form with two fields",
    ]);
    expect(outline.sections[1]!.columns[0]!.items[0]).toEqual({ kind: "card", icon: "hand-paper", heading: "Throwing", text: "Learn to centre, open and pull a cylinder." });
    expect(outline.sections[3]!.columns[0]!.items[1]).toEqual({ kind: "faq", items: [{ question: "Do I need any experience?", answer: "None at all." }, { question: "What should I wear?", answer: "Clothes you don’t mind getting muddy." }] });
  });
});

describe("Divi and WPBakery outlines", () => {
  it("recognises builders from their markup", () => {
    expect(builderOfHtml('<div class="et_pb_section et_pb_section_0">')).toBe("divi");
    expect(builderOfHtml('<div class="vc_row wpb_row vc_row-fluid">')).toBe("wpbakery");
    expect(builderOfHtml('<div class="fl-builder-content">')).toBe("beaver");
    expect(builderOfHtml("<p>Just a post.</p>")).toBeNull();
  });

  it("reads rendered Divi modules (blurbs, toggles, prices)", () => {
    const html = `<div class="et_pb_section"><div class="et_pb_row"><div class="et_pb_column et_pb_column_1_2"><div class="et_pb_module et_pb_blurb"><div class="et_pb_main_blurb_image"><span class="et-pb-icon">a</span></div><h4 class="et_pb_module_header">Talk</h4><div class="et_pb_blurb_description"><p>Tell us.</p></div></div></div><div class="et_pb_column et_pb_column_1_2"><div class="et_pb_module et_pb_blurb"><span class="et-pb-icon">b</span><h4 class="et_pb_module_header">Make</h4><div class="et_pb_blurb_description"><p>We make it.</p></div></div></div></div></div>
<div class="et_pb_section"><div class="et_pb_row"><div class="et_pb_column et_pb_column_4_4"><div class="et_pb_toggle"><h5 class="et_pb_toggle_title">How long?</h5><div class="et_pb_toggle_content"><p>Six weeks.</p></div></div><div class="et_pb_toggle"><h5 class="et_pb_toggle_title">How much?</h5><div class="et_pb_toggle_content"><p>It depends.</p></div></div></div></div></div>`;
    const outline = builderOutlineFromHtml(html, "divi", "html", toMarkdown);

    expect(outline.sections.map((section) => section.hints)).toEqual([["two equal columns each with an icon, a heading and text"], ["two questions with answers"]]);
    expect(outline.sections[0]!.columns.map((column) => column.width)).toEqual([50, 50]);
  });
});

function section(index: number, items: OutlineSection["columns"][number]["items"], hints: string[] = []): OutlineSection {
  return { index, columns: [{ items }], hints };
}

describe("rebuild suggestions", () => {
  it("classifies by content, conservatively", () => {
    expect(classifySection(section(2, [{ kind: "counter", value: "12", label: "wheels" }, { kind: "counter", value: "300", label: "students" }])).shape).toBe("stats");
    expect(classifySection(section(2, [{ kind: "image", src: "a.png", alt: "" }, { kind: "image", src: "b.png", alt: "" }, { kind: "image", src: "c.png", alt: "" }], ["a gallery of three images"])).shape).toBe("gallery");
    expect(classifySection(section(2, [{ kind: "card", heading: "1. Talk", text: "a" }, { kind: "card", heading: "2. Make", text: "b" }])).shape).toBe("steps");
    expect(classifySection(section(3, [{ kind: "heading", level: 2, text: "Ready?" }, { kind: "text", markdown: "Book now." }, { kind: "button", label: "Book", href: "/b/" }])).shape).toBe("cta");
    expect(classifySection(section(1, [{ kind: "other", widget: "countdown", text: "3 days" }])).shape).toBe("unknown");
  });

  it("matches the target's own section types and fills fields only from the outline", () => {
    const stats = suggestSection(section(2, [{ kind: "heading", level: 2, text: "In numbers" }, { kind: "counter", value: "12", label: "wheels" }, { kind: "counter", value: "300", label: "students" }]), blocks);

    expect(stats).toMatchObject({ blockType: "stats", confidence: "high", content: { heading: "In numbers", items: [{ value: "12", label: "wheels" }, { value: "300", label: "students" }] } });
    const cta = suggestSection(section(3, [{ kind: "heading", level: 2, text: "Ready?" }, { kind: "text", markdown: "Book now." }, { kind: "button", label: "Book", href: "/b/" }]), blocks);

    expect(cta).toMatchObject({ blockType: "cta", confidence: "high", content: { heading: "Ready?", text: "Book now.", cta: { label: "Book", href: "/b/" } } });
  });

  it("says 'no close match' instead of forcing one", () => {
    const odd = suggestSection(section(1, [{ kind: "other", widget: "countdown", text: "3 days" }]), blocks);

    expect(odd).toMatchObject({ blockType: null, confidence: "none" });
    const pricingOnly = suggestSection(section(1, [{ kind: "price", name: "A", price: "£1", features: [] }]), blocks.filter((block) => block.type !== "pricing"));

    expect(pricingOnly.blockType).toBeNull();
    expect(pricingOnly.reason).toMatch(/this site has no section type for price plans/);
  });
});
