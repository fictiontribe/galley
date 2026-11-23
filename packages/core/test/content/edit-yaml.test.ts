import { describe, expect, it } from "vitest";

import { applyEdits, parseDocument } from "../../src/content/index";
import type { EditOp, JsonValue } from "../../src/types";
import { changedLines } from "./helpers";

const DOC = `---
title: Harbour news # shown in the tab
quoted: 'it''s quoted'
double: "say \\"hi\\""
subtitle: >-
  A folded paragraph that is long
  enough to wrap onto two lines.

story: |
  Line one.
  Line two.
keep: >+
  kept text

wandering: plain words
  that continue here
symbols: "a: b # c"
emoji: Lanterns 🏮 and boats ⛵
empty:
nested:
  hero:
    heading: Light for every boat
    count: 3
sections:
  - type: hero
    heading: First
  - type: cta
    label: Go
tags: [news, harbour]
flow: {size: 2, colour: red}
---

Body stays put.
`;

function set(path: Array<string | number>, value: JsonValue, raw = DOC) {
  return applyEdits(raw, "markdown", [{ op: "set", path, value }]);
}

function dataOf(raw: string) {
  return parseDocument(raw, "markdown").data;
}

describe("applyEdits laws", () => {
  it("returns the input exactly when given no ops", () => {
    const result = applyEdits(DOC, "markdown", []);

    expect(result.content).toBe(DOC);
    expect(result.applied).toBe(0);
    expect(result.refused).toEqual([]);
  });

  it("treats setting a value to itself as a no-op that leaves the bytes alone", () => {
    for (const path of [["title"], ["subtitle"], ["story"], ["nested", "hero", "heading"], ["sections", 1, "label"], ["tags"], ["flow", "size"]]) {
      const current = path.reduce<JsonValue>((value, key) => (value as never)[key], dataOf(DOC));
      const result = set(path, current);

      expect(result.content, JSON.stringify(path)).toBe(DOC);
      expect(result.applied).toBe(0);
    }
  });

  it("never touches the body when editing fields", () => {
    expect(set(["title"], "New").content.endsWith("\nBody stays put.\n")).toBe(true);
  });
});

describe("scalar set changes only that value's lines", () => {
  const cases: Array<{ name: string; path: Array<string | number>; value: JsonValue; removed: string[]; added: string[] }> = [
    { name: "plain with a comment beside it", path: ["title"], value: "Harbour notes", removed: ["title: Harbour news # shown in the tab"], added: ["title: Harbour notes # shown in the tab"] },
    { name: "plain that now needs quotes (colon, hash)", path: ["title"], value: "Note: tide #2", removed: ["title: Harbour news # shown in the tab"], added: ["title: 'Note: tide #2' # shown in the tab"] },
    { name: "plain that would read as a number", path: ["title"], value: "1898", removed: ["title: Harbour news # shown in the tab"], added: ["title: '1898' # shown in the tab"] },
    { name: "plain that would read as a boolean", path: ["title"], value: "yes", removed: ["title: Harbour news # shown in the tab"], added: ["title: 'yes' # shown in the tab"] },
    { name: "leading indicator characters", path: ["title"], value: "- dash & *star", removed: ["title: Harbour news # shown in the tab"], added: ["title: '- dash & *star' # shown in the tab"] },
    { name: "single-quoted keeps its quotes", path: ["quoted"], value: "it's still quoted", removed: ["quoted: 'it''s quoted'"], added: ["quoted: 'it''s still quoted'"] },
    { name: "double-quoted keeps its quotes and escapes", path: ["double"], value: 'a "new" one\twith a tab', removed: ['double: "say \\"hi\\""'], added: ['double: "a \\"new\\" one\\twith a tab"'] },
    { name: "multi-line plain becomes one line", path: ["wandering"], value: "plain words, shorter", removed: ["wandering: plain words", "  that continue here"], added: ["wandering: plain words, shorter"] },
    { name: "quoted value with indicators inside", path: ["symbols"], value: "x: y # z", removed: ['symbols: "a: b # c"'], added: ['symbols: "x: y # z"'] },
    { name: "unicode and emoji", path: ["emoji"], value: "Lanterns 🏮, boats ⛵ and gulls 🐦", removed: ["emoji: Lanterns 🏮 and boats ⛵"], added: ["emoji: Lanterns 🏮, boats ⛵ and gulls 🐦"] },
    { name: "empty value gets one", path: ["empty"], value: "filled in", removed: ["empty:"], added: ["empty: filled in"] },
    { name: "nested map", path: ["nested", "hero", "heading"], value: "A light for every boat", removed: ["    heading: Light for every boat"], added: ["    heading: A light for every boat"] },
    { name: "number to number", path: ["nested", "hero", "count"], value: 4, removed: ["    count: 3"], added: ["    count: 4"] },
    { name: "list of maps", path: ["sections", 1, "label"], value: "Go on", removed: ["    label: Go"], added: ["    label: Go on"] },
    { name: "flow sequence item", path: ["tags", 1], value: "pier, north", removed: ["tags: [news, harbour]"], added: ["tags: [news, 'pier, north']"] },
    { name: "flow map value", path: ["flow", "colour"], value: "blue", removed: ["flow: {size: 2, colour: red}"], added: ["flow: {size: 2, colour: blue}"] },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = set(testCase.path, testCase.value);

      expect(result.refused).toEqual([]);
      expect(result.applied).toBe(1);
      expect(changedLines(DOC, result.content)).toEqual({ removed: testCase.removed, added: testCase.added });
      expect(dataOf(result.content)).toEqual({ ...dataOf(DOC), ...setIn(dataOf(DOC), testCase.path, testCase.value) });
    });
  }

  it("clearing a value and typing it back leaves the file as it was", () => {
    // Clearing needs quotes (an empty plain value would read as nothing at all);
    // typing it back must not keep them where the file writes text plain.
    for (const path of [["title"], ["nested", "hero", "heading"], ["sections", 1, "label"], ["emoji"]] as Array<Array<string | number>>) {
      const before = path.reduce<JsonValue>((value, key) => (value as never)[key], dataOf(DOC)) as string;
      const cleared = set(path, "");
      const restored = set(path, before, cleared.content);

      expect(dataOf(cleared.content), JSON.stringify(path)).toEqual(setIn(dataOf(DOC), path, ""));
      expect(restored.content, JSON.stringify(path)).toBe(DOC);
    }
  });

  it("a restored value follows its neighbours' quoting, plain only when that is safe", () => {
    const quotedNeighbours = "---\nheading: ''\nsub: 'One'\nlede: 'Two'\n---\n";
    const plainNeighbours = "---\nheading: ''\nsub: One\nlede: Two\n---\n";

    expect(set(["heading"], "Back again", quotedNeighbours).content).toBe("---\nheading: 'Back again'\nsub: 'One'\nlede: 'Two'\n---\n");
    expect(set(["heading"], "Back again", plainNeighbours).content).toBe("---\nheading: Back again\nsub: One\nlede: Two\n---\n");
    // Text that can't be plain is quoted whatever the neighbours do.
    expect(set(["heading"], "Note: back", plainNeighbours).content).toBe("---\nheading: 'Note: back'\nsub: One\nlede: Two\n---\n");
    expect(set(["heading"], "yes", plainNeighbours).content).toBe("---\nheading: 'yes'\nsub: One\nlede: Two\n---\n");
  });

  it("folded (>-) stays folded and keeps the original wrap width", () => {
    const result = set(["subtitle"], "A folded paragraph that is long enough to wrap onto two lines, now longer.");
    const { removed, added } = changedLines(DOC, result.content);

    // The first line is untouched; the edited line re-wraps at the width the file already used.
    expect(removed).toEqual(["  enough to wrap onto two lines."]);
    expect(added).toEqual(["  enough to wrap onto two lines, now", "  longer."]);
    expect(dataOf(result.content).subtitle).toBe("A folded paragraph that is long enough to wrap onto two lines, now longer.");
  });

  it("folded keeps its unchanged lines when a word in the middle changes", () => {
    const raw = "---\nintro: >-\n  one two three four five\n  six seven eight nine ten\n  eleven twelve thirteen\n---\n";
    const result = applyEdits(raw, "markdown", [{ op: "set", path: ["intro"], value: "one two three four five six SEVEN eight nine ten eleven twelve thirteen" }]);

    expect(changedLines(raw, result.content)).toEqual({ removed: ["  six seven eight nine ten"], added: ["  six SEVEN eight nine ten"] });
  });

  it("folded with paragraphs writes line breaks as blank lines", () => {
    const result = set(["subtitle"], "First paragraph.\nSecond paragraph.");

    expect(result.content).toContain("subtitle: >-\n  First paragraph.\n\n  Second paragraph.\n");
    expect(dataOf(result.content).subtitle).toBe("First paragraph.\nSecond paragraph.");
  });

  it("literal (|) stays literal and chooses chomping to match the value", () => {
    const clip = set(["story"], "New one.\nNew two.\n");

    expect(changedLines(DOC, clip.content)).toEqual({ removed: ["  Line one.", "  Line two."], added: ["  New one.", "  New two."] });
    const strip = set(["story"], "No final newline");

    expect(changedLines(DOC, strip.content)).toEqual({ removed: ["story: |", "  Line one.", "  Line two."], added: ["story: |-", "  No final newline"] });
    expect(dataOf(strip.content).story).toBe("No final newline");
  });

  it("keep chomping (>+) values are still read back exactly", () => {
    const result = set(["keep"], "changed text");

    expect(result.applied).toBe(1);
    expect(dataOf(result.content).keep).toBe("changed text");
    expect(dataOf(result.content).wandering).toBe("plain words that continue here");
  });

  it("a multi-line value in a plain field becomes a literal block", () => {
    const result = set(["emoji"], "Two\nlines");

    expect(changedLines(DOC, result.content)).toEqual({ removed: ["emoji: Lanterns 🏮 and boats ⛵"], added: ["emoji: |-", "  Two", "  lines"] });
    expect(dataOf(result.content).emoji).toBe("Two\nlines");
  });

  it("a multi-line value beside a comment is double-quoted, so the comment stays a comment", () => {
    const result = set(["title"], "Two\nlines");

    expect(changedLines(DOC, result.content).added).toEqual(['title: "Two\\nlines" # shown in the tab']);
    expect(dataOf(result.content).title).toBe("Two\nlines");
  });

  it("keeps a plain date plain so date parsers still see a date", () => {
    const raw = "---\npubDate: 2026-01-12\nlabel: plain\n---\n";

    expect(applyEdits(raw, "markdown", [{ op: "set", path: ["pubDate"], value: "2026-02-01" }]).content).toBe("---\npubDate: 2026-02-01\nlabel: plain\n---\n");
    expect(applyEdits(raw, "markdown", [{ op: "set", path: ["label"], value: "2026-02-01" }]).content).toBe("---\npubDate: 2026-01-12\nlabel: '2026-02-01'\n---\n");
  });

  it("writes booleans and null as plain scalars", () => {
    expect(changedLines(DOC, set(["nested", "hero", "count"], true).content).added).toEqual(["    count: true"]);
    expect(changedLines(DOC, set(["nested", "hero", "count"], null).content).added).toEqual(["    count: null"]);
  });

  it("does not reflow long or folded strings elsewhere in the file", () => {
    const long = `---\nshort: a\nlong: ${"word ".repeat(60).trim()}\nfolded: >\n  one\n  two\n---\n`;
    const result = applyEdits(long, "markdown", [{ op: "set", path: ["short"], value: "b" }]);

    expect(changedLines(long, result.content)).toEqual({ removed: ["short: a"], added: ["short: b"] });
  });
});

function setIn(data: { [key: string]: JsonValue }, path: Array<string | number>, value: JsonValue): { [key: string]: JsonValue } {
  const copy = structuredClone(data);
  let node: JsonValue = copy;

  for (const segment of path.slice(0, -1)) node = (node as never)[segment];
  (node as never as Record<string | number, JsonValue>)[path[path.length - 1]!] = value;
  return copy;
}

describe("line endings and byte-order marks", () => {
  it("keeps CRLF line endings and only changes the edited value", () => {
    const crlf = "---\r\ntitle: Old\r\nlist:\r\n  - a\r\n---\r\n\r\nBody\r\n";
    const result = applyEdits(crlf, "markdown", [
      { op: "set", path: ["title"], value: "New" },
      { op: "insert", path: ["list"], index: 1, value: "b" },
      { op: "set", path: ["added"], value: "yes please" },
    ]);

    expect(result.refused).toEqual([]);
    expect(result.content).toBe("---\r\ntitle: New\r\nlist:\r\n  - a\r\n  - b\r\nadded: yes please\r\n---\r\n\r\nBody\r\n");
  });

  it("keeps a byte-order mark", () => {
    const bom = "﻿---\ntitle: Old\n---\nBody\n";
    const result = applyEdits(bom, "markdown", [{ op: "set", path: ["title"], value: "New" }]);

    expect(result.content).toBe("﻿---\ntitle: New\n---\nBody\n");
    expect(applyEdits(bom, "markdown", []).content).toBe(bom);
  });

  it("keeps a byte-order mark in a YAML data file", () => {
    const bom = "﻿name: Old\n";

    expect(applyEdits(bom, "yaml", [{ op: "set", path: ["name"], value: "New" }]).content).toBe("﻿name: New\n");
  });
});

describe("anchors and aliases", () => {
  const shared = "---\nbase: &label Shared text\ncopy: *label\nother: free\n---\n";

  it("refuses to edit an anchored value rather than change both places", () => {
    const result = applyEdits(shared, "markdown", [{ op: "set", path: ["base"], value: "x" }]);

    expect(result.applied).toBe(0);
    expect(result.refused[0]?.reason).toMatch(/shared with another part of the file/);
    expect(result.content).toBe(shared);
  });

  it("refuses to edit through an alias", () => {
    expect(applyEdits(shared, "markdown", [{ op: "set", path: ["copy"], value: "x" }]).refused).toHaveLength(1);
  });

  it("still edits unrelated values in the same file", () => {
    const result = applyEdits(shared, "markdown", [{ op: "set", path: ["other"], value: "changed" }]);

    expect(changedLines(shared, result.content)).toEqual({ removed: ["other: free"], added: ["other: changed"] });
  });
});

describe("structural edits", () => {
  it("adds a new top-level key as one new line at the end of the map", () => {
    const result = set(["summary"], "A short summary");

    expect(changedLines(DOC, result.content)).toEqual({ removed: [], added: ["summary: A short summary"] });
  });

  it("adds a nested key beside its siblings", () => {
    const result = set(["nested", "hero", "kicker"], "New");

    expect(changedLines(DOC, result.content)).toEqual({ removed: [], added: ["    kicker: New"] });
  });

  it("creates missing parents", () => {
    const result = set(["seo", "metaTitle"], "Harbour news and notes");

    expect(changedLines(DOC, result.content)).toEqual({ removed: [], added: ["seo:", "  metaTitle: Harbour news and notes"] });
  });

  it("fills an empty value with a structure", () => {
    const result = set(["empty", "inner"], "x");

    expect(changedLines(DOC, result.content)).toEqual({ removed: [], added: ["  inner: x"] });
  });

  it("adds a key to a flow map", () => {
    expect(changedLines(DOC, set(["flow", "shape"], "round").content).added).toEqual(["flow: {size: 2, colour: red, shape: round}"]);
  });

  it("replaces a scalar with a list and a list with a scalar", () => {
    const toList = set(["title"], ["a", "b"]);

    expect(dataOf(toList.content).title).toEqual(["a", "b"]);
    expect(dataOf(toList.content).quoted).toBe("it's quoted");
    const toScalar = set(["sections"], "none");

    expect(changedLines(DOC, toScalar.content)).toEqual({
      removed: ["sections:", "  - type: hero", "    heading: First", "  - type: cta", "    label: Go"],
      added: ["sections: none"],
    });
  });

  it("sets a nested structure inside a list item", () => {
    const result = set(["sections", 0, "items"], [{ label: "One" }, { label: "Two" }]);

    expect(changedLines(DOC, result.content)).toEqual({ removed: [], added: ["    items:", "      - label: One", "      - label: Two"] });
  });

  it("unsets a key by removing exactly its lines", () => {
    const result = applyEdits(DOC, "markdown", [{ op: "unset", path: ["story"] }]);

    expect(changedLines(DOC, result.content)).toEqual({ removed: ["story: |", "  Line one.", "  Line two."], added: [] });
  });

  it("unsets the first key of a list item without breaking the item", () => {
    const result = applyEdits(DOC, "markdown", [{ op: "unset", path: ["sections", 0, "type"] }]);

    expect(changedLines(DOC, result.content)).toEqual({ removed: ["  - type: hero", "    heading: First"], added: ["  - heading: First"] });
  });

  it("unsetting a missing key is a no-op", () => {
    const result = applyEdits(DOC, "markdown", [{ op: "unset", path: ["nope"] }]);

    expect(result).toEqual({ content: DOC, applied: 0, refused: [] });
  });

  it("inserts list items in the middle and at the end", () => {
    const middle = applyEdits(DOC, "markdown", [{ op: "insert", path: ["sections"], index: 1, value: { type: "quote", text: "Hello" } }]);

    expect(changedLines(DOC, middle.content)).toEqual({ removed: [], added: ["  - type: quote", "    text: Hello"] });
    const end = applyEdits(DOC, "markdown", [{ op: "insert", path: ["sections"], index: 2, value: { type: "quote", text: "Bye" } }]);

    expect(dataOf(end.content).sections).toEqual([...(dataOf(DOC).sections as JsonValue[]), { type: "quote", text: "Bye" }]);
    expect(changedLines(DOC, end.content).removed).toEqual([]);
  });

  it("inserts into a flow list", () => {
    const result = applyEdits(DOC, "markdown", [{ op: "insert", path: ["tags"], index: 0, value: "first" }]);

    expect(changedLines(DOC, result.content).added).toEqual(["tags: [first, news, harbour]"]);
  });

  it("creates a list when inserting into a missing one", () => {
    const result = applyEdits(DOC, "markdown", [{ op: "insert", path: ["links"], index: 0, value: "/about/" }]);

    expect(dataOf(result.content).links).toEqual(["/about/"]);
  });

  it("removes a list item by its own lines", () => {
    const result = applyEdits(DOC, "markdown", [{ op: "remove", path: ["sections"], index: 0 }]);

    expect(changedLines(DOC, result.content)).toEqual({ removed: ["  - type: hero", "    heading: First"], added: [] });
  });

  it("removing the last item leaves an empty list", () => {
    const raw = "---\nitems:\n  - only\n---\n";

    expect(applyEdits(raw, "markdown", [{ op: "remove", path: ["items"], index: 0 }]).content).toBe("---\nitems: []\n---\n");
  });

  it("moves an item by moving its exact bytes", () => {
    const raw = "---\nsections:\n  - type: hero\n    # the opening\n    heading: >-\n      Folded\n      text\n  - type: cta\n    label: Go\n---\n";
    const result = applyEdits(raw, "markdown", [{ op: "move", path: ["sections"], from: 0, to: 1 }]);

    expect(result.content).toBe("---\nsections:\n  - type: cta\n    label: Go\n  - type: hero\n    # the opening\n    heading: >-\n      Folded\n      text\n---\n");
  });

  it("moving to the same place is a no-op", () => {
    expect(applyEdits(DOC, "markdown", [{ op: "move", path: ["sections"], from: 1, to: 1 }]).applied).toBe(0);
  });

  it("follows the file's own sequence indentation", () => {
    const flat = "---\nlist:\n- a\n- b\n---\n";
    const result = applyEdits(flat, "markdown", [{ op: "set", path: ["more"], value: ["x", "y"] }]);

    expect(result.content).toBe("---\nlist:\n- a\n- b\nmore:\n- x\n- y\n---\n");
  });

  it("refuses out-of-range list operations with a reason", () => {
    const result = applyEdits(DOC, "markdown", [
      { op: "remove", path: ["sections"], index: 9 },
      { op: "move", path: ["sections"], from: 0, to: 5 },
      { op: "insert", path: ["title"], index: 0, value: "x" },
      { op: "set", path: ["title", "deeper"], value: "x" },
    ]);

    expect(result.applied).toBe(0);
    expect(result.refused.map((refusal) => refusal.index)).toEqual([0, 1, 2, 3]);
    for (const refusal of result.refused) expect(refusal.reason.length).toBeGreaterThan(10);
    expect(result.content).toBe(DOC);
  });

  it("preserves comments around edited and inserted items", () => {
    const raw = "---\n# heading comment\ntitle: Old # inline\n# between\nlist:\n  - a # first\n  - b\n---\n";
    const result = applyEdits(raw, "markdown", [
      { op: "set", path: ["title"], value: "New" },
      { op: "insert", path: ["list"], index: 1, value: "c" },
    ]);

    expect(result.content).toBe("---\n# heading comment\ntitle: New # inline\n# between\nlist:\n  - a # first\n  - c\n  - b\n---\n");
  });

  it("refuses edits to front matter that does not parse", () => {
    const broken = "---\ntitle: [unclosed\n---\n";
    const result = applyEdits(broken, "markdown", [{ op: "set", path: ["title"], value: "x" }]);

    expect(result.refused[0]?.reason).toMatch(/formatting mistake/);
  });

  it("creates front matter for a markdown file that has none", () => {
    const result = applyEdits("Just text.\n", "markdown", [{ op: "set", path: ["title"], value: "Hello" }]);

    expect(result.content).toBe("---\ntitle: Hello\n---\nJust text.\n");
  });

  it("applies several ops in order, each to the previous result", () => {
    const ops: EditOp[] = [
      { op: "insert", path: ["sections"], index: 0, value: { type: "intro", text: "Hi" } },
      { op: "set", path: ["sections", 0, "text"], value: "Hello" },
      { op: "remove", path: ["sections"], index: 2 },
    ];
    const result = applyEdits(DOC, "markdown", ops);

    expect(result.applied).toBe(3);
    expect((dataOf(result.content).sections as JsonValue[]).map((item) => (item as { type: string }).type)).toEqual(["intro", "hero"]);
  });
});

describe("the Document API fallback", () => {
  it("is used for shapes the splicer does not handle, when nothing else changes", () => {
    const raw = "title: Grid\nmatrix:\n  - - a\n    - b\nend: here\n";
    const result = applyEdits(raw, "yaml", [{ op: "remove", path: ["matrix", 0], index: 0 }]);

    expect(result.refused).toEqual([]);
    expect(result.content).toBe("title: Grid\nmatrix:\n  - - b\nend: here\n");
  });

  it("is refused when it would reformat anything outside the edited container", () => {
    const raw = "intro: >\n  wrapped over\n  two lines\nmatrix:\n  - - a\n    - b\n";
    const result = applyEdits(raw, "yaml", [{ op: "remove", path: ["matrix", 0], index: 0 }]);

    expect(result.applied).toBe(0);
    expect(result.refused[0]?.reason).toMatch(/without reformatting other parts/);
    expect(result.content).toBe(raw);
  });

  it("replaces a whole map with another in place", () => {
    const raw = "hero:\n  heading: Old\n  image: /a.png\nnext: 1\n";
    const result = applyEdits(raw, "yaml", [{ op: "set", path: ["hero"], value: { heading: "New", note: "x" } }]);

    expect(result.content).toBe("hero:\n  heading: New\n  note: x\nnext: 1\n");
  });
});

describe("YAML data files", () => {
  it("edits a YAML data file in place", () => {
    const raw = "# Main menu\nlinks:\n  - label: About\n    href: /about/\nfooterNote: Lit by volunteers\n";
    const result = applyEdits(raw, "yaml", [{ op: "set", path: ["links", 0, "label"], value: "About us" }]);

    expect(result.content).toBe(raw.replace("label: About", "label: About us"));
  });

  it("addresses a top-level list through `items`", () => {
    const raw = "- name: One\n- name: Two\n";
    const result = applyEdits(raw, "yaml", [
      { op: "set", path: ["items", 1, "name"], value: "Second" },
      { op: "insert", path: ["items"], index: 2, value: { name: "Three" } },
    ]);

    expect(result.content).toBe("- name: One\n- name: Second\n- name: Three\n");
    expect(applyEdits(raw, "yaml", [{ op: "set", path: [0, "name"], value: "x" }]).refused).toHaveLength(1);
  });
});

describe("TOML", () => {
  it("is read-only, with a clear reason", () => {
    const raw = '+++\ntitle = "Old"\n+++\nBody\n';
    const result = applyEdits(raw, "markdown", [{ op: "set", path: ["title"], value: "New" }]);

    expect(result.content).toBe(raw);
    expect(result.refused[0]?.reason).toMatch(/written in a format the form can't change yet.*Use the source view/);
    expect(applyEdits('title = "x"\n', "toml", [{ op: "set", path: ["title"], value: "y" }]).refused).toHaveLength(1);
  });

  it("still allows body edits and whole-file replacement", () => {
    const raw = '+++\ntitle = "Old"\n+++\nBody\n';

    expect(applyEdits(raw, "markdown", [{ op: "body", value: "New body" }]).content).toBe('+++\ntitle = "Old"\n+++\nNew body\n');
    expect(applyEdits(raw, "markdown", [{ op: "raw", value: "replaced" }]).content).toBe("replaced");
  });
});
