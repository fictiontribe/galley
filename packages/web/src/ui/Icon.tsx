import type { ReactNode, SVGProps } from "react";

/**
 * Inline SVG icons on a 16-unit grid, 1.5 stroke, currentColor — drawn to
 * match the specimen's sidebar. The proof marks are the same glyphs as the
 * brand's CSS masks, so they can sit in an <svg> context too.
 */
const ICONS = {
  // ── navigation
  home: <path d="M2.5 7.2 8 2.8l5.5 4.4v6.3h-11z" />,
  proof: <path d="M3 4h10M3 8h3.5m3 0H13M5.6 13.2 8 9.8l2.4 3.4" />,
  page: <path d="M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3" />,
  posts: <path d="M3 3.5h10M3 6.8h10M3 10.1h10M3 13.4h6" />,
  person: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
    </>
  ),
  image: (
    <>
      <path d="M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3" />
      <circle cx="10.5" cy="6" r="1" />
    </>
  ),
  history: <path d="M2.8 8a5.2 5.2 0 1 0 1.5-3.7M2.5 2.8v2.6h2.6M8 5.2V8l2 1.4" />,
  settings: (
    <>
      <path d="M2.5 4.5h11M2.5 11.5h11" />
      <circle cx="6" cy="4.5" r="1.6" fill="var(--surface-paper)" />
      <circle cx="10" cy="11.5" r="1.6" fill="var(--surface-paper)" />
    </>
  ),
  data: <path d="M5.5 2.5c-1.6 0-2 .7-2 2v1.6c0 .9-.5 1.4-1.3 1.9.8.5 1.3 1 1.3 1.9v1.6c0 1.3.4 2 2 2M10.5 2.5c1.6 0 2 .7 2 2v1.6c0 .9.5 1.4 1.3 1.9-.8.5-1.3 1-1.3 1.9v1.6c0 1.3-.4 2-2 2" />,
  sites: <path d="M2.5 3.5h4.5l1.2 1.5h5.3v7.5h-11zM2.5 7h11" />,
  // A plug: two prongs, the body, the cord.
  plugin: <path d="M6 2.5v3M10 2.5v3M4 5.5h8v2.5a4 4 0 0 1-8 0zM8 12v1.5" />,
  folder: <path d="M2.5 3.5h4.5l1.2 1.5h5.3v7.5h-11z" />,
  "folder-site": (
    <>
      <path d="M2.5 3.5h4.5l1.2 1.5h5.3v7.5h-11z" />
      <path d="M5.5 8.5h5M5.5 10.5h2.5" />
    </>
  ),
  clone: <path d="M8 2.5v7.5M5 7l3 3 3-3M3 12.5h10" />,
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3.5 3.5" />
    </>
  ),
  "chevron-down": <path d="m4 6 4 4 4-4" />,
  "chevron-right": <path d="m6 4 4 4-4 4" />,
  "chevron-left": <path d="m10 4-4 4 4 4" />,
  "chevron-up-down": <path d="m5 6 3-3 3 3M5 10l3 3 3-3" />,
  "arrow-up": <path d="M8 13V3M4 7l4-4 4 4" />,
  external: <path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4" />,
  refresh: <path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.7M13.5 2.8v2.6h-2.6" />,
  play: <path d="M5 3.2v9.6L12.5 8z" />,
  stop: <path d="M4 4h8v8H4z" />,
  more: (
    <>
      <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="m3 8.5 3.2 3L13 4.5" />,
  warning: <path d="M8 2.2 14.2 13.3H1.8zM8 6.5v3M8 11.2v.3" />,
  upload: <path d="M8 10.5V2.5M5 5.5l3-3 3 3M3 10v3.5h10V10" />,
  link: <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2.2-2.2a2.5 2.5 0 0 0-3.5-3.5L8.5 4M9 7a2.5 2.5 0 0 0-3.5 0L3.3 9.2a2.5 2.5 0 0 0 3.5 3.5l.7-.7" />,
  globe: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.4 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10.1 5.7 8S6.4 4.1 8 2.5" />
    </>
  ),
  columns: <path d="M2.5 3h11v10h-11zM8 3v10" />,
  "panel-left": <path d="M2.5 3h11v10h-11zM6 3v10" />,
  "panel-right": <path d="M2.5 3h11v10h-11zM10 3v10" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9" />,
  copy: <path d="M5.5 5.5h7v8h-7zM3.5 10.5v-8h7" />,
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="2.5" />
      <path d="m7.3 8.7 5.2-5.2M10.5 5.5l1.5 1.5" />
    </>
  ),
  chat: <path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" />,
  inbox: <path d="M2.5 9 4.3 3.5h7.4L13.5 9v3.5h-11zM2.5 9h3.2l.8 1.6h3l.8-1.6h3.2" />,
  undo: <path d="M5.5 6.5H10a3 3 0 0 1 0 6H6M5.5 6.5 8 4M5.5 6.5 8 9" />,
  download: <path d="M8 2.5v8M5 7.5l3 3 3-3M3 13.5h10" />,
  eye: (
    <>
      <path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </>
  ),
  // ── proof marks (same geometry as the brand masks, on their 12-unit grid scaled to 16)
  caret: <path d="M2.1 13.9 8 4.3l5.9 9.6" strokeWidth="2.2" />,
  dele: <path d="M1.1 9.9h7.5c2.9 0 4.5-1.7 4-3.6-.5-1.7-2.9-1.9-3.5-.1-.7 2.3 1.7 4.8 5.9 5.2" strokeLinecap="round" strokeWidth="1.9" />,
  transpose: <path d="M1.6 11.5C3.5 4 6.7 3.2 8 8s4.5 4 6.4-3.5" strokeLinecap="round" strokeWidth="2" />,
  stet: (
    <>
      <circle cx="2.7" cy="9.3" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="8" cy="9.3" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="13.3" cy="9.3" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  registration: (
    <>
      <circle cx="8" cy="8" r="4.1" />
      <path d="M.7 8h14.6M8 .7v14.6" />
    </>
  ),
  pilcrow: (
    <>
      <path d="M6.9 2h7.1M9.3 2v12.7M12.5 2v12.7" strokeWidth="1.7" />
      <path d="M9.3 2H7.2a3.2 3.2 0 0 0 0 6.4h2.1z" fill="currentColor" stroke="none" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Pixel size; defaults to 16 via the .g-icon class. */
  size?: number;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string;
}

export function Icon({ name, size, label, className, ...rest }: IconProps) {
  return (
    <svg
      className={className ? `g-icon ${className}` : "g-icon"}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      style={size ? { inlineSize: size, blockSize: size } : undefined}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}
