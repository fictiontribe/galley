// @vitest-environment happy-dom
/**
 * The preview toolbar in a narrow pane (1280 px wide with the form and the
 * assistant open): preview.css turns each "On the page" tool's words into
 * its icon there, and wraps the row rather than clip it. happy-dom doesn't
 * lay out, so this checks what that rests on — every tool carries an icon,
 * keeps its words as its accessible name, and has a tooltip that starts
 * with those words — and that the stylesheet holds the narrow-pane rules.
 * (Checked by eye at 1280 px against `dev:mock`: see the builder's report.)
 */
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CSS = readFileSync(new NodeURL("../../src/features/preview/preview.css", import.meta.url), "utf8");

let unmount: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unmount?.();
  unmount = null;
});

async function renderToolbar(arrange: boolean): Promise<HTMLElement> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const [{ createElement, act }, { createRoot }, { PreviewToolbar }] = await Promise.all([import("react"), import("react-dom/client"), import("../../src/features/preview/PreviewToolbar")]);
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const root = createRoot(container);
  const none = () => undefined;
  await act(async () =>
    root.render(
      createElement(PreviewToolbar, {
        path: "/",
        onGo: () => null,
        canBack: false,
        canForward: false,
        onBack: none,
        onForward: none,
        onReload: none,
        width: "desktop",
        onWidth: none,
        tool: { value: "edit", onChange: none, arrange },
        openUrl: "https://preview.example.com/",
      }),
    ),
  );
  unmount = async () => act(async () => root.unmount());
  return container;
}

describe("the preview toolbar's tools in a narrow pane", () => {
  it("each carry an icon, keep their words as their name, and explain themselves in a tooltip", async () => {
    const container = await renderToolbar(true);
    const tools = [...container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="On the page"] [role="radio"]')];
    expect(tools.map((tool) => tool.textContent)).toEqual(["Click to edit", "Arrange", "Browse"]);
    for (const tool of tools) {
      const icon = tool.querySelector("svg.preview-tools__icon");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(tool.querySelector(".preview-tools__text")?.textContent).toBe(tool.textContent);
      expect(tool.title.startsWith(`${tool.textContent}: `)).toBe(true);
    }
  });

  it("leaves Arrange out when the page has no sections", async () => {
    const container = await renderToolbar(false);
    expect([...container.querySelectorAll('[aria-label="On the page"] [role="radio"]')].map((tool) => tool.textContent)).toEqual(["Click to edit", "Browse"]);
  });

  it("wraps instead of clipping, and swaps words for icons in a narrow pane", () => {
    expect(CSS).toMatch(/\.preview-toolbar \{[^}]*flex-wrap: wrap;[^}]*min-block-size: 40px;/);
    const narrow = /@container preview \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    expect(narrow).toMatch(/\.preview-tools__icon \{ display: inline-block; \}/);
    expect(narrow).toMatch(/\.preview-tools__text \{[^}]*clip-path: inset\(50%\)/);
    expect(CSS).toMatch(/^\.preview-tools__icon \{ display: none; \}/m);
  });
});
