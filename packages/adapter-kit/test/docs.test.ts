/**
 * docs/adapters.md, executed. Every fenced block in the guide is annotated:
 * `<!-- sample: … -->` blocks are written out and run, `<!-- include: … -->`
 * blocks must match the file (or `#region`) they quote byte for byte, and
 * `<!-- command -->` blocks are run or checked against the kit's package.
 * A block with no annotation fails the test, so no sample can quietly rot.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadSiteModel, validateConfig } from "@galley/core/content";
import { adapterFromModule } from "@galley/core/adapter";
import { checkAdapter, type GalleyAdapter } from "../src/index";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const KIT = fileURLToPath(new URL("../", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const DOC = readFileSync(join(REPO, "docs/adapters.md"), "utf8");

interface Block {
  line: number;
  lang: string;
  code: string;
  marker: { kind: "sample"; name: string; fixture?: string } | { kind: "include"; path: string; region?: string } | { kind: "command" } | null;
}

function blocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const out: Block[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const open = /^```(\w*)\s*$/.exec(lines[index]!);

    if (!open) continue;
    const close = lines.findIndex((line, at) => at > index && line.startsWith("```"));
    const code = `${lines.slice(index + 1, close).join("\n")}\n`;
    const before = lines.slice(0, index).reverse().find((line) => line.trim() !== "") ?? "";
    const sample = /^<!-- sample: (\S+)(?: fixture: (\S+))? -->$/.exec(before);
    const include = /^<!-- include: ([^#\s]+)(?:#(\S+))? -->$/.exec(before);
    const marker = sample
      ? { kind: "sample" as const, name: sample[1]!, ...(sample[2] ? { fixture: sample[2] } : {}) }
      : include
        ? { kind: "include" as const, path: include[1]!, ...(include[2] ? { region: include[2] } : {}) }
        : before === "<!-- command -->"
          ? { kind: "command" as const }
          : null;

    out.push({ line: index + 1, lang: open[1]!, code, marker });
    index = close;
  }
  return out;
}

/** The lines between `// #region name` and `// #endregion name`, with their shared indentation removed. */
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
const sample = (name: string) => all.find((block) => block.marker?.kind === "sample" && block.marker.name === name)!;
// Inside the kit's folder, so the samples' `import … from "@galley/adapter-kit"` resolves as it would in a site.
const SAMPLES = join(KIT, "test", ".samples");
const made: string[] = [];

beforeAll(() => {
  rmSync(SAMPLES, { recursive: true, force: true });
  mkdirSync(SAMPLES, { recursive: true });
  for (const block of all) {
    if (block.marker?.kind === "sample" && block.marker.name.endsWith(".mjs")) writeFileSync(join(SAMPLES, block.marker.name), block.code);
  }
});

afterAll(() => {
  rmSync(SAMPLES, { recursive: true, force: true });
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

async function importSample(name: string): Promise<GalleyAdapter> {
  return adapterFromModule(await import(pathToFileURL(join(SAMPLES, name)).href)) as GalleyAdapter;
}

/** A copy of a sample fixture to add files to. */
function siteFrom(fixture: string): string {
  const root = mkdtempSync(join(tmpdir(), "docs-site-"));

  made.push(root);
  cpSync(join(FIXTURES, fixture), root, { recursive: true });
  return root;
}

describe("docs/adapters.md", () => {
  it("has an annotation on every code block", () => {
    const bare = all.filter((block) => block.marker === null).map((block) => `line ${block.line}`);

    expect(all.length).toBeGreaterThan(8);
    expect(bare).toEqual([]);
  });

  it("quotes every included file exactly", () => {
    for (const block of all) {
      if (block.marker?.kind !== "include") continue;
      const text = readFileSync(join(REPO, block.marker.path), "utf8");
      const expected = block.marker.region ? region(text, block.marker.region) : text;

      expect({ at: `line ${block.line}`, code: block.code }).toEqual({ at: `line ${block.line}`, code: expected });
    }
  });

  it("the 25-line adapter passes the kit and finds what the guide says it finds", async () => {
    const block = sample("lume-adapter.mjs");

    expect(block.code.trimEnd().split("\n").length).toBeLessThanOrEqual(30);
    const adapter = await importSample("lume-adapter.mjs");
    const report = await checkAdapter(adapter, join(FIXTURES, "lume-site"), {
      collections: [
        { id: "posts", minEntries: 2, url: "/posts/{slug}/" },
        { id: "pages", minEntries: 2, url: "/{slug}/" },
        { id: "site", url: null },
      ],
      dev: { command: "deno task serve", port: 3000 },
    });

    expect(report.checks.filter((check) => check.status !== "pass")).toEqual([]);
    expect(report.model.build).toEqual({ command: "deno task build", outDir: "_site" });
  });

  it("the conventionAdapter sample passes the kit, with its collection and environment", async () => {
    const report = await checkAdapter(await importSample("gatsby-adapter.mjs"), join(FIXTURES, "gatsby-site"), { collections: [{ id: "blog", minEntries: 2, url: "/{slug}/", fields: ["title", "date", "description"] }] });

    expect(report.checks.filter((check) => check.status === "fail")).toEqual([]);
    expect(report.model.environment).toEqual({ GATSBY_TELEMETRY_DISABLED: "1" });
    expect(report.model.dev).toEqual({ command: "npm start", port: 8000 });
  });

  it("the galley.config.json sample is valid and loads the adapter file", async () => {
    const config = sample("galley.config.json").code;

    expect(validateConfig(JSON.parse(config)).ok).toBe(true);
    const root = siteFrom("lume-site");

    writeFileSync(join(root, "galley.config.json"), config);
    writeFileSync(join(root, "lume-adapter.mjs"), sample("lume-adapter.mjs").code);
    const model = await loadSiteModel(root);

    expect(model.framework).toEqual({ id: "lume", name: "Lume" });
    expect(model.notes[0]).toBe("Loaded the Lume adapter from ./lume-adapter.mjs.");
  });

  it("the package.json sample follows the naming rules and loads from node_modules", async () => {
    const pkg = JSON.parse(sample("package.json").code) as { name: string; keywords: string[]; exports: string; files: string[] };

    expect(pkg.name).toMatch(/^galley-adapter-[a-z0-9-]+$/);
    expect(pkg.keywords).toContain("galley-adapter");
    const root = siteFrom("lume-site");
    const installed = join(root, "node_modules", pkg.name);

    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, "package.json"), sample("package.json").code);
    for (const file of pkg.files) writeFileSync(join(installed, file), sample(file).code);
    writeFileSync(join(root, "galley.config.json"), JSON.stringify({ adapters: [pkg.name] }));

    expect((await loadSiteModel(root)).framework.id).toBe("lume");
  });

  it("the commands name the kit's real package and binary, and the check command runs", () => {
    const kit = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8")) as { name: string; bin: Record<string, string> };
    const commands = all.filter((block) => block.marker?.kind === "command").map((block) => block.code.trim());
    const check = commands.find((command) => command.startsWith("npx galley-adapter-check"))!;

    expect(commands).toContain(`npm install --save-dev ${kit.name}`);
    expect(Object.keys(kit.bin)).toContain(check.split(" ")[1]);
    const [, , adapterFile, fixture] = check.split(" ") as [string, string, string, string];
    const output = execFileSync(process.execPath, [join(KIT, kit.bin["galley-adapter-check"]!), join(SAMPLES, adapterFile), join(FIXTURES, fixture)], { encoding: "utf8" });

    expect(output).toMatch(/^Lume adapter — /);
    expect(output).toMatch(/All 16 checks passed\.\n$/);
  });
});
