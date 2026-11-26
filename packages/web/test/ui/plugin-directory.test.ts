/**
 * The plugin directory draws Install only for a package on INSTALLABLE_PACKAGES (empty today): Install fills in a
 * command that installs whatever npm has under the name, so a name that isn't Galley's on npm is never offered.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PluginDirectory } from "@/features/plugins/PluginDirectory";

describe("the plugin directory", () => {
  it("draws no Install button, and no npm name, for a plugin that isn't on the list", () => {
    const html = renderToStaticMarkup(h(PluginDirectory, { installed: [], onConfigureInstalled: () => {}, onInstallPackage: () => {}, onCreateWithAi: () => {} }));

    expect(html).not.toMatch(/>\s*Install\s*</);
    for (const name of ["@galley/plugin-openrouter", "@galley/plugin-shopify", "@galley/import-wordpress", "galley-plugin-example"]) expect(html).not.toContain(name);
    expect(html).toContain("Built in");
    expect(html).toContain("View source");
  });
});
