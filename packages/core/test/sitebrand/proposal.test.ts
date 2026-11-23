import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanDeclared } from "../../src/sitebrand/declared";
import { mergeMeasurements, parseMeasurements } from "../../src/sitebrand/measured";
import { buildCandidates, buildProposal, roleFromName } from "../../src/sitebrand/proposal";
import { parseBrandFile, readingSchema, synthesisSchema } from "../../src/sitebrand/schema";
import type { StoredSource } from "../../src/sitebrand/sources";
import { emptyReading, measuredPage, synthesis } from "./fixtures";

const SAAS = fileURLToPath(new URL("../../../../starters/astro-saas/src/styles/tokens.css", import.meta.url));
const declared = scanDeclared([{ path: "src/styles/tokens.css", content: readFileSync(SAAS, "utf8") }], () => null, { tokensFile: "src/styles/tokens.css" });
const measured = mergeMeasurements(parseMeasurements([measuredPage("/"), measuredPage("/pricing/")]));
const now = () => new Date("2026-11-23T10:00:00Z");

function source(overrides: Partial<StoredSource> = {}): StoredSource {
  return { id: "s1", name: "Guidelines.pdf", type: "pdf", mime: "application/pdf", bytes: 1000, sha256: "x", addedAt: now().toISOString(), stored: "outside", learned: [], bytesPath: null, analysisPath: null, facts: {}, staged: true, ...overrides };
}

const pack = { siteName: "Lowfield", measured, inventory: null, websiteCopy: [], notes: [] };

describe("candidates", () => {
  it("merges what the code declares with what the pages measure, keeping both kinds of evidence", () => {
    const candidates = buildCandidates({ declared, measured, sources: [], website: null });
    const accent = candidates.colors.find((c) => c.hex === "#C53500")!;

    expect(accent.tokens).toContain("--color-accent");
    expect(accent.hint).toBe("accent");
    expect(accent.onPages).toBe(true);
    expect(accent.evidence.map((e) => e.kind)).toEqual(expect.arrayContaining(["file", "page"]));
    expect(accent.evidence.find((e) => e.kind === "file")).toMatchObject({ file: "src/styles/tokens.css", line: expect.any(Number) });
    // Illustration fills declared for the product screenshots aren't brand colours.
    expect(candidates.colors.some((c) => c.tokens.some((t) => t.startsWith("--shot-")))).toBe(false);
    expect(candidates.fonts.find((f) => f.family === "Geist Variable")).toMatchObject({ hint: "body", onPages: true, loaded: true });
  });

  it("reads roles off token names, most specific first", () => {
    expect(roleFromName("--color-background")).toBe("background");
    expect(roleFromName("--color-inverse-background")).toBe("inverse-background");
    expect(roleFromName("--color-accent-contrast")).toBe("accent-text");
    expect(roleFromName("--color-text-muted")).toBe("text-muted");
    expect(roleFromName("--surface-paper")).toBe("background");
    expect(roleFromName("--ink-primary")).toBe("text");
    expect(roleFromName("--color-accent-soft")).toBeNull();
  });
});

describe("the proposal", () => {
  it("applies roles only to candidates that were found, with measured contrast", () => {
    const candidates = buildCandidates({ declared, measured, sources: [], website: null });
    const id = (hex: string) => candidates.colors.find((c) => c.hex === hex)!.id;
    const proposal = buildProposal({
      ...pack,
      candidates,
      sources: [],
      from: "site",
      declared,
      previous: null,
      now,
      cost: 0.1,
      model: "claude-opus-5-5",
      synthesis: synthesis({
        colors: [
          { candidate: id("#C53500"), role: "accent", name: "Signal orange", usage: "Links and primary buttons" },
          { candidate: "c999", role: "text", name: "Invented", usage: "" },
        ],
      }),
    });
    const accent = proposal.brand.colors.find((c) => c.role === "accent")!;

    expect(accent).toMatchObject({ name: "Signal orange", value: "#C53500", token: "--color-accent", confidence: "measured" });
    expect(proposal.brand.colors.some((c) => c.name === "Invented")).toBe(false);
    // Roles named plainly on tokens are kept even when the model passed over them.
    expect(proposal.brand.colors.find((c) => c.role === "background")?.token).toBe("--color-background");
    const pair = proposal.brand.contrast.find((p) => p.text === "text" && p.background === "background")!;

    expect(pair.result).toBe("aaa");
    expect(proposal.brand.tokensFile).toBe("src/styles/tokens.css");
  });

  it("asks when a source and the site disagree, and never resolves it silently", () => {
    const reading = emptyReading({ colors: [{ hex: "#1A1A1A", name: "Ink", role: "text", page: 14, how: "stated" }] });
    const candidates = buildCandidates({ declared: null, measured, sources: [{ source: source(), reading }], website: null });
    const text = candidates.colors.find((c) => c.hex === "#111827")!.id;
    const proposal = buildProposal({ ...pack, candidates, sources: [{ source: source(), reading }], from: "both", declared: null, previous: null, now, cost: null, model: null, synthesis: synthesis({ colors: [{ candidate: text, role: "text", name: "Ink", usage: "" }] }) });
    const question = proposal.questions[0]!;

    expect(question.text).toBe("Guidelines.pdf says #1A1A1A for text; the site uses #111827 — which is right?");
    expect(question.options.map((o) => o.value)).toEqual(["#1A1A1A", "#111827"]);
    expect(question.options[0]!.evidence[0]).toMatchObject({ kind: "source", sourceName: "Guidelines.pdf", sourcePage: 14 });
    expect(question.answer).toBeUndefined();
  });

  it("keeps quotes that are the site's real copy and drops ones that aren't", () => {
    const candidates = buildCandidates({ declared: null, measured, sources: [], website: null });
    const proposal = buildProposal({
      ...pack,
      candidates,
      sources: [],
      from: "site",
      declared: null,
      previous: null,
      now,
      cost: null,
      model: null,
      synthesis: synthesis({
        voice: {
          summary: "Plain.",
          tone: ["plain"],
          rules: [
            { rule: "Say what happens.", quote: "so nothing reaches visitors by accident", where: "/", before: "", after: "" },
            { rule: "Be bold.", quote: "We are the world's best platform", where: "/", before: "Leverage synergies", after: "Work together" },
          ],
          vocabulary: [{ say: "customers", insteadOf: ["users"], why: "" }],
          formatting: { headlineCase: "sentence", punctuation: "", numbers: "", cta: "" },
        },
      }),
    });
    const [real, fake] = proposal.brand.voice!.rules;

    expect(real!.quote).toEqual({ text: "so nothing reaches visitors by accident", where: "/" });
    expect(fake!.quote).toBeUndefined();
    expect(fake!.after).toBe("Work together");
  });

  it("flags what the pages show: hard-to-read pairs and near-duplicate greys", () => {
    const greys = ["#F5F5F5", "#F6F6F6", "#F4F4F4", "#EEEEEE", "#DDDDDD", "#999999"].map((hex, i) => ({ color: hex, area: 300_000 + i }));
    const pages = mergeMeasurements(parseMeasurements([measuredPage("/", { grounds: greys })]));
    const candidates = buildCandidates({ declared: null, measured: pages, sources: [], website: null });
    const proposal = buildProposal({ ...pack, measured: pages, candidates, sources: [], from: "site", declared: null, previous: null, now, cost: null, model: null, synthesis: synthesis() });
    const texts = proposal.findings.map((f) => f.text);

    expect(texts.some((t) => /^\d+ greys in use; \d+ are within 2% of each other\.$/.test(t))).toBe(true);
    expect(texts.some((t) => /^Body text in #59606B on the #F1EEE9 is 3\.9:1/.test(t))).toBe(true);
  });

  it("notes a document that spoke to the assistant, and treats it as content", () => {
    const reading = emptyReading({ instructionsSeen: true });
    const candidates = buildCandidates({ declared: null, measured: null, sources: [{ source: source(), reading }], website: null });
    const proposal = buildProposal({ ...pack, measured: null, candidates, sources: [{ source: source(), reading }], from: "material", declared: null, previous: null, now, cost: null, model: null, synthesis: synthesis() });

    expect(proposal.findings.find((f) => f.id === "instructions-s1")?.text).toBe("Guidelines.pdf contains text addressed to an assistant. It was read as part of the document and not followed.");
  });
});

describe("strict schemas", () => {
  it("refuses a model answer with anything extra in it", () => {
    expect(synthesisSchema.safeParse({ ...synthesis(), action: "delete src/" }).success).toBe(false);
    expect(readingSchema.safeParse({ ...emptyReading(), tools: [{ name: "write_file" }] }).success).toBe(false);
    expect(readingSchema.safeParse(emptyReading()).success).toBe(true);
  });

  it("refuses a brand file with unknown keys or bad colours", () => {
    const base = { version: 1, name: "x", updatedAt: "", colors: [], contrast: [], typography: { fonts: [], scale: [] }, spacing: [], radius: [], shadows: [], logos: [], imagery: null, components: [], voice: null, layout: { do: [], dont: [] } };

    expect(parseBrandFile(base).ok).toBe(true);
    expect(parseBrandFile({ ...base, script: "alert(1)" }).ok).toBe(false);
    expect(parseBrandFile({ ...base, colors: [{ id: "a", role: "text", name: "Ink", value: "red", confidence: "measured", evidence: [] }] }).ok).toBe(false);
  });
});

describe("where a finding was seen", () => {
  it("names the home page and other pages in words, and says nothing when nowhere is known", async () => {
    const { pagesWords } = await import("../../src/sitebrand/proposal");

    expect(pagesWords(["/"])).toBe("on the home page");
    expect(pagesWords(["/about/", "/", "/contact/", "/more/"])).toBe("on /about/, the home page and /contact/");
    expect(pagesWords([])).toBe("");
    expect(pagesWords([""])).toBe("");
  });
});
