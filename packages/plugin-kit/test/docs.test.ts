/**
 * docs/plugins.md, executed. Every fenced block is annotated: `<!-- include:
 * path#region -->` blocks must match the file region they quote byte for
 * byte, `<!-- sample: config -->` blocks must be a valid galley.config.json,
 * and `<!-- command -->` blocks may only use real `galley plugin` commands.
 * A block with no annotation fails the test, and every sample plugin the
 * guide quotes is run here — so no sample can quietly rot.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateConfig } from "@galley/core/content";
import { checkPlugin, fakeFetch, formatPluginReport, json, testContext, type GalleyPlugin, type SiteService } from "../src/index";
import { PLUGIN_HELP } from "../../cli/src/commands/plugin";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const DOC = readFileSync(join(REPO, "docs/plugins.md"), "utf8");

interface Block {
  line: number;
  code: string;
  marker: { kind: "include"; path: string; region?: string } | { kind: "sample" } | { kind: "command" } | null;
}

function blocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const out: Block[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^```\w*\s*$/.test(lines[index]!)) continue;
    const close = lines.findIndex((line, at) => at > index && line.startsWith("```"));
    const before = lines.slice(0, index).reverse().find((line) => line.trim() !== "") ?? "";
    const include = /^<!-- include: ([^#\s]+)(?:#(\S+))? -->$/.exec(before);

    out.push({
      line: index + 1,
      code: `${lines.slice(index + 1, close).join("\n")}\n`,
      marker: include ? { kind: "include", path: include[1]!, ...(include[2] ? { region: include[2] } : {}) } : before === "<!-- sample: config -->" ? { kind: "sample" } : before === "<!-- command -->" ? { kind: "command" } : null,
    });
    index = close;
  }
  return out;
}

function region(text: string, name: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `// #region ${name}`);
  const end = lines.findIndex((line, at) => at > start && line.trim() === `// #endregion ${name}`);

  if (start === -1 || end === -1) throw new Error(`No region “${name}”.`);
  const body = lines.slice(start + 1, end);
  const indent = Math.min(...body.filter((line) => line.trim() !== "").map((line) => /^ */.exec(line)![0].length));

  return `${body.map((line) => line.slice(indent)).join("\n")}\n`;
}

const all = blocks(DOC);

describe("docs/plugins.md", () => {
  it("annotates every code block", () => {
    expect(all.length).toBeGreaterThan(15);
    for (const block of all) expect(block.marker, `the block at line ${block.line} has no <!-- include/sample/command --> annotation`).not.toBeNull();
  });

  it("quotes real files byte for byte", () => {
    for (const block of all) {
      if (block.marker?.kind !== "include") continue;
      const text = readFileSync(join(REPO, block.marker.path), "utf8");

      expect(block.code, `${block.marker.path}#${block.marker.region ?? ""} (line ${block.line})`).toBe(block.marker.region ? region(text, block.marker.region) : text);
    }
  });

  it("shows only valid configuration", () => {
    for (const block of all.filter((item) => item.marker?.kind === "sample")) expect(validateConfig(JSON.parse(block.code)), `line ${block.line}`).toMatchObject({ ok: true });
  });

  it("uses only commands the CLI has", () => {
    for (const block of all.filter((item) => item.marker?.kind === "command")) {
      for (const line of block.code.split("\n").filter((text) => text.trim())) {
        const command = /^galley plugin (\w+)/.exec(line)?.[1];

        expect(command, line).toBeDefined();
        expect(PLUGIN_HELP, line).toContain(`plugin ${command}`);
      }
    }
  });
});

async function sample(name: string): Promise<GalleyPlugin> {
  return ((await import(`./samples/${name}.mjs`)) as { default: GalleyPlugin }).default;
}

describe("the samples it quotes", () => {
  it.each(["minimal-plugin", "image-provider", "form-provider", "importer", "before-publish", "theme-plugin"])("%s passes the kit's checks", async (name) => {
    const report = await checkPlugin(await sample(name));

    expect(report.ok, formatPluginReport(report)).toBe(true);
  });

  it("the theme plugin's theme passes the app's check unchanged", async () => {
    const { checkTheme } = await import("@galley/core/themes");
    const check = checkTheme((await sample("theme-plugin")).themes![0]);

    expect(check.ok).toBe(true);
    expect(check.adjusted.filter((adjustment) => adjustment.kind !== "tuned" && adjustment.mode === "light")).toEqual([]);
  });

  it("the minimal plugin's tool says hello", async () => {
    const plugin = await sample("minimal-plugin");

    expect(await plugin.tools![0]!.run({ name: "Ana" }, testContext() as never)).toBe("Hello, Ana.");
  });

  it("the image provider turns a reply into pictures with their cost", async () => {
    const plugin = await sample("image-provider");
    const api = fakeFetch(() => json(200, { images: [{ base64: Buffer.from("PNG").toString("base64"), cost: 0.02 }] }));
    const images = await plugin.imageProviders![0]!.generate({ prompt: "A boat", aspect: "1:1", count: 1, model: "pictures-1", transparent: false, references: [] }, { ...testContext({ fetch: api.fetch }), key: "k" });

    expect(images).toEqual([{ data: new Uint8Array(Buffer.from("PNG")), mime: "image/png", cost: 0.02 }]);
    expect(api.requests[0]!.body).toEqual({ model: "pictures-1", prompt: "A boat", aspect: "1:1", n: 1 });
  });

  it("the form destination forwards a submission and reads a form's fields", async () => {
    const provider = (await sample("form-provider")).formProviders![0]!;
    const api = fakeFetch((request) => (request.method === "POST" ? json(503, {}) : json(200, { fields: [{ key: "email", title: "E-mail", kind: "email", required: true }] })));
    const ctx = { ...testContext({ fetch: api.fetch }), siteId: "s", formId: "contact", payload: { email: "ana@example.com" } };

    expect(await provider.forward!({ id: "1", siteId: "s", form: "contact", at: "2026-11-23T10:00:00Z", values: { email: "ana@example.com" } }, { provider: "formcatcher", settings: { formId: "f_1" } }, ctx)).toEqual({
      ok: false,
      detail: "Formcatcher answered 503.",
      retry: true,
    });
    expect(api.requests[0]).toMatchObject({ url: "https://api.formcatcher.example/forms/f_1/entries", body: { email: "ana@example.com" } });
    expect(await provider.introspect!({ formId: "f_1" }, testContext({ fetch: api.fetch }))).toEqual([{ name: "email", label: "E-mail", type: "email", required: true }]);
  });

  it("the importer's command runs, and the publish gate refuses placeholder text", async () => {
    const importer = (await sample("importer")).importers![0]!;
    const out: string[] = [];

    expect(await importer.command!.run(["./notes"], { out: (line = "") => out.push(line), err: () => {}, cwd: "/", env: {} })).toBe(0);
    expect(out).toEqual(["Would import the notes in ./notes."]);
    const gate = (await sample("before-publish")).hooks!.beforePublish!;
    const site = { readFile: async () => ({ content: "Lorem ipsum dolor" }) } as unknown as SiteService;
    const changes = { files: [{ path: "src/content/pages/index.md", status: "modified", kind: "content", title: "Home" }] } as never;

    expect(await gate({ ...testContext(), site, siteId: "s" }, changes)).toEqual({ refuse: "“Home” still has placeholder text (Lorem ipsum)." });
  });
});
