import { describe, expect, it } from "vitest";
import type { BlockType, Field } from "@galley/core/types";
import { blocksFields, fieldSummary, groupBlocks, humanize, optionFields, optionValue, parseSectionKey, positionWords, searchBlocks, sectionEvidence, sectionKey, sectionLists, shownText } from "@/features/builder/model";

const f = (key: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({ key, label: humanize(key), type, required: false, source: "schema", ...extra });
const block = (type: string, label: string, fields: Field[] = [], extra: Partial<BlockType> = {}): BlockType => ({ type, label, fields, count: 1, ...extra });

const HERO = block("hero", "Hero", [f("heading", "string"), f("text", "markdown"), f("image", "image"), f("tone", "select", { options: ["default", "muted", "inverse", "accent"], default: "default" }), f("cta", "object", { fields: [f("label", "string"), f("href", "url")] })]);
const CTA = block("cta", "Call to action", [f("heading", "string"), f("cta", "object", { fields: [f("label", "string"), f("href", "url")] })]);
const SECTIONS = f("sections", "blocks", { discriminator: "type", blocks: [HERO, CTA] });

describe("what the overlay is told about the page's sections", () => {
  it("lists only the entry's visible blocks fields", () => {
    expect(blocksFields([f("title", "string"), SECTIONS, f("old", "blocks", { hidden: true })]).map((field) => field.key)).toEqual(["sections"]);
  });

  it("reads markdown as the page shows it: one string per paragraph or list item, marks gone", () => {
    expect(shownText("Make more of the *home you have*.\n\nWe work in [fixed fees](/pricing/),\nalways.")).toEqual(["Make more of the home you have.", "We work in fixed fees, always."]);
    expect(shownText("- One thing\n- **Two** things")).toEqual(["One thing", "Two things"]);
    expect(shownText("## A heading")).toEqual(["A heading"]);
  });

  it("collects a section's own strings and images, never addresses or settings", () => {
    const evidence = sectionEvidence({ type: "hero", heading: "Hello there", tone: "muted", image: "/images/a.png", cta: { label: "Book a visit", href: "/contact/" } }, HERO, "type");
    expect(evidence.texts).toEqual(["Hello there", "Book a visit"]);
    expect(evidence.images).toEqual(["/images/a.png"]);
  });

  it("keeps evidence distinct: strings two sections share can't tell them apart", () => {
    const lists = sectionLists([SECTIONS], {
      sections: [
        { type: "hero", heading: "Welcome home", cta: { label: "Get in touch", href: "/c/" } },
        { type: "cta", heading: "Ready when you are", cta: { label: "Get in touch", href: "/c/" } },
      ],
    });
    expect(lists).toEqual([
      {
        field: "sections",
        sections: [
          { index: 0, type: "hero", label: "Hero", texts: ["Welcome home"], images: [] },
          { index: 1, type: "cta", label: "Call to action", texts: ["Ready when you are"], images: [] },
        ],
      },
    ]);
  });

  it("names a section of a type the site doesn't describe by its raw type", () => {
    const lists = sectionLists([SECTIONS], { sections: [{ type: "mystery", heading: "Odd one" }] });
    expect(lists[0]?.sections[0]).toMatchObject({ type: "mystery", label: "mystery", texts: ["Odd one"] });
  });

  it("section keys round-trip", () => {
    expect(parseSectionKey(sectionKey("sections", 3))).toEqual({ field: "sections", index: 3 });
    expect(parseSectionKey("sections")).toBeNull();
    expect(parseSectionKey("page.blocks.12")).toEqual({ field: "page.blocks", index: 12 });
  });
});

describe("a section's options", () => {
  it("are its short choices and switches, never free text", () => {
    const fields = [f("heading", "string"), f("tone", "select", { options: ["a", "b", "c"] }), f("columns", "select", { options: ["1", "2", "3", "4", "5", "6", "7"] }), f("single", "select", { options: ["only"] }), f("dark", "boolean"), f("hidden", "boolean", { hidden: true }), f("count", "number")];
    expect(optionFields(block("x", "X", fields)).map((field) => field.key)).toEqual(["tone", "dark"]);
    expect(optionFields(undefined)).toEqual([]);
  });

  it("show the stored value, else the schema's default", () => {
    const tone = f("tone", "select", { options: ["default", "muted"], default: "default" });
    expect(optionValue({ tone: "muted" }, tone)).toBe("muted");
    expect(optionValue({}, tone)).toBe("default");
    expect(optionValue({}, f("side", "select", { options: ["left", "right"] }))).toBeUndefined();
  });

  it("humanises values and keys", () => {
    expect(humanize("media-left")).toBe("Media left");
    expect(humanize("imageSide")).toBe("Image side");
    expect(humanize("left")).toBe("Left");
  });
});

describe("the palette", () => {
  const types = (labels: string[]) => labels.map((label, at) => block(`t${at}`, label));

  it("stays a flat list when the labels don't make groups obvious", () => {
    const reference = types(["Hero", "Logos", "Features", "Split", "Stats", "Steps", "Testimonial", "Testimonials", "Pricing", "FAQ", "Gallery", "Team", "Posts", "Rich text", "CTA", "Contact"]);
    expect(groupBlocks(reference)).toEqual([{ label: null, blocks: reference }]);
    expect(groupBlocks(types(["Hero", "Hero with form", "CTA"]))).toHaveLength(1);
  });

  it("groups by the labels' shared first word when two or more such groups exist", () => {
    const saas = types(["Hero", "Hero with screenshot", "Hero with form", "Logo row", "Metrics", "Testimonial", "Testimonials", "Feature grid", "Feature with screenshot", "Feature tabs", "Steps", "FAQ"]);
    const groups = groupBlocks(saas);
    expect(groups.map((group) => group.label)).toEqual(["Hero", "Testimonial", "Feature", "More sections"]);
    expect(groups[0]?.blocks.map((item) => item.label)).toEqual(["Hero", "Hero with screenshot", "Hero with form"]);
    expect(groups.flatMap((group) => group.blocks)).toHaveLength(saas.length);
  });

  it("searches labels, types and descriptions", () => {
    const list = [block("hero", "Hero", [], { description: "The opening statement" }), block("faq", "FAQ")];
    expect(searchBlocks(list, "opening").map((item) => item.type)).toEqual(["hero"]);
    expect(searchBlocks(list, "FA").map((item) => item.type)).toEqual(["faq"]);
    expect(searchBlocks(list, "  ")).toHaveLength(2);
  });

  it("summarises a type's fields for a card with no picture", () => {
    expect(fieldSummary(HERO)).toBe("Heading · Text · Image · 1 more");
    expect(fieldSummary(block("empty", "Empty"))).toBe("No fields");
  });

  it("says where a new section goes", () => {
    expect(positionWords([], 0)).toBe("on this page");
    expect(positionWords(["Hero", "FAQ"], 0)).toBe("at the top of the page");
    expect(positionWords(["Hero", "FAQ"], 1)).toBe("after “Hero”");
    expect(positionWords(["Hero", "FAQ"], 2)).toBe("at the end of the page");
  });
});
