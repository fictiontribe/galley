/**
 * `checkTheme`: the legibility rules of brand/themes/README.md as one pure
 * function. It never trusts the file: it reads it strictly, keeps each colour
 * in its range, derives every colour exactly as tokens.css does
 * (derive.ts), measures the pairs people read, repairs in small lightness
 * steps in a fixed order, and says what it changed in plain words. Its
 * result is the theme as it will be applied; a theme is shown, saved or
 * shared only in that form.
 */
import { BLACK, contrast, fromHex, fromOklch, hueDistance, mixOklab, toHex, toOklch, type Rgb } from "./colour";
import {
  DEFAULT_SWITCHES,
  PEOPLE_COLOURS,
  PROOF_INKS,
  PROOF_INK_VALUES,
  SEED_NAMES,
  THEME_MODES,
  fullSwitches,
  parseTheme,
  type AppliedTheme,
  type ProofInk,
  type SeedName,
  type ThemeFile,
  type ThemeMode,
  type ThemeSeeds,
} from "./contract";
import { deriveColours, type DerivedColours } from "./derive";

export interface ThemeAdjustment {
  mode: ThemeMode;
  /** The colour that moved: a seed, a proof or status ink, or a people colour ("person-3") the check tuned. */
  colour: SeedName | ProofInk | `person-${number}`;
  from: string;
  to: string;
  /** "range": outside what that colour may be; "legibility": moved until what is read on it passes; "tuned": a proof or status ink, lightness only. */
  kind: "range" | "legibility" | "tuned";
  /** The sentence a person reads. */
  reason: string;
}

export interface ThemeWarning {
  code: "near-proof" | "light-pencil";
  ink?: ProofInk;
  message: string;
}

export interface PairMeasure {
  mode: ThemeMode;
  /** Plain words: "hints and labels on a well". */
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
}

export interface ThemeCheck {
  /** False when the theme is refused: it is never shown, saved or shared then. */
  ok: boolean;
  /** The file with the adjusted colours (dark only when the file had its own). */
  theme: ThemeFile | null;
  /** What is put on the page. */
  applied: AppliedTheme | null;
  /** The dark colours were made from the light ones. */
  derivedDark: boolean;
  adjusted: ThemeAdjustment[];
  warnings: ThemeWarning[];
  /** Why the theme can't be used, in plain words. */
  refused: string[];
  /** Every pair, as finally measured (for "Technical details" and the tests). */
  measures: PairMeasure[];
  /** The derived colours of each mode, as hex (the specimen and the parity test). */
  colours: Record<ThemeMode, Record<keyof DerivedColours, string>> | null;
}

// ── ranges (README → Seeds) ─────────────────────────────────────────────

interface Range {
  L: [number, number];
  C: number;
}

const RANGES: Record<ThemeMode, Record<Exclude<SeedName, "pencil">, Range>> = {
  light: { paper: { L: [0.93, 0.995], C: 0.035 }, ink: { L: [0, 0.32], C: 0.05 }, plate: { L: [0, 0.28], C: 0.06 }, table: { L: [0.8, 0.93], C: 0.06 } },
  dark: { paper: { L: [0.14, 0.27], C: 0.035 }, ink: { L: [0.9, 1], C: 0.04 }, plate: { L: [0, 0.22], C: 0.06 }, table: { L: [0.24, 0.34], C: 0.06 } },
};
/** In dark mode the plate also sits at least this far below the paper. */
const DARK_PLATE_BELOW_PAPER = 0.03;
export const PENCIL_MIN_CHROMA = 0.06;
/** README 7: warn when the pencil's text colour is this much lighter or darker (OKLCH L) than the pencil. */
const LIGHT_PENCIL_GAP = 0.15;
/** A people colour as a 2 px outline on a sheet (WCAG 1.4.11). */
const PERSON_OUTLINE = 3;
/** A hex colour can't land exactly on a boundary; this much either side is inside. */
const SLACK = 0.0005;
const STEP = 0.01;
const MAX_STEPS = 60;

function rangeFor(mode: ThemeMode, seed: Exclude<SeedName, "pencil">, seeds: ThemeSeeds): Range {
  const range = RANGES[mode][seed];

  if (mode === "dark" && seed === "plate") return { L: [0, Math.min(range.L[1], toOklch(fromHex(seeds.paper)).L - DARK_PLATE_BELOW_PAPER)], C: range.C };
  return range;
}

function inRange(hex: string, range: Range): boolean {
  const { L, C } = toOklch(fromHex(hex));

  return L >= range.L[0] - SLACK && L <= range.L[1] + SLACK && C <= range.C + SLACK;
}

/** The nearest hex colour inside the range with the same hue. */
function clampInto(hex: string, range: Range): string {
  const start = toOklch(fromHex(hex));
  let L = Math.min(range.L[1], Math.max(range.L[0], start.L));
  let C = Math.min(start.C, range.C);
  let out = toHex(fromOklch({ L, C, H: start.H }));

  // Rounding to a hex colour (and fitting to the screen) can land a hair outside; step inward until it is in.
  for (let i = 0; i < 40 && !inRange(out, range); i++) {
    const now = toOklch(fromHex(out));

    if (now.L > range.L[1]) L -= 0.001;
    if (now.L < range.L[0]) L += 0.001;
    if (now.C > range.C) C = Math.max(0, C - 0.002);
    out = toHex(fromOklch({ L, C, H: start.H }));
  }
  return out;
}

/** Move a colour's lightness by `delta`, hue and chroma kept. Null when it can't move further. */
function shift(hex: string, delta: number): string | null {
  const { L, C, H } = toOklch(fromHex(hex));
  const next = L + delta;

  if (next < 0 || next > 1) return null;
  const out = toHex(fromOklch({ L: next, C, H }));

  return out === hex ? toHex(fromOklch({ L: next + delta, C, H })) : out;
}

// ── the pairs (README → The pairs) ──────────────────────────────────────

type Group = "ink" | "pencil" | "plate" | "table" | "proof" | "fixed";

interface Pair {
  group: Group;
  fg: keyof DerivedColours | "white";
  bg: keyof DerivedColours;
  min: number;
}

const WHITE_TEXT = fromHex("#FFFFFF");
const READ_SURFACES = ["paper", "sheet", "well", "overlay"] as const;

const PAIRS: Pair[] = [
  ...READ_SURFACES.map((bg): Pair => ({ group: "ink", fg: "ink", bg, min: 7 })),
  ...READ_SURFACES.flatMap((bg): Pair[] => [
    { group: "ink", fg: "ink2", bg, min: 4.5 },
    { group: "ink", fg: "ink3", bg, min: 4.5 },
  ]),
  { group: "ink", fg: "ink3", bg: "desk", min: 4.5 },
  ...(["paper", "sheet", "well"] as const).map((bg): Pair => ({ group: "ink", fg: "strong", bg, min: 3 })),
  { group: "ink", fg: "ink", bg: "pencil200", min: 4.5 },
  { group: "table", fg: "ink", bg: "table", min: 7 },
  { group: "table", fg: "ink2", bg: "table", min: 4.5 },
  ...(["accentFill", "accentHover", "accentPressed"] as const).map((bg): Pair => ({ group: "pencil", fg: "accentOn", bg, min: 4.5 })),
  { group: "plate", fg: "onPlate", bg: "plate", min: 7 },
  { group: "plate", fg: "onPlate2", bg: "plate", min: 4.5 },
  { group: "plate", fg: "onPlate3", bg: "plate", min: 4.5 },
  { group: "plate", fg: "white", bg: "plateCurrent", min: 4.5 },
  // Focus on the plate, and the current place's bar there: both are the pencil-on-plate.
  { group: "plate", fg: "pencilOnPlate", bg: "plate", min: 3 },
  // Pencil text is also the focus ring (≥ 3); it is held to the text threshold, which covers both.
  ...READ_SURFACES.map((bg): Pair => ({ group: "fixed", fg: "accentText", bg, min: 4.5 })),
  { group: "fixed", fg: "pencil800", bg: "pencil100", min: 4.5 },
  { group: "fixed", fg: "pencil100", bg: "sheet", min: 1.1 },
  { group: "fixed", fg: "pencil400", bg: "sheet", min: 3 },
];

const PROOF_SURFACES = ["paper", "sheet", "well"] as const;

const FG_WORDS: Record<Pair["fg"], string> = {
  ink: "text",
  ink2: "secondary text",
  ink3: "hints and labels",
  strong: "the edges of fields",
  accentText: "text and focus in the pencil color",
  accentOn: "the words on a button",
  pencil800: "pencil text on a selected row",
  pencil100: "a selected row",
  pencil400: "the assistant’s ruled edge",
  onPlate: "words on the plate",
  onPlate2: "quieter words on the plate",
  onPlate3: "hints on the plate",
  white: "the current place on the plate",
  pencilOnPlate: "focus and the current place on the plate",
} as Record<Pair["fg"], string>;

const BG_WORDS: Partial<Record<keyof DerivedColours, string>> = {
  paper: "the paper",
  sheet: "a sheet",
  well: "a well",
  overlay: "a menu",
  table: "the table",
  desk: "the desk",
  plate: "the plate",
  plateCurrent: "the plate",
  accentFill: "a button",
  accentHover: "a button under the pointer",
  accentPressed: "a pressed button",
  pencil100: "a selected row",
  pencil200: "a pencil tint",
};

function pairLabel(pair: Pair): string {
  if (pair.fg === "pencil100") return "a selected row against a sheet";
  if (pair.bg === "plate" || pair.bg === "plateCurrent") return FG_WORDS[pair.fg];
  return `${FG_WORDS[pair.fg]} on ${BG_WORDS[pair.bg] ?? pair.bg}`;
}

function colourOf(d: DerivedColours, name: Pair["fg"]): Rgb {
  return name === "white" ? WHITE_TEXT : d[name];
}

function measure(d: DerivedColours, mode: ThemeMode): Array<PairMeasure & { group: Group; pair: Pair }> {
  return PAIRS.map((pair) => {
    const ratio = contrast(colourOf(d, pair.fg), d[pair.bg]);

    return { mode, label: pairLabel(pair), fg: toHex(colourOf(d, pair.fg)), bg: toHex(d[pair.bg]), ratio, min: pair.min, group: pair.group, pair };
  });
}

/** "hints and labels on a well and on the desk": the failing pairs of a group, joined for a sentence. */
function whereWords(failing: Pair[]): string {
  const byFg = new Map<string, string[]>();

  for (const pair of failing) {
    if (pair.bg === "plate" || pair.bg === "plateCurrent" || pair.fg === "pencil100") {
      byFg.set(pairLabel(pair), []);
      continue;
    }
    const list = byFg.get(FG_WORDS[pair.fg]) ?? [];
    const bg = BG_WORDS[pair.bg] ?? pair.bg;

    if (!list.includes(bg)) list.push(bg);
    byFg.set(FG_WORDS[pair.fg], list);
  }
  const parts = [...byFg.entries()].map(([fg, bgs]) => (bgs.length ? `${fg} on ${join(bgs, "and")}` : fg));

  return parts.length > 2 ? `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}` : parts.join(", and ");
}

function join(items: string[], word: string): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${word} ${items.at(-1)}`;
}

// ── words ───────────────────────────────────────────────────────────────

const SEED_WORDS: Record<SeedName, string> = { paper: "paper", ink: "ink", pencil: "pencil color", plate: "plate color", table: "table color" };
const INK_WORDS: Record<ProofInk, { name: string; thing: string }> = {
  insert: { name: "insert color", thing: "an insertion still looks like an insertion" },
  delete: { name: "delete color", thing: "a deletion still looks like a deletion" },
  change: { name: "change color", thing: "a change still looks like a change" },
  success: { name: "success color", thing: "it still means done" },
  warning: { name: "warning color", thing: "it still means “needs you”" },
  danger: { name: "error color", thing: "it still means something failed" },
  info: { name: "note color", thing: "it still reads as a note" },
};
const NEAR_WORDS: Partial<Record<ProofInk, string>> = {
  insert: "insertions",
  delete: "deletions",
  change: "changes",
  success: "things that are done",
  warning: "warnings",
  danger: "errors",
};

function owner(seed: SeedName, mode: ThemeMode, derivedDark: boolean): string {
  if (mode === "dark" && derivedDark) return `The dark ${SEED_WORDS[seed]} made from your light colors`;
  return mode === "dark" ? `Your dark ${SEED_WORDS[seed]}` : `Your ${SEED_WORDS[seed]}`;
}

function rangeReason(seed: Exclude<SeedName, "pencil">, mode: ThemeMode, before: { L: number; C: number }, range: Range): { why: string; how: string } {
  const low = before.L < range.L[0] - SLACK;
  const high = before.L > range.L[1] + SLACK;
  const strong = before.C > range.C + SLACK;
  const light = mode === "light";
  let why = "";

  if (seed === "paper") why = low ? (light ? "too dark for a light theme" : "too close to black") : high ? (light ? "too bright to rest the eyes on" : "too light for a dark theme") : "";
  if (seed === "ink") why = high ? "too light to read as text" : low ? "too dark to read on a dark theme" : "";
  if (seed === "plate") why = high ? (light ? "too light for words to read on it" : "too close to the paper (in a dark theme the plate sits a step darker)") : "";
  if (seed === "table") why = low ? (light ? "too dark to proof a page on" : "too dark to stand apart from the page") : high ? (light ? "too close to white to stand apart from the page" : "too light for a dark theme") : "";
  const colour = strong ? (seed === "ink" ? "too strongly colored for text" : seed === "paper" ? "too strongly colored to read on" : "too strongly colored") : "";
  const how = [low ? "lightened" : high ? "darkened" : "", strong ? (low || high ? "its color softened" : "softened") : ""].filter(Boolean).join(" and ");

  return { why: [why, colour].filter(Boolean).join(" and "), how: how || "adjusted" };
}

// ── dark from light ─────────────────────────────────────────────────────

/** README → Dark from light (OKLab mixes; "X p% toward Y" is p% of X). */
export function darkFromLight(light: ThemeSeeds): ThemeSeeds {
  const paper = fromHex(light.paper);
  const ink = fromHex(light.ink);
  const plate = fromHex(light.plate);
  const table = fromHex(light.table);

  return {
    paper: toHex(mixOklab(ink, BLACK, 0.9)),
    ink: toHex(mixOklab(paper, table, 0.75)),
    pencil: light.pencil,
    plate: toHex(mixOklab(plate, BLACK, 0.7)),
    table: toHex(mixOklab(ink, table, 0.9)),
  };
}

// ── the check ───────────────────────────────────────────────────────────

interface ModeResult {
  seeds: ThemeSeeds;
  tuned: Partial<Record<ProofInk, string>>;
  adjusted: ThemeAdjustment[];
  refused: string[];
  measures: PairMeasure[];
  colours: DerivedColours;
  inks: Record<ProofInk, string>;
}

function checkMode(input: ThemeSeeds, mode: ThemeMode, derivedDark: boolean): ModeResult {
  const seeds: ThemeSeeds = { ...input };
  const adjusted: ThemeAdjustment[] = [];
  const refused: string[] = [];
  const modeWords = mode === "dark" ? (derivedDark ? "The dark colors made from your light ones" : "Your dark colors") : "Your colors";

  // 2. Ranges, paper first: the dark plate's range depends on the paper.
  for (const seed of ["paper", "ink", "plate", "table"] as const) {
    const range = rangeFor(mode, seed, seeds);

    if (inRange(seeds[seed], range)) continue;
    const before = toOklch(fromHex(seeds[seed]));
    const to = clampInto(seeds[seed], range);
    const { why, how } = rangeReason(seed, mode, before, range);

    adjusted.push({ mode, colour: seed, from: seeds[seed], to, kind: "range", reason: `${owner(seed, mode, derivedDark)} was ${why}, so it was ${how} from ${seeds[seed]} to ${to}.` });
    seeds[seed] = to;
  }
  if (toOklch(fromHex(seeds.pencil)).C < PENCIL_MIN_CHROMA - SLACK) {
    refused.push(
      mode === "dark" && !derivedDark
        ? `Your dark pencil color (${seeds.pencil}) is too close to grey. The pencil marks the one action, where you are and focus, so it has to read as a color against the ink. Choose one with more color.`
        : `Your pencil color (${seeds.pencil}) is too close to grey. The pencil marks the one action, where you are and focus, so it has to read as a color against the ink. Choose one with more color.`
    );
  }

  // 3–5. Derive, measure, repair in order: ink, the pencil under button text, the plate, the table.
  const failing = (group: Group) =>
    measure(deriveColours(seeds, mode), mode)
      .filter((m) => m.group === group && m.ratio < m.min)
      .map((m) => m.pair);
  const repair = (seed: SeedName, group: Group, direction: () => number, words: (where: Pair[]) => string, range?: Range) => {
    const first = failing(group);

    if (!first.length || refused.length) return;
    const from = seeds[seed];
    let current = first;

    for (let i = 0; i < MAX_STEPS && current.length; i++) {
      const next = shift(seeds[seed], direction() * STEP);

      if (!next || (range && !inRange(next, range))) break;
      seeds[seed] = next;
      current = failing(group);
    }
    if (seeds[seed] !== from) {
      const moved = toOklch(fromHex(seeds[seed])).L < toOklch(fromHex(from)).L ? "darkened" : "lightened";

      adjusted.push({ mode, colour: seed, from, to: seeds[seed], kind: "legibility", reason: `${owner(seed, mode, derivedDark)} was ${moved} from ${from} to ${seeds[seed]} so that ${words(first)}.` });
    }
  };
  const light = mode === "light";

  repair("ink", "ink", () => (light ? -1 : 1), (pairs) => `${whereWords(pairs)} read clearly`, rangeFor(mode, "ink", seeds));
  repair("pencil", "pencil", () => (deriveColours(seeds, mode).accentOn.r > 0.5 ? -1 : 1), () => "the words on a button read clearly");
  repair("plate", "plate", () => -1, (pairs) => `${whereWords(pairs)} read clearly`, rangeFor(mode, "plate", seeds));
  repair("table", "table", () => (light ? 1 : -1), (pairs) => `${whereWords(pairs)} read clearly`, rangeFor(mode, "table", seeds));
  // The table may be at the end of its range: then the ink moves (it is the other half of the pair).
  repair("ink", "table", () => (light ? -1 : 1), (pairs) => `${whereWords(pairs)} read clearly`, rangeFor(mode, "ink", seeds));

  // 5 (last). Proof and status inks, lightness only, as overrides.
  const colours = deriveColours(seeds, mode);
  const inks = { ...PROOF_INK_VALUES[mode] };
  const tuned: Partial<Record<ProofInk, string>> = {};

  for (const ink of PROOF_INKS) {
    const from = inks[ink];
    let value = from;
    const worst = (hex: string) => Math.min(...PROOF_SURFACES.map((surface) => contrast(fromHex(hex), colours[surface])));
    const weakest = PROOF_SURFACES.filter((surface) => contrast(fromHex(from), colours[surface]) < 4.5);

    for (let i = 0; i < 40 && worst(value) < 4.5; i++) {
      const next = shift(value, light ? -STEP : STEP);

      if (!next) break;
      value = next;
    }
    if (value !== from) {
      inks[ink] = value;
      tuned[ink] = value;
      adjusted.push({
        mode,
        colour: ink,
        from,
        to: value,
        kind: "tuned",
        reason: `${mode === "dark" ? "In dark, the" : "The"} ${INK_WORDS[ink].name} was ${light ? "darkened" : "lightened"} slightly, from ${from} to ${value}, so it reads on ${join(weakest.map((s) => BG_WORDS[s] ?? s), "and")} in this theme. Its hue is kept, so ${INK_WORDS[ink].thing}.`,
      });
    }
  }

  // Measure everything as it will be shown.
  const measured = measure(colours, mode);
  const proofMeasures: PairMeasure[] = PROOF_INKS.flatMap((ink) =>
    PROOF_SURFACES.map((surface) => ({ mode, label: `the ${INK_WORDS[ink].name} on ${BG_WORDS[surface]}`, fg: inks[ink], bg: toHex(colours[surface]), ratio: contrast(fromHex(inks[ink]), colours[surface]), min: 4.5 }))
  );
  const measures: PairMeasure[] = [...measured.map(({ mode: m, label, fg, bg, ratio, min }) => ({ mode: m, label, fg, bg, ratio, min })), ...proofMeasures];
  const stillFailing = measures.filter((m) => m.ratio < m.min);

  if (!refused.length && stillFailing.length) {
    refused.push(`${modeWords} can’t be made readable by small changes: ${join(dedupe(stillFailing.map((m) => m.label)), "and")} ${stillFailing.length === 1 ? "is" : "are"} still too faint. Try a paper, ink or pencil color further apart.`);
  }
  return { seeds, tuned, adjusted, refused, measures, colours, inks };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function hexColours(colours: DerivedColours): Record<keyof DerivedColours, string> {
  return Object.fromEntries(Object.entries(colours).map(([name, value]) => [name, toHex(value)])) as Record<keyof DerivedColours, string>;
}

/**
 * The README's check, as one pure function: `input` is anything (a parsed
 * file, an object from the editor, text read from disk); the result is the
 * theme as it will be applied, what was changed and why, and warnings.
 */
export function checkTheme(input: unknown): ThemeCheck {
  const parsed = parseTheme(input);

  if (!parsed.ok) return { ok: false, theme: null, applied: null, derivedDark: false, adjusted: [], warnings: [], refused: parsed.problems, measures: [], colours: null };
  const theme = parsed.theme;
  const derivedDark = !theme.dark;
  const light = checkMode(theme.light, "light", false);
  const dark = checkMode(theme.dark ?? darkFromLight(light.seeds), "dark", derivedDark);
  const refused = [...light.refused, ...dark.refused];
  const warnings: ThemeWarning[] = [];

  // 7. Warn when the pencil sits close to a colour that already means something.
  const seen = new Set<ProofInk>();

  for (const [mode, result] of [["light", light], ["dark", dark]] as const) {
    const pencil = toOklch(fromHex(result.seeds.pencil));

    for (const ink of ["insert", "delete", "change", "success", "warning", "danger"] as const) {
      if (seen.has(ink)) continue;
      const other = toOklch(fromHex(result.inks[ink]));

      if (hueDistance(pencil.H, other.H) < 25 && Math.abs(pencil.L - other.L) < 0.12) {
        seen.add(ink);
        warnings.push({ code: "near-proof", ink, message: `Your pencil color is close to the ${INK_WORDS[ink].name}${mode === "dark" ? " in dark" : ""}; selected things may look like ${NEAR_WORDS[ink]}. The marks still carry the meaning.` });
      }
    }
  }
  // README 7: a light pencil draws its text and lines in a darker shade of itself (the clamped pencil text). Say so; change nothing.
  if (Math.abs(toOklch(fromHex(light.seeds.pencil)).L - toOklch(light.colours.accentText).L) > LIGHT_PENCIL_GAP) {
    warnings.push({ code: "light-pencil", message: "This pencil color is light, so lines and text drawn in it will look darker than the button." });
  }

  // The people colours (tokens.css §8): each as an outline on the light and the dark sheet, ≥ 3:1; tuned in lightness only, one value for both modes.
  const people: Record<string, string> = {};
  const peopleAdjusted: ThemeAdjustment[] = [];
  const peopleMeasures: PairMeasure[] = [];
  const sheets = { light: light.colours.sheet, dark: dark.colours.sheet };

  PEOPLE_COLOURS.forEach(({ name, value: from }, index) => {
    let value = from;
    const ratios = (hex: string) => ({ light: contrast(fromHex(hex), sheets.light), dark: contrast(fromHex(hex), sheets.dark) });

    for (let i = 0; i < 40; i++) {
      const now = ratios(value);

      if (now.light >= PERSON_OUTLINE && now.dark >= PERSON_OUTLINE) break;
      // Failing on both sheets at once can't be helped by lightness; it stays and is reported below.
      if (now.light < PERSON_OUTLINE && now.dark < PERSON_OUTLINE) break;
      const next = shift(value, now.light < PERSON_OUTLINE ? -STEP : STEP);

      if (!next) break;
      value = next;
    }
    const final = ratios(value);

    for (const mode of THEME_MODES) peopleMeasures.push({ mode, label: `the ${name} people color as an outline on a sheet`, fg: value, bg: toHex(sheets[mode]), ratio: final[mode], min: PERSON_OUTLINE });
    if (value !== from) {
      people[String(index + 1)] = value;
      const darker = toOklch(fromHex(value)).L < toOklch(fromHex(from)).L;

      peopleAdjusted.push({
        mode: darker ? "light" : "dark",
        colour: `person-${index + 1}`,
        from,
        to: value,
        kind: "tuned",
        reason: `The ${name} color that marks a person was ${darker ? "darkened" : "lightened"} slightly, from ${from} to ${value}, so its outline shows on a sheet in this theme. Its hue is kept, so that person looks the same to everyone.`,
      });
    }
  });
  const peopleFailing = peopleMeasures.filter((m) => m.ratio < m.min);

  if (peopleFailing.length) refused.push(`Some of the colors that mark people would not show on this theme’s sheets (${join(dedupe(peopleFailing.map((m) => m.label.replace(/^the | people color as an outline on a sheet$/g, ""))), "and")}). Try a sheet further from the middle grey.`);

  const adjusted = [...light.adjusted, ...dark.adjusted, ...peopleAdjusted];
  const measures = [...light.measures, ...dark.measures, ...peopleMeasures];
  const colours = { light: hexColours(light.colours), dark: hexColours(dark.colours) };

  if (refused.length) return { ok: false, theme: null, applied: null, derivedDark, adjusted, warnings, refused, measures, colours };
  const out: ThemeFile = { ...theme, light: light.seeds, switches: { ...theme.switches } };

  if (theme.dark) out.dark = dark.seeds;
  else delete out.dark;
  return {
    ok: true,
    theme: out,
    applied: { id: theme.id, light: light.seeds, dark: dark.seeds, switches: fullSwitches(theme.switches), tuned: { light: light.tuned, dark: dark.tuned }, ...(Object.keys(people).length ? { people } : {}) },
    derivedDark,
    adjusted,
    warnings,
    refused: [],
    measures,
    colours,
  };
}

/** How many pairs are measured: each mode's, and the people colours on both sheets. */
export const PAIR_COUNT = 2 * (PAIRS.length + PROOF_INKS.length * PROOF_SURFACES.length) + 2 * PEOPLE_COLOURS.length;
export { SEED_NAMES, THEME_MODES, DEFAULT_SWITCHES };
