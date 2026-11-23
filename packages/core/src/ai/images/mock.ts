/**
 * The offline provider: a deterministic abstract SVG at the requested aspect,
 * seeded from the prompt, with the prompt as a small caption. It lets the
 * whole generate → pick → save → place flow work with no key, in tests and
 * in demos, and it is obviously a placeholder to anyone looking at the page.
 */
import { aspectDimensions } from "./catalog";
import type { GeneratedImage, ImageProvider, ProviderRequest } from "./provider";

/** FNV-1a: tiny, stable across platforms and Node versions. */
function hash(text: string): number {
  let h = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — a seeded PRNG, so the same prompt always draws the same picture. */
function random(seed: number): () => number {
  let a = seed;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

const round = (n: number) => Math.round(n * 10) / 10;

export function renderMockSvg(prompt: string, width: number, height: number, variant = 0): string {
  const rand = random(hash(`${prompt}\u0000${variant}`));
  const hue = Math.floor(rand() * 360);
  // An analogous palette with one complementary accent reads as "designed".
  const ground = `hsl(${hue} 32% 93%)`;
  const colors = [
    `hsl(${hue} 46% 62%)`,
    `hsl(${(hue + 28) % 360} 52% 48%)`,
    `hsl(${(hue + 332) % 360} 40% 74%)`,
    `hsl(${(hue + 180) % 360} 55% 42%)`,
  ];
  const short = Math.min(width, height);
  const shapes: string[] = [];

  for (let i = 0; i < 7; i += 1) {
    const color = colors[i % colors.length] as string;
    const x = round(rand() * width);
    const y = round(rand() * height * 0.85);
    const kind = rand();

    if (kind < 0.45) {
      shapes.push(`<circle cx="${x}" cy="${y}" r="${round(short * (0.08 + rand() * 0.28))}" fill="${color}" opacity="${round(0.55 + rand() * 0.4)}"/>`);
    } else if (kind < 0.75) {
      const w = round(width * (0.15 + rand() * 0.35));
      const h = round(height * (0.1 + rand() * 0.3));

      shapes.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${round(short * 0.03)}" fill="${color}" opacity="${round(0.5 + rand() * 0.4)}" transform="rotate(${Math.floor(rand() * 40 - 20)} ${x} ${y})"/>`
      );
    } else {
      const r = round(short * (0.15 + rand() * 0.3));

      shapes.push(
        `<path d="M ${round(x - r)} ${y} A ${r} ${r} 0 0 1 ${round(x + r)} ${y}" fill="none" stroke="${color}" stroke-width="${round(short * 0.025)}" stroke-linecap="round"/>`
      );
    }
  }
  const caption = prompt.replace(/\s+/g, " ").trim();
  const text = escapeXml(caption.length > 70 ? `${caption.slice(0, 69)}…` : caption);
  const fontSize = Math.max(12, Math.round(short * 0.032));
  const band = Math.round(fontSize * 2.4);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${text}">`,
    `<rect width="${width}" height="${height}" fill="${ground}"/>`,
    ...shapes,
    `<rect x="0" y="${height - band}" width="${width}" height="${band}" fill="hsl(${hue} 30% 18%)" opacity="0.78"/>`,
    `<text x="${Math.round(fontSize * 1.1)}" y="${height - Math.round(band / 2)}" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="${fontSize}" fill="#ffffff">${text}</text>`,
    `</svg>`,
    "",
  ].join("\n");
}

export const mockProvider: ImageProvider = {
  id: "mock",
  async generate(request: ProviderRequest): Promise<GeneratedImage[]> {
    const { width, height } = aspectDimensions(request.aspect);
    const images: GeneratedImage[] = [];

    for (let i = 0; i < request.count; i += 1) {
      images.push({
        data: new TextEncoder().encode(renderMockSvg(request.prompt, width, height, i)),
        mime: "image/svg+xml",
        width,
        height,
      });
    }
    return images;
  },
};
