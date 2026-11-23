// The inline runtime in a browser-like window: consent state machine, Google
// Consent Mode v2 call order, preview detection, load moments, the banner and
// the signals of other consent tools. Script loading is switched off in the
// window, so "activated" means a real <script> element was created with the
// vendor's src or code — nothing is fetched or run.
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ScriptsConfig } from "../src/kit";
import { injectPlan, planPage } from "../src/scripts/plan.js";
import { RUNTIME } from "../src/scripts/runtime.gen.js";

const windows: Window[] = [];

afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.close();
});

const CONFIG: ScriptsConfig = {
  consent: { mode: "banner", googleConsentMode: true },
  scripts: [
    { id: "gtm", kind: "gtm", enabled: true, settings: { containerId: "GTM-AB12CDE3" } },
    { id: "ads", kind: "meta-pixel", enabled: true, settings: { pixelId: "123456789012345" } },
    { id: "plausible", kind: "plausible", enabled: true, settings: { scriptId: "pa-AbCdEf123456" } },
    { id: "late", kind: "custom", enabled: true, consent: "necessary", load: "interaction", settings: { src: "https://cdn.example.com/late.js" } },
    { id: "lazy", kind: "custom", enabled: true, consent: "necessary", load: "idle", settings: { src: "https://cdn.example.com/lazy.js" } },
  ],
};

interface Page {
  win: Window;
  dataLayer: () => unknown[][];
  loaded: () => string[];
  consent: any;
  click: (selector: string) => void;
}

/**
 * Builds a page as the middleware would and runs its inline scripts in order,
 * the way a browser parses them.
 */
function open(config: ScriptsConfig, options: { url?: string; name?: string; framed?: boolean; storage?: Record<string, string>; path?: string } = {}): Page {
  const win = new Window({
    url: options.url ?? "https://www.example.com/",
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, navigator: { userAgent: "test" } },
  });

  windows.push(win);
  if (options.name) win.name = options.name;
  for (const [key, value] of Object.entries(options.storage ?? {})) win.localStorage.setItem(key, value);
  if (options.framed) Object.defineProperty(win, "top", { value: {}, configurable: true });
  const plan = planPage(config, { path: options.path ?? "/", host: "www.example.com" });
  const html = injectPlan('<!doctype html><html><head><meta charset="utf-8"><title>Page</title></head><body><main><a href="/privacy/" data-galley-consent-open>Privacy choices</a></main></body></html>', plan, {
    consent: config.consent,
  });

  win.document.write(html);
  const run = new Function(
    "window",
    "document",
    "location",
    "localStorage",
    "CustomEvent",
    "setTimeout",
    "URL",
    `return function (code) { return eval(code); };`,
  );
  // The page's own inline scripts (runtime + activators), in document order.
  const evaluate = run(win, win.document, win.location, win.localStorage, win.CustomEvent, win.setTimeout.bind(win), URL);

  for (const script of win.document.querySelectorAll("script[data-galley-scripts]")) {
    const code = script.textContent ?? "";

    evaluate(code.replace(/^galleyScripts\./, "window.galleyScripts."));
  }
  win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
  return {
    win,
    dataLayer: () => ((win as any).dataLayer ?? []).map((entry: IArguments | unknown) => (Object.prototype.toString.call(entry) === "[object Arguments]" ? Array.from(entry as IArguments) : entry)),
    loaded: () => [...win.document.querySelectorAll("script:not([type='text/plain']):not([data-galley-scripts])")].map((script) => script.getAttribute("src") ?? `inline:${(script.textContent ?? "").slice(0, 30)}`),
    consent: (win as any).galleyConsent,
    click: (selector: string) => (win.document.querySelector(selector) as any).click(),
  };
}

const DENIED = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  functionality_storage: "denied",
  personalization_storage: "denied",
  security_storage: "granted",
};

describe("before any choice", () => {
  it("pushes Consent Mode's denied default first, loads only what needs no consent (cookieless Plausible), and shows the banner", () => {
    const page = open(CONFIG);

    expect(page.dataLayer()).toEqual([["consent", "default", DENIED]]);
    expect(page.loaded()).toEqual(["https://plausible.io/js/pa-AbCdEf123456.js", "inline:window.plausible=window.plausi"]);
    expect((page.win.document.querySelector("[data-galley-consent]") as unknown as HTMLElement).hidden).toBe(false);
    expect(page.consent.get()).toEqual({ necessary: true, analytics: false, marketing: false, preferences: false });
  });
});

describe("accepting", () => {
  it("updates Consent Mode, then loads the scripts, in that order — and remembers the choice", () => {
    const page = open(CONFIG);

    expect(page.loaded()).not.toContain("https://www.googletagmanager.com/gtm.js?id=GTM-AB12CDE3");
    (page.win as any).dataLayer.push = function (entry: unknown) {
      // At the moment of every push, record whether GTM was already asked for.
      seen.push([Array.from(entry as IArguments)[1], page.loaded().includes("https://www.googletagmanager.com/gtm.js?id=GTM-AB12CDE3")]);
      return Array.prototype.push.call(this, entry);
    };
    const seen: unknown[] = [];

    page.click("[data-galley-consent-accept]");
    expect(seen).toEqual([["update", false]]);
    const granted = Object.fromEntries(Object.keys(DENIED).map((key) => [key, "granted"]));

    expect(page.dataLayer()[0]).toEqual(["consent", "default", DENIED]);
    expect(page.dataLayer()[1]).toEqual(["consent", "update", granted]);
    expect(page.loaded()).toEqual([
      "https://www.googletagmanager.com/gtm.js?id=GTM-AB12CDE3",
      "inline:window.dataLayer = window.data",
      "inline:!function(f,b,e,v,n,t,s)\n{if(f",
      "https://plausible.io/js/pa-AbCdEf123456.js", "inline:window.plausible=window.plausi",
    ]);
    expect((page.win.document.querySelector("[data-galley-consent]") as unknown as HTMLElement).hidden).toBe(true);
    expect(JSON.parse(page.win.localStorage.getItem("galley:consent")!)).toMatchObject({ v: 1, choice: { analytics: true, marketing: true, preferences: true } });
  });

  it("on the next page, the stored choice follows the default straight away and the scripts load", () => {
    const page = open(CONFIG, { storage: { "galley:consent": JSON.stringify({ v: 1, choice: { analytics: true, marketing: false, preferences: false } }) } });

    expect(page.dataLayer()).toEqual([
      ["consent", "default", DENIED],
      ["consent", "update", { ...DENIED, analytics_storage: "granted" }],
    ]);
    expect(page.loaded()).toEqual(["https://www.googletagmanager.com/gtm.js?id=GTM-AB12CDE3", "inline:window.dataLayer = window.data", "https://plausible.io/js/pa-AbCdEf123456.js", "inline:window.plausible=window.plausi"]);
    expect((page.win.document.querySelector("[data-galley-consent]") as unknown as HTMLElement).hidden).toBe(true);
  });
});

describe("rejecting and choosing", () => {
  it("reject all keeps everything off and says so to Consent Mode", () => {
    const page = open(CONFIG);

    page.click("[data-galley-consent-reject]");
    expect(page.dataLayer()[1]).toEqual(["consent", "update", DENIED]);
    expect(page.loaded()).toEqual(["https://plausible.io/js/pa-AbCdEf123456.js", "inline:window.plausible=window.plausi"]);
  });

  it("choose… opens the categories; saving loads exactly what was ticked", () => {
    const page = open(CONFIG);
    const toggle = page.win.document.querySelector("[data-galley-consent-settings]")!;

    page.click("[data-galley-consent-settings]");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect((page.win.document.querySelector("[data-galley-consent-choices]") as unknown as HTMLElement).hidden).toBe(false);
    (page.win.document.querySelector('input[data-category="marketing"]') as any).checked = true;
    page.click("[data-galley-consent-save]");
    expect(page.loaded()).toEqual(["inline:!function(f,b,e,v,n,t,s)\n{if(f", "https://plausible.io/js/pa-AbCdEf123456.js", "inline:window.plausible=window.plausi"]);
    expect(page.dataLayer()[1]).toEqual(["consent", "update", { ...DENIED, ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" }]);
  });

  it("changing one's mind later loads what is newly allowed and unloads nothing", () => {
    const page = open(CONFIG);

    page.click("[data-galley-consent-accept]");
    const before = page.loaded().length;

    page.click("[data-galley-consent-open]");
    expect((page.win.document.querySelector("[data-galley-consent]") as unknown as HTMLElement).hidden).toBe(false);
    expect(page.win.document.activeElement?.hasAttribute("data-galley-consent-accept")).toBe(true);
    page.click("[data-galley-consent-reject]");
    expect(page.loaded()).toHaveLength(before);
    expect(page.consent.granted("analytics")).toBe(false);
    expect(page.win.document.activeElement?.hasAttribute("data-galley-consent-open")).toBe(true);
  });
});

describe("load moments", () => {
  it("interaction waits for the first key, tap or scroll; idle waits for the page to settle", async () => {
    const page = open(CONFIG);

    expect(page.loaded()).not.toContain("https://cdn.example.com/late.js");
    page.win.dispatchEvent(new page.win.Event("keydown"));
    expect(page.loaded()).toContain("https://cdn.example.com/late.js");
    page.win.dispatchEvent(new page.win.Event("load"));
    await new Promise((done) => setTimeout(done, 20));
    expect(page.loaded()).toContain("https://cdn.example.com/lazy.js");
  });
});

describe("the editor's preview", () => {
  it("loads nothing (and shows no banner) in a frame the editor named, or a proxied frame on another host", () => {
    for (const page of [
      open(CONFIG, { name: "galley-preview", storage: { "galley:consent": JSON.stringify({ v: 1, choice: { analytics: true, marketing: true, preferences: true } }) } }),
      open(CONFIG, { url: "http://127.0.0.1:4410/", framed: true, storage: { "galley:consent": JSON.stringify({ v: 1, choice: { analytics: true, marketing: true, preferences: true } }) } }),
      open({ ...CONFIG, consent: { mode: "none" } }, { name: "galley-post-abc" }),
    ]) {
      expect(page.loaded()).toEqual([]);
      expect(page.consent.preview).toBe(true);
    }
  });

  it("loads entries marked inPreview there", () => {
    const page = open({ scripts: [{ id: "chat", kind: "custom", enabled: true, consent: "necessary", inPreview: true, settings: { src: "https://cdn.example.com/chat.js" } }] }, { name: "galley-preview" });

    expect(page.loaded()).toEqual(["https://cdn.example.com/chat.js"]);
  });

  it("a framed page on the site's own host is not a preview", () => {
    expect(open({ ...CONFIG, consent: { mode: "none" } }, { framed: true }).consent.preview).toBe(false);
  });
});

describe("another consent tool decides (mode external)", () => {
  const external: ScriptsConfig = { ...CONFIG, consent: { mode: "external", googleConsentMode: true } };

  it("waits for an update, with wait_for_update on the default", () => {
    const page = open(external);

    expect(page.dataLayer()[0]).toEqual(["consent", "default", { ...DENIED, wait_for_update: 500 }]);
    expect(page.win.document.querySelector("[data-galley-consent]")).toBeNull();
  });

  it("galleyConsent.set grants categories without storing anything", () => {
    const page = open(external);

    page.consent.set({ analytics: true });
    expect(page.loaded()).toContain("https://www.googletagmanager.com/gtm.js?id=GTM-AB12CDE3");
    expect(page.win.localStorage.getItem("galley:consent")).toBeNull();
  });

  it("follows a Consent Mode update pushed by the tool, and Cookiebot's documented events", () => {
    const page = open(external);
    const gtag = function (..._args: unknown[]) {
      // eslint-disable-next-line prefer-rest-params
      (page.win as any).dataLayer.push(arguments);
    };

    gtag("consent", "update", { ad_storage: "granted" });
    expect(page.consent.get()).toMatchObject({ marketing: true, analytics: false });
    expect(page.loaded()).toEqual(["inline:!function(f,b,e,v,n,t,s)\n{if(f", "https://plausible.io/js/pa-AbCdEf123456.js", "inline:window.plausible=window.plausi"]);

    const second = open(external);

    (second.win as any).Cookiebot = { consent: { statistics: true, marketing: false, preferences: true } };
    second.win.dispatchEvent(new second.win.Event("CookiebotOnConsentReady"));
    expect(second.consent.get()).toEqual({ necessary: true, analytics: true, marketing: false, preferences: true });
  });
});

describe("UTM memory", () => {
  it("remembers first and last landings once marketing is granted, and not before", () => {
    const config: ScriptsConfig = { consent: { mode: "banner" }, scripts: [{ id: "ads", kind: "meta-pixel", enabled: true, settings: { pixelId: "123456789012345" } }] };
    const plan = (url: string, storage: Record<string, string> = {}) => {
      const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });

      windows.push(win);
      for (const [key, value] of Object.entries(storage)) win.localStorage.setItem(key, value);
      const page = planPage(config, { path: "/", utm: true });
      const fn = new Function("window", "document", "location", "localStorage", "CustomEvent", "setTimeout", "URL", `return (${RUNTIME})`)(win, win.document, win.location, win.localStorage, win.CustomEvent, win.setTimeout.bind(win), URL);

      fn(page.config);
      return win;
    };
    const first = plan("https://www.example.com/?utm_source=news&utm_campaign=spring");

    expect(first.localStorage.getItem("galley:attribution")).toBeNull();
    (first as any).galleyConsent.set({ marketing: true });
    const memory = JSON.parse(first.localStorage.getItem("galley:attribution")!);

    expect(memory.first).toMatchObject({ utm_source: "news", utm_campaign: "spring", landing_page: "https://www.example.com/" });
    const consent = first.localStorage.getItem("galley:consent")!;
    const later = plan("https://www.example.com/pricing/?utm_source=ads", { "galley:consent": consent, "galley:attribution": JSON.stringify(memory) });
    const after = JSON.parse(later.localStorage.getItem("galley:attribution")!);

    expect(after.first.utm_source).toBe("news");
    expect(after.last.utm_source).toBe("ads");
  });
});
