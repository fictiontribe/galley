import { describe, expect, it } from "vitest";
import { hasInlineMarkdown, richParts, scanInline, type RichPart } from "../../src/ui/diff/inlineMarkdown";
import { foldUnchanged, wordDiff } from "../../src/ui/diff/wordDiff";

/** What a reader sees, with marks spelled out: [+ins+] [-del-], *em*, **strong**, link<address>, `stored`. */
function read(parts: RichPart[]): string {
  return parts
    .map((part) => {
      if (part.kind === "gap") return " … ";
      let text = part.text;
      if (part.stored) text = `\`${text}\``;
      if (part.style.address) text = `<${text}>`;
      if (part.style.em) text = `*${text}*`;
      if (part.style.strong) text = `**${text}**`;
      if (part.kind === "ins") return `[+${text}+]`;
      if (part.kind === "del") return `[-${text}-]`;
      return text;
    })
    .join("");
}

const visible = (text: string) =>
  scanInline(text)
    .map((info, index) => (info.hidden ? "" : (text[index] ?? "")))
    .join("");

describe("scanInline", () => {
  it("hides emphasis markers and styles their words", () => {
    const info = scanInline("Make more of the *home you already have*.");
    expect(visible("Make more of the *home you already have*.")).toBe("Make more of the home you already have.");
    expect(info[18]?.style.em).toBe(true);
    expect(info[0]?.style.em).toBeUndefined();
  });

  it("reads strong before emphasis", () => {
    const info = scanInline("a **bold** and _soft_ word");
    expect(visible("a **bold** and _soft_ word")).toBe("a bold and soft word");
    expect(info[4]?.style.strong).toBe(true);
    expect(info[4]?.style.em).toBeUndefined();
    expect(info[16]?.style.em).toBe(true);
  });

  it("keeps a link's address, styled quietly, and hides its brackets", () => {
    const text = "See [our studio](/about/) today";
    const info = scanInline(text);
    expect(visible(text)).toBe("See our studio/about/ today");
    expect(info[5]?.style.link).toBe(true);
    expect(info[text.indexOf("/about/")]?.style.address).toBe(true);
  });

  it("leaves snake_case, lone stars and escaped markers alone", () => {
    expect(visible("a file_name_here and 3 * 4")).toBe("a file_name_here and 3 * 4");
    expect(visible("not \\*emphasis\\*")).toBe("not *emphasis*");
    expect(hasInlineMarkdown("Plain words only.")).toBe(false);
    expect(hasInlineMarkdown("Some *words*.")).toBe(true);
  });

  it("treats code spans as literal", () => {
    expect(visible("run `*not em*` now")).toBe("run *not em* now");
    expect(scanInline("run `*not em*` now")[6]?.style.code).toBe(true);
  });
});

describe("richParts", () => {
  it("shows a changed word inside emphasis as it reads, marks exact", () => {
    const parts = wordDiff("Make more of the *home you already have*.", "Make more of the *house you already love*.");
    expect(read(richParts(parts))).toBe("Make more of the [-*home*-][+*house*+]* you already *[-*have*-][+*love*+].");
  });

  it("keeps the exact stored characters of every mark", () => {
    const before = "Make more of the *home you already have*.";
    const after = "Make more of the *house you already love*.";
    const rich = richParts(wordDiff(before, after));
    const removed = rich.filter((part) => part.kind === "del").map((part) => (part.kind === "gap" ? "" : part.text));
    const added = rich.filter((part) => part.kind === "ins").map((part) => (part.kind === "gap" ? "" : part.text));
    expect(removed).toEqual(["home", "have"]);
    expect(added).toEqual(["house", "love"]);
  });

  it("shows emphasis that was only added or removed as stored, so the change is never invisible", () => {
    const rich = richParts(wordDiff("the home you have", "the *home* you have"));
    const inserted = rich.filter((part) => part.kind === "ins");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted.every((part) => part.kind !== "gap" && part.stored)).toBe(true);
    expect(read(rich)).toContain("[+`*`+]");
  });

  it("renders a new link with its address", () => {
    const rich = richParts(wordDiff("Read more.", "Read [more](/journal/)."));
    expect(read(rich)).toContain("more");
    expect(read(rich)).toContain("</journal/>");
  });

  it("follows positions across folded stretches", () => {
    const long = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
    const parts = foldUnchanged(wordDiff(`${long} *old* end`, `${long} *new* end`), 4);
    expect(parts.some((part) => part.kind === "gap")).toBe(true);
    const rich = richParts(parts);
    expect(read(rich)).toContain("[-*old*-][+*new*+]");
  });

  it("leaves text without Markdown exactly as the plain proof shows it", () => {
    const parts = wordDiff("A plain line", "A plainer line");
    expect(read(richParts(parts))).toBe("A [-plain-][+plainer+] line");
  });
});
