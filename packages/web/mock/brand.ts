/**
 * The site's brand, answered from memory for dev:mock. A scripted analysis:
 * the real steps on a timer, then a proposal in the starter's own look
 * (warm paper, deep ink, a terracotta accent, Newsreader and Instrument
 * Sans), with one question to answer. Saving writes the brand files into the
 * mock site's working copy, so they show in Proof.
 *
 * Imports engine types only (and the dependency-free sitebrand types file).
 */
import { randomUUID } from "node:crypto";
import type { Job } from "@galley/core/types";
import type { BrandProposal, BrandSource, BrandStep, SiteBrandFile, SiteBrandState } from "@galley/core/sitebrand/types";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError } from "./site.ts";

type BrandKey = Extract<keyof Handlers, `${string} /api/sites/:siteId/brand${string}`>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = (file: string, line: number, note: string) => ({ kind: "file" as const, file, line, note });
const page = (path: string, note: string) => ({ kind: "page" as const, page: path, note });

function fixtureBrand(name: string): SiteBrandFile {
  const tokens = "src/styles/tokens.css";

  return {
    version: 1,
    name,
    updatedAt: new Date().toISOString(),
    colors: [
      { id: "background", role: "background", name: "Paper", value: "#F8F4EC", token: "--color-background", usage: "The page ground", confidence: "measured", evidence: [page("/", "71% of the grounds on 4 pages"), ev(tokens, 44, "--color-background: oklch(97.4% 0.009 84)")] },
      { id: "surface", role: "surface", name: "Card", value: "#FDFBF7", token: "--color-surface", usage: "Inputs, cards, the mobile menu", confidence: "declared", evidence: [ev(tokens, 45, "--color-surface")] },
      { id: "surface-muted", role: "surface-muted", name: "Oat", value: "#ECE5D8", token: "--color-surface-muted", usage: "Muted sections", confidence: "measured", evidence: [page("/about/", "18% of the grounds")] },
      { id: "text", role: "text", name: "Ink", value: "#241C14", token: "--color-text", usage: "Headings and body text", confidence: "measured", evidence: [page("/", "82% of the text")] },
      { id: "text-muted", role: "text-muted", name: "Walnut", value: "#5E5143", token: "--color-text-muted", usage: "Secondary copy", confidence: "measured", evidence: [page("/journal/", "12% of the text")] },
      { id: "accent", role: "accent", name: "Terracotta", value: "#A6401C", token: "--color-accent", usage: "Links and primary buttons", confidence: "measured", evidence: [page("/", "3 buttons, links")] },
      { id: "accent-text", role: "accent-text", name: "On terracotta", value: "#FCF8F2", token: "--color-accent-contrast", usage: "Text on the accent", confidence: "declared", evidence: [ev(tokens, 53, "--color-accent-contrast")] },
      { id: "inverse-background", role: "inverse-background", name: "Night", value: "#2A2119", token: "--color-inverse-background", usage: "The footer", confidence: "measured", evidence: [page("/", "the footer")] },
    ],
    contrast: [
      { text: "text", background: "background", ratio: 15.1, result: "aaa", measuredOn: ["/", "/about/"] },
      { text: "text-muted", background: "background", ratio: 7.4, result: "aaa" },
      { text: "text-muted", background: "surface-muted", ratio: 6.2, result: "aa", measuredOn: ["/about/"] },
      { text: "accent", background: "background", ratio: 6.1, result: "aa", measuredOn: ["/"] },
      { text: "accent-text", background: "accent", ratio: 6.4, result: "aa" },
    ],
    typography: {
      fonts: [
        { id: "display", role: "display", family: "Newsreader Variable", fallbacks: ["Iowan Old Style", "Georgia", "serif"], source: { kind: "package", ref: "@fontsource-variable/newsreader" }, weights: [380, 520], token: "--font-display", confidence: "measured", evidence: [page("/", "set on 4 pages"), ev(tokens, 66, "--font-display")] },
        { id: "body", role: "body", family: "Instrument Sans Variable", fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"], source: { kind: "package", ref: "@fontsource-variable/instrument-sans" }, weights: [400, 520, 620], token: "--font-body", confidence: "measured", evidence: [page("/", "set on 4 pages")] },
      ],
      scale: [
        { id: "h1", role: "h1", font: "display", size: "78px", px: 78, weight: 380, lineHeight: "1.04", letterSpacing: "-1.7px", confidence: "measured", evidence: [page("/", "1 on /")] },
        { id: "h2", role: "h2", font: "display", size: "42px", px: 42, weight: 380, lineHeight: "1.22", confidence: "measured", evidence: [page("/", "6 on 4 pages")] },
        { id: "h3", role: "h3", font: "display", size: "23px", px: 23, weight: 520, lineHeight: "1.22", confidence: "measured", evidence: [page("/", "9 on 3 pages")] },
        { id: "body", role: "body", font: "body", size: "18px", px: 18, weight: 400, lineHeight: "1.6", confidence: "measured", evidence: [page("/", "42 on 4 pages")] },
        { id: "button", role: "button", font: "body", size: "15px", px: 15, weight: 520, lineHeight: "1.2", confidence: "measured", evidence: [page("/", "3 on /")] },
      ],
    },
    spacing: [
      { id: "space-s", name: "space-s", value: "1rem", token: "--space-s", uses: 14, confidence: "measured", evidence: [ev(tokens, 98, "--space-s")] },
      { id: "space-l", name: "space-l", value: "clamp(1.75rem, 1.45rem + 1.2vw, 2.5rem)", token: "--space-l", confidence: "declared", evidence: [ev(tokens, 100, "--space-l")] },
      { id: "space-section", name: "space-section", value: "clamp(4rem, 2.6rem + 6.5vw, 8.5rem)", token: "--space-section", uses: 8, confidence: "measured", evidence: [ev(tokens, 103, "--space-section")] },
    ],
    radius: [
      { id: "radius-m", name: "radius-m", value: "4px", token: "--radius-m", uses: 9, confidence: "measured", evidence: [ev(tokens, 113, "--radius-m")] },
      { id: "radius-button", name: "radius-button", value: "2px", token: "--radius-button", uses: 3, confidence: "measured", evidence: [ev(tokens, 115, "--radius-button")] },
    ],
    shadows: [{ id: "shadow-raised", name: "shadow-raised", value: "0 1px 2px rgb(36 28 20 / 0.06), 0 12px 32px -8px rgb(36 28 20 / 0.16)", token: "--shadow-raised", confidence: "declared", evidence: [ev(tokens, 119, "--shadow-raised")] }],
    logos: [{ id: "logo-wordmark", file: "inline svg 0 0 120 32", format: "svg", variant: "wordmark", background: "light", colors: ["#241C14"], viewBox: "0 0 120 32", confidence: "measured", evidence: [page("/", "header logo")] }],
    imagery: { direction: "Calm, daylit photographs of finished interiors and the people who use them; no staged stock.", subjects: ["finished rooms", "materials up close", "the team at work"], light: "soft daylight from one side", palette: ["#F8F4EC", "#A6401C", "#5E5143"], avoid: ["stock handshakes", "heavy filters"], confidence: "inferred", evidence: [page("/", "12 images in the site's content")] },
    components: [
      { type: "hero", label: "Hero", whenToUse: "The first section of a page: one promise and one action.", usedOn: ["/", "/about/"], count: 4, confidence: "declared", evidence: [] },
      { type: "features", label: "Features", whenToUse: "Three or four things the studio does, each with one line.", usedOn: ["/"], count: 2, confidence: "inferred", evidence: [] },
      { type: "testimonial", label: "Testimonial", whenToUse: "One client's words, with their name.", usedOn: ["/"], count: 1, confidence: "inferred", evidence: [] },
      { type: "cta", label: "Call to action", whenToUse: "The end of a page: what to do next.", usedOn: ["/", "/services/"], count: 3, confidence: "inferred", evidence: [] },
    ],
    voice: {
      summary: "Warm, plain and unhurried: the studio talks like a good builder explaining a plan — concrete about materials and time, never salesy.",
      tone: ["warm", "plain", "confident", "unhurried"],
      rules: [
        { rule: "Lead with what the person gets, in their words.", quote: { text: "Make more of the home you already love.", where: "/" } },
        { rule: "Name real materials and real timeframes.", quote: { text: "Most kitchens take six to eight weeks, start to finish.", where: "/services/" }, before: "We deliver world-class solutions quickly.", after: "Most kitchens take six to eight weeks." },
        { rule: "No exclamation marks; let the work speak.", before: "Book your free consultation today!", after: "Book a first visit." },
      ],
      vocabulary: [
        { say: "home", insteadOf: ["property", "space"], why: "people live there" },
        { say: "first visit", insteadOf: ["consultation"] },
      ],
      formatting: { headlineCase: "sentence", punctuation: "No exclamation marks; curly quotes.", numbers: "Words under ten, digits above.", cta: "A verb and an object: “Book a first visit”." },
      confidence: "inferred",
      evidence: [page("/", "64 pieces of the site's own copy")],
    },
    layout: { do: ["One idea per section, with room around it.", "Photographs full width or in a calm two-up."], dont: ["Don't put two primary buttons side by side.", "Don't set body text on the terracotta."] },
    tokensFile: tokens,
  };
}

interface SiteBrandMock {
  brand: SiteBrandFile | null;
  guide: string | null;
  proposal: BrandProposal | null;
  sources: BrandSource[];
  analysis: SiteBrandState["analysis"];
}

export function createMockBrand(mock: MockBackend) {
  const bySite = new Map<string, SiteBrandMock>();
  const uploads = new Map<string, { received: number; total: number; name: string; note?: string; chunks: Buffer[] }>();
  const of = (siteId: string): SiteBrandMock => {
    mock.site(siteId);
    let entry = bySite.get(siteId);

    if (!entry) {
      entry = { brand: null, guide: null, proposal: null, sources: [], analysis: null };
      bySite.set(siteId, entry);
    }
    return entry;
  };
  const state = (siteId: string): SiteBrandState => {
    const entry = of(siteId);

    return {
      brand: entry.brand,
      guide: entry.guide,
      sources: entry.sources,
      proposal: entry.proposal,
      analysis: entry.analysis,
      settings: { dir: "galley/brand", largeFileBytes: 10 * 1024 * 1024, tokensFile: "src/styles/tokens.css" },
      hasPages: true,
      assistant: mock.secrets.anthropic.configured,
      digest: entry.brand ? `The site's brand (galley/brand). Work inside it: use these colours, fonts and sections; don't invent new ones.\n\nColours:\n${entry.brand.colors.map((c) => `- ${c.role}: ${c.name} ${c.value}${c.token ? ` var(${c.token})` : ""}`).join("\n")}\n\nThe brand guide:\n\n${entry.guide ?? ""}` : null,
      // The same brief the engine builds (sitebrand/guide.ts imageryBrief), for the Media screen's generate forms.
      imagery: entry.brand?.imagery
        ? [entry.brand.imagery.direction, entry.brand.imagery.subjects.length ? `Subjects: ${entry.brand.imagery.subjects.join(", ")}.` : "", entry.brand.imagery.light ? `Light: ${entry.brand.imagery.light}.` : "", entry.brand.imagery.palette.length ? `Palette: ${entry.brand.imagery.palette.join(", ")}.` : "", entry.brand.imagery.avoid.length ? `Avoid: ${entry.brand.imagery.avoid.join(", ")}.` : ""].filter(Boolean).join(" ").slice(0, 800)
        : null,
      pending: entry.brand ? ["galley/brand/brand.json", "galley/brand/guide.md"] : [],
      problem: null,
      staged: entry.sources.filter((s) => s.stored === "outside").map((s) => s.id),
      webFonts: [],
    };
  };
  const proposal = (siteId: string, from: BrandProposal["from"]): BrandProposal => ({
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    from,
    brand: fixtureBrand(mock.site(siteId).name),
    questions: [
      {
        id: "q-text",
        target: "colors.text",
        text: "Brand guidelines.pdf says #1A1A1A for text; the site uses #241C14 — which is right?",
        options: [
          { label: "#1A1A1A, as on page 14 of Brand guidelines.pdf", value: "#1A1A1A", evidence: [{ kind: "source", sourceName: "Brand guidelines.pdf", sourcePage: 14 }] },
          { label: "#241C14, as the site uses", value: "#241C14", evidence: [{ kind: "page", page: "/" }] },
        ],
      },
    ],
    findings: [
      { id: "near-greys", kind: "issue", text: "9 greys in use; 4 are within 2% of each other.", about: ["#ECE5D8", "#EDE6D9", "#EBE4D7", "#EEE7DA"] },
      { id: "contrast-1", kind: "issue", text: "Muted text on the card is 4.3:1 (/journal/).", about: ["#5E5143", "#FDFBF7"] },
    ],
    pendingSources: [],
    cost: from === "site" ? 0.31 : 0.42,
    model: "claude-opus-5-5",
  });

  async function runAnalysis(siteId: string, from: "site" | "material") {
    const entry = of(siteId);
    const names = from === "material" ? entry.sources.map((s) => `Reading ${s.name}`) : ["Reading the site's styles", "Measuring the pages", "Listing the sections"];
    const steps: BrandStep[] = [...names, "Putting it together", "Checking contrast"].map((label) => ({ label, state: "waiting" }));
    const job: Job = { id: randomUUID(), kind: "brand", label: "Reading the brand", state: "running", progress: 0, siteId, startedAt: Date.now() };

    const analysis: NonNullable<SiteBrandState["analysis"]> = { jobId: job.id, steps, partial: null, state: "running" };

    entry.analysis = analysis;
    mock.jobs.set(job.id, job);
    mock.emit({ type: "job", job: { ...job } });
    void (async () => {
      for (const [index, step] of steps.entries()) {
        step.state = "running";
        Object.assign(job, { progress: index / steps.length, detail: step.label });
        mock.emit({ type: "job", job: { ...job } });
        await sleep(900);
        if (entry.analysis !== analysis || analysis.state !== "running") return;
        step.state = "done";
        step.detail = index === 0 && from === "site" ? "21 colours and 2 fonts in src/styles/tokens.css" : index === 1 && from === "site" ? "4 pages: /, /about/, /services/, /journal/" : undefined;
        if (index === 1) analysis.partial = { colors: fixtureBrand("").colors.slice(0, 5) };
      }
      entry.proposal = proposal(siteId, from);
      analysis.state = "done";
      Object.assign(job, { state: "done", progress: 1, detail: "Ready to review", finishedAt: Date.now() });
      mock.emit({ type: "job", job: { ...job } });
    })();
    return { ...job };
  }

  const handlers: Pick<Handlers, BrandKey> = {
    "GET /api/sites/:siteId/brand": ({ params }) => state(params.siteId),
    "POST /api/sites/:siteId/brand/analyse": ({ params, body }) => runAnalysis(params.siteId, body.from),
    "POST /api/sites/:siteId/brand/cancel": ({ params }) => {
      const entry = of(params.siteId);

      if (entry.analysis?.state === "running") entry.analysis = { ...entry.analysis, state: "cancelled", error: "Stopped. Nothing was saved." };
      return { ok: true };
    },
    "POST /api/sites/:siteId/brand/sources": ({ params, body }) => {
      const entry = of(params.siteId);
      const id = body.uploadId ?? randomUUID().slice(0, 16);
      const upload = uploads.get(id) ?? { received: 0, total: body.total, name: body.name, ...(body.note ? { note: body.note } : {}), chunks: [] };
      const chunk = Buffer.from(body.chunk, "base64");

      upload.chunks.push(chunk);
      upload.received += chunk.length;
      uploads.set(id, upload);
      if (upload.received < upload.total) return { uploadId: id, received: upload.received, source: null };
      uploads.delete(id);
      const bytes = Buffer.concat(upload.chunks);
      const head = bytes.subarray(0, 8).toString("latin1");
      const type = head.startsWith("%PDF") ? "pdf" : head.includes("PNG") || bytes[0] === 0xff ? "image" : /<svg/i.test(bytes.subarray(0, 400).toString("utf8")) ? "svg" : "text";
      const source: BrandSource = {
        id,
        name: upload.name,
        type,
        mime: type === "pdf" ? "application/pdf" : type === "image" ? "image/png" : type === "svg" ? "image/svg+xml" : "text/plain",
        bytes: bytes.length,
        sha256: id,
        addedAt: new Date().toISOString(),
        ...(upload.note ? { note: upload.note } : {}),
        stored: "outside",
        ...(type === "pdf" ? { pages: 12 } : {}),
        learned: type === "pdf" ? ["12 pages.", "Fonts inside it: Newsreader, Figtree."] : type === "image" ? ["Colours by area: #F6F1E7 (64%), #1A1712 (21%)."] : ["A note to read with the rest."],
      };

      entry.sources.push(source);
      if (entry.proposal) entry.proposal.pendingSources.push(id);
      return { uploadId: id, received: upload.received, source };
    },
    "POST /api/sites/:siteId/brand/website": ({ params, body }) => {
      if (!/^https:\/\//.test(body.url)) throw new MockError("invalid", "Only secure (https://) addresses can be used here.");
      const source: BrandSource = { id: randomUUID().slice(0, 16), name: new URL(body.url).hostname, type: "website", mime: "text/html", bytes: 48_000, sha256: "x", addedAt: new Date().toISOString(), stored: "outside", learned: ["Read the page and 2 stylesheets."] };

      of(params.siteId).sources.push(source);
      return source;
    },
    "PATCH /api/sites/:siteId/brand/sources/:sourceId": ({ params, body }) => {
      const source = of(params.siteId).sources.find((s) => s.id === params.sourceId);

      if (!source) throw new MockError("not-found", "That file isn't in the brand's material.");
      if (body.note !== undefined) source.note = body.note ?? undefined;
      if (body.ignored !== undefined) source.ignored = body.ignored;
      return source;
    },
    "DELETE /api/sites/:siteId/brand/sources/:sourceId": ({ params }) => {
      const entry = of(params.siteId);

      entry.sources = entry.sources.filter((s) => s.id !== params.sourceId);
      return { ok: true };
    },
    "GET /api/sites/:siteId/brand/sources/:sourceId/file": () => {
      throw new MockError("not-found", "Files aren't kept by the mock.");
    },
    "PUT /api/sites/:siteId/brand/proposal": ({ params, body }) => {
      const entry = of(params.siteId);

      entry.proposal ??= { ...proposal(params.siteId, "site"), questions: [], findings: [], brand: entry.brand ?? fixtureBrand(mock.site(params.siteId).name) };
      if (body.brand) entry.proposal.brand = body.brand as SiteBrandFile;
      for (const [id, value] of Object.entries(body.answers ?? {})) {
        const question = entry.proposal.questions.find((q) => q.id === id);

        if (!question) continue;
        question.answer = value;
        const color = entry.proposal.brand.colors.find((c) => `colors.${c.role}` === question.target);

        if (color) color.value = value;
      }
      return entry.proposal;
    },
    "DELETE /api/sites/:siteId/brand/proposal": ({ params }) => {
      const entry = of(params.siteId);

      entry.proposal = null;
      entry.analysis = null;
      return { ok: true };
    },
    "POST /api/sites/:siteId/brand/ask": async ({ params, body }) => {
      const entry = of(params.siteId);

      if (!entry.proposal) throw new MockError("not-found", "There's no brand to change yet.");
      await sleep(800);
      const accent = entry.proposal.brand.colors.find((c) => c.role === "accent");

      if (accent && /warm/i.test(body.text)) accent.value = "#B8471B";
      return { proposal: entry.proposal, reply: "I made the accent a little warmer (#B8471B). Contrast checked: 5.6:1 on the background — still easy to read." };
    },
    "POST /api/sites/:siteId/brand/save": ({ params }) => {
      const entry = of(params.siteId);

      if (!entry.proposal) throw new MockError("not-found", "There's nothing to save yet.");
      if (entry.proposal.questions.some((q) => !q.answer)) throw new MockError("invalid", "Answer the question first: it decides which value the brand keeps.");
      entry.brand = entry.proposal.brand;
      entry.guide = `# ${entry.brand.name} — brand guide\n\n## Voice\n\n${entry.brand.voice?.summary ?? ""}\n`;
      entry.proposal = null;
      entry.analysis = null;
      const site = mock.site(params.siteId);

      site.write("galley/brand/brand.json", Buffer.from(`${JSON.stringify(entry.brand, null, 2)}\n`));
      site.write("galley/brand/guide.md", Buffer.from(entry.guide));
      mock.changed(params.siteId, ["galley/brand/brand.json", "galley/brand/guide.md"], "user");
      return { paths: ["galley/brand/brand.json", "galley/brand/guide.md"] };
    },
    "GET /api/sites/:siteId/brand/apply": ({ params }) => {
      const brand = of(params.siteId).brand ?? of(params.siteId).proposal?.brand;

      if (!brand) throw new MockError("not-found", "There's no brand to apply yet.");
      return { file: "src/styles/tokens.css", edits: [{ token: "--color-accent", line: 51, before: "oklch(50.5% 0.142 39)", after: "oklch(54.6% 0.152 41)", label: "Accent" }], notes: ["Left as they were (the brand has no value for them): --color-accent-strong, --color-accent-on-inverse."], warnings: [] };
    },
    "POST /api/sites/:siteId/brand/apply": ({ params }) => {
      const site = mock.site(params.siteId);
      const file = site.read("src/styles/tokens.css")?.toString("utf8");

      if (file) site.write("src/styles/tokens.css", Buffer.from(file.replace("oklch(50.5% 0.142 39)", "oklch(54.6% 0.152 41)")));
      mock.changed(params.siteId, ["src/styles/tokens.css"], "user");
      return { plan: { file: "src/styles/tokens.css", edits: [{ token: "--color-accent", line: 51, before: "oklch(50.5% 0.142 39)", after: "oklch(54.6% 0.152 41)", label: "Accent" }], notes: [], warnings: [] }, paths: ["src/styles/tokens.css"] };
    },
    "POST /api/sites/:siteId/brand/check": () => ({ items: [{ kind: "colour", text: "#FF00AA isn't one of the brand's colours. Use one of the properties in src/styles/tokens.css.", path: "src/components/Card.astro", line: 12, value: "#FF00AA" }] }),
    "POST /api/sites/:siteId/brand/drift": () => ({ checkedAt: new Date().toISOString(), pages: ["/", "/about/"], unknown: [{ kind: "colour", value: "#3B82F6", where: ["/about/"], area: 1.2 }], unused: [{ kind: "colour", value: "#2A2119", name: "Night" }], matching: 11 }),
    "GET /api/sites/:siteId/brand/export": ({ params }) => {
      const brand = of(params.siteId).brand ?? fixtureBrand(mock.site(params.siteId).name);

      return { kind: "bytes", type: "application/json", body: Buffer.from(JSON.stringify({ kind: "site-brand-bundle", version: 1, exportedAt: new Date().toISOString(), brand, guide: null, sources: { version: 1, sources: [] } }, null, 2)) };
    },
    "POST /api/sites/:siteId/brand/import": ({ params }) => {
      const entry = of(params.siteId);

      entry.proposal = { ...proposal(params.siteId, "material"), questions: [], findings: [{ id: "imported", kind: "note", text: "Imported from another site's brand. Check it against this site before saving." }] };
      return entry.proposal;
    },
    "GET /api/sites/:siteId/brand/fonts/:fontId": () => {
      throw new MockError("not-found", "That font isn't one of the site's.");
    },
  };
  return { handlers };
}
