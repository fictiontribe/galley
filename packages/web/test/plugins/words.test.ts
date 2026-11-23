import { describe, expect, it } from "vitest";
import type { PluginContributions, PluginInfo, PluginSettingInfo } from "@galley/core/types";
import { addCommand, contributionLines, conflictSentence, missingSettings, plainProblem, secretLine, settingProblem, sortPlugins, sourceWords } from "@/features/plugins/words";

const none = (): PluginContributions => ({ adapters: [], imageProviders: [], videoProviders: [], formProviders: [], scriptIntegrations: [], importers: [], deployTargets: [], tools: [], hooks: [] });

function plugin(over: Partial<PluginInfo> = {}): PluginInfo {
  return { name: "galley-plugin-x", displayName: "X", version: "1.0.0", source: "user", enabled: true, active: true, canDisable: true, contributes: none(), problems: [], warnings: [], settings: [], log: [], ...over };
}

function setting(over: Partial<PluginSettingInfo> = {}): PluginSettingInfo {
  return { key: "apiKey", label: "API key", secret: true, required: true, configured: false, source: null, ...over };
}

describe("where a plugin came from", () => {
  it("says it in plain words, and says server in hosted mode", () => {
    expect(sourceWords("builtin", false)).toBe("Comes with the app");
    expect(sourceWords("user", false)).toBe("Added on this computer");
    expect(sourceWords("user", true)).toBe("Added on this server");
    expect(sourceWords("site", false)).toBe("Named by this site");
  });
});

describe("what a plugin adds", () => {
  it("counts each kind in words people know and links it where it shows up", () => {
    const lines = contributionLines(
      { ...none(), imageProviders: ["OpenRouter", "Pictures"], formProviders: ["Mailchimp"], importers: ["WordPress"], tools: [{ name: "a", title: "A", mode: "content", readOnly: true }, { name: "b", title: "B", mode: "content", readOnly: true }, { name: "c", title: "C", mode: "build", readOnly: false }] },
      "site-1",
    );
    expect(lines.map((line) => line.text)).toEqual(["2 image generators: OpenRouter and Pictures", "1 form destination: Mailchimp", "1 importer: WordPress", "3 assistant tools"]);
    expect(lines.find((line) => line.kind === "imageProviders")?.to).toBe("/settings#images");
    expect(lines.find((line) => line.kind === "formProviders")?.to).toBe("/sites/site-1/forms");
    expect(lines.find((line) => line.kind === "tools")?.to).toBe("/sites/site-1/edit");
    // An importer has no screen: it's a command.
    expect(lines.find((line) => line.kind === "importers")?.to).toBeUndefined();
  });

  it("leaves site screens unlinked when no site is at hand, and shortens long lists", () => {
    const lines = contributionLines({ ...none(), scriptIntegrations: ["GTM", "GA4", "Meta Pixel", "Hotjar", "Clarity"], hooks: ["afterPublish"] }, null);
    expect(lines[0]).toEqual({ kind: "scriptIntegrations", text: "5 scripts: GTM, GA4, Meta Pixel and 2 more" });
    expect(lines[1]?.text).toBe("A step that runs after each publish");
  });
});

describe("problems in plain sentences", () => {
  it("drops the package lead and moves the technical part behind details", () => {
    const result = plainProblem("galley-plugin-x: it was written for plugin API version 2, and this engine speaks version 1. Update the plugin.", plugin());
    expect(result.plain).toBe("It was written for plugin API version 2, and this engine speaks version 1. Update the plugin.");
    expect(result.detail).toContain("galley-plugin-x:");
  });

  it("takes an error message out of the sentence", () => {
    const result = plainProblem("It couldn't start (TypeError: fetch is not a function (at setup)), so it is turned off until the app restarts.", plugin());
    expect(result.plain).toBe("It couldn't start, so it is turned off until the app restarts.");
    expect(result.detail).toContain("TypeError");
  });

  it("keeps a sentence that is already plain without a disclosure", () => {
    expect(plainProblem("It is turned off until that is fixed.", plugin())).toEqual({ plain: "It is turned off until that is fixed.", detail: null });
  });

  it("names who won a conflict", () => {
    const names: Record<string, string> = { a: "Harbour tools", b: "Example plugin" };
    expect(conflictSentence({ kind: "scriptIntegration", id: "fathom", used: "a", ignored: ["b"] }, (name) => names[name] ?? name)).toBe("Example plugin and Harbour tools both add the script “fathom”. The one from Harbour tools is used.");
  });
});

describe("settings", () => {
  it("shows a secret only as set and its last four characters", () => {
    expect(secretLine(setting())).toBe("Not set — needed");
    expect(secretLine(setting({ configured: true, source: "stored", hint: "4f2a" }))).toBe("Set · ends in 4f2a");
    expect(secretLine(setting({ configured: true, source: "env", hint: "9c1d" }))).toBe("Set by this computer’s environment · ends in 9c1d");
  });

  it("checks a value against the declared pattern before it is sent", () => {
    const key = setting({ pattern: "^sk-or-[A-Za-z0-9_-]{16,}$", placeholder: "sk-or-v1-…" });
    expect(settingProblem(key, "nope")).toBe("That doesn’t look like an API key — it looks like sk-or-v1-…");
    expect(settingProblem(key, "sk-or-v1-0123456789abcdef")).toBeNull();
    expect(settingProblem(key, "")).toBe("API key is needed.");
    expect(settingProblem(setting({ required: false, pattern: "(" }), "anything")).toBeNull();
  });

  it("lists what an enabled plugin still needs", () => {
    expect(missingSettings(plugin({ settings: [setting(), setting({ key: "b", required: false })] })).map((item) => item.key)).toEqual(["apiKey"]);
  });
});

describe("the list and the command", () => {
  it("puts broken plugins first, then built-ins, then by name", () => {
    const sorted = sortPlugins([plugin({ name: "b", displayName: "B" }), plugin({ name: "core", displayName: "Core", source: "builtin" }), plugin({ name: "a", displayName: "A", problems: ["broken"] })]);
    expect(sorted.map((item) => item.name)).toEqual(["a", "core", "b"]);
  });

  it("writes the exact install command, quoting what the shell would split", () => {
    expect(addCommand("galley")).toBe("galley plugin add <name>");
    expect(addCommand("galley", "@scope/galley-plugin-x")).toBe("galley plugin add @scope/galley-plugin-x");
    expect(addCommand("galley", "./my plugin")).toBe("galley plugin add './my plugin'");
  });
});
