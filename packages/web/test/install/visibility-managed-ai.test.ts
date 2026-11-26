// @vitest-environment happy-dom
/**
 * The Search & AI screen asks for the editor's settings whether or not managed AI is switched off, so switching it
 * off or on while the screen is open never changes the number of hooks it calls (React would throw: "Rendered fewer
 * hooks than expected").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MetaInfo } from "@galley/core/types";
import { renderApp, settle, startServer, until, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.restoreAllMocks();
});

describe("the Search & AI screen with managed AI", () => {
  it("keeps working when AI is switched off and on again while it is open", async () => {
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => errors.push(String(event.error ?? event.message));

    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    window.addEventListener("error", onError);
    const server = await startServer({ mode: "hosted", setup: "done", role: "owner" });

    page = await renderApp(server, `/sites/${server.install?.site.id ?? ""}/visibility`);
    await until(() => expect(page!.text()).toMatch(/Search & AI/));
    await settle(300);
    const { act } = await import("react");
    const { useMeta } = await import("@/lib/stores/meta");
    const setAi = async (disabled: boolean) => {
      await act(async () => {
        useMeta.setState((state) => ({ meta: { ...(state.meta as MetaInfo), ai: { managed: true, disabled, creditMillicents: 250 } } as MetaInfo }));
      });
      await settle(200);
    };

    // false → true → false, with the screen open throughout.
    await setAi(false);
    await setAi(true);
    await setAi(false);
    window.removeEventListener("error", onError);
    expect(errors.filter((line) => /hooks|Rendered (fewer|more)/i.test(line))).toEqual([]);
    expect(page.text()).toMatch(/Search & AI/);
  });
});
