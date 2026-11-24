/** galley.config.json › editor: where the site's editor is hosted. An address and a host id, nothing else. */
import { describe, expect, it } from "vitest";
import { configJsonSchema, validateConfig } from "../../src/content/index";
import { normalizeSecret } from "../../src/ai/secrets";

describe("the editor key of the site's settings", () => {
  it("accepts an https address and a host id", () => {
    expect(validateConfig({ editor: { url: "https://cms.example.com", host: "fly" } })).toMatchObject({ ok: true, config: { editor: { url: "https://cms.example.com", host: "fly" } } });
    expect(validateConfig({ editor: { url: "https://cms.example.com/" } })).toMatchObject({ ok: true });
    expect(validateConfig({ editor: { url: "https://cms.example.com", host: "own-server" } })).toMatchObject({ ok: true });
  });

  it("refuses anything else, in plain words", () => {
    const problems = (value: unknown) => (validateConfig({ editor: value }) as { errors?: string[] }).errors ?? [];

    expect(problems({ url: "http://cms.example.com" })[0]).toContain("https://");
    expect(problems({ url: "https://cms.example.com/admin" })[0]).toContain("nothing after the name");
    expect(problems({ url: "https://cms.example.com", host: "Fly.io" })[0]).toContain("host id");
    expect(problems({ url: "https://cms.example.com", token: "x" })[0]).toContain("“token” is not a setting");
    expect(problems({ host: "fly" })[0]).toContain("editor.url");
  });

  it("is in the JSON Schema editors complete from", () => {
    const schema = configJsonSchema() as { properties: Record<string, { properties?: Record<string, unknown>; additionalProperties?: boolean }> };

    expect(Object.keys(schema.properties.editor!.properties!)).toEqual(["url", "host"]);
    expect(schema.properties.editor!.additionalProperties).toBe(false);
  });
});

describe("the Fly.io key", () => {
  it("is kept whole, “FlyV1” and every part included", () => {
    const key = "FlyV1 fm2_lJPECAAAAAAAAAAA0123456789abcdef+/==,fm2_secondPart0123456789";

    expect(normalizeSecret("fly", `  ${key}\n`)).toBe(key);
    expect(normalizeSecret("fly", "FlyV1   fm2_lJPECAAAAAAAAAAA0123456789abcdef")).toBe("FlyV1 fm2_lJPECAAAAAAAAAAA0123456789abcdef");
    expect(normalizeSecret("fly", "fm2_lJPECAAAAAAAAAAA0123456789abcdef")).toBe("fm2_lJPECAAAAAAAAAAA0123456789abcdef");
    expect(() => normalizeSecret("fly", "FlyV1 fm2_short")).toThrow("including “FlyV1”");
    expect(() => normalizeSecret("fly", "my fly key please")).toThrow("doesn't look like a Fly.io access key");
  });
});
