// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayToHost } from "@galley/core/types";
import { createOverlay, type Overlay } from "../src/overlay";
import { parseHostMessage } from "../src/protocol";
import { ACCENT, EDITING_CLASS, STYLE_ID, inkOn } from "../src/styles";

const HOST = "http://localhost:5175";

type PostMessage = (message: unknown, targetOrigin: string) => void;

interface FakeParent {
  postMessage: ReturnType<typeof vi.fn<PostMessage>>;
}

let overlay: Overlay | null = null;
let parent: FakeParent;

function start(options: { ancestorOrigin?: string | null; role?: "edit" | "follow" } = {}) {
  parent = { postMessage: vi.fn<PostMessage>() };
  overlay = createOverlay({ win: window, parent, ancestorOrigin: options.ancestorOrigin === undefined ? HOST : options.ancestorOrigin, role: options.role ?? "edit" });
}

function sent(): OverlayToHost[] {
  return parent.postMessage.mock.calls.map((call) => call[0] as OverlayToHost);
}

function fromHost(data: unknown, init: { origin?: string; source?: unknown } = {}) {
  const event = new MessageEvent("message", { data, origin: init.origin ?? HOST });
  Object.defineProperty(event, "source", { value: init.source === undefined ? parent : init.source });
  window.dispatchEvent(event);
}

function click(element: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  element.dispatchEvent(event);
  return event;
}

const $ = (selector: string) => document.querySelector(selector) as HTMLElement;

beforeEach(() => {
  document.title = "Home";
  document.body.innerHTML = `
    <h1 id="h">Make more of the <em>home you already have</em>.</h1>
    <p id="p">Clear drawings and fixed fees.</p>
    <a id="link" href="/contact/">Contact</a>
    <img id="img" src="/images/hero.svg" alt="A house">`;
});

afterEach(() => {
  overlay?.dispose();
  overlay = null;
});

describe("the protocol", () => {
  it("accepts only well-formed host messages", () => {
    expect(parseHostMessage({ galley: 1, type: "mode", edit: true })).toEqual({ galley: 1, type: "mode", edit: true });
    expect(parseHostMessage({ galley: 1, type: "begin-edit", text: "Hi", occurrence: 0 })).not.toBeNull();
    expect(parseHostMessage({ galley: 1, type: "begin-edit", text: "Hi", occurrence: -1 })).toBeNull();
    expect(parseHostMessage({ galley: 1, type: "scroll", y: "10" })).toBeNull();
    expect(parseHostMessage({ galley: 2, type: "reload" })).toBeNull();
    expect(parseHostMessage({ type: "reload" })).toBeNull();
    expect(parseHostMessage({ galley: 1, type: "eval", code: "x" })).toBeNull();
  });

  it("styles itself with one namespaced <style> in the brand's accent", () => {
    start();
    overlay?.dispose();
    start();
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
    expect(document.getElementById(STYLE_ID)?.textContent).toContain(ACCENT);
  });
});

describe("talking to the host", () => {
  it("announces ready to the parent's origin", () => {
    start();
    expect(parent.postMessage).toHaveBeenCalledWith({ galley: 1, type: "ready", path: "/", title: "Home" }, HOST);
  });

  it("without a reported parent origin, waits for the parent to speak and pins its origin", () => {
    start({ ancestorOrigin: null });
    expect(parent.postMessage).not.toHaveBeenCalled();
    fromHost({ galley: 1, type: "mode", edit: true }, { origin: "http://127.0.0.1:4420" });
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ready" }), "http://127.0.0.1:4420");
    // Another origin can't take over afterwards.
    fromHost({ galley: 1, type: "mode", edit: false }, { origin: "https://evil.example" });
    click($("#p"));
    expect(sent().some((message) => message.type === "select")).toBe(true);
  });

  it("ignores messages from other windows or origins", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true }, { source: {} });
    fromHost({ galley: 1, type: "mode", edit: true }, { origin: "https://evil.example" });
    const event = click($("#link"));
    expect(event.defaultPrevented).toBe(false);
    // Only what it says on its own when it starts: where it is, and that the page was drawn.
    expect(sent().map((message) => message.type)).toEqual(["ready", "page-state"]);
  });

  it("reports in-site navigation, including router transitions and hash changes", async () => {
    vi.useFakeTimers();
    start();
    history.pushState({}, "", "/pricing/");
    document.title = "Pricing";
    vi.advanceTimersByTime(50);
    location.hash = "#faq";
    window.dispatchEvent(new Event("hashchange"));
    vi.advanceTimersByTime(50);
    vi.useRealTimers();
    expect(sent().filter((message) => message.type === "navigate")).toEqual([
      { galley: 1, type: "navigate", path: "/pricing/", title: "Pricing" },
      { galley: 1, type: "navigate", path: "/pricing/#faq", title: "Pricing" },
    ]);
    history.replaceState({}, "", "/");
  });

  it("obeys scroll without echoing it back", async () => {
    start();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    fromHost({ galley: 1, type: "scroll", y: 420 });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 420 }));
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(sent().some((message) => message.type === "scroll")).toBe(false);
    scrollTo.mockRestore();
  });
});

describe("click to edit", () => {
  it("is off until the host turns it on", () => {
    start();
    expect(click($("#p")).defaultPrevented).toBe(false);
    fromHost({ galley: 1, type: "mode", edit: true });
    expect(click($("#p")).defaultPrevented).toBe(true);
  });

  it("sends the clicked copy with its occurrence and swallows the click", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    const event = click($("#h").querySelector("em") as Element);
    expect(event.defaultPrevented).toBe(true);
    expect(sent().at(-1)).toMatchObject({ type: "select", text: "Make more of the home you already have.", tag: "h1", occurrence: 0, total: 1 });
  });

  it("lets Cmd/Ctrl-click follow a link", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    expect(click($("#link"), { metaKey: true }).defaultPrevented).toBe(false);
    expect(click($("#link"), { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click($("#link")).defaultPrevented).toBe(true);
  });

  it("sends images as select-image with a site path", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    click($("#img"));
    expect(sent().at(-1)).toMatchObject({ type: "select-image", src: "/images/hero.svg", alt: "A house" });
  });

  it("retypes exactly the element the host names, and reports old and new text on Enter", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    click($("#p"));
    fromHost({ galley: 1, type: "begin-edit", text: "Clear drawings and fixed fees.", occurrence: 0 });
    const p = $("#p");
    expect(p.getAttribute("contenteditable")).not.toBeNull();
    expect(p.classList.contains(EDITING_CLASS)).toBe(true);
    expect($("#h").getAttribute("contenteditable")).toBeNull();
    p.textContent = "Clear drawings, fixed fees.";
    p.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(p.getAttribute("contenteditable")).toBeNull();
    expect(sent().at(-1)).toEqual({ galley: 1, type: "edit", text: "Clear drawings and fixed fees.", newText: "Clear drawings, fixed fees.", occurrence: 0, total: 1 });
  });

  it("puts the original back on Escape", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    fromHost({ galley: 1, type: "begin-edit", text: "Make more of the home you already have.", occurrence: 0 });
    const h = $("#h");
    const before = h.innerHTML;
    h.textContent = "Something else";
    h.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(h.innerHTML).toBe(before);
    expect(sent().at(-1)).toEqual({ galley: 1, type: "edit-cancelled", text: "Make more of the home you already have.", occurrence: 0 });
  });

  it("puts the stored text back, markup and all, when the host refuses the save", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    fromHost({ galley: 1, type: "begin-edit", text: "Make more of the home you already have.", occurrence: 0 });
    const h = $("#h");
    const before = h.innerHTML;
    h.textContent = "Make more of it.";
    h.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(sent().at(-1)).toMatchObject({ type: "edit", newText: "Make more of it." });
    fromHost({ galley: 1, type: "restore-text", text: "Make more of the home you already have.", newText: "Make more of it.", occurrence: 0 });
    expect(h.innerHTML).toBe(before);
  });

  it("restores by finding the text when the edited element is gone", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    $("#p").textContent = "Typed on the page.";
    fromHost({ galley: 1, type: "restore-text", text: "Clear drawings and fixed fees.", newText: "Typed on the page.", occurrence: 0 });
    expect($("#p").textContent).toBe("Clear drawings and fixed fees.");
  });

  it("confirms on blur and keeps pastes plain", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    fromHost({ galley: 1, type: "begin-edit", text: "Contact", occurrence: 0 });
    const link = $("#link");
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => (type === "text/plain" ? "Get\n in touch" : "<b>Get in touch</b>") } });
    link.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(link.querySelector("b")).toBeNull();
    link.textContent = "Get in touch";
    link.dispatchEvent(new Event("blur"));
    expect(sent().at(-1)).toMatchObject({ type: "edit", text: "Contact", newText: "Get in touch" });
  });
});

describe("links in edit mode", () => {
  const hover = (element: Element) => element.dispatchEvent(new Event("pointerover", { bubbles: true }));
  const tag = () => [...document.querySelectorAll("[data-galley-tag]")].at(-1) as HTMLElement;

  it("offers Follow link beside Click to edit, and follows it", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    hover($("#link"));
    expect(tag().textContent).toContain("Click to edit");
    const button = tag().querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toContain("Follow link");
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    click(button);
    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/\/contact\/$/));
    expect(sent().some((message) => message.type === "select")).toBe(false);
    assign.mockRestore();
  });

  it("tells keyboard users Enter edits and Ctrl/⌘+Enter follows, and follows on it", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    const link = $("#link");
    link.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(tag().textContent).toMatch(/Enter to edit · (⌘Enter|Ctrl\+Enter) to follow link/);
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    const key = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
    link.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(assign).toHaveBeenCalled();
    assign.mockRestore();
  });

  it("keeps plain Enter (a click) as an edit", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    expect(click($("#link")).defaultPrevented).toBe(true);
    expect(sent().at(-1)).toMatchObject({ type: "select", text: "Contact", tag: "a" });
  });
});

describe("a form's buttons in edit mode", () => {
  const hover = (element: Element) => element.dispatchEvent(new Event("pointerover", { bubbles: true }));
  const tag = () => [...document.querySelectorAll("[data-galley-tag]")].at(-1) as HTMLElement;
  beforeEach(() => {
    document.body.insertAdjacentHTML("beforeend", `<form id="form"><input name="email"><button id="send" type="submit">Send <span id="send-word">it</span></button></form><button id="loose" type="button">Read more</button>`);
  });

  it("lets a click on a form's button submit as on the site, the text inside it included", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    expect(click($("#send")).defaultPrevented).toBe(false);
    expect(click($("#send-word")).defaultPrevented).toBe(false);
    expect(sent().some((message) => message.type === "select")).toBe(false);
    // A button outside any form is page text like any other: a click edits it.
    expect(click($("#loose")).defaultPrevented).toBe(true);
    expect(sent().at(-1)).toMatchObject({ type: "select", text: "Read more" });
  });

  it("edits its words deliberately: the tag's Edit text, or Ctrl/⌘+Enter from the keyboard", () => {
    start();
    fromHost({ galley: 1, type: "mode", edit: true });
    hover($("#send"));
    expect(tag().textContent).toContain("Works as on the site");
    const edit = tag().querySelector("button") as HTMLButtonElement;
    expect(edit.textContent).toBe("Edit text");
    click(edit);
    expect(sent().at(-1)).toMatchObject({ type: "select", text: "Send it", tag: "button" });

    // Focus that follows a press of the pointer keeps the pointer's tag, with its Edit text button.
    hover($("#send"));
    $("#send").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    $("#send").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(tag().querySelector("button")?.textContent).toBe("Edit text");
    // Later, from the keyboard (the pointer has left): the tag says how to use it and how to edit it.
    document.documentElement.dispatchEvent(new Event("pointerleave"));
    vi.useFakeTimers({ now: Date.now() + 1000 });
    $("#send").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.useRealTimers();
    expect(tag().textContent).toMatch(/Enter works as on the site · (⌘Enter|Ctrl\+Enter) to edit text/);
    const key = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
    $("#send").dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(sent().filter((message) => message.type === "select")).toHaveLength(2);
  });
});

describe("the app's look", () => {
  it("recolours outlines and the tag to the accent it is sent, and ignores anything that isn't a colour", () => {
    start();
    fromHost({ galley: 1, type: "appearance", accent: "#E4572E", theme: "dark" });
    const css = document.getElementById(STYLE_ID)?.textContent ?? "";
    expect(css).toContain("#E4572E");
    expect(css).not.toContain(ACCENT);
    expect([...document.querySelectorAll("[data-galley-tag]")].at(-1)?.getAttribute("data-theme")).toBe("dark");
    expect(parseHostMessage({ galley: 1, type: "appearance", accent: "red; } body { display:none", theme: "dark" })).toBeNull();
    expect(parseHostMessage({ galley: 1, type: "appearance", accent: "#fff", theme: "sepia" })).toBeNull();
  });

  it("picks readable ink for light accents", () => {
    expect(inkOn("#FFE45C")).not.toBe(inkOn("#2E2BFF"));
  });
});

describe("the follow role", () => {
  it("only reports and obeys navigation and scroll", () => {
    start({ role: "follow" });
    fromHost({ galley: 1, type: "mode", edit: true });
    expect(click($("#p")).defaultPrevented).toBe(false);
    fromHost({ galley: 1, type: "begin-edit", text: "Clear drawings and fixed fees.", occurrence: 0 });
    expect($("#p").getAttribute("contenteditable")).toBeNull();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    fromHost({ galley: 1, type: "scroll", y: 80 });
    expect(scrollTo).toHaveBeenCalled();
    scrollTo.mockRestore();
    expect(sent().map((message) => message.type)).toEqual(["ready"]);
  });
});

describe("section marks", () => {
  const sampleLists = [
    {
      field: "sections",
      sections: [{ index: 0, type: "hero", label: "Hero", texts: ["Hero Heading", "Welcome aboard"], images: [] }],
    },
  ];

  it("parses colour-only section marks and rejects non-hex colours or invalid items", () => {
    expect(
      parseHostMessage({
        galley: 1,
        type: "marks",
        lists: sampleLists,
        marks: [{ field: "sections", index: 0, color: "#3b82f6" }],
      }),
    ).toEqual({
      galley: 1,
      type: "marks",
      lists: sampleLists,
      marks: [{ field: "sections", index: 0, color: "#3b82f6" }],
    });

    expect(
      parseHostMessage({
        galley: 1,
        type: "marks",
        lists: [],
        marks: [{ field: "sections", index: 0, color: "red; } body { display: none" }],
      }),
    ).toBeNull();
    expect(
      parseHostMessage({
        galley: 1,
        type: "marks",
        lists: [],
        marks: [{ field: "sections", index: -1, color: "#3b82f6" }],
      }),
    ).toBeNull();
  });

  it("renders marks as colour-only outlines with no text content", () => {
    document.body.innerHTML = `<main><section id="hero" data-galley-block="sections.0" data-galley-block-type="hero"><h2>Hero Heading</h2><p>Welcome aboard</p></section></main>`;
    const hero = document.getElementById("hero")!;
    vi.spyOn(hero, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: 320,
      height: 180,
      right: 330,
      bottom: 200,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);
    start();
    fromHost({
      galley: 1,
      type: "marks",
      lists: sampleLists,
      marks: [{ field: "sections", index: 0, color: "#2563eb" }],
    });
    const host = document.querySelector("[data-galley-marks]");
    const root = host?.shadowRoot ?? null;
    expect(root).not.toBeNull();
    const boxes = root!.querySelectorAll("[data-galley-mark]");

    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.textContent).toBe("");
    expect((boxes[0] as HTMLElement).style.border).toContain("#2563eb");
    // Clearing marks removes them cleanly.
    fromHost({ galley: 1, type: "marks", lists: [], marks: [] });
    expect(document.querySelector("[data-galley-marks]")).toBeNull();
  });
});
