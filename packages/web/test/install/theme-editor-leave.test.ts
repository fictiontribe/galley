// @vitest-environment happy-dom
/**
 * The theme editor with unsaved changes asks before it is left, whichever way:
 * a link, the command palette, or Back. Keeping on editing keeps the draft;
 * leaving puts the saved theme back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { byText, click, field, renderApp, settle, startServer, type, until, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

const QUESTION = "Leave without saving your theme?";
const asked = () => [...document.querySelectorAll("dialog[open] h2")].some((heading) => heading.textContent === QUESTION);

async function editPlate(): Promise<void> {
  const server = await startServer({ mode: "local" });
  page = await renderApp(server, "/settings/themes?from=plate");
  await until(() => expect(document.querySelector(".theme-editor")).not.toBeNull());
  await type(field(document, "Name"), "Unsaved");
  await settle();
}

describe("leaving the theme editor with unsaved changes", () => {
  it("asks when the command palette would go elsewhere", async () => {
    await editPlate();
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });
    await until(() => expect(document.querySelector('[role="listbox"][aria-label="Results"]')).not.toBeNull());
    const option = [...document.querySelectorAll<HTMLElement>('[role="listbox"][aria-label="Results"] [role="option"]')].find((item) => /Plugins|App settings|All sites/.test(item.textContent ?? ""));
    expect(option).toBeTruthy();
    await click(option ?? null);
    await until(() => expect(asked()).toBe(true));
    expect(window.location.pathname).toBe("/settings/themes");
  });

  it("asks on Back, keeps the draft when told to, and leaves when told to", async () => {
    await editPlate();
    const { act } = await import("react");
    await act(async () => {
      window.history.back();
    });
    await until(() => expect(asked()).toBe(true));
    expect(document.querySelector(".theme-editor")).not.toBeNull();
    await click(byText(document, "dialog[open] button", "Keep editing"));
    await settle();
    expect((field(document, "Name") as HTMLInputElement).value).toBe("Unsaved");
    await act(async () => {
      window.history.back();
    });
    await until(() => expect(asked()).toBe(true));
    await click(byText(document, "dialog[open] button", "Leave without saving"));
    await until(() => expect(document.querySelector(".theme-editor")).toBeNull());
  });
});
