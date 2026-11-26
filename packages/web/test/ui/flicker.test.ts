// @vitest-environment happy-dom
/**
 * Regression tests for light/dark and theme-panel flicker fixes:
 *  - `public/theme.js` applies `galleyStart.theme` and sets `root.style.colorScheme` before CSS loads.
 *  - `useLookOnPage()` does not strip pre-painted `data-look-*` attributes, delete `galley.look`,
 *    or wipe `useUi.look` while `meta === null`, nor flash to Quiet while custom server themes load.
 *  - `BrandEffects` on hosted mode does not re-fetch `/api/settings` on `focus` once `themeChosen === true`.
 */
import { readFileSync } from "node:fs";
import { URL as NodeURL, fileURLToPath } from "node:url";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLATE, QUIET, checkTheme } from "@galley/core/themes";
import type { MetaInfo, Settings } from "@galley/core/types";
import { BrandEffects } from "@/app/BrandEffects";
import { useLookOnPage } from "@/app/look";
import { clearQueries, setQueryData } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { LOOK_COPY_KEY, useMyThemes, useThemeEdit } from "@/lib/stores/themes";
import { UI_STORAGE_KEY, useUi } from "@/lib/stores/ui";
import { keys } from "@/lib/sync";

const THEME_JS = readFileSync(fileURLToPath(new NodeURL("../../public/theme.js", import.meta.url)), "utf8");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const APPLIED_PLATE = checkTheme(PLATE).applied!;
const APPLIED_QUIET = checkTheme(QUIET).applied!;
const SAVED_FOG = { ...QUIET, id: "fog", name: "Fog", light: { ...QUIET.light, paper: "#F3EFE8" } };
const APPLIED_FOG = checkTheme(SAVED_FOG).applied!;

function resetDomAndStores(): void {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-look");
  document.documentElement.removeAttribute("data-look-sidebar");
  document.documentElement.removeAttribute("data-look-assist");
  document.documentElement.removeAttribute("data-look-icons");
  document.documentElement.removeAttribute("data-look-depth");
  document.documentElement.style.cssText = "";
  localStorage.clear();
  clearQueries();
  delete (globalThis as { galleyStart?: unknown }).galleyStart;
  useMeta.setState({ meta: null, status: "loading", error: undefined });
  useUi.setState({ theme: "system", themeChosen: false, look: null, lookChosen: false });
  useMyThemes.setState({ mine: [], account: null });
  useThemeEdit.setState({ preview: null });
}

function runThemeBootScript(start?: { keeper?: "browser" | "server"; theme?: string; look?: unknown }): void {
  if (start !== undefined) (globalThis as { galleyStart?: unknown }).galleyStart = start;
  else delete (globalThis as { galleyStart?: unknown }).galleyStart;
  const fn = new Function(THEME_JS);
  fn();
}

function makeMeta(overrides: Partial<MetaInfo> = {}): MetaInfo {
  return {
    product: { name: "Galley", slug: "galley", version: "1.0.0" },
    mode: "hosted",
    authenticated: true,
    brand: { productName: "Galley", byline: "", accent: null, logoUrl: null },
    look: APPLIED_QUIET,
    ...overrides,
  } as MetaInfo;
}

describe("public/theme.js pre-paint boot", () => {
  beforeEach(resetDomAndStores);
  afterEach(() => {
    vi.restoreAllMocks();
    resetDomAndStores();
  });

  it("applies galleyStart.theme when themeChosen is false and sets root.style.colorScheme", () => {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ state: { theme: "light", themeChosen: false }, version: 2 }));
    runThemeBootScript({ keeper: "browser", theme: "dark", look: APPLIED_PLATE });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.getAttribute("data-look")).toBe("plate");
    expect(document.documentElement.getAttribute("data-look-sidebar")).toBe(APPLIED_PLATE.switches.sidebar);
  });

  it("respects localStorage theme on hosted installs once themeChosen is true", () => {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ state: { theme: "light", themeChosen: true }, version: 2 }));
    runThemeBootScript({ keeper: "browser", theme: "dark", look: APPLIED_QUIET });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("prefers galleyStart.theme in server keeper mode and sets colorScheme even without a look", () => {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ state: { theme: "light", themeChosen: true }, version: 2 }));
    runThemeBootScript({ keeper: "server", theme: "dark", look: null });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});

describe("useLookOnPage boot flicker & wipe prevention", () => {
  beforeEach(resetDomAndStores);
  afterEach(() => {
    vi.restoreAllMocks();
    resetDomAndStores();
  });

  function LookHarness() {
    useLookOnPage();
    return null;
  }

  it("does not strip pre-painted data-look-* attributes, delete galley.look, or wipe useUi.look while meta is null", async () => {
    // Pre-paint as public/theme.js does before React mounts.
    const savedCopy = JSON.stringify({ chosen: true, look: APPLIED_PLATE });
    localStorage.setItem(LOOK_COPY_KEY, savedCopy);
    useUi.setState({ look: "plate", lookChosen: true });
    document.documentElement.setAttribute("data-look", "plate");
    document.documentElement.setAttribute("data-look-sidebar", APPLIED_PLATE.switches.sidebar);
    document.documentElement.setAttribute("data-look-assist", APPLIED_PLATE.switches.assist);
    document.documentElement.style.setProperty("--theme-paper", APPLIED_PLATE.light.paper);

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(LookHarness));
    });

    // While meta === null, pre-painted DOM, localStorage copy, and store state are untouched.
    expect(document.documentElement.getAttribute("data-look")).toBe("plate");
    expect(document.documentElement.getAttribute("data-look-sidebar")).toBe(APPLIED_PLATE.switches.sidebar);
    expect(document.documentElement.style.getPropertyValue("--theme-paper")).toBe(APPLIED_PLATE.light.paper);
    expect(localStorage.getItem(LOOK_COPY_KEY)).toBe(savedCopy);
    expect(useUi.getState().look).toBe("plate");
    expect(useUi.getState().lookChosen).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("waits for server themes before overwriting a pre-painted saved theme", async () => {
    let resolveThemes!: (value: Response) => void;
    const pendingThemes = new Promise<Response>((resolve) => {
      resolveThemes = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => pendingThemes),
    );

    const savedCopy = JSON.stringify({ chosen: true, look: APPLIED_FOG });
    localStorage.setItem(LOOK_COPY_KEY, savedCopy);
    useUi.setState({ look: "fog", lookChosen: true });
    document.documentElement.setAttribute("data-look", "fog");
    document.documentElement.setAttribute("data-look-sidebar", APPLIED_FOG.switches.sidebar);
    useMeta.setState({ meta: makeMeta({ mode: "hosted", authenticated: true, look: APPLIED_QUIET }), status: "ready" });

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(LookHarness));
    });

    // Still loading /api/themes: must NOT flash to Quiet!
    expect(document.documentElement.getAttribute("data-look")).toBe("fog");
    expect(localStorage.getItem(LOOK_COPY_KEY)).toBe(savedCopy);

    // Resolve /api/themes with Fog present.
    await act(async () => {
      resolveThemes(
        new Response(JSON.stringify({ saved: [SAVED_FOG], plugins: [], defaultId: "quiet" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await Promise.resolve();
    });

    expect(document.documentElement.getAttribute("data-look")).toBe("fog");

    await act(async () => {
      root.unmount();
    });
    vi.unstubAllGlobals();
  });
});

describe("BrandEffects focus & layout behavior", () => {
  beforeEach(resetDomAndStores);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetDomAndStores();
  });

  it("does not re-fetch /api/settings on focus in hosted mode once themeChosen is true", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/themes")) {
        return new Response(JSON.stringify({ saved: [], plugins: [], defaultId: "quiet" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const settings: Partial<Settings> = { appearance: { theme: "light" } };
      return new Response(JSON.stringify(settings), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    setQueryData(keys.themes(), { saved: [], plugins: [], defaultId: "quiet" });
    useMeta.setState({ meta: makeMeta({ mode: "hosted", authenticated: true }), status: "ready" });
    useUi.setState({ theme: "dark", themeChosen: true });

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(BrandEffects));
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    const settingsCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/settings"));
    expect(settingsCalls()).toHaveLength(0);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(settingsCalls()).toHaveLength(0);
    expect(document.documentElement.dataset.theme).toBe("dark");

    // In local mode (keeper === "server"), focus DOES pull /api/settings.
    await act(async () => {
      useMeta.setState({ meta: makeMeta({ mode: "local", authenticated: true }), status: "ready" });
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(settingsCalls()).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });
});
