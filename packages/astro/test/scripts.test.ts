import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ScriptEntry, ScriptsConfig } from "../src/kit";
import { inScope, matchGlob } from "../src/shared/glob.js";
import { injectPlan, manifest, planPage, renderPlacement, resolveEntries, summarize } from "../src/scripts/plan.js";
import { RUNTIME } from "../src/scripts/runtime.gen.js";
import { buildSnippet, checkSettings, type ScriptPart } from "../src/scripts/snippets.js";
// @ts-ignore — a plain .mjs script
import { inlineRuntime, INLINE } from "../scripts/build-inline.mjs";
import { DOCUMENTED, IDS } from "./fixtures/vendor-snippets";

const entry = (kind: string, settings: Record<string, string | boolean>, extra: Partial<ScriptEntry> = {}): ScriptEntry => ({ id: kind.replace(/[^a-z0-9]/g, ""), kind, enabled: true, settings, ...extra });

/** A snippet's parts written back as the plain HTML a vendor documents. */
function asHtml(parts: ScriptPart[]): string {
  return parts
    .map((part) => {
      if (part.type === "noscript") return `<noscript>${part.html}</noscript>`;
      const attrs = Object.entries(part.attrs ?? {})
        .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${value}"`))
        .join("");

      return part.src ? `<script${attrs} src="${part.src}"></script>` : `<script${attrs}>${part.code}</script>`;
    })
    .join("");
}
/** Whitespace is the only difference allowed (vendors indent differently in different places). */
const squash = (html: string) => html.replace(/\s+/g, "").replace(/<scripttype="text\/javascript">/g, "<script>");

describe("snippets: each written from the vendor's documented code", () => {
  const cases: Array<[string, ScriptEntry]> = [
    ["gtm", entry("gtm", { containerId: IDS.gtm })],
    ["ga4", entry("ga4", { measurementId: IDS.ga4 })],
    ["meta-pixel", entry("meta-pixel", { pixelId: IDS.pixel })],
    ["linkedin-insight", entry("linkedin-insight", { partnerId: IDS.linkedin })],
    ["hubspot", entry("hubspot", { portalId: IDS.hubspot })],
    ["marketo-munchkin", entry("marketo-munchkin", { munchkinId: IDS.munchkin })],
    ["plausible", entry("plausible", { scriptId: IDS.plausible })],
    ["plausible-legacy", entry("plausible", { domain: "example.com" })],
    ["segment", entry("segment", { writeKey: IDS.segment })],
    ["hotjar", entry("hotjar", { siteId: IDS.hotjar })],
    ["clarity", entry("clarity", { projectId: IDS.clarity })],
    ["intercom", entry("intercom", { appId: IDS.intercom })],
  ];

  for (const [name, item] of cases) {
    it(name, () => {
      const parts = buildSnippet(item);
      const documented = DOCUMENTED[name]!;
      const ours = asHtml(parts);

      // hubspot's attributes are on a src script; the rest are compared as text.
      expect(squash(ours)).toBe(squash(documented));
    });
  }

  it("GTM's <noscript> frame only on request, placed after <body>", () => {
    expect(buildSnippet(entry("gtm", { containerId: IDS.gtm })).some((part) => part.type === "noscript")).toBe(false);
    const parts = buildSnippet(entry("gtm", { containerId: IDS.gtm, noscript: "true" }));
    const frame = parts.find((part) => part.type === "noscript")!;

    expect(frame.placement).toBe("body-start");
    expect(squash(`<noscript>${frame.html}</noscript>`)).toBe(squash(DOCUMENTED["gtm-noscript"]!));
  });

  it("regional hosts", () => {
    expect(buildSnippet(entry("hubspot", { portalId: IDS.hubspot, region: "eu1" }))[0]!.src).toBe("//js-eu1.hs-scripts.com/12345678.js");
    expect(buildSnippet(entry("intercom", { appId: IDS.intercom, region: "eu" }))[0]!.code).toContain('api_base: "https://api-iam.eu.intercom.io"');
    expect(buildSnippet(entry("plausible", { scriptId: IDS.plausible, host: "https://stats.example.com/" }))[0]!.src).toBe("https://stats.example.com/js/pa-AbCdEf123456.js");
  });

  it("custom: an external file with its attributes, or inline code", () => {
    expect(buildSnippet(entry("custom", { src: "https://cdn.example.com/w.js" }, { settings: { src: "https://cdn.example.com/w.js", attributes: { "data-key": "k1", defer: true } } }))).toEqual([
      { type: "script", src: "https://cdn.example.com/w.js", attrs: { "data-key": "k1", defer: true } },
    ]);
    expect(buildSnippet(entry("custom", { inline: "window.x = 1;" }))).toEqual([{ type: "script", code: "window.x = 1;", attrs: {} }]);
  });
});

describe("snippet ids are checked first: a wrong id is a plain build error", () => {
  const refuse: Array<[ScriptEntry, string]> = [
    [entry("gtm", { containerId: "GTM-12" }), "“gtm”: “GTM-12” doesn't look like a Google Tag Manager Container ID (it looks like GTM-XXXXXXX)."],
    [entry("ga4", { measurementId: "UA-1234-1" }), "“ga4”: “UA-1234-1” doesn't look like a Google Analytics 4 Measurement ID (it looks like G-XXXXXXXXXX)."],
    [entry("meta-pixel", { pixelId: "12ab" }), "“metapixel”: “12ab” doesn't look like a Meta Pixel Pixel ID (it looks like 123456789012345)."],
    [entry("marketo-munchkin", { munchkinId: "123ABC456" }), "“marketomunchkin”: “123ABC456” doesn't look like a Marketo Munchkin Munchkin ID (it looks like 123-ABC-456)."],
    [entry("clarity", {}), "“clarity” (Microsoft Clarity) needs its Project ID in settings.projectId, like abcdefghij."],
    [entry("custom", { src: "http://insecure.example.com/x.js" }), "“custom”: “http://insecure.example.com/x.js” doesn't look like a Custom script Script address (it looks like https://cdn.example.com/widget.js)."],
    [{ id: "x", kind: "mystery", enabled: true, settings: {} }, "“x” is a “mystery” script, which this version of the kit can't write by itself. Give it settings.src (the script's address) or settings.inline (its code)."],
  ];

  for (const [item, message] of refuse) {
    it(item.kind, () => expect(() => checkSettings(item)).toThrow(message));
  }

  it("no snippet can carry anything but its id", () => {
    expect(() => buildSnippet(entry("gtm", { containerId: "GTM-AB12');alert(1);//" }))).toThrow();
    expect(() => buildSnippet(entry("hotjar", { siteId: "1;alert(1)" }))).toThrow();
  });
});

describe("include / exclude globs", () => {
  it("matches page paths", () => {
    expect(matchGlob("/", "/")).toBe(true);
    expect(matchGlob("/about/", "/")).toBe(false);
    expect(matchGlob("/pricing/", "/pricing/")).toBe(true);
    expect(matchGlob("/pricing", "/pricing/")).toBe(true);
    expect(matchGlob("/pricing/teams/", "/pricing/")).toBe(false);
    expect(matchGlob("/blog/", "/blog/**")).toBe(true);
    expect(matchGlob("/blog/a/b/", "/blog/**")).toBe(true);
    expect(matchGlob("/blog/a/", "/blog/*")).toBe(true);
    expect(matchGlob("/blog/a/b/", "/blog/*")).toBe(false);
    expect(matchGlob("/de/thanks/", "*/thanks/")).toBe(true);
    expect(matchGlob("/blogs/", "/blog/**")).toBe(false);
    expect(matchGlob("/pricing/?plan=a", "/pricing/")).toBe(true);
  });

  it("include narrows, exclude wins", () => {
    expect(inScope("/x/", {})).toBe(true);
    expect(inScope("/x/", { include: ["/pricing/"] })).toBe(false);
    expect(inScope("/blog/a/", { include: ["/blog/**"], exclude: ["/blog/a/"] })).toBe(false);
  });
});

describe("a page's plan and its HTML", () => {
  const config: ScriptsConfig = {
    consent: { mode: "banner", googleConsentMode: true },
    scripts: [
      { id: "gtm", kind: "gtm", enabled: true, settings: { containerId: IDS.gtm, noscript: "true" } },
      { id: "ga", kind: "ga4", enabled: true, settings: { measurementId: IDS.ga4 }, load: "idle" },
      { id: "chat", kind: "custom", enabled: true, settings: { src: "https://cdn.example.com/chat.js" }, include: ["/pricing/"], consent: "preferences", inPreview: true },
      { id: "off", kind: "clarity", enabled: false, settings: {} },
    ],
  };
  const page = (path: string, dev = false) => planPage(config, { path, dev, host: "www.example.com" });

  it("carries only in-scope, enabled entries; in dev only those marked inPreview", () => {
    expect(page("/").entries.map((item) => item.entry.id)).toEqual(["gtm", "ga"]);
    expect(page("/pricing/").entries.map((item) => item.entry.id)).toEqual(["gtm", "ga", "chat"]);
    expect(page("/", true).entries).toEqual([]);
    expect(page("/pricing/", true).entries.map((item) => item.entry.id)).toEqual(["chat"]);
  });

  it("writes every snippet inert, with its consent, load moment and placement", () => {
    const head = renderPlacement(page("/pricing/"), "head", { consent: config.consent });

    expect(head.startsWith(`<script data-galley-scripts="head">(${RUNTIME})({"mode":"banner","defaults":[],"gcm":true,"host":"www.example.com","utm":false})</script><style data-galley-consent-style>`)).toBe(true);
    expect(head).toContain(`<script type="text/plain" data-galley-script="gtm" data-part="0" data-placement="head" data-consent="analytics" data-load="eager" data-src="https://www.googletagmanager.com/gtm.js?id=${IDS.gtm}" data-attrs="{&quot;async&quot;:true}"></script>`);
    expect(head).toContain('data-galley-script="ga" data-part="1" data-placement="head" data-consent="analytics" data-load="idle">');
    expect(head.endsWith('<script data-galley-scripts="head">galleyScripts.run("head")</script>')).toBe(true);
    const end = renderPlacement(page("/pricing/"), "body-end", { consent: config.consent });

    expect(end).toContain('data-galley-script="chat" data-part="0" data-placement="body-end" data-consent="preferences" data-load="eager" data-preview data-src="https://cdn.example.com/chat.js"');
    expect(end).toContain('<section class="galley-consent" data-galley-consent');
    expect(end).toContain('<input type="checkbox" id="galley-consent-analytics" data-category="analytics">');
    expect(end).toContain('<input type="checkbox" id="galley-consent-preferences" data-category="preferences">');
    expect(end).not.toContain('data-category="marketing"');
  });

  it("writes a <noscript> fallback only for a script that needs no consent", () => {
    expect(renderPlacement(page("/"), "body-start")).not.toContain("<noscript");
    const open = planPage({ ...config, consent: { mode: "none" } }, { path: "/" });

    expect(renderPlacement(open, "body-start")).toContain(`<noscript data-galley-script="gtm"><iframe src="https://www.googletagmanager.com/ns.html?id=${IDS.gtm}"`);
  });

  it("keeps `</script>` in custom code from ending the block early", () => {
    const plan = planPage({ scripts: [{ id: "c", kind: "custom", enabled: true, settings: { inline: 'document.write("</script><!--")' } }] }, { path: "/" });

    expect(renderPlacement(plan, "body-end")).toContain('document.write("<\\/script><\\!--")');
  });

  it("puts each placement where it belongs, after <meta charset>, and leaves what a layout placed itself", () => {
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>T</title></head><body class="x"><main>Hi</main></body></html>';
    const out = injectPlan(html, page("/"), { consent: config.consent });

    expect(out.indexOf('<meta charset="utf-8"><script data-galley-scripts="head">')).toBeGreaterThan(0);
    expect(out.indexOf("<title>")).toBeGreaterThan(out.indexOf("galleyScripts.run(\"head\")"));
    expect(out).toMatch(/<body class="x"><main>/);
    expect(out).toMatch(/<\/section><script data-galley-scripts="body-end">galleyScripts\.run\("body-end"\)<\/script><\/body>/);
    const placed = injectPlan(html.replace("</title>", '</title><script data-galley-scripts="head">mine</script>'), page("/"), { consent: config.consent });

    expect(placed.match(/data-galley-scripts="head"/g)).toHaveLength(1);
    const ownBanner = injectPlan(html.replace("<main>", '<section class="galley-consent" data-galley-consent hidden></section><main>'), page("/"), { consent: config.consent });

    expect(ownBanner.match(/data-galley-consent[\s>]/g)).toHaveLength(1);
  });

  it("adds nothing at all to a page with nothing to manage", () => {
    const html = "<html><head></head><body></body></html>";

    expect(injectPlan(html, planPage(null, { path: "/" }))).toBe(html);
    expect(injectPlan(html, planPage({ scripts: [] }, { path: "/" }))).toBe(html);
    expect(injectPlan(html, planPage(config, { path: "/", dev: true }))).toContain("data-galley-consent");
  });

  it("summarises the site for the build log", () => {
    expect(summarize(config)).toEqual([
      "scripts: 3 of 4 enabled · the built-in consent banner · Google Consent Mode v2",
      `  ✓ gtm · Google Tag Manager ${IDS.gtm} · head, eager · after analytics consent · every page`,
      `  ✓ ga · Google Analytics 4 ${IDS.ga4} · head, idle · after analytics consent · every page`,
      "  ✓ chat · Custom script · body-end, eager · after preferences consent · only /pricing/",
      "  – off · off",
    ]);
  });

  it("answers the dev manifest for a page", () => {
    const result = manifest(config, "/", "src/data/scripts.json");

    expect(result.scripts.map((item) => [item.id, item.loadsOnPage, item.reason])).toEqual([
      ["gtm", true, "loads after analytics consent"],
      ["ga", true, "loads after analytics consent"],
      ["chat", false, "not on this page (include/exclude)"],
      ["off", false, "turned off"],
    ]);
    expect(manifest(null, "/", "src/data/scripts.json")).toMatchObject({ exists: false, scripts: [] });
    expect(resolveEntries(config).map((item) => item.consent)).toEqual(["analytics", "analytics", "preferences"]);
  });
});

describe("the inline runtime", () => {
  it("is the minified runtime.js (run node scripts/build-inline.mjs after changing it)", async () => {
    expect(readFileSync(new URL("../src/scripts/runtime.gen.js", import.meta.url), "utf8")).toBe(await inlineRuntime());
    expect(() => new Function(`return ${RUNTIME}`)).not.toThrow();
    expect(RUNTIME).not.toMatch(/\beval\(|new Function/);
  });

  it("so is the email-link dialog's (src/mailto/runtime.gen.js)", async () => {
    expect(readFileSync(new URL("../src/mailto/runtime.gen.js", import.meta.url), "utf8")).toBe(await inlineRuntime(INLINE[1]));
  });
});
