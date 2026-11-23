import { describe, expect, it } from "vitest";
import type { Field } from "@galley/core/types";
import { rowWindow, scrollToRow } from "@/features/content/collection/window";
import { dropTarget, isLowerHalf } from "@/features/content/fields/items/reorder";
import { labelForPath, previewValue } from "@/features/content/form/labels";
import { insertLink, toggleLinePrefix, toggleWrap, wordCount } from "@/ui/form/markdownText";
import { minimalChange } from "@/ui/form/minimalChange";

describe("markdown formatting", () => {
  it("wraps and unwraps a selection", () => {
    expect(toggleWrap("make it bold", 8, 12, "**")).toEqual({ text: "make it **bold**", start: 10, end: 14 });
    expect(toggleWrap("make it **bold**", 10, 14, "**")).toEqual({ text: "make it bold", start: 8, end: 12 });
    expect(toggleWrap("make it **bold**", 8, 16, "**")).toEqual({ text: "make it bold", start: 8, end: 12 });
  });

  it("prefixes every selected line, or takes the prefix off", () => {
    expect(toggleLinePrefix("one\ntwo\nthree", 0, 7, "- ").text).toBe("- one\n- two\nthree");
    expect(toggleLinePrefix("- one\n- two", 0, 11, "- ").text).toBe("one\ntwo");
    expect(toggleLinePrefix("intro\nHeading", 8, 8, "## ").text).toBe("intro\n## Heading");
  });

  it("makes a link with the address selected", () => {
    const edit = insertLink("see the plans", 8, 13);
    expect(edit.text).toBe("see the [plans](https://)");
    expect(edit.text.slice(edit.start, edit.end)).toBe("https://");
  });

  it("counts words, not markup", () => {
    expect(wordCount("## A heading\n\nSome **bold** text with a [link](/x/) and ![img](/i.png).")).toBe(9);
    expect(wordCount("")).toBe(0);
  });
});

describe("minimal change", () => {
  it("replaces only the part that differs", () => {
    expect(minimalChange("hello world", "hello brave world")).toEqual({ from: 6, to: 6, insert: "brave " });
    expect(minimalChange("abc", "abc")).toBeNull();
    expect(minimalChange("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
  });
});

describe("dragging sections", () => {
  it("turns a drop before/after a card into the engine's final index", () => {
    expect(dropTarget(5, 0, false)).toBe(0);
    expect(dropTarget(0, 3, true)).toBe(3);
    expect(dropTarget(0, 3, false)).toBe(2);
    expect(dropTarget(2, 2, true)).toBeNull();
    expect(dropTarget(2, 3, false)).toBeNull();
  });

  it("knows which half of a card the pointer is over", () => {
    expect(isLowerHalf(60, { top: 0, height: 100 })).toBe(true);
    expect(isLowerHalf(40, { top: 0, height: 100 })).toBe(false);
  });
});

describe("windowing", () => {
  it("renders what's on screen plus a margin, fetching the pages it needs", () => {
    const range = rowWindow(52 * 120, 520, 52, 1500, 50, 8);
    expect(range.first).toBe(112);
    expect(range.last).toBe(138);
    expect(range.pages).toEqual([2]);
    expect(rowWindow(0, 520, 52, 0, 50).pages).toEqual([0]);
  });

  it("scrolls just enough to show the active row", () => {
    expect(scrollToRow(0, 100, 500, 50)).toBe(0);
    expect(scrollToRow(12, 0, 500, 50)).toBe(150);
    expect(scrollToRow(3, 0, 500, 50)).toBeNull();
  });
});

describe("plain names for fields", () => {
  const fields: Field[] = [
    {
      key: "sections",
      label: "Sections",
      type: "blocks",
      required: false,
      source: "inferred",
      discriminator: "type",
      blocks: [
        {
          type: "faq",
          label: "FAQ",
          count: 1,
          fields: [{ key: "items", label: "Questions", type: "list", required: true, source: "inferred", of: { key: "item", label: "Question", type: "object", required: false, source: "inferred", fields: [{ key: "answer", label: "Answer", type: "text", required: true, source: "inferred" }] } }],
        },
      ],
    },
  ];
  const data = { sections: [{ type: "faq", items: [{ answer: "Yes" }, { answer: "No" }] }] };

  it("uses the site's labels and section types", () => {
    expect(labelForPath(fields, data, ["sections", 0, "items", 1, "answer"])).toBe("Sections › FAQ › Questions › Question 2 › Answer");
    expect(labelForPath(fields, data, ["unknown_key"])).toBe("Unknown key");
  });

  it("previews values in plain words", () => {
    expect(previewValue(undefined)).toBe("cleared");
    expect(previewValue(true)).toBe("on");
    expect(previewValue(["a", "b"])).toBe("a, b");
    expect(previewValue("Hi")).toBe("“Hi”");
  });
});
