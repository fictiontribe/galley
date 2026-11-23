/**
 * Setting the specimen in the brand's real fonts: the site's own web fonts
 * are loaded from the API (same origin, so the app's font policy allows
 * them); anything else is used if this computer or the app already has it.
 * When a font can't be shown, the specimen names it and says so.
 */
import { useEffect, useState } from "react";

const loaded = new Map<string, Promise<boolean>>();

/** Whether text set in `family` really renders in it (not a fallback), by measuring. */
export function renders(family: string): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) return false;
  const sample = "Hamburgefonstiv 0123 &@";
  const width = (stack: string) => {
    context.font = `32px ${stack}`;
    return context.measureText(sample).width;
  };

  return ["monospace", "serif", "sans-serif"].some((generic) => width(`"${family}", ${generic}`) !== width(generic));
}

export function loadWebFont(family: string, url: string, weight: string, style: string): Promise<boolean> {
  const key = `${family}|${url}`;
  let promise = loaded.get(key);

  if (!promise) {
    promise = (async () => {
      try {
        const face = new FontFace(family, `url(${url})`, { weight, style });

        document.fonts.add(await face.load());
        return true;
      } catch {
        return false;
      }
    })();
    loaded.set(key, promise);
  }
  return promise;
}

export interface FontView {
  /** The CSS family to set the sample in. */
  css: string;
  /** Shown in the real font. */
  real: boolean;
}

/**
 * For each family: load the site's file when there is one, then decide what
 * the sample is set in. "Newsreader" from a PDF is shown with an installed
 * "Newsreader Variable" — the same typeface's variable build.
 */
export function useFontViews(families: string[], webFonts: Array<{ family: string; weight: string; style: string; url: string }>): Record<string, FontView> {
  const [views, setViews] = useState<Record<string, FontView>>({});
  const signature = JSON.stringify([families, webFonts.map((f) => f.url)]);

  useEffect(() => {
    let live = true;

    void (async () => {
      await Promise.all(webFonts.map((font) => loadWebFont(font.family, font.url, font.weight, font.style)));
      await document.fonts.ready;
      const next: Record<string, FontView> = {};

      for (const family of families) {
        const candidates = [family, `${family} Variable`, family.replace(/\s+Variable$/, "")];
        const real = candidates.find((name) => renders(name));

        next[family] = real ? { css: `"${real}"`, real: true } : { css: "var(--font-text)", real: false };
      }
      if (live) setViews(next);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature covers both lists
  }, [signature]);
  return views;
}
