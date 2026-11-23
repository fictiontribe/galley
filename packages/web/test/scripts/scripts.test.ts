import { describe, expect, it } from "vitest";
import type { ScriptEntry, ScriptsConfig } from "@galley/core/kit";
import { SCRIPT_INTEGRATIONS } from "@galley/core/kit-catalog";
import { scriptWarnings } from "@/features/scripts/logic/duplicates";
import { consentOf, newScript, primarySetting, scriptName } from "@/features/scripts/logic/entries";
import { loadsAt, needsAgreement } from "@/features/scripts/logic/loads";
import { describePages, matchesPattern, normalizePath, pageVerdict, patternToRegExp, scopeOf } from "@/features/scripts/logic/match";

const integration = (kind: string) => SCRIPT_INTEGRATIONS.find((item) => item.kind === kind)!;
const script = (patch: Partial<ScriptEntry> & Pick<ScriptEntry, "id" | "kind">): ScriptEntry => ({ enabled: true, settings: {}, ...patch });

describe("page patterns", () => {
  it("normalises addresses to a path", () => {
    expect(normalizePath("https://site.test/Pricing/?a=1#x")).toBe("/Pricing");
    expect(normalizePath("pricing//teams/")).toBe("/pricing/teams");
    expect(normalizePath("/")).toBe("/");
  });
  it("keeps * inside one part of the address", () => {
    expect(matchesPattern("/pricing/*", "/pricing/teams/")).toBe(true);
    expect(matchesPattern("/pricing/*", "/pricing/teams/annual/")).toBe(false);
    expect(matchesPattern("/pricing/*", "/pricing/")).toBe(false);
  });
  it("lets ** cross parts and match the folder itself", () => {
    expect(matchesPattern("/docs/**", "/docs/")).toBe(true);
    expect(matchesPattern("/docs/**", "/docs/a/b/c")).toBe(true);
    expect(matchesPattern("/docs/**/setup", "/docs/setup")).toBe(true);
    expect(matchesPattern("/docs/**/setup", "/docs/a/b/setup/")).toBe(true);
    expect(matchesPattern("/**", "/")).toBe(true);
  });
  it("ignores trailing slashes, supports ?, and takes everything else literally (as the runtime does)", () => {
    expect(matchesPattern("/about/", "/about")).toBe(true);
    expect(matchesPattern("blog/202?/*", "/blog/2026/notes")).toBe(true);
    expect(matchesPattern("/{pricing,plans}/", "/plans/")).toBe(false);
    expect(patternToRegExp("/a.b/").test("/axb")).toBe(false);
    expect(matchesPattern("*/thanks/", "/contact/thanks/")).toBe(true);
  });
  it("treats an empty pattern as the home page", () => {
    expect(matchesPattern("", "/")).toBe(true);
    expect(matchesPattern("", "/about/")).toBe(false);
    expect(pageVerdict({ include: [""] }, "/about/")).toEqual({ loads: false });
  });
  it("decides by exclude first, then include", () => {
    expect(pageVerdict({}, "/x/")).toEqual({ loads: true });
    expect(pageVerdict({ include: ["/pricing/*"] }, "/about/")).toEqual({ loads: false });
    expect(pageVerdict({ include: ["/pricing/*"] }, "/pricing/teams/")).toEqual({ loads: true, because: { list: "include", pattern: "/pricing/*" } });
    expect(pageVerdict({ exclude: ["/admin/**"] }, "/admin/users")).toEqual({ loads: false, because: { list: "exclude", pattern: "/admin/**" } });
  });
  it("reads the rules in words", () => {
    expect(scopeOf({})).toBe("everywhere");
    expect(scopeOf({ include: [] })).toBe("everywhere");
    expect(describePages({ include: ["/pricing/*"] })).toBe("Only /pricing/*");
    expect(describePages({ exclude: ["/admin/**"] })).toBe("Every page except /admin/**");
  });
});

describe("new scripts", () => {
  it("takes the catalogue's placement and consent and a sensible loading time", () => {
    expect(newScript(integration("ga4"), { measurementId: " G-ABC123 " }, [])).toEqual({
      id: "ga4",
      kind: "ga4",
      enabled: true,
      settings: { measurementId: "G-ABC123" },
      placement: "head",
      load: "eager",
      consent: "analytics",
    });
    expect(newScript(integration("intercom"), { appId: "abc123" }, []).load).toBe("interaction");
    expect(newScript(integration("ga4"), {}, ["ga4", "ga4-2"]).id).toBe("ga4-3");
  });
  it("names scripts and reads their identifying setting", () => {
    expect(scriptName({ kind: "gtm" })).toBe("Google Tag Manager");
    expect(scriptName({ kind: "gtm", label: "Main container" })).toBe("Main container");
    expect(primarySetting({ kind: "gtm", settings: { containerId: "GTM-ABCD12" } })).toBe("GTM-ABCD12");
    expect(primarySetting({ kind: "custom", settings: { inline: "x()" } })).toBeNull();
    expect(consentOf({ kind: "meta-pixel" })).toBe("marketing");
  });
});

describe("what loads where", () => {
  const config: ScriptsConfig = {
    scripts: [
      script({ id: "gtm", kind: "gtm", settings: { containerId: "GTM-ABCD12" }, consent: "necessary" }),
      script({ id: "ga4", kind: "ga4", settings: { measurementId: "G-ABC123" }, consent: "analytics", load: "idle" }),
      script({ id: "widget", kind: "custom", settings: { src: "https://cdn.example.com/w.js" }, include: ["/pricing/*"], consent: "marketing" }),
      script({ id: "off", kind: "hotjar", enabled: false }),
    ],
    consent: { mode: "banner", defaults: [] },
  };
  it("lists the scripts on a page in order, with what they wait for", () => {
    const home = loadsAt(config, "/");
    expect(home.loads.map((item) => item.id)).toEqual(["gtm", "ga4"]);
    expect(home.loads[1]?.waitsFor).toBe("Waits until the visitor allows analytics");
    expect(home.skipped.map((item) => item.reason)).toEqual(["Only on /pricing/*", "Switched off"]);
    expect(loadsAt(config, "/pricing/teams/").loads.map((item) => item.id)).toEqual(["gtm", "ga4", "widget"]);
  });
  it("leaves preview out unless asked", () => {
    expect(loadsAt(config, "/", { preview: true }).loads).toEqual([]);
  });
  it("knows when agreement is needed", () => {
    expect(needsAgreement("analytics", { mode: "none" })).toBe(false);
    expect(needsAgreement("analytics", { mode: "banner", defaults: ["analytics"] })).toBe(false);
    expect(needsAgreement("marketing", { mode: "external" })).toBe(true);
    expect(needsAgreement("necessary", { mode: "banner" })).toBe(false);
  });
});

describe("warnings", () => {
  it("flags the same tag twice and repeated names", () => {
    const warnings = scriptWarnings({
      scripts: [
        script({ id: "ga4", kind: "ga4", settings: { measurementId: "G-ABC123" } }),
        script({ id: "ga4", kind: "ga4", settings: { measurementId: "G-ABC123" } }),
      ],
      consent: { mode: "banner" },
    });
    expect(warnings.map((warning) => warning.id)).toEqual(["id-ga4", "tag-ga4\nG-ABC123"]);
    expect(warnings[1]?.text).toMatch(/installed 2 times with G-ABC123/);
  });
  it("notes Analytics next to Tag Manager", () => {
    const warnings = scriptWarnings({ scripts: [script({ id: "gtm", kind: "gtm" }), script({ id: "ga4", kind: "ga4" })], consent: { mode: "banner" } });
    expect(warnings).toMatchObject([{ id: "ga4-in-gtm", tone: "info" }]);
  });
  it("warns when tracking loads with consent off", () => {
    const warnings = scriptWarnings({ scripts: [script({ id: "pixel", kind: "meta-pixel" })], consent: { mode: "none" } });
    expect(warnings.map((warning) => warning.id)).toEqual(["no-consent"]);
    expect(scriptWarnings({ scripts: [script({ id: "p", kind: "plausible" })] })).toEqual([]);
  });
});
