/**
 * What a PDF says without reading its words: how many pages, which fonts are
 * embedded, and which colours fill its pages (by painted area). Nothing in
 * the file is executed or rendered — streams are inflated and their drawing
 * operators counted. Used for the deterministic half of reading guidelines,
 * and as the whole of it when a file is too large to send to the model.
 */
import { inflateSync } from "node:zlib";
import { toHex } from "./color";

export interface PdfSummary {
  pages: number;
  /** Family names with the subset tag and style suffix removed: "Newsreader". */
  fonts: Array<{ family: string; styles: string[] }>;
  /** Fill colours by share of the painted area, plus how often text was drawn in each. */
  colors: Array<{ color: string; share: number; text: number }>;
  /** The file looks encrypted: nothing inside could be read. */
  encrypted: boolean;
}

const MAX_STREAM_OUT = 16 * 1024 * 1024;
const MAX_TOTAL_OUT = 96 * 1024 * 1024;
const STYLE_WORDS = /[-,\s]?(Regular|Italic|Bold|BoldItalic|Medium|MediumItalic|Semibold|SemiBold|SemiBoldItalic|Light|LightItalic|ExtraLight|Thin|Black|Heavy|ExtraBold|Book|Roman|Oblique|Variable|VariableFont|Text|Display)$/;

function familyOf(baseFont: string): { family: string; style: string } {
  // "AAAAAB+Newsreader16pt-Italic_opsz,wght" → "Newsreader": subset tag, axis suffix, style words, optical size.
  let name = baseFont
    .replace(/^[A-Z]{6}\+/, "")
    .replace(/#([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/_.*$/, "");
  const styles: string[] = [];

  for (let i = 0; i < 4; i += 1) {
    const match = STYLE_WORDS.exec(name);

    if (!match) break;
    styles.unshift(match[1]!);
    name = name.slice(0, match.index);
  }
  // "IBMPlexMono" → "IBM Plex Mono"; "Figtree_wght" → "Figtree".
  const family = name
    .replace(/\d+pt$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();

  return { family, style: styles.join(" ") || "Regular" };
}

interface Painter {
  areas: Map<string, number>;
  text: Map<string, number>;
}

/** Counts painted area per fill colour in one content stream. */
function paint(content: string, painter: Painter): void {
  const stack: string[] = [];
  let fill = "#000000";
  const saved: string[] = [];
  let pathArea = 0;
  const tokens = content.match(/\/[^\s/<>[\]()]+|-?\d*\.?\d+|[A-Za-z'"*]+|\(|\)|\[|\]|<<|>>/g) ?? [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;

    if (/^-?\d*\.?\d+$/.test(token)) {
      stack.push(token);
      if (stack.length > 12) stack.shift();
      continue;
    }
    const n = (k: number) => Number(stack[stack.length - k]);

    switch (token) {
      case "rg":
        if (stack.length >= 3) fill = toHex({ r: n(3), g: n(2), b: n(1), a: 1 });
        break;
      case "sc":
      case "scn":
        // The operand count says the colour space: 1 grey, 3 RGB (incl. ICC-based RGB), 4 CMYK. A pattern name has none.
        if (stack.length === 3) fill = toHex({ r: n(3), g: n(2), b: n(1), a: 1 });
        else if (stack.length === 1) fill = toHex({ r: n(1), g: n(1), b: n(1), a: 1 });
        break;
      case "g":
        if (stack.length >= 1) fill = toHex({ r: n(1), g: n(1), b: n(1), a: 1 });
        break;
      case "k": {
        if (stack.length >= 4) {
          const [c, m, y, kk] = [n(4), n(3), n(2), n(1)];

          fill = toHex({ r: (1 - c) * (1 - kk), g: (1 - m) * (1 - kk), b: (1 - y) * (1 - kk), a: 1 });
        }
        break;
      }
      case "q":
        saved.push(fill);
        break;
      case "Q":
        fill = saved.pop() ?? fill;
        break;
      case "re":
        if (stack.length >= 4) pathArea += Math.abs(n(2) * n(1));
        break;
      case "f":
      case "F":
      case "f*":
      case "B":
      case "B*":
      case "b":
      case "b*":
        if (pathArea > 0) painter.areas.set(fill, (painter.areas.get(fill) ?? 0) + pathArea);
        pathArea = 0;
        break;
      case "n":
      case "S":
      case "s":
        pathArea = 0;
        break;
      case "Tj":
      case "TJ":
      case "'":
      case '"':
        painter.text.set(fill, (painter.text.get(fill) ?? 0) + 1);
        break;
    }
    if (!/^-?\d*\.?\d+$/.test(token)) stack.length = 0;
  }
}

export function readPdf(bytes: Uint8Array): PdfSummary {
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const encrypted = /\/Encrypt\s/.test(raw);
  const texts: string[] = [raw];
  const painter: Painter = { areas: new Map(), text: new Map() };
  let total = 0;

  for (const match of raw.matchAll(/<<((?:(?!stream)[\s\S]){0,4000}?)>>\s*stream\r?\n/g)) {
    const dict = match[1]!;
    const start = match.index! + match[0].length;
    const end = raw.indexOf("endstream", start);

    if (end === -1 || total > MAX_TOTAL_OUT) continue;
    if (/\/Subtype\s*\/Image|\/FontFile|\/Length1/.test(dict)) continue;
    let body = raw.slice(start, end);

    if (/\/FlateDecode/.test(dict)) {
      try {
        const out = inflateSync(Buffer.from(body, "latin1"), { maxOutputLength: MAX_STREAM_OUT });

        total += out.length;
        body = out.toString("latin1");
      } catch {
        continue;
      }
    } else if (/\/Filter/.test(dict)) continue;
    if (/\/Type\s*\/ObjStm/.test(dict)) texts.push(body);
    else if (!/\/Type\s*\/(XRef|Metadata)/.test(dict)) paint(body, painter);
  }
  const pages = Math.max(
    0,
    ...texts.map((text) => (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length),
    ...texts.flatMap((text) => [...text.matchAll(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/g)].map((m) => Number(m[1])))
  );
  const fonts = new Map<string, Set<string>>();

  for (const text of texts) {
    for (const match of text.matchAll(/\/(?:BaseFont|FontName)\s*\/([^\s/<>[\]()]+)/g)) {
      const { family, style } = familyOf(match[1]!);

      // Private system faces (".SFNS") and symbol fonts aren't anyone's brand.
      if (!family || family.startsWith(".") || /^(Symbol|ZapfDingbats)$/.test(family)) continue;
      fonts.set(family, (fonts.get(family) ?? new Set()).add(style));
    }
  }
  const areaTotal = [...painter.areas.values()].reduce((sum, value) => sum + value, 0);
  const colorKeys = new Set([...painter.areas.keys(), ...painter.text.keys()]);
  const colors = [...colorKeys]
    .map((color) => ({ color, share: areaTotal > 0 ? (painter.areas.get(color) ?? 0) / areaTotal : 0, text: painter.text.get(color) ?? 0 }))
    .filter((entry) => entry.share >= 0.002 || entry.text >= 3)
    .sort((a, b) => b.share - a.share || b.text - a.text)
    .slice(0, 16);

  return { pages, fonts: [...fonts.entries()].map(([family, styles]) => ({ family, styles: [...styles].sort() })).sort((a, b) => a.family.localeCompare(b.family)), colors, encrypted };
}
