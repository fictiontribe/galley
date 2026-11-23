// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverlayToHost } from "@galley/core/types";
import { MEASURE_LIMIT_BYTES, measurePage } from "../src/measure";
import { createOverlay } from "../src/overlay";
import { allowedFor, parseHostMessage } from "../src/protocol";

const HOST = "http://localhost:5175";

function page(html: string, css = ""): void {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = html;
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("measurePage", () => {
  it("reports text colours on their effective background, type by role, buttons, links and the page's copy", () => {
    page(
      `<header><a href="/"><svg viewBox="0 0 120 32" aria-label="Lowfield"><rect width="120" height="32" fill="#C53500"/></svg></a><nav><a href="/pricing/">Pricing</a></nav></header>
       <main><section class="hero"><h1>Plain words for busy teams</h1><p>Every change is checked before it goes live, so nothing reaches visitors by accident.</p><button class="primary">Start a free trial</button></section>
       <section class="muted"><p>Muted surface copy that is a little lighter than the body text everywhere else.</p><a href="/pricing/">See pricing</a></section></main>`,
      `:root { --color-background: #FBF9F6; --color-accent: #C53500; }
       body { background-color: #FBF9F6; color: #121922; font-family: "Geist Variable", sans-serif; font-size: 16px; }
       h1 { font-family: "Schibsted Grotesk Variable", sans-serif; font-size: 48px; font-weight: 700; }
       .muted { background-color: #F1EEE9; color: #59606B; }
       button.primary { background-color: #C53500; color: #FFFFFF; border-radius: 999px; padding: 10px 18px; }
       a { color: #C53500; text-decoration: underline; }`
    );
    const summary = measurePage(window);

    const onPaper = summary.pairs.find((pair) => pair.text === "#121922" && pair.background === "#FBF9F6");
    expect(onPaper?.roles).toEqual(expect.arrayContaining(["heading", "body"]));
    expect(onPaper!.ratio).toBeGreaterThan(15);
    expect(summary.pairs.find((pair) => pair.text === "#59606B")?.background).toBe("#F1EEE9");
    expect(summary.type.find((style) => style.tag === "h1")).toMatchObject({ role: "heading", family: "Schibsted Grotesk Variable", size: 48, weight: 700 });
    expect(summary.buttons[0]).toMatchObject({ background: "#C53500", color: "#FFFFFF", radius: "999px", sample: "Start a free trial" });
    expect(summary.links.some((link) => link.color === "#C53500")).toBe(true);
    expect(summary.logos[0]).toMatchObject({ kind: "svg", viewBox: "0 0 120 32", colors: ["#C53500"] });
    expect(summary.internalLinks[0]).toEqual({ path: "/pricing/", count: 2 });
    expect(summary.copy.map((line) => line.text)).toEqual(expect.arrayContaining(["Plain words for busy teams", "Start a free trial"]));
    expect(summary.variables).toEqual(expect.arrayContaining([{ name: "--color-accent", value: "#C53500" }]));
    expect(summary.truncated).toBe(false);
  });

  it("leaves out text on a picture or gradient rather than guessing its background", () => {
    page(`<section style="background-image: linear-gradient(red, blue)"><p>Text over a gradient, which can't be measured fairly at all.</p></section>`, "body { background-color: #ffffff; color: #111111; }");

    expect(measurePage(window).pairs).toEqual([]);
  });

  it("composites translucent grounds and text over what is behind them", () => {
    page(`<div class="card"><p>Half-ink text on a tinted card, composited by the browser.</p></div>`, "body { background-color: #ffffff; } .card { background-color: rgba(0, 0, 0, 0.5); color: rgba(255, 255, 255, 0.5); }");
    const pair = measurePage(window).pairs[0]!;

    expect(pair.background).toBe("#808080");
    expect(pair.text).toBe("#BFBFBF");
  });

  it("stays under the size cap on a huge page, and says it was cut", () => {
    const rows = Array.from({ length: 1500 }, (_, i) => `<p style="color: rgb(${i % 250}, ${(i * 7) % 250}, ${(i * 13) % 250}); font-size: ${10 + (i % 40)}px">Row ${i} of a very long page with a great deal of distinct copy in it, number ${i}.</p><a href="/p/${i}/">Link ${i}</a>`).join("");
    page(rows, "body { background-color: #fafafa; }");
    const summary = measurePage(window, { limitBytes: 6_000 });

    expect(JSON.stringify(summary).length).toBeLessThanOrEqual(6_000);
    expect(summary.truncated).toBe(true);
    expect(JSON.stringify(measurePage(window)).length).toBeLessThanOrEqual(MEASURE_LIMIT_BYTES);
  });
});

describe("the measure message", () => {
  it("is accepted with a plain id only, and only by the editing frame", () => {
    expect(parseHostMessage({ galley: 1, type: "measure", id: "m-1" })).toEqual({ galley: 1, type: "measure", id: "m-1" });
    expect(parseHostMessage({ galley: 1, type: "measure", id: "<script>" })).toBeNull();
    expect(parseHostMessage({ galley: 1, type: "measure" })).toBeNull();
    expect(allowedFor("follow", { galley: 1, type: "measure", id: "a" })).toBe(false);
    expect(allowedFor("edit", { galley: 1, type: "measure", id: "a" })).toBe(true);
  });

  it("answers the host with a measure-result carrying the same id, and changes nothing on the page", () => {
    page(`<main><h1>Hello there, measured world</h1></main>`, "body { background-color: #ffffff; color: #222222; }");
    const before = document.body.innerHTML;
    const parent = { postMessage: vi.fn<(message: unknown, origin: string) => void>() };
    const overlay = createOverlay({ win: window, parent, ancestorOrigin: HOST, role: "edit" });
    const event = new MessageEvent("message", { data: { galley: 1, type: "measure", id: "abc" }, origin: HOST });

    Object.defineProperty(event, "source", { value: parent });
    window.dispatchEvent(event);
    const reply = parent.postMessage.mock.calls.map((call) => call[0] as OverlayToHost).find((message) => message.type === "measure-result");

    expect(reply).toMatchObject({ galley: 1, type: "measure-result", id: "abc" });
    expect(reply && reply.type === "measure-result" ? reply.summary.copy[0]?.text : null).toBe("Hello there, measured world");
    expect(parent.postMessage.mock.calls.every((call) => call[1] === HOST)).toBe(true);
    expect(document.body.innerHTML).toBe(before);
    overlay.dispose();
  });
});
