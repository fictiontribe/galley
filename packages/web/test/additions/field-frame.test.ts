// @vitest-environment happy-dom
/**
 * A fieldFrame addition that fails while it draws leaves the field's own control where it was: the frame's boundary
 * shows what it framed, not nothing.
 */
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Field } from "@galley/core/types";
import { AdditionsProvider, FieldFrameAdditions } from "@/additions/places";
import type { Addition } from "@/additions/types";

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  vi.restoreAllMocks();
});

async function render(additions: Addition[]): Promise<HTMLElement> {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");

  document.body.append(container);
  const root = createRoot(container);
  const field = { key: "title", type: "string", label: "Title" } as unknown as Field;

  await act(async () => {
    root.render(h(AdditionsProvider, { additions, children: h(FieldFrameAdditions, { siteId: "s1", entryPath: "src/content/a.md", path: ["title"], field, children: h("input", { id: "own-control" }) }) }));
  });
  unmount = () => {
    root.unmount();
    container.remove();
  };
  return container;
}

describe("a fieldFrame addition", () => {
  it("that fails leaves the field's own control in place", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: Addition = {
      id: "broken-frame",
      fieldFrame: () => {
        throw new Error("frame failed");
      },
    } as unknown as Addition;
    const container = await render([broken]);

    expect(container.querySelector("#own-control")).not.toBeNull();
  });

  it("that fails inside a working one leaves the working frame and the control", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const working = { id: "working-frame", fieldFrame: ({ children }: { children: unknown }) => h("div", { className: "working" }, children as never) } as unknown as Addition;
    const broken = { id: "broken-frame", fieldFrame: () => { throw new Error("frame failed"); } } as unknown as Addition;
    const container = await render([working, broken]);

    expect(container.querySelector(".working #own-control")).not.toBeNull();
  });
});
