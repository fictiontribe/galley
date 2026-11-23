import type { ReactNode } from "react";

/**
 * Glyphs the editing controls need beyond the kit's icon set, drawn on the
 * same 16-unit grid with the 1.5 stroke and currentColor.
 */
const GLYPHS = {
  grip: (
    <>
      {[4.5, 8, 11.5].map((y) => (
        <g key={y}>
          <circle cx="6" cy={y} r="1" fill="currentColor" stroke="none" />
          <circle cx="10" cy={y} r="1" fill="currentColor" stroke="none" />
        </g>
      ))}
    </>
  ),
  "arrow-up": <path d="M8 13V3M4 7l4-4 4 4" />,
  "arrow-down": <path d="M8 3v10M4 9l4 4 4-4" />,
  bold: <path d="M4.5 2.8h4.2a2.6 2.6 0 0 1 0 5.2H4.5zM4.5 8h4.9a2.6 2.6 0 0 1 0 5.2H4.5z" strokeWidth="1.8" />,
  italic: <path d="M7 2.8h5M4 13.2h5M9.8 2.8 6.2 13.2" />,
  heading: <path d="M3.5 3v10M10.5 3v10M3.5 8h7M12.5 13V9.5l-1 .6" />,
  quote: <path d="M3 4v8M6 5h7M6 8h7M6 11h4.5" />,
  "list-bullet": (
    <>
      <circle cx="3.5" cy="4.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7" />
    </>
  ),
  "list-number": <path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7M2.6 3.4l.9-.6V6M2.4 9.2c.2-.5 1.7-.6 1.7.3 0 .6-1.6 1.4-1.6 1.9h1.7" />,
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />,
  link: <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2.2-2.2a2.5 2.5 0 0 0-3.5-3.5L8.5 4M9 7a2.5 2.5 0 0 0-3.5 0L3.3 9.2a2.5 2.5 0 0 0 3.5 3.5l.7-.7" />,
  image: (
    <>
      <path d="M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3" />
      <circle cx="10.5" cy="6" r="1" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type FormIconName = keyof typeof GLYPHS;

export function FormIcon({ name, size }: { name: FormIconName; size?: number }) {
  return (
    <svg className="g-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false" width={size} height={size}>
      {GLYPHS[name]}
    </svg>
  );
}
