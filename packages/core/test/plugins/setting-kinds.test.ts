/**
 * Plugin settings that aren't text boxes: a toggle (saved as "on"/"off",
 * with the sentence that makes it read as a decision) and a select (one of
 * its options). Checked by the structural check, saved and read back through
 * the real settings store, and listed with what they switch on.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createFileSecretStore } from "../../src/ai/index";
import { createPluginRegistry, createPluginSettingsStore, definePlugin, PLUGIN_API_VERSION, validatePlugin } from "../../src/plugins/index";
import { disposeAll, tempDir } from "../site/helpers";

afterAll(() => disposeAll());

const plugin = definePlugin({
  name: "galley-plugin-kinds",
  apiVersion: PLUGIN_API_VERSION,
  settings: [
    { key: "allowEdits", type: "toggle", label: "Let the assistant edit the store", consequence: "Its edits go live in the store at once." },
    { key: "size", type: "select", label: "Picture size", options: [{ value: "small", label: "Small" }, { value: "large", label: "Large" }], default: "small" },
    { key: "note", label: "Note" },
  ],
  tools: [
    {
      name: "kinds_edit",
      title: "Edit the store",
      description: "Changes the store directly.",
      input: { type: "object", properties: {} },
      mode: "content",
      effect: { readOnly: false, destructive: true, openWorld: true },
      enabledBy: "allowEdits",
      run: () => "edited",
    },
  ],
});

function registryIn() {
  const home = tempDir("plugins-kinds-");
  const registry = createPluginRegistry({ home, settings: createPluginSettingsStore({ home, env: {}, secrets: createFileSecretStore(home) }) });

  return { registry };
}

describe("validation", () => {
  it("accepts a toggle with its consequence and a select with options", () => {
    const check = validatePlugin(plugin);

    expect(check).toMatchObject({ ok: true, warnings: [] });
  });

  it("refuses a kind it doesn't know, a select without choices, a secret switch and a toggle with options", () => {
    const check = validatePlugin({
      name: "galley-plugin-bad-kinds",
      apiVersion: 1,
      settings: [
        { key: "a", label: "A", type: "slider" },
        { key: "b", label: "B", type: "select" },
        { key: "c", label: "C", type: "select", options: [{ value: "x", label: "X" }, { value: "x", label: "Again" }], default: "y" },
        { key: "d", label: "D", type: "toggle", secret: true },
        { key: "e", label: "E", type: "toggle", options: [{ value: "x", label: "X" }], default: "maybe" },
        { key: "f", label: "F", options: [{ value: "x", label: "X" }] },
      ],
    });
    const problems = check.ok ? "" : check.problems.join("\n");

    expect(check.ok).toBe(false);
    expect(problems).toMatch(/settings\[0\]\.type should be "text", "toggle" or "select"/);
    expect(problems).toMatch(/settings\[1\]\.options should list the choices/);
    expect(problems).toMatch(/settings\[2\]\.options has the same value twice/);
    expect(problems).toMatch(/settings\[3\] is a secret, so it can only be typed/);
    expect(problems).toMatch(/settings\[4\] is a toggle, which is on or off/);
    expect(problems).toMatch(/settings\[4\]\.default should be "on" or "off"/);
    expect(problems).toMatch(/settings\[5\]\.options is only for a setting with a type/);
  });

  it("warns when a switch that lets the assistant act outside the app doesn't say what it does", () => {
    const check = validatePlugin({ ...plugin, settings: [{ key: "allowEdits", type: "toggle", label: "Let the assistant edit the store" }] });

    expect(check.ok).toBe(true);
    expect(check.warnings.join("\n")).toMatch(/switches on “kinds_edit”; give it a consequence/);
  });
});

describe("saving and reading", () => {
  it("saves a toggle as on or off, reads defaults while unset, and refuses what doesn't fit", async () => {
    const { registry } = registryIn();

    registry.register(plugin, { source: "user", location: "test" });
    await registry.start();
    // Unset: the toggle is off and the select is its default, so the switched tool isn't offered.
    expect(registry.tools().map((tool) => tool.name)).toEqual([]);
    const [info] = await registry.list();

    expect(info!.settings).toEqual([
      expect.objectContaining({ key: "allowEdits", type: "toggle", default: "off", consequence: "Its edits go live in the store at once.", switchesOn: ["Edit the store"], configured: false }),
      expect.objectContaining({ key: "size", type: "select", options: [{ value: "small", label: "Small" }, { value: "large", label: "Large" }], default: "small" }),
      expect.not.objectContaining({ type: expect.anything() }),
    ]);

    const saved = await registry.saveSettings("galley-plugin-kinds", { allowEdits: "Yes", size: "large" });

    expect(saved.settings.find((setting) => setting.key === "allowEdits")).toMatchObject({ value: "on", configured: true });
    expect(saved.settings.find((setting) => setting.key === "size")).toMatchObject({ value: "large" });
    expect(registry.tools().map((tool) => tool.name)).toEqual(["kinds_edit"]);

    await expect(registry.saveSettings("galley-plugin-kinds", { allowEdits: "maybe" })).rejects.toThrow("Let the assistant edit the store is a switch: it can be on or off.");
    await expect(registry.saveSettings("galley-plugin-kinds", { size: "huge" })).rejects.toThrow("Picture size can only be one of: Small, Large.");
    await registry.saveSettings("galley-plugin-kinds", { allowEdits: "off" });
    expect(registry.tools().map((tool) => tool.name)).toEqual([]);
  });
});
