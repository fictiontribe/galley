// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { collapse, copyElements, editableTarget, findCopy, imageTarget, occurrenceOf, visibleText } from "../src/text";

const page = (html: string) => {
  document.body.innerHTML = html;
};
const $ = (selector: string) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`No ${selector}`);
  return element;
};

beforeEach(() => page(""));

describe("visible text", () => {
  it("collapses whitespace and separates blocks", () => {
    expect(collapse("  Make\n  more\t of it  ")).toBe("Make more of it");
    page(`<ul id="l"><li>One</li><li>Two</li></ul><p id="p">A<br>B</p>`);
    expect(visibleText($("#l"))).toBe("One Two");
    expect(visibleText($("#p"))).toBe("A B");
  });

  it("leaves out scripts, hidden and decorative parts", () => {
    page(`<a id="a" href="/x">See how we work <span aria-hidden="true">→</span><span hidden>secret</span><span style="display:none">gone</span><script>var x</script></a>`);
    expect(visibleText($("#a"))).toBe("See how we work");
  });
});

describe("which element a click means", () => {
  it("picks the heading, not the emphasis inside it", () => {
    page(`<section><div class="wrap"><h1 id="h">Make more of the <em id="em">home you already have</em>.</h1><p>Intro</p></div></section>`);
    expect(editableTarget($("#em"))).toBe($("#h"));
    expect(visibleText($("#h"))).toBe("Make more of the home you already have.");
  });

  it("treats a link inside a sentence as part of the paragraph", () => {
    page(`<p id="p">Read <a id="a" href="/guide/">the guide</a> first.</p>`);
    expect(editableTarget($("#a"))).toBe($("#p"));
  });

  it("keeps a standalone link or button as itself, climbing past its icon", () => {
    page(`<nav><ul><li><a id="a" href="/about/">About</a></li></ul></nav><button id="b"><svg id="s"><path id="path"/></svg><span id="label">Send message</span></button>`);
    expect(editableTarget($("#a"))).toBe($("#a").parentElement);
    expect(editableTarget($("#path"))).toBe($("#b"));
    expect(editableTarget($("#label"))).toBe($("#b"));
  });

  it("never picks a container", () => {
    page(`<article id="card"><h3 id="t">Garden rooms</h3><p id="d">Studios at the end of the garden.</p></article><div id="wrap"><div id="leaf">Fixed fees</div></div>`);
    expect(editableTarget($("#card"))).toBeNull();
    expect(editableTarget($("#t"))).toBe($("#t"));
    expect(editableTarget($("#leaf"))).toBe($("#leaf"));
    expect(editableTarget($("#wrap"))).toBeNull();
  });

  it("keeps the items of a flex or grid row apart", () => {
    page(`<p id="meta" style="display:flex"><span>By <a href="/team/tomas/">Tomás Reyes</a></span><span>Published</span><time id="date">14 October 2026</time><span id="read">2 min read</span></p>`);
    expect(editableTarget($("#read"))).toBe($("#read"));
    expect(editableTarget($("#date"))).toBe($("#date"));
    expect(visibleText($("#meta"))).toBe("By Tomás Reyes Published 14 October 2026 2 min read");
  });

  it("ignores text without words", () => {
    page(`<p id="p">·</p><p id="q">—</p>`);
    expect(editableTarget($("#p"))).toBeNull();
  });

  it("recognises images", () => {
    page(`<picture id="pic"><source srcset="a.webp"><img id="img" src="/a.png" alt="A"></picture>`);
    expect(imageTarget($("#img"))).toBe($("#img"));
    expect(imageTarget($("#pic"))).toBe($("#img"));
    expect(imageTarget($("#pic").parentElement)).toBeNull();
  });
});

describe("occurrences", () => {
  it("counts same-text copy in document order, skipping hidden copies", () => {
    page(`
      <header><a id="n1" href="/contact/">Contact</a><div hidden><a href="/contact/">Contact</a></div></header>
      <main><h2>Contact</h2><p>Write to us</p></main>
      <footer><a id="n3" href="/contact/">Contact</a></footer>`);
    const second = document.querySelector("main h2") as Element;
    expect(occurrenceOf($("#n1"))).toEqual({ text: "Contact", occurrence: 0, total: 3 });
    expect(occurrenceOf(second)).toEqual({ text: "Contact", occurrence: 1, total: 3 });
    expect(occurrenceOf($("#n3"))).toEqual({ text: "Contact", occurrence: 2, total: 3 });
    expect(findCopy(document, "Contact", 1)).toBe(second);
    expect(findCopy(document, "  Contact ", 2)).toBe($("#n3"));
    expect(findCopy(document, "Contact", 3)).toBeNull();
  });

  it("does not count the inner and outer element of the same copy twice", () => {
    page(`<h3><a href="/a/">Kitchens</a></h3><p>Kitchens</p>`);
    expect(copyElements(document).map((element) => element.tagName)).toEqual(["H3", "P"]);
  });
});
