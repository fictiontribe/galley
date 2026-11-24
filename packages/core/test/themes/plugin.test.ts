/**
 * The `themes` contribution: a plugin's themes are checked like any other.
 * Refused is a problem (the plugin doesn't load), adjusted is a warning, and
 * the registry lists the checked theme, from installed plugins only.
 */
import { describe, expect, it } from "vitest";
import { createFileSecretStore, createSettingsService } from "../../src/ai/index";
import { createPluginRegistry, createPluginSettingsStore, definePlugin, PLUGIN_API_VERSION, validatePlugin } from "../../src/plugins";
import { QUIET } from "../../src/themes";
import { tempDir } from "../site/helpers";
import { FOG, HARBOUR } from "./fixtures";

function registry() {
  const home = tempDir("plugin-themes-");
  const secrets = createFileSecretStore(home);
  const settings = createSettingsService({ home, env: {}, secretStore: secrets });
  return createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env: {}, secrets, setBuiltinSecret: (name, value) => settings.setSecret(name, value) }), log: () => undefined });
}

describe("a plugin's themes", () => {
  it("are validated by the app's check: refused is a problem, adjusted a warning", () => {
    const refused = validatePlugin({ name: "galley-plugin-grey", apiVersion: 1, themes: [{ ...QUIET, id: "grey", name: "Grey", light: { ...QUIET.light, pencil: "#808080" } }] });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.problems.join(" ")).toMatch(/themes\[0\] isn't a theme the app can use: Your pencil color/);
    const css = validatePlugin({ name: "galley-plugin-css", apiVersion: 1, themes: [{ ...QUIET, id: "css", name: "Css", css: "body{}" }] });
    expect(!css.ok && css.problems.join(" ")).toMatch(/themes\[0\] isn't a theme/);
    const adjusted = validatePlugin({ name: "galley-plugin-fog", apiVersion: 1, themes: [FOG] });
    expect(adjusted.ok).toBe(true);
    expect(adjusted.warnings.join(" ")).toMatch(/themes\[0\] \(fog\) is shown with 3 colors adjusted/);
    const twice = validatePlugin({ name: "galley-plugin-two", apiVersion: 1, themes: [HARBOUR, HARBOUR] });
    expect(!twice.ok && twice.problems.join(" ")).toMatch(/harbour/);
  });

  it("are listed checked, from installed plugins, and never from a site's own", () => {
    const plugins = registry();
    plugins.register(definePlugin({ name: "galley-plugin-fog", apiVersion: PLUGIN_API_VERSION, themes: [FOG] }), { source: "user" });
    plugins.register(definePlugin({ name: "galley-plugin-site", apiVersion: PLUGIN_API_VERSION, themes: [HARBOUR] }), { source: "site", siteRoot: "/tmp/site" });
    const themes = plugins.themes();
    expect(themes.map((entry) => `${entry.plugin}:${entry.theme.id}`)).toEqual(["galley-plugin-fog:fog"]);
    expect(themes[0]!.theme.light.paper).not.toBe(FOG.light.paper);
  });
});
