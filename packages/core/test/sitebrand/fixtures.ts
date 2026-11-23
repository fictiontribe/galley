/** Shared fixtures: a measured page, and model answers in the exact schema shapes. */
import type { Reading, Synthesis } from "../../src/sitebrand/schema";
import type { MeasureSummary } from "../../src/sitebrand/types";

export function measuredPage(path: string, overrides: Partial<MeasureSummary> = {}): MeasureSummary {
  return {
    path,
    title: "Lowfield",
    viewport: { width: 1280, height: 800 },
    pairs: [
      { text: "#111827", background: "#FBF9F6", area: 400_000, count: 40, roles: ["body", "heading"], ratio: 17.2 },
      { text: "#59606B", background: "#F1EEE9", area: 60_000, count: 8, roles: ["body"], ratio: 3.9 },
      { text: "#FFFFFF", background: "#C53500", area: 9_000, count: 3, roles: ["button"], ratio: 5.4 },
    ],
    grounds: [
      { color: "#FBF9F6", area: 4_000_000 },
      { color: "#F1EEE9", area: 900_000 },
    ],
    type: [
      { role: "heading", tag: "h1", family: "Schibsted Grotesk Variable", size: 56, weight: 700, lineHeight: 56, letterSpacing: -1.8, count: 1 },
      { role: "body", tag: "p", family: "Geist Variable", size: 17, weight: 400, lineHeight: 27.2, letterSpacing: 0, count: 30 },
      { role: "button", tag: "a", family: "Geist Variable", size: 15, weight: 520, lineHeight: 20, letterSpacing: 0, count: 3 },
    ],
    radii: [{ value: "999px", count: 3 }],
    shadows: [],
    spacing: [{ value: 96, count: 8 }],
    buttons: [{ background: "#C53500", color: "#FFFFFF", border: "none", radius: "999px", paddingX: 18, paddingY: 10, family: "Geist Variable", weight: 520, size: 15, count: 3, sample: "Start a free trial" }],
    links: [{ color: "#C53500", decoration: "underline", count: 6 }],
    logos: [{ kind: "svg", width: 120, height: 32, colors: ["#C53500", "#111827"], viewBox: "0 0 120 32", alt: "Lowfield" }],
    fonts: [
      { family: "Schibsted Grotesk Variable", status: "loaded" },
      { family: "Geist Variable", status: "loaded" },
    ],
    variables: [],
    internalLinks: [{ path: "/pricing/", count: 3 }],
    copy: [
      { role: "heading", text: "Ship the release notes your customers actually read" },
      { role: "body", text: "Every change is checked before it goes live, so nothing reaches visitors by accident." },
      { role: "button", text: "Start a free trial" },
    ],
    truncated: false,
    ...overrides,
  };
}

export function emptyReading(overrides: Partial<Reading> = {}): Reading {
  return { summary: "", colors: [], fonts: [], logo: [], voice: [], vocabulary: [], imagery: [], layout: [], instructionsSeen: false, ...overrides };
}

export function synthesis(overrides: Partial<Synthesis> = {}): Synthesis {
  return {
    colors: [],
    fonts: [],
    voice: { summary: "Plain and direct.", tone: ["plain", "direct", "calm"], rules: [], vocabulary: [], formatting: { headlineCase: "sentence", punctuation: "No exclamation marks.", numbers: "Digits.", cta: "Verb first." } },
    layout: { do: ["One idea per section."], dont: ["Don't stack two buttons of the same weight."] },
    imagery: { direction: "Product screens on warm paper.", subjects: ["the product"], light: "soft daylight", palette: [], avoid: ["stock handshakes"] },
    components: [],
    logos: [],
    flags: [],
    questions: [],
    ...overrides,
  };
}
