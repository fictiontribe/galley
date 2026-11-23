import { beforeEach, describe, expect, it } from "vitest";
import type { ScriptEntry } from "@galley/core/kit";
import { BUILTIN_PLUGIN, hasSnippet, inactiveKindLine, pluginFormProvider, pluginScriptEntry, pluginScriptIntegration, resolveSnippet, useCatalogStore, type CatalogScript } from "@/features/plugins/catalog";
import { providerInfo, providerName } from "@/features/forms/logic/providers";
import { integrationOf } from "@/features/scripts/logic/entries";

const fathom: CatalogScript = {
  kind: "fathom",
  name: "Fathom Analytics",
  description: "Privacy-first page analytics without cookies.",
  category: "analytics",
  defaultConsent: "necessary",
  defaultPlacement: "head",
  settings: [{ key: "siteId", label: "Site ID", required: true }],
  plugin: "galley-plugin-example",
  snippet: { src: "https://cdn.usefathom.com/script.js", attributes: { "data-site": "{{siteId}}", defer: "" } },
};

describe("the catalogue the pickers read", () => {
  beforeEach(() => {
    const builtin = useCatalogStore.getState();
    useCatalogStore.getState().set(
      {
        formProviders: [...builtin.formProviders.filter((provider) => provider.plugin === BUILTIN_PLUGIN), { id: "mailchimp", name: "Mailchimp", description: "Adds each person to an audience.", settings: [], canImportFields: false, plugin: "galley-plugin-mailchimp" }],
        scriptIntegrations: [...builtin.scriptIntegrations.filter((integration) => integration.plugin === BUILTIN_PLUGIN), fathom],
      },
      { "galley-plugin-mailchimp": "Mailchimp" },
    );
  });

  it("finds a plugin's destination and script by id, after the built-in ones", () => {
    expect(providerInfo("hubspot")?.name).toBe("HubSpot");
    expect(providerInfo("mailchimp")?.name).toBe("Mailchimp");
    expect(providerName("mailchimp")).toBe("Mailchimp");
    expect(pluginFormProvider("hubspot")).toBeNull();
    expect(integrationOf("fathom")?.name).toBe("Fathom Analytics");
    expect(pluginScriptIntegration("gtm")).toBeNull();
  });

  it("shows an id no active plugin offers for what it is, rather than breaking", () => {
    expect(providerInfo("tablebook")).toBeNull();
    expect(providerName("tablebook")).toBe("tablebook");
    expect(integrationOf("hotjar-pro")).toBeNull();
    expect(inactiveKindLine("hotjar-pro")).toBe("From a plugin that isn’t active: hotjar-pro");
  });
});

describe("adding a plugin's script", () => {
  it("fills the snippet in, escaped for where each value goes", () => {
    expect(resolveSnippet({ src: "https://x.example/s.js?id={{id}}", inline: "init('{{id}}')", attributes: { "data-id": "{{id}}" } }, { id: 'a&b"</script>' })).toEqual({
      src: "https://x.example/s.js?id=a%26b%22%3C%2Fscript%3E",
      inline: "init('a&b\\\"\\u003c/script\\u003e')",
      attributes: { "data-id": "a&b&quot;</script>" },
    });
  });

  it("writes it as a custom script the site's runtime can load, labelled and noted", () => {
    expect(hasSnippet(fathom)).toBe(true);
    const entry: ScriptEntry = { id: "fathom", kind: "fathom", enabled: true, settings: { siteId: "ABCDEFGH" }, placement: "head", load: "eager", consent: "necessary" };
    expect(pluginScriptEntry(entry, fathom as CatalogScript & { snippet: NonNullable<CatalogScript["snippet"]> }, "Example plugin")).toEqual({
      ...entry,
      kind: "custom",
      label: "Fathom Analytics",
      settings: { src: "https://cdn.usefathom.com/script.js", attributes: { "data-site": "ABCDEFGH", defer: "" } },
      note: "Added from the plugin Example plugin.",
    });
  });
});
