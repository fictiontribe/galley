/**
 * Measure: what the current page really looks like, from its computed
 * styles. Read-only — nothing on the page is changed — and answered only to
 * the host that framed the page (the overlay's own origin check).
 *
 * The browser already did the hard part (cascade, variables, media queries,
 * fonts), so this reports what it resolved: each text colour on its effective
 * background with the area it covers, the type styles by role, radii,
 * shadows, the spacing rhythm of sections, buttons and links, logo
 * candidates in the header, which web fonts loaded, the :root custom
 * properties, and a sample of the page's own copy. A background that is a
 * picture or a gradient is never guessed: its text pairs are left out.
 *
 * The summary is size-capped (MEASURE_LIMIT_BYTES of JSON); when cut,
 * `truncated` says so.
 */
import type { MeasureSummary } from "@galley/core/sitebrand/types";
import { composite, contrastRatio, parseColor, toHex, type Rgba } from "@galley/core/sitebrand/color";

export const MEASURE_LIMIT_BYTES = 60_000;
const MAX_ELEMENTS = 5000;
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK", "IFRAME", "OBJECT", "CANVAS", "VIDEO", "AUDIO", "SELECT", "TEXTAREA", "OPTION"]);
const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
const WORDS = /[\p{L}\p{N}]/u;

type Role = MeasureSummary["type"][number]["role"];

/** The overlay's own chrome (the tag, Arrange's shadow host) is never measured. */
function ours(element: Element): boolean {
  for (const name of element.getAttributeNames()) if (name.startsWith("data-galley-") && name !== "data-galley-block" && name !== "data-galley-block-type") return true;
  return false;
}

function ownText(element: Element): string {
  let text = "";

  for (const node of Array.from(element.childNodes)) if (node.nodeType === 3) text += node.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

const px = (value: string) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

function firstFamily(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}

function bump<K>(map: Map<K, number>, key: K, n = 1): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

export function measurePage(win: Window, options: { limitBytes?: number; maxElements?: number } = {}): MeasureSummary {
  const doc = win.document;
  const styleOf = (element: Element) => win.getComputedStyle(element);
  // happy-dom and other layout-less documents report every box as 0×0; real pages never do.
  const laidOut = doc.documentElement.getBoundingClientRect().height > 0;
  const backgrounds = new Map<Element, Rgba | null>();

  /** The opaque colour behind an element, or null when a picture or gradient is in the way. */
  const groundOf = (element: Element | null): Rgba | null => {
    if (!element) return WHITE;
    if (backgrounds.has(element)) return backgrounds.get(element)!;
    const style = styleOf(element);
    const own = parseColor(style.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 };
    let result: Rgba | null;

    if (style.backgroundImage && style.backgroundImage !== "none" && own.a < 1) result = null;
    else if (own.a >= 1) result = own;
    else {
      const below = groundOf(element.parentElement);

      result = below === null ? null : own.a > 0 ? composite(own, below) : below;
    }
    backgrounds.set(element, result);
    return result;
  };

  const pairs = new Map<string, { text: string; background: string; area: number; count: number; roles: Set<string>; ratio: number }>();
  const grounds = new Map<string, number>();
  const type = new Map<string, MeasureSummary["type"][number]>();
  const radii = new Map<string, number>();
  const shadows = new Map<string, number>();
  const spacing = new Map<number, number>();
  const buttons = new Map<string, MeasureSummary["buttons"][number]>();
  const links = new Map<string, MeasureSummary["links"][number]>();
  const families = new Set<string>();
  const copy: MeasureSummary["copy"] = [];
  const seenCopy = new Set<string>();
  const viewport = { width: win.innerWidth, height: win.innerHeight };
  const elements = Array.from(doc.body?.querySelectorAll("*") ?? []).slice(0, options.maxElements ?? MAX_ELEMENTS);

  for (const element of elements) {
    if (SKIP.has(element.tagName.toUpperCase()) || ours(element) || element.closest("[data-galley-overlay],[aria-hidden='true']")) continue;
    const style = styleOf(element);

    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    const box = element.getBoundingClientRect();
    const boxArea = box.width * box.height;

    if (laidOut && boxArea <= 0) continue;
    const tag = element.tagName.toLowerCase();
    const bg = parseColor(style.backgroundColor);
    const hasGround = bg !== null && bg.a > 0.05;

    if (hasGround && bg && (boxArea >= viewport.width * viewport.height * 0.02 || /^(body|main|section|header|footer|article|aside)$/.test(tag))) {
      bump(grounds, toHex(bg.a < 1 ? composite(bg, groundOf(element.parentElement) ?? WHITE) : bg), Math.round(boxArea));
    }
    const radius = style.borderTopLeftRadius;

    if (radius && px(radius) > 0 && (hasGround || px(style.borderTopWidth) > 0 || tag === "img")) bump(radii, radius.split(" ")[0]!);
    if (style.boxShadow && style.boxShadow !== "none") bump(shadows, style.boxShadow.slice(0, 300));
    if (element.matches("main > *, body > section, section, [data-galley-block], header, footer")) {
      for (const value of [style.paddingTop, style.paddingBottom]) if (px(value) >= 4) bump(spacing, Math.round(px(value)));
    }
    if (/(flex|grid)$/.test(style.display)) for (const value of [style.rowGap, style.columnGap]) if (value && value !== "normal" && px(value) > 0) bump(spacing, Math.round(px(value)));

    const text = ownText(element);

    if (!text || !WORDS.test(text)) continue;
    const size = px(style.fontSize);
    const area = laidOut ? boxArea : text.length * size * size * 0.55;
    const isLink = element.closest("a[href]") !== null;
    const buttonLike = tag === "button" || element.getAttribute("role") === "button" || (tag === "a" && hasGround && px(style.paddingLeft) >= 6) || (tag === "input" && /submit|button/.test((element as HTMLInputElement).type));
    const role: Role = /^h[1-6]$/.test(tag) ? "heading" : buttonLike || element.closest("button") ? "button" : isLink ? "link" : /^(label|small|figcaption|dt|th|caption|legend)$/.test(tag) || element.closest("nav") ? "label" : "body";
    const ground = groundOf(element);
    const fg = parseColor(style.color);

    if (ground && fg) {
      const solid = fg.a < 1 ? composite(fg, ground) : fg;
      const key = `${toHex(solid)}|${toHex(ground)}`;
      const pair = pairs.get(key) ?? { text: toHex(solid), background: toHex(ground), area: 0, count: 0, roles: new Set<string>(), ratio: contrastRatio(solid, ground) };

      pair.area += area;
      pair.count += 1;
      pair.roles.add(role);
      pairs.set(key, pair);
    }
    const family = firstFamily(style.fontFamily);

    families.add(family);
    const weight = Number(style.fontWeight) || 400;
    const lineHeight = style.lineHeight === "normal" ? Math.round(size * 1.2) : px(style.lineHeight);
    const letterSpacing = style.letterSpacing === "normal" ? 0 : Math.round(px(style.letterSpacing) * 100) / 100;
    const typeKey = `${role}|${tag}|${family}|${Math.round(size)}|${weight}`;
    const entry = type.get(typeKey) ?? { role, tag, family, size: Math.round(size * 10) / 10, weight, lineHeight: Math.round(lineHeight * 10) / 10, letterSpacing, count: 0 };

    entry.count += 1;
    type.set(typeKey, entry);
    if (role === "button" && bg) {
      const fill = toHex(hasGround ? (bg.a < 1 ? composite(bg, groundOf(element.parentElement) ?? WHITE) : bg) : (ground ?? WHITE));
      const ink = fg ? toHex(fg.a < 1 ? composite(fg, ground ?? WHITE) : fg) : "#000000";
      const key = `${fill}|${ink}|${style.borderTopLeftRadius}`;
      const found = buttons.get(key) ?? {
        background: fill,
        color: ink,
        border: px(style.borderTopWidth) > 0 ? `${style.borderTopWidth} ${style.borderTopStyle} ${toHex(parseColor(style.borderTopColor) ?? WHITE)}` : "none",
        radius: style.borderTopLeftRadius || "0px",
        paddingX: px(style.paddingLeft),
        paddingY: px(style.paddingTop),
        family,
        weight,
        size,
        count: 0,
        sample: text.slice(0, 40),
      };

      found.count += 1;
      buttons.set(key, found);
    } else if (role === "link" && fg && ground) {
      const color = toHex(fg.a < 1 ? composite(fg, ground) : fg);
      const decoration = (style.textDecorationLine || "none").slice(0, 40);
      const key = `${color}|${decoration}`;
      const found = links.get(key) ?? { color, decoration, count: 0 };

      found.count += 1;
      links.set(key, found);
    }
    const sample = text.slice(0, 300);
    const copyRole = role === "heading" ? "heading" : role === "button" ? "button" : role === "body" && text.split(" ").length >= 6 ? "body" : null;

    if (copyRole && !seenCopy.has(sample.toLowerCase())) {
      seenCopy.add(sample.toLowerCase());
      copy.push({ role: copyRole, text: sample });
    }
  }

  const summary: MeasureSummary = {
    path: `${win.location.pathname}${win.location.search}`.slice(0, 500),
    title: doc.title.slice(0, 300),
    viewport,
    pairs: [...pairs.values()].sort((a, b) => b.area - a.area).slice(0, 60).map((p) => ({ ...p, area: Math.round(p.area), roles: [...p.roles] })),
    grounds: [...grounds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([color, area]) => ({ color, area })),
    type: [...type.values()].sort((a, b) => b.count - a.count).slice(0, 40),
    radii: top(radii, 20),
    shadows: top(shadows, 10),
    spacing: top(spacing, 24),
    buttons: [...buttons.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    links: [...links.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    logos: logoCandidates(win),
    fonts: fontStatus(doc, families),
    variables: rootVariables(doc),
    internalLinks: internalLinks(win),
    copy: [...copy.filter((c) => c.role === "heading").slice(0, 20), ...copy.filter((c) => c.role === "body").slice(0, 30), ...copy.filter((c) => c.role === "button").slice(0, 15)],
    truncated: elements.length >= (options.maxElements ?? MAX_ELEMENTS),
  };

  return capped(summary, options.limitBytes ?? MEASURE_LIMIT_BYTES);
}

function top<K extends string | number>(map: Map<K, number>, n: number): Array<{ value: K; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

/** Shrinks the longest lists first until the JSON fits. */
function capped(summary: MeasureSummary, limit: number): MeasureSummary {
  const out = { ...summary };
  const order: Array<keyof MeasureSummary> = ["copy", "variables", "internalLinks", "pairs", "type", "grounds", "shadows", "radii", "spacing", "buttons", "links", "fonts", "logos"];

  for (let round = 0; round < 40 && JSON.stringify(out).length > limit; round += 1) {
    out.truncated = true;
    const key = order.find((name) => Array.isArray(out[name]) && (out[name] as unknown[]).length > 2) ?? null;

    if (!key) break;
    const list = out[key] as unknown[];

    (out as Record<string, unknown>)[key as string] = list.slice(0, Math.floor(list.length / 2));
    // Cycle through the lists so one doesn't lose everything while another stays whole.
    order.push(order.splice(order.indexOf(key), 1)[0]!);
  }
  if (JSON.stringify(out).length > limit) {
    out.copy = [];
    out.variables = [];
    out.truncated = true;
  }
  return out;
}

function logoCandidates(win: Window): MeasureSummary["logos"] {
  const doc = win.document;
  const header = doc.querySelector("header, [role='banner']") ?? doc.querySelector("nav");

  if (!header) return [];
  const found: Element[] = [];
  const push = (element: Element | null) => {
    if (element && !found.includes(element) && found.length < 3) found.push(element);
  };

  for (const element of Array.from(header.querySelectorAll("a[href='/'] img, a[href='/'] svg, img[alt*='logo' i], [class*='logo' i] img, [class*='logo' i] svg, img, svg"))) {
    if (element.tagName.toLowerCase() === "svg" && element.parentElement?.closest("svg")) continue;
    push(element);
  }
  return found.map((element) => {
    const box = element.getBoundingClientRect();

    if (element.tagName.toLowerCase() === "img") {
      const image = element as HTMLImageElement;
      let src = image.currentSrc || image.getAttribute("src") || "";

      try {
        const url = new URL(src, win.location.href);
        src = url.origin === win.location.origin ? url.pathname : url.href;
      } catch {
        // keep as written
      }
      return { kind: "img" as const, src: src.slice(0, 1000), alt: (image.getAttribute("alt") ?? "").slice(0, 200), width: Math.round(box.width), height: Math.round(box.height), colors: [] };
    }
    const colors = new Set<string>();

    for (const shape of Array.from(element.querySelectorAll("path, rect, circle, polygon, ellipse, text, g")).slice(0, 200)) {
      const style = win.getComputedStyle(shape);

      for (const value of [style.fill, style.stroke, shape.getAttribute("fill") ?? ""]) {
        const parsed = value && value !== "none" ? parseColor(value) : null;

        if (parsed && parsed.a > 0) colors.add(toHex(parsed).slice(0, 7));
      }
    }
    const viewBox = element.getAttribute("viewBox") ?? undefined;

    return { kind: "svg" as const, width: Math.round(box.width), height: Math.round(box.height), colors: [...colors].slice(0, 8), ...(viewBox ? { viewBox: viewBox.slice(0, 80) } : {}), ...(element.getAttribute("aria-label") ? { alt: element.getAttribute("aria-label")!.slice(0, 200) } : {}) };
  });
}

function fontStatus(doc: Document, used: Set<string>): MeasureSummary["fonts"] {
  const status = new Map<string, "loaded" | "unloaded" | "error">();
  const set = (doc as Document & { fonts?: Iterable<FontFace> }).fonts;

  try {
    for (const face of set ? Array.from(set) : []) {
      const family = face.family.replace(/^["']|["']$/g, "");
      const now = face.status === "loaded" ? "loaded" : face.status === "error" ? "error" : "unloaded";

      if (status.get(family) !== "loaded") status.set(family, now);
    }
  } catch {
    // No font loading API: report only the families in use.
  }
  for (const family of used) if (family && !status.has(family)) status.set(family, "unloaded");
  return [...status.entries()].slice(0, 20).map(([family, s]) => ({ family: family.slice(0, 160), status: s }));
}

function rootVariables(doc: Document): MeasureSummary["variables"] {
  const out = new Map<string, string>();
  const visit = (rules: CSSRuleList | undefined, depth: number) => {
    if (!rules || depth > 4) return;
    for (const rule of Array.from(rules)) {
      if (out.size >= 300) return;
      const style = (rule as CSSStyleRule).style;
      const selector = (rule as CSSStyleRule).selectorText;

      if (style && selector && /^(:root|html)$/i.test(selector.trim())) {
        for (let i = 0; i < style.length; i += 1) {
          const name = style.item(i);

          if (name.startsWith("--") && !out.has(name)) out.set(name, style.getPropertyValue(name).trim().slice(0, 300));
        }
      }
      const nested = (rule as CSSGroupingRule).cssRules ?? (rule as CSSImportRule).styleSheet?.cssRules;

      if (nested) visit(nested, depth + 1);
    }
  };

  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      visit(sheet.cssRules, 0);
    } catch {
      // A stylesheet from another origin can't be read; that's the browser keeping it private.
    }
  }
  return [...out.entries()].map(([name, value]) => ({ name: name.slice(0, 120), value }));
}

function internalLinks(win: Window): MeasureSummary["internalLinks"] {
  const counts = new Map<string, number>();

  for (const link of Array.from(win.document.querySelectorAll("a[href]")).slice(0, 2000)) {
    try {
      const url = new URL(link.getAttribute("href") ?? "", win.location.href);

      if (url.origin === win.location.origin && !/\.(png|jpe?g|webp|gif|svg|pdf|xml|txt|zip)$/i.test(url.pathname)) bump(counts, url.pathname.slice(0, 500));
    } catch {
      // not an address
    }
  }
  return top(counts, 30).map(({ value, count }) => ({ path: value, count }));
}
