/**
 * Small pieces the Sites screen, the switcher and the palette share: a few
 * extra glyphs on the icon grid, the site's thumbnail, its attention chips,
 * and a group's colour dot.
 */
import { useState, type ReactNode } from "react";
import type { SiteGroup, SiteSummary } from "@galley/core/types";
import { Badge, cx, type BadgeTone } from "@/ui";
import { attentionChips, type AttentionChip, type ChipTone } from "./logic";
import "./sites.css";

const GLYPHS = {
  pin: <path d="M9.6 2.5 13.5 6.4l-2 .9-2.4 2.4.3 2.8-1.2 1.2-2.4-2.4L3 14.1m2.8-5.4L3.4 6.3l1.2-1.2 2.8.3L9.8 3z" />,
  cards: <path d="M2.5 2.5h4.5V7H2.5zM9 2.5h4.5V7H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" />,
  rows: <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" />,
  window: <path d="M2.5 3.5h11v9h-11zM2.5 6h11M9.5 8.5v2.5h-2.5M9.5 11 6.5 8" />,
  grip: <path d="M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01" strokeWidth={2.2} strokeLinecap="round" />,
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, className }: { name: GlyphName; className?: string }) {
  return (
    <svg className={cx("g-icon", className)} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {GLYPHS[name]}
    </svg>
  );
}

/** The two letters a site without a picture is shown by. */
export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "·";
  return (words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words[1]![0]}`).toUpperCase();
}

/**
 * The site's own share image when it has one, else its monogram on its
 * group's colour — honest about not having a picture, and never waited on:
 * the image loads lazily and a broken one falls back quietly.
 */
export function SiteThumb({ site, group, size = "card" }: { site: SiteSummary; group?: SiteGroup | undefined; size?: "card" | "row" | "mini" }) {
  const [broken, setBroken] = useState(false);
  const picture = site.thumbnailUrl && !broken && !site.missing;
  return (
    <span className={cx("sites-thumb", `sites-thumb--${size}`, `sites-tone--${group?.color ?? "none"}`, site.missing && "sites-thumb--missing")} aria-hidden="true">
      {picture ? <img src={site.thumbnailUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : <span className="sites-thumb__mono">{monogram(site.name)}</span>}
    </span>
  );
}

const BADGE_TONE: Record<ChipTone, BadgeTone> = { warning: "warning", change: "change", info: "info", accent: "accent", neutral: "neutral", success: "success" };

export function Chip({ chip }: { chip: AttentionChip }) {
  return (
    <span title={chip.title} className="sites-chip">
      <Badge tone={BADGE_TONE[chip.tone]}>{chip.label}</Badge>
      <span className="g-sr">{chip.title}</span>
    </span>
  );
}

/** Quiet chips for what the site is waiting on; "Up to date" when nothing is. `limit` keeps a row short. */
export function AttentionChips({ site, limit, showClean = true }: { site: SiteSummary; limit?: number; showClean?: boolean }) {
  const chips = attentionChips(site);
  const shown = limit ? chips.slice(0, limit) : chips;
  if (chips.length === 0) {
    if (!showClean) return null;
    return (
      <span className="sites-chips">
        <span className="sites-clean">{site.facts ? "Up to date" : "Not checked yet"}</span>
      </span>
    );
  }
  return (
    <span className="sites-chips">
      {shown.map((chip) => (
        <Chip key={chip.kind} chip={chip} />
      ))}
      {chips.length > shown.length ? <span className="sites-more">+{chips.length - shown.length}</span> : null}
    </span>
  );
}

export function GroupDot({ group }: { group: SiteGroup | null | undefined }) {
  return <span className={cx("sites-dot", `sites-tone--${group?.color ?? "none"}`)} aria-hidden="true" />;
}

/** "www.example.com" from a live address, for showing. */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
