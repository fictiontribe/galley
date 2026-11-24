/**
 * The desktop app's downloads: src/data/downloads.json is the only place the
 * site learns whether there is anything to download. `on` is true only when
 * the file says `available` and at least one platform is available with a
 * real address; everything that offers a download (the home section, the
 * footer link, the buttons on /download/) checks it. Screens are captures of
 * the app window: one whose file or alt text is missing is left out.
 */
import data from "../data/downloads.json";
import { fill } from "./site";
import { findPicture, noteMissing, type Picture } from "./media";

export interface Platform {
  id: string;
  label: string;
  button: string;
  file: string;
  url: string;
  size: string;
  requires: string;
  signed: boolean;
  available: boolean;
  open: string[];
  also: { label: string; file?: string; url: string; size?: string }[];
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export const platforms: Platform[] = (Array.isArray(data.platforms) ? data.platforms : []).map((p) => {
  const raw = p as Record<string, unknown>;
  const url = text(raw.url);
  return {
    id: text(raw.id),
    label: text(raw.label),
    button: text(raw.button) || `Download for ${text(raw.label)}`,
    file: text(raw.file),
    url: url ? fill(url) : "",
    size: text(raw.size),
    requires: text(raw.requires),
    signed: raw.signed === true,
    // A platform is only offered with somewhere to download it from.
    available: raw.available === true && Boolean(url),
    open: Array.isArray(raw.open) ? raw.open.map(text).filter(Boolean) : [],
    also: Array.isArray(raw.also) ? (raw.also as Platform["also"]).filter((a) => a && text(a.url) && text(a.label)).map((a) => ({ ...a, url: fill(a.url) })) : [],
  };
});

export const ready = platforms.filter((p) => p.available);
/** Downloads are offered anywhere on the site only when this is true. */
export const on = data.available === true && ready.length > 0;
export const version = text(data.version);
export const releasePage = text(data.releasePage) ? fill(text(data.releasePage)) : "";
export const unsigned = ready.some((p) => !p.signed);

/** One line under a platform: its size and the oldest system it runs on. */
export const metaOf = (p: Platform) => [p.size, p.requires].filter(Boolean).join(" · ");

export interface AppScreen {
  pic: Picture;
  alt: string;
  home: boolean;
}

export const screens: AppScreen[] = (Array.isArray(data.screens) ? data.screens : []).flatMap((s) => {
  const raw = s as Record<string, unknown>;
  const src = text(raw.src);
  if (!src) return [];
  const pic = findPicture(`screens/${src}`);
  if (!pic) {
    if (on) noteMissing(`screens/${src}`, "the desktop app's pictures leave it out until it is captured");
    return [];
  }
  if (!text(raw.alt)) {
    console.warn(`[site] downloads.json: screens/${src} has no alt text yet; left out until someone writes what it shows.`);
    return [];
  }
  return [{ pic, alt: text(raw.alt), home: raw.home === true }];
});

export const homeScreen = screens.find((s) => s.home) ?? screens[0];
