// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://www.example.com/docs/contact/" }
// Fixes builders reported against the kit, one test (or more) each:
//   a/h  the "no capture address" note: worded for both ways of using the kit, one key for the site
//   b    root-relative links in form texts and the banner under a base path
//   c/i  UTM memory and the banner: Marketing is offered when forms remember UTM values
//   d    the thank-you's focus ring: visible on keyboard focus, weightless against the site's own
//   e    a script kind this kit doesn't know is written like "custom"
//   f/j  the documented preview signals: scripts inert and no banner there, nothing else different;
//        <html data-galley-endpoint> honoured as documented
//   g    buttons legible when the site sets none of the kit's custom properties
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormDefinition, ScriptsConfig } from "../src/kit";
import { renderForm } from "../src/forms/render.js";
import { withBase } from "../src/shared/markdown.js";
import { BANNER_CSS, renderBanner } from "../src/scripts/banner.js";
import { injectPlan, planPage, resolveEntries } from "../src/scripts/plan.js";
import { RUNTIME } from "../src/scripts/runtime.gen.js";
import { buildSnippet } from "../src/scripts/snippets.js";
import { scriptsSchema } from "../src/schema.js";
import { submit as galley } from "../src/client/providers/galley.js";

// Plain paths: the test window replaces the global URL.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const FORMS_CSS = readFileSync(join(SRC, "forms/forms.css"), "utf8");
const FORM_COMPONENT = readFileSync(join(SRC, "components/Form.astro"), "utf8");

const form = (extra: Partial<FormDefinition> = {}): FormDefinition => ({
  name: "Contact",
  submitLabel: "Send",
  fields: [
    { id: "email", type: "email", label: "Email", help: "See our [privacy policy](/privacy/)." },
    { id: "ok", type: "consent", text: "I agree to the [terms](/terms/) and [the standard](https://example.org/s)." },
  ],
  destinations: [{ provider: "galley", settings: {} }],
  afterSubmit: [
    { type: "message", title: "Thanks", text: "Read the [guide](/guide/) meanwhile." },
    { type: "download", url: "/files/brochure.pdf", label: "Brochure" },
    { type: "redirect", url: "/thanks/" },
  ],
  ...extra,
});

describe("a/h — the note about a missing capture address", () => {
  it("is worded for the integration and for a vendored kit, and has one key for the whole site", () => {
    const one = renderForm(form(), "contact").notices;
    const two = renderForm(form(), "newsletter").notices;

    expect(one).toEqual([
      {
        key: "no-endpoint",
        text: "The form “contact” sends to the Galley inbox, but no capture address is set: put the inbox address in forms.endpoint (src/galley/settings.json for a vendored kit, or the integration's options), or in the destination's settings.endpoint. Galley's preview supplies its own address; on the live site the form will say it isn't connected yet.",
      },
    ]);
    expect(two[0]!.key).toBe(one[0]!.key);
    // <Form> prints each key once per build, not each text.
    expect(FORM_COMPONENT).toContain("if (!warned.has(notice.key))");
    expect(renderForm(form(), "contact", { endpoint: "https://cms.example.com/f/site_1" }).notices).toEqual([]);
  });

  it("the script-action note is per form and names both places the setting lives", () => {
    const notices = renderForm(form({ afterSubmit: [{ type: "script", code: "x()" }] }), "contact", { endpoint: "https://c.example/f" }).notices;

    expect(notices).toEqual([{ key: "script-actions:contact", text: "The form “contact” has a script action, which only run when forms.allowFormScripts is true (src/galley/settings.json for a vendored kit, or the integration's options). Leaving it out." }]);
  });
});

describe("b — links written from the site root, in a sub-path build", () => {
  it("withBase prefixes site-root addresses only", () => {
    expect(withBase("/privacy/", "/docs")).toBe("/docs/privacy/");
    expect(withBase("/privacy/", "/docs/")).toBe("/docs/privacy/");
    expect(withBase("/docs/privacy/", "/docs")).toBe("/docs/privacy/");
    expect(withBase("https://example.org/", "/docs")).toBe("https://example.org/");
    expect(withBase("//cdn.example.org/x", "/docs")).toBe("//cdn.example.org/x");
    expect(withBase("#top", "/docs")).toBe("#top");
    expect(withBase("/privacy/", "/")).toBe("/privacy/");
  });

  it("form help, consent texts, the thank-you, downloads and redirects get the base", () => {
    const parts = renderForm(form(), "contact", { base: "/docs/", endpoint: "https://c.example/f" });
    const html = parts.start + parts.middle + parts.successDefault;

    expect(html).toContain('<a href="/docs/privacy/">privacy policy</a>');
    expect(html).toContain('<a href="/docs/terms/">terms</a>');
    expect(html).toContain('<a href="https://example.org/s" rel="noopener">the standard</a>');
    expect(html).toContain('<a href="/docs/guide/">guide</a>');
    expect(html).toContain('<a href="/docs/files/brochure.pdf" download>Brochure</a>');
    expect(parts.config.afterSubmit).toContainEqual({ type: "redirect", url: "/docs/thanks/" });
    // Without a base nothing changes.
    expect(renderForm(form(), "contact", { endpoint: "https://c.example/f" }).middle).toContain('<a href="/privacy/">privacy policy</a>');
  });

  it("the consent banner's policyUrl and its text's links get the base too", () => {
    const html = renderBanner({ mode: "banner", banner: { policyUrl: "/privacy/", text: "See [cookies](/cookies/)." } }, ["analytics"], { base: "/docs" });

    expect(html).toContain('<a href="/docs/privacy/">Privacy policy</a>');
    expect(html).toContain('<a href="/docs/cookies/">cookies</a>');
    const plan = planPage({ consent: { mode: "banner", banner: { policyUrl: "/privacy/" } }, scripts: [{ id: "ga", kind: "custom", enabled: true, consent: "analytics", settings: { src: "https://cdn.example.com/a.js" } }] }, { path: "/" });

    expect(injectPlan("<html><head></head><body></body></html>", plan, { consent: { mode: "banner", banner: { policyUrl: "/privacy/" } }, base: "/docs" })).toContain('href="/docs/privacy/"');
  });
});

describe("c/i — UTM memory under a consent banner with no scripts", () => {
  const config: ScriptsConfig = { consent: { mode: "banner" }, scripts: [] };

  it("offers Marketing in the banner, so consent can be given (before, the banner never appeared)", () => {
    expect(planPage(config, { path: "/" })).toMatchObject({ banner: false, runtime: false, categories: [] });
    expect(planPage(config, { path: "/", utm: true })).toMatchObject({ banner: true, runtime: true, categories: ["marketing"] });
    // With no consent step the memory is kept straight away, as before, and no banner is added.
    expect(planPage({ consent: { mode: "none" }, scripts: [] }, { path: "/", utm: true })).toMatchObject({ banner: false, categories: ["marketing"] });
  });

  it("remembers the landing once the visitor accepts Marketing in that banner, not before", () => {
    const win = new Window({ url: "https://www.example.com/?utm_source=news&utm_campaign=spring", settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });
    const plan = planPage(config, { path: "/", utm: true });
    const html = injectPlan('<!doctype html><html><head><meta charset="utf-8"></head><body><main></main></body></html>', plan, { consent: config.consent });

    win.document.write(html);
    const run = new Function("window", "document", "location", "localStorage", "CustomEvent", "setTimeout", "URL", `return (${RUNTIME})`)(win, win.document, win.location, win.localStorage, win.CustomEvent, win.setTimeout.bind(win), URL);

    run(plan.config);
    (win as any).galleyScripts.run("body-end");
    const banner = win.document.querySelector("[data-galley-consent]") as unknown as HTMLElement;

    expect(banner.hidden).toBe(false);
    expect(win.document.querySelector('input[data-category="marketing"]')).not.toBeNull();
    expect(win.localStorage.getItem("galley:attribution")).toBeNull();
    (win.document.querySelector("[data-galley-consent-accept]") as unknown as HTMLButtonElement).click();
    expect(JSON.parse(win.localStorage.getItem("galley:attribution")!).first).toMatchObject({ utm_source: "news", utm_campaign: "spring" });
    void win.happyDOM.close();
  });
});

describe("d — the thank-you's focus", () => {
  it("no longer removes the outline; a weightless :focus-visible ring the site's own focus style overrides", () => {
    expect(FORMS_CSS).not.toMatch(/\.galley-form__success:focus\s*\{\s*outline:\s*none/);
    expect(FORMS_CSS).toMatch(/:where\(\.galley-form__success:focus-visible\)\s*\{\s*outline: 2px solid var\(--galley-field-focus, Highlight\);/);
    expect(FORMS_CSS).toContain("WCAG 2.4.7");
    // Still focusable by script only, so a screen reader is taken to it.
    expect(renderForm(form(), "contact", { endpoint: "https://c.example/f" }).successStart).toContain('tabindex="-1"');
  });
});

describe("e — a script kind this kit doesn't know (a plugin's)", () => {
  const entry = { id: "chat", kind: "acme-chat", enabled: true, settings: { src: "https://cdn.example.com/chat.js", inline: "acmeChat.init()", attributes: { defer: true } } };

  it("is written from settings.src / settings.inline like custom, with the same consent and placement rules", () => {
    expect(scriptsSchema.safeParse({ scripts: [entry] }).success).toBe(true);
    expect(buildSnippet(entry)).toEqual(buildSnippet({ ...entry, kind: "custom" }));
    const [resolved] = resolveEntries({ scripts: [entry] });

    expect(resolved).toMatchObject({ consent: "marketing", placement: "body-end", name: "acme-chat" });
    const plan = planPage({ consent: { mode: "banner" }, scripts: [entry] }, { path: "/" });

    expect(plan.banner).toBe(true);
  });

  it("without either, says what to add instead of failing obscurely", () => {
    const parsed = scriptsSchema.safeParse({ scripts: [{ ...entry, settings: {} }] });

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toBe("A “acme-chat” script is written from its own settings.src (the script's address) or settings.inline (its code); give it one of them.");
    expect(scriptsSchema.safeParse({ scripts: [{ ...entry, settings: { src: "https://x.example/a.js", attributes: { onload: "x" } } }] }).success).toBe(false);
  });
});

describe("f/j — the documented preview signals", () => {
  const config: ScriptsConfig = {
    consent: { mode: "banner" },
    scripts: [
      { id: "ga", kind: "custom", enabled: true, consent: "analytics", settings: { src: "https://cdn.example.com/ga.js" } },
      { id: "chat", kind: "custom", enabled: true, consent: "necessary", inPreview: true, settings: { src: "https://cdn.example.com/chat.js" } },
    ],
  };
  const stored = JSON.stringify({ v: 1, choice: { analytics: true, marketing: true, preferences: true } });

  function open(signal: { name?: string; flag?: boolean; attribute?: boolean }) {
    const win = new Window({ url: "https://www.example.com/", settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });

    if (signal.name) win.name = signal.name;
    if (signal.flag) (win as any).__galleyPreview = true;
    win.localStorage.setItem("galley:consent", stored);
    const plan = planPage(config, { path: "/", host: "www.example.com" });

    win.document.write(injectPlan(`<!doctype html><html${signal.attribute ? ' data-galley-preview data-galley-endpoint="http://127.0.0.1:4400/f/site_1"' : ""}><head><meta charset="utf-8"></head><body></body></html>`, plan, { consent: config.consent }));
    const run = new Function("window", "document", "location", "localStorage", "CustomEvent", "setTimeout", "URL", `return (${RUNTIME})`)(win, win.document, win.location, win.localStorage, win.CustomEvent, win.setTimeout.bind(win), URL);

    run(plan.config);
    for (const where of ["head", "body-start", "body-end"]) (win as any).galleyScripts.run(where);
    const loaded = [...win.document.querySelectorAll("script[src]")].map((script) => script.getAttribute("src"));
    const banner = win.document.querySelector("[data-galley-consent]") as unknown as HTMLElement;
    const result = { preview: (win as any).galleyConsent.preview, loaded, bannerHidden: banner.hidden };

    void win.happyDOM.close();
    return result;
  }

  it("each one keeps third-party scripts inert (except inPreview) — and that is all that differs", () => {
    for (const signal of [{ name: "galley-preview" }, { name: "galley-preview-live" }, { name: "galley-preview-proof" }, { name: "galley-preview-proof-live" }, { flag: true }, { attribute: true }]) {
      expect(open(signal), JSON.stringify(signal)).toEqual({ preview: true, loaded: ["https://cdn.example.com/chat.js"], bannerHidden: true });
    }
    expect(open({})).toEqual({ preview: false, loaded: ["https://cdn.example.com/ga.js", "https://cdn.example.com/chat.js"], bannerHidden: true });
  });

  describe("forms in the preview send where <html data-galley-endpoint> says, as documented", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      document.documentElement.removeAttribute("data-galley-endpoint");
      document.body.innerHTML = "";
    });

    async function send(destination: { provider: "galley"; settings: Record<string, string> }, siteWide: string) {
      const calls: string[] = [];

      vi.stubGlobal("fetch", vi.fn(async (url: string) => (calls.push(url), new Response(JSON.stringify({ ok: true, id: "s1" }), { status: 200 }))));
      document.body.innerHTML = `<div class="galley-form"><form></form><script type="application/json" data-galley-form-config>${JSON.stringify({ endpoint: siteWide })}</script></div>`;
      const formEl = document.querySelector("form")!;

      await galley({}, destination, { formId: "contact", form: formEl, fields: [], answers: {}, items: [], page: { url: location.href, title: "", referrer: "" }, meta: { elapsedMs: 0, honeypot: "", locale: "en", kit: "0.1.0" }, messages: {} });
      return calls[0];
    }

    it("the destination's own endpoint, then the page's, then the site-wide address", async () => {
      expect(await send({ provider: "galley", settings: {} }, "https://cms.example.com/f/site_1")).toBe("https://cms.example.com/f/site_1");
      document.documentElement.setAttribute("data-galley-endpoint", "http://127.0.0.1:4400/f/site_1");
      expect(await send({ provider: "galley", settings: {} }, "https://cms.example.com/f/site_1")).toBe("http://127.0.0.1:4400/f/site_1");
      expect(await send({ provider: "galley", settings: {} }, "")).toBe("http://127.0.0.1:4400/f/site_1");
      expect(await send({ provider: "galley", settings: { endpoint: "https://other.example/f/x" } }, "https://cms.example.com/f/site_1")).toBe("https://other.example/f/x");
    });
  });
});

describe("g — buttons on a site that sets none of the kit's custom properties", () => {
  /** Every declaration of a rule whose selector matches, from minified or formatted CSS. */
  const rules = (css: string, selector: RegExp) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => selector.test(match[1]!)).map((match) => match[2]!);

  it("fall back to CanvasText on Canvas — never currentColor, which on a button is its own text colour", () => {
    const form = rules(FORMS_CSS, /\.galley-form__submit:not/).join(";");
    const banner = rules(BANNER_CSS, /^\.galley-consent__button$/).join(";");

    for (const css of [form, banner]) {
      expect(css).toMatch(/background:\s*var\(--galley-button-bg,\s*CanvasText\)/);
      expect(css).toMatch(/color:\s*var\(--galley-button-text,\s*Canvas\)/);
      expect(css).not.toMatch(/background:\s*var\(--galley-button-bg,\s*currentColor\)/);
    }
  });
});
