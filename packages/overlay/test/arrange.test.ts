// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostToOverlay, OverlaySectionList, OverlayToHost } from "@galley/core/types";
import { GRACE_MS } from "../src/arrange";
import { createOverlay, type Overlay } from "../src/overlay";
import { parseHostMessage } from "../src/protocol";

const HOST = "http://localhost:5175";
type PostMessage = (message: unknown, targetOrigin: string) => void;

let overlay: Overlay | null = null;
let parent: { postMessage: ReturnType<typeof vi.fn<PostMessage>> };

const LISTS: OverlaySectionList[] = [
  {
    field: "sections",
    sections: [
      { index: 0, type: "hero", label: "Hero", texts: ["Welcome heading"], images: [] },
      { index: 1, type: "features", label: "Features", texts: ["Features heading"], images: [] },
      { index: 2, type: "cta", label: "Call to action", texts: ["Closing heading"], images: [] },
    ],
  },
];

function start(role: "edit" | "follow" = "edit", arrival?: { status: number | null; unavailable: boolean }) {
  parent = { postMessage: vi.fn<PostMessage>() };
  overlay = createOverlay({ win: window, parent, ancestorOrigin: HOST, role, ...(arrival ? { arrival } : {}) });
}
function fromHost(data: Omit<Extract<HostToOverlay, { galley: 1 }>, "galley"> | Record<string, unknown>) {
  const event = new MessageEvent("message", { data: { galley: 1, ...data }, origin: HOST });
  Object.defineProperty(event, "source", { value: parent });
  window.dispatchEvent(event);
}
const arrange = (patch: Partial<Extract<HostToOverlay, { type: "arrange" }>> = {}) =>
  fromHost({ type: "arrange", on: true, lists: LISTS, editable: true, selected: null, settling: false, revision: 1, reveal: false, ...patch });
const sent = (): OverlayToHost[] => parent.postMessage.mock.calls.map((call) => call[0] as OverlayToHost);
const last = <T extends OverlayToHost["type"]>(type: T) => sent().filter((message): message is Extract<OverlayToHost, { type: T }> => message.type === type).pop();
const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
const layer = () => document.querySelector("[data-galley-arrange]") as HTMLElement;
const inLayer = (selector: string) => layer().shadowRoot?.querySelector(selector) as HTMLElement;

/** Gives each section a box: 300 px tall, stacked from the top of the page. */
function boxes() {
  ["#s0", "#s1", "#s2"].forEach((selector, at) => {
    const element = $(selector);
    element.getBoundingClientRect = () => ({ x: 0, y: at * 300, left: 0, top: at * 300, right: 800, bottom: at * 300 + 300, width: 800, height: 300, toJSON: () => ({}) }) as DOMRect;
  });
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 40));

function pointer(type: string, target: Element, init: PointerEventInit) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: 7, button: 0, ...init }));
}

beforeEach(() => {
  document.body.innerHTML = `
    <header><nav><a id="nav" href="/about/">About</a></nav></header>
    <main>
      <section id="s0" data-galley-block="sections.0" data-galley-block-type="hero"><h1>Welcome heading</h1><a id="cta" href="/contact/">Contact</a></section>
      <section id="s1" data-galley-block="sections.1" data-galley-block-type="features"><h2>Features heading</h2></section>
      <section id="s2" data-galley-block="sections.2" data-galley-block-type="cta"><h2>Closing heading</h2></section>
    </main>`;
  boxes();
});

afterEach(() => {
  overlay?.dispose();
  overlay = null;
  vi.useRealTimers();
});

describe("Arrange mode in the page", () => {
  it("maps the sections and reports it, with the chrome in one shadow root outside the body", () => {
    start();
    const children = document.body.children.length;
    arrange();
    expect(last("arrange-status")).toMatchObject({ status: "mapped", how: "markers", revision: 1 });
    expect(document.body.children.length).toBe(children);
    expect(layer().parentElement).toBe(document.documentElement);
    expect(layer().shadowRoot).not.toBeNull();
    // Section roots take part in focus (one tab stop), nothing else about them changes.
    expect($("#s0").getAttribute("tabindex")).toBe("0");
    expect($("#s1").getAttribute("tabindex")).toBe("-1");
    arrange({ on: false });
    expect($("#s0").hasAttribute("tabindex")).toBe(false);
    expect(layer().hidden).toBe(true);
  });

  it("waits while the page may be reloading, then declines a page it can't map", async () => {
    vi.useFakeTimers();
    document.querySelectorAll("[data-galley-block]").forEach((element) => element.removeAttribute("data-galley-block"));
    $("#s1 h2").textContent = "Welcome heading";
    start();
    arrange();
    expect(last("arrange-status")).toMatchObject({ status: "waiting" });
    vi.advanceTimersByTime(GRACE_MS + 100);
    expect(last("arrange-status")).toMatchObject({ status: "declined", how: null });
    expect(last("arrange-status")?.reason).toBeTruthy();
  });

  it("says why it declines: unmarked only when a page that drew marks none of its sections", async () => {
    vi.useFakeTimers();
    document.querySelectorAll("[data-galley-block]").forEach((element) => element.removeAttribute("data-galley-block"));
    $("#s1 h2").textContent = "Welcome heading";
    start();
    arrange();
    vi.advanceTimersByTime(GRACE_MS + 100);
    expect(last("arrange-status")).toMatchObject({ status: "declined", cause: "unmarked" });
  });

  it("a page that marks some sections and not others is a mismatch, not unmarked", () => {
    vi.useFakeTimers();
    $("#s2").removeAttribute("data-galley-block");
    start();
    arrange({ lists: [{ field: "sections", sections: LISTS[0]!.sections }, { field: "more", sections: [{ index: 0, type: "cta", label: "Call to action", texts: ["Closing heading"], images: [] }] }] });
    vi.advanceTimersByTime(GRACE_MS + 100);
    expect(last("arrange-status")).toMatchObject({ status: "declined", cause: "mismatch" });
  });

  it("an error page is declined at once as a page that failed to draw, with the framework's own first line", async () => {
    // Astro's dev error page: no sections, and the Vite client shows the error in its own element.
    document.body.innerHTML = "";
    document.title = "Error";
    start("edit", { status: 500, unavailable: false });
    arrange();
    expect(last("page-state")).toMatchObject({ state: "failed", status: 500, message: null });
    expect(last("arrange-status")).toMatchObject({ status: "declined", cause: "page-failed", how: null });
    const shown = document.createElement("vite-error-overlay");
    const root = shown.attachShadow({ mode: "open" });
    root.innerHTML = `<h1 id="title">An error occurred.</h1><div id="message-content">\n  ENOENT: no such file or directory, open '/site/public/video/-poster.webp'\n    at Object.openSync (node:fs:573:18)</div>`;
    document.body.append(shown);
    await flush();
    expect(last("page-state")).toMatchObject({ state: "failed", message: "ENOENT: no such file or directory, open '/site/public/video/-poster.webp'" });
    expect(last("arrange-status")).toMatchObject({ cause: "page-failed", reason: "ENOENT: no such file or directory, open '/site/public/video/-poster.webp'" });
    // Never "unmarked", however long it is left.
    expect(sent().filter((message) => message.type === "arrange-status").some((message) => message.type === "arrange-status" && message.cause === "unmarked")).toBe(false);
  });

  it("the proxy's own page while the dev server doesn't answer says the preview is unavailable", () => {
    document.body.innerHTML = "The preview isn't answering yet. It will reload by itself.";
    start("edit", { status: 502, unavailable: true });
    arrange();
    expect(last("page-state")).toMatchObject({ state: "unavailable", status: 502 });
    expect(last("arrange-status")).toMatchObject({ status: "declined", cause: "preview-unavailable" });
  });

  it("a drawn page says so after ready, and says it failed when the framework's error shows up later", async () => {
    start();
    expect(sent().map((message) => message.type).slice(0, 2)).toEqual(["ready", "page-state"]);
    expect(last("page-state")).toMatchObject({ state: "drawn", status: null });
    arrange();
    expect(last("arrange-status")).toMatchObject({ status: "mapped" });
    const shown = document.createElement("vite-error-overlay");
    shown.attachShadow({ mode: "open" }).innerHTML = `<div class="message-body">[vite] Internal server error: Cannot read properties of undefined (reading 'width')</div>`;
    document.body.append(shown);
    await flush();
    expect(last("page-state")).toMatchObject({ state: "failed", message: "[vite] Internal server error: Cannot read properties of undefined (reading 'width')" });
    expect(last("arrange-status")).toMatchObject({ status: "declined", cause: "page-failed" });
    shown.remove();
    await flush();
    expect(last("page-state")).toMatchObject({ state: "drawn" });
  });

  it("a click selects the section and doesn't follow its links; the site's navigation still works", () => {
    start();
    arrange();
    const inside = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    $("#cta").dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(true);
    expect(last("arrange-select")).toMatchObject({ key: "sections.0" });
    const nav = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    $("#nav").dispatchEvent(nav);
    expect(nav.defaultPrevented).toBe(false);
  });

  it("keeps the selected section's label inside its box when a sticky header sits right above it", async () => {
    start();
    arrange({ selected: "sections.1" });
    await flush();
    const tab = () => inLayer(".box.sel .tab");
    // Nothing of the page's own above the section: the label sits on top of the box.
    expect(tab().classList.contains("inside")).toBe(false);

    // The site's sticky header covers the strip just above the section (it ends at y = 300).
    const header = $("header");
    header.style.position = "sticky";
    const original = document.elementFromPoint;
    document.elementFromPoint = ((_x: number, y: number) => (y < 300 ? header.querySelector("nav") : $("#s1"))) as typeof document.elementFromPoint;
    try {
      arrange({ selected: "sections.1", revision: 2 });
      window.dispatchEvent(new Event("scroll"));
      await flush();
      expect(tab().classList.contains("inside")).toBe(true);
    } finally {
      document.elementFromPoint = original;
    }
  });

  it("from the keyboard: arrows change the selection, Alt+arrows move, Delete removes, Enter edits", () => {
    start();
    arrange({ selected: "sections.0" });
    $("#s0").focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(last("arrange-select")).toMatchObject({ key: "sections.1" });
    expect(document.activeElement?.id).toBe("s1");
    arrange({ selected: "sections.1" });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true }));
    expect(last("arrange-action")).toMatchObject({ action: "step", field: "sections", index: 1, delta: 1 });
    arrange({ selected: "sections.1", revision: 2 });
    $("#s1").focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(last("arrange-action")).toMatchObject({ action: "remove", index: 1 });
    arrange({ selected: "sections.1", revision: 3 });
    $("#s1").focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(last("arrange-action")).toMatchObject({ action: "edit", index: 1 });
  });

  it("focus that lands on a link inside a section goes to the section", () => {
    start();
    arrange();
    $("#cta").focus();
    expect(document.activeElement?.id).toBe("s0");
    expect(last("arrange-select")).toMatchObject({ key: "sections.0" });
  });

  it("dragging the handle down two places asks to move the section to its final position", async () => {
    start();
    arrange({ selected: "sections.0" });
    await flush();
    const grip = inLayer('[data-act="grip"]');
    pointer("pointerdown", grip, { clientX: 400, clientY: 20 });
    pointer("pointermove", grip, { clientX: 400, clientY: 40 });
    pointer("pointermove", grip, { clientX: 400, clientY: 760 });
    await flush();
    // Sections after the drop point make room; the dragged one is lifted.
    expect($("#s0").classList.contains("__galley-lifted")).toBe(true);
    expect(inLayer(".drop").hidden).toBe(false);
    pointer("pointerup", grip, { clientX: 400, clientY: 760 });
    expect(last("arrange-action")).toMatchObject({ action: "move", field: "sections", index: 0, to: 2 });
  });

  it("Escape cancels a drag and puts the page back", async () => {
    start();
    arrange({ selected: "sections.2" });
    await flush();
    const grip = inLayer('[data-act="grip"]');
    pointer("pointerdown", grip, { clientX: 400, clientY: 620 });
    pointer("pointermove", grip, { clientX: 400, clientY: 10 });
    await flush();
    expect($("#s0").classList.contains("__galley-shifted")).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    pointer("pointerup", grip, { clientX: 400, clientY: 10 });
    expect(sent().some((message) => message.type === "arrange-action")).toBe(false);
    expect(document.querySelector(".__galley-shifted, .__galley-lifted")).toBeNull();
  });

  it("placing from the host: the pointer picks a gap, the drop places there", () => {
    start();
    arrange();
    fromHost({ type: "placing", field: "sections", label: "Pricing" });
    fromHost({ type: "placing-pointer", point: { x: 300, y: 500 } });
    expect(last("placing-at")).toMatchObject({ field: "sections", index: 2 });
    fromHost({ type: "placing-pointer", point: { x: 300, y: 10 } });
    expect(last("placing-at")).toMatchObject({ index: 0 });
    fromHost({ type: "placing-pointer", point: null });
    expect(last("placing-at")).toMatchObject({ field: null, index: null });
    fromHost({ type: "placing-pointer", point: { x: 300, y: 880 } });
    fromHost({ type: "placing-drop" });
    expect(last("place")).toMatchObject({ field: "sections", index: 3 });
  });

  it("placing by click: every insertion line is a button that places there", async () => {
    start();
    arrange();
    fromHost({ type: "placing", field: "sections", label: "Pricing" });
    await flush();
    const add = layer().shadowRoot?.querySelector('[data-act="gap"][data-gap="1"]') as HTMLButtonElement;
    expect(add.getAttribute("aria-label")).toBe("Add Pricing after “Hero”");
    add.click();
    expect(last("place")).toMatchObject({ field: "sections", index: 1 });
  });

  it("an edit made after hovering one insertion line hides it while the page catches up, without an error", async () => {
    start();
    arrange();
    // Only the line between the second and third sections has been shown, so the pool of lines has holes before it.
    pointer("pointermove", $("#s1"), { clientX: 400, clientY: 598 });
    await flush();
    const line = layer().shadowRoot?.querySelector('[data-act="gap"][data-gap="2"]')?.parentElement as HTMLElement;
    expect(line.hidden).toBe(false);
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error ?? event.message);
    window.addEventListener("error", onError);
    try {
      // The host says an edit is on its way: the chrome steps back until the page matches the content again.
      expect(() => arrange({ settling: true, revision: 2 })).not.toThrow();
      await flush();
    } finally {
      window.removeEventListener("error", onError);
    }
    expect(errors).toEqual([]);
    expect(line.hidden).toBe(true);
  });

  it("hides the handles when the sections can't be changed", async () => {
    start();
    arrange({ selected: "sections.1", editable: false });
    await flush();
    expect(inLayer('[data-act="grip"]').hidden).toBe(true);
    expect(inLayer('[data-act="edit"]').hidden).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(sent().some((message) => message.type === "arrange-action" && message.action === "remove")).toBe(false);
  });

  it("re-maps after the page changes under it, keeping the selection", async () => {
    start();
    arrange({ selected: "sections.1" });
    const fresh = document.createElement("section");
    fresh.id = "s1";
    fresh.setAttribute("data-galley-block", "sections.1");
    fresh.setAttribute("data-galley-block-type", "features");
    fresh.innerHTML = "<h2>Features heading</h2>";
    $("#s1").replaceWith(fresh);
    boxes();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fresh.getAttribute("tabindex")).toBe("0");
    expect(fresh.hasAttribute("data-galley-arrange-root")).toBe(true);
  });

  it("the deployed site's frame ignores Arrange", () => {
    start("follow");
    arrange();
    expect(document.querySelector("[data-galley-arrange]")).toBeNull();
  });
});

describe("the Arrange protocol", () => {
  it("accepts well-formed messages and drops anything else", () => {
    const good = { galley: 1, type: "arrange", on: true, lists: LISTS, editable: true, selected: "sections.0", settling: false, revision: 3, reveal: false };
    expect(parseHostMessage(good)).toEqual(good);
    expect(parseHostMessage({ ...good, lists: [{ field: "sections", sections: [{ index: -1, type: "x", label: "X", texts: [], images: [] }] }] })).toBeNull();
    expect(parseHostMessage({ ...good, selected: 4 })).toBeNull();
    expect(parseHostMessage({ galley: 1, type: "placing-pointer", point: { x: "1", y: 2 } })).toBeNull();
    expect(parseHostMessage({ galley: 1, type: "placing", field: null, label: null })).toEqual({ galley: 1, type: "placing", field: null, label: null });
  });
});
